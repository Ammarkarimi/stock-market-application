import { beforeAll, describe, expect, it } from 'vitest';
import { all, get } from '../src/db/index.js';
import { currentTradingDate, rollover, setPrice } from '../src/market/engine.js';
import { getQuoteBySymbol } from '../src/market/quoteStore.js';
import { addDays } from '../src/lib/time.js';
import { DEFAULT_PIN, registerClient, registerWithPin, type TestClient } from './helpers.js';
import { setupMarket } from './setup-market.js';

beforeAll(() => setupMarket());

const price = (symbol: string) => getQuoteBySymbol(symbol)!.last / 100;

async function fundedClient(amount = 500_000) {
  const { client, user } = await registerWithPin();
  const res = await client.post('/api/funds/deposit', { amount, method: 'UPI' });
  expect(res.status).toBe(201);
  return { client, user };
}

async function order(client: TestClient, body: Record<string, unknown>) {
  return client.post('/api/orders', { validity: 'DAY', pin: DEFAULT_PIN, ...body });
}

describe('funds', () => {
  it('adds money with a ledger entry and notification', async () => {
    const { client, user } = await registerWithPin();
    const res = await client.post('/api/funds/deposit', { amount: 25_000.5, method: 'NETBANKING' });
    expect(res.status).toBe(201);
    expect(res.body.transaction.reference).toMatch(/^DEP-\d{8}-[A-Z0-9]{6}$/);
    expect(res.body.funds).toMatchObject({ cashBalance: 25_000.5, availableBalance: 25_000.5 });
    const ledger = all<{ entry_type: string; amount: number }>('SELECT entry_type, amount FROM ledger_entries WHERE user_id = ?', user.id);
    expect(ledger).toEqual([{ entry_type: 'DEPOSIT', amount: 2_500_050 }]);
    expect((await client.get('/api/notifications/unread-count')).status).toBeLessThan(500);
  });

  it('enforces deposit limits', async () => {
    const { client } = await registerWithPin();
    expect((await client.post('/api/funds/deposit', { amount: 50, method: 'UPI' })).status).toBe(400);
    expect((await client.post('/api/funds/deposit', { amount: 2_000_000, method: 'UPI' })).status).toBe(400);
    expect((await client.post('/api/funds/deposit', { amount: 100.123, method: 'UPI' })).status).toBe(400);
  });

  it('requires a bank account and the correct PIN to withdraw', async () => {
    const { client } = await fundedClient(10_000);
    const noBank = await client.post('/api/funds/withdraw', { amount: 1_000, pin: DEFAULT_PIN });
    expect(noBank.body.error.code).toBe('BANK_ACCOUNT_REQUIRED');

    await client.put('/api/profile/bank-account', {
      accountHolder: 'Test User',
      accountNumber: '123456789012',
      ifsc: 'HDFC0001234',
      bankName: 'HDFC Bank',
    });
    const wrongPin = await client.post('/api/funds/withdraw', { amount: 1_000, pin: '9999' });
    expect(wrongPin.status).toBe(403);
    expect(wrongPin.body.error.message).toMatch(/4 attempts left/);

    const tooMuch = await client.post('/api/funds/withdraw', { amount: 20_000, pin: DEFAULT_PIN });
    expect(tooMuch.status).toBe(422);

    const ok = await client.post('/api/funds/withdraw', { amount: 1_000, pin: DEFAULT_PIN });
    expect(ok.status).toBe(201);
    expect(ok.body.transaction.bankAccount).toBe('HDFC Bank XXXXXXXX9012');
    expect(ok.body.funds.cashBalance).toBe(9_000);
  });

  it('locks PIN use after five wrong attempts', async () => {
    const { client } = await fundedClient(10_000);
    for (let i = 0; i < 4; i++) {
      expect((await order(client, { symbol: 'ITC', side: 'BUY', orderType: 'MARKET', quantity: 1, pin: '0000' })).status).toBe(403);
    }
    expect((await order(client, { symbol: 'ITC', side: 'BUY', orderType: 'MARKET', quantity: 1, pin: '0000' })).status).toBe(423);
    expect((await order(client, { symbol: 'ITC', side: 'BUY', orderType: 'MARKET', quantity: 1 })).status).toBe(423);
  });
});

describe('orders', () => {
  it('requires a transaction PIN to be set', async () => {
    const { client } = await registerClient();
    const res = await order(client, { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', quantity: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PIN_NOT_SET');
  });

  it('previews charges and executes a market buy', async () => {
    const { client, user } = await fundedClient();
    const preview = await client.post('/api/orders/preview', { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', quantity: 10 });
    expect(preview.status).toBe(200);
    expect(preview.body.canPlace).toBe(true);
    expect(preview.body.charges.total).toBeGreaterThan(0);
    expect(preview.body.totalAmount).toBeCloseTo(preview.body.value + preview.body.charges.total, 2);

    const ltp = price('TCS');
    const res = await order(client, { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', quantity: 10 });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'EXECUTED', filledQuantity: 10, averagePrice: ltp });

    const portfolio = await client.get('/api/portfolio');
    expect(portfolio.body.holdings).toHaveLength(1);
    expect(portfolio.body.holdings[0]).toMatchObject({ symbol: 'TCS', quantity: 10, averagePrice: ltp });

    const trade = get<{ net_amount: number; total_charges: number; value: number }>('SELECT * FROM trades WHERE user_id = ?', user.id)!;
    expect(trade.net_amount).toBe(trade.value + trade.total_charges);
    const funds = await client.get('/api/funds');
    expect(funds.body.cashBalance).toBeCloseTo(500_000 - trade.net_amount / 100, 2);
    const types = all<{ entry_type: string }>('SELECT entry_type FROM ledger_entries WHERE user_id = ? ORDER BY id', user.id).map((r) => r.entry_type);
    expect(types).toEqual(['DEPOSIT', 'BUY', 'CHARGES']);
  });

  it('rejects orders that exceed funds or holdings, and blocks short selling', async () => {
    const { client } = await fundedClient(1_000);
    const buy = await order(client, { symbol: 'MARUTI', side: 'BUY', orderType: 'MARKET', quantity: 1 });
    expect(buy.status).toBe(201);
    expect(buy.body.order.status).toBe('REJECTED');
    expect(buy.body.order.statusReason).toMatch(/Insufficient funds/);

    const sell = await order(client, { symbol: 'ITC', side: 'SELL', orderType: 'MARKET', quantity: 1 });
    expect(sell.body.order.status).toBe('REJECTED');
    expect(sell.body.order.statusReason).toBe('Insufficient holdings');
  });

  it('sells holdings and books realized P&L', async () => {
    const { client } = await fundedClient();
    await order(client, { symbol: 'INFY', side: 'BUY', orderType: 'MARKET', quantity: 20 });
    const infy = getQuoteBySymbol('INFY')!;
    const buyPrice = infy.last;
    setPrice(infy.securityId, Math.round(buyPrice * 1.04));
    const sell = await order(client, { symbol: 'INFY', side: 'SELL', orderType: 'MARKET', quantity: 5 });
    expect(sell.body.order.status).toBe('EXECUTED');
    const trades = await client.get('/api/trades?side=SELL');
    expect(trades.body.items[0].realizedPnl).toBeCloseTo(((getQuoteBySymbol('INFY')!.last - buyPrice) * 5) / 100, 2);
    const portfolio = await client.get('/api/portfolio');
    expect(portfolio.body.holdings[0].quantity).toBe(15);
    expect(portfolio.body.summary.realizedPnl).toBeGreaterThan(0);
  });

  it('keeps a non-marketable limit buy open, blocks funds and fills when the price drops', async () => {
    const { client } = await fundedClient(100_000);
    const sbin = getQuoteBySymbol('SBIN')!;
    const limit = Math.round((sbin.last * 0.98) / 5) * 5;
    const res = await order(client, { symbol: 'SBIN', side: 'BUY', orderType: 'LIMIT', quantity: 50, limitPrice: limit / 100 });
    expect(res.body.order.status).toBe('OPEN');
    const funds = await client.get('/api/funds');
    expect(funds.body.blockedForOrders).toBeGreaterThan((50 * limit) / 100);
    expect(funds.body.availableBalance).toBeCloseTo(100_000 - funds.body.blockedForOrders, 2);

    setPrice(sbin.securityId, limit - 10);
    const after = await client.get(`/api/orders/${res.body.order.id}`);
    expect(after.body.order.status).toBe('EXECUTED');
    expect(after.body.order.averagePrice).toBe(limit / 100);
    expect(after.body.trade.quantity).toBe(50);
    expect(after.body.timeline.map((t: { action: string }) => t.action)).toEqual(['ORDER_PLACED', 'ORDER_EXECUTED']);
    expect((await client.get('/api/funds')).body.blockedForOrders).toBe(0);
  });

  it('reserves shares for open sell orders', async () => {
    const { client } = await fundedClient();
    await order(client, { symbol: 'WIPRO', side: 'BUY', orderType: 'MARKET', quantity: 10 });
    const wipro = getQuoteBySymbol('WIPRO')!;
    const high = (wipro.last + 500) / 100;
    const first = await order(client, { symbol: 'WIPRO', side: 'SELL', orderType: 'LIMIT', quantity: 8, limitPrice: high });
    expect(first.body.order.status).toBe('OPEN');
    const second = await order(client, { symbol: 'WIPRO', side: 'SELL', orderType: 'LIMIT', quantity: 5, limitPrice: high });
    expect(second.body.order.status).toBe('REJECTED');
    const holdings = (await client.get('/api/portfolio')).body.holdings;
    expect(holdings[0].freeQuantity).toBe(2);
  });

  it('modifies an open order and executes it when it becomes marketable', async () => {
    const { client } = await fundedClient(200_000);
    const itc = getQuoteBySymbol('ITC')!;
    const low = Math.round((itc.last * 0.95) / itc.tickSize) * itc.tickSize;
    const placed = await order(client, { symbol: 'ITC', side: 'BUY', orderType: 'LIMIT', quantity: 10, limitPrice: low / 100 });
    const id = placed.body.order.id;

    const noPin = await client.patch(`/api/orders/${id}`, { quantity: 20 });
    expect(noPin.status).toBe(400);
    const modified = await client.patch(`/api/orders/${id}`, { quantity: 20, limitPrice: (low - itc.tickSize) / 100, pin: DEFAULT_PIN });
    expect(modified.body.order).toMatchObject({ status: 'OPEN', quantity: 20, limitPrice: (low - itc.tickSize) / 100 });

    const toMarket = await client.patch(`/api/orders/${id}`, { orderType: 'MARKET', pin: DEFAULT_PIN });
    expect(toMarket.body.order.status).toBe('EXECUTED');
    expect((await client.patch(`/api/orders/${id}`, { quantity: 5, pin: DEFAULT_PIN })).status).toBe(409);
  });

  it('cancels open orders and releases blocked funds', async () => {
    const { client } = await fundedClient(100_000);
    const hdfc = getQuoteBySymbol('HDFCBANK')!;
    const placed = await order(client, { symbol: 'HDFCBANK', side: 'BUY', orderType: 'LIMIT', quantity: 10, limitPrice: Math.round(hdfc.last * 0.9 / 5) * 5 / 100 });
    expect((await client.get('/api/funds')).body.blockedForOrders).toBeGreaterThan(0);
    const cancelled = await client.post(`/api/orders/${placed.body.order.id}/cancel`);
    expect(cancelled.body.order.status).toBe('CANCELLED');
    expect((await client.get('/api/funds')).body.blockedForOrders).toBe(0);
    expect((await client.post(`/api/orders/${placed.body.order.id}/cancel`)).status).toBe(409);
  });

  it('cancels IOC orders that cannot execute and validates price inputs', async () => {
    const { client } = await fundedClient(100_000);
    const lt = getQuoteBySymbol('LT')!;
    const ioc = await order(client, { symbol: 'LT', side: 'BUY', orderType: 'LIMIT', validity: 'IOC', quantity: 1, limitPrice: (lt.last - 1000) / 100 });
    expect(ioc.body.order).toMatchObject({ status: 'CANCELLED', statusReason: 'IOC order could not be executed immediately' });

    const offTick = await order(client, { symbol: 'LT', side: 'BUY', orderType: 'LIMIT', quantity: 1, limitPrice: lt.last / 100 + 0.03 });
    expect(offTick.status).toBe(400);
    const outsideBand = await order(client, { symbol: 'LT', side: 'BUY', orderType: 'LIMIT', quantity: 1, limitPrice: Math.round(lt.prevClose * 0.5 / 5) * 5 / 100 });
    expect(outsideBand.body.order.status).toBe('REJECTED');
    expect(outsideBand.body.order.statusReason).toMatch(/circuit/);
    expect((await order(client, { symbol: 'NIFTY50', side: 'BUY', orderType: 'MARKET', quantity: 1 })).status).toBe(400);
  });

  it('expires open DAY orders at the end of the trading day', async () => {
    const { client } = await fundedClient(100_000);
    const cipla = getQuoteBySymbol('CIPLA')!;
    const placed = await order(client, { symbol: 'CIPLA', side: 'BUY', orderType: 'LIMIT', quantity: 5, limitPrice: Math.round(cipla.last * 0.9 / 5) * 5 / 100 });
    rollover(addDays(currentTradingDate(), 1));
    const after = await client.get(`/api/orders/${placed.body.order.id}`);
    expect(after.body.order.status).toBe('EXPIRED');
    expect((await client.get('/api/funds')).body.blockedForOrders).toBe(0);
  });
});

describe('portfolio and statements', () => {
  it('summarises holdings, allocation and performance', async () => {
    const { client } = await fundedClient();
    await order(client, { symbol: 'RELIANCE', side: 'BUY', orderType: 'MARKET', quantity: 10 });
    await order(client, { symbol: 'NIFTYBEES', side: 'BUY', orderType: 'MARKET', quantity: 100 });
    const res = await client.get('/api/portfolio');
    const { summary, holdings, allocation } = res.body;
    expect(summary.holdingsCount).toBe(2);
    expect(summary.currentValue).toBeCloseTo(holdings.reduce((s: number, h: { currentValue: number }) => s + h.currentValue, 0), 2);
    expect(allocation.byType.map((t: { name: string }) => t.name).sort()).toEqual(['ETF', 'STOCK']);
    const perf = await client.get('/api/portfolio/performance?range=1M');
    expect(perf.status).toBe(200);
    expect(perf.body.points[perf.body.points.length - 1].value).toBeCloseTo(summary.currentValue, 0);
  });

  it('produces an account statement and CSV exports', async () => {
    const { client } = await fundedClient(50_000);
    await order(client, { symbol: 'ITC', side: 'BUY', orderType: 'MARKET', quantity: 10 });
    const statement = await client.get('/api/statements');
    expect(statement.body.openingBalance).toBe(0);
    expect(statement.body.totalCredits).toBe(50_000);
    expect(statement.body.closingBalance).toBeCloseTo(50_000 - statement.body.totalDebits, 2);
    expect(statement.body.entries.map((e: { type: string }) => e.type)).toEqual(['DEPOSIT', 'BUY', 'CHARGES']);
    const csv = await client.get('/api/statements/ledger.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('Date,Type,Description,Reference,Debit (INR),Credit (INR),Balance (INR)');
    // An earlier test rolled the simulated trading day forward, so include it explicitly.
    const trades = await client.get(`/api/statements/trades.csv?from=${addDays(currentTradingDate(), -1)}&to=${currentTradingDate()}`);
    expect(trades.text).toMatch(/ITC,BUY,10/);
  });
});
