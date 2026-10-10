import { EventEmitter } from 'node:events';

// In-process pub/sub for Server-Sent Events. Payloads carry only an event type
// and record id - never clinical data - so broadcasting to every signed-in
// client is safe; clients refetch through the normal access-controlled API.
// For multiple app instances, swap this for Postgres LISTEN/NOTIFY or Redis.
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(type, data = {}) {
  bus.emit('change', { type, ...data, at: new Date().toISOString() });
}
