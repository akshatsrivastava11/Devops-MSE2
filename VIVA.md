# Burnroom viva notes

Burnroom is a Next.js 16 app for disposable developer rooms. There's no sign-up, snippets, logs and notes are shared live, and a room is wiped after 1 hour, 15 s after the last person leaves, or when someone burns it.

## At a glance

```
                         ┌──────────────── docker-compose (DevOps) ─────────────────┐
┌──────────────────┐     │ ┌──── app container, Node 22 ─────┐  ┌─ redis container ─┐ │
│ Browser          │     │ │ (Backend code, DevOps image)    │  │ redis:7.4-alpine  │ │
│ (Frontend)       │HTTP │ │ ┌─────────────────────────────┐ │  │                   │ │
│                  ├─────┼─┼─► Next.js handler             │ │  │ room:<id>  JSON   │ │
│ Entry page /     │     │ │ │ renders / and /r/[id]       │ │  │ room:<id>:msgs    │ │
│ Room page        │fetch│ │ ├─────────────────────────────┤ │  │ room:<id>:pad     │ │
│   /r/[id]        ├─────┼─┼─► server/index.ts             │ │  │                   │ │
│ socket.io-client │     │ │ │ POST /api/rooms, /api/health│ │  │ every key expires │ │
│ highlight.js     │sock │ │ ├─────────────────────────────┤ │  │ at the hour (PXAT)│ │
│ name in          ├─────┼─┼─► Socket.IO + Rooms         ──┼─┼──► no disk, no      │ │
│   localStorage   │     │ │ │ presence, timers, wipe      │ │  │ volume            │ │
└──────────────────┘     │ │ └─────────────────────────────┘ │  └───────────────────┘ │
                         │ └─────────────────────────────────┘                        │
                         └────────────────────────────────────────────────────────────┘
```

The browser talks to one Node process in three ways: page loads, one `fetch` to create a room, and a socket that stays open. Only the Socket.IO side reads and writes Redis, through `ioredis`.

| Role | Owns |
| --- | --- |
| Frontend | everything in the browser box |
| Backend | the code inside the app container |
| DevOps | the Docker image and the compose stack around both containers |

---

## Frontend

The frontend uses the Next.js 16 App Router with React 19 and TypeScript. There are two real screens: the entry page `/` and the room page `/r/[id]`. All live data comes over one Socket.IO connection. The only HTTP call is `POST /api/rooms`.

### Files

| File | What it does |
| --- | --- |
| `app/layout.tsx` | Root layout. Loads Host Grotesk and Atkinson Hyperlegible Mono with `next/font/google`, sets title, description and `robots: noindex` |
| `app/page.tsx` | Entry page (server component): headline, the "What the server keeps" panel with the 60:00 clock, and the three wipe rules |
| `components/EntryActions.tsx` | Client component: the "Open a room" button (calls `POST /api/rooms`, then `router.push`) and the join-by-code form with validation |
| `app/r/[id]/page.tsx` | Room route. Reads the `id` param, sets the tab title, renders `<Room>` |
| `components/Room.tsx` | Room screen: socket connection, join, top bar, tabs, feed, composer, scratchpad, people, burn dialog, and the gone / wiped / error screens |
| `components/Entry.tsx` | One feed entry: author, kind chip, time, copy button, highlighted code with line numbers, error-line marking for logs, diff colouring, collapse past 18 lines |
| `components/Wordmark.tsx` | Logo and name, links home |
| `app/not-found.tsx` | 404 page |
| `lib/highlight.ts` | highlight.js wrapper: registers 19 languages, auto-detects, splits the highlighted HTML into one string per line |
| `lib/handle.ts` | Random name like `quiet-heron`, saved in `localStorage` |
| `lib/protocol.ts` | Shared with the backend: event types, limits, room-code format, `normaliseRoomId()` |
| `app/globals.css` | All component styles |
| `app/tokens.css` | Design tokens: colours (oklch), spacing scale, type scale, motion durations, z-index |
| `app/base.css` | Base rules: box-sizing, focus ring, reduced-motion fallback, overflow handling |

### Modules

| Package | Used for |
| --- | --- |
| `next` 16 | Routing, server components, font loading, production build (Turbopack) |
| `react` / `react-dom` 19 | UI. Hooks: `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`, `memo` |
| `socket.io-client` 4.8 | WebSocket connection with automatic reconnect and fallback to long-polling |
| `highlight.js` 11 | Syntax highlighting (core build plus selected languages, to keep the bundle small) |

### Screens and states

- **Entry:** create a room, or paste a code or a full link (`k7mp-x9qa` or `…/r/k7mp-x9qa`).
- **Room top bar:** the room code, a copy-link button, the people present (amber chips) and a live countdown ("52:14 until wipe") that turns red under 5 minutes.
- **Feed tab:** entries of kind snippet, log or note. It auto-scrolls to the newest entry if you're already at the bottom.
- **Composer:** kind switch, language picker (snippets), optional title, Ctrl/Cmd + Enter to post, and a size counter as you near 64 KB.
- **Scratchpad tab:** one shared textarea that everyone edits live. Your cursor stays in place when someone else types.
- **People panel:** the people list, rename, the room's wipe times, and "Burn this room now" behind a confirm `<dialog>`. On phones it moves into a third tab.
- **Other states:** loading skeleton, empty feed, connection-lost banner, room gone, room wiped (with the reason) and join error.

### Design decisions

- Dark "lab instrument" theme: graphite in three lightness steps, 1px hairline panels, no shadows or gradients.
- Colour has meaning: **amber = a person** (names, the primary button), **blue = a machine reading** (times, the countdown). Red and green are only for errors and diffs.
- Two fonts: Host Grotesk for reading, and a mono font only for what the system wrote (code, times, room codes).
- Every colour and font goes through a CSS variable in `tokens.css`. Components contain no hard-coded values.
- Accessibility:
  - visible focus rings
  - `role="tablist"`/`tab` on the tabs
  - `role="log"` with `aria-live` on the feed, `role="timer"` on the countdown
  - a label on every input
  - field borders at 3:1 contrast
  - `prefers-reduced-motion` respected
- Tab state lives in the URL (`?tab=pad`), so a refresh keeps your place.

### How it talks to the backend

1. `POST /api/rooms` returns `{ id, createdAt, expiresAt }`.
2. The room page opens a socket and emits `join` with the room id and the saved name.
3. The server replies with the room, existing messages, scratchpad text, people and the server's time. The client stores the difference between server and client clocks, so the countdown is right even if the laptop clock is off.
4. After that the client listens for `message`, `people`, `pad` and `wiped`, and sends `post`, `pad`, `rename` and `burn`.
5. On reconnect it re-joins automatically and reloads the full list.

---

## Backend

The backend is a custom Node.js HTTP server, written in TypeScript. It runs Next.js, Socket.IO and the room logic in one process. Room data lives in Redis, or in an in-memory store when `REDIS_URL` isn't set. A custom server is needed because Next.js API routes can't hold long-lived WebSocket connections or timers.

### Files

| File | What it does |
| --- | --- |
| `server/index.ts` | Entry point. Creates the HTTP server, starts Next.js (`next({ dev })`), attaches Socket.IO, handles `POST /api/rooms` (rate-limited per IP) and `GET /api/health`, and passes everything else to Next. Shuts down cleanly on SIGTERM/SIGINT |
| `server/rooms.ts` | `Rooms` class: creates room codes, runs the expiry and empty-room timers, tracks who is present, validates and rate-limits every socket event, and `wipe()` |
| `server/store.ts` | `Store` interface with two implementations, `RedisStore` and `MemoryStore`. `createStore()` picks one based on `REDIS_URL` |
| `lib/protocol.ts` | Shared types (`Message`, `RoomMeta`, `Person`, event maps), limits and the room-code regex |

### Modules

| Package | Used for |
| --- | --- |
| `node:http` | The HTTP server everything attaches to |
| `node:crypto` | `randomBytes` for room codes, `randomUUID` for message ids |
| `next` | `next()` and `getRequestHandler()` to serve pages; `getUpgradeHandler()` for hot reload in dev |
| `socket.io` 4.8 | Real-time rooms: `socket.join(roomId)`, `io.to(room).emit`, `disconnectSockets` |
| `ioredis` 5 | Redis client: `SET … PXAT`, `RPUSH`, `LRANGE`, `PEXPIREAT`, `SCAN`, `UNLINK`, `MULTI` |
| `tsx` (dev) | Runs the TypeScript server directly, in watch mode |
| `esbuild` (dev) | Bundles `server/index.ts` into `dist/server.js` for production |

### Socket events

| Direction | Event | Payload | What happens |
| --- | --- | --- | --- |
| client → server | `join` | `{ roomId, name }` | Checks the room exists, joins the socket.io room, cancels the empty-room timer, replies with room, messages, pad, people and server time |
| client → server | `post` | `{ kind, lang?, title?, body }` | Validates kind and size, applies the rate limit, stores the message, broadcasts `message` |
| client → server | `pad` | `{ text }` | Broadcasts to the others at once; saves to the store at most every 500 ms |
| client → server | `rename` | `{ name }` | Updates the name, broadcasts `people` |
| client → server | `burn` | none | Wipes the room for everyone |
| server → client | `message` / `people` / `pad` | the new data | Live updates |
| server → client | `wiped` | `{ reason, by? }` | The room was deleted; the server then disconnects the sockets |

### Room lifecycle and wipe rules

1. **Create:** `POST /api/rooms` makes an 8-character code like `k7mp-x9qa`. The alphabet leaves out 0/o/1/l/i. It stores `RoomMeta` with `expiresAt = now + 1 h` and starts two timers: the 1-hour expiry and a 2-minute "nobody ever joined" timer.
2. **1 hour:** the expiry timer calls `wipe(id, "expired")`. As a second safety net, every Redis key is written with `PXAT expiresAt`, so Redis deletes it on its own even if the Node process has died.
3. **Everyone left:** on each `disconnect`, if the room has no sockets left, a 15 s grace timer starts (`EMPTY_GRACE_MS`). If anyone re-joins, the timer is cancelled; otherwise the server calls `wipe(id, "empty")`. The grace period stops a page refresh from destroying the room.
4. **Burn:** any member can send `burn`, which calls `wipe(id, "burned", name)`.
5. **What `wipe()` does:** clears the timers, deletes the three keys (`UNLINK`), emits `wiped` to the room and disconnects its sockets.
6. **Restart recovery:** on startup, `recover()` scans Redis for rooms that survived, re-arms their expiry and treats them as empty. They vanish unless someone reconnects.

### Redis keys (per room)

| Key | Type | Holds |
| --- | --- | --- |
| `room:<id>` | string (JSON) | `{ id, createdAt, expiresAt }` |
| `room:<id>:msgs` | list | One JSON message per entry |
| `room:<id>:pad` | string | Scratchpad text |

All three expire at the room's `expiresAt`.

### Limits and validation

- 64 KB per entry, 500 entries per room, 128 KB scratchpad, 32-character names, 80-character titles.
- Token bucket per socket: posts allow a burst of 10 and refill at 1 per second; pad edits allow a burst of 40 and refill at 20 per second.
- 10 rooms per IP per minute (`CREATE_LIMIT_PER_MIN`). IPs are kept only in memory, for 60 s.
- Socket.IO `maxHttpBufferSize` is 256 KB, so oversized frames are dropped before they reach a handler.
- Every incoming field is type-checked, and unknown kinds and languages are rejected.
- Code HTML comes only from highlight.js or an escaper, so a pasted `<script>` shows as text.

---

## DevOps

The app ships as one Docker image, and `docker compose up --build` runs it next to a Redis container. Redis is configured to never write to disk, so room data only ever exists in RAM.

> Status: the compose stack hasn't been run yet, because the Docker daemon was off on the dev machine. The app itself was tested with `npm run build && npm start`. Run `docker compose up --build` once before the viva.

### Files

| File | What it does |
| --- | --- |
| `Dockerfile` | Three-stage build on `node:22-alpine`: deps → build → run |
| `docker-compose.yml` | Two services, `app` and `redis`, with health checks and a restart policy |
| `.dockerignore` | Keeps `node_modules`, `.next`, `dist`, `.git` and `.env*` out of the build context |
| `package.json` | Scripts: `dev`, `build`, `build:server`, `start`, `typecheck` |
| `package-lock.json` | Pinned versions, so `npm ci` is reproducible |
| `next.config.mjs` | `reactStrictMode`, `poweredByHeader: false`. Plain JS, so production doesn't need TypeScript |
| `tsconfig.json` | TypeScript settings and the `@/*` path alias |
| `README.md` | Run instructions, limits, scaling note |

### Dockerfile stages

1. **deps:** copy `package.json` and the lockfile, then run `npm ci` with a BuildKit cache mount for `~/.npm`. Copying only these two files first means the dependency layer is reused when only source code changes.
2. **build:** copy the source and run `npm run build`. That does the Next.js build, and esbuild bundles the server into `dist/server.js`. Then run `npm prune --omit=dev` and delete `.next/cache`.
3. **run:**
   - starts from a fresh `node:22-alpine` with `NODE_ENV=production`
   - runs as a non-root `app` user
   - copies only `package.json`, `next.config.mjs`, `node_modules`, `.next` and `dist`
   - `EXPOSE 3000`, a `HEALTHCHECK` that `wget`s `/api/health`, and `CMD ["node", "dist/server.js"]`

### docker-compose services

| Service | Image | Key settings |
| --- | --- | --- |
| `app` | built from `Dockerfile` (`burnroom:latest`) | Port `${PORT:-3000}:3000`, `REDIS_URL=redis://redis:6379`, waits for Redis to be healthy, `no-new-privileges` |
| `redis` | `redis:7.4-alpine` | `--save ""` and `--appendonly no` (no disk persistence), no volume, `--maxmemory 256mb`, `--maxmemory-policy volatile-ttl`, read-only filesystem with `/data` on tmpfs, `redis-cli ping` health check |

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `HOSTNAME_BIND` | `0.0.0.0` | Bind address (Docker sets its own `HOSTNAME`, so we don't reuse that name) |
| `NODE_ENV` | `production` in the image | Dev vs production Next.js |
| `REDIS_URL` | unset = in-memory store | Redis connection |
| `EMPTY_GRACE_MS` | `15000` | How long an empty room survives |
| `UNCLAIMED_MS` | `120000` | How long a room nobody joined survives |
| `CREATE_LIMIT_PER_MIN` | `10` | Rooms per IP per minute |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy, so `X-Forwarded-For` is read |
| `CORS_ORIGIN` | unset | Allow sockets from another origin |

### Commands

```bash
docker compose up --build        # build and run everything on http://localhost:3000
docker compose logs -f app       # watch wipe events, e.g. "[room] k7mp-x9qa wiped (empty)"
docker compose down              # stop; with no volume, all room data is gone
npm run dev                      # local dev with hot reload, in-memory store
curl localhost:3000/api/health   # {"ok":true,"store":"redis"}
```

### Scaling and production notes

- Run **one app replica**. Presence and wipe timers live in the Node process. More replicas would need `@socket.io/redis-adapter`, sticky sessions at the load balancer, and presence moved into Redis.
- Behind Nginx or Traefik, forward the WebSocket upgrade headers on `/socket.io/` and set `TRUST_PROXY=1`.
- With `volatile-ttl`, a full Redis evicts the keys closest to expiry first. Every key has a TTL, so nothing permanent can be evicted.
- Fonts are downloaded from Google at build time, so the build needs internet access.

---

## Likely viva questions

### Frontend

- **Why Socket.IO and not polling or plain WebSockets?** Updates arrive instantly, it reconnects automatically, and it falls back to long-polling on networks that block WebSockets.
- **How does the countdown stay correct?** The server sends its time on join. The client stores the difference and counts down to `expiresAt` using it.
- **How is pasted HTML stopped from running?** Code is rendered only after highlight.js or our escaper has turned `<` and `&` into entities, so it can never become real tags.
- **Why both server and client components?** The entry page is static and renders on the server. Anything with state, sockets or `localStorage` is a `"use client"` component.
- **Where is the user's identity?** Only a random name in `localStorage`. There are no accounts or cookies.

### Backend

- **Why a custom server instead of API routes?** API routes are request/response and can run serverless. Sockets and wipe timers need one long-running process.
- **What if the server crashes mid-hour?** Redis still deletes every key at `expiresAt`. On restart, `recover()` re-arms the timers, and rooms nobody reconnects to are wiped.
- **Why the 15 s grace period?** A refresh disconnects and reconnects. Without a grace period it would wipe the room.
- **How is abuse limited?** Per-IP limits on room creation, per-socket token buckets, size caps, a maximum of 500 entries and strict input checks.
- **Why is there a memory store as well?** It lets local development work without Redis, behind the same `Store` interface.

### DevOps

- **Why multi-stage?** The final image has no compilers, dev dependencies or source. It's smaller, and there's less in it to attack.
- **Why a non-root user?** If the app is compromised, the attacker doesn't get root in the container.
- **How do you prove data isn't kept?** Redis has RDB and AOF off and no volume, so `docker compose down` leaves nothing behind.
- **How would you scale it?** Use the Redis adapter for Socket.IO, sticky sessions, and keep presence and timers in Redis (for example, keyspace notifications on expiry).
- **How do you know it's healthy?** A Docker `HEALTHCHECK` on `/api/health` for the app and `redis-cli ping` for Redis. Compose starts the app only after Redis is healthy.
