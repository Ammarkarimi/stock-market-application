import { Router } from 'express';
import { z } from 'zod';
import { toCsv } from '../lib/csv.js';
import { badRequest } from '../lib/errors.js';
import { addDays, istDate } from '../lib/time.js';
import { dateString, parse } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { actorFrom } from '../services/actor.js';
import { audit } from '../services/audit.service.js';
import { getStatement, LEDGER_ENTRY_TYPES } from '../services/funds.service.js';
import { listTrades } from '../services/order.service.js';

const router = Router();

const periodSchema = z.object({
  from: dateString().optional(),
  to: dateString().optional(),
  type: z.enum(LEDGER_ENTRY_TYPES as [string, ...string[]]).optional(),
});

function period(query: unknown) {
  const parsed = parse(periodSchema, query);
  const to = parsed.to ?? istDate();
  const from = parsed.from ?? addDays(to, -30);
  if (from > to) throw badRequest('The start date must be on or before the end date');
  return { from, to, type: parsed.type as (typeof LEDGER_ENTRY_TYPES)[number] | undefined };
}

router.get('/', (req, res) => {
  const { from, to, type } = period(req.query);
  res.json(getStatement(currentUser(req).id, from, to, type));
});

router.get('/ledger.csv', (req, res) => {
  const { from, to, type } = period(req.query);
  const statement = getStatement(currentUser(req).id, from, to, type);
  const csv = toCsv(
    ['Date', 'Type', 'Description', 'Reference', 'Debit (INR)', 'Credit (INR)', 'Balance (INR)'],
    statement.entries.map((e) => [
      e.createdAt,
      e.type,
      e.description,
      e.referenceType ? `${e.referenceType} #${e.referenceId}` : '',
      e.debit ? e.debit.toFixed(2) : '',
      e.credit ? e.credit.toFixed(2) : '',
      e.balanceAfter.toFixed(2),
    ]),
  );
  audit({ actor: actorFrom(req), action: 'STATEMENT_DOWNLOADED', entityType: 'STATEMENT', details: { kind: 'ledger', from, to } });
  res.attachment(`statement_${from}_${to}.csv`).type('text/csv').send(csv);
});

router.get('/trades.csv', (req, res) => {
  const { from, to } = period(req.query);
  const trades = listTrades({ userId: currentUser(req).id, from, to, page: 1, pageSize: 100_000 });
  const csv = toCsv(
    ['Date', 'Trade ID', 'Order ID', 'Source', 'Symbol', 'Side', 'Quantity', 'Price', 'Value', 'Charges', 'Net Amount', 'Realized P&L'],
    trades.items.map((t) => [
      t.executedAt,
      t.id,
      t.orderId,
      t.source,
      t.symbol,
      t.side,
      t.quantity,
      t.price.toFixed(2),
      t.value.toFixed(2),
      t.charges.total.toFixed(2),
      t.netAmount.toFixed(2),
      t.realizedPnl === null ? '' : t.realizedPnl.toFixed(2),
    ]),
  );
  audit({ actor: actorFrom(req), action: 'STATEMENT_DOWNLOADED', entityType: 'STATEMENT', details: { kind: 'trades', from, to } });
  res.attachment(`trades_${from}_${to}.csv`).type('text/csv').send(csv);
});

export default router;
