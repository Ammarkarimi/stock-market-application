import { Router } from 'express';
import { z } from 'zod';
import { dateString, paginationQuery, parse, symbolParam } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { listTrades } from '../services/order.service.js';

const router = Router();

router.get('/', (req, res) => {
  const query = parse(
    z.object({
      symbol: symbolParam().optional(),
      side: z.enum(['BUY', 'SELL']).optional(),
      from: dateString().optional(),
      to: dateString().optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listTrades({ ...query, userId: currentUser(req).id }));
});

export default router;
