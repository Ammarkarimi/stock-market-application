import { Router } from 'express';
import { z } from 'zod';
import { toPaise } from '../lib/money.js';
import { paginationQuery, parse, rupees } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { actorFrom } from '../services/actor.js';
import { DEPOSIT_METHODS, deposit, getFundsSummary, listFundTransactions, withdraw } from '../services/funds.service.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json((await getFundsSummary(currentUser(req).id)));
});

router.post('/deposit', async (req, res) => {
  const body = parse(z.object({ amount: rupees(), method: z.enum(DEPOSIT_METHODS) }), req.body);
  const transaction = await deposit(currentUser(req).id, toPaise(body.amount), body.method, actorFrom(req));
  res.status(201).json({ transaction, funds: (await getFundsSummary(currentUser(req).id)) });
});

router.post('/withdraw', async (req, res) => {
  const body = parse(z.object({ amount: rupees(), pin: z.string().max(10).optional() }), req.body);
  const transaction = await withdraw(currentUser(req).id, toPaise(body.amount), body.pin, actorFrom(req));
  res.status(201).json({ transaction, funds: (await getFundsSummary(currentUser(req).id)) });
});

router.get('/transactions', async (req, res) => {
  const query = parse(z.object({ type: z.enum(['DEPOSIT', 'WITHDRAWAL']).optional(), ...paginationQuery }), req.query);
  res.json((await listFundTransactions(currentUser(req).id, query)));
});

export default router;
