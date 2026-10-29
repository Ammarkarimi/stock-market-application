import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { getPerformance, getPortfolio, PERFORMANCE_RANGES } from '../services/portfolio.service.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json((await getPortfolio(currentUser(req).id)));
});

router.get('/performance', async (req, res) => {
  const { range } = parse(z.object({ range: z.enum(PERFORMANCE_RANGES).default('3M') }), req.query);
  res.json((await getPerformance(currentUser(req).id, range)));
});

export default router;
