import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';

let app: Express | null = null;

export function getApp(): Express {
  app ??= createApp();
  return app;
}

/** Cookie-keeping HTTP client that sends the CSRF token on state-changing requests. */
export class TestClient {
  readonly agent = request.agent(getApp());
  csrfToken: string | null = null;

  get(path: string) {
    return this.agent.get(path);
  }

  private withCsrf(req: request.Test, body?: unknown) {
    if (this.csrfToken) req.set('X-CSRF-Token', this.csrfToken);
    return body === undefined ? req : req.send(body as object);
  }

  post(path: string, body?: unknown) {
    return this.withCsrf(this.agent.post(path), body);
  }

  patch(path: string, body?: unknown) {
    return this.withCsrf(this.agent.patch(path), body);
  }

  put(path: string, body?: unknown) {
    return this.withCsrf(this.agent.put(path), body);
  }

  delete(path: string) {
    return this.withCsrf(this.agent.delete(path));
  }
}

let counter = 0;

export const DEFAULT_PASSWORD = 'Secret123';
export const DEFAULT_PIN = '2468';

export async function registerClient(overrides: Partial<{ fullName: string; email: string; phone: string }> = {}) {
  const client = new TestClient();
  counter++;
  const email = overrides.email ?? `user${counter}-${Date.now()}@example.com`;
  const res = await client.post('/api/auth/register', {
    fullName: overrides.fullName ?? `Test User ${counter}`,
    email,
    phone: overrides.phone ?? '9876543210',
    password: DEFAULT_PASSWORD,
    confirmPassword: DEFAULT_PASSWORD,
  });
  if (res.status !== 201) throw new Error(`Registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  client.csrfToken = res.body.csrfToken;
  return { client, user: res.body.user as { id: number; email: string }, email };
}

/** Registers a user and sets a transaction PIN. */
export async function registerWithPin() {
  const result = await registerClient();
  const res = await result.client.post('/api/profile/pin', { password: DEFAULT_PASSWORD, pin: DEFAULT_PIN, confirmPin: DEFAULT_PIN });
  if (res.status !== 200) throw new Error(`Setting PIN failed: ${JSON.stringify(res.body)}`);
  return result;
}
