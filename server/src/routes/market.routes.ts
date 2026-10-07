import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../lib/validation.js';
import {
  getIndices,
  getMarketBreadth,
  getMarketOverview,
  getMarketStatus,
  getMovers,
  getSectorPerformance,
} from '../services/market.service.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getMarketStatus());
});

router.get('/overview', (_req, res) => {
  res.json(getMarketOverview());
});

router.get('/indices', (_req, res) => {
  res.json({ indices: getIndices() });
});

router.get('/movers', (req, res) => {
  const query = parse(
    z.object({
      kind: z.enum(['gainers', 'losers', 'active', 'value']).default('gainers'),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }),
    req.query,
  );
  res.json({ kind: query.kind, items: getMovers(query.kind, query.limit) });
});

router.get('/sectors', (_req, res) => {
  res.json({ sectors: getSectorPerformance() });
});

router.get('/breadth', (_req, res) => {
  res.json(getMarketBreadth());
});

export default router;
