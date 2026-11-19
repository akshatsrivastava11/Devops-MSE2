import Redis from "ioredis";
import type { Message, RoomMeta } from "../lib/protocol";
import { MAX_MESSAGES } from "../lib/protocol";

// Everything a room holds lives here, and nowhere else. Every key carries the
// room's own expiry, so even if this process dies the data cannot outlive the hour.
export interface Store {
  create(meta: RoomMeta): Promise<void>;
  get(id: string): Promise<RoomMeta | null>;
  list(): Promise<RoomMeta[]>;
  addMessage(id: string, m: Message): Promise<boolean>;
  messages(id: string): Promise<Message[]>;
  setPad(id: string, text: string): Promise<void>;
  pad(id: string): Promise<string>;
  destroy(id: string): Promise<void>;
  readonly kind: "redis" | "memory";
}

class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private rooms = new Map<string, { meta: RoomMeta; messages: Message[]; pad: string; timer: NodeJS.Timeout }>();

  async create(meta: RoomMeta) {
    const timer = setTimeout(() => this.rooms.delete(meta.id), meta.expiresAt - Date.now());
    timer.unref();
    this.rooms.set(meta.id, { meta, messages: [], pad: "", timer });
  }
  async get(id: string) {
    const r = this.rooms.get(id);
    return r && r.meta.expiresAt > Date.now() ? r.meta : null;
  }
  async list() {
    return [...this.rooms.values()].map((r) => r.meta);
  }
  async addMessage(id: string, m: Message) {
    const r = this.rooms.get(id);
    if (!r || r.messages.length >= MAX_MESSAGES) return false;
    r.messages.push(m);
    return true;
  }
  async messages(id: string) {
    return this.rooms.get(id)?.messages ?? [];
  }
  async setPad(id: string, text: string) {
    const r = this.rooms.get(id);
    if (r) r.pad = text;
  }
  async pad(id: string) {
    return this.rooms.get(id)?.pad ?? "";
  }
  async destroy(id: string) {
    const r = this.rooms.get(id);
    if (r) clearTimeout(r.timer);
    this.rooms.delete(id);
  }
}

class RedisStore implements Store {
  readonly kind = "redis" as const;
  constructor(private redis: Redis) {}

  private keys(id: string) {
    return { meta: `room:${id}`, msgs: `room:${id}:msgs`, pad: `room:${id}:pad` };
  }

  async create(meta: RoomMeta) {
    await this.redis.set(this.keys(meta.id).meta, JSON.stringify(meta), "PXAT", meta.expiresAt);
  }
  async get(id: string) {
    const raw = await this.redis.get(this.keys(id).meta);
    return raw ? (JSON.parse(raw) as RoomMeta) : null;
  }
  async list() {
    const out: RoomMeta[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", "room:????-????", "COUNT", 200);
      cursor = next;
      for (const key of keys) {
        const meta = await this.get(key.slice(5));
        if (meta) out.push(meta);
      }
    } while (cursor !== "0");
    return out;
  }
  async addMessage(id: string, m: Message) {
    const meta = await this.get(id);
    if (!meta) return false;
    const k = this.keys(id);
    if ((await this.redis.llen(k.msgs)) >= MAX_MESSAGES) return false;
    await this.redis.multi().rpush(k.msgs, JSON.stringify(m)).pexpireat(k.msgs, meta.expiresAt).exec();
    return true;
  }
  async messages(id: string) {
    const raw = await this.redis.lrange(this.keys(id).msgs, 0, -1);
    return raw.map((r) => JSON.parse(r) as Message);
  }
  async setPad(id: string, text: string) {
    const meta = await this.get(id);
    if (!meta) return;
    await this.redis.set(this.keys(id).pad, text, "PXAT", meta.expiresAt);
  }
  async pad(id: string) {
    return (await this.redis.get(this.keys(id).pad)) ?? "";
  }
  async destroy(id: string) {
    const k = this.keys(id);
    await this.redis.unlink(k.meta, k.msgs, k.pad);
  }
}

export async function createStore(): Promise<Store> {
  const url = process.env.REDIS_URL;
  if (!url) return new MemoryStore();
  const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  await redis.connect();
  return new RedisStore(redis);
}
