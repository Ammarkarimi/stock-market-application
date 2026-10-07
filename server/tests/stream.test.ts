import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction } from '../src/db/index.js';
import { bus } from '../src/services/events.js';
import { notify } from '../src/services/notification.service.js';
import { revokeUserSessions } from '../src/services/session.service.js';
import { DEFAULT_PASSWORD, getApp } from './helpers.js';
import { setupMarket } from './setup-market.js';

// The event stream needs a real socket (supertest buffers whole responses), so these tests listen on a port.
let server: Server;
let base: string;

beforeAll(async () => {
  setupMarket();
  server = getApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function signUp(): Promise<{ cookie: string; userId: number }> {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Stream Tester',
      email: `stream-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      phone: '9876501234',
      password: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user: { id: number } };
  return { cookie: res.headers.getSetCookie()[0]!.split(';')[0]!, userId: body.user.id };
}

async function openStream(cookie: string) {
  const res = await fetch(`${base}/api/stream`, { headers: { cookie } });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  /** Reads until the text contains `marker`, or to the end of the stream when no marker is given. */
  const read = async (marker?: string) => {
    while (!marker || !text.includes(marker)) {
      const { value, done } = await reader.read();
      if (done) return { text, ended: true };
      text += decoder.decode(value, { stream: true });
    }
    return { text, ended: false };
  };
  return { res, read, cancel: () => reader.cancel() };
}

describe('GET /api/stream', () => {
  it('requires a session', async () => {
    const res = await fetch(`${base}/api/stream`);
    expect(res.status).toBe(401);
  });

  it('starts with a snapshot of every quote', async () => {
    const { cookie } = await signUp();
    const stream = await openStream(cookie);
    expect(stream.res.headers.get('content-type')).toContain('text/event-stream');
    const { text } = await stream.read('event: snapshot');
    const data = JSON.parse(text.split('event: snapshot\ndata: ')[1]!.split('\n')[0]!) as { quotes: unknown[] };
    expect(data.quotes.length).toBeGreaterThan(10);
    await stream.cancel();
  });

  it('ends when the session is revoked, ignoring events emitted afterwards', async () => {
    const { cookie, userId } = await signUp();
    const listenersBefore = bus.listenerCount('session-revoked');
    const stream = await openStream(cookie);
    await stream.read('event: snapshot');
    expect(bus.listenerCount('session-revoked')).toBe(listenersBefore + 1);

    // What suspending a user does: revoke their sessions and notify them in the same transaction.
    transaction(() => {
      revokeUserSessions(userId, 'SUSPENDED');
      notify(userId, 'SECURITY', 'Account suspended', 'Your account has been suspended.');
    });

    const { text, ended } = await stream.read();
    expect(ended).toBe(true);
    expect(text).toContain('event: session-revoked');
    expect(text).not.toContain('event: notification');
    expect(bus.listenerCount('session-revoked')).toBe(listenersBefore);
  });
});
