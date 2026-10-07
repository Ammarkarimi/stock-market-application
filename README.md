# StockSphere

A full-stack stock market application where investors manage their investments: trade stocks and ETFs with
market and limit orders, track a live portfolio, apply for IPOs, manage funds, set price alerts and follow
the market. An admin panel manages users, securities, IPOs, orders and transactions, backed by a tamper-evident
audit trail.

> All market data (prices, indices, IPO subscriptions, company financials) is **simulated** for demonstration.

- User stories: [`docs/USER_STORIES.md`](docs/USER_STORIES.md)

## Tech stack

| Layer    | Technology                                                                 |
| -------- | -------------------------------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Lightweight Charts |
| Backend  | Node.js 22, Express 5, TypeScript, Zod                                      |
| Database | SQLite (better-sqlite3)                                                     |
| Realtime | Server-Sent Events                                                          |

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000/api
