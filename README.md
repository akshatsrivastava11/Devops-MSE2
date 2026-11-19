# Burnroom

Disposable rooms for sharing code snippets, logs and debugging notes in real time. No sign-up.

A room is wiped, from memory and from Redis, when the first of these happens:

1. **One hour passes** after it opens. A server timer wipes it, and every Redis key also carries the room's expiry (`PXAT`), so data cannot outlive the hour even if the app crashes.
2. **Everyone leaves.** Once the last socket disconnects, a 15 s grace period starts (`EMPTY_GRACE_MS`) so a page refresh doesn't destroy the room. A room nobody ever joins is wiped after 2 minutes.
3. **Someone presses "Burn this room now"** (after a confirm dialog).

## Run with Docker

```bash
docker compose up --build
# http://localhost:3000
```

This starts two containers:

- `app`: Next.js plus a Socket.IO server in one Node process (`Dockerfile`, multi-stage, runs as a non-root user)
- `redis`: Redis 7 with RDB, AOF and volumes all turned off, so room data only ever lives in RAM

## Run locally without Docker

```bash
npm install
npm run dev            # http://localhost:3000, in-memory store
REDIS_URL=redis://localhost:6379 npm run dev   # use Redis instead
npm run build && npm start                      # production
```

If `REDIS_URL` isn't set, the server uses an in-memory store with the same expiry rules.

## Layout

| Path | What it does |
| --- | --- |
| `server/index.ts` | HTTP server: `POST /api/rooms`, `/api/health`, Socket.IO, and Next.js for everything else |
| `server/rooms.ts` | Room lifecycle: expiry timers, presence, empty-room grace period, rate limits, validation |
| `server/store.ts` | `RedisStore` and `MemoryStore` behind one interface |
| `lib/protocol.ts` | Socket event types and limits shared by server and client |
| `components/Room.tsx` | Room screen: feed, composer, shared scratchpad, people, countdown |
| `components/Entry.tsx` | One feed entry: syntax highlighting, log error lines, diff rows |

## Limits

64 KB per entry, 500 entries per room, 128 KB scratchpad, 10 posts in a burst per connection, 10 rooms per IP per minute (`CREATE_LIMIT_PER_MIN`). Set `TRUST_PROXY=1` behind a reverse proxy so rate limits use `X-Forwarded-For`.

## Scaling note

Presence and wipe timers live in the Node process, so run **one app replica**. Running more than one would need the Socket.IO Redis adapter, sticky sessions, and presence kept in Redis.
