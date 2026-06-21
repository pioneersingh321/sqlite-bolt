export type EventHandler<T = any> = (payload: T) => void | Promise<void>;

export interface EventPayload<T = any> {
  event: string;
  table: string;
  data: T;
  timestamp: number;
}

export class BoltEvent {
  private static listeners = new Map<string, Set<EventHandler>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  static on<T>(event: string, handler: EventHandler<EventPayload<T>>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  /** Subscribe once — auto-removes after first fire. */
  static once<T>(event: string, handler: EventHandler<EventPayload<T>>): () => void {
    const wrapped: EventHandler<EventPayload<T>> = (payload) => {
      this.off(event, wrapped);
      return handler(payload);
    };
    return this.on(event, wrapped);
  }

  /** Unsubscribe a handler. */
  static off<T>(event: string, handler: EventHandler<EventPayload<T>>): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** Emit an event to all subscribers. Handlers run in parallel-ish (sequential await). */
  static async emit<T>(event: string, payload: EventPayload<T>): Promise<void> {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        await Promise.resolve(handler(payload));
      } catch (e) {
        console.error(`[BoltEvent] Error in handler for ${event}:`, e);
      }
    }
  }

  /** Count active listeners for an event. */
  static listenersCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Remove all listeners (useful in tests). */
  static clear(): void {
    this.listeners.clear();
  }
}
