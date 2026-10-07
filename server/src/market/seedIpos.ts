import { all, get, run } from '../db/index.js';
import { nowIso } from '../lib/clock.js';
import { addWeekdays, istDate, istDayStart } from '../lib/time.js';
import { ipoStatus, listingFundamentals, simulateSubscriptions, type IpoRow } from '../services/ipo.service.js';
import { IPOS } from './ipoCatalog.js';
import { addSimulatedStock } from './seedMarket.js';

/** ISO timestamp for a time of day (IST) on a given date. */
function istTime(date: string, hours: number): string {
  return new Date(istDayStart(date) + hours * 3_600_000).toISOString();
}

/** Seeds the IPO pipeline relative to today; already-listed issues get a security with trading history. */
export function seedIpos(): void {
  if (get<{ n: number }>('SELECT COUNT(*) AS n FROM ipos')!.n > 0) return;
  const today = istDate();
  for (const seed of IPOS) {
    const open = addWeekdays(today, seed.schedule.open);
    const close = addWeekdays(today, seed.schedule.close);
    const allotment = addWeekdays(today, seed.schedule.allotment);
    const listing = addWeekdays(today, seed.schedule.listing);
    const now = nowIso();
    const id = Number(
      run(
        `INSERT INTO ipos (company_name, symbol, issue_type, sector, industry, description, price_band_low, price_band_high, lot_size,
           min_lots, max_lots, issue_size_cr, fresh_issue_cr, ofs_cr, open_date, close_date, allotment_date, refund_date, listing_date,
           demand_profile, financials, registrar, lead_managers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        seed.companyName,
        seed.symbol,
        seed.issueType,
        seed.sector,
        seed.industry,
        seed.description,
        seed.priceBand[0] * 100,
        seed.priceBand[1] * 100,
        seed.lotSize,
        seed.maxLots,
        seed.issueSizeCr,
        seed.freshIssueCr,
        seed.ofsCr,
        open,
        close,
        allotment,
        allotment,
        listing,
        JSON.stringify({ ...seed.demand, manual: false }),
        JSON.stringify(seed.financials),
        seed.registrar,
        JSON.stringify(seed.leadManagers),
        now,
        now,
      ).lastInsertRowid,
    );
    const row = get<IpoRow>('SELECT * FROM ipos WHERE id = ?', id)!;
    if (ipoStatus(row, today) !== 'UPCOMING' && ipoStatus(row, today) !== 'OPEN') {
      run(
        'UPDATE ipos SET subscription_retail = ?, subscription_nii = ?, subscription_qib = ?, open_notified_at = ? WHERE id = ?',
        seed.demand.retail,
        seed.demand.nii,
        seed.demand.qib,
        istTime(open, 10),
        id,
      );
    }
    if (seed.currentPrice && listing <= today) {
      const issuePrice = seed.priceBand[1] * 100;
      const { securityId, listingOpen } = addSimulatedStock({
        symbol: seed.symbol,
        name: seed.companyName,
        sector: seed.sector,
        industry: seed.industry,
        description: seed.description,
        price: seed.currentPrice,
        volatility: 0.42,
        beta: 1.1,
        avgVolume: Math.round(((seed.issueSizeCr * 1e7) / seed.priceBand[1]) * 0.05),
        listingDate: listing,
        fundamentals: listingFundamentals(row, issuePrice),
      });
      run(
        `UPDATE ipos SET issue_price = ?, listing_price = ?, allotted_at = ?, listed_at = ?, security_id = ? WHERE id = ?`,
        issuePrice,
        listingOpen,
        istTime(allotment, 18),
        istTime(listing, 10),
        securityId,
        id,
      );
    }
  }
  simulateSubscriptions();
}

export function seededIpoIds(): Record<string, number> {
  return Object.fromEntries(all<{ id: number; symbol: string }>('SELECT id, symbol FROM ipos').map((r) => [r.symbol, r.id]));
}
