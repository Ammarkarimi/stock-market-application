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

router.get('/', (req, res) => {
  const query = parse(
    z.object({
      category: z.enum(NOTIFICATION_CATEGORIES).optional(),
      unread: z.enum(['true', 'false']).optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listNotifications(currentUser(req).id, { ...query, unreadOnly: query.unread === 'true' }));
});

router.get('/unread-count', (req, res) => {
  res.json({ count: unreadCount(currentUser(req).id) });
});

router.post('/read-all', (req, res) => {
  res.json({ updated: markAllRead(currentUser(req).id) });
});

router.post('/:id/read', (req, res) => {
  markRead(currentUser(req).id, parse(idParam(), req.params.id));
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  deleteNotification(currentUser(req).id, parse(idParam(), req.params.id));
  res.json({ ok: true });
});

export default router;
