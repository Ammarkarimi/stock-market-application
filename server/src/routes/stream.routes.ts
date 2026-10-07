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

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('snapshot', { tradingDate: currentTradingDate(), quotes: allQuotes().map(toTickTuple) });

  const onPrices = (ticks: TickTuple[]) => send('prices', ticks);
  const onUserEvent = (event: UserEvent) => send(event.type, event.payload ?? {});
  const onBroadcast = (event: { type: string; payload?: unknown }) => send(event.type, event.payload ?? {});
  const onRollover = (payload: unknown) => send('market-rollover', payload);
  const onRevoked = (revokedId: string) => {
    if (revokedId !== sessionId) return;
    send('session-revoked', {});
    res.end();
  };

  bus.on('prices', onPrices);
  bus.on(`user:${user.id}`, onUserEvent);
  bus.on('broadcast', onBroadcast);
  bus.on('market-rollover', onRollover);
  bus.on('session-revoked', onRevoked);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('prices', onPrices);
    bus.off(`user:${user.id}`, onUserEvent);
    bus.off('broadcast', onBroadcast);
    bus.off('market-rollover', onRollover);
    bus.off('session-revoked', onRevoked);
  });
});

export default router;
