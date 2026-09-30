/**
 * ============================================================================
 * SHISHO BINGO — COMPLETE SINGLE-FILE ARCHITECTURE
 * Engine: Node.js HTTP + PostgreSQL (pg) + Telegram Mini App + Serverless Tick
 * Redesign: Mobile-First Glassmorphism (Screenshot 2 Reference)
 * ============================================================================
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { Pool } = require('pg');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || 'ShishoBingoBot',
  APP_BASE_URL: (process.env.APP_BASE_URL || '').replace(/\/$/, ''),
  ADMIN_TELEGRAM_ID: String(process.env.ADMIN_TELEGRAM_ID || ''),
  SUPPORT_USERNAME: process.env.SUPPORT_USERNAME || 'ShishoSupport',
  TELEBIRR_ACCOUNT: process.env.TELEBIRR_ACCOUNT || '0911002233 (Shisho Official)',
  CBE_ACCOUNT: process.env.CBE_ACCOUNT || '1000192837465 (Shisho Games)',
  GAME_STAKE: parseFloat(process.env.GAME_STAKE || '10'),
  MAX_CARTELAS: parseInt(process.env.MAX_CARTELAS || '2', 10),
  ROOM_CAPACITY: parseInt(process.env.ROOM_CAPACITY || '20', 10),
  HOUSE_FEE_PERCENT: parseFloat(process.env.HOUSE_FEE_PERCENT || '20'),
  MIN_WITHDRAWAL: parseFloat(process.env.MIN_WITHDRAWAL || '50'),
  MIN_REMAINING_BALANCE: parseFloat(process.env.MIN_REMAINING_BALANCE || '10'),
  CALL_INTERVAL_SECONDS: parseInt(process.env.CALL_INTERVAL_SECONDS || '5', 10),
};

// ============================================================================
// 2. DATABASE POOL & INITIALIZATION
// ============================================================================
let pool;
function getDbPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: CONFIG.DATABASE_URL,
      ssl: CONFIG.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getDbPool();
  return p.query(text, params);
}

let dbInitialized = false;
async function initDatabase() {
  if (dbInitialized) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      telegram_username VARCHAR(255),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      display_name VARCHAR(255),
      phone_number VARCHAR(64),
      referral_code VARCHAR(64) UNIQUE NOT NULL,
      referred_by BIGINT,
      is_blocked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      balance DECIMAL(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(32) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      balance_before DECIMAL(14,2) NOT NULL,
      balance_after DECIMAL(14,2) NOT NULL,
      reference_id VARCHAR(128),
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount DECIMAL(14,2) NOT NULL,
      payment_method VARCHAR(32) NOT NULL,
      transaction_id VARCHAR(128) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
      admin_notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount DECIMAL(14,2) NOT NULL,
      payment_method VARCHAR(32) NOT NULL,
      account_number VARCHAR(128) NOT NULL,
      account_holder VARCHAR(255) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
      admin_notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      room_number INT UNIQUE NOT NULL,
      stake DECIMAL(14,2) NOT NULL DEFAULT 10.00,
      capacity INT NOT NULL DEFAULT 20,
      status VARCHAR(16) NOT NULL DEFAULT 'WAITING',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS room_players (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS cartelas (
      id SERIAL PRIMARY KEY,
      cartela_number INT UNIQUE NOT NULL,
      matrix JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_cartelas (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      cartela_id INTEGER NOT NULL REFERENCES cartelas(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(room_id, cartela_id)
    );

    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      room_id INTEGER UNIQUE NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      draw_order JSONB NOT NULL,
      draw_hash VARCHAR(128) NOT NULL,
      called_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_index INT NOT NULL DEFAULT 0,
      next_call_at TIMESTAMP WITH TIME ZONE,
      status VARCHAR(16) NOT NULL DEFAULT 'WAITING',
      total_pot DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      house_fee DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      prize_pool DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      winning_pattern VARCHAR(32) DEFAULT 'ONE_LINE_OR_CORNERS',
      started_at TIMESTAMP WITH TIME ZONE,
      finished_at TIMESTAMP WITH TIME ZONE
    );

    CREATE TABLE IF NOT EXISTS game_winners (
      id SERIAL PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cartela_id INTEGER NOT NULL REFERENCES cartelas(id) ON DELETE CASCADE,
      prize_amount DECIMAL(14,2) NOT NULL,
      pattern_matched VARCHAR(64) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS game_events (
      id SERIAL PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      event_type VARCHAR(32) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_cartelas_lookup ON room_cartelas(room_id, user_id);
  `;
  try {
    await query(sql);
    await seedDefaultCartelas();
    await ensureDefaultWaitingRoom();
    dbInitialized = true;
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

async function seedDefaultCartelas() {
  const res = await query('SELECT COUNT(*) FROM cartelas');
  if (parseInt(res.rows[0].count, 10) >= 50) return;

  for (let i = 1; i <= 50; i++) {
    const matrix = generateBingoMatrix(i);
    await query(
      'INSERT INTO cartelas (cartela_number, matrix) VALUES ($1, $2) ON CONFLICT (cartela_number) DO NOTHING',
      [i, JSON.stringify(matrix)]
    );
  }
}

async function ensureDefaultWaitingRoom() {
  const res = await query("SELECT id FROM rooms WHERE status = 'WAITING' LIMIT 1");
  if (res.rows.length === 0) {
    const roomNum = 1000 + Math.floor(Math.random() * 9000);
    await query("INSERT INTO rooms (room_number, stake, capacity, status) VALUES ($1, $2, $3, 'WAITING')", [
      roomNum,
      CONFIG.GAME_STAKE,
      CONFIG.ROOM_CAPACITY,
    ]);
  }
}

// ============================================================================
// 3. CRYPTOGRAPHY & TELEGRAM AUTHENTICATION
// ============================================================================
function verifyTelegramInitData(initDataRaw) {
  if (!initDataRaw || !CONFIG.TELEGRAM_BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(CONFIG.TELEGRAM_BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== hash) return null;
    const userRaw = params.get('user');
    return userRaw ? JSON.parse(userRaw) : null;
  } catch (err) {
    return null;
  }
}

// ============================================================================
// 4. CORE REPOSITORY (USERS, AUTHORITATIVE WALLETS)
// ============================================================================
async function findOrCreateUser(tgUser, referredByCode = null) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE', [tgUser.id]);
    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      await client.query(
        `UPDATE users SET telegram_username = $1, first_name = $2, last_name = $3, display_name = $4, updated_at = NOW() WHERE id = $5`,
        [tgUser.username || '', tgUser.first_name || '', tgUser.last_name || '', tgUser.first_name || 'Player', u.id]
      );
      await client.query('COMMIT');
      return u;
    }

    let referredById = null;
    if (referredByCode) {
      const refCheck = await client.query('SELECT id FROM users WHERE referral_code = $1', [referredByCode]);
      if (refCheck.rows.length > 0) referredById = refCheck.rows[0].id;
    }

    const refCode = 'SH' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const newUserRes = await client.query(
      `INSERT INTO users (telegram_id, telegram_username, first_name, last_name, display_name, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tgUser.id, tgUser.username || '', tgUser.first_name || '', tgUser.last_name || '', tgUser.first_name || 'Player', refCode, referredById]
    );
    const user = newUserRes.rows[0];
    await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0.00)', [user.id]);
    await client.query('COMMIT');
    return user;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getAuthoritativeWallet(userId) {
  const res = await query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) throw new Error('WALLET_NOT_FOUND');
  return parseFloat(res.rows[0].balance).toFixed(2);
}

async function modifyWalletAtomic(client, { userId, amount, type, referenceId, description }) {
  const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  if (wRes.rows.length === 0) throw new Error('WALLET_NOT_FOUND');

  const currentBal = parseFloat(wRes.rows[0].balance);
  const delta = parseFloat(amount);
  const newBal = parseFloat((currentBal + delta).toFixed(2));

  if (newBal < 0) throw new Error('INSUFFICIENT_FUNDS');

  await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBal, userId]);
  await client.query(
    `INSERT INTO wallet_transactions (user_id, type, amount, balance_before, balance_after, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, type, Math.abs(delta), currentBal, newBal, referenceId, description]
  );

  return newBal.toFixed(2);
}

function calculatePrizeDistribution(totalPot, feePercent = CONFIG.HOUSE_FEE_PERCENT) {
  const pot = parseFloat(totalPot);
  const houseFee = parseFloat(((pot * feePercent) / 100).toFixed(2));
  const prizePool = parseFloat((pot - houseFee).toFixed(2));
  return { houseFee, prizePool };
}

// ============================================================================
// 5. BINGO MATH & CARTELA MATRIX GENERATION
// ============================================================================
function generateBingoMatrix(seed = 1) {
  function pseudoRandom(s) {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  let localSeed = seed * 1337;
  function getSample(min, max, count) {
    const pool = [];
    for (let i = min; i <= max; i++) pool.push(i);
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(pseudoRandom(localSeed++) * pool.length);
      result.push(pool.splice(idx, 1)[0]);
    }
    return result;
  }

  const cols = {
    B: getSample(1, 15, 5),
    I: getSample(16, 30, 5),
    N: getSample(31, 45, 5),
    G: getSample(46, 60, 5),
    O: getSample(61, 75, 5),
  };

  cols.N[2] = 0; // FREE Center cell

  const grid = [];
  for (let r = 0; r < 5; r++) {
    grid.push([cols.B[r], cols.I[r], cols.N[r], cols.G[r], cols.O[r]]);
  }
  return grid;
}

function generateDrawSequence() {
  const arr = [];
  for (let i = 1; i <= 75; i++) arr.push(i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(arr)).digest('hex');
  return { sequence: arr, hash };
}

// ============================================================================
// 6. ROOM ORCHESTRATION & PERSISTENT CARTELA LOCKING
// ============================================================================
async function purchaseCartelasAtomic(userId, roomId, cartelaIds) {
  if (!Array.isArray(cartelaIds) || cartelaIds.length === 0) throw new Error('NO_CARTELAS_SELECTED');
  if (cartelaIds.length > CONFIG.MAX_CARTELAS) throw new Error(`EXCEEDS_MAX_CARTELAS_${CONFIG.MAX_CARTELAS}`);

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
    if (rRes.rows.length === 0) throw new Error('ROOM_NOT_FOUND');
    const room = rRes.rows[0];
    if (room.status !== 'WAITING') throw new Error('ROOM_ALREADY_STARTED');

    const existingPurchases = await client.query(
      'SELECT cartela_id FROM room_cartelas WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (existingPurchases.rows.length + cartelaIds.length > CONFIG.MAX_CARTELAS) {
      throw new Error('LIMIT_EXCEEDED');
    }

    const totalCost = (CONFIG.GAME_STAKE * cartelaIds.length).toFixed(2);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) throw new Error('WALLET_NOT_FOUND');
    if (parseFloat(wRes.rows[0].balance) < parseFloat(totalCost)) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    for (const cId of cartelaIds) {
      try {
        await client.query('INSERT INTO room_cartelas (room_id, cartela_id, user_id) VALUES ($1, $2, $3)', [
          roomId,
          cId,
          userId,
        ]);
      } catch (err) {
        if (err.code === '23505') throw new Error(`CARTELA_${cId}_ALREADY_TAKEN`);
        throw err;
      }
    }

    await client.query(
      'INSERT INTO room_players (room_id, user_id) VALUES ($1, $2) ON CONFLICT (room_id, user_id) DO NOTHING',
      [roomId, userId]
    );

    const newBal = await modifyWalletAtomic(client, {
      userId,
      amount: -parseFloat(totalCost),
      type: 'GAME_STAKE',
      referenceId: `ROOM_${roomId}_CARTS_${cartelaIds.join('-')}`,
      description: `Stake for room #${room.room_number} (${cartelaIds.length} cartelas)`,
    });

    await client.query('COMMIT');
    return { success: true, newBalance: newBal };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function tryAutoStartRoom(roomId) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
    if (rRes.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }
    const room = rRes.rows[0];
    if (room.status !== 'WAITING') {
      await client.query('COMMIT');
      return;
    }

    const cCountRes = await client.query('SELECT COUNT(*) FROM room_cartelas WHERE room_id = $1', [roomId]);
    const cartelaCount = parseInt(cCountRes.rows[0].count, 10);

    if (cartelaCount >= 2) {
      const totalPot = (cartelaCount * CONFIG.GAME_STAKE).toFixed(2);
      const { houseFee, prizePool } = calculatePrizeDistribution(totalPot);
      const { sequence, hash } = generateDrawSequence();

      await client.query("UPDATE rooms SET status = 'PLAYING', updated_at = NOW() WHERE id = $1", [roomId]);
      const nextCallAt = new Date(Date.now() + CONFIG.CALL_INTERVAL_SECONDS * 1000);

      await client.query(
        `INSERT INTO games (room_id, draw_order, draw_hash, called_numbers, current_index, next_call_at, status, total_pot, house_fee, prize_pool, started_at)
         VALUES ($1, $2, $3, '[]'::jsonb, 0, $4, 'PLAYING', $5, $6, $7, NOW())
         ON CONFLICT (room_id) DO NOTHING`,
        [roomId, JSON.stringify(sequence), hash, nextCallAt, totalPot, houseFee, prizePool]
      );

      await ensureDefaultWaitingRoom();
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Auto start room error:', err);
  } finally {
    client.release();
  }
}

// ============================================================================
// 7. SERVERLESS TICK ENGINE & BINGO VALIDATION
// ============================================================================
async function tickGameEngine(roomId) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gRes = await client.query(
      "SELECT * FROM games WHERE room_id = $1 AND status = 'PLAYING' FOR UPDATE",
      [roomId]
    );

    if (gRes.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const game = gRes.rows[0];
    const now = new Date();
    const nextCall = new Date(game.next_call_at);

    if (now >= nextCall) {
      const drawOrder = typeof game.draw_order === 'string' ? JSON.parse(game.draw_order) : game.draw_order;
      let called = typeof game.called_numbers === 'string' ? JSON.parse(game.called_numbers) : game.called_numbers;

      if (game.current_index < drawOrder.length) {
        const nextNum = drawOrder[game.current_index];
        called.push(nextNum);
        const newIndex = game.current_index + 1;
        const newNextCallAt = new Date(Date.now() + CONFIG.CALL_INTERVAL_SECONDS * 1000);

        await client.query(
          `UPDATE games SET called_numbers = $1, current_index = $2, next_call_at = $3 WHERE id = $4`,
          [JSON.stringify(called), newIndex, newNextCallAt, game.id]
        );

        await client.query(
          `INSERT INTO game_events (game_id, event_type, payload) VALUES ($1, 'NUMBER_CALLED', $2)`,
          [game.id, JSON.stringify({ number: nextNum, index: newIndex })]
        );
      } else {
        await client.query("UPDATE games SET status = 'FINISHED', finished_at = NOW() WHERE id = $1", [game.id]);
        await client.query("UPDATE rooms SET status = 'FINISHED', updated_at = NOW() WHERE id = $2", [roomId]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Tick error:', err);
  } finally {
    client.release();
  }
}

function verifyBingoPattern(matrix, calledSet) {
  for (let r = 0; r < 5; r++) {
    let rowMatch = true;
    for (let c = 0; c < 5; c++) {
      const val = matrix[r][c];
      if (val !== 0 && !calledSet.has(val)) {
        rowMatch = false;
        break;
      }
    }
    if (rowMatch) return { won: true, pattern: `ROW_${r + 1}` };
  }

  for (let c = 0; c < 5; c++) {
    let colMatch = true;
    for (let r = 0; r < 5; r++) {
      const val = matrix[r][c];
      if (val !== 0 && !calledSet.has(val)) {
        colMatch = false;
        break;
      }
    }
    if (colMatch) return { won: true, pattern: `COLUMN_${c + 1}` };
  }

  let diag1 = true;
  for (let i = 0; i < 5; i++) {
    const val = matrix[i][i];
    if (val !== 0 && !calledSet.has(val)) {
      diag1 = false;
      break;
    }
  }
  if (diag1) return { won: true, pattern: 'DIAGONAL_1' };

  let diag2 = true;
  for (let i = 0; i < 5; i++) {
    const val = matrix[i][4 - i];
    if (val !== 0 && !calledSet.has(val)) {
      diag2 = false;
      break;
    }
  }
  if (diag2) return { won: true, pattern: 'DIAGONAL_2' };

  const corners = [matrix[0][0], matrix[0][4], matrix[4][0], matrix[4][4]];
  if (corners.every((v) => v === 0 || calledSet.has(v))) {
    return { won: true, pattern: 'FOUR_CORNERS' };
  }

  return { won: false, pattern: null };
}

async function claimBingoAtomic(userId, roomId, cartelaId) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gRes = await client.query(
      "SELECT * FROM games WHERE room_id = $1 AND status = 'PLAYING' FOR UPDATE",
      [roomId]
    );
    if (gRes.rows.length === 0) throw new Error('GAME_NOT_ACTIVE');
    const game = gRes.rows[0];

    const rcRes = await client.query(
      'SELECT * FROM room_cartelas WHERE room_id = $1 AND cartela_id = $2 AND user_id = $3',
      [roomId, cartelaId, userId]
    );
    if (rcRes.rows.length === 0) throw new Error('CARTELA_NOT_OWNED');

    const cRes = await client.query('SELECT * FROM cartelas WHERE id = $1', [cartelaId]);
    if (cRes.rows.length === 0) throw new Error('CARTELA_NOT_FOUND');
    const cartela = cRes.rows[0];
    const matrix = typeof cartela.matrix === 'string' ? JSON.parse(cartela.matrix) : cartela.matrix;

    const called = typeof game.called_numbers === 'string' ? JSON.parse(game.called_numbers) : game.called_numbers;
    const check = verifyBingoPattern(matrix, new Set(called));
    if (!check.won) throw new Error('INVALID_BINGO_CLAIM');

    const prizeAmount = parseFloat(game.prize_pool).toFixed(2);
    await client.query(
      `INSERT INTO game_winners (game_id, user_id, cartela_id, prize_amount, pattern_matched) VALUES ($1, $2, $3, $4, $5)`,
      [game.id, userId, cartelaId, prizeAmount, check.pattern]
    );

    const updatedBal = await modifyWalletAtomic(client, {
      userId,
      amount: parseFloat(prizeAmount),
      type: 'GAME_PRIZE',
      referenceId: `GAME_${game.id}_WIN_${cartelaId}`,
      description: `Bingo Prize for Room #${roomId}`,
    });

    await client.query("UPDATE games SET status = 'FINISHED', finished_at = NOW() WHERE id = $1", [game.id]);
    await client.query("UPDATE rooms SET status = 'FINISHED', updated_at = NOW() WHERE id = $1", [roomId]);
    await client.query('COMMIT');

    return {
      success: true,
      prizeAmount,
      updatedBalance: updatedBal,
      pattern: check.pattern,
      cartelaNumber: cartela.cartela_number,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// 8. DEPOSIT & WITHDRAWAL REPOSITORY
// ============================================================================
async function createDepositAtomic(userId, amount, paymentMethod, transactionId) {
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) throw new Error('INVALID_AMOUNT');
  if (!transactionId || !transactionId.trim()) throw new Error('TRANSACTION_ID_REQUIRED');

  const res = await query(
    `INSERT INTO deposits (user_id, amount, payment_method, transaction_id, status) VALUES ($1, $2, $3, $4, 'PENDING') RETURNING *`,
    [userId, amt.toFixed(2), paymentMethod, transactionId.trim()]
  );
  return res.rows[0];
}

async function createWithdrawalAtomic(userId, amount, paymentMethod, accountNumber, accountHolder) {
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < CONFIG.MIN_WITHDRAWAL) throw new Error(`MINIMUM_WITHDRAWAL_${CONFIG.MIN_WITHDRAWAL}_BIRR`);

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) throw new Error('WALLET_NOT_FOUND');
    const currentBal = parseFloat(wRes.rows[0].balance);

    if (currentBal - amt < CONFIG.MIN_REMAINING_BALANCE) {
      throw new Error(`MUST_RETAIN_${CONFIG.MIN_REMAINING_BALANCE}_BIRR_FOR_GAMES`);
    }

    const newBal = await modifyWalletAtomic(client, {
      userId,
      amount: -amt,
      type: 'WITHDRAWAL',
      referenceId: `WD_${Date.now()}`,
      description: `Withdrawal request to ${paymentMethod} (${accountNumber})`,
    });

    const insRes = await client.query(
      `INSERT INTO withdrawals (user_id, amount, payment_method, account_number, account_holder, status) VALUES ($1, $2, $3, $4, $5, 'PENDING') RETURNING *`,
      [userId, amt.toFixed(2), paymentMethod, accountNumber, accountHolder]
    );

    await client.query('COMMIT');
    return { success: true, withdrawal: insRes.rows[0], newBalance: newBal };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// 9. TELEGRAM BOT ENGINE
// ============================================================================
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !chatId) return;
  const payload = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  return new Promise((resolve) => {
    const postData = JSON.stringify(payload);
    const req = require('https').request(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve(body));
      }
    );
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

async function handleTelegramWebhook(body) {
  if (!body || !body.message) return;
  const msg = body.message;
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const fromUser = msg.from;

  let startPayload = null;
  if (text.startsWith('/start ref_')) {
    startPayload = text.replace('/start ref_', '').trim();
  }
  const user = await findOrCreateUser(fromUser, startPayload);
  const webAppUrl = CONFIG.APP_BASE_URL || `https://${CONFIG.TELEGRAM_BOT_USERNAME}.vercel.app`;

  const defaultKeyboard = {
    keyboard: [
      [{ text: '🎮 Play', web_app: { url: webAppUrl } }, { text: '💰 Balance' }],
      [{ text: '💳 Deposit' }, { text: '💸 Withdraw' }],
      [{ text: '👤 Profile' }, { text: '🎁 Invite' }],
      [{ text: '📜 History' }, { text: '🆘 Support' }],
    ],
    resize_keyboard: true,
  };

  if (text.startsWith('/start')) {
    const welcome = `👑 *SHISHO BINGO*\n_Play. Win. Enjoy!_\n\nWelcome, *${user.display_name}*! Ethiopia's premier real-time multiplayer 5x5 Bingo.\n\nTap *🎮 Play* below to join a live game!`;
    await sendTelegramMessage(chatId, welcome, defaultKeyboard);
    return;
  }

  if (text === '💰 Balance') {
    const bal = await getAuthoritativeWallet(user.id);
    await sendTelegramMessage(chatId, `💰 *Available Balance:* *${bal} BIRR*\n_Live synced with your mini app._`, defaultKeyboard);
    return;
  }
}

// ============================================================================
// 10. REST API ROUTER
// ============================================================================
function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

async function authenticateRequest(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('tma ')) {
    const rawInit = authHeader.substring(4);
    const tgUser = verifyTelegramInitData(rawInit);
    if (!tgUser) return null;
    return await findOrCreateUser(tgUser);
  }
  // Local/Dev fallback account for direct browser testing outside Telegram WebApp
  if (process.env.NODE_ENV !== 'production' || !CONFIG.TELEGRAM_BOT_TOKEN) {
    return await findOrCreateUser({ id: 999999999, first_name: 'Test', username: 'tester' });
  }
  return null;
}

async function handleApiRequest(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      await query('SELECT 1');
      return jsonResponse(res, 200, { success: true, database: 'connected', service: 'shisho-bingo' });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, database: 'disconnected', error: e.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        await handleTelegramWebhook(JSON.parse(body));
        return jsonResponse(res, 200, { ok: true });
      } catch (err) {
        return jsonResponse(res, 200, { ok: false, error: err.message });
      }
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const authUser = await authenticateRequest(req);

  if (req.method === 'GET' && pathname === '/api/wallet') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    try {
      const balance = await getAuthoritativeWallet(authUser.id);
      return jsonResponse(res, 200, {
        success: true,
        user: { id: authUser.id, display_name: authUser.display_name, telegram_id: authUser.telegram_id },
        balance,
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'WALLET_READ_ERROR', message: e.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/rooms') {
    try {
      const roomsRes = await query(`
        SELECT r.*, 
          COALESCE(COUNT(rc.id), 0) AS selected_cartelas,
          COALESCE(COUNT(DISTINCT rp.user_id), 0) AS current_players
        FROM rooms r
        LEFT JOIN room_cartelas rc ON rc.room_id = r.id
        LEFT JOIN room_players rp ON rp.room_id = r.id
        WHERE r.status = 'WAITING'
        GROUP BY r.id
        ORDER BY r.id ASC
      `);
      return jsonResponse(res, 200, { success: true, rooms: roomsRes.rows });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'DATABASE_ERROR', message: e.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/cartelas') {
    const roomId = parsedUrl.query.roomId;
    try {
      const all = await query('SELECT id, cartela_number, matrix FROM cartelas ORDER BY cartela_number ASC');
      let takenIds = [];
      let myIds = [];

      if (roomId) {
        const takenRes = await query('SELECT cartela_id, user_id FROM room_cartelas WHERE room_id = $1', [roomId]);
        takenIds = takenRes.rows.map((r) => r.cartela_id);
        if (authUser) {
          myIds = takenRes.rows.filter((r) => r.user_id === authUser.id).map((r) => r.cartela_id);
        }
      }

      return jsonResponse(res, 200, { success: true, cartelas: all.rows, takenCartelaIds: takenIds, myCartelaIds: myIds });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'DATABASE_ERROR', message: e.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/cartela/purchase') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { roomId, cartelaIds } = JSON.parse(body);
        const result = await purchaseCartelasAtomic(authUser.id, roomId, cartelaIds);
        await tryAutoStartRoom(roomId);
        return jsonResponse(res, 200, result);
      } catch (e) {
        return jsonResponse(res, 409, { success: false, error: 'PURCHASE_FAILED', message: e.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/game/state') {
    const roomId = parsedUrl.query.roomId;
    if (!roomId) return jsonResponse(res, 400, { success: false, error: 'ROOM_ID_REQUIRED' });
    try {
      await tickGameEngine(roomId);
      const gRes = await query('SELECT * FROM games WHERE room_id = $1', [roomId]);
      const rRes = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);

      if (gRes.rows.length === 0) {
        return jsonResponse(res, 200, {
          success: true,
          gameState: { status: rRes.rows[0]?.status || 'WAITING', called_numbers: [] },
        });
      }

      const game = gRes.rows[0];
      const winnersRes = await query(
        `SELECT gw.*, u.display_name, c.cartela_number FROM game_winners gw 
         JOIN users u ON u.id = gw.user_id JOIN cartelas c ON c.id = gw.cartela_id WHERE gw.game_id = $1`,
        [game.id]
      );

      const called = typeof game.called_numbers === 'string' ? JSON.parse(game.called_numbers) : game.called_numbers;

      return jsonResponse(res, 200, {
        success: true,
        gameState: {
          id: game.id,
          roomId: game.room_id,
          status: game.status,
          calledNumbers: called,
          currentNumber: called.length > 0 ? called[called.length - 1] : null,
          totalPot: game.total_pot,
          prizePool: game.prize_pool,
          winners: winnersRes.rows,
          nextCallInSeconds: Math.max(0, Math.ceil((new Date(game.next_call_at).getTime() - Date.now()) / 1000)),
        },
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'GAME_STATE_ERROR', message: e.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/game/bingo') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { roomId, cartelaId } = JSON.parse(body);
        const result = await claimBingoAtomic(authUser.id, roomId, cartelaId);
        return jsonResponse(res, 200, result);
      } catch (e) {
        return jsonResponse(res, 400, { success: false, error: 'BINGO_VERIFY_FAILED', message: e.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/deposit') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { amount, paymentMethod, transactionId } = JSON.parse(body);
        const dep = await createDepositAtomic(authUser.id, amount, paymentMethod, transactionId);
        return jsonResponse(res, 200, { success: true, deposit: dep });
      } catch (e) {
        return jsonResponse(res, 400, { success: false, error: 'DEPOSIT_FAILED', message: e.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/withdraw') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { amount, paymentMethod, accountNumber, accountHolder } = JSON.parse(body);
        const resWd = await createWithdrawalAtomic(authUser.id, amount, paymentMethod, accountNumber, accountHolder);
        return jsonResponse(res, 200, resWd);
      } catch (e) {
        return jsonResponse(res, 400, { success: false, error: 'WITHDRAW_FAILED', message: e.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/history') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    try {
      const txs = await query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [
        authUser.id,
      ]);
      return jsonResponse(res, 200, { success: true, transactions: txs.rows });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'DB_ERROR', message: e.message });
    }
  }

  return jsonResponse(res, 404, { success: false, error: 'NOT_FOUND' });
}

// ============================================================================
// 11. REDESIGNED EMBEDDED MINI APP (HTML, CSS & JS)
// ============================================================================
function getMiniAppHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Shisho Bingo</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      --bg-dark-1: #080511;
      --bg-dark-2: #0d0718;
      --bg-card: rgba(23, 16, 36, 0.88);
      --bg-card-border: rgba(255, 216, 77, 0.16);
      --primary-gold: #ffc400;
      --bright-gold: #ffd84d;
      --gold-glow: rgba(255, 196, 0, 0.4);
      --purple-main: #6c3ccf;
      --purple-bright: #8e5bef;
      --purple-glow: rgba(110, 60, 207, 0.4);
      --text-white: #ffffff;
      --text-secondary: #a9a1b8;
      --text-muted: #6f6680;
      --success: #22c55e;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background: radial-gradient(circle at 50% 10%, #1a0b30 0%, var(--bg-dark-1) 100%); color: var(--text-white); min-height: 100vh; display: flex; justify-content: center; }

    /* Centered Mobile-First Device Shell */
    .app-viewport { width: 100%; max-width: 460px; min-height: 100vh; position: relative; padding-bottom: 84px; display: flex; flex-direction: column; }

    /* Top Gaming Header */
    .app-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(13, 7, 24, 0.85); backdrop-filter: blur(14px); position: sticky; top: 0; z-index: 100; border-bottom: 1px solid var(--bg-card-border); }
    .brand-cluster { display: flex; align-items: center; gap: 8px; }
    .brand-crown { font-size: 20px; filter: drop-shadow(0 0 6px var(--gold-glow)); }
    .brand-title { font-size: 16px; font-weight: 900; letter-spacing: 0.5px; background: linear-gradient(180deg, #fff 0%, var(--bright-gold) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .brand-tag { font-size: 9px; text-transform: uppercase; color: var(--purple-bright); font-weight: 700; letter-spacing: 1px; }

    .balance-pill { background: linear-gradient(135deg, rgba(108, 60, 207, 0.45), rgba(255, 196, 0, 0.12)); border: 1.5px solid var(--primary-gold); padding: 5px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px; cursor: pointer; box-shadow: 0 0 10px var(--gold-glow); transition: transform 0.15s; }
    .balance-pill:active { transform: scale(0.96); }
    .balance-text { font-size: 13px; font-weight: 800; color: var(--bright-gold); }

    /* Screen Views */
    .screen-view { display: none; padding: 14px 16px; animation: screenFade 0.2s ease-in-out; }
    .screen-view.active { display: block; }
    @keyframes screenFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* Reusable Cards & Components */
    .hero-banner { background: linear-gradient(135deg, rgba(110, 60, 207, 0.4) 0%, rgba(26, 16, 48, 0.8) 100%); border: 1.5px solid rgba(255, 196, 0, 0.28); border-radius: 18px; padding: 18px; text-align: center; position: relative; overflow: hidden; margin-bottom: 16px; box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
    .hero-banner::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, var(--gold-glow) 0%, transparent 60%); opacity: 0.15; pointer-events: none; }
    .hero-title { font-size: 24px; font-weight: 900; color: var(--bright-gold); text-transform: uppercase; letter-spacing: 1px; }
    .hero-subtitle { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
    .hero-tags { display: flex; justify-content: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .hero-badge { background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.1); padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; color: var(--text-white); }

    .quick-actions-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .action-button { background: var(--bg-card); border: 1px solid var(--bg-card-border); border-radius: 14px; padding: 10px 4px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; transition: transform 0.1s, border-color 0.15s; }
    .action-button:active { transform: scale(0.95); border-color: var(--primary-gold); }
    .action-icon { font-size: 18px; }
    .action-label { font-size: 11px; font-weight: 700; color: var(--text-secondary); }

    /* Bingo Room Cards */
    .section-title { font-size: 14px; font-weight: 800; color: var(--bright-gold); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }
    .room-card-v2 { background: var(--bg-card); border: 1.5px solid var(--bg-card-border); border-radius: 16px; padding: 14px 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 14px rgba(0,0,0,0.3); }
    .room-card-v2:hover { border-color: var(--primary-gold); }
    .room-header-tag { font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 6px; }
    .room-specs { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-secondary); }
    .room-specs strong { color: var(--bright-gold); }

    .btn-gold-cta { background: linear-gradient(180deg, #ffd84d 0%, #ffaa00 100%); color: #090510; border: none; font-weight: 900; font-size: 13px; padding: 10px 18px; border-radius: 12px; cursor: pointer; text-transform: uppercase; box-shadow: 0 3px 12px var(--gold-glow); transition: transform 0.1s; }
    .btn-gold-cta:active { transform: scale(0.96); }

    /* Cartela Selection Tickets Grid */
    .cartela-grid-container { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 12px 0; }
    .ticket-card { background: rgba(23, 16, 36, 0.95); border: 1.5px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 10px; cursor: pointer; transition: all 0.15s ease; position: relative; }
    .ticket-card.selected { border-color: var(--primary-gold); background: rgba(255, 196, 0, 0.08); box-shadow: 0 0 12px var(--gold-glow); }
    .ticket-card.taken { opacity: 0.25; cursor: not-allowed; }
    .ticket-header { display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; color: var(--bright-gold); margin-bottom: 6px; }
    .ticket-mini-matrix { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; }
    .mini-cell { aspect-ratio: 1; background: rgba(255,255,255,0.04); border-radius: 3px; font-size: 8px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-weight: 600; }
    .mini-cell.free-cell { background: var(--purple-main); color: #fff; }

    /* Live Bingo Screen (Screenshot 2 Match) */
    .live-game-header-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; background: var(--bg-card); border: 1px solid var(--bg-card-border); border-radius: 14px; padding: 8px; text-align: center; margin-bottom: 12px; }
    .stat-label { font-size: 9px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; }
    .stat-val { font-size: 14px; font-weight: 900; color: var(--bright-gold); }

    .ball-caller-podium { background: radial-gradient(circle at 50% 50%, rgba(108, 60, 207, 0.45) 0%, rgba(10, 5, 20, 0) 70%); border: 2px solid var(--purple-main); border-radius: 20px; padding: 16px; text-align: center; margin-bottom: 12px; position: relative; }
    .ball-halo { width: 84px; height: 84px; border-radius: 50%; background: linear-gradient(135deg, #ffd84d 0%, #ff8c00 100%); margin: 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 0 24px var(--gold-glow); animation: pulseBall 1.5s infinite alternate; }
    @keyframes pulseBall { from { transform: scale(0.96); } to { transform: scale(1.03); } }
    .ball-letter { font-size: 13px; font-weight: 900; color: rgba(0, 0, 0, 0.7); line-height: 1; }
    .ball-digit { font-size: 36px; font-weight: 900; color: #000; line-height: 1; }

    .recent-calls-strip { display: flex; gap: 8px; justify-content: center; overflow-x: auto; padding: 8px 0; margin-bottom: 12px; scrollbar-width: none; }
    .recent-pill { width: 34px; height: 34px; border-radius: 50%; background: var(--bg-card); border: 1.5px solid var(--primary-gold); color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

    /* Interactive 5x5 Bingo Matrix */
    .cartela-board { background: var(--bg-card); border: 1.5px solid var(--bg-card-border); border-radius: 16px; padding: 10px; margin-bottom: 12px; }
    .board-header { font-size: 12px; font-weight: 800; color: var(--bright-gold); text-align: center; margin-bottom: 8px; }
    .matrix-5x5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .col-letter { text-align: center; font-weight: 900; color: var(--bright-gold); font-size: 15px; padding-bottom: 4px; }
    .cell-val { aspect-ratio: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; color: #fff; }
    .cell-val.marked { background: linear-gradient(135deg, var(--purple-main) 0%, var(--purple-bright) 100%); color: #fff; border-color: var(--bright-gold); box-shadow: 0 0 8px var(--purple-glow); }
    .cell-val.free-spot { background: linear-gradient(135deg, var(--primary-gold) 0%, #ff8c00 100%); color: #000; font-size: 10px; font-weight: 900; }

    /* Winner Overlay Celebration Screen */
    .winner-overlay { position: fixed; inset: 0; background: rgba(5, 2, 12, 0.94); backdrop-filter: blur(12px); display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 200; padding: 24px; text-align: center; }
    .winner-overlay.active { display: flex; animation: zoomIn 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28); }
    @keyframes zoomIn { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }

    /* Bottom Navigation Bar */
    .app-bottom-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 460px; height: 68px; background: rgba(13, 7, 24, 0.95); backdrop-filter: blur(16px); border-top: 1.5px solid var(--bg-card-border); border-top-left-radius: 18px; border-top-right-radius: 18px; display: flex; justify-content: space-around; align-items: center; z-index: 99; }
    .nav-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: none; color: var(--text-muted); cursor: pointer; flex: 1; }
    .nav-btn.active { color: var(--bright-gold); }
    .nav-btn svg { width: 22px; height: 22px; fill: currentColor; }
    .nav-btn-text { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Forms & Interactive Modals */
    .form-group { margin-bottom: 12px; }
    .form-label { font-size: 11px; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px; display: block; }
    .input-box { width: 100%; padding: 12px 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1.5px solid var(--bg-card-border); color: #fff; font-size: 14px; }
    .input-box:focus { outline: none; border-color: var(--primary-gold); }
  </style>
</head>
<body>

  <div class="app-viewport">
    
    <!-- Top Header -->
    <header class="app-header">
      <div class="brand-cluster">
        <span class="brand-crown">👑</span>
        <div>
          <div class="brand-title">SHISHO BINGO</div>
          <div class="brand-tag">Play. Win. Enjoy!</div>
        </div>
      </div>
      <div class="balance-pill" onclick="switchView('wallet')">
        <span>💰</span>
        <span class="balance-text" id="header-wallet-bal">...</span>
      </div>
    </header>

    <!-- VIEW 1: HOME / LOBBY -->
    <main id="view-home" class="screen-view active">
      <div class="hero-banner">
        <div style="font-size: 32px; margin-bottom: 6px;">👑</div>
        <div class="hero-title">SHISHO BINGO</div>
        <div class="hero-subtitle">Ethiopia's #1 Real-Time Multiplayer Network</div>
        <div class="hero-tags">
          <span class="hero-badge">⚡ Instant Payouts</span>
          <span class="hero-badge">🔒 100% Fair Draw</span>
          <span class="hero-badge">👥 Active Rooms</span>
        </div>
      </div>

      <!-- Quick Actions Strip -->
      <div class="quick-actions-bar">
        <div class="action-button" onclick="switchView('wallet')">
          <div class="action-icon">💳</div>
          <div class="action-label" data-i18n="deposit">Deposit</div>
        </div>
        <div class="action-button" onclick="switchView('wallet')">
          <div class="action-icon">💸</div>
          <div class="action-label" data-i18n="withdraw">Withdraw</div>
        </div>
        <div class="action-button" onclick="switchView('invite')">
          <div class="action-icon">🎁</div>
          <div class="action-label" data-i18n="invite">Invite</div>
        </div>
        <div class="action-button" onclick="switchView('profile')">
          <div class="action-icon">👤</div>
          <div class="action-label" data-i18n="profile">Profile</div>
        </div>
      </div>

      <!-- Available Rooms -->
      <div class="section-title">
        <span data-i18n="availableRooms">Available Rooms</span>
        <span style="font-size: 11px; color: var(--purple-bright); cursor: pointer;" onclick="loadRooms()">🔄 Refresh</span>
      </div>
      <div id="rooms-feed-list">
        <!-- Rendered via loadRooms() -->
      </div>
    </main>

    <!-- VIEW 2: CARTELA SELECTION TICKET LOBBY -->
    <section id="view-cartela-picker" class="screen-view">
      <div class="section-title">
        <span>Select Tickets (Max 2)</span>
        <span style="color: var(--text-muted); font-size: 12px;" id="picker-room-info">Room #0000</span>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">
        Stake: <strong style="color: var(--bright-gold);">10 BIRR</strong> per cartela.
      </div>

      <div class="cartela-grid-container" id="cartela-selectable-feed">
        <!-- Injected Ticket Previews -->
      </div>

      <div style="background: var(--bg-card); border: 1.5px solid var(--bg-card-border); border-radius: 14px; padding: 12px; margin-top: 14px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
          <span>Selected Count:</span>
          <strong id="summary-cartela-count" style="color: var(--bright-gold);">0 / 2</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 12px;">
          <span>Total Deduction:</span>
          <strong id="summary-total-cost" style="color: var(--bright-gold);">0.00 BIRR</strong>
        </div>
        <button class="btn-gold-cta" style="width: 100%;" onclick="confirmCartelaPurchase()">CONFIRM & JOIN GAME</button>
      </div>
    </section>

    <!-- VIEW 3: LIVE BINGO GAME ROOM -->
    <section id="view-live-game" class="screen-view">
      <!-- Live Game Header -->
      <div class="live-game-header-bar">
        <div>
          <div class="stat-label">POT</div>
          <div class="stat-val" id="game-pot-val">0</div>
        </div>
        <div>
          <div class="stat-label">PLAYERS</div>
          <div class="stat-val" id="game-players-val">0</div>
        </div>
        <div>
          <div class="stat-label">STAKE</div>
          <div class="stat-val">10</div>
        </div>
        <div>
          <div class="stat-label">CALL #</div>
          <div class="stat-val" id="game-call-index">0</div>
        </div>
      </div>

      <!-- Current Ball Caller Podium -->
      <div class="ball-caller-podium">
        <div class="ball-halo">
          <div class="ball-letter" id="current-ball-letter">-</div>
          <div class="ball-digit" id="current-ball-number">-</div>
        </div>
        <div style="font-size: 11px; color: var(--bright-gold); margin-top: 8px;" id="game-next-timer">Next Call: 5s</div>
      </div>

      <!-- Recent Number Ribbon -->
      <div class="recent-calls-strip" id="recent-calls-ribbon"></div>

      <!-- My Active Cartela Boards -->
      <div id="live-cartelas-container"></div>

      <button class="btn-gold-cta" style="width: 100%; margin-top: 8px;" onclick="claimBingoVictory()">🏆 BINGO!</button>
    </section>

    <!-- VIEW 4: WALLET -->
    <section id="view-wallet" class="screen-view">
      <div class="hero-banner" style="padding: 14px;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary);">Authoritative Balance</div>
        <div style="font-size: 32px; font-weight: 900; color: var(--bright-gold); margin: 6px 0;" id="wallet-balance-big">0.00 BIRR</div>
        <div style="font-size: 11px; color: var(--text-muted);">Synchronized across Bot & Mini App</div>
      </div>

      <div class="section-title"><span>Deposit Funds</span></div>
      <div style="background: var(--bg-card); border: 1.5px solid var(--bg-card-border); border-radius: 14px; padding: 14px; margin-bottom: 16px;">
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="input-box" id="inp-dep-method">
            <option value="TELEBIRR">Telebirr (${CONFIG.TELEBIRR_ACCOUNT})</option>
            <option value="CBE">CBE (${CONFIG.CBE_ACCOUNT})</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Amount (BIRR)</label>
          <input type="number" class="input-box" id="inp-dep-amt" placeholder="e.g. 100">
        </div>
        <div class="form-group">
          <label class="form-label">Transaction Reference ID</label>
          <input type="text" class="input-box" id="inp-dep-txid" placeholder="Paste bank confirmation code">
        </div>
        <button class="btn-gold-cta" style="width: 100%;" onclick="submitDepositOrder()">Submit Deposit</button>
      </div>

      <div class="section-title"><span>Withdraw Funds</span></div>
      <div style="background: var(--bg-card); border: 1.5px solid var(--bg-card-border); border-radius: 14px; padding: 14px;">
        <div class="form-group">
          <label class="form-label">Payout Method</label>
          <select class="input-box" id="inp-wd-method">
            <option value="TELEBIRR">Telebirr</option>
            <option value="CBE">Commercial Bank of Ethiopia</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Amount (Min ${CONFIG.MIN_WITHDRAWAL} BIRR)</label>
          <input type="number" class="input-box" id="inp-wd-amt" placeholder="Amount">
        </div>
        <div class="form-group">
          <label class="form-label">Account / Phone Number</label>
          <input type="text" class="input-box" id="inp-wd-acc" placeholder="Target Account">
        </div>
        <div class="form-group">
          <label class="form-label">Account Holder Full Name</label>
          <input type="text" class="input-box" id="inp-wd-name" placeholder="Full Name">
        </div>
        <button class="btn-gold-cta" style="width: 100%; background: linear-gradient(180deg, var(--purple-bright) 0%, var(--purple-main) 100%); color: #fff;" onclick="submitWithdrawOrder()">Request Cashout</button>
      </div>
    </section>

    <!-- VIEW 5: HISTORY -->
    <section id="view-history" class="screen-view">
      <div class="section-title"><span>Transaction Ledger</span></div>
      <div id="history-audit-list"></div>
    </section>

    <!-- VIEW 6: PROFILE & SETTINGS -->
    <section id="view-profile" class="screen-view">
      <div class="hero-banner" style="text-align: left; display: flex; align-items: center; gap: 14px;">
        <div style="width: 54px; height: 54px; border-radius: 50%; background: var(--purple-main); border: 2px solid var(--primary-gold); display: flex; align-items: center; justify-content: center; font-size: 22px;">👤</div>
        <div>
          <div style="font-size: 16px; font-weight: 800;" id="prof-display-name">Player</div>
          <div style="font-size: 12px; color: var(--text-secondary);" id="prof-tg-id">ID: -</div>
        </div>
      </div>

      <div class="section-title"><span>Preferences & Audio</span></div>
      <div style="background: var(--bg-card); border: 1.5px solid var(--bg-card-border); border-radius: 14px; padding: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 13px;">🔊 Caller Voice Synthesizer</span>
          <input type="checkbox" id="setting-voice" checked style="width: 20px; height: 20px;">
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 13px;">🌐 Language / ቋንቋ</span>
          <select id="setting-lang" onchange="changeLanguage(this.value)" class="input-box" style="width: auto; padding: 6px 10px;">
            <option value="en">English</option>
            <option value="am">አማርኛ (Amharic)</option>
          </select>
        </div>
      </div>
    </section>

    <!-- VIEW 7: INVITE FRIENDS -->
    <section id="view-invite" class="screen-view">
      <div class="hero-banner">
        <div style="font-size: 32px; margin-bottom: 6px;">🎁</div>
        <div class="hero-title">Invite & Earn</div>
        <div class="hero-subtitle">Receive bonus rewards whenever friends join rooms!</div>
      </div>
      <div style="background: var(--bg-card); border: 1.5px solid var(--bg-card-border); border-radius: 14px; padding: 14px; text-align: center;">
        <input type="text" class="input-box" id="invite-link-input" readonly value="https://t.me/${CONFIG.TELEGRAM_BOT_USERNAME}">
        <button class="btn-gold-cta" style="width: 100%; margin-top: 10px;" onclick="copyInviteLink()">Copy Invite Link</button>
      </div>
    </section>

    <!-- Full-Screen Winner Celebration Modal (Screenshot 2 Match) -->
    <div id="winner-modal" class="winner-overlay">
      <div style="font-size: 48px; margin-bottom: 8px;">👑</div>
      <div style="font-size: 26px; font-weight: 900; color: var(--bright-gold); letter-spacing: 1px;">BINGO!</div>
      <div style="font-size: 14px; color: #fff; margin-bottom: 16px;">WE HAVE A WINNER!</div>
      
      <div style="background: var(--bg-card); border: 2px solid var(--primary-gold); border-radius: 16px; padding: 16px; width: 100%; max-width: 320px; margin-bottom: 16px; box-shadow: 0 0 20px var(--gold-glow);">
        <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase;">Total Prize Pool</div>
        <div style="font-size: 24px; font-weight: 900; color: var(--bright-gold);" id="win-modal-pot">160 BIRR</div>
        <div style="margin: 10px 0; border-top: 1px solid var(--bg-card-border);"></div>
        <div style="font-size: 14px; font-weight: 800;" id="win-modal-winner-name">Winner: -</div>
        <div style="font-size: 12px; color: var(--text-secondary);" id="win-modal-cartela-num">Cartela: #-</div>
      </div>
      <button class="btn-gold-cta" style="width: 100%; max-width: 320px;" onclick="closeWinnerModal()">CONTINUE</button>
    </div>

    <!-- Bottom Mobile Nav Bar -->
    <nav class="app-bottom-nav">
      <button class="nav-btn active" id="nav-btn-home" onclick="switchView('home')">
        <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        <span class="nav-btn-text" data-i18n="play">Play</span>
      </button>
      <button class="nav-btn" id="nav-btn-wallet" onclick="switchView('wallet')">
        <svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
        <span class="nav-btn-text" data-i18n="wallet">Wallet</span>
      </button>
      <button class="nav-btn" id="nav-btn-history" onclick="switchView('history')">
        <svg viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
        <span class="nav-btn-text" data-i18n="history">History</span>
      </button>
      <button class="nav-btn" id="nav-btn-profile" onclick="switchView('profile')">
        <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        <span class="nav-btn-text" data-i18n="profile">Profile</span>
      </button>
    </nav>

  </div>

  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) { tg.expand(); tg.ready(); }

    const API_HEADERS = {
      'Content-Type': 'application/json',
      'Authorization': 'tma ' + (tg?.initData || '')
    };

    const I18N = {
      en: { play: "Play", wallet: "Wallet", history: "History", profile: "Profile", deposit: "Deposit", withdraw: "Withdraw", invite: "Invite", availableRooms: "Available Rooms" },
      am: { play: "ተጫወት", wallet: "ዋሌት", history: "ታሪክ", profile: "መገለጫ", deposit: "ገንዘብ አስገባ", withdraw: "ገንዘብ አውጣ", invite: "ይጋብዙ", availableRooms: "የሚገኙ ክፍሎች" }
    };
    let currentLang = 'en';

    function changeLanguage(lang) {
      currentLang = lang;
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (I18N[lang] && I18N[lang][key]) el.innerText = I18N[lang][key];
      });
    }

    let activeRoomId = null;
    let selectedCartelaIds = [];
    let cartelasCatalog = [];
    let gamePollTimer = null;
    let lastSpokenNumber = null;

    function switchView(viewName) {
      document.querySelectorAll('.screen-view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

      const target = document.getElementById('view-' + viewName);
      if (target) target.classList.add('active');

      const navBtn = document.getElementById('nav-btn-' + viewName);
      if (navBtn) navBtn.classList.add('active');

      if (viewName === 'home') loadRooms();
      if (viewName === 'wallet') refreshWallet();
      if (viewName === 'history') loadHistory();
    }

    async function refreshWallet() {
      try {
        const res = await fetch('/api/wallet', { headers: API_HEADERS });
        const data = await res.json();
        if (data.success) {
          const bal = data.balance + ' BIRR';
          document.getElementById('header-wallet-bal').innerText = bal;
          document.getElementById('wallet-balance-big').innerText = bal;
          document.getElementById('prof-display-name').innerText = data.user.display_name;
          document.getElementById('prof-tg-id').innerText = 'ID: ' + data.user.telegram_id;
        } else {
          document.getElementById('header-wallet-bal').innerText = 'Unavailable';
        }
      } catch (e) {
        document.getElementById('header-wallet-bal').innerText = 'Offline';
      }
    }

    async function loadRooms() {
      try {
        const res = await fetch('/api/rooms', { headers: API_HEADERS });
        const data = await res.json();
        const container = document.getElementById('rooms-feed-list');
        container.innerHTML = '';

        if (!data.rooms || data.rooms.length === 0) {
          container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No active rooms. Waiting for players...</div>';
          return;
        }

        data.rooms.forEach(r => {
          const pot = (r.selected_cartelas * r.stake).toFixed(2);
          const div = document.createElement('div');
          div.className = 'room-card-v2';
          div.innerHTML = \`
            <div>
              <div class="room-header-tag">🎱 ROOM #\${r.room_number}</div>
              <div class="room-specs">
                <span>Stake: <strong>\${r.stake} BIRR</strong></span>
                <span>Players: <strong>\${r.current_players}/\${r.capacity}</strong></span>
                <span>Pot: <strong>\${pot} BIRR</strong></span>
              </div>
            </div>
            <button class="btn-gold-cta" onclick="openRoomPicker(\${r.id}, \${r.room_number})">JOIN +</button>
          \`;
          container.appendChild(div);
        });
      } catch (e) {
        console.error('Room load error', e);
      }
    }

    async function openRoomPicker(roomId, roomNumber) {
      activeRoomId = roomId;
      selectedCartelaIds = [];
      document.getElementById('picker-room-info').innerText = 'Room #' + roomNumber;
      updatePurchaseSummary();

      const res = await fetch('/api/cartelas?roomId=' + roomId, { headers: API_HEADERS });
      const data = await res.json();
      cartelasCatalog = data.cartelas || [];

      const grid = document.getElementById('cartela-selectable-feed');
      grid.innerHTML = '';

      cartelasCatalog.slice(0, 16).forEach(c => {
        const isTaken = data.takenCartelaIds.includes(c.id);
        const card = document.createElement('div');
        card.className = 'ticket-card' + (isTaken ? ' taken' : '');
        card.id = 'cartela-card-' + c.id;

        const matrix = typeof c.matrix === 'string' ? JSON.parse(c.matrix) : c.matrix;
        let miniMatrixHtml = '';
        for (let r = 0; r < 5; r++) {
          for (let col = 0; col < 5; col++) {
            const v = matrix[r][col];
            miniMatrixHtml += \`<div class="mini-cell \${v === 0 ? 'free-cell' : ''}">\${v === 0 ? 'F' : v}</div>\`;
          }
        }

        card.innerHTML = \`
          <div class="ticket-header">
            <span>Ticket #\${c.cartela_number}</span>
            <span>\${isTaken ? 'TAKEN' : '10 B'}</span>
          </div>
          <div class="ticket-mini-matrix">\${miniMatrixHtml}</div>
        \`;

        if (!isTaken) {
          card.onclick = () => toggleCartelaSelection(c.id);
        }
        grid.appendChild(card);
      });

      switchView('cartela-picker');
    }

    function toggleCartelaSelection(cartelaId) {
      const idx = selectedCartelaIds.indexOf(cartelaId);
      const el = document.getElementById('cartela-card-' + cartelaId);

      if (idx > -1) {
        selectedCartelaIds.splice(idx, 1);
        el.classList.remove('selected');
      } else {
        if (selectedCartelaIds.length >= 2) {
          alert('Maximum 2 cartelas allowed per game.');
          return;
        }
        selectedCartelaIds.push(cartelaId);
        el.classList.add('selected');
      }
      updatePurchaseSummary();
    }

    function updatePurchaseSummary() {
      document.getElementById('summary-cartela-count').innerText = selectedCartelaIds.length + ' / 2';
      document.getElementById('summary-total-cost').innerText = (selectedCartelaIds.length * 10).toFixed(2) + ' BIRR';
    }

    async function confirmCartelaPurchase() {
      if (selectedCartelaIds.length === 0) return alert('Select at least 1 cartela');
      try {
        const res = await fetch('/api/cartela/purchase', {
          method: 'POST',
          headers: API_HEADERS,
          body: JSON.stringify({ roomId: activeRoomId, cartelaIds: selectedCartelaIds })
        });
        const data = await res.json();
        if (data.success) {
          await refreshWallet();
          launchLiveGameSession();
        } else {
          alert('Purchase failed: ' + data.message);
        }
      } catch (e) {
        alert('Network error during purchase.');
      }
    }

    function launchLiveGameSession() {
      switchView('live-game');
      renderLiveCartelas();
      if (gamePollTimer) clearInterval(gamePollTimer);
      gamePollTimer = setInterval(pollLiveGameState, 1800);
      pollLiveGameState();
    }

    function renderLiveCartelas() {
      const container = document.getElementById('live-cartelas-container');
      container.innerHTML = '';

      selectedCartelaIds.forEach(cId => {
        const item = cartelasCatalog.find(c => c.id === cId);
        if (!item) return;
        const matrix = typeof item.matrix === 'string' ? JSON.parse(item.matrix) : item.matrix;

        const board = document.createElement('div');
        board.className = 'cartela-board';
        board.id = 'live-board-' + cId;

        let cellsHtml = '';
        ['B', 'I', 'N', 'G', 'O'].forEach(l => {
          cellsHtml += \`<div class="col-letter">\${l}</div>\`;
        });

        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const val = matrix[r][c];
            if (val === 0) {
              cellsHtml += \`<div class="cell-val free-spot" data-cell="0">FREE</div>\`;
            } else {
              cellsHtml += \`<div class="cell-val" data-cell="\${val}">\${val}</div>\`;
            }
          }
        }

        board.innerHTML = \`
          <div class="board-header">Cartela #\${item.cartela_number}</div>
          <div class="matrix-5x5">\${cellsHtml}</div>
        \`;
        container.appendChild(board);
      });
    }

    async function pollLiveGameState() {
      if (!activeRoomId) return;
      try {
        const res = await fetch('/api/game/state?roomId=' + activeRoomId, { headers: API_HEADERS });
        const data = await res.json();
        if (!data.success) return;

        const gs = data.gameState;
        document.getElementById('game-pot-val').innerText = gs.prizePool || '0';
        document.getElementById('game-call-index').innerText = gs.calledNumbers ? gs.calledNumbers.length : '0';
        document.getElementById('game-next-timer').innerText = gs.status === 'PLAYING' 
          ? 'Next Call: ' + gs.nextCallInSeconds + 's' 
          : 'Status: ' + gs.status;

        // Current Ball
        if (gs.currentNumber) {
          const num = gs.currentNumber;
          let letter = 'B';
          if (num > 15 && num <= 30) letter = 'I';
          if (num > 30 && num <= 45) letter = 'N';
          if (num > 45 && num <= 60) letter = 'G';
          if (num > 60) letter = 'O';

          document.getElementById('current-ball-letter').innerText = letter;
          document.getElementById('current-ball-number').innerText = num;

          // Audio Speech Synthesizer
          if (document.getElementById('setting-voice').checked && lastSpokenNumber !== num) {
            lastSpokenNumber = num;
            if ('speechSynthesis' in window) {
              const utter = new SpeechSynthesisUtterance(letter + ' ' + num);
              utter.rate = 1.1;
              window.speechSynthesis.speak(utter);
            }
          }
        }

        // Recent Numbers Ribbon
        const ribbon = document.getElementById('recent-calls-ribbon');
        ribbon.innerHTML = '';
        const called = gs.calledNumbers || [];
        called.slice(-7).reverse().forEach(n => {
          const p = document.createElement('div');
          p.className = 'recent-pill';
          p.innerText = n;
          ribbon.appendChild(p);
        });

        // Mark Matching Cells on all rendered boards
        const calledSet = new Set(called);
        document.querySelectorAll('.cell-val').forEach(cell => {
          const v = parseInt(cell.getAttribute('data-cell'), 10);
          if (v !== 0 && calledSet.has(v)) {
            cell.classList.add('marked');
          }
        });

        // Winner Detected
        if (gs.status === 'FINISHED' && gs.winners && gs.winners.length > 0) {
          clearInterval(gamePollTimer);
          const w = gs.winners[0];
          document.getElementById('win-modal-pot').innerText = gs.prizePool + ' BIRR';
          document.getElementById('win-modal-winner-name').innerText = 'Winner: ' + w.display_name;
          document.getElementById('win-modal-cartela-num').innerText = 'Cartela: #' + w.cartela_number;
          document.getElementById('winner-modal').classList.add('active');
          await refreshWallet();
        }
      } catch (e) {
        console.error('Poll error', e);
      }
    }

    async function claimBingoVictory() {
      if (!activeRoomId || selectedCartelaIds.length === 0) return;
      try {
        const res = await fetch('/api/game/bingo', {
          method: 'POST',
          headers: API_HEADERS,
          body: JSON.stringify({ roomId: activeRoomId, cartelaId: selectedCartelaIds[0] })
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('win-modal-pot').innerText = data.prizeAmount + ' BIRR';
          document.getElementById('win-modal-winner-name').innerText = 'You Won!';
          document.getElementById('win-modal-cartela-num').innerText = 'Cartela: #' + data.cartelaNumber;
          document.getElementById('winner-modal').classList.add('active');
          await refreshWallet();
        } else {
          alert('Bingo claim rejected: ' + data.message);
        }
      } catch (e) {
        alert('Verification error.');
      }
    }

    function closeWinnerModal() {
      document.getElementById('winner-modal').classList.remove('active');
      switchView('home');
    }

    async function submitDepositOrder() {
      const amount = document.getElementById('inp-dep-amt').value;
      const paymentMethod = document.getElementById('inp-dep-method').value;
      const transactionId = document.getElementById('inp-dep-txid').value;

      const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ amount, paymentMethod, transactionId })
      });
      const data = await res.json();
      if (data.success) {
        alert('Deposit order queued for verification.');
        document.getElementById('inp-dep-amt').value = '';
        document.getElementById('inp-dep-txid').value = '';
      } else {
        alert('Error: ' + data.message);
      }
    }

    async function submitWithdrawOrder() {
      const amount = document.getElementById('inp-wd-amt').value;
      const paymentMethod = document.getElementById('inp-wd-method').value;
      const accountNumber = document.getElementById('inp-wd-acc').value;
      const accountHolder = document.getElementById('inp-wd-name').value;

      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ amount, paymentMethod, accountNumber, accountHolder })
      });
      const data = await res.json();
      if (data.success) {
        alert('Withdrawal request placed successfully.');
        await refreshWallet();
      } else {
        alert('Error: ' + data.message);
      }
    }

    async function loadHistory() {
      const list = document.getElementById('history-audit-list');
      try {
        const res = await fetch('/api/history', { headers: API_HEADERS });
        const data = await res.json();
        if (!data.transactions || data.transactions.length === 0) {
          list.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:16px;">No transactions recorded.</div>';
          return;
        }
        list.innerHTML = data.transactions.map(t => \`
          <div style="background:var(--bg-card); border:1px solid var(--bg-card-border); border-radius:12px; padding:10px 14px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; font-weight:800; font-size:13px;">
              <span>\${t.type}</span>
              <span style="color:var(--bright-gold);">\${t.amount} BIRR</span>
            </div>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Bal: \${t.balance_after} BIRR | \${new Date(t.created_at).toLocaleDateString()}</div>
          </div>
        \`).join('');
      } catch (e) {
        list.innerHTML = 'Error loading history.';
      }
    }

    function copyInviteLink() {
      const copyText = document.getElementById("invite-link-input");
      copyText.select();
      copyText.setSelectionRange(0, 99999);
      navigator.clipboard.writeText(copyText.value);
      alert("Invite link copied to clipboard!");
    }

    window.addEventListener('load', async () => {
      await refreshWallet();
      await loadRooms();
    });
  </script>
</body>
</html>`;
}

// ============================================================================
// 12. RUNTIME SERVERLESS / HTTP HANDLER
// ============================================================================
async function appHandler(req, res) {
  try {
    await initDatabase();
  } catch (err) {
    console.error('Database connection error:', err);
  }

  const parsedUrl = url.parse(req.url, true);

  if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(getMiniAppHTML());
  }

  if (parsedUrl.pathname.startsWith('/api/')) {
    return handleApiRequest(req, res, parsedUrl);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

module.exports = appHandler;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(appHandler);
  server.listen(PORT, () => {
    console.log(`Shisho Bingo running on http://localhost:${PORT}`);
  });
}