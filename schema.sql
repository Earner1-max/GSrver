-- D1 Database Schema for Telegram Bot

CREATE TABLE IF NOT EXISTS users (
    user_id            INTEGER PRIMARY KEY,
    username           TEXT    DEFAULT '',
    full_name          TEXT    DEFAULT '',
    balance            REAL    DEFAULT 0,
    referred_by        INTEGER DEFAULT NULL,
    referral_count     INTEGER DEFAULT 0,
    joined_at          INTEGER DEFAULT (cast(unixepoch() as int)),
    verified           INTEGER DEFAULT 0,
    tge_joined         INTEGER DEFAULT 0,
    presale_joined     INTEGER DEFAULT 0,
    last_mine          INTEGER DEFAULT 0,
    withdrawal_percent INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS tge_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    oxapay_track TEXT,
    status       TEXT    DEFAULT 'pending',
    created_at   INTEGER DEFAULT (cast(unixepoch() as int)),
    reviewed_at  INTEGER DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS presale_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    tx_hash      TEXT,
    oxapay_track TEXT,
    status       TEXT    DEFAULT 'pending',
    created_at   INTEGER DEFAULT (cast(unixepoch() as int)),
    reviewed_at  INTEGER DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT    NOT NULL,
    amount_gtc  REAL    NOT NULL,
    amount_usdt REAL    NOT NULL,
    bnb_address TEXT    NOT NULL,
    status      TEXT    DEFAULT 'pending',
    created_at  INTEGER DEFAULT (cast(unixepoch() as int)),
    reviewed_at INTEGER DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS comment_verifications (
    user_id           INTEGER PRIMARY KEY,
    screenshot_file_id TEXT,
    submitted_at      INTEGER DEFAULT (cast(unixepoch() as int))
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('refer_amount', '100');
INSERT OR IGNORE INTO settings (key, value) VALUES ('mine_amount', '1000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('mine_cooldown', '86400');
INSERT OR IGNORE INTO settings (key, value) VALUES ('min_withdrawal', '5000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('comment_post_url', 'https://x.com/i/status/2053857757900541991');

-- Create indices for better performance
CREATE INDEX IF NOT EXISTS idx_users_verified ON users(verified);
CREATE INDEX IF NOT EXISTS idx_users_tge_joined ON users(tge_joined);
CREATE INDEX IF NOT EXISTS idx_users_presale_joined ON users(presale_joined);
CREATE INDEX IF NOT EXISTS idx_tge_requests_status ON tge_requests(status);
CREATE INDEX IF NOT EXISTS idx_presale_requests_status ON presale_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
