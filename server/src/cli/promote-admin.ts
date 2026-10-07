/**
 * Grants the administrator role to an existing account, e.g. the first admin of a fresh deployment
 * (later admins can be promoted from the admin panel):
 *   npm run promote-admin -w server -- you@example.com     (development)
 *   node server/dist/cli/promote-admin.js you@example.com   (production build)
 */
import { closeDatabase } from '../db/index.js';
import { SYSTEM_ACTOR } from '../services/actor.js';
import { setUserRole } from '../services/admin.service.js';
import { findUserByEmail } from '../services/user.repository.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: promote-admin <email>');
  process.exit(1);
}

try {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`No account is registered with ${email}`);
  if (user.role === 'ADMIN') {
    console.log(`${user.email} is already an administrator.`);
  } else {
    setUserRole(user.id, 'ADMIN', { ...SYSTEM_ACTOR, userAgent: 'promote-admin CLI' });
    console.log(`${user.email} is now an administrator. They need to sign in again.`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  closeDatabase();
}
