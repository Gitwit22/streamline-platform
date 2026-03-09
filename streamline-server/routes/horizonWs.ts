/**
 * Horizon WebSocket handler — authenticated admin WS endpoint.
 *
 * Token sources (checked in order):
 *   1. ?token=<jwt> query parameter
 *   2. Cookie "token" (httpOnly session cookie)
 *
 * Unauthorized upgrades are rejected with a 401-style response.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { parse as parseUrl } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { verifyToken } from "../lib/verifyToken";
import { isAdmin } from "../middleware/adminAuth";
import { logger } from "../lib/logger";
import { monitoringBus } from "../lib/horizon/monitoringBus";
import type { MonitoringEvent } from "../lib/horizon/types";

/* ── Connection tracking ──────────────────────────────────────────── */

const MAX_CONNECTIONS_PER_IP = 10;
const MAX_CONNECTIONS_TOTAL = 200;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

const connectionsPerIp = new Map<string, number>();
let totalConnections = 0;

function getIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Attach the Horizon WS endpoint to an existing HTTP server.
 *
 * Supports two paths:
 *   /ws/horizon          — admin monitoring stream (live events)
 *   /ws/horizon/events   — alias for same stream
 *
 * All connections require admin JWT auth via ?token= or cookie.
 *
 * Monitoring events from the monitoringBus are broadcast to all
 * connected clients in real time. Clients can also filter by sending:
 *   { type: "subscribe", events: ["system.alert", "ticket.created"] }
 *
 * @param server - Node http.Server returned by app.listen()
 * @param basePath - URL path prefix (default "/ws/horizon")
 */
export function attachHorizonWs(server: HttpServer, basePath = "/ws/horizon"): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  const validPaths = new Set([basePath, `${basePath}/events`]);

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const { pathname, query } = parseUrl(req.url || "", true);
    if (!pathname || !validPaths.has(pathname)) return; // not ours

    const ip = getIp(req);

    // ── Connection limits ──
    if (totalConnections >= MAX_CONNECTIONS_TOTAL) {
      rejectUpgrade(socket, 429, "Too many connections");
      return;
    }
    const ipCount = connectionsPerIp.get(ip) || 0;
    if (ipCount >= MAX_CONNECTIONS_PER_IP) {
      rejectUpgrade(socket, 429, "Too many connections from this IP");
      return;
    }

    try {
      // 1. Extract token from query param
      let raw: string | undefined;
      if (typeof query.token === "string" && query.token.length > 0) {
        raw = query.token;
      }

      // 2. Fallback: parse cookie header
      if (!raw) {
        const cookieHeader = req.headers.cookie || "";
        const cookies = parseCookies(cookieHeader);
        raw = cookies.token;
      }

      if (!raw) {
        rejectUpgrade(socket, 401, "Missing token");
        return;
      }

      const payload = verifyToken(raw);

      // Verify admin status
      const admin = await isAdmin(payload.uid);
      if (!admin) {
        rejectUpgrade(socket, 403, "Admin privileges required");
        return;
      }

      // Upgrade accepted
      wss.handleUpgrade(req, socket as any, head, (ws) => {
        (ws as any).adminUid = payload.uid;
        (ws as any).ip = ip;
        (ws as any).subscribedEvents = null; // null = all events
        (ws as any).isAlive = true;
        wss.emit("connection", ws, req);
      });
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Horizon WS auth failed");
      rejectUpgrade(socket, 401, "Invalid token");
    }
  });

  // ── Connection handler ──
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const uid = (ws as any).adminUid || "unknown";
    const ip = (ws as any).ip || "unknown";

    // Track connections
    totalConnections++;
    connectionsPerIp.set(ip, (connectionsPerIp.get(ip) || 0) + 1);

    logger.info({ uid, ip, total: totalConnections }, "Horizon WS connected");

    // ── Monitoring event relay ──
    const onEvent = (event: MonitoringEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      // If client subscribed to specific events, filter
      const filter = (ws as any).subscribedEvents as Set<string> | null;
      if (filter && !filter.has(event.type)) return;

      try {
        ws.send(JSON.stringify(event));
      } catch {
        // connection dying, will be cleaned up
      }
    };
    monitoringBus.on("event", onEvent);

    // ── Client messages ──
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));

        // Ping/pong keepalive
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
          return;
        }

        // Subscribe to specific event types
        if (msg.type === "subscribe" && Array.isArray(msg.events)) {
          (ws as any).subscribedEvents = new Set(msg.events);
          ws.send(
            JSON.stringify({
              type: "subscribed",
              events: msg.events,
              ts: Date.now(),
            })
          );
          return;
        }

        // Unsubscribe (receive all events again)
        if (msg.type === "unsubscribe") {
          (ws as any).subscribedEvents = null;
          ws.send(
            JSON.stringify({ type: "unsubscribed", ts: Date.now() })
          );
          return;
        }
      } catch {
        // ignore malformed messages
      }
    });

    // ── Heartbeat (server-side pong tracking) ──
    ws.on("pong", () => {
      (ws as any).isAlive = true;
    });

    // ── Cleanup ──
    ws.on("close", () => {
      monitoringBus.off("event", onEvent);
      totalConnections = Math.max(0, totalConnections - 1);
      const cur = connectionsPerIp.get(ip) || 1;
      if (cur <= 1) connectionsPerIp.delete(ip);
      else connectionsPerIp.set(ip, cur - 1);

      logger.info({ uid, total: totalConnections }, "Horizon WS disconnected");
    });

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: "connected",
        ts: Date.now(),
        message: "Horizon monitoring stream active",
      })
    );
  });

  // ── Server-side heartbeat sweep ──
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!(ws as any).isAlive) {
        logger.warn({ uid: (ws as any).adminUid }, "Horizon WS client unresponsive — terminating");
        ws.terminate();
        continue;
      }
      (ws as any).isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  logger.info({ basePath }, "Horizon WebSocket endpoint attached (with monitoring stream)");
  return wss;
}

// ── Helpers ────────────────────────────────────────────────────────────

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

function rejectUpgrade(socket: any, code: number, reason: string): void {
  const body = JSON.stringify({ error: reason });
  socket.write(
    `HTTP/1.1 ${code} ${reason}\r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n" +
      "\r\n" +
      body
  );
  socket.destroy();
}
