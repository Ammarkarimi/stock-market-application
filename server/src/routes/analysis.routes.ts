import { Router } from 'express';
import { z } from 'zod';
import { unprocessable } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { analysisLimiter } from '../middleware/rateLimit.js';
import { analyzeSeries, MIN_BARS } from '../analysis/analyze.js';
import { dataSourceName, priceHistory, searchSymbols } from '../analysis/provider.js';

const router = Router();
router.use(analysisLimiter);

router.get('/search', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1, 'Enter a stock name or symbol').max(60) }), req.query);
  res.json({ items: await searchSymbols(q) });
});

// Yahoo symbols: RELIANCE.NS, M&M.NS, BRK-B, ^NSEI.
const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(25)
  .regex(/^[A-Za-z0-9.^&=\-]+$/, 'Invalid symbol')
  .transform((s) => s.toUpperCase());

router.get('/:symbol', async (req, res) => {
  const symbol = parse(symbolSchema, req.params.symbol);
  const series = await priceHistory(symbol);
  if (series.bars.length < MIN_BARS) {
    throw unprocessable('INSUFFICIENT_HISTORY', `${series.name} has only ${series.bars.length} days of price history. At least ${MIN_BARS} are needed to read the chart.`);
  }
  res.json({ ...analyzeSeries(series), dataSource: dataSourceName(), generatedAt: new Date().toISOString() });
});

export default router;
