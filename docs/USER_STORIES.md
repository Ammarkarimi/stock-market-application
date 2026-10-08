# User Stories

Minimal user stories for every feature of **StockSphere**, a stock market application for managing investments.
Each story has a short list of acceptance criteria (AC) that the implementation is checked against.

**Roles**

| Role     | Description                                                        |
| -------- | ------------------------------------------------------------------ |
| Visitor  | Someone who is not signed in                                       |
| Investor | A registered, signed-in user                                       |
| Admin    | A platform operator with access to the admin panel                 |
| System   | Automated processes (price feed, order matching, IPO lifecycle)    |

> Prices, indices, history and company fundamentals are real NSE/BSE data from Yahoo Finance (about 15 minutes
> delayed). Trading uses virtual money (paper trading), and IPOs are simulated.

---

## Epic 1 — Accounts

**US-01 Registration**
As a visitor, I want to register with my name, email, phone and password, so that I can open an account.
- Email must be unique; password needs at least 8 characters with a letter and a number.
- A new account starts with a ₹0 balance and a default watchlist.
- I am signed in after registering, and the registration is recorded in the audit trail.

**US-02 Login**
As an investor, I want to log in with my email and password, so that I can access my account.
- Wrong credentials show a generic error that does not reveal whether the email exists.
- Five consecutive failures lock the account for 15 minutes.
- Every login creates a security notification with the device and IP.

**US-03 Logout**
As an investor, I want to log out, so that nobody else can use my session on this device.
- The session is invalidated on the server and the cookie is cleared.
- Protected pages redirect to the login page afterwards.

**US-04 Profile management**
As an investor, I want to view and edit my personal details and bank account, so that my information stays current.
- Name, phone, date of birth, address and PAN are editable; email is read-only.
- A bank account (holder, account number, IFSC, bank name) is required before withdrawing.
- Every change is recorded in the audit trail.

## Epic 2 — Security

**US-05 Secure authentication**
As an investor, I want my credentials handled securely, so that my account cannot easily be compromised.
- Passwords and PINs are stored as salted scrypt hashes.
- Session cookies are HttpOnly and SameSite; state-changing requests need a CSRF token.
- Authentication endpoints are rate limited.
- Changing the password requires the current password and signs out all other sessions.

**US-06 Session management**
As an investor, I want to see and revoke my active sessions, so that I control which devices can access my account.
- The list shows device, IP address and last activity, and marks the current session.
- I can revoke a single session or all other sessions.
- Sessions expire after a period of inactivity and after a maximum lifetime.
- The app signs me out after 30 minutes without interaction.

**US-07 Transaction confirmation**
As an investor, I want to review and confirm money-moving actions with a transaction PIN, so that unauthorized actions are prevented.
- Placing or modifying an order, applying for an IPO and withdrawing funds show a review summary and require a 4-digit PIN.
- Five wrong PIN attempts block PIN use for 30 minutes.
- I can set or change the PIN from my profile after re-entering my password.

## Epic 3 — Dashboard

**US-08 Dashboard**
As an investor, I want a dashboard with my portfolio, the market, my watchlist, recent orders and available funds, so that I get an overview at a glance.
- Shows current value, invested amount, total and day's P&L, and a portfolio performance chart.
- Shows market indices, top movers, my watchlist, my latest orders and available funds.
- Prices update live without refreshing the page.

## Epic 4 — Market data

**US-09 Market indices**
As an investor, I want to view indices such as NIFTY 50 and SENSEX, so that I can gauge the overall market.
- Each index shows its value, change and % change, updated live.
- An index page shows its chart and its constituents.

**US-10 Movers and trends**
As an investor, I want to see top gainers, top losers, most active stocks and market trends, so that I can spot opportunities.
- Gainers and losers are ranked by % change; most active by volume and by traded value.
- Sector performance shows the average change of each sector.
- Market breadth shows advancing, declining and unchanged stocks.

## Epic 5 — Search and security details

**US-11 Search securities**
As an investor, I want to search stocks, ETFs and other securities by symbol or name, so that I can find what to invest in.
- The top bar offers type-ahead search from any page.
- The search page filters by type (Stock, ETF, REIT, InvIT, Index) and by sector.

**US-12 Security details**
As an investor, I want to see a security's price, changes, history, chart, company information and key metrics, so that I can make informed decisions.
- The chart supports 1D, 1W, 1M, 3M, 6M, 1Y and 5Y ranges in line and candlestick modes.
- Metrics include market cap, P/E, P/B, EPS, dividend yield, ROE, debt/equity, beta, 52-week high/low, day range and volume.
- If I hold the security, my position and its P&L are shown.

## Epic 6 — Trading

**US-13 Market orders**
As an investor, I want to buy or sell at the market price, so that my order executes immediately.
- The order executes at the last traded price.
- A buy needs enough available funds including charges; a sell is limited to my free holdings (no short selling).
- A charges breakdown is shown before I confirm.

**US-14 Limit orders**
As an investor, I want to place limit orders, so that I trade only at my price or better.
- A marketable limit order executes immediately; otherwise it stays Open and executes when the price crosses the limit.
- An open buy blocks funds; an open sell reserves shares.
- DAY orders expire at the end of the trading day; IOC orders are cancelled if they cannot execute immediately.
- The limit price must respect the tick size and the daily circuit limits.

**US-15 Modify and cancel orders**
As an investor, I want to modify or cancel my open orders, so that I can react to the market.
- Only Open orders can be modified (quantity, price, order type) or cancelled.
- Blocked funds and reserved shares are adjusted or released accordingly.
- A modification is confirmed with my PIN.

**US-16 Order status and history**
As an investor, I want to see my open orders, order history and executed trades, so that I can track my activity.
- Statuses are Open, Executed, Cancelled, Rejected and Expired, with a reason where relevant.
- History can be filtered by status, side, symbol and date.
- Trades show price, quantity, charges and realized P&L.

## Epic 7 — Portfolio

**US-17 Holdings**
As an investor, I want to see my holdings with quantity, average price, invested amount, current value, P&L and returns, so that I know how my investments perform.
- Totals for invested amount, current value, total P&L (₹ and %), day's P&L and realized P&L.
- Allocation by security and by sector.
- Values update live.

**US-18 Portfolio performance**
As an investor, I want to see how my portfolio value changed over time, so that I can evaluate my performance.
- A chart for 1M, 3M, 6M and 1Y built from my trades and daily closing prices.

## Epic 8 — Watchlist

**US-19 Watchlists**
As an investor, I want to add securities to watchlists and track their prices, so that I can monitor potential investments.
- I can create, rename and delete watchlists, and add or remove securities.
- Each item shows the live price and change.
- Quick actions let me buy, sell or set an alert.

## Epic 9 — Alerts and notifications

**US-20 Price alerts**
As an investor, I want to set alerts for when a price goes above or below a target, so that I am told when it gets there.
- An alert triggers once when its condition is met and sends me a notification.
- I can disable, re-enable and delete alerts.

**US-21 Notifications**
As an investor, I want notifications for order execution, IPO updates, price alerts, fund movements and security events, so that I don't miss important activity.
- A bell shows the unread count in real time.
- A notification centre lists notifications with filters; I can mark one or all as read.
- I can mute categories, except security notifications.

## Epic 10 — IPOs

**US-22 Browse IPOs**
As an investor, I want to view upcoming, open and completed IPOs, so that I can decide whether to apply.
- Details include price band, lot size, issue size, dates (open, close, allotment, listing), subscription by category, company information and financials.
- Listed IPOs show the listing price and listing gain.

**US-23 Apply for an IPO**
As an investor, I want to apply for an open IPO with a quantity and bid price, so that I can be allotted shares.
- Quantity is a whole number of lots within the minimum and maximum (retail limit ₹2,00,000).
- The bid must lie within the price band, or I can bid at the cut-off price.
- The bid amount is blocked from my available funds.
- One active application per IPO; I can cancel it while the IPO is open.

**US-24 Allotment and application history**
As an investor, I want to see my applications and their allotment status, so that I know the outcome.
- On allotment, the allotted amount is debited and the rest is released; if not allotted, everything is released.
- I am notified of the result.
- Allotted shares are credited to my holdings on the listing date.

## Epic 11 — Funds

**US-25 Add money**
As an investor, I want to add money via UPI, net banking or card, so that I can trade.
- Amount between ₹100 and ₹10,00,000 per transaction.
- The balance updates immediately, with a ledger entry and a notification.

**US-26 Withdraw money**
As an investor, I want to withdraw money to my bank account, so that I can use my funds elsewhere.
- I can withdraw at most my available balance.
- Requires a bank account on file and my PIN; creates a ledger entry and a notification.

**US-27 View balance**
As an investor, I want to see my total, available, blocked and withdrawable balances, so that I know my buying power.

## Epic 12 — Statements

**US-28 Account statement**
As an investor, I want a complete account statement for any date range, so that I can reconcile my transactions.
- Shows opening and closing balance, credits, debits and the running balance.
- Filters by entry type and date range.
- Ledger and trades can be downloaded as CSV.

## Epic 13 — Administration

**US-29 Manage users**
As an admin, I want to search users and view their funds, holdings and orders, so that I can support and supervise accounts.
- I can suspend or reactivate a user, unlock a locked account, sign a user out everywhere, and credit or debit funds with a reason.

**US-30 Manage securities**
As an admin, I want to add and edit securities, so that the tradable universe stays correct.
- I can edit company information and fundamentals, and halt or resume trading.

**US-31 Manage IPOs**
As an admin, I want to create and manage IPOs, so that investors can apply for new issues.
- I can create, edit and withdraw IPOs and update subscription figures.
- I can run allotment and listing manually, and view all applications.

**US-32 Manage orders and transactions**
As an admin, I want to view all orders and ledger transactions, so that I can monitor platform activity.
- I can filter orders and cancel open ones; I can filter transactions by user, type and date.

**US-33 Application data**
As an admin, I want an overview of platform metrics and control over settings, so that I can run the platform.
- The overview shows users, orders, trading volume, funds and IPO activity.
- I can change brokerage and fund limits and broadcast announcements to all users.

## Epic 14 — Audit trail

**US-34 Audit trail**
As an admin, I want an immutable audit trail of user and system activity, so that every action can be traced.
- Authentication, profile, funds, order, IPO, watchlist, alert and admin actions are logged with actor, IP, user agent and details.
- Entries are append-only (enforced by the database) and hash-chained so tampering can be detected.
- I can filter the trail and verify its integrity.

**US-35 Account activity**
As an investor, I want to view my own activity log, so that I can spot anything suspicious.

---

## Traceability

Where each story is implemented and which automated tests cover it. Server tests live in `server/tests/`
(Vitest + supertest), end-to-end tests in `e2e/` (Playwright). All API paths are under `/api`.

| Story | Screens | API | Server tests | E2E tests |
| ----- | ------- | --- | ------------ | --------- |
| US-01 Registration | `/register` | `POST /auth/register` | auth | auth |
| US-02 Login | `/login` | `POST /auth/login` | auth | auth |
| US-03 Logout | Account menu | `POST /auth/logout` | auth | auth |
| US-04 Profile management | `/profile` | `GET/PATCH /profile`, `PUT /profile/bank-account` | auth, trading | funds |
| US-05 Secure authentication | all | session cookie, CSRF and origin checks, rate limits, `POST /profile/password` | auth | auth |
| US-06 Session management | `/profile?tab=security` | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/sessions/revoke-others` | auth, stream | auth |
| US-07 Transaction confirmation | order, IPO and withdrawal dialogs | `POST /profile/pin`; PIN checked by orders, IPOs, withdrawals | trading | trading |
| US-08 Dashboard | `/` | `GET /portfolio`, `/market/overview`, `/watchlists`, `/orders`, `/funds`, `GET /stream` | — | — |
| US-09 Market indices | `/markets`, `/stocks/NIFTY50` | `GET /market/indices`, `/securities/:symbol/constituents` | market | — |
| US-10 Movers and trends | `/markets`, `/` | `GET /market/movers`, `/market/sectors`, `/market/breadth` | market | — |
| US-11 Search securities | top bar, `/explore` | `GET /securities/search`, `/securities` | market | trading |
| US-12 Security details | `/stocks/:symbol` | `GET /securities/:symbol`, `/securities/:symbol/history` | market | trading |
| US-13 Market orders | order ticket | `POST /orders/preview`, `POST /orders` | trading | trading |
| US-14 Limit orders | order ticket | `POST /orders` | trading | trading |
| US-15 Modify and cancel orders | `/orders` | `PATCH /orders/:id`, `POST /orders/:id/cancel` | trading | trading |
| US-16 Order status and history | `/orders` | `GET /orders`, `GET /trades` | trading | trading |
| US-17 Holdings | `/portfolio` | `GET /portfolio` | trading | trading |
| US-18 Portfolio performance | `/`, `/portfolio` | `GET /portfolio/performance` | trading | — |
| US-19 Watchlists | `/watchlist`, Watch menu | `/watchlists` (CRUD and items) | engagement | watchlist-alerts |
| US-20 Price alerts | `/alerts`, Alert dialog | `/alerts` (CRUD) | engagement | watchlist-alerts |
| US-21 Notifications | bell, `/notifications` | `/notifications`, `PUT /profile/notification-preferences`, `GET /stream` | engagement, trading | trading |
| US-22 Browse IPOs | `/ipo`, `/ipo/:id` | `GET /ipos`, `GET /ipos/:id` | ipo | ipo |
| US-23 Apply for an IPO | `/ipo/:id` | `POST /ipos/:id/apply`, `POST /ipos/applications/:id/cancel` | ipo | ipo |
| US-24 Allotment and history | `/ipo?tab=applications` | `GET /ipos/applications`; allotment and listing run by the scheduler | ipo | ipo |
| US-25 Add money | `/funds` | `POST /funds/deposit` | trading | funds |
| US-26 Withdraw money | `/funds` | `POST /funds/withdraw` | trading | funds |
| US-27 View balance | `/funds`, `/` | `GET /funds` | trading | funds |
| US-28 Account statement | `/statements` | `GET /statements`, `/statements/ledger.csv`, `/statements/trades.csv` | trading | funds |
| US-29 Manage users | `/admin/users` | `/admin/users` (status, unlock, revoke sessions, funds adjustment, role) | admin | admin |
| US-30 Manage securities | `/admin/securities` | `/admin/securities` (create, edit, trading status, price) | admin | — |
| US-31 Manage IPOs | `/admin/ipos` | `/admin/ipos` (create, edit, subscription, allot, list, withdraw) | admin, ipo | — |
| US-32 Manage orders and transactions | `/admin/orders`, `/admin/transactions` | `/admin/orders`, `/admin/trades`, `/admin/ledger`, `/admin/fund-transactions` | admin | — |
| US-33 Application data | `/admin`, `/admin/settings` | `GET /admin/overview`, `/admin/settings`, `POST /admin/announcements` | admin | — |
| US-34 Audit trail | `/admin/audit` | `GET /admin/audit-logs`, `GET /admin/audit-logs/verify` | auth, admin, demo-seed | admin |
| US-35 Account activity | `/profile?tab=activity` | `GET /profile/activity` | auth | — |
