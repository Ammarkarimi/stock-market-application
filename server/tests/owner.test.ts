import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { registerClient } from './helpers.js';

// The desktop app sets FIRST_USER_IS_ADMIN so whoever installs it can use the admin panel.
const settings = config as { firstUserIsAdmin: boolean };

describe('first account on a desktop installation', () => {
  beforeAll(() => {
    settings.firstUserIsAdmin = true;
  });
  afterAll(() => {
    settings.firstUserIsAdmin = false;
  });

  it('makes the first account an admin and every later one an investor', async () => {
    const owner = await registerClient({ fullName: 'Owner Person' });
    expect(owner.user).toMatchObject({ role: 'ADMIN' });
    expect((await owner.client.get('/api/admin/overview')).status).toBe(200);
    const activity = await owner.client.get('/api/profile/activity');
    const registered = activity.body.items.find((i: { action: string }) => i.action === 'USER_REGISTERED');
    expect(registered.details).toMatchObject({ role: 'ADMIN', reason: 'First account on this installation' });

    const second = await registerClient({ fullName: 'Second Person' });
    expect(second.user).toMatchObject({ role: 'USER' });
    expect((await second.client.get('/api/admin/overview')).status).toBe(403);
  });
});
