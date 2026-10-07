# StockSphere

A full-stack stock market application where investors manage their investments: trade stocks and ETFs with
market and limit orders, track a live portfolio, apply for IPOs, manage funds, set price alerts and follow
the market. An admin panel manages users, securities, IPOs, orders and transactions, backed by a tamper-evident
audit trail.

> **All market data is simulated.** Prices, indices, IPO subscriptions and company financials are generated for
> demonstration and are not investment advice. No real money moves: deposits and withdrawals are simulated too.

- User stories, acceptance criteria and traceability: [`docs/USER_STORIES.md`](docs/USER_STORIES.md)

## Features

| Area | What you can do | Stories |
| ---- | --------------- | ------- |
| Accounts | Register, sign in and out, edit your profile and bank account | US-01 – US-04 |
| Security | Server-side sessions you can list and revoke, CSRF protection, account lockout, a transaction PIN for money-moving actions, idle sign-out | US-05 – US-07 |
| Dashboard | Portfolio value and P&L, performance chart, indices, movers, watchlist, recent orders and funds, all updating live | US-08 |
| Markets | NIFTY 50, SENSEX and sector indices with constituents; top gainers, losers, most active, sector performance and market breadth | US-09, US-10 |
| Search and details | Type-ahead search across stocks, ETFs, REITs, InvITs and indices; price charts (1D – 5Y, line or candles), company information and key metrics | US-11, US-12 |
| Trading | Market and limit orders (DAY or IOC) with a charges preview; modify and cancel open orders; order history and executed trades | US-13 – US-16 |
| Portfolio | Holdings with average price, invested amount, current value, P&L and returns; allocation; realized P&L; performance over time | US-17, US-18 |
| Watchlists | Several watchlists with live prices and quick buy, sell and alert actions | US-19 |
| Alerts and notifications | Price alerts above or below a target; real-time notifications for orders, IPOs, alerts, funds and account activity, with per-category muting | US-20, US-21 |
| IPOs | Upcoming, open and closed issues with price band, lot size, subscription and dates; apply at a bid price or the cut-off; allotment, refunds and listing | US-22 – US-24 |
| Funds | Add money (UPI, net banking, card) and withdraw to a bank account; total, available, blocked and withdrawable balances | US-25 – US-27 |
| Statements | Ledger with opening and closing balances, running balance and filters; CSV export of the ledger and trades | US-28 |
| Admin panel | Users (suspend, unlock, sign out everywhere, adjust funds), securities (edit, halt, reprice), IPOs (create, allot, list, withdraw), orders, transactions, platform settings and announcements | US-29 – US-33 |
| Audit trail | Append-only, hash-chained log of every user, admin and system action, with filters and an integrity check; each investor sees their own activity | US-34, US-35 |

## Tech stack

| Layer    | Technology |
| -------- | ---------- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, Lightweight Charts |
| Backend  | Node.js 22, Express 5, TypeScript, Zod |
| Database | SQLite (better-sqlite3, WAL mode) |
| Realtime | Server-Sent Events |
| Testing  | Vitest and supertest (API), Playwright (end to end) |

## Getting started

Requires Node.js 22.12 or newer (see `.nvmrc`).

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173 (Vite proxies `/api` to the server)
- API: http://localhost:4000/api

In development the database is created at `server/data/stocksphere.db` and seeded with demo data on first start:

| Account  | Email               | Password      | Transaction PIN |
| -------- | ------------------- | ------------- | --------------- |
| Investor | `demo@example.com`  | `Demo@12345`  | `2468`          |
| Admin    | `admin@example.com` | `Admin@12345` | `1357`          |

The demo investor has holdings, order history, IPO applications, watchlists and alerts. You can also register a
new account, add money on the Funds page and set a transaction PIN under Profile → Security before trading.

### Scripts

Run from the repository root.

| Command | Description |
| ------- | ----------- |
| `npm run dev` | API server (with reload) and Vite dev server together |
| `npm run build` | Build the client into `client/dist` and compile the server into `server/dist` |
| `npm start` | Run the built server; it also serves the built client |
| `npm test` | API tests (Vitest, in-memory database) |
| `npm run test:e2e` | Build, then run the Playwright end-to-end tests against the production server |
| `npm run typecheck` | Type-check the server, the client and the end-to-end tests |
| `npm run db:reset` | Delete the local database; it is recreated (and re-seeded) on the next start |
| `npm run promote-admin -- <email>` | Give an existing user the admin role |

## Configuration

The server reads environment variables, and `server/.env` when present (copy
[`server/.env.example`](server/.env.example)).

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `4000` | HTTP port |
| `NODE_ENV` | `development` | `production` enables secure cookies, HSTS and hides demo credentials from the log |
| `DATABASE_PATH` | `data/stocksphere.db` | SQLite file, relative to `server/`; `:memory:` for a throwaway database |
| `SEED_DEMO_DATA` | `true`, but `false` in production | Create the demo accounts and history on first start. Their passwords are public, so only enable this for demos |
| `COOKIE_SECURE` | `true` in production | Mark the session cookie `Secure` and send HSTS. Set to `false` only when serving plain HTTP |
| `TRUST_PROXY` | `0` | Number of reverse-proxy hops to trust for the client IP |
| `SESSION_IDLE_MINUTES` | `120` | Session expires after this long without activity |
| `SESSION_MAX_HOURS` | `168` | Absolute session lifetime |
| `MARKET_SIMULATION` | `true` | Run the simulated price feed |
| `TICK_INTERVAL_MS` | `2000` | Interval between simulated price ticks |
| `RATE_LIMIT` | `true` | Rate-limit the API and the authentication endpoints |

Brokerage and statutory charges, deposit and withdrawal limits, the maximum order quantity and the IPO retail
limit are platform settings that admins change at runtime under Admin → Settings.

## Production

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

The server serves the API and the built client from one origin, with a strict Content Security Policy. In
production no demo accounts are created, so promote the first registered user to admin:

```bash
node server/dist/cli/promote-admin.js you@example.com   # or: npm run promote-admin -- you@example.com
```

Serve it over HTTPS behind a reverse proxy. The CSRF check compares the browser's `Origin` with the request host,
so the proxy must preserve the `Host` header or set `X-Forwarded-Host`. Set `TRUST_PROXY=1` so rate limits and the
audit trail see the client's IP, and allow long-lived responses on `/api/stream` (disable response buffering).

### Docker

```bash
docker compose up --build
```

The [`Dockerfile`](Dockerfile) builds a production image that stores the database in the `/data` volume. The
[`docker-compose.yml`](docker-compose.yml) runs it on http://localhost:4000 with demo data and plain-HTTP cookies
for a local demo; remove `SEED_DEMO_DATA` and `COOKIE_SECURE` from it for a real deployment behind HTTPS.

## Architecture

```
client/            React single-page app
  src/pages/       One component per screen (admin screens in pages/admin)
  src/components/  UI kit, layout, charts, market widgets and the order ticket
  src/live/        Event-stream client: live quotes, notifications and cache updates
server/
  src/routes/      Express routers, one per API area
  src/services/    Business logic: auth, sessions, orders, funds, IPOs, alerts, notifications, audit
  src/market/      Security catalogue, price simulation and IPO catalogue
  src/jobs/        Scheduler for the IPO lifecycle and session clean-up
  src/db/          SQLite connection and migrations
  tests/           API tests
e2e/               Playwright end-to-end tests
docs/              User stories
```

- **Money** is stored as integer paise and exposed by the API in rupees; dates follow Indian Standard Time.
- **Market simulation**: prices follow a random walk with daily drift, bounded by circuit limits; indices are
  computed from their weighted constituents and index ETFs track their index. The simulated market is open around
  the clock, and the trading day rolls over at midnight IST, when DAY orders expire and daily candles are stored.
- **Orders**: market orders fill at the last traded price; limit orders fill immediately when marketable,
  otherwise they stay open with funds blocked (buy) or shares reserved (sell) and fill when the price crosses the
  limit. Every fill posts ledger entries for the trade value and for its brokerage and charges.
- **IPOs** move from upcoming to open, closed, allotted and listed on their scheduled dates. Oversubscribed
  issues are allotted by lottery, unallotted amounts are released, and shares are credited on listing.
- **Real-time updates**: the server pushes quotes, order updates, notifications and session revocations over
  `GET /api/stream`. Events are emitted only after their database transaction commits.

### API overview

All endpoints are under `/api` and use JSON. Everything except `/health` and `/auth/register`, `/auth/login`
and `/auth/me` requires a session.

| Area | Endpoints |
| ---- | --------- |
| Auth and sessions | `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me`, `/auth/sessions`; `DELETE /auth/sessions/:id`; `POST /auth/sessions/revoke-others` |
| Profile | `GET`, `PATCH /profile`; `POST /profile/password`, `/profile/pin`; `PUT /profile/bank-account`, `/profile/notification-preferences`; `GET /profile/activity` |
| Market | `GET /market/overview`, `/market/indices`, `/market/movers`, `/market/sectors`, `/market/breadth`, `/market/status` |
| Securities | `GET /securities`, `/securities/search`, `/securities/quotes`, `/securities/sectors`, `/securities/:symbol`, `/securities/:symbol/history`, `/securities/:symbol/constituents` |
| Orders and trades | `POST /orders/preview`, `/orders`; `GET /orders`, `/orders/:id`; `PATCH /orders/:id`; `POST /orders/:id/cancel`; `GET /trades` |
| Portfolio | `GET /portfolio`, `/portfolio/performance` |
| Funds and statements | `GET /funds`, `/funds/transactions`; `POST /funds/deposit`, `/funds/withdraw`; `GET /statements`, `/statements/ledger.csv`, `/statements/trades.csv` |
| Watchlists and alerts | `/watchlists` (create, rename, delete, add and remove items); `/alerts` (create, update, delete) |
| Notifications | `GET /notifications`, `/notifications/unread-count`; `POST /notifications/:id/read`, `/notifications/read-all`; `DELETE /notifications/:id` |
| IPOs | `GET /ipos`, `/ipos/:id`, `/ipos/applications`; `POST /ipos/:id/apply`, `/ipos/applications/:id/cancel` |
| Live updates | `GET /stream` (Server-Sent Events) |
| Admin | `/admin/overview`, `/admin/users`, `/admin/securities`, `/admin/ipos`, `/admin/orders`, `/admin/trades`, `/admin/ledger`, `/admin/fund-transactions`, `/admin/audit-logs`, `/admin/settings`, `/admin/announcements` |

Errors use one shape: `{ "error": { "code": "…", "message": "…", "details": { "fields": { … } } } }`.

## Security

- Passwords and transaction PINs are hashed with scrypt and a per-user salt.
- Sessions live on the server. The cookie is HttpOnly, SameSite=Lax and Secure in production. Sessions expire
  when idle and after a maximum lifetime, the app signs out after 30 minutes without interaction, and users can
  revoke any session. Changing the password signs out every other session.
- State-changing requests must come from the same origin and carry the session's CSRF token.
- Five failed sign-ins lock the account for 15 minutes; five wrong PINs block PIN use for 30 minutes. The API
  and the authentication endpoints are rate limited.
- Orders, order changes, IPO applications and withdrawals are confirmed with the transaction PIN.
- Helmet sets security headers, including a Content Security Policy that allows no inline scripts.
- The audit trail is append-only (database triggers reject updates and deletes) and each entry stores a hash of
  the previous one, so tampering is detectable with Admin → Audit trail → Verify integrity.

## Testing

```bash
npm test            # API tests
npm run test:e2e    # end-to-end tests (builds first)
npm run typecheck
```

The end-to-end tests start the built server on port 4300 (override with `E2E_PORT`) with an in-memory database
and demo data, and drive Chromium through registration, trading, funds, watchlists and alerts, IPOs and the admin
panel. If Playwright's browser is not installed, run `npx playwright install chromium`, or point
`PLAYWRIGHT_CHROMIUM_PATH` at an existing Chromium binary.

## License

MIT
