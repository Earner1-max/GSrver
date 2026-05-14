// database.js - D1 Database adapter for Cloudflare Workers

import {
    DEFAULT_REFER_AMOUNT,
    DEFAULT_MINE_AMOUNT,
    DEFAULT_MIN_WITHDRAWAL,
    DEFAULT_MINE_COOLDOWN,
    logger
} from './config.js';

let db = null;

/**
 * Initialize database connection
 * @param {D1Database} d1Database - Cloudflare D1 Database binding
 */
export function initDatabase(d1Database) {
    db = d1Database;
    logger.info('Database initialized');
}

/**
 * Get database instance
 */
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

/**
 * Initialize database tables and defaults
 */
export async function initDb() {
    const conn = getDb();
    
    try {
        // Create tables
        await conn.exec(`
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
        `);

        // Insert default settings
        const defaults = [
            ['refer_amount', String(DEFAULT_REFER_AMOUNT)],
            ['mine_amount', String(DEFAULT_MINE_AMOUNT)],
            ['mine_cooldown', String(DEFAULT_MINE_COOLDOWN)],
            ['min_withdrawal', String(DEFAULT_MIN_WITHDRAWAL)],
            ['comment_post_url', 'https://x.com/i/status/2053857757900541991'],
        ];

        for (const [key, val] of defaults) {
            await conn.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)').bind(key, val).run();
        }

        logger.info('Database initialized successfully');
    } catch (error) {
        logger.error(`Database initialization error: ${error.message}`);
        throw error;
    }
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSetting(key) {
    try {
        const conn = getDb();
        const result = await conn.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
        return result ? result.value : null;
    } catch (error) {
        logger.error(`getSetting error: ${error.message}`);
        return null;
    }
}

export async function setSetting(key, value) {
    try {
        const conn = getDb();
        await conn.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(key, value).run();
    } catch (error) {
        logger.error(`setSetting error: ${error.message}`);
        throw error;
    }
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUser(userId) {
    try {
        const conn = getDb();
        return await conn.prepare('SELECT * FROM users WHERE user_id=?').bind(userId).first();
    } catch (error) {
        logger.error(`getUser error: ${error.message}`);
        return null;
    }
}

export async function createUser(userId, username, fullName, referredBy = null) {
    try {
        const conn = getDb();
        await conn.prepare(
            'INSERT OR IGNORE INTO users (user_id,username,full_name,referred_by) VALUES (?,?,?,?)'
        ).bind(userId, username, fullName, referredBy).run();
    } catch (error) {
        logger.error(`createUser error: ${error.message}`);
        throw error;
    }
}

export async function updateUser(userId, updates) {
    try {
        const conn = getDb();
        const keys = Object.keys(updates);
        const sets = keys.map(k => `${k}=?`).join(', ');
        const vals = [...Object.values(updates), userId];
        
        await conn.prepare(`UPDATE users SET ${sets} WHERE user_id=?`).bind(...vals).run();
    } catch (error) {
        logger.error(`updateUser error: ${error.message}`);
        throw error;
    }
}

export async function addBalance(userId, amount) {
    try {
        const conn = getDb();
        await conn.prepare('UPDATE users SET balance=balance+? WHERE user_id=?').bind(amount, userId).run();
    } catch (error) {
        logger.error(`addBalance error: ${error.message}`);
        throw error;
    }
}

export async function deductBalance(userId, amount) {
    try {
        const conn = getDb();
        await conn.prepare('UPDATE users SET balance=MAX(0,balance-?) WHERE user_id=?').bind(amount, userId).run();
    } catch (error) {
        logger.error(`deductBalance error: ${error.message}`);
        throw error;
    }
}

export async function getAllUsers() {
    try {
        const conn = getDb();
        const results = await conn.prepare('SELECT user_id FROM users').all();
        return results.results ? results.results.map(r => r.user_id) : [];
    } catch (error) {
        logger.error(`getAllUsers error: ${error.message}`);
        return [];
    }
}

// ── TGE requests ──────────────────────────────────────────────────────────────

export async function createTgeRequest(userId, oxapayTrack = null) {
    try {
        const conn = getDb();
        await conn.prepare('INSERT INTO tge_requests (user_id, oxapay_track) VALUES (?,?)').bind(userId, oxapayTrack).run();
    } catch (error) {
        logger.error(`createTgeRequest error: ${error.message}`);
        throw error;
    }
}

export async function getTgeRequestById(reqId) {
    try {
        const conn = getDb();
        return await conn.prepare('SELECT * FROM tge_requests WHERE id=?').bind(reqId).first();
    } catch (error) {
        logger.error(`getTgeRequestById error: ${error.message}`);
        return null;
    }
}

export async function getPresaleRequestById(reqId) {
    try {
        const conn = getDb();
        return await conn.prepare('SELECT * FROM presale_requests WHERE id=?').bind(reqId).first();
    } catch (error) {
        logger.error(`getPresaleRequestById error: ${error.message}`);
        return null;
    }
}

export async function getWithdrawalById(reqId) {
    try {
        const conn = getDb();
        return await conn.prepare('SELECT * FROM withdrawals WHERE id=?').bind(reqId).first();
    } catch (error) {
        logger.error(`getWithdrawalById error: ${error.message}`);
        return null;
    }
}

export async function getPendingTgeRequests() {
    try {
        const conn = getDb();
        const results = await conn.prepare(
            'SELECT t.*,u.username,u.full_name,u.balance FROM tge_requests t ' +
            'JOIN users u ON t.user_id=u.user_id WHERE t.status=? ORDER BY t.created_at'
        ).bind('pending').all();
        return results.results || [];
    } catch (error) {
        logger.error(`getPendingTgeRequests error: ${error.message}`);
        return [];
    }
}

export async function updateTgeRequest(reqId, status) {
    try {
        const conn = getDb();
        await conn.prepare('UPDATE tge_requests SET status=?,reviewed_at=? WHERE id=?').bind(
            status, Math.floor(Date.now() / 1000), reqId
        ).run();
    } catch (error) {
        logger.error(`updateTgeRequest error: ${error.message}`);
        throw error;
    }
}

export async function getUserTgeRequest(userId) {
    try {
        const conn = getDb();
        return await conn.prepare(
            'SELECT * FROM tge_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1'
        ).bind(userId).first();
    } catch (error) {
        logger.error(`getUserTgeRequest error: ${error.message}`);
        return null;
    }
}

// ── Presale requests ──────────────────────────────────────────────────────────

export async function createPresaleRequest(userId, txHash = null, oxapayTrack = null) {
    try {
        const conn = getDb();
        await conn.prepare(
            'INSERT INTO presale_requests (user_id,tx_hash,oxapay_track) VALUES (?,?,?)'
        ).bind(userId, txHash, oxapayTrack).run();
    } catch (error) {
        logger.error(`createPresaleRequest error: ${error.message}`);
        throw error;
    }
}

export async function getPendingPresaleRequests() {
    try {
        const conn = getDb();
        const results = await conn.prepare(
            'SELECT p.*,u.username,u.full_name FROM presale_requests p ' +
            'JOIN users u ON p.user_id=u.user_id WHERE p.status=? ORDER BY p.created_at'
        ).bind('pending').all();
        return results.results || [];
    } catch (error) {
        logger.error(`getPendingPresaleRequests error: ${error.message}`);
        return [];
    }
}

export async function updatePresaleRequest(reqId, status) {
    try {
        const conn = getDb();
        await conn.prepare('UPDATE presale_requests SET status=?,reviewed_at=? WHERE id=?').bind(
            status, Math.floor(Date.now() / 1000), reqId
        ).run();
    } catch (error) {
        logger.error(`updatePresaleRequest error: ${error.message}`);
        throw error;
    }
}

export async function getUserPresaleRequest(userId) {
    try {
        const conn = getDb();
        return await conn.prepare(
            'SELECT * FROM presale_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1'
        ).bind(userId).first();
    } catch (error) {
        logger.error(`getUserPresaleRequest error: ${error.message}`);
        return null;
    }
}

// ── Withdrawals ───────────────────────────────────────────────────────────────

export async function createWithdrawal(userId, wtype, amountGtc, amountUsdt, bnbAddress) {
    try {
        const conn = getDb();
        await conn.prepare(
            'INSERT INTO withdrawals (user_id,type,amount_gtc,amount_usdt,bnb_address) VALUES (?,?,?,?,?)'
        ).bind(userId, wtype, amountGtc, amountUsdt, bnbAddress).run();
    } catch (error) {
        logger.error(`createWithdrawal error: ${error.message}`);
        throw error;
    }
}

export async function getPendingWithdrawals() {
    try {
        const conn = getDb();
        const results = await conn.prepare(
            'SELECT w.*,u.username,u.full_name FROM withdrawals w ' +
            'JOIN users u ON w.user_id=u.user_id WHERE w.status=? ORDER BY w.created_at'
        ).bind('pending').all();
        return results.results || [];
    } catch (error) {
        logger.error(`getPendingWithdrawals error: ${error.message}`);
        return [];
    }
}

export async function updateWithdrawal(reqId, status) {
    try {
        const conn = getDb();
        await conn.prepare('UPDATE withdrawals SET status=?,reviewed_at=? WHERE id=?').bind(
            status, Math.floor(Date.now() / 1000), reqId
        ).run();
    } catch (error) {
        logger.error(`updateWithdrawal error: ${error.message}`);
        throw error;
    }
}

// ── Distribution stats ────────────────────────────────────────────────────────

export async function getDistributionStats() {
    try {
        const conn = getDb();
        
        const totalBalance = await conn.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM users').first();
        const totalUsers = await conn.prepare('SELECT COUNT(*) AS c FROM users').first();
        const verified = await conn.prepare('SELECT COUNT(*) AS c FROM users WHERE verified=1').first();
        const tgeUsers = await conn.prepare('SELECT COUNT(*) AS c FROM users WHERE tge_joined=1').first();
        const presaleUsers = await conn.prepare('SELECT COUNT(*) AS c FROM users WHERE presale_joined=1').first();
        const presaleRewarded = await conn.prepare('SELECT COUNT(*) AS c FROM presale_requests WHERE status=?').bind('approved').first();
        const mineToday = await conn.prepare(
            'SELECT COUNT(*) AS c FROM users WHERE last_mine>=?'
        ).bind(Math.floor(Date.now() / 1000) - 86400).first();
        const pendingWd = await conn.prepare('SELECT COUNT(*) AS c FROM withdrawals WHERE status=?').bind('pending').first();
        
        return {
            total_balance: totalBalance.s,
            total_users: totalUsers.c,
            verified: verified.c,
            tge_users: tgeUsers.c,
            presale_users: presaleUsers.c,
            presale_rewarded: presaleRewarded.c,
            mine_today: mineToday.c,
            pending_wd: pendingWd.c
        };
    } catch (error) {
        logger.error(`getDistributionStats error: ${error.message}`);
        return {};
    }
}

// ── Screenshots ───────────────────────────────────────────────────────────────

export async function saveScreenshot(userId, fileId) {
    try {
        const conn = getDb();
        await conn.prepare(
            'INSERT OR REPLACE INTO comment_verifications (user_id,screenshot_file_id,submitted_at) VALUES (?,?,?)'
        ).bind(userId, fileId, Math.floor(Date.now() / 1000)).run();
    } catch (error) {
        logger.error(`saveScreenshot error: ${error.message}`);
        throw error;
    }
}
