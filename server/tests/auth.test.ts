import { describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { verifyAuditChain } from '../src/services/audit.service.js';
import { DEFAULT_PASSWORD, registerClient, TestClient } from './helpers.js';

describe('registration and login', () => {
  it('registers, signs in and returns the current user', async () => {
    const { client, email } = await registerClient({ fullName: 'Asha Rao' });
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email, fullName: 'Asha Rao', role: 'USER', hasPin: false });
    expect(me.body.csrfToken).toEqual(client.csrfToken);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const { email } = await registerClient();
    const anon = new TestClient();
    const duplicate = await anon.post('/api/auth/register', {
      fullName: 'Someone',
      email: email.toUpperCase(),
      phone: '9876543210',
      password: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
    });
    expect(duplicate.status).toBe(409);

    const weak = await anon.post('/api/auth/register', {
      fullName: 'Someone',
      email: 'weak@example.com',
      phone: '9876543210',
      password: 'password',
      confirmPassword: 'password',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.fields.password).toMatch(/letter and one number/);
  });

  it('logs out and invalidates the session', async () => {
    const { client } = await registerClient();
    expect((await client.post('/api/auth/logout')).status).toBe(200);
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('uses a generic error for bad credentials and locks after five failures', async () => {
    const { email } = await registerClient();
    const anon = new TestClient();
    const unknown = await anon.post('/api/auth/login', { email: 'nobody@example.com', password: 'Whatever1' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe('Invalid email or password');

    for (let i = 0; i < 4; i++) {
      const res = await anon.post('/api/auth/login', { email, password: 'WrongPass1' });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    }
    expect((await anon.post('/api/auth/login', { email, password: 'WrongPass1' })).status).toBe(401);
    // Now locked, even with the correct password.
    const lockedRes = await anon.post('/api/auth/login', { email, password: DEFAULT_PASSWORD });
    expect(lockedRes.status).toBe(423);
  });

  it('logs in with valid credentials and creates a security notification', async () => {
    const { email } = await registerClient();
    const client = new TestClient();
    const res = await client.post('/api/auth/login', { email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/);
    const userId = res.body.user.id;
    const row = db()
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND category = 'SECURITY'")
      .get(userId) as { n: number };
    expect(row.n).toBe(1);
  });
});

describe('sessions and CSRF', () => {
  it('rejects state-changing requests without the CSRF token', async () => {
    const { client } = await registerClient();
    const token = client.csrfToken;
    client.csrfToken = null;
    const res = await client.post('/api/auth/logout');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
    client.csrfToken = token;
    expect((await client.post('/api/auth/logout')).status).toBe(200);
  });

  it('rejects cross-origin requests', async () => {
    const { client } = await registerClient();
    const res = await client.agent
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', client.csrfToken!);
    expect(res.status).toBe(403);
  });

  it('lists sessions and revokes other sessions', async () => {
    const { client, email } = await registerClient();
    const second = new TestClient();
    const login = await second.post('/api/auth/login', { email, password: DEFAULT_PASSWORD });
    second.csrfToken = login.body.csrfToken;

    const list = await client.get('/api/auth/sessions');
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const revoke = await client.post('/api/auth/sessions/revoke-others');
    expect(revoke.body.revoked).toBe(1);
    expect((await second.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(200);
  });

  it('signs out other sessions when the password changes', async () => {
    const { client, email } = await registerClient();
    const other = new TestClient();
    await other.post('/api/auth/login', { email, password: DEFAULT_PASSWORD });

    const wrong = await client.post('/api/profile/password', {
      currentPassword: 'Nope12345',
      newPassword: 'NewSecret456',
      confirmPassword: 'NewSecret456',
    });
    expect(wrong.status).toBe(400);

    const res = await client.post('/api/profile/password', {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'NewSecret456',
      confirmPassword: 'NewSecret456',
    });
    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBe(1);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(200);
  });
});

describe('audit trail', () => {
  it('records actions in an append-only hash chain', async () => {
    const { client } = await registerClient();
    const activity = await client.get('/api/profile/activity');
    expect(activity.status).toBe(200);
    expect(activity.body.items.map((i: { action: string }) => i.action)).toContain('USER_REGISTERED');

    expect(verifyAuditChain().valid).toBe(true);
    expect(() => db().prepare("UPDATE audit_logs SET action = 'X' WHERE id = 1").run()).toThrow(/append-only/);
    expect(() => db().prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
  });
});
