import { Router } from 'express';
import { z } from 'zod';
import { toPaise } from '../lib/money.js';
import { idParam, parse, rupees } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { actorFrom } from '../services/actor.js';
import { applyForIpo, cancelIpoApplication, getIpo, listIpos, listMyApplications } from '../services/ipo.service.js';

const router = Router();

router.get('/', (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['upcoming', 'open', 'closed', 'all']).default('all') }), req.query);
  res.json({ ipos: listIpos(status, currentUser(req).id) });
});

router.get('/applications', (req, res) => {
  res.json({ applications: listMyApplications(currentUser(req).id) });
});

router.post('/applications/:id/cancel', (req, res) => {
  res.json({ application: cancelIpoApplication(currentUser(req).id, parse(idParam(), req.params.id), actorFrom(req)) });
});

router.get('/:id', (req, res) => {
  res.json({ ipo: getIpo(parse(idParam(), req.params.id), currentUser(req).id) });
});

router.post('/:id/apply', async (req, res) => {
  const body = parse(
    z.object({
      lots: z.number().int('Lots must be a whole number').positive('Apply for at least one lot'),
      bidPrice: rupees().nullable().optional(),
      cutoff: z.boolean().default(false),
      pin: z.string().max(10).optional(),
    }),
    req.body,
  );
  const application = await applyForIpo(
    currentUser(req).id,
    parse(idParam(), req.params.id),
    { lots: body.lots, bidPrice: body.bidPrice ? toPaise(body.bidPrice) : null, cutoff: body.cutoff },
    body.pin,
    actorFrom(req),
  );
  res.status(201).json({ application });
});

export default router;
