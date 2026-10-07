import { get, run, transaction } from '../db/index.js';
import { freezeTime, nowIso, resetTime } from '../lib/clock.js';
import { hashSecret, referenceCode } from '../lib/crypto.js';
import { toPaise } from '../lib/money.js';
import { addWeekdays, istDate, istDayStart } from '../lib/time.js';
import { getQuoteBySymbol } from '../market/quoteStore.js';
import { SYSTEM_ACTOR, type Actor } from '../services/actor.js';
import { sendAnnouncement, setUserStatus } from '../services/admin.service.js';
import { createAlert } from '../services/alert.service.js';
import { audit } from '../services/audit.service.js';
import { createUser } from '../services/auth.service.js';
import { deposit, postLedger } from '../services/funds.service.js';
import { allotIpo, applyForIpo, creditAllottedShares, type ApplicationRow } from '../services/ipo.service.js';
import { notify } from '../services/notification.service.js';
import { cancelOrder, placeOrderConfirmed, type OrderSide } from '../services/order.service.js';
import { saveBankAccount } from '../services/profile.service.js';
import { addToWatchlist, createWatchlist } from '../services/watchlist.service.js';

export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@example.com', password: 'Admin@12345', pin: '1357' },
  investor: { email: 'demo@example.com', password: 'Demo@12345', pin: '2468' },
};

/** The real current date, captured before the seeder starts moving the clock around. */
let seedDay = '';

/** Freezes the clock at a time of day (IST) on the weekday `weekdaysAgo` before the seeding day. */
function at(weekdaysAgo: number, hour = 10, minute = 0): string {
  const date = addWeekdays(seedDay, -weekdaysAgo);
  freezeTime(istDayStart(date) + (hour * 60 + minute) * 60_000);
  return date;
}

function actorFor(userId: number): Actor {
  return { userId, role: 'USER', ip: '103.21.58.14', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' };
}

/** Closing price of a security on (or before) a date, in paise. */
function closeOn(symbol: string, date: string): number {
  const quote = getQuoteBySymbol(symbol)!;
  if (date >= quote.tradingDate) return quote.last;
  return (
    get<{ close: number }>('SELECT close FROM price_history WHERE security_id = ? AND date <= ? ORDER BY date DESC LIMIT 1', quote.securityId, date)
      ?.close ?? quote.last
  );
}

function trade(userId: number, date: string, symbol: string, side: OrderSide, quantity: number) {
  placeOrderConfirmed(userId, { symbol, side, orderType: 'MARKET', quantity }, actorFor(userId), {
    tradingDate: date,
    price: closeOn(symbol, date),
  });
}

async function createInvestor(input: { fullName: string; email: string; phone: string; password: string; pin: string; role?: 'USER' | 'ADMIN' }) {
  const userId = await createUser({ ...input });
  const pinHash = await hashSecret(input.pin);
  run('UPDATE users SET pin_hash = ? WHERE id = ?', pinHash, userId);
  audit({ actor: actorFor(userId), action: 'USER_REGISTERED', entityType: 'USER', entityId: userId, details: { email: input.email } });
  notify(userId, 'SYSTEM', 'Welcome to StockSphere', 'Your account is ready. Add money and set a transaction PIN to start investing.', '/funds');
  return userId;
}

function ipoId(symbol: string): number {
  return get<{ id: number }>('SELECT id FROM ipos WHERE symbol = ?', symbol)!.id;
}

/** Records an application for an issue that has already completed (seeded as listed). */
function historicalApplication(userId: number, symbol: string, lots: number, appliedOn: number, allotted: boolean) {
  const ipo = get<{ id: number; lot_size: number; price_band_high: number; allotment_date: string; listing_date: string; security_id: number; company_name: string }>(
    'SELECT * FROM ipos WHERE symbol = ?',
    symbol,
  )!;
  const quantity = lots * ipo.lot_size;
  const amount = quantity * ipo.price_band_high;
  at(appliedOn, 11, 15);
  const appId = Number(
    run(
      `INSERT INTO ipo_applications (ipo_id, user_id, application_no, quantity, bid_price, is_cutoff, blocked_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'APPLIED', ?, ?)`,
      ipo.id,
      userId,
      referenceCode(`IPO-${symbol}`, istDate()),
      quantity,
      ipo.price_band_high,
      amount,
      nowIso(),
      nowIso(),
    ).lastInsertRowid,
  );
  audit({ actor: actorFor(userId), action: 'IPO_APPLIED', entityType: 'IPO_APPLICATION', entityId: appId, details: { ipo: symbol, quantity, cutoff: true } });

  freezeTime(istDayStart(ipo.allotment_date) + 18 * 3_600_000);
  if (allotted) {
    run(
      `UPDATE ipo_applications SET status = 'ALLOTTED', allotted_quantity = ?, allotment_price = ?, amount_debited = ?, updated_at = ? WHERE id = ?`,
      quantity,
      ipo.price_band_high,
      amount,
      nowIso(),
      appId,
    );
    postLedger(userId, { type: 'IPO_ALLOTMENT', amount: -amount, referenceType: 'IPO_APPLICATION', referenceId: appId, description: `IPO allotment: ${quantity} ${symbol}` });
    notify(userId, 'IPO', `${ipo.company_name}: shares allotted 🎉`, `You were allotted ${quantity} shares. They will be credited on ${ipo.listing_date}.`, `/ipo/${ipo.id}`);
    freezeTime(istDayStart(ipo.listing_date) + 9 * 3_600_000);
    const app = get<ApplicationRow>('SELECT * FROM ipo_applications WHERE id = ?', appId)!;
    creditAllottedShares(app, ipo.security_id, ipo.listing_date);
    notify(userId, 'IPO', `${ipo.company_name} listed`, `${quantity} ${symbol} shares were credited to your holdings.`, `/stocks/${symbol}`);
  } else {
    run(
      `UPDATE ipo_applications SET status = 'NOT_ALLOTTED', status_reason = ?, updated_at = ? WHERE id = ?`,
      'Not selected in the allotment lottery',
      nowIso(),
      appId,
    );
    notify(userId, 'IPO', `${ipo.company_name}: not allotted`, 'Your application was not selected in the lottery. Blocked funds have been released.', `/ipo/${ipo.id}`);
  }
}

function roundTick(symbol: string, paise: number): number {
  const tick = getQuoteBySymbol(symbol)!.tickSize;
  return Math.round(paise / tick) * tick;
}

/**
 * Creates an admin, a demo investor with seven months of realistic activity, and a few other users.
 * Runs once, on an empty database, after the market and IPOs are seeded and the quote store is loaded.
 */
export async function seedDemoData(): Promise<void> {
  if (get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n > 0) return;
  seedDay = istDate();
  try {
    // ---- Accounts --------------------------------------------------------------------------------
    at(150, 9, 30);
    const adminId = await createInvestor({ fullName: 'Platform Admin', email: DEMO_ACCOUNTS.admin.email, phone: '9000000001', password: DEMO_ACCOUNTS.admin.password, pin: DEMO_ACCOUNTS.admin.pin, role: 'ADMIN' });
    const admin: Actor = { userId: adminId, role: 'ADMIN', ip: '10.0.0.5', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15' };

    at(150, 10);
    const demo = await createInvestor({ fullName: 'Aditi Verma', email: DEMO_ACCOUNTS.investor.email, phone: '9876543210', password: DEMO_ACCOUNTS.investor.password, pin: DEMO_ACCOUNTS.investor.pin });
    run(
      `UPDATE users SET date_of_birth = '1992-03-14', pan = 'ABCPV1234K', address = '12, Palm Grove Road, Indiranagar, Bengaluru 560038' WHERE id = ?`,
      demo,
    );
    saveBankAccount(demo, { accountHolder: 'Aditi Verma', accountNumber: '50100234567890', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' }, actorFor(demo));

    const rahul = await createInvestor({ fullName: 'Rahul Mehta', email: 'rahul@example.com', phone: '9812345678', password: 'Rahul@12345', pin: '4826' });
    const priya = await createInvestor({ fullName: 'Priya Nair', email: 'priya@example.com', phone: '9823456789', password: 'Priya@12345', pin: '5937' });

    // ---- Demo investor history -------------------------------------------------------------------
    at(150, 10, 20);
    deposit(demo, toPaise(600_000), 'NETBANKING', actorFor(demo));
    let date = at(145, 10, 30);
    for (const [symbol, qty] of [['RELIANCE', 40], ['TCS', 15], ['HDFCBANK', 80], ['ITC', 250], ['INFY', 40]] as const) trade(demo, date, symbol, 'BUY', qty);

    at(110, 9, 45);
    deposit(demo, toPaise(300_000), 'UPI', actorFor(demo));
    date = at(110, 11);
    for (const [symbol, qty] of [['NIFTYBEES', 300], ['GOLDBEES', 500], ['BHARTIARTL', 30], ['SUNPHARMA', 25]] as const) trade(demo, date, symbol, 'BUY', qty);

    date = at(80, 13);
    trade(demo, date, 'TITAN', 'BUY', 10);
    trade(demo, date, 'LT', 'BUY', 15);

    date = at(60, 14, 10);
    trade(demo, date, 'INFY', 'SELL', 20);

    historicalApplication(demo, 'QUANTUMMED', 1, 47, false);
    historicalApplication(demo, 'VISTAARLOG', 1, 23, true);

    at(20, 10);
    deposit(demo, toPaise(200_000), 'UPI', actorFor(demo));
    date = at(20, 10, 30);
    trade(demo, date, 'BEL', 'BUY', 150);
    trade(demo, date, 'EMBASSY', 'BUY', 100);

    // A price alert that already fired.
    at(15, 12);
    const infy = getQuoteBySymbol('INFY')!;
    const alertTarget = roundTick('INFY', closeOn('INFY', addWeekdays(seedDay, -10)) - 500);
    const alertId = Number(
      run(
        `INSERT INTO price_alerts (user_id, security_id, condition, target_price, status, note, created_at, updated_at)
         VALUES (?, ?, 'ABOVE', ?, 'ACTIVE', 'Book partial profits', ?, ?)`,
        demo,
        infy.securityId,
        alertTarget,
        nowIso(),
        nowIso(),
      ).lastInsertRowid,
    );
    at(10, 14, 5);
    run("UPDATE price_alerts SET status = 'TRIGGERED', triggered_price = ?, triggered_at = ?, updated_at = ? WHERE id = ?", alertTarget + 500, nowIso(), nowIso(), alertId);
    notify(demo, 'PRICE_ALERT', 'INFY price alert', 'INFY has risen above your target price. Note: Book partial profits', '/stocks/INFY');

    at(7, 16);
    sendAnnouncement('Price alerts are live', 'Set above/below alerts on any stock and get notified the moment your price is hit.', '/alerts', admin);

    // Current IPO pipeline: an allotted application and a pending one.
    at(5, 11);
    await applyForIpo(demo, ipoId('ORBITAERO'), { lots: 1, cutoff: true }, DEMO_ACCOUNTS.investor.pin, actorFor(demo));
    at(3, 12);
    await applyForIpo(demo, ipoId('KAVERIAGRO'), { lots: 2, cutoff: true }, DEMO_ACCOUNTS.investor.pin, actorFor(demo));
    date = at(1, 11, 40);
    trade(demo, date, 'ICICIBANK', 'BUY', 30);
    at(1, 18);
    allotIpo(ipoId('ORBITAERO'), SYSTEM_ACTOR, () => 0);

    // ---- Other investors ---------------------------------------------------------------------------
    at(90, 9, 50);
    deposit(rahul, toPaise(200_000), 'NETBANKING', actorFor(rahul));
    date = at(85, 10);
    trade(rahul, date, 'TCS', 'BUY', 20);
    trade(rahul, date, 'INFY', 'BUY', 30);
    trade(rahul, date, 'HDFCBANK', 'BUY', 40);
    date = at(30, 15);
    trade(rahul, date, 'TCS', 'SELL', 5);

    at(40, 11);
    deposit(priya, toPaise(150_000), 'UPI', actorFor(priya));
    date = at(38, 11, 30);
    trade(priya, date, 'ETERNAL', 'BUY', 300);
    trade(priya, date, 'NIFTYBEES', 'BUY', 200);
    trade(priya, date, 'TRENT', 'BUY', 5);

    at(5, 15);
    const karan = await createInvestor({ fullName: 'Karan Singh', email: 'karan@example.com', phone: '9834567890', password: 'Karan@12345', pin: '6048' });
    at(2, 11);
    setUserStatus(karan, 'SUSPENDED', 'KYC documents could not be verified', admin);
  } finally {
    resetTime();
  }

  // ---- Today: open orders, watchlists and alerts at live prices ---------------------------------------
  const demo = get<{ id: number }>('SELECT id FROM users WHERE email = ?', DEMO_ACCOUNTS.investor.email)!.id;
  const priya = get<{ id: number }>('SELECT id FROM users WHERE email = ?', 'priya@example.com')!.id;
  const actor = actorFor(demo);
  transaction(() => {
    const sbin = getQuoteBySymbol('SBIN')!;
    placeOrderConfirmed(demo, { symbol: 'SBIN', side: 'BUY', orderType: 'LIMIT', quantity: 50, limitPrice: roundTick('SBIN', sbin.last * 0.98) }, actor);
    const itc = getQuoteBySymbol('ITC')!;
    placeOrderConfirmed(demo, { symbol: 'ITC', side: 'SELL', orderType: 'LIMIT', quantity: 100, limitPrice: roundTick('ITC', itc.last * 1.03) }, actor);
    const tata = getQuoteBySymbol('TATASTEEL')!;
    const cancelled = placeOrderConfirmed(demo, { symbol: 'TATASTEEL', side: 'BUY', orderType: 'LIMIT', quantity: 200, limitPrice: roundTick('TATASTEEL', tata.last * 0.95) }, actor);
    cancelOrder(cancelled.id, demo, actor);

    const [defaultList] = [get<{ id: number }>('SELECT id FROM watchlists WHERE user_id = ? ORDER BY id LIMIT 1', demo)!];
    for (const symbol of ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'BAJFINANCE', 'TATASTEEL', 'ETERNAL', 'ADANIENT']) addToWatchlist(demo, defaultList!.id, symbol, actor);
    const banking = createWatchlist(demo, 'Banking', actor);
    for (const symbol of ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BANKBEES']) addToWatchlist(demo, banking.id, symbol, actor);
    const funds = createWatchlist(demo, 'ETFs & REITs', actor);
    for (const symbol of ['NIFTYBEES', 'GOLDBEES', 'SILVERBEES', 'MON100', 'EMBASSY', 'INDIGRID']) addToWatchlist(demo, funds.id, symbol, actor);

    const alertAt = (symbol: string, factor: number) => roundTick(symbol, getQuoteBySymbol(symbol)!.last * factor);
    createAlert(demo, { symbol: 'RELIANCE', condition: 'ABOVE', targetPrice: alertAt('RELIANCE', 1.03), note: 'Breakout above recent range' }, actor);
    createAlert(demo, { symbol: 'TCS', condition: 'BELOW', targetPrice: alertAt('TCS', 0.96), note: 'Add on dips' }, actor);
    createAlert(demo, { symbol: 'GOLDBEES', condition: 'ABOVE', targetPrice: alertAt('GOLDBEES', 1.02) }, actor);
    createAlert(demo, { symbol: 'TATASTEEL', condition: 'BELOW', targetPrice: alertAt('TATASTEEL', 0.97) }, actor);

    const priyaList = get<{ id: number }>('SELECT id FROM watchlists WHERE user_id = ? ORDER BY id LIMIT 1', priya)!;
    for (const symbol of ['ETERNAL', 'TRENT', 'DMART', 'NIFTYBEES']) addToWatchlist(priya, priyaList.id, symbol, actorFor(priya));
  });
  await applyForIpo(priya, ipoId('NIMBUS'), { lots: 1, cutoff: true }, '5937', actorFor(priya));

  // Older notifications have been seen; keep the latest few unread.
  run(
    `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id NOT IN (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 6)`,
    demo,
    demo,
  );
}
