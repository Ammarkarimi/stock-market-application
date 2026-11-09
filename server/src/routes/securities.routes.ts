import { Router, type Request } from 'express';
import { z } from 'zod';
import { paginationQuery, parse, symbolParam } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { listFromExchange, searchExchange } from '../market/exchangeListings.js';
import { getQuoteBySymbol, toQuoteDto } from '../market/quoteStore.js';
import { actorFrom } from '../services/actor.js';
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

router.get('/search', async (req, res) => {
  const query = parse(
    z.object({
      q: z.string().trim().max(50).default(''),
      type: typeFilter,
      limit: z.coerce.number().int().min(1).max(25).default(10),
      /** Also look for NSE stocks and ETFs StockKaro does not list yet. */
      exchange: z.enum(['true', 'false']).default('false'),
    }),
    req.query,
  );
  const items = searchSecurities(query.q, { type: query.type as never, limit: query.limit });
  const wantsExchange = query.exchange === 'true' && (!query.type || query.type === 'STOCK' || query.type === 'ETF');
  const exchange = wantsExchange ? (await searchExchange(query.q)).filter((m) => !query.type || m.type === query.type) : [];
  res.json({ items, exchange });
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

/** Opening an NSE stock StockKaro does not list yet lists it first (with a live feed). */
async function ensureListed(req: Request, symbol: string): Promise<void> {
  if (!getQuoteBySymbol(symbol)) await listFromExchange(symbol, actorFrom(req));
}

router.get('/:symbol', async (req, res) => {
  const symbol = parse(symbolParam(), req.params.symbol);
  await ensureListed(req, symbol);
  const detail = await getSecurityDetail(symbol);
  const user = currentUser(req);
  const securityId = getQuoteBySymbol(symbol)!.securityId;
  res.json({
    ...detail,
    position: (await getPosition(user.id, securityId)),
    watchlists: (await watchlistsContaining(user.id, securityId)),
    alerts: (await listAlerts(user.id, { symbol, status: 'ACTIVE' })),
  });
});

router.get('/:symbol/history', async (req, res) => {
  const symbol = parse(symbolParam(), req.params.symbol);
  await ensureListed(req, symbol);
  const { range } = parse(z.object({ range: z.enum(HISTORY_RANGES).default('1D') }), req.query);
  res.json((await getPriceHistory(symbol, range)));
});

router.get('/:symbol/constituents', async (req, res) => {
  const symbol = parse(symbolParam(), req.params.symbol);
  res.json({ items: (await getIndexConstituents(symbol)) });
});

export default router;
