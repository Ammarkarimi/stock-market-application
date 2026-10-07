import { Router } from 'express';
import { currentUser } from '../middleware/auth.js';
import { currentTradingDate } from '../market/engine.js';
import { allQuotes, toTickTuple, type TickTuple } from '../market/quoteStore.js';
import { bus, type UserEvent } from '../services/events.js';

const router = Router();
const HEARTBEAT_MS = 20_000;

/**
 * Server-Sent Events stream: live price ticks for everyone plus the signed-in user's own events
 * (notifications, order and funds updates). Closed automatically when the session is revoked.
 */
router.get('/', (req, res) => {
  const user = currentUser(req);
  const sessionId = req.auth!.session.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Events can arrive after the stream has ended (e.g. a notification emitted right after the session is
  // revoked), so writes are skipped once it is closed instead of erroring.
  const send = (event: string, data: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onPrices = (ticks: TickTuple[]) => send('prices', ticks);
  const onUserEvent = (event: UserEvent) => send(event.type, event.payload ?? {});
  const onBroadcast = (event: { type: string; payload?: unknown }) => send(event.type, event.payload ?? {});
  const onRollover = (payload: unknown) => send('market-rollover', payload);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    bus.off('prices', onPrices);
    bus.off(`user:${user.id}`, onUserEvent);
    bus.off('broadcast', onBroadcast);
    bus.off('market-rollover', onRollover);
    bus.off('session-revoked', onRevoked);
    if (!res.writableEnded) res.end();
  };
  const onRevoked = (revokedId: string) => {
    if (revokedId !== sessionId) return;
    send('session-revoked', {});
    close();
  };

  bus.on('prices', onPrices);
  bus.on(`user:${user.id}`, onUserEvent);
  bus.on('broadcast', onBroadcast);
  bus.on('market-rollover', onRollover);
  bus.on('session-revoked', onRevoked);
  req.on('close', close);
  res.on('close', close);
  // A failed write (e.g. the client vanished) must not become an unhandled 'error' event.
  res.on('error', close);

  send('snapshot', { tradingDate: currentTradingDate(), quotes: allQuotes().map(toTickTuple) });
});

export default router;
