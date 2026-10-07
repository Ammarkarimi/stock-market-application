import { EventEmitter } from 'node:events';

export type UserEventType =
  | 'notification'
  | 'order'
  | 'funds'
  | 'portfolio'
  | 'ipo'
  | 'alert'
  | 'watchlist';

export interface UserEvent {
  type: UserEventType;
  payload?: unknown;
}

/** In-process pub/sub that feeds the Server-Sent Events stream. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitToUser(userId: number, type: UserEventType, payload?: unknown): void {
  bus.emit(`user:${userId}`, { type, payload } satisfies UserEvent);
}

export function emitSessionRevoked(sessionId: string): void {
  bus.emit('session-revoked', sessionId);
}

export function emitBroadcast(type: string, payload?: unknown): void {
  bus.emit('broadcast', { type, payload });
}
