import { Router } from 'express';
import { z } from 'zod';
import { toPaise } from '../lib/money.js';
import { dateString, idParam, paginationQuery, parse, rupees, symbolParam } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { actorFrom } from '../services/actor.js';
import {
  cancelOrder,
  getOrderDetail,
  listOrders,
  modifyOrder,
  ORDER_STATUSES,
  placeOrder,
  previewOrder,
} from '../services/order.service.js';

const router = Router();

const orderSchema = z.object({
  symbol: symbolParam(),
  side: z.enum(['BUY', 'SELL']),
  orderType: z.enum(['MARKET', 'LIMIT']),
  quantity: z.number().int('Quantity must be a whole number').positive('Quantity must be at least 1'),
  limitPrice: rupees().nullable().optional(),
  validity: z.enum(['DAY', 'IOC']).default('DAY'),
});

const pin = z.string().max(10).optional();

function toOrderInput(body: z.infer<typeof orderSchema>) {
  return { ...body, limitPrice: body.limitPrice ? toPaise(body.limitPrice) : null };
}

router.post('/preview', (req, res) => {
  const body = parse(orderSchema, req.body);
  res.json(previewOrder(currentUser(req).id, toOrderInput(body)));
});

router.post('/', async (req, res) => {
  const body = parse(orderSchema.extend({ pin }), req.body);
  const order = await placeOrder(currentUser(req).id, toOrderInput(body), body.pin, actorFrom(req));
  res.status(201).json({ order });
});

router.get('/', (req, res) => {
  const query = parse(
    z.object({
      status: z.enum(ORDER_STATUSES as [string, ...string[]]).optional(),
      side: z.enum(['BUY', 'SELL']).optional(),
      symbol: symbolParam().optional(),
      from: dateString().optional(),
      to: dateString().optional(),
      ...paginationQuery,
    }),
    req.query,
  );
  const page = listOrders({ ...query, status: query.status as never, userId: currentUser(req).id });
  res.json({ ...page, items: page.items.map(({ userId: _u, userName: _n, ...order }) => order) });
});

router.get('/:id', (req, res) => {
  res.json(getOrderDetail(parse(idParam(), req.params.id), currentUser(req).id));
});

router.patch('/:id', async (req, res) => {
  const body = parse(
    z
      .object({
        quantity: z.number().int().positive().optional(),
        limitPrice: rupees().optional(),
        orderType: z.enum(['MARKET', 'LIMIT']).optional(),
        pin,
      })
      .refine((v) => v.quantity !== undefined || v.limitPrice !== undefined || v.orderType !== undefined, 'Nothing to modify'),
    req.body,
  );
  const order = await modifyOrder(
    currentUser(req).id,
    parse(idParam(), req.params.id),
    { quantity: body.quantity, limitPrice: body.limitPrice ? toPaise(body.limitPrice) : undefined, orderType: body.orderType },
    body.pin,
    actorFrom(req),
  );
  res.json({ order });
});

router.post('/:id/cancel', (req, res) => {
  const order = cancelOrder(parse(idParam(), req.params.id), currentUser(req).id, actorFrom(req));
  res.json({ order });
});

export default router;
