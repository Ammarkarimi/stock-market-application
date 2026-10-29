import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { currentTradingDate } from '../market/engine.js';
import { allQuotes, toTickTuple } from '../market/quoteStore.js';
import { latestUserEventVersion, userEventsSince } from '../services/events.js';
import { latestNotificationId, notificationsAfter } from '../services/notification.service.js';

const router = Router();
const cursor = z.coerce.number().int().min(0).optional();

/**
 * What a signed-in browser polls every few seconds: every price, plus the user's notifications and changes
 * (orders, funds, …) since the cursors it got last time. Without cursors it only gets the current ones.
 */
router.get('/', async (req, res) => {
  const user = currentUser(req);
  const query = parse(z.object({ notificationsAfter: cursor, eventsAfter: cursor }), req.query);
  const notifications = query.notificationsAfter === undefined ? [] : await notificationsAfter(user.id, query.notificationsAfter);
  const latestId = notifications.at(-1)?.id ?? Math.max(await latestNotificationId(user.id), query.notificationsAfter ?? 0);
  const eventVersion = await latestUserEventVersion(user.id);
  // Asked after the version above, so nothing that version covers is missed.
  const events = query.eventsAfter === undefined ? {} : await userEventsSince(user.id, query.eventsAfter);
  res.json({
    tradingDate: currentTradingDate(),
    quotes: allQuotes().map(toTickTuple),
    notifications,
    // The cursor moves to the last notification returned, so a long backlog arrives over several polls.
    latestNotificationId: latestId,
    events,
    eventVersion,
  });
});

export default router;
