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

/**
 * Attach the Horizon WS endpoint to an existing HTTP server.
 *
 * @param server - Node http.Server returned by app.listen()
 * @param path   - URL path the WS should listen on (default "/ws/horizon")
 */
export function attachHorizonWs(server: HttpServer, path = "/ws/horizon"): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const { pathname, query } = parseUrl(req.url || "", true);
    if (pathname !== path) return; // not ours — let other upgrade handlers run

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
        wss.emit("connection", ws, req);
      });
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Horizon WS auth failed");
      rejectUpgrade(socket, 401, "Invalid token");
    }
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const uid = (ws as any).adminUid || "unknown";
    logger.info({ uid }, "Horizon WS connected");

    ws.on("close", () => {
      logger.info({ uid }, "Horizon WS disconnected");
    });

    // Echo / keepalive for now; real event streaming will follow.
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  logger.info({ path }, "Horizon WebSocket endpoint attached");
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
