import { EventEmitter } from "node:events";
import type { AppEvent, LogLevel } from "./types.js";

export class EventLog {
  private readonly maxEvents = 500;
  private readonly emitter = new EventEmitter();
  private events: AppEvent[] = [];

  append(level: LogLevel, source: string, message: string, data?: unknown): AppEvent {
    const event: AppEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      time: new Date().toISOString(),
      level,
      source,
      message,
      data
    };
    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.emitter.emit("event", event);
    return event;
  }

  list(limit = 100): AppEvent[] {
    return this.events.slice(0, Math.max(1, Math.min(limit, this.maxEvents)));
  }

  onEvent(listener: (event: AppEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
