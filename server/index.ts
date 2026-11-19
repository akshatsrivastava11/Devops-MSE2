import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import next from "next";
import { Server } from "socket.io";
import type { ClientToServer, ServerToClient } from "../lib/protocol";
import { Rooms } from "./rooms";
import { createStore } from "./store";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME_BIND ?? "0.0.0.0";

// Room creation is the only unauthenticated write; cap it per address.
const CREATE_LIMIT = Number(process.env.CREATE_LIMIT_PER_MIN ?? 10);
const creates = new Map<string, number[]>();
function allowCreate(ip: string) {
  const now = Date.now();
  const recent = (creates.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= CREATE_LIMIT) return false;
  recent.push(now);
  creates.set(ip, recent);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of creates) if (ts.every((t) => now - t >= 60_000)) creates.delete(ip);
}, 60_000).unref();

function clientIp(req: IncomingMessage) {
  const fwd = process.env.TRUST_PROXY === "1" ? req.headers["x-forwarded-for"] : undefined;
  return (typeof fwd === "string" ? fwd.split(",")[0].trim() : undefined) ?? req.socket.remoteAddress ?? "unknown";
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const store = await createStore();
  const server = createServer();
  const io = new Server<ClientToServer, ServerToClient>(server, {
    maxHttpBufferSize: 256 * 1024,
    // Leave other upgrade requests (Next's dev HMR socket) alone.
    destroyUpgrade: false,
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : undefined,
  });
  const rooms = new Rooms(io, store);
  await rooms.recover();
  io.on("connection", (s) => rooms.attach(s));

  server.on("request", async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/api/rooms" && req.method === "POST") {
      if (!allowCreate(clientIp(req))) return json(res, 429, { error: "slow-down" });
      try {
        return json(res, 201, await rooms.create());
      } catch (err) {
        console.error(err);
        return json(res, 500, { error: "store-unavailable" });
      }
    }
    if (url === "/api/health") return json(res, 200, { ok: true, store: store.kind });
    if (url.startsWith("/socket.io")) return; // socket.io answers these itself
    handle(req, res);
  });

  if (dev) {
    const upgrade = app.getUpgradeHandler();
    server.on("upgrade", (req, socket, head) => {
      if (!req.url?.startsWith("/socket.io")) void upgrade(req, socket, head);
    });
  }

  server.listen(port, hostname, () => {
    console.log(`> burnroom on http://${hostname}:${port} (${dev ? "dev" : "prod"}, store: ${store.kind})`);
  });

  const shutdown = () => {
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
