import crypto from 'node:crypto';
import { afterCommit, all, get, run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { referenceCode } from '../lib/crypto.js';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { changePercent, formatInr, toPaise, toRupees, toRupeesOrNull } from '../lib/money.js';
import { clamp, gaussian } from '../lib/rng.js';
import { istDate, istDayEnd, istDayStart } from '../lib/time.js';
import { currentTradingDate } from '../market/engine.js';
import { IPO_FLOAT_FRACTION } from '../market/ipoCatalog.js';
import { getQuote, reloadQuote } from '../market/quoteStore.js';
import { tickSizeFor } from '../market/seedMarket.js';
import { SYSTEM_ACTOR, type Actor } from './actor.js';
import { audit } from './audit.service.js';
import { emitToUser } from './events.js';
import { availableBalance, postLedger } from './funds.service.js';
import { invalidateSecurityCache } from './market.service.js';
import { notify, notifyAllUsers } from './notification.service.js';
import { verifyTransactionPin } from './profile.service.js';
import { getSetting } from './settings.service.js';

export type IpoStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'ALLOTTED' | 'LISTED' | 'WITHDRAWN';
export type ApplicationStatus = 'APPLIED' | 'CANCELLED' | 'ALLOTTED' | 'NOT_ALLOTTED';

export interface IpoRow {
  id: number;
  company_name: string;
  symbol: string;
  issue_type: 'MAINBOARD' | 'SME';
  sector: string | null;
  industry: string | null;
  description: string | null;
  price_band_low: number;
  price_band_high: number;
  lot_size: number;
  min_lots: number;
  max_lots: number;
  issue_size_cr: number;
  fresh_issue_cr: number;
  ofs_cr: number;
  retail_quota_pct: number;
  nii_quota_pct: number;
  qib_quota_pct: number;
  open_date: string;
  close_date: string;
  allotment_date: string;
  refund_date: string | null;
  listing_date: string;
  issue_price: number | null;
  listing_price: number | null;
  subscription_retail: number;
  subscription_nii: number;
  subscription_qib: number;
  demand_profile: string | null;
  financials: string | null;
  registrar: string | null;
  lead_managers: string | null;
  open_notified_at: string | null;
  allotted_at: string | null;
  listed_at: string | null;
  withdrawn_at: string | null;
  security_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationRow {
  id: number;
  ipo_id: number;
  user_id: number;
  application_no: string;
  quantity: number;
  bid_price: number;
  is_cutoff: number;
  blocked_amount: number;
  status: ApplicationStatus;
  status_reason: string | null;
  allotted_quantity: number;
  allotment_price: number | null;
  amount_debited: number;
  shares_credited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemandProfile {
  retail: number;
  nii: number;
  qib: number;
  /** Set when an admin entered subscription figures by hand; the simulation then leaves them alone. */
  manual?: boolean;
}

export function ipoStatus(row: IpoRow, today: string = istDate()): IpoStatus {
  if (row.withdrawn_at) return 'WITHDRAWN';
  if (row.listed_at) return 'LISTED';
  if (row.allotted_at) return 'ALLOTTED';
  if (today < row.open_date) return 'UPCOMING';
  if (today <= row.close_date) return 'OPEN';
  return 'CLOSED';
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function overallSubscription(row: IpoRow): number {
  const weights = row.retail_quota_pct + row.nii_quota_pct + row.qib_quota_pct;
  if (!weights) return 0;
  return round2(
    (row.subscription_retail * row.retail_quota_pct + row.subscription_nii * row.nii_quota_pct + row.subscription_qib * row.qib_quota_pct) /
      weights,
  );
}

export interface ApplicationDto {
  id: number;
  applicationNo: string;
  ipoId: number;
  companyName: string;
  symbol: string;
  ipoStatus: IpoStatus;
  quantity: number;
  lots: number;
  bidPrice: number;
  isCutoff: boolean;
  amount: number;
  status: ApplicationStatus;
  statusReason: string | null;
  allottedQuantity: number;
  allotmentPrice: number | null;
  amountDebited: number;
  amountRefunded: number;
  sharesCreditedAt: string | null;
  allotmentDate: string;
  listingDate: string;
  createdAt: string;
  updatedAt: string;
}

function toApplicationDto(row: ApplicationRow, ipo: IpoRow): ApplicationDto {
  const settled = row.status === 'ALLOTTED' || row.status === 'NOT_ALLOTTED' || row.status === 'CANCELLED';
  return {
    id: row.id,
    applicationNo: row.application_no,
    ipoId: ipo.id,
    companyName: ipo.company_name,
    symbol: ipo.symbol,
    ipoStatus: ipoStatus(ipo),
    quantity: row.quantity,
    lots: row.quantity / ipo.lot_size,
    bidPrice: toRupees(row.bid_price),
    isCutoff: row.is_cutoff === 1,
    amount: toRupees(row.blocked_amount),
    status: row.status,
    statusReason: row.status_reason,
    allottedQuantity: row.allotted_quantity,
    allotmentPrice: toRupeesOrNull(row.allotment_price),
    amountDebited: toRupees(row.amount_debited),
    amountRefunded: settled ? toRupees(row.blocked_amount - row.amount_debited) : 0,
    sharesCreditedAt: row.shares_credited_at,
    allotmentDate: ipo.allotment_date,
    listingDate: ipo.listing_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface IpoDto {
  id: number;
  companyName: string;
  symbol: string;
  issueType: 'MAINBOARD' | 'SME';
  sector: string | null;
  industry: string | null;
  description: string | null;
  status: IpoStatus;
  priceBand: { low: number; high: number };
  lotSize: number;
  minLots: number;
  maxLots: number;
  minInvestment: number;
  maxInvestment: number;
  issueSizeCr: number;
  freshIssueCr: number;
  ofsCr: number;
  quotas: { retail: number; nii: number; qib: number };
  dates: { open: string; close: string; allotment: string; refund: string | null; listing: string };
  issuePrice: number | null;
  listingPrice: number | null;
  listingGainPercent: number | null;
  currentPrice: number | null;
  subscription: { retail: number; nii: number; qib: number; total: number };
  financials: { year: string; revenueCr: number; profitCr: number; assetsCr: number }[];
  registrar: string | null;
  leadManagers: string[];
  myApplication: ApplicationDto | null;
  applicationsCount?: number;
}

export function toIpoDto(row: IpoRow, userId?: number): IpoDto {
  const application = userId
    ? get<ApplicationRow>('SELECT * FROM ipo_applications WHERE ipo_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', row.id, userId)
    : undefined;
  const quote = row.security_id ? getQuote(row.security_id) : undefined;
  return {
    id: row.id,
    companyName: row.company_name,
    symbol: row.symbol,
    issueType: row.issue_type,
    sector: row.sector,
    industry: row.industry,
    description: row.description,
    status: ipoStatus(row),
    priceBand: { low: toRupees(row.price_band_low), high: toRupees(row.price_band_high) },
    lotSize: row.lot_size,
    minLots: row.min_lots,
    maxLots: row.max_lots,
    minInvestment: toRupees(row.min_lots * row.lot_size * row.price_band_high),
    maxInvestment: toRupees(row.max_lots * row.lot_size * row.price_band_high),
    issueSizeCr: row.issue_size_cr,
    freshIssueCr: row.fresh_issue_cr,
    ofsCr: row.ofs_cr,
    quotas: { retail: row.retail_quota_pct, nii: row.nii_quota_pct, qib: row.qib_quota_pct },
    dates: { open: row.open_date, close: row.close_date, allotment: row.allotment_date, refund: row.refund_date, listing: row.listing_date },
    issuePrice: toRupeesOrNull(row.issue_price),
    listingPrice: toRupeesOrNull(row.listing_price),
    listingGainPercent: row.issue_price && row.listing_price ? changePercent(row.listing_price, row.issue_price) : null,
    currentPrice: quote ? toRupees(quote.last) : null,
    subscription: {
      retail: round2(row.subscription_retail),
      nii: round2(row.subscription_nii),
      qib: round2(row.subscription_qib),
      total: overallSubscription(row),
    },
    financials: row.financials ? JSON.parse(row.financials) : [],
    registrar: row.registrar,
    leadManagers: row.lead_managers ? JSON.parse(row.lead_managers) : [],
    myApplication: application ? toApplicationDto(application, row) : null,
  };
}

function requireIpo(id: number): IpoRow {
  const row = get<IpoRow>('SELECT * FROM ipos WHERE id = ?', id);
  if (!row) throw notFound('IPO not found');
  return row;
}

export type IpoListFilter = 'upcoming' | 'open' | 'closed' | 'all';

/** Upcoming and open issues soonest first; completed issues most recent first. */
export function listIpos(filter: IpoListFilter, userId?: number): IpoDto[] {
  const rows = all<IpoRow>('SELECT * FROM ipos ORDER BY open_date');
  const groups: Record<IpoListFilter, IpoStatus[]> = {
    upcoming: ['UPCOMING'],
    open: ['OPEN'],
    closed: ['CLOSED', 'ALLOTTED', 'LISTED', 'WITHDRAWN'],
    all: ['UPCOMING', 'OPEN', 'CLOSED', 'ALLOTTED', 'LISTED', 'WITHDRAWN'],
  };
  const statuses = groups[filter];
  const filtered = rows.filter((row) => statuses.includes(ipoStatus(row)));
  if (filter === 'closed') filtered.reverse();
  return filtered.map((row) => toIpoDto(row, userId));
}

export function getIpo(id: number, userId?: number): IpoDto {
  return toIpoDto(requireIpo(id), userId);
}

export interface IpoApplicationInput {
  lots: number;
  /** Paise; ignored when bidding at cut-off. */
  bidPrice?: number | null;
  cutoff: boolean;
}

function validateApplication(ipo: IpoRow, input: IpoApplicationInput) {
  if (ipoStatus(ipo) !== 'OPEN') throw unprocessable('IPO_NOT_OPEN', `${ipo.company_name} IPO is not open for applications`);
  if (!Number.isInteger(input.lots) || input.lots < ipo.min_lots || input.lots > ipo.max_lots) {
    throw badRequest(`Apply for between ${ipo.min_lots} and ${ipo.max_lots} lots of ${ipo.lot_size} shares`);
  }
  let bid: number;
  if (input.cutoff) {
    bid = ipo.price_band_high;
  } else {
    if (!input.bidPrice) throw badRequest('Enter a bid price or choose the cut-off price');
    if (input.bidPrice % 100 !== 0) throw badRequest('IPO bid price must be in whole rupees');
    if (input.bidPrice < ipo.price_band_low || input.bidPrice > ipo.price_band_high) {
      throw badRequest(`Bid price must be within the price band ${formatInr(ipo.price_band_low)} – ${formatInr(ipo.price_band_high)}`);
    }
    bid = input.bidPrice;
  }
  const quantity = input.lots * ipo.lot_size;
  const amount = quantity * bid;
  const limit = toPaise(getSetting('trading').ipoRetailLimit);
  if (amount > limit) throw badRequest(`Retail applications are limited to ${formatInr(limit)}`);
  return { quantity, bid, amount };
}

export async function applyForIpo(
  userId: number,
  ipoId: number,
  input: IpoApplicationInput,
  pin: string | undefined,
  actor: Actor,
): Promise<ApplicationDto> {
  validateApplication(requireIpo(ipoId), input);
  await verifyTransactionPin(userId, pin, actor, 'IPO_APPLICATION');
  return transaction(() => {
    const ipo = requireIpo(ipoId);
    const { quantity, bid, amount } = validateApplication(ipo, input);
    if (get("SELECT 1 FROM ipo_applications WHERE ipo_id = ? AND user_id = ? AND status = 'APPLIED'", ipoId, userId)) {
      throw conflict('You already have an active application for this IPO. Cancel it to apply again.');
    }
    const available = availableBalance(userId);
    if (available < amount) {
      throw new AppError(422, 'INSUFFICIENT_FUNDS', `Insufficient funds: ${formatInr(amount)} required, ${formatInr(Math.max(0, available))} available`);
    }
    const now = nowIso();
    const applicationNo = referenceCode(`IPO-${ipo.symbol}`, istDate());
    const id = Number(
      run(
        `INSERT INTO ipo_applications (ipo_id, user_id, application_no, quantity, bid_price, is_cutoff, blocked_amount, status,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?, ?)`,
        ipoId,
        userId,
        applicationNo,
        quantity,
        bid,
        input.cutoff ? 1 : 0,
        amount,
        now,
        now,
      ).lastInsertRowid,
    );
    notify(
      userId,
      'IPO',
      'IPO application submitted',
      `Applied for ${quantity} shares of ${ipo.company_name} at ${input.cutoff ? 'cut-off' : formatInr(bid)}. ${formatInr(amount)} is blocked until allotment on ${ipo.allotment_date}.`,
      `/ipo/${ipo.id}`,
    );
    audit({
      actor,
      action: 'IPO_APPLIED',
      subjectUserId: userId,
      entityType: 'IPO_APPLICATION',
      entityId: id,
      details: { ipo: ipo.symbol, quantity, bidPrice: toRupees(bid), cutoff: input.cutoff, amount: toRupees(amount) },
    });
    afterCommit(() => {
      emitToUser(userId, 'ipo');
      emitToUser(userId, 'funds');
    });
    return toApplicationDto(get<ApplicationRow>('SELECT * FROM ipo_applications WHERE id = ?', id)!, ipo);
  });
}

export function cancelIpoApplication(userId: number, applicationId: number, actor: Actor): ApplicationDto {
  return transaction(() => {
    const app = get<ApplicationRow>('SELECT * FROM ipo_applications WHERE id = ? AND user_id = ?', applicationId, userId);
    if (!app) throw notFound('Application not found');
    const ipo = requireIpo(app.ipo_id);
    if (app.status !== 'APPLIED') throw conflict('Only pending applications can be cancelled');
    if (ipoStatus(ipo) !== 'OPEN') throw conflict('Applications can only be cancelled while the IPO is open');
    run(
      "UPDATE ipo_applications SET status = 'CANCELLED', status_reason = 'Cancelled by you', updated_at = ? WHERE id = ?",
      nowIso(),
      app.id,
    );
    notify(userId, 'IPO', 'IPO application cancelled', `Your application for ${ipo.company_name} was cancelled and ${formatInr(app.blocked_amount)} has been released.`, `/ipo/${ipo.id}`);
    audit({ actor, action: 'IPO_APPLICATION_CANCELLED', subjectUserId: userId, entityType: 'IPO_APPLICATION', entityId: app.id, details: { ipo: ipo.symbol } });
    afterCommit(() => {
      emitToUser(userId, 'ipo');
      emitToUser(userId, 'funds');
    });
    return toApplicationDto(get<ApplicationRow>('SELECT * FROM ipo_applications WHERE id = ?', app.id)!, ipo);
  });
}

export function listMyApplications(userId: number): ApplicationDto[] {
  return all<ApplicationRow>('SELECT * FROM ipo_applications WHERE user_id = ? ORDER BY id DESC', userId).map((app) =>
    toApplicationDto(app, requireIpo(app.ipo_id)),
  );
}

export function listIpoApplications(ipoId: number) {
  const ipo = requireIpo(ipoId);
  return all<ApplicationRow & { full_name: string; email: string }>(
    `SELECT a.*, u.full_name, u.email FROM ipo_applications a JOIN users u ON u.id = a.user_id WHERE a.ipo_id = ? ORDER BY a.id`,
    ipoId,
  ).map((app) => ({ ...toApplicationDto(app, ipo), userId: app.user_id, userName: app.full_name, userEmail: app.email }));
}

/** Locks in the final simulated subscription figures (bidding has closed) unless an admin set them by hand. */
function finalizeSubscription(ipo: IpoRow): IpoRow {
  const profile = ipo.demand_profile ? (JSON.parse(ipo.demand_profile) as DemandProfile) : null;
  if (!profile || profile.manual) return ipo;
  run(
    'UPDATE ipos SET subscription_retail = ?, subscription_nii = ?, subscription_qib = ?, updated_at = ? WHERE id = ?',
    profile.retail,
    profile.nii,
    profile.qib,
    nowIso(),
    ipo.id,
  );
  return requireIpo(ipo.id);
}

/**
 * Runs the allotment: when the retail category is oversubscribed, applications enter a lottery and
 * winners receive the minimum lot; otherwise every valid bid is allotted in full. Allotted amounts are
 * debited at the issue price and the rest of the blocked funds is released.
 */
export function allotIpo(ipoId: number, actor: Actor, random: () => number = () => crypto.randomInt(0, 1_000_000) / 1_000_000) {
  return transaction(() => {
    const ipo = requireIpo(ipoId);
    const status = ipoStatus(ipo);
    if (status !== 'CLOSED') throw conflict(`Allotment can only run after the IPO closes (current status: ${status})`);
    const issuePrice = ipo.issue_price ?? ipo.price_band_high;
    const ratio = Math.max(finalizeSubscription(ipo).subscription_retail, 0.0001);
    const applications = all<ApplicationRow>("SELECT * FROM ipo_applications WHERE ipo_id = ? AND status = 'APPLIED' ORDER BY id", ipoId);
    let allottedCount = 0;
    for (const app of applications) {
      const now = nowIso();
      if (!app.is_cutoff && app.bid_price < issuePrice) {
        run(
          "UPDATE ipo_applications SET status = 'NOT_ALLOTTED', status_reason = ?, updated_at = ? WHERE id = ?",
          'Bid price below the final issue price',
          now,
          app.id,
        );
        notify(app.user_id, 'IPO', `${ipo.company_name}: not allotted`, `Your bid was below the issue price of ${formatInr(issuePrice)}. ${formatInr(app.blocked_amount)} has been released.`, `/ipo/${ipo.id}`);
        continue;
      }
      const appliedLots = app.quantity / ipo.lot_size;
      const lots = ratio <= 1 ? appliedLots : random() < 1 / ratio ? ipo.min_lots : 0;
      if (lots > 0) {
        const quantity = lots * ipo.lot_size;
        const debit = quantity * issuePrice;
        run(
          `UPDATE ipo_applications SET status = 'ALLOTTED', status_reason = NULL, allotted_quantity = ?, allotment_price = ?,
             amount_debited = ?, updated_at = ? WHERE id = ?`,
          quantity,
          issuePrice,
          debit,
          now,
          app.id,
        );
        postLedger(app.user_id, {
          type: 'IPO_ALLOTMENT',
          amount: -debit,
          referenceType: 'IPO_APPLICATION',
          referenceId: app.id,
          description: `IPO allotment: ${quantity} ${ipo.symbol} @ ${formatInr(issuePrice)} (${app.application_no})`,
        });
        const refund = app.blocked_amount - debit;
        notify(
          app.user_id,
          'IPO',
          `${ipo.company_name}: shares allotted 🎉`,
          `You were allotted ${quantity} shares at ${formatInr(issuePrice)}. ${formatInr(debit)} debited${refund > 0 ? ` and ${formatInr(refund)} released` : ''}. Shares will be credited on ${ipo.listing_date}.`,
          `/ipo/${ipo.id}`,
        );
        allottedCount++;
      } else {
        run(
          "UPDATE ipo_applications SET status = 'NOT_ALLOTTED', status_reason = ?, updated_at = ? WHERE id = ?",
          `Not selected in the allotment lottery (retail subscribed ${round2(ratio)}x)`,
          now,
          app.id,
        );
        notify(app.user_id, 'IPO', `${ipo.company_name}: not allotted`, `Your application was not selected in the lottery. ${formatInr(app.blocked_amount)} has been released.`, `/ipo/${ipo.id}`);
      }
      audit({
        actor,
        action: 'IPO_ALLOTMENT_RESULT',
        subjectUserId: app.user_id,
        entityType: 'IPO_APPLICATION',
        entityId: app.id,
        details: { ipo: ipo.symbol, allottedQuantity: lots * ipo.lot_size, issuePrice: toRupees(issuePrice) },
      });
      afterCommit(() => {
        emitToUser(app.user_id, 'ipo');
        emitToUser(app.user_id, 'funds');
      });
    }
    run('UPDATE ipos SET allotted_at = ?, issue_price = ?, updated_at = ? WHERE id = ?', nowIso(), issuePrice, nowIso(), ipoId);
    audit({
      actor,
      action: 'IPO_ALLOTTED',
      subjectUserId: null,
      entityType: 'IPO',
      entityId: ipoId,
      details: { symbol: ipo.symbol, applications: applications.length, allotted: allottedCount, issuePrice: toRupees(issuePrice) },
    });
    return { applications: applications.length, allotted: allottedCount };
  });
}

function latestFinancials(ipo: IpoRow) {
  const rows = ipo.financials ? (JSON.parse(ipo.financials) as { revenueCr: number; profitCr: number; assetsCr: number }[]) : [];
  return rows[rows.length - 1];
}

/** Fundamentals for a newly listed company, derived from its offer size and latest financials. */
export function listingFundamentals(ipo: IpoRow, issuePrice: number): Record<string, unknown> {
  const issueShares = Math.round((ipo.issue_size_cr * 1e7) / (issuePrice / 100));
  const shares = Math.round(issueShares / IPO_FLOAT_FRACTION);
  const fin = latestFinancials(ipo);
  const equityCr = fin ? fin.assetsCr * 0.4 : null;
  return {
    face_value: 1000,
    shares_outstanding: shares,
    eps: fin ? Math.round(((fin.profitCr * 1e7) / shares) * 100) : null,
    book_value: equityCr ? Math.round(((equityCr * 1e7) / shares) * 100) : null,
    roe: fin && equityCr ? round2((fin.profitCr / equityCr) * 100) : null,
    beta: 1.1,
    revenue_cr: fin?.revenueCr ?? null,
    net_profit_cr: fin?.profitCr ?? null,
  };
}

/** Creates the tradable security for a newly listed IPO with fundamentals derived from its prospectus. */
function createListedSecurity(ipo: IpoRow, issuePrice: number, listingPrice: number): number {
  const fundamentals = listingFundamentals(ipo, issuePrice);
  const issueShares = Math.round((fundamentals.shares_outstanding as number) * IPO_FLOAT_FRACTION);
  const now = nowIso();
  const tick = tickSizeFor(listingPrice / 100);
  const columns: Record<string, unknown> = {
    symbol: ipo.symbol,
    name: ipo.company_name,
    security_type: 'STOCK',
    exchange: 'NSE',
    sector: ipo.sector,
    industry: ipo.industry,
    description: ipo.description,
    ...fundamentals,
    tick_size: tick,
    circuit_pct: 20,
    volatility: 0.45,
    avg_volume: Math.round(issueShares * 0.15),
    listing_date: currentTradingDate(),
    created_at: now,
    updated_at: now,
  };
  const keys = Object.keys(columns);
  const securityId = Number(
    run(`INSERT INTO securities (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => columns[k]))
      .lastInsertRowid,
  );
  const price = Math.round(listingPrice / tick) * tick;
  run(
    `INSERT INTO quotes (security_id, last_price, prev_close, open, high, low, volume, turnover, trading_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    securityId,
    price,
    issuePrice,
    price,
    price,
    price,
    currentTradingDate(),
    now,
  );
  return securityId;
}

/** Records allotted shares in a user's holdings with an IPO trade at the issue price. */
export function creditAllottedShares(app: ApplicationRow, securityId: number, tradingDate: string = currentTradingDate()): void {
  const now = nowIso();
  const value = app.allotted_quantity * app.allotment_price!;
  run(
    `INSERT INTO holdings (user_id, security_id, quantity, invested, realized_pnl, first_bought_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(user_id, security_id) DO UPDATE SET quantity = quantity + excluded.quantity,
       invested = invested + excluded.invested, updated_at = excluded.updated_at`,
    app.user_id,
    securityId,
    app.allotted_quantity,
    value,
    now,
    now,
  );
  run(
    `INSERT INTO trades (order_id, source, user_id, security_id, side, quantity, price, value, brokerage, stt, exchange_charges,
       sebi_fees, stamp_duty, gst, total_charges, net_amount, realized_pnl, trading_date, executed_at)
     VALUES (NULL, 'IPO', ?, ?, 'BUY', ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, NULL, ?, ?)`,
    app.user_id,
    securityId,
    app.allotted_quantity,
    app.allotment_price,
    value,
    value,
    tradingDate,
    now,
  );
  run('UPDATE ipo_applications SET shares_credited_at = ?, updated_at = ? WHERE id = ?', now, now, app.id);
}

/** Lists the IPO: creates (or links) the security, sets the listing price and credits allottees. */
export function listIpo(ipoId: number, actor: Actor) {
  return transaction(() => {
    const ipo = requireIpo(ipoId);
    const status = ipoStatus(ipo);
    if (status !== 'ALLOTTED') throw conflict(`Only allotted IPOs can be listed (current status: ${status})`);
    const issuePrice = ipo.issue_price ?? ipo.price_band_high;
    const existing = get<{ id: number }>('SELECT id FROM securities WHERE symbol = ?', ipo.symbol);
    let securityId: number;
    let listingPrice: number;
    if (existing) {
      securityId = existing.id;
      listingPrice =
        ipo.listing_price ??
        get<{ open: number }>('SELECT open FROM price_history WHERE security_id = ? ORDER BY date LIMIT 1', securityId)?.open ??
        getQuote(securityId)?.open ??
        issuePrice;
    } else {
      // Listing pop scales with demand, with noise; capped to keep it plausible.
      const demand = Math.min(overallSubscription(ipo), 100);
      const gain = clamp(0.02 + demand * 0.004 + gaussian() * 0.1, -0.2, 0.8);
      listingPrice = ipo.listing_price ?? Math.round(issuePrice * (1 + gain));
      securityId = createListedSecurity(ipo, issuePrice, listingPrice);
      listingPrice = get<{ last_price: number }>('SELECT last_price FROM quotes WHERE security_id = ?', securityId)!.last_price;
    }
    const now = nowIso();
    run('UPDATE ipos SET listed_at = ?, listing_price = ?, security_id = ?, updated_at = ? WHERE id = ?', now, listingPrice, securityId, now, ipoId);

    const allottees = all<ApplicationRow>(
      "SELECT * FROM ipo_applications WHERE ipo_id = ? AND status = 'ALLOTTED' AND shares_credited_at IS NULL",
      ipoId,
    );
    for (const app of allottees) {
      creditAllottedShares(app, securityId);
      notify(
        app.user_id,
        'IPO',
        `${ipo.company_name} listed`,
        `${ipo.symbol} listed at ${formatInr(listingPrice)} (${changePercent(listingPrice, issuePrice)}% vs issue price). ${app.allotted_quantity} shares were credited to your holdings.`,
        `/stocks/${encodeURIComponent(ipo.symbol)}`,
      );
      afterCommit(() => {
        emitToUser(app.user_id, 'portfolio');
        emitToUser(app.user_id, 'ipo');
      });
    }
    audit({
      actor,
      action: 'IPO_LISTED',
      subjectUserId: null,
      entityType: 'IPO',
      entityId: ipoId,
      details: { symbol: ipo.symbol, listingPrice: toRupees(listingPrice), issuePrice: toRupees(issuePrice), credited: allottees.length },
    });
    afterCommit(() => {
      invalidateSecurityCache();
      reloadQuote(securityId);
    });
    return { securityId, listingPrice: toRupees(listingPrice), credited: allottees.length };
  });
}

/** Fraction of the bidding window that has elapsed (0 before opening, 1 after closing). */
function biddingProgress(ipo: IpoRow, at: number): number {
  const start = istDayStart(ipo.open_date);
  const end = istDayEnd(ipo.close_date);
  return clamp((at - start) / (end - start), 0, 1);
}

/**
 * Simulated market demand: subscriptions build up over the bidding window, with institutions bidding
 * mostly on the last day, converging to the issue's demand profile.
 */
export function simulateSubscriptions(at: number = nowMs()): void {
  for (const ipo of all<IpoRow>('SELECT * FROM ipos WHERE allotted_at IS NULL AND withdrawn_at IS NULL')) {
    const status = ipoStatus(ipo, istDate(at));
    if (status !== 'OPEN' && status !== 'CLOSED') continue;
    const profile = ipo.demand_profile ? (JSON.parse(ipo.demand_profile) as DemandProfile) : null;
    if (!profile || profile.manual) continue;
    const p = biddingProgress(ipo, at);
    const retail = round2(profile.retail * p ** 1.6);
    const nii = round2(profile.nii * p ** 2.5);
    const qib = round2(profile.qib * p ** 3.2);
    if (retail === ipo.subscription_retail && nii === ipo.subscription_nii && qib === ipo.subscription_qib) continue;
    run(
      'UPDATE ipos SET subscription_retail = ?, subscription_nii = ?, subscription_qib = ?, updated_at = ? WHERE id = ?',
      retail,
      nii,
      qib,
      nowIso(),
      ipo.id,
    );
  }
}

/** Scheduled job: announces newly opened IPOs and runs allotment and listing when their dates arrive. */
export function processIpoLifecycle(): void {
  const today = istDate();
  simulateSubscriptions();
  for (const ipo of all<IpoRow>('SELECT * FROM ipos WHERE withdrawn_at IS NULL AND listed_at IS NULL')) {
    const status = ipoStatus(ipo, today);
    try {
      if (status === 'OPEN' && !ipo.open_notified_at) {
        transaction(() => {
          run('UPDATE ipos SET open_notified_at = ? WHERE id = ?', nowIso(), ipo.id);
          notifyAllUsers(
            'IPO',
            `${ipo.company_name} IPO is open`,
            `Bid between ${formatInr(ipo.price_band_low)} and ${formatInr(ipo.price_band_high)} in lots of ${ipo.lot_size} shares until ${ipo.close_date}.`,
            `/ipo/${ipo.id}`,
          );
        });
      } else if (status === 'CLOSED' && ipo.allotment_date <= today) {
        allotIpo(ipo.id, SYSTEM_ACTOR);
      } else if (status === 'ALLOTTED' && ipo.listing_date <= today) {
        listIpo(ipo.id, SYSTEM_ACTOR);
      }
    } catch (err) {
      console.error(`IPO lifecycle step failed for ${ipo.symbol}`, err);
    }
  }
}

export interface IpoInput {
  companyName: string;
  symbol: string;
  issueType: 'MAINBOARD' | 'SME';
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  priceBandLow: number;
  priceBandHigh: number;
  lotSize: number;
  minLots: number;
  maxLots: number;
  issueSizeCr: number;
  freshIssueCr: number;
  ofsCr: number;
  openDate: string;
  closeDate: string;
  allotmentDate: string;
  refundDate?: string | null;
  listingDate: string;
  demand?: { retail: number; nii: number; qib: number } | null;
  financials?: { year: string; revenueCr: number; profitCr: number; assetsCr: number }[];
  registrar?: string | null;
  leadManagers?: string[];
}

function validateIpoInput(input: IpoInput): void {
  if (input.priceBandLow > input.priceBandHigh) throw badRequest('The lower end of the price band cannot exceed the upper end');
  if (!(input.openDate <= input.closeDate && input.closeDate <= input.allotmentDate && input.allotmentDate <= input.listingDate)) {
    throw badRequest('Dates must be in order: open ≤ close ≤ allotment ≤ listing');
  }
  if (input.minLots > input.maxLots) throw badRequest('Minimum lots cannot exceed maximum lots');
}

function randomDemand(): DemandProfile {
  const base = Math.exp(gaussian() * 0.9 + 1.6);
  return { retail: round2(base), nii: round2(base * (1.5 + Math.random() * 2)), qib: round2(base * (2 + Math.random() * 5)) };
}

export function createIpo(input: IpoInput, actor: Actor): IpoDto {
  validateIpoInput(input);
  if (get('SELECT 1 FROM ipos WHERE symbol = ?', input.symbol) || get('SELECT 1 FROM securities WHERE symbol = ?', input.symbol)) {
    throw conflict(`Symbol ${input.symbol} is already in use`);
  }
  return transaction(() => {
    const now = nowIso();
    const id = Number(
      run(
        `INSERT INTO ipos (company_name, symbol, issue_type, sector, industry, description, price_band_low, price_band_high, lot_size,
           min_lots, max_lots, issue_size_cr, fresh_issue_cr, ofs_cr, open_date, close_date, allotment_date, refund_date,
           listing_date, demand_profile, financials, registrar, lead_managers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.companyName,
        input.symbol,
        input.issueType,
        input.sector ?? null,
        input.industry ?? null,
        input.description ?? null,
        input.priceBandLow,
        input.priceBandHigh,
        input.lotSize,
        input.minLots,
        input.maxLots,
        input.issueSizeCr,
        input.freshIssueCr,
        input.ofsCr,
        input.openDate,
        input.closeDate,
        input.allotmentDate,
        input.refundDate ?? null,
        input.listingDate,
        JSON.stringify(input.demand ? { ...input.demand, manual: false } : randomDemand()),
        JSON.stringify(input.financials ?? []),
        input.registrar ?? null,
        JSON.stringify(input.leadManagers ?? []),
        now,
        now,
      ).lastInsertRowid,
    );
    audit({ actor, action: 'IPO_CREATED', subjectUserId: null, entityType: 'IPO', entityId: id, details: { symbol: input.symbol, companyName: input.companyName } });
    return toIpoDto(requireIpo(id));
  });
}

export function updateIpo(ipoId: number, input: Partial<IpoInput>, actor: Actor): IpoDto {
  return transaction(() => {
    const ipo = requireIpo(ipoId);
    const status = ipoStatus(ipo);
    if (status === 'ALLOTTED' || status === 'LISTED' || status === 'WITHDRAWN') {
      throw conflict(`An IPO that is ${status.toLowerCase()} can no longer be edited`);
    }
    const hasApplications = Boolean(get("SELECT 1 FROM ipo_applications WHERE ipo_id = ? AND status = 'APPLIED'", ipoId));
    const pricingChanged =
      (input.priceBandLow !== undefined && input.priceBandLow !== ipo.price_band_low) ||
      (input.priceBandHigh !== undefined && input.priceBandHigh !== ipo.price_band_high) ||
      (input.lotSize !== undefined && input.lotSize !== ipo.lot_size);
    if (hasApplications && pricingChanged) throw conflict('Price band and lot size cannot change once applications exist');
    const merged: IpoInput = {
      companyName: input.companyName ?? ipo.company_name,
      symbol: ipo.symbol,
      issueType: input.issueType ?? ipo.issue_type,
      sector: input.sector === undefined ? ipo.sector : input.sector,
      industry: input.industry === undefined ? ipo.industry : input.industry,
      description: input.description === undefined ? ipo.description : input.description,
      priceBandLow: input.priceBandLow ?? ipo.price_band_low,
      priceBandHigh: input.priceBandHigh ?? ipo.price_band_high,
      lotSize: input.lotSize ?? ipo.lot_size,
      minLots: input.minLots ?? ipo.min_lots,
      maxLots: input.maxLots ?? ipo.max_lots,
      issueSizeCr: input.issueSizeCr ?? ipo.issue_size_cr,
      freshIssueCr: input.freshIssueCr ?? ipo.fresh_issue_cr,
      ofsCr: input.ofsCr ?? ipo.ofs_cr,
      openDate: input.openDate ?? ipo.open_date,
      closeDate: input.closeDate ?? ipo.close_date,
      allotmentDate: input.allotmentDate ?? ipo.allotment_date,
      refundDate: input.refundDate === undefined ? ipo.refund_date : input.refundDate,
      listingDate: input.listingDate ?? ipo.listing_date,
      registrar: input.registrar === undefined ? ipo.registrar : input.registrar,
      leadManagers: input.leadManagers ?? (ipo.lead_managers ? JSON.parse(ipo.lead_managers) : []),
      financials: input.financials ?? (ipo.financials ? JSON.parse(ipo.financials) : []),
    };
    validateIpoInput(merged);
    run(
      `UPDATE ipos SET company_name = ?, issue_type = ?, sector = ?, industry = ?, description = ?, price_band_low = ?,
         price_band_high = ?, lot_size = ?, min_lots = ?, max_lots = ?, issue_size_cr = ?, fresh_issue_cr = ?, ofs_cr = ?,
         open_date = ?, close_date = ?, allotment_date = ?, refund_date = ?, listing_date = ?, registrar = ?, lead_managers = ?,
         financials = ?, updated_at = ?
       WHERE id = ?`,
      merged.companyName,
      merged.issueType,
      merged.sector,
      merged.industry,
      merged.description,
      merged.priceBandLow,
      merged.priceBandHigh,
      merged.lotSize,
      merged.minLots,
      merged.maxLots,
      merged.issueSizeCr,
      merged.freshIssueCr,
      merged.ofsCr,
      merged.openDate,
      merged.closeDate,
      merged.allotmentDate,
      merged.refundDate,
      merged.listingDate,
      merged.registrar,
      JSON.stringify(merged.leadManagers),
      JSON.stringify(merged.financials),
      nowIso(),
      ipoId,
    );
    audit({ actor, action: 'IPO_UPDATED', subjectUserId: null, entityType: 'IPO', entityId: ipoId, details: { fields: Object.keys(input) } });
    return toIpoDto(requireIpo(ipoId));
  });
}

/** Admin override of subscription figures; stops the demand simulation for this IPO. */
export function setSubscription(ipoId: number, values: { retail: number; nii: number; qib: number }, actor: Actor): IpoDto {
  return transaction(() => {
    const ipo = requireIpo(ipoId);
    if (ipo.allotted_at) throw conflict('Subscription figures are final after allotment');
    run(
      'UPDATE ipos SET subscription_retail = ?, subscription_nii = ?, subscription_qib = ?, demand_profile = ?, updated_at = ? WHERE id = ?',
      values.retail,
      values.nii,
      values.qib,
      JSON.stringify({ ...values, manual: true }),
      nowIso(),
      ipoId,
    );
    audit({ actor, action: 'IPO_SUBSCRIPTION_UPDATED', subjectUserId: null, entityType: 'IPO', entityId: ipoId, details: values });
    return toIpoDto(requireIpo(ipoId));
  });
}

/** Withdraws an issue before allotment and releases every pending application. */
export function withdrawIpo(ipoId: number, reason: string, actor: Actor): IpoDto {
  return transaction(() => {
    const ipo = requireIpo(ipoId);
    const status = ipoStatus(ipo);
    if (status === 'ALLOTTED' || status === 'LISTED' || status === 'WITHDRAWN') {
      throw conflict(`An IPO that is ${status.toLowerCase()} cannot be withdrawn`);
    }
    const now = nowIso();
    const pending = all<ApplicationRow>("SELECT * FROM ipo_applications WHERE ipo_id = ? AND status = 'APPLIED'", ipoId);
    for (const app of pending) {
      run("UPDATE ipo_applications SET status = 'CANCELLED', status_reason = ?, updated_at = ? WHERE id = ?", `IPO withdrawn: ${reason}`, now, app.id);
      notify(app.user_id, 'IPO', `${ipo.company_name} IPO withdrawn`, `The issue was withdrawn (${reason}). ${formatInr(app.blocked_amount)} has been released.`, `/ipo/${ipo.id}`);
      afterCommit(() => {
        emitToUser(app.user_id, 'ipo');
        emitToUser(app.user_id, 'funds');
      });
    }
    run('UPDATE ipos SET withdrawn_at = ?, updated_at = ? WHERE id = ?', now, now, ipoId);
    audit({ actor, action: 'IPO_WITHDRAWN', subjectUserId: null, entityType: 'IPO', entityId: ipoId, details: { reason, releasedApplications: pending.length } });
    return toIpoDto(requireIpo(ipoId));
  });
}

export function listAllIposForAdmin(): IpoDto[] {
  return all<IpoRow>('SELECT * FROM ipos ORDER BY open_date DESC').map((row) => ({
    ...toIpoDto(row),
    applicationsCount: get<{ n: number }>('SELECT COUNT(*) AS n FROM ipo_applications WHERE ipo_id = ?', row.id)!.n,
  }));
}
