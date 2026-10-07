import { Router } from 'express';
import { z } from 'zod';
import { paginationQuery, parse, symbolParam } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { getQuoteBySymbol, toQuoteDto } from '../market/quoteStore.js';
import { listAlerts } from '../services/alert.service.js';
import {
  getIndexConstituents,
  getPriceHistory,
  getSecurityDetail,
  HISTORY_RANGES,
  listSecurities,
  listSectors,
  searchSecurities,
  SECURITY_TYPES,
} from '../services/market.service.js';
import { getPosition } from '../services/portfolio.service.js';
import { watchlistsContaining } from '../services/watchlist.service.js';

const router = Router();

const typeFilter = z.enum(SECURITY_TYPES as [string, ...string[]]).optional();

router.get('/search', (req, res) => {
  const query = parse(
    z.object({
      q: z.string().trim().max(50).default(''),
      type: typeFilter,
      limit: z.coerce.number().int().min(1).max(25).default(10),
    }),
    req.query,
  );
  res.json({ items: searchSecurities(query.q, { type: query.type as never, limit: query.limit }) });
});

router.get('/sectors', (_req, res) => {
  res.json({ sectors: listSectors() });
});

router.get('/quotes', (req, res) => {
  const query = parse(z.object({ symbols: z.string().max(2000).default('') }), req.query);
  const symbols = query.symbols.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const quotes = symbols.map((symbol) => getQuoteBySymbol(symbol)).filter((q) => q !== undefined);
  res.json({ quotes: quotes.map(toQuoteDto) });
});

router.get('/', (req, res) => {
  const query = parse(
    z.object({
      q: z.string().trim().max(50).optional(),
      type: typeFilter,
      sector: z.string().max(60).optional(),
      sort: z.enum(['symbol', 'name', 'price', 'changePercent', 'volume', 'marketCap']).optional(),
      order: z.enum(['asc', 'desc']).default('asc'),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listSecurities({ ...query, type: query.type as never }));
});

router.get('/:symbol', (req, res) => {
  const symbol = parse(symbolParam(), req.params.symbol);
  const detail = getSecurityDetail(symbol);
  const user = currentUser(req);
  const securityId = getQuoteBySymbol(symbol)!.securityId;
  res.json({
    ...detail,
    position: getPosition(user.id, securityId),
    watchlists: watchlistsContaining(user.id, securityId),
    alerts: listAlerts(user.id, { symbol, status: 'ACTIVE' }),
  });
});

router.get('/:symbol/history', (req, res) => {
  const symbol = parse(symbolParam(), req.params.symbol);
  const { range } = parse(z.object({ range: z.enum(HISTORY_RANGES).default('1D') }), req.query);
  res.json(getPriceHistory(symbol, range));
});

router.get('/:symbol/constituents', (req, res) => {
  const symbol = parse(symbolParam(), req.params.symbol);
  res.json({ items: getIndexConstituents(symbol) });
});

export default router;
