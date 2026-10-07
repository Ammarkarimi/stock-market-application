import { afterCommit, all, get, run, transaction } from '../db/index.js';
import { nowIso } from '../lib/clock.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { getQuote, getQuoteBySymbol, toQuoteDto, type QuoteDto } from '../market/quoteStore.js';
import type { Actor } from './actor.js';
import { audit } from './audit.service.js';
import { emitToUser } from './events.js';

export const MAX_WATCHLISTS = 10;
export const MAX_WATCHLIST_ITEMS = 50;

interface WatchlistRow {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

export interface WatchlistDto {
  id: number;
  name: string;
  createdAt: string;
  items: (QuoteDto & { addedAt: string })[];
}

function requireWatchlist(userId: number, id: number): WatchlistRow {
  const row = get<WatchlistRow>('SELECT * FROM watchlists WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Watchlist not found');
  return row;
}

function toDto(row: WatchlistRow): WatchlistDto {
  const items = all<{ security_id: number; added_at: string }>(
    'SELECT security_id, added_at FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at',
    row.id,
  );
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    items: items.flatMap((item) => {
      const quote = getQuote(item.security_id);
      return quote ? [{ ...toQuoteDto(quote), addedAt: item.added_at }] : [];
    }),
  };
}

const changed = (userId: number) => afterCommit(() => emitToUser(userId, 'watchlist'));

export function listWatchlists(userId: number): WatchlistDto[] {
  return all<WatchlistRow>('SELECT * FROM watchlists WHERE user_id = ? ORDER BY id', userId).map(toDto);
}

export function createWatchlist(userId: number, name: string, actor: Actor): WatchlistDto {
  return transaction(() => {
    const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM watchlists WHERE user_id = ?', userId)!.n;
    if (count >= MAX_WATCHLISTS) throw unprocessable('LIMIT_REACHED', `You can have at most ${MAX_WATCHLISTS} watchlists`);
    if (get('SELECT 1 FROM watchlists WHERE user_id = ? AND name = ?', userId, name)) {
      throw conflict(`A watchlist named "${name}" already exists`);
    }
    const id = Number(run('INSERT INTO watchlists (user_id, name, created_at) VALUES (?, ?, ?)', userId, name, nowIso()).lastInsertRowid);
    audit({ actor, action: 'WATCHLIST_CREATED', subjectUserId: userId, entityType: 'WATCHLIST', entityId: id, details: { name } });
    changed(userId);
    return toDto(requireWatchlist(userId, id));
  });
}

export function renameWatchlist(userId: number, id: number, name: string, actor: Actor): WatchlistDto {
  return transaction(() => {
    const row = requireWatchlist(userId, id);
    if (get('SELECT 1 FROM watchlists WHERE user_id = ? AND name = ? AND id != ?', userId, name, id)) {
      throw conflict(`A watchlist named "${name}" already exists`);
    }
    run('UPDATE watchlists SET name = ? WHERE id = ?', name, id);
    audit({ actor, action: 'WATCHLIST_RENAMED', subjectUserId: userId, entityType: 'WATCHLIST', entityId: id, details: { from: row.name, to: name } });
    changed(userId);
    return toDto(requireWatchlist(userId, id));
  });
}

export function deleteWatchlist(userId: number, id: number, actor: Actor): void {
  transaction(() => {
    const row = requireWatchlist(userId, id);
    const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM watchlists WHERE user_id = ?', userId)!.n;
    if (count <= 1) throw conflict('You need at least one watchlist');
    run('DELETE FROM watchlists WHERE id = ?', id);
    audit({ actor, action: 'WATCHLIST_DELETED', subjectUserId: userId, entityType: 'WATCHLIST', entityId: id, details: { name: row.name } });
    changed(userId);
  });
}

export function addToWatchlist(userId: number, id: number, symbol: string, actor: Actor): WatchlistDto {
  return transaction(() => {
    requireWatchlist(userId, id);
    const quote = getQuoteBySymbol(symbol);
    if (!quote) throw notFound(`Security ${symbol.toUpperCase()} not found`);
    if (get('SELECT 1 FROM watchlist_items WHERE watchlist_id = ? AND security_id = ?', id, quote.securityId)) {
      throw conflict(`${quote.symbol} is already in this watchlist`);
    }
    const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM watchlist_items WHERE watchlist_id = ?', id)!.n;
    if (count >= MAX_WATCHLIST_ITEMS) throw unprocessable('LIMIT_REACHED', `A watchlist can hold at most ${MAX_WATCHLIST_ITEMS} securities`);
    run('INSERT INTO watchlist_items (watchlist_id, security_id, added_at) VALUES (?, ?, ?)', id, quote.securityId, nowIso());
    audit({ actor, action: 'WATCHLIST_ITEM_ADDED', subjectUserId: userId, entityType: 'WATCHLIST', entityId: id, details: { symbol: quote.symbol } });
    changed(userId);
    return toDto(requireWatchlist(userId, id));
  });
}

export function removeFromWatchlist(userId: number, id: number, symbol: string, actor: Actor): WatchlistDto {
  return transaction(() => {
    requireWatchlist(userId, id);
    const quote = getQuoteBySymbol(symbol);
    const removed = quote
      ? run('DELETE FROM watchlist_items WHERE watchlist_id = ? AND security_id = ?', id, quote.securityId).changes
      : 0;
    if (!removed) throw notFound(`${symbol.toUpperCase()} is not in this watchlist`);
    audit({ actor, action: 'WATCHLIST_ITEM_REMOVED', subjectUserId: userId, entityType: 'WATCHLIST', entityId: id, details: { symbol: quote!.symbol } });
    changed(userId);
    return toDto(requireWatchlist(userId, id));
  });
}

/** Watchlists of a user that contain the given security (for the security page). */
export function watchlistsContaining(userId: number, securityId: number): { id: number; name: string }[] {
  return all<{ id: number; name: string }>(
    `SELECT w.id, w.name FROM watchlists w JOIN watchlist_items i ON i.watchlist_id = w.id
      WHERE w.user_id = ? AND i.security_id = ? ORDER BY w.id`,
    userId,
    securityId,
  );
}
