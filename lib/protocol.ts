// Shared between the socket server and the browser.

export const ROOM_TTL_MS = 60 * 60 * 1000;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_PAD_BYTES = 128 * 1024;
export const MAX_MESSAGES = 500;
export const MAX_NAME = 32;
export const MAX_TITLE = 80;

export type Kind = "snippet" | "log" | "note";
export const KINDS: Kind[] = ["snippet", "log", "note"];

export const LANGS = [
  "auto", "typescript", "javascript", "python", "go", "rust", "java", "c", "cpp",
  "csharp", "ruby", "php", "sql", "json", "yaml", "bash", "diff", "css", "xml", "plaintext",
] as const;
export type Lang = (typeof LANGS)[number];

export interface Message {
  id: string;
  kind: Kind;
  lang?: Lang;
  title?: string;
  body: string;
  author: string;
  at: number;
}

export interface RoomMeta {
  id: string;
  createdAt: number;
  expiresAt: number;
}

export interface Person {
  id: string;
  name: string;
}

export type WipeReason = "expired" | "empty" | "burned";

export interface JoinOk {
  ok: true;
  room: RoomMeta;
  now: number;
  messages: Message[];
  pad: string;
  people: Person[];
  you: string;
}
export interface Fail {
  ok: false;
  error: string;
}
export type JoinResult = JoinOk | Fail;
export type Ack = { ok: true } | Fail;

export interface ServerToClient {
  message: (m: Message) => void;
  people: (p: Person[]) => void;
  pad: (p: { text: string; by: string }) => void;
  wiped: (w: { reason: WipeReason; by?: string }) => void;
}

export interface ClientToServer {
  join: (p: { roomId: string; name: string }, ack: (r: JoinResult) => void) => void;
  post: (p: { kind: Kind; lang?: Lang; title?: string; body: string }, ack: (r: Ack) => void) => void;
  pad: (p: { text: string }) => void;
  rename: (p: { name: string }, ack: (r: Ack) => void) => void;
  burn: (ack: (r: Ack) => void) => void;
}

// Room codes avoid look-alike characters: no 0/o, 1/l/i.
export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const ROOM_ID = /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/;

export function normaliseRoomId(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/^.*\/r\//, "").replace(/[^a-z0-9]/g, "");
  if (raw.length !== 8) return null;
  const id = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return ROOM_ID.test(id) ? id : null;
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
