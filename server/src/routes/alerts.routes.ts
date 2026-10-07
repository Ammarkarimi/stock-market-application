import { Router } from 'express';
import { z } from 'zod';
import { toPaise } from '../lib/money.js';
import { idParam, parse, rupees, symbolParam } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { actorFrom } from '../services/actor.js';
import { createAlert, deleteAlert, listAlerts, updateAlert } from '../services/alert.service.js';

const router = Router();
const note = z.string().trim().max(140).nullable().optional();

router.get('/', (req, res) => {
  const query = parse(
    z.object({ status: z.enum(['ACTIVE', 'TRIGGERED', 'DISABLED']).optional(), symbol: symbolParam().optional() }),
    req.query,
  );
  res.json({ alerts: listAlerts(currentUser(req).id, query) });
});

router.post('/', (req, res) => {
  const body = parse(
    z.object({ symbol: symbolParam(), condition: z.enum(['ABOVE', 'BELOW']), targetPrice: rupees(), note }),
    req.body,
  );
  const alert = createAlert(currentUser(req).id, { ...body, targetPrice: toPaise(body.targetPrice) }, actorFrom(req));
  res.status(201).json({ alert });
});

router.patch('/:id', (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(['ACTIVE', 'DISABLED']).optional(),
      condition: z.enum(['ABOVE', 'BELOW']).optional(),
      targetPrice: rupees().optional(),
      note,
    }),
    req.body,
  );
  const alert = updateAlert(
    currentUser(req).id,
    parse(idParam(), req.params.id),
    { ...body, targetPrice: body.targetPrice ? toPaise(body.targetPrice) : undefined },
    actorFrom(req),
  );
  res.json({ alert });
});

router.delete('/:id', (req, res) => {
  deleteAlert(currentUser(req).id, parse(idParam(), req.params.id), actorFrom(req));
  res.json({ ok: true });
});

export default router;
