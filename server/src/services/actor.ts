import type { Request } from 'express';

export type ActorRole = 'USER' | 'ADMIN' | 'SYSTEM' | 'ANONYMOUS';

/** Who performed an action, carried into services for authorization-free auditing. */
export interface Actor {
  userId: number | null;
  role: ActorRole;
  ip?: string | null;
  userAgent?: string | null;
}

export const SYSTEM_ACTOR: Actor = { userId: null, role: 'SYSTEM' };

export function actorFrom(req: Request): Actor {
  const user = req.auth?.user;
  return {
    userId: user?.id ?? null,
    role: user ? (user.role === 'ADMIN' ? 'ADMIN' : 'USER') : 'ANONYMOUS',
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}
