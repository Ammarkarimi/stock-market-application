import { all, get, run } from '../db/index.js';
import { nowIso } from '../lib/clock.js';
import { sha256 } from '../lib/crypto.js';
import { istDayEndIso, istDayStartIso } from '../lib/time.js';
import { pageOf, type Page } from '../lib/validation.js';
import type { Actor } from './actor.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  actor: Actor;
  action: string;
  /** The user whose account the action concerns (defaults to the actor). */
  subjectUserId?: number | null;
  entityType?: string;
  entityId?: string | number | null;
  details?: Record<string, unknown>;
}

interface AuditRow {
  id: number;
  actor_id: number | null;
  actor_role: string;
  subject_user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  prev_hash: string;
  hash: string;
}

type HashedFields = Omit<AuditRow, 'id' | 'hash'>;

function computeHash(row: HashedFields): string {
  return sha256(
    JSON.stringify([
      row.prev_hash,
      row.actor_id,
      row.actor_role,
      row.subject_user_id,
      row.action,
      row.entity_type,
      row.entity_id,
      row.details,
      row.ip,
      row.user_agent,
      row.created_at,
    ]),
  );
}

/** Appends an entry to the hash-chained audit trail. */
export function audit(input: AuditInput): void {
  const previous = get<{ hash: string }>('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
  const row: HashedFields = {
    actor_id: input.actor.userId,
    actor_role: input.actor.role,
    subject_user_id: input.subjectUserId === undefined ? input.actor.userId : input.subjectUserId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
    details: input.details ? JSON.stringify(input.details) : null,
    ip: input.actor.ip ?? null,
    user_agent: input.actor.userAgent ?? null,
    created_at: nowIso(),
    prev_hash: previous?.hash ?? GENESIS_HASH,
  };
  run(
    `INSERT INTO audit_logs (actor_id, actor_role, subject_user_id, action, entity_type, entity_id, details,
       ip, user_agent, created_at, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.actor_id,
    row.actor_role,
    row.subject_user_id,
    row.action,
    row.entity_type,
    row.entity_id,
    row.details,
    row.ip,
    row.user_agent,
    row.created_at,
    row.prev_hash,
    computeHash(row),
  );
}

export interface AuditLogDto {
  id: number;
  actorId: number | null;
  actorRole: string;
  actorName: string | null;
  subjectUserId: number | null;
  subjectName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  hash: string;
}

export interface AuditQuery {
  actorId?: number;
  subjectUserId?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export function listAuditLogs(query: AuditQuery): Page<AuditLogDto> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.actorId) (where.push('a.actor_id = ?'), params.push(query.actorId));
  if (query.subjectUserId) (where.push('a.subject_user_id = ?'), params.push(query.subjectUserId));
  if (query.action) (where.push('a.action = ?'), params.push(query.action));
  if (query.entityType) (where.push('a.entity_type = ?'), params.push(query.entityType));
  if (query.entityId) (where.push('a.entity_id = ?'), params.push(query.entityId));
  if (query.from) (where.push('a.created_at >= ?'), params.push(istDayStartIso(query.from)));
  if (query.to) (where.push('a.created_at <= ?'), params.push(istDayEndIso(query.to)));
  if (query.search) {
    where.push('(a.action LIKE ? OR a.details LIKE ? OR a.ip LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_logs a ${clause}`, ...params)?.n ?? 0;
  const rows = all<AuditRow & { actor_name: string | null; subject_name: string | null }>(
    `SELECT a.*, actor.full_name AS actor_name, subject.full_name AS subject_name
       FROM audit_logs a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users subject ON subject.id = a.subject_user_id
       ${clause}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      actorName: row.actor_name,
      subjectUserId: row.subject_user_id,
      subjectName: row.subject_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      hash: row.hash,
    })),
    total,
    query.page,
    query.pageSize,
  );
}

export function listAuditActions(): string[] {
  return all<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action').map((r) => r.action);
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtId: number | null;
  reason: string | null;
}

/** Recomputes every hash in order; any edited, removed or reordered entry breaks the chain. */
export function verifyAuditChain(): ChainVerification {
  let expectedPrev = GENESIS_HASH;
  let checked = 0;
  for (const row of all<AuditRow>('SELECT * FROM audit_logs ORDER BY id')) {
    if (row.prev_hash !== expectedPrev) {
      return { valid: false, checked, brokenAtId: row.id, reason: 'Previous-hash link does not match' };
    }
    const { id: _id, hash, ...fields } = row;
    if (computeHash(fields) !== hash) {
      return { valid: false, checked, brokenAtId: row.id, reason: 'Entry contents do not match its hash' };
    }
    expectedPrev = hash;
    checked++;
  }
  return { valid: true, checked, brokenAtId: null, reason: null };
}
