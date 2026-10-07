import { Router } from 'express';
import { z } from 'zod';
import { toPaise } from '../lib/money.js';
import { dateString, idParam, paginationQuery, parse, rupees, symbolParam } from '../lib/validation.js';
import { actorFrom } from '../services/actor.js';
import {
  createSecurity,
  getAdminOverview,
  getUserDetail,
  listAllFundTransactions,
  listUsers,
  sendAnnouncement,
  setSecurityPrice,
  setTradingStatus,
  setUserRole,
  setUserStatus,
  signOutUserEverywhere,
  unlockUser,
  updateSecurity,
} from '../services/admin.service.js';
import { listAuditActions, listAuditLogs, verifyAuditChain } from '../services/audit.service.js';
import { adjustFunds, LEDGER_ENTRY_TYPES, listLedger } from '../services/funds.service.js';
import {
  allotIpo,
  createIpo,
  getIpo,
  listAllIposForAdmin,
  listIpo,
  listIpoApplications,
  setSubscription,
  updateIpo,
  withdrawIpo,
} from '../services/ipo.service.js';
import { listSecurities, SECURITY_TYPES } from '../services/market.service.js';
import { cancelOrder, getOrderDetail, listOrders, listTrades, ORDER_STATUSES } from '../services/order.service.js';
import { getAllSettings, isSettingKey, updateSetting } from '../services/settings.service.js';
import { badRequest } from '../lib/errors.js';

const router = Router();
const reason = z.string().trim().min(3, 'Please give a reason').max(200);

// ---- Overview ---------------------------------------------------------------------------------
router.get('/overview', (_req, res) => {
  res.json(getAdminOverview());
});

// ---- Users ------------------------------------------------------------------------------------
router.get('/users', (req, res) => {
  const query = parse(
    z.object({
      q: z.string().trim().max(80).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
      role: z.enum(['USER', 'ADMIN']).optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listUsers(query));
});

router.get('/users/:id', (req, res) => {
  res.json(getUserDetail(parse(idParam(), req.params.id)));
});

router.post('/users/:id/status', (req, res) => {
  const body = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason }), req.body);
  res.json({ user: setUserStatus(parse(idParam(), req.params.id), body.status, body.reason, actorFrom(req)) });
});

router.post('/users/:id/role', (req, res) => {
  const body = parse(z.object({ role: z.enum(['USER', 'ADMIN']) }), req.body);
  res.json({ user: setUserRole(parse(idParam(), req.params.id), body.role, actorFrom(req)) });
});

router.post('/users/:id/unlock', (req, res) => {
  res.json({ user: unlockUser(parse(idParam(), req.params.id), actorFrom(req)) });
});

router.post('/users/:id/revoke-sessions', (req, res) => {
  res.json({ revoked: signOutUserEverywhere(parse(idParam(), req.params.id), actorFrom(req)) });
});

router.post('/users/:id/funds-adjustment', (req, res) => {
  const body = parse(z.object({ direction: z.enum(['CREDIT', 'DEBIT']), amount: rupees(), reason }), req.body);
  const amount = toPaise(body.amount) * (body.direction === 'CREDIT' ? 1 : -1);
  res.status(201).json({ entry: adjustFunds(parse(idParam(), req.params.id), amount, body.reason, actorFrom(req)) });
});

// ---- Securities -------------------------------------------------------------------------------
const optionalNumber = () => z.number().finite().nullable().optional();
const securityFields = {
  name: z.string().trim().min(2).max(120),
  sector: z.string().trim().max(60).nullable().optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  foundedYear: z.number().int().min(1800).max(2100).nullable().optional(),
  headquarters: z.string().trim().max(80).nullable().optional(),
  faceValue: optionalNumber(),
  sharesOutstanding: z.number().int().positive().nullable().optional(),
  eps: optionalNumber(),
  bookValue: optionalNumber(),
  dividendPerShare: optionalNumber(),
  roe: optionalNumber(),
  debtToEquity: optionalNumber(),
  beta: optionalNumber(),
  revenueCr: optionalNumber(),
  netProfitCr: optionalNumber(),
  expenseRatio: optionalNumber(),
  circuitPct: z.number().min(2).max(20).optional(),
  volatility: z.number().min(0.001).max(2).optional(),
  avgVolume: z.number().int().min(0).optional(),
};

router.get('/securities', (req, res) => {
  const query = parse(
    z.object({
      q: z.string().trim().max(50).optional(),
      type: z.enum(SECURITY_TYPES as [string, ...string[]]).optional(),
      sort: z.enum(['symbol', 'name', 'price', 'changePercent', 'volume', 'marketCap']).optional(),
      order: z.enum(['asc', 'desc']).default('asc'),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listSecurities({ ...query, type: query.type as never }));
});

router.post('/securities', (req, res) => {
  const body = parse(
    z.object({
      ...securityFields,
      symbol: symbolParam().refine((s) => /^[A-Z0-9&-]{2,20}$/.test(s), 'Use 2–20 letters, digits, & or -'),
      type: z.enum(['STOCK', 'ETF', 'REIT', 'INVIT']),
      price: rupees(),
    }),
    req.body,
  );
  res.status(201).json({ security: createSecurity(body, actorFrom(req)) });
});

router.patch('/securities/:symbol', (req, res) => {
  const body = parse(z.object({ ...securityFields, name: securityFields.name.optional() }), req.body);
  res.json({ security: updateSecurity(parse(symbolParam(), req.params.symbol), body, actorFrom(req)) });
});

router.post('/securities/:symbol/trading-status', (req, res) => {
  const body = parse(z.object({ status: z.enum(['ACTIVE', 'HALTED']), reason }), req.body);
  res.json({ security: setTradingStatus(parse(symbolParam(), req.params.symbol), body.status, body.reason, actorFrom(req)) });
});

router.post('/securities/:symbol/price', (req, res) => {
  const body = parse(z.object({ price: rupees() }), req.body);
  res.json({ security: setSecurityPrice(parse(symbolParam(), req.params.symbol), body.price, actorFrom(req)) });
});

// ---- IPOs -------------------------------------------------------------------------------------
const ipoSchema = z.object({
  companyName: z.string().trim().min(3).max(120),
  symbol: symbolParam().refine((s) => /^[A-Z0-9&-]{2,20}$/.test(s), 'Use 2–20 letters, digits, & or -'),
  issueType: z.enum(['MAINBOARD', 'SME']).default('MAINBOARD'),
  sector: z.string().trim().max(60).nullable().optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(1500).nullable().optional(),
  priceBandLow: z.number().int().positive(),
  priceBandHigh: z.number().int().positive(),
  lotSize: z.number().int().positive(),
  minLots: z.number().int().positive().default(1),
  maxLots: z.number().int().positive(),
  issueSizeCr: z.number().positive(),
  freshIssueCr: z.number().min(0).default(0),
  ofsCr: z.number().min(0).default(0),
  openDate: dateString(),
  closeDate: dateString(),
  allotmentDate: dateString(),
  refundDate: dateString().nullable().optional(),
  listingDate: dateString(),
  demand: z.object({ retail: z.number().min(0), nii: z.number().min(0), qib: z.number().min(0) }).nullable().optional(),
  financials: z
    .array(z.object({ year: z.string().max(10), revenueCr: z.number(), profitCr: z.number(), assetsCr: z.number() }))
    .max(5)
    .optional(),
  registrar: z.string().trim().max(120).nullable().optional(),
  leadManagers: z.array(z.string().trim().max(120)).max(10).optional(),
});

/** IPO prices are entered in whole rupees and stored in paise. */
function ipoPrices<T extends { priceBandLow?: number; priceBandHigh?: number }>(body: T): T {
  return {
    ...body,
    priceBandLow: body.priceBandLow === undefined ? undefined : body.priceBandLow * 100,
    priceBandHigh: body.priceBandHigh === undefined ? undefined : body.priceBandHigh * 100,
  };
}

router.get('/ipos', (_req, res) => {
  res.json({ ipos: listAllIposForAdmin() });
});

router.post('/ipos', (req, res) => {
  const body = parse(ipoSchema, req.body);
  res.status(201).json({ ipo: createIpo(ipoPrices(body), actorFrom(req)) });
});

router.get('/ipos/:id', (req, res) => {
  const id = parse(idParam(), req.params.id);
  res.json({ ipo: getIpo(id), applications: listIpoApplications(id) });
});

router.patch('/ipos/:id', (req, res) => {
  const body = parse(ipoSchema.omit({ symbol: true }).partial(), req.body);
  res.json({ ipo: updateIpo(parse(idParam(), req.params.id), ipoPrices(body), actorFrom(req)) });
});

router.post('/ipos/:id/subscription', (req, res) => {
  const body = parse(z.object({ retail: z.number().min(0).max(1000), nii: z.number().min(0).max(1000), qib: z.number().min(0).max(1000) }), req.body);
  res.json({ ipo: setSubscription(parse(idParam(), req.params.id), body, actorFrom(req)) });
});

router.post('/ipos/:id/allot', (req, res) => {
  const id = parse(idParam(), req.params.id);
  res.json({ result: allotIpo(id, actorFrom(req)), ipo: getIpo(id) });
});

router.post('/ipos/:id/list', (req, res) => {
  const id = parse(idParam(), req.params.id);
  res.json({ result: listIpo(id, actorFrom(req)), ipo: getIpo(id) });
});

router.post('/ipos/:id/withdraw', (req, res) => {
  const body = parse(z.object({ reason }), req.body);
  res.json({ ipo: withdrawIpo(parse(idParam(), req.params.id), body.reason, actorFrom(req)) });
});

// ---- Orders & transactions ------------------------------------------------------------------------
router.get('/orders', (req, res) => {
  const query = parse(
    z.object({
      userId: idParam().optional(),
      status: z.enum(ORDER_STATUSES as [string, ...string[]]).optional(),
      side: z.enum(['BUY', 'SELL']).optional(),
      symbol: symbolParam().optional(),
      from: dateString().optional(),
      to: dateString().optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listOrders({ ...query, status: query.status as never }));
});

router.get('/orders/:id', (req, res) => {
  res.json(getOrderDetail(parse(idParam(), req.params.id), null));
});

router.post('/orders/:id/cancel', (req, res) => {
  const body = parse(z.object({ reason }), req.body);
  res.json({ order: cancelOrder(parse(idParam(), req.params.id), null, actorFrom(req), `Cancelled by administrator: ${body.reason}`) });
});

router.get('/trades', (req, res) => {
  const query = parse(
    z.object({ userId: idParam().optional(), symbol: symbolParam().optional(), side: z.enum(['BUY', 'SELL']).optional(), from: dateString().optional(), to: dateString().optional(), ...paginationQuery }),
    req.query,
  );
  res.json(listTrades(query));
});

router.get('/ledger', (req, res) => {
  const query = parse(
    z.object({
      userId: idParam().optional(),
      type: z.enum(LEDGER_ENTRY_TYPES as [string, ...string[]]).optional(),
      from: dateString().optional(),
      to: dateString().optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listLedger({ ...query, type: query.type as never }));
});

router.get('/fund-transactions', (req, res) => {
  const query = parse(z.object({ userId: idParam().optional(), type: z.enum(['DEPOSIT', 'WITHDRAWAL']).optional(), ...paginationQuery }), req.query);
  res.json(listAllFundTransactions(query));
});

// ---- Audit trail ----------------------------------------------------------------------------------
router.get('/audit-logs', (req, res) => {
  const query = parse(
    z.object({
      actorId: idParam().optional(),
      subjectUserId: idParam().optional(),
      action: z.string().max(60).optional(),
      entityType: z.string().max(40).optional(),
      entityId: z.string().max(40).optional(),
      from: dateString().optional(),
      to: dateString().optional(),
      search: z.string().trim().max(80).optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  res.json(listAuditLogs(query));
});

router.get('/audit-logs/actions', (_req, res) => {
  res.json({ actions: listAuditActions() });
});

router.get('/audit-logs/verify', (_req, res) => {
  res.json(verifyAuditChain());
});

// ---- Settings & announcements -------------------------------------------------------------------
router.get('/settings', (_req, res) => {
  res.json({ settings: getAllSettings() });
});

router.put('/settings/:key', (req, res) => {
  const key = String(req.params.key);
  if (!isSettingKey(key)) throw badRequest(`Unknown setting "${key}"`);
  res.json({ value: updateSetting(key, req.body, actorFrom(req)) });
});

router.post('/announcements', (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().min(3).max(80),
      message: z.string().trim().min(3).max(500),
      link: z
        .string()
        .trim()
        .regex(/^\/[A-Za-z0-9/_?=&%-]*$/, 'Link must be an in-app path such as /ipo')
        .nullable()
        .optional(),
    }),
    req.body,
  );
  res.status(201).json(sendAnnouncement(body.title, body.message, body.link ?? null, actorFrom(req)));
});

export default router;
