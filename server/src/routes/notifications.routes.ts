import { Router } from 'express';
import { z } from 'zod';
import { idParam, paginationQuery, parse } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import {
  deleteNotification,
  listNotifications,
  markAllRead,
  markRead,
  NOTIFICATION_CATEGORIES,
  unreadCount,
} from '../services/notification.service.js';

const router = Router();

router.get('/', async (req, res) => {
  const query = parse(
    z.object({
      category: z.enum(NOTIFICATION_CATEGORIES).optional(),
      unread: z.enum(['true', 'false']).optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json((await listNotifications(currentUser(req).id, { ...query, unreadOnly: query.unread === 'true' })));
});

router.get('/unread-count', async (req, res) => {
  res.json({ count: (await unreadCount(currentUser(req).id)) });
});

router.post('/read-all', async (req, res) => {
  res.json({ updated: (await markAllRead(currentUser(req).id)) });
});

router.post('/:id/read', async (req, res) => {
  await markRead(currentUser(req).id, parse(idParam(), req.params.id));
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await deleteNotification(currentUser(req).id, parse(idParam(), req.params.id));
  res.json({ ok: true });
});

export default router;
