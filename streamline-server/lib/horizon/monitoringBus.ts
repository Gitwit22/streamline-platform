/**
 * Horizon Monitoring Event Bus — typed EventEmitter for real-time
 * monitoring events streamed to WebSocket clients.
 *
 * Event types:
 *   system.alert   — threshold alerts, system warnings
 *   system.log     — structured log events
 *   agent.error    — agent failures or exceptions
 *   service.health — periodic health snapshots
 *   ticket.created — new ticket filed
 *   ticket.updated — ticket status/severity change
 *   agent.status   — agent heartbeat status change
 */
import { EventEmitter } from "node:events";
import type { MonitoringEvent, MonitoringEventType } from "./types";

class MonitoringBus extends EventEmitter {
  /**
   * Emit a typed monitoring event to all WS listeners.
   */
  publish(event: MonitoringEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }

  /**
   * Convenience: build and publish in one call.
   */
  send(
    type: MonitoringEventType,
    source: string,
    payload: Record<string, unknown> = {}
  ): void {
    this.publish({
      type,
      ts: new Date().toISOString(),
      source,
      payload,
    });
  }
}

/**
 * Singleton monitoring bus. Import this from any module to publish
 * events that flow to the Horizon WebSocket stream.
 */
export const monitoringBus = new MonitoringBus();

// Prevent memory leak warnings for many WS listener subscriptions
monitoringBus.setMaxListeners(200);
