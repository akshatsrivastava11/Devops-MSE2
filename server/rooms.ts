import { randomBytes, randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  ClientToServer, CODE_ALPHABET, KINDS, LANGS, MAX_BODY_BYTES, MAX_NAME, MAX_PAD_BYTES,
  MAX_TITLE, Message, Person, ROOM_ID, ROOM_TTL_MS, RoomMeta, ServerToClient, WipeReason, byteLength,
} from "../lib/protocol";
import type { Store } from "./store";

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, { roomId?: string; name?: string }>;

// How long a room survives with nobody in it. Long enough to survive a refresh
// or a flaky connection, short enough that "everyone left" still means gone.
const EMPTY_GRACE_MS = Number(process.env.EMPTY_GRACE_MS ?? 15_000);
// A room nobody ever opens is wiped after this.
const UNCLAIMED_MS = Number(process.env.UNCLAIMED_MS ?? 120_000);

function newCode() {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function cleanName(input: unknown): string {
  const s = typeof input === "string" ? input.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME) : "";
  return s || "anonymous";
}

class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private size: number, private perSec: number) { this.tokens = size; }
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.size, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class Rooms {
  private expiry = new Map<string, NodeJS.Timeout>();
  private empty = new Map<string, NodeJS.Timeout>();
  private padWrites = new Map<string, NodeJS.Timeout>();

  constructor(private io: IO, private store: Store) {}

  // After a restart, data in Redis has no presence. Treat every surviving room as
  // empty; clients that reconnect within the grace window keep it alive.
  async recover() {
    for (const meta of await this.store.list()) {
      this.armExpiry(meta);
      this.armEmpty(meta.id, EMPTY_GRACE_MS + 30_000);
    }
  }

  async create(): Promise<RoomMeta> {
    let id = newCode();
    while (await this.store.get(id)) id = newCode();
    const now = Date.now();
    const meta: RoomMeta = { id, createdAt: now, expiresAt: now + ROOM_TTL_MS };
    await this.store.create(meta);
    this.armExpiry(meta);
    this.armEmpty(id, UNCLAIMED_MS);
    return meta;
  }

  private armExpiry(meta: RoomMeta) {
    if (this.expiry.has(meta.id)) return;
    const t = setTimeout(() => void this.wipe(meta.id, "expired"), Math.max(0, meta.expiresAt - Date.now()));
    this.expiry.set(meta.id, t);
  }

  private armEmpty(id: string, ms: number) {
    clearTimeout(this.empty.get(id));
    this.empty.set(id, setTimeout(() => {
      if (this.people(id).length === 0) void this.wipe(id, "empty");
    }, ms));
  }

  people(id: string): Person[] {
    const out: Person[] = [];
    for (const s of this.io.sockets.adapter.rooms.get(id) ?? []) {
      const sock = this.io.sockets.sockets.get(s) as Sock | undefined;
      if (sock?.data.name) out.push({ id: sock.id, name: sock.data.name });
    }
    return out;
  }

  async wipe(id: string, reason: WipeReason, by?: string) {
    clearTimeout(this.expiry.get(id));
    clearTimeout(this.empty.get(id));
    clearTimeout(this.padWrites.get(id));
    this.expiry.delete(id);
    this.empty.delete(id);
    this.padWrites.delete(id);
    await this.store.destroy(id);
    this.io.to(id).emit("wiped", { reason, by });
    this.io.in(id).disconnectSockets(true);
    console.log(`[room] ${id} wiped (${reason})`);
  }

  attach(socket: Sock) {
    const posts = new Bucket(10, 1);
    const pads = new Bucket(40, 20);

    socket.on("join", async ({ roomId, name }, ack) => {
      if (typeof ack !== "function") return;
      if (typeof roomId !== "string" || !ROOM_ID.test(roomId)) return ack({ ok: false, error: "not-found" });
      if (socket.data.roomId) return ack({ ok: false, error: "already-joined" });
      const room = await this.store.get(roomId);
      if (!room) return ack({ ok: false, error: "not-found" });

      socket.data.roomId = roomId;
      socket.data.name = cleanName(name);
      await socket.join(roomId);
      clearTimeout(this.empty.get(roomId));
      this.empty.delete(roomId);
      this.armExpiry(room);

      const [messages, pad] = await Promise.all([this.store.messages(roomId), this.store.pad(roomId)]);
      const people = this.people(roomId);
      ack({ ok: true, room, now: Date.now(), messages, pad, people, you: socket.id });
      socket.to(roomId).emit("people", people);
    });

    socket.on("post", async (p, ack) => {
      if (typeof ack !== "function") return;
      const roomId = socket.data.roomId;
      if (!roomId) return ack({ ok: false, error: "not-joined" });
      if (!posts.take()) return ack({ ok: false, error: "slow-down" });
      if (!p || !KINDS.includes(p.kind) || typeof p.body !== "string") return ack({ ok: false, error: "invalid" });
      const body = p.body.replace(/\s+$/, "");
      if (!body) return ack({ ok: false, error: "empty" });
      if (byteLength(body) > MAX_BODY_BYTES) return ack({ ok: false, error: "too-large" });

      const msg: Message = {
        id: randomUUID(),
        kind: p.kind,
        lang: p.kind === "snippet" && p.lang && LANGS.includes(p.lang) ? p.lang : undefined,
        title: typeof p.title === "string" && p.title.trim() ? p.title.trim().slice(0, MAX_TITLE) : undefined,
        body,
        author: socket.data.name ?? "anonymous",
        at: Date.now(),
      };
      if (!(await this.store.addMessage(roomId, msg))) return ack({ ok: false, error: "room-full" });
      this.io.to(roomId).emit("message", msg);
      ack({ ok: true });
    });

    socket.on("pad", (p) => {
      const roomId = socket.data.roomId;
      if (!roomId || !p || typeof p.text !== "string" || !pads.take()) return;
      if (byteLength(p.text) > MAX_PAD_BYTES) return;
      socket.to(roomId).emit("pad", { text: p.text, by: socket.data.name ?? "anonymous" });
      // Coalesce writes: the pad is broadcast live, persisted at most every 500ms.
      clearTimeout(this.padWrites.get(roomId));
      this.padWrites.set(roomId, setTimeout(() => {
        this.padWrites.delete(roomId);
        void this.store.setPad(roomId, p.text);
      }, 500));
    });

    socket.on("rename", ({ name }, ack) => {
      if (typeof ack !== "function") return;
      const roomId = socket.data.roomId;
      if (!roomId) return ack({ ok: false, error: "not-joined" });
      socket.data.name = cleanName(name);
      this.io.to(roomId).emit("people", this.people(roomId));
      ack({ ok: true });
    });

    socket.on("burn", async (ack) => {
      if (typeof ack !== "function") return;
      const roomId = socket.data.roomId;
      if (!roomId) return ack({ ok: false, error: "not-joined" });
      ack({ ok: true });
      await this.wipe(roomId, "burned", socket.data.name);
    });

    socket.on("disconnect", () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const people = this.people(roomId);
      this.io.to(roomId).emit("people", people);
      if (people.length === 0 && this.expiry.has(roomId)) this.armEmpty(roomId, EMPTY_GRACE_MS);
    });
  }
}
