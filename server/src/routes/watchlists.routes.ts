import { Router } from 'express';
import { z } from 'zod';
import { idParam, parse, symbolParam } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { actorFrom } from '../services/actor.js';
import {
  addToWatchlist,
  createWatchlist,
  deleteWatchlist,
  listWatchlists,
  removeFromWatchlist,
  renameWatchlist,
} from '../services/watchlist.service.js';

const router = Router();
const nameSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(40, 'Name is too long') });

router.get('/', (req, res) => {
  res.json({ watchlists: listWatchlists(currentUser(req).id) });
});

router.post('/', (req, res) => {
  const { name } = parse(nameSchema, req.body);
  res.status(201).json({ watchlist: createWatchlist(currentUser(req).id, name, actorFrom(req)) });
});

router.patch('/:id', (req, res) => {
  const { name } = parse(nameSchema, req.body);
  res.json({ watchlist: renameWatchlist(currentUser(req).id, parse(idParam(), req.params.id), name, actorFrom(req)) });
});

router.delete('/:id', (req, res) => {
  deleteWatchlist(currentUser(req).id, parse(idParam(), req.params.id), actorFrom(req));
  res.json({ ok: true });
});

router.post('/:id/items', (req, res) => {
  const { symbol } = parse(z.object({ symbol: symbolParam() }), req.body);
  res.status(201).json({ watchlist: addToWatchlist(currentUser(req).id, parse(idParam(), req.params.id), symbol, actorFrom(req)) });
});

router.delete('/:id/items/:symbol', (req, res) => {
  const watchlist = removeFromWatchlist(
    currentUser(req).id,
    parse(idParam(), req.params.id),
    parse(symbolParam(), req.params.symbol),
    actorFrom(req),
  );
  res.json({ watchlist });
});

export default router;
