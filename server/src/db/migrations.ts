import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Schema migrations, applied in order and recorded in schema_migrations.
 * Monetary values are INTEGER paise; timestamps are ISO-8601 UTC strings; dates are YYYY-MM-DD (IST).
 */
const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: /* sql */ `
      CREATE TABLE users (
        id                    INTEGER PRIMARY KEY,
        email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash         TEXT NOT NULL,
        full_name             TEXT NOT NULL,
        phone                 TEXT,
        date_of_birth         TEXT,
        pan                   TEXT,
        address               TEXT,
        role                  TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
        status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
        pin_hash              TEXT,
        pin_failed_attempts   INTEGER NOT NULL DEFAULT 0,
        pin_locked_until      TEXT,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until          TEXT,
        notification_prefs    TEXT NOT NULL DEFAULT '{}',
        last_login_at         TEXT,
        password_changed_at   TEXT,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );

      CREATE TABLE bank_accounts (
        user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        account_holder TEXT NOT NULL,
        account_number TEXT NOT NULL,
        ifsc           TEXT NOT NULL,
        bank_name      TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      -- id is the SHA-256 of the session token; the raw token only ever lives in the client cookie.
      CREATE TABLE sessions (
        id             TEXT PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token     TEXT NOT NULL,
        ip             TEXT,
        user_agent     TEXT,
        created_at     TEXT NOT NULL,
        last_seen_at   TEXT NOT NULL,
        expires_at     TEXT NOT NULL,
        revoked_at     TEXT,
        revoked_reason TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE accounts (
        user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        cash_balance INTEGER NOT NULL DEFAULT 0 CHECK (cash_balance >= 0),
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE securities (
        id                 INTEGER PRIMARY KEY,
        symbol             TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name               TEXT NOT NULL,
        security_type      TEXT NOT NULL CHECK (security_type IN ('STOCK', 'ETF', 'REIT', 'INVIT', 'INDEX')),
        exchange           TEXT NOT NULL DEFAULT 'NSE',
        sector             TEXT,
        industry           TEXT,
        description        TEXT,
        founded_year       INTEGER,
        headquarters       TEXT,
        face_value         INTEGER,
        shares_outstanding INTEGER,
        eps                INTEGER,
        book_value         INTEGER,
        dividend_per_share INTEGER,
        roe                REAL,
        debt_to_equity     REAL,
        beta               REAL,
        revenue_cr         REAL,
        net_profit_cr      REAL,
        expense_ratio      REAL,
        tick_size          INTEGER NOT NULL DEFAULT 5,
        circuit_pct        REAL NOT NULL DEFAULT 20,
        volatility         REAL NOT NULL DEFAULT 0.25,
        avg_volume         INTEGER NOT NULL DEFAULT 0,
        index_base_value   INTEGER,
        is_tradable        INTEGER NOT NULL DEFAULT 1,
        trading_status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (trading_status IN ('ACTIVE', 'HALTED')),
        listing_date       TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_securities_type ON securities(security_type);

      CREATE TABLE quotes (
        security_id  INTEGER PRIMARY KEY REFERENCES securities(id) ON DELETE CASCADE,
        last_price   INTEGER NOT NULL,
        prev_close   INTEGER NOT NULL,
        open         INTEGER NOT NULL,
        high         INTEGER NOT NULL,
        low          INTEGER NOT NULL,
        volume       INTEGER NOT NULL DEFAULT 0,
        turnover     INTEGER NOT NULL DEFAULT 0,
        trading_date TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE price_history (
        security_id INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
        date        TEXT NOT NULL,
        open        INTEGER NOT NULL,
        high        INTEGER NOT NULL,
        low         INTEGER NOT NULL,
        close       INTEGER NOT NULL,
        volume      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (security_id, date)
      ) WITHOUT ROWID;

      -- Five-minute candles for recent days (1D / 1W charts).
      CREATE TABLE intraday_prices (
        security_id INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
        ts          INTEGER NOT NULL,
        open        INTEGER NOT NULL,
        high        INTEGER NOT NULL,
        low         INTEGER NOT NULL,
        close       INTEGER NOT NULL,
        volume      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (security_id, ts)
      ) WITHOUT ROWID;

      CREATE TABLE index_constituents (
        index_id    INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
        security_id INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
        weight      REAL NOT NULL,
        base_price  INTEGER NOT NULL,
        PRIMARY KEY (index_id, security_id)
      ) WITHOUT ROWID;

      CREATE TABLE holdings (
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        security_id     INTEGER NOT NULL REFERENCES securities(id),
        quantity        INTEGER NOT NULL CHECK (quantity >= 0),
        invested        INTEGER NOT NULL CHECK (invested >= 0),
        realized_pnl    INTEGER NOT NULL DEFAULT 0,
        first_bought_at TEXT,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (user_id, security_id)
      );

      CREATE TABLE orders (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        security_id     INTEGER NOT NULL REFERENCES securities(id),
        side            TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        order_type      TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT')),
        validity        TEXT NOT NULL DEFAULT 'DAY' CHECK (validity IN ('DAY', 'IOC')),
        quantity        INTEGER NOT NULL CHECK (quantity > 0),
        limit_price     INTEGER,
        status          TEXT NOT NULL CHECK (status IN ('OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED', 'EXPIRED')),
        status_reason   TEXT,
        filled_quantity INTEGER NOT NULL DEFAULT 0,
        average_price   INTEGER,
        blocked_amount  INTEGER NOT NULL DEFAULT 0,
        trading_date    TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        executed_at     TEXT,
        cancelled_at    TEXT
      );
      CREATE INDEX idx_orders_user ON orders(user_id, id);
      CREATE INDEX idx_orders_status ON orders(status, security_id);

      CREATE TABLE trades (
        id               INTEGER PRIMARY KEY,
        order_id         INTEGER NOT NULL REFERENCES orders(id),
        user_id          INTEGER NOT NULL REFERENCES users(id),
        security_id      INTEGER NOT NULL REFERENCES securities(id),
        side             TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        quantity         INTEGER NOT NULL CHECK (quantity > 0),
        price            INTEGER NOT NULL,
        value            INTEGER NOT NULL,
        brokerage        INTEGER NOT NULL,
        stt              INTEGER NOT NULL,
        exchange_charges INTEGER NOT NULL,
        sebi_fees        INTEGER NOT NULL,
        stamp_duty       INTEGER NOT NULL,
        gst              INTEGER NOT NULL,
        total_charges    INTEGER NOT NULL,
        net_amount       INTEGER NOT NULL,
        realized_pnl     INTEGER,
        trading_date     TEXT NOT NULL,
        executed_at      TEXT NOT NULL
      );
      CREATE INDEX idx_trades_user ON trades(user_id, id);

      -- Every change to a user's cash balance. amount is signed: credit > 0, debit < 0.
      CREATE TABLE ledger_entries (
        id             INTEGER PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id),
        entry_type     TEXT NOT NULL CHECK (entry_type IN ('DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'CHARGES', 'IPO_ALLOTMENT', 'ADJUSTMENT')),
        amount         INTEGER NOT NULL,
        balance_after  INTEGER NOT NULL,
        reference_type TEXT,
        reference_id   INTEGER,
        description    TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_ledger_user ON ledger_entries(user_id, id);

      CREATE TABLE fund_transactions (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        txn_type     TEXT NOT NULL CHECK (txn_type IN ('DEPOSIT', 'WITHDRAWAL')),
        amount       INTEGER NOT NULL CHECK (amount > 0),
        method       TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
        reference    TEXT NOT NULL UNIQUE,
        bank_account TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_fund_txn_user ON fund_transactions(user_id, id);

      CREATE TABLE watchlists (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, name)
      );

      CREATE TABLE watchlist_items (
        watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
        security_id  INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
        added_at     TEXT NOT NULL,
        PRIMARY KEY (watchlist_id, security_id)
      ) WITHOUT ROWID;

      CREATE TABLE price_alerts (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        security_id     INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
        condition       TEXT NOT NULL CHECK (condition IN ('ABOVE', 'BELOW')),
        target_price    INTEGER NOT NULL CHECK (target_price > 0),
        status          TEXT NOT NULL CHECK (status IN ('ACTIVE', 'TRIGGERED', 'DISABLED')),
        note            TEXT,
        triggered_price INTEGER,
        triggered_at    TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_alerts_status ON price_alerts(status, security_id);
      CREATE INDEX idx_alerts_user ON price_alerts(user_id);

      CREATE TABLE notifications (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category   TEXT NOT NULL CHECK (category IN ('ORDER', 'IPO', 'PRICE_ALERT', 'FUNDS', 'SECURITY', 'SYSTEM')),
        title      TEXT NOT NULL,
        message    TEXT NOT NULL,
        link       TEXT,
        is_read    INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, id);

      CREATE TABLE ipos (
        id                  INTEGER PRIMARY KEY,
        company_name        TEXT NOT NULL,
        symbol              TEXT NOT NULL UNIQUE COLLATE NOCASE,
        issue_type          TEXT NOT NULL DEFAULT 'MAINBOARD' CHECK (issue_type IN ('MAINBOARD', 'SME')),
        sector              TEXT,
        industry            TEXT,
        description         TEXT,
        price_band_low      INTEGER NOT NULL,
        price_band_high     INTEGER NOT NULL,
        lot_size            INTEGER NOT NULL CHECK (lot_size > 0),
        min_lots            INTEGER NOT NULL DEFAULT 1,
        max_lots            INTEGER NOT NULL,
        issue_size_cr       REAL NOT NULL,
        fresh_issue_cr      REAL NOT NULL DEFAULT 0,
        ofs_cr              REAL NOT NULL DEFAULT 0,
        retail_quota_pct    REAL NOT NULL DEFAULT 35,
        nii_quota_pct       REAL NOT NULL DEFAULT 15,
        qib_quota_pct       REAL NOT NULL DEFAULT 50,
        open_date           TEXT NOT NULL,
        close_date          TEXT NOT NULL,
        allotment_date      TEXT NOT NULL,
        refund_date         TEXT,
        listing_date        TEXT NOT NULL,
        issue_price         INTEGER,
        listing_price       INTEGER,
        subscription_retail REAL NOT NULL DEFAULT 0,
        subscription_nii    REAL NOT NULL DEFAULT 0,
        subscription_qib    REAL NOT NULL DEFAULT 0,
        demand_profile      TEXT,
        financials          TEXT,
        registrar           TEXT,
        lead_managers       TEXT,
        open_notified_at    TEXT,
        allotted_at         TEXT,
        listed_at           TEXT,
        withdrawn_at        TEXT,
        security_id         INTEGER REFERENCES securities(id),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        CHECK (price_band_low <= price_band_high),
        CHECK (open_date <= close_date AND close_date <= allotment_date AND allotment_date <= listing_date)
      );

      CREATE TABLE ipo_applications (
        id                INTEGER PRIMARY KEY,
        ipo_id            INTEGER NOT NULL REFERENCES ipos(id),
        user_id           INTEGER NOT NULL REFERENCES users(id),
        application_no    TEXT NOT NULL UNIQUE,
        quantity          INTEGER NOT NULL CHECK (quantity > 0),
        bid_price         INTEGER NOT NULL,
        is_cutoff         INTEGER NOT NULL DEFAULT 0,
        blocked_amount    INTEGER NOT NULL,
        status            TEXT NOT NULL CHECK (status IN ('APPLIED', 'CANCELLED', 'ALLOTTED', 'NOT_ALLOTTED')),
        status_reason     TEXT,
        allotted_quantity INTEGER NOT NULL DEFAULT 0,
        allotment_price   INTEGER,
        amount_debited    INTEGER NOT NULL DEFAULT 0,
        shares_credited_at TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_ipo_applications_active ON ipo_applications(ipo_id, user_id) WHERE status = 'APPLIED';
      CREATE INDEX idx_ipo_applications_user ON ipo_applications(user_id, id);

      -- Append-only, hash-chained audit trail. UPDATE and DELETE are rejected by triggers.
      CREATE TABLE audit_logs (
        id              INTEGER PRIMARY KEY,
        actor_id        INTEGER,
        actor_role      TEXT NOT NULL CHECK (actor_role IN ('USER', 'ADMIN', 'SYSTEM', 'ANONYMOUS')),
        subject_user_id INTEGER,
        action          TEXT NOT NULL,
        entity_type     TEXT,
        entity_id       TEXT,
        details         TEXT,
        ip              TEXT,
        user_agent      TEXT,
        created_at      TEXT NOT NULL,
        prev_hash       TEXT NOT NULL,
        hash            TEXT NOT NULL
      );
      CREATE INDEX idx_audit_subject ON audit_logs(subject_user_id, id);
      CREATE INDEX idx_audit_actor ON audit_logs(actor_id, id);
      CREATE INDEX idx_audit_action ON audit_logs(action);
      CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
        BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
      CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
        BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by INTEGER
      );
    `,
  },
];

export function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    (database.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (row) => row.version,
    ),
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}
