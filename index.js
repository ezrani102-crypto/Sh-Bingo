/**
 * ============================================================================
 * SHISHO BINGO — COMPLETE SINGLE-FILE ARCHITECTURE
 * Engine: Node.js Vanilla HTTP + PostgreSQL (pg) + Telegram Mini App
 * Module: Complete 100-Cartela Atomic Selection & Live Preview System
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
  TOTAL_CARTELAS: 100,
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
      starts_at TIMESTAMP WITH TIME ZONE,
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
      cartela_number INT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(room_id, cartela_number)
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
      started_at TIMESTAMP WITH TIME ZONE,
      finished_at TIMESTAMP WITH TIME ZONE
    );

    CREATE TABLE IF NOT EXISTS game_winners (
      id SERIAL PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cartela_number INT NOT NULL,
      prize_amount DECIMAL(14,2) NOT NULL,
      pattern_matched VARCHAR(64) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_cartelas_lookup ON room_cartelas(room_id, user_id);
  `;
  try {
    await query(sql);
    await seed100DefaultCartelas();
    await ensureDefaultWaitingRoom();
    dbInitialized = true;
    console.log("Database initialized with 100-Cartela configuration.");
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Generates exactly 100 deterministic B-I-N-G-O matrix cards
async function seed100DefaultCartelas() {
  const res = await query('SELECT COUNT(*) FROM cartelas');
  if (parseInt(res.rows[0].count, 10) >= CONFIG.TOTAL_CARTELAS) return;

  for (let i = 1; i <= CONFIG.TOTAL_CARTELAS; i++) {
    const matrix = generateBingoMatrix(i);
    await query(
      'INSERT INTO cartelas (cartela_number, matrix) VALUES ($1, $2) ON CONFLICT (cartela_number) DO UPDATE SET matrix = $2',
      [i, JSON.stringify(matrix)]
    );
  }
}

async function ensureDefaultWaitingRoom() {
  const res = await query("SELECT id FROM rooms WHERE status = 'WAITING' LIMIT 1");
  if (res.rows.length === 0) {
    const roomNum = 1000 + Math.floor(Math.random() * 9000);
    const startsAt = new Date(Date.now() + 60 * 1000); // 60s countdown
    await query(
      "INSERT INTO rooms (room_number, stake, capacity, status, starts_at) VALUES ($1, $2, $3, 'WAITING', $4)",
      [roomNum, CONFIG.GAME_STAKE, CONFIG.ROOM_CAPACITY, startsAt]
    );
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
// 4. CORE REPOSITORY (USERS & AUTHORITATIVE WALLETS)
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

// ============================================================================
// 5. BINGO MATRIX GENERATOR (DETERMINISTIC 1..100)
// ============================================================================
function generateBingoMatrix(cartelaNumber) {
  function pseudoRandom(s) {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  let localSeed = cartelaNumber * 2654435761;
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

  cols.N[2] = 0; // FREE Spot in Center

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
// 6. ATOMIC CARTELA TOGGLE (SELECTION, DESELECTION & CONCURRENCY)
// ============================================================================
async function toggleCartelaAtomic(userId, roomId, cartelaNum) {
  const cNum = parseInt(cartelaNum, 10);
  if (isNaN(cNum) || cNum < 1 || cNum > CONFIG.TOTAL_CARTELAS) {
    throw new Error('CARTELA_NOT_FOUND');
  }

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and Verify Room Status
    const rRes = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
    if (rRes.rows.length === 0) throw new Error('ROOM_NOT_FOUND');
    const room = rRes.rows[0];

    if (room.status === 'PLAYING' || room.status === 'FINISHED') {
      throw new Error('GAME_ALREADY_STARTED');
    }
    if (room.status !== 'WAITING' && room.status !== 'STARTING') {
      throw new Error('ROOM_NOT_ACCEPTING_CARTELAS');
    }

    // 2. Check if cartela is already reserved in this room
    const existingRes = await client.query(
      'SELECT * FROM room_cartelas WHERE room_id = $1 AND cartela_number = $2 FOR UPDATE',
      [roomId, cNum]
    );

    if (existingRes.rows.length > 0) {
      const reservation = existingRes.rows[0];

      // Cartela belongs to current user -> DESELECT & REFUND
      if (reservation.user_id === userId) {
        await client.query('DELETE FROM room_cartelas WHERE id = $1', [reservation.id]);

        // Refund 10 BIRR
        const newBal = await modifyWalletAtomic(client, {
          userId,
          amount: CONFIG.GAME_STAKE,
          type: 'GAME_REFUND',
          referenceId: `REFUND_R${roomId}_C${cNum}`,
          description: `Refund for Cartela #${cNum} in Room #${room.room_number}`,
        });

        // Check remaining cartelas for user in room
        const remaining = await client.query(
          'SELECT cartela_number FROM room_cartelas WHERE room_id = $1 AND user_id = $2',
          [roomId, userId]
        );
        if (remaining.rows.length === 0) {
          await client.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
        }

        await client.query('COMMIT');
        return {
          success: true,
          action: 'deselected',
          cartela: cNum,
          refund: CONFIG.GAME_STAKE.toFixed(2),
          balance: newBal,
          selectedCartelas: remaining.rows.map((r) => r.cartela_number),
        };
      } else {
        // Taken by another player
        throw new Error('CARTELA_TAKEN');
      }
    }

    // 3. Cartela is AVAILABLE -> SELECT & DEDUCT
    // Check user's current selections count in this room
    const userSelections = await client.query(
      'SELECT cartela_number FROM room_cartelas WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (userSelections.rows.length >= CONFIG.MAX_CARTELAS) {
      throw new Error('MAX_CARTELAS_REACHED');
    }

    // Check Wallet Balance >= 10 BIRR
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) throw new Error('WALLET_UNAVAILABLE');
    if (parseFloat(wRes.rows[0].balance) < CONFIG.GAME_STAKE) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    // Reserve Cartela with composite UNIQUE protection
    try {
      await client.query(
        'INSERT INTO room_cartelas (room_id, cartela_number, user_id) VALUES ($1, $2, $3)',
        [roomId, cNum, userId]
      );
    } catch (err) {
      if (err.code === '23505') throw new Error('CARTELA_TAKEN');
      throw err;
    }

    // Ensure player entry in room
    await client.query(
      'INSERT INTO room_players (room_id, user_id) VALUES ($1, $2) ON CONFLICT (room_id, user_id) DO NOTHING',
      [roomId, userId]
    );

    // Deduct 10 BIRR
    const newBal = await modifyWalletAtomic(client, {
      userId,
      amount: -CONFIG.GAME_STAKE,
      type: 'GAME_STAKE',
      referenceId: `STAKE_R${roomId}_C${cNum}`,
      description: `Cartela #${cNum} Room #${room.room_number}`,
    });

    const activeSelected = userSelections.rows.map((r) => r.cartela_number);
    activeSelected.push(cNum);

    await client.query('COMMIT');
    return {
      success: true,
      action: 'selected',
      cartela: cNum,
      amount: CONFIG.GAME_STAKE.toFixed(2),
      balance: newBal,
      selectedCartelas: activeSelected,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// User leaves waiting room -> Auto-release all their cartelas and refund atomically
async function leaveRoomAtomic(userId, roomId) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
    if (rRes.rows.length === 0) throw new Error('ROOM_NOT_FOUND');
    const room = rRes.rows[0];

    if (room.status === 'PLAYING' || room.status === 'FINISHED') {
      throw new Error('GAME_ALREADY_STARTED');
    }

    const ownedRes = await client.query(
      'SELECT cartela_number FROM room_cartelas WHERE room_id = $1 AND user_id = $2 FOR UPDATE',
      [roomId, userId]
    );
    const count = ownedRes.rows.length;

    let updatedBal = await getAuthoritativeWallet(userId);

    if (count > 0) {
      const refundTotal = parseFloat((count * CONFIG.GAME_STAKE).toFixed(2));
      await client.query('DELETE FROM room_cartelas WHERE room_id = $1 AND user_id = $2', [roomId, userId]);

      updatedBal = await modifyWalletAtomic(client, {
        userId,
        amount: refundTotal,
        type: 'GAME_REFUND',
        referenceId: `LEAVE_R${roomId}_COUNT_${count}`,
        description: `Refund for leaving room #${room.room_number} (${count} cartelas)`,
      });
    }

    await client.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
    await client.query('COMMIT');

    return { success: true, refundedAmount: (count * CONFIG.GAME_STAKE).toFixed(2), balance: updatedBal };
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

    // Auto-advance if 2 or more cartelas are bought and countdown elapsed
    const now = new Date();
    const isTimeUp = room.starts_at && now >= new Date(room.starts_at);

    if (cartelaCount >= 2 && isTimeUp) {
      const totalPot = (cartelaCount * CONFIG.GAME_STAKE).toFixed(2);
      const houseFee = ((totalPot * CONFIG.HOUSE_FEE_PERCENT) / 100).toFixed(2);
      const prizePool = (totalPot - houseFee).toFixed(2);
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
    console.error('Auto start error:', err);
  } finally {
    client.release();
  }
}

// ============================================================================
// 7. GAME TICK DRIVER & BINGO VALIDATION
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
      } else {
        await client.query("UPDATE games SET status = 'FINISHED', finished_at = NOW() WHERE id = $1", [game.id]);
        await client.query("UPDATE rooms SET status = 'FINISHED', updated_at = NOW() WHERE id = $2", [roomId]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
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

async function claimBingoAtomic(userId, roomId, cartelaNum) {
  const cNum = parseInt(cartelaNum, 10);
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const gRes = await client.query("SELECT * FROM games WHERE room_id = $1 AND status = 'PLAYING' FOR UPDATE", [
      roomId,
    ]);
    if (gRes.rows.length === 0) throw new Error('GAME_NOT_ACTIVE');
    const game = gRes.rows[0];

    const rcRes = await client.query(
      'SELECT * FROM room_cartelas WHERE room_id = $1 AND cartela_number = $2 AND user_id = $3',
      [roomId, cNum, userId]
    );
    if (rcRes.rows.length === 0) throw new Error('CARTELA_NOT_OWNED');

    const cRes = await client.query('SELECT * FROM cartelas WHERE cartela_number = $1', [cNum]);
    if (cRes.rows.length === 0) throw new Error('CARTELA_NOT_FOUND');
    const matrix = typeof cRes.rows[0].matrix === 'string' ? JSON.parse(cRes.rows[0].matrix) : cRes.rows[0].matrix;

    const called = typeof game.called_numbers === 'string' ? JSON.parse(game.called_numbers) : game.called_numbers;
    const check = verifyBingoPattern(matrix, new Set(called));
    if (!check.won) throw new Error('INVALID_BINGO_CLAIM');

    const prizeAmount = parseFloat(game.prize_pool).toFixed(2);
    await client.query(
      `INSERT INTO game_winners (game_id, user_id, cartela_number, prize_amount, pattern_matched) VALUES ($1, $2, $3, $4, $5)`,
      [game.id, userId, cNum, prizeAmount, check.pattern]
    );

    const updatedBal = await modifyWalletAtomic(client, {
      userId,
      amount: parseFloat(prizeAmount),
      type: 'GAME_PRIZE',
      referenceId: `GAME_${game.id}_WIN_${cNum}`,
      description: `Bingo Prize for Room #${roomId}, Cartela #${cNum}`,
    });

    await client.query("UPDATE games SET status = 'FINISHED', finished_at = NOW() WHERE id = $1", [game.id]);
    await client.query("UPDATE rooms SET status = 'FINISHED', updated_at = NOW() WHERE id = $2", [roomId]);
    await client.query('COMMIT');

    return {
      success: true,
      prizeAmount,
      updatedBalance: updatedBal,
      pattern: check.pattern,
      cartelaNumber: cNum,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// 8. TELEGRAM BOT ENGINE
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
    const welcome = `👑 *SHISHO BINGO*\n_Play. Win. Enjoy!_\n\nWelcome, *${user.display_name}*! Ethiopia's authentic 100-Cartela Bingo experience.\n\nTap *🎮 Play* below to join a live game!`;
    await sendTelegramMessage(chatId, welcome, defaultKeyboard);
    return;
  }

  if (text === '💰 Balance') {
    const bal = await getAuthoritativeWallet(user.id);
    await sendTelegramMessage(
      chatId,
      `💰 *Available Balance:* *${bal} BIRR*\n_Live synced with your mini app._`,
      defaultKeyboard
    );
    return;
  }
}

// ============================================================================
// 9. REST API ROUTER & CONTROLLER
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
    return await findOrCreateUser({ id: 999999999, first_name: 'TestPlayer', username: 'tester' });
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

  // Authoritative Wallet Endpoint
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
      return jsonResponse(res, 500, { success: false, error: 'WALLET_UNAVAILABLE', message: e.message });
    }
  }

  // Active Rooms Feed
  if (req.method === 'GET' && pathname === '/api/rooms') {
    try {
      const roomsRes = await query(`
        SELECT r.*, 
          COALESCE(COUNT(rc.id), 0) AS selected_cartelas,
          COALESCE(COUNT(DISTINCT rp.user_id), 0) AS current_players
        FROM rooms r
        LEFT JOIN room_cartelas rc ON rc.room_id = r.id
        LEFT JOIN room_players rp ON rp.room_id = r.id
        WHERE r.status = 'WAITING' OR r.status = 'STARTING'
        GROUP BY r.id
        ORDER BY r.id ASC
      `);
      return jsonResponse(res, 200, { success: true, rooms: roomsRes.rows });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR', message: e.message });
    }
  }

  // 100-Cartelas State for Room Endpoint
  const roomCartelasMatch = pathname.match(/^\/api\/rooms\/(\d+)\/cartelas$/);
  if (req.method === 'GET' && roomCartelasMatch) {
    const roomId = parseInt(roomCartelasMatch[1], 10);
    try {
      const rRes = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
      if (rRes.rows.length === 0) return jsonResponse(res, 404, { success: false, error: 'ROOM_NOT_FOUND' });
      const room = rRes.rows[0];

      // Auto start check
      await tryAutoStartRoom(roomId);

      const reservations = await query(
        'SELECT cartela_number, user_id FROM room_cartelas WHERE room_id = $1',
        [roomId]
      );

      const userBal = authUser ? await getAuthoritativeWallet(authUser.id) : '0.00';
      const myCartelas = [];
      const statusMap = {};

      reservations.rows.forEach((r) => {
        if (authUser && r.user_id === authUser.id) {
          statusMap[r.cartela_number] = 'mine';
          myCartelas.push(r.cartela_number);
        } else {
          statusMap[r.cartela_number] = 'taken';
        }
      });

      const cartelaList = [];
      for (let i = 1; i <= CONFIG.TOTAL_CARTELAS; i++) {
        cartelaList.push({
          number: i,
          status: statusMap[i] || 'available',
        });
      }

      // Compute room seconds remaining
      let secondsLeft = 0;
      if (room.starts_at) {
        secondsLeft = Math.max(0, Math.ceil((new Date(room.starts_at).getTime() - Date.now()) / 1000));
      }

      return jsonResponse(res, 200, {
        success: true,
        roomId: room.id,
        roomNumber: room.room_number,
        price: room.stake,
        maxCartelas: CONFIG.MAX_CARTELAS,
        balance: userBal,
        roomStatus: room.status,
        startsInSeconds: secondsLeft,
        selectedCount: myCartelas.length,
        selectedCartelas: myCartelas,
        cartelas: cartelaList,
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR', message: e.message });
    }
  }

  // Toggle Cartela Endpoint (Select / Deselect)
  const toggleMatch = pathname.match(/^\/api\/rooms\/(\d+)\/cartelas\/(\d+)\/toggle$/);
  if (req.method === 'POST' && toggleMatch) {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    const roomId = parseInt(toggleMatch[1], 10);
    const cartelaNum = parseInt(toggleMatch[2], 10);

    try {
      const result = await toggleCartelaAtomic(authUser.id, roomId, cartelaNum);
      await tryAutoStartRoom(roomId);
      return jsonResponse(res, 200, result);
    } catch (e) {
      const code = e.message || 'TRANSACTION_FAILED';
      const status = code === 'INSUFFICIENT_BALANCE' ? 402 : code === 'CARTELA_TAKEN' ? 409 : 400;
      return jsonResponse(res, status, { success: false, error: code, message: e.message });
    }
  }

  // Single Cartela Matrix Preview Endpoint
  const previewMatch = pathname.match(/^\/api\/cartelas\/(\d+)\/matrix$/);
  if (req.method === 'GET' && previewMatch) {
    const cartelaNum = parseInt(previewMatch[1], 10);
    try {
      const resC = await query('SELECT cartela_number, matrix FROM cartelas WHERE cartela_number = $1', [cartelaNum]);
      if (resC.rows.length === 0) return jsonResponse(res, 404, { success: false, error: 'CARTELA_NOT_FOUND' });
      return jsonResponse(res, 200, {
        success: true,
        cartelaNumber: cartelaNum,
        matrix: typeof resC.rows[0].matrix === 'string' ? JSON.parse(resC.rows[0].matrix) : resC.rows[0].matrix,
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR' });
    }
  }

  // Leave Room Endpoint
  const leaveMatch = pathname.match(/^\/api\/rooms\/(\d+)\/leave$/);
  if (req.method === 'POST' && leaveMatch) {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    const roomId = parseInt(leaveMatch[1], 10);
    try {
      const resLeave = await leaveRoomAtomic(authUser.id, roomId);
      return jsonResponse(res, 200, resLeave);
    } catch (e) {
      return jsonResponse(res, 400, { success: false, error: e.message });
    }
  }

  // Live Game State & Serverless Tick Driver
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
        `SELECT gw.*, u.display_name FROM game_winners gw 
         JOIN users u ON u.id = gw.user_id WHERE gw.game_id = $1`,
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
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR', message: e.message });
    }
  }

  // Claim Bingo
  if (req.method === 'POST' && pathname === '/api/game/bingo') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { roomId, cartelaNumber } = JSON.parse(body);
        const result = await claimBingoAtomic(authUser.id, roomId, cartelaNumber);
        return jsonResponse(res, 200, result);
      } catch (e) {
        return jsonResponse(res, 400, { success: false, error: 'BINGO_VERIFY_FAILED', message: e.message });
      }
    });
    return;
  }

  // Ledger History
  if (req.method === 'GET' && pathname === '/api/history') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    try {
      const txs = await query(
        'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
        [authUser.id]
      );
      return jsonResponse(res, 200, { success: true, transactions: txs.rows });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR', message: e.message });
    }
  }

  return jsonResponse(res, 404, { success: false, error: 'ENDPOINT_NOT_FOUND' });
}

// ============================================================================
// 10. EMBEDDED MINI APP FRONTEND (HTML + GLASSMORPHIC CSS + LOGIC)
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
      --bg-card: rgba(23, 16, 36, 0.92);
      --bg-card-border: rgba(255, 216, 77, 0.16);
      --primary-gold: #ffc400;
      --bright-gold: #ffd84d;
      --gold-glow: rgba(255, 196, 0, 0.4);
      --purple-main: #6c3ccf;
      --purple-bright: #8e5bef;
      --purple-glow: rgba(110, 60, 207, 0.4);
      --taken-red: #ef4444;
      --taken-red-bg: rgba(239, 68, 68, 0.18);
      --text-white: #ffffff;
      --text-secondary: #a9a1b8;
      --text-muted: #6f6680;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background: radial-gradient(circle at 50% 10%, #1a0b30 0%, var(--bg-dark-1) 100%); color: var(--text-white); min-height: 100vh; display: flex; justify-content: center; }

    .app-viewport { width: 100%; max-width: 460px; min-height: 100vh; position: relative; padding-bottom: 84px; display: flex; flex-direction: column; }

    /* Top Gaming Header */
    .app-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(13, 7, 24, 0.92); backdrop-filter: blur(14px); position: sticky; top: 0; z-index: 100; border-bottom: 1px solid var(--bg-card-border); }
    .brand-cluster { display: flex; align-items: center; gap: 8px; }
    .brand-crown { font-size: 22px; filter: drop-shadow(0 0 6px var(--gold-glow)); }
    .brand-title { font-size: 16px; font-weight: 900; letter-spacing: 0.5px; background: linear-gradient(180deg, #fff 0%, var(--bright-gold) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .brand-tag { font-size: 9px; text-transform: uppercase; color: var(--purple-bright); font-weight: 700; letter-spacing: 1px; }

    .balance-pill { background: linear-gradient(135deg, rgba(108, 60, 207, 0.45), rgba(255, 196, 0, 0.12)); border: 1.5px solid var(--primary-gold); padding: 5px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px; cursor: pointer; box-shadow: 0 0 10px var(--gold-glow); }
    .balance-text { font-size: 13px; font-weight: 800; color: var(--bright-gold); }

    /* Views */
    .screen-view { display: none; padding: 14px 16px; animation: screenFade 0.2s ease-in-out; }
    .screen-view.active { display: block; }
    @keyframes screenFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* 100-Cartela Screen Specifics */
    .room-header-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .meta-box { background: var(--bg-card); border: 1px solid var(--bg-card-border); border-radius: 12px; padding: 8px 12px; text-align: center; flex: 1; margin: 0 3px; }
    .meta-lbl { font-size: 9px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; }
    .meta-val { font-size: 13px; font-weight: 900; color: var(--bright-gold); }

    /* Visual Legend */
    .cartela-legend { display: flex; justify-content: center; gap: 14px; background: rgba(0,0,0,0.3); border-radius: 12px; padding: 8px; margin-bottom: 12px; font-size: 11px; font-weight: 700; border: 1px solid var(--bg-card-border); }
    .legend-item { display: flex; align-items: center; gap: 5px; }

    /* The 100 Number Badge Grid */
    .cartela-100-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 16px; max-height: 380px; overflow-y: auto; padding: 4px; scrollbar-width: thin; scrollbar-color: var(--purple-main) transparent; }
    
    .badge-cartela { aspect-ratio: 1.25; background: var(--bg-card); border: 1.5px solid rgba(255,255,255,0.08); border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; position: relative; user-select: none; }
    .badge-cartela:active { transform: scale(0.92); }
    .badge-cartela .c-num { font-size: 15px; font-weight: 900; color: #fff; }
    .badge-cartela .c-lbl { font-size: 8px; font-weight: 800; text-transform: uppercase; color: var(--text-muted); }

    /* State: MINE (Selected by Authenticated User) */
    .badge-cartela.mine { background: linear-gradient(135deg, rgba(255,196,0,0.25) 0%, rgba(255,216,77,0.1) 100%); border-color: var(--bright-gold); box-shadow: 0 0 12px var(--gold-glow); }
    .badge-cartela.mine .c-num { color: var(--bright-gold); }
    .badge-cartela.mine .c-lbl { color: var(--bright-gold); }

    /* State: TAKEN (Reserved by another player) */
    .badge-cartela.taken { background: var(--taken-red-bg); border-color: var(--taken-red); opacity: 0.6; cursor: not-allowed; }
    .badge-cartela.taken .c-num { color: var(--taken-red); }
    .badge-cartela.taken .c-lbl { color: var(--taken-red); }

    /* State: LOADING */
    .badge-cartela.loading { pointer-events: none; opacity: 0.7; }
    .badge-cartela.loading::after { content: ''; width: 14px; height: 14px; border: 2px solid var(--bright-gold); border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; position: absolute; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Dynamic Cartela Live Previews */
    .preview-section-title { font-size: 12px; font-weight: 800; color: var(--bright-gold); text-transform: uppercase; margin: 14px 0 8px 0; display: flex; align-items: center; justify-content: space-between; }
    .cartela-preview-board { background: var(--bg-card); border: 1.5px solid var(--primary-gold); border-radius: 14px; padding: 12px; margin-bottom: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
    .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 900; color: var(--bright-gold); }
    .matrix-5x5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .col-lbl { text-align: center; font-weight: 900; color: var(--bright-gold); font-size: 14px; padding-bottom: 2px; }
    .cell-val { aspect-ratio: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #fff; }
    .cell-val.free { background: linear-gradient(135deg, var(--primary-gold) 0%, #ff8c00 100%); color: #000; font-size: 9px; font-weight: 900; }
    .cell-val.marked { background: linear-gradient(135deg, var(--purple-main) 0%, var(--purple-bright) 100%); border-color: var(--bright-gold); box-shadow: 0 0 6px var(--purple-glow); }

    /* Sticky Bottom Summary */
    .sticky-summary-bar { background: rgba(13, 7, 24, 0.96); backdrop-filter: blur(14px); border: 1.5px solid var(--bg-card-border); border-radius: 16px; padding: 12px 16px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
    .btn-gold-cta { background: linear-gradient(180deg, #ffd84d 0%, #ffaa00 100%); color: #090510; border: none; font-weight: 900; font-size: 13px; padding: 10px 18px; border-radius: 12px; cursor: pointer; text-transform: uppercase; box-shadow: 0 3px 12px var(--gold-glow); }
    .btn-gold-cta:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Live Game Caller Podium */
    .ball-caller-podium { background: radial-gradient(circle at 50% 50%, rgba(108, 60, 207, 0.45) 0%, rgba(10, 5, 20, 0) 70%); border: 2px solid var(--purple-main); border-radius: 20px; padding: 16px; text-align: center; margin-bottom: 12px; }
    .ball-halo { width: 84px; height: 84px; border-radius: 50%; background: linear-gradient(135deg, #ffd84d 0%, #ff8c00 100%); margin: 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 0 24px var(--gold-glow); animation: pulseBall 1.5s infinite alternate; }
    @keyframes pulseBall { from { transform: scale(0.96); } to { transform: scale(1.03); } }
    .ball-letter { font-size: 13px; font-weight: 900; color: rgba(0, 0, 0, 0.7); }
    .ball-digit { font-size: 36px; font-weight: 900; color: #000; }

    /* Toast Notification */
    .toast-msg { position: fixed; top: 70px; left: 50%; transform: translateX(-50%); background: rgba(13, 7, 24, 0.95); border: 1.5px solid var(--primary-gold); padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 800; color: #fff; z-index: 250; display: none; box-shadow: 0 4px 16px var(--gold-glow); }

    /* Nav Bar */
    .app-bottom-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 460px; height: 68px; background: rgba(13, 7, 24, 0.95); backdrop-filter: blur(16px); border-top: 1.5px solid var(--bg-card-border); border-top-left-radius: 18px; border-top-right-radius: 18px; display: flex; justify-content: space-around; align-items: center; z-index: 99; }
    .nav-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: none; color: var(--text-muted); cursor: pointer; flex: 1; }
    .nav-btn.active { color: var(--bright-gold); }
    .nav-btn svg { width: 22px; height: 22px; fill: currentColor; }
    .nav-btn-text { font-size: 10px; font-weight: 800; text-transform: uppercase; }
  </style>
</head>
<body>

  <div class="app-viewport">
    
    <div id="toast-bar" class="toast-msg"></div>

    <!-- Header -->
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

    <!-- VIEW 1: LOBBY / ROOMS -->
    <main id="view-home" class="screen-view active">
      <div style="background: linear-gradient(135deg, rgba(110,60,207,0.4) 0%, rgba(26,16,48,0.8) 100%); border: 1.5px solid rgba(255,196,0,0.28); border-radius: 18px; padding: 18px; text-align: center; margin-bottom: 16px;">
        <div style="font-size: 32px; margin-bottom: 6px;">👑</div>
        <div style="font-size: 22px; font-weight: 900; color: var(--bright-gold);">AUTHENTIC 100 CARTELAS</div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Choose your lucky tickets. Max 2 per player.</div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="font-size: 13px; font-weight: 800; color: var(--bright-gold);">WAITING ROOMS</span>
        <span style="font-size: 11px; color: var(--purple-bright); cursor: pointer;" onclick="loadRooms()">🔄 Refresh</span>
      </div>
      <div id="rooms-feed-list"></div>
    </main>

    <!-- VIEW 2: 100-CARTELA SELECTION SCREEN (Screenshot 2 Match) -->
    <section id="view-cartela-picker" class="screen-view">
      <div class="room-header-meta">
        <div class="meta-box">
          <div class="meta-lbl">BALANCE</div>
          <div class="meta-val" id="picker-bal">0.00</div>
        </div>
        <div class="meta-box">
          <div class="meta-lbl">COST</div>
          <div class="meta-val" id="picker-cost">0.00</div>
        </div>
        <div class="meta-box">
          <div class="meta-lbl">POT</div>
          <div class="meta-val" id="picker-pot">0.00</div>
        </div>
        <div class="meta-box">
          <div class="meta-lbl">STARTS IN</div>
          <div class="meta-val" id="picker-countdown">00s</div>
        </div>
      </div>

      <!-- Legend -->
      <div class="cartela-legend">
        <div class="legend-item"><span style="color:var(--text-muted);">🟣</span> Available</div>
        <div class="legend-item"><span style="color:var(--bright-gold);">🟡</span> Mine</div>
        <div class="legend-item"><span style="color:var(--taken-red);">🔴</span> Taken</div>
      </div>

      <!-- 100 Cartela Grid Container -->
      <div class="cartela-100-grid" id="cartelas-badge-grid"></div>

      <!-- Dynamic Real-Time Previews of Selected Cartelas -->
      <div class="preview-section-title">
        <span>Cartela Live Preview</span>
        <span id="preview-count-label" style="font-size: 11px; color: var(--text-muted);">0 Cartelas Selected</span>
      </div>
      <div id="cartela-previews-container">
        <div style="text-align: center; padding: 18px; color: var(--text-muted); font-size: 12px; background: rgba(0,0,0,0.25); border-radius: 12px;">
          Select any available cartela above to preview its 5x5 numbers.
        </div>
      </div>

      <!-- Bottom Sticky Action Bar -->
      <div class="sticky-summary-bar">
        <div>
          <div style="font-size: 11px; color: var(--text-secondary);">Selected: <strong id="summary-badge-count" style="color:var(--bright-gold);">0/2</strong></div>
          <div style="font-size: 13px; font-weight: 900; color: #fff;" id="summary-total-cost">Total: 0 BIRR</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-gold-cta" style="background: rgba(255,255,255,0.08); color: #fff;" onclick="leaveCurrentRoom()">← Leave</button>
          <button class="btn-gold-cta" id="btn-continue-game" onclick="proceedToGameSession()">Join Game →</button>
        </div>
      </div>
    </section>

    <!-- VIEW 3: LIVE BINGO GAME -->
    <section id="view-live-game" class="screen-view">
      <div class="room-header-meta">
        <div class="meta-box">
          <div class="meta-lbl">ROOM</div>
          <div class="meta-val" id="live-room-num">#0</div>
        </div>
        <div class="meta-box">
          <div class="meta-lbl">PRIZE POT</div>
          <div class="meta-val" id="live-pot">0.00</div>
        </div>
        <div class="meta-box">
          <div class="meta-lbl">CALL #</div>
          <div class="meta-val" id="live-call-idx">0</div>
        </div>
      </div>

      <div class="ball-caller-podium">
        <div class="ball-halo">
          <div class="ball-letter" id="live-ball-ltr">-</div>
          <div class="ball-digit" id="live-ball-num">-</div>
        </div>
        <div style="font-size: 11px; color: var(--bright-gold); margin-top: 8px;" id="live-timer-text">Next call: 5s</div>
      </div>

      <!-- Live User Board Area -->
      <div id="live-boards-deck"></div>

      <button class="btn-gold-cta" style="width: 100%; margin-top: 10px;" onclick="claimBingoVictory()">🏆 CLAIM BINGO!</button>
    </section>

    <!-- VIEW 4: WALLET -->
    <section id="view-wallet" class="screen-view">
      <div style="background: var(--bg-card); border: 1.5px solid var(--primary-gold); border-radius: 18px; padding: 20px; text-align: center; margin-bottom: 16px;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary);">Authoritative Balance</div>
        <div style="font-size: 34px; font-weight: 900; color: var(--bright-gold); margin: 6px 0;" id="wallet-big-bal">0.00 BIRR</div>
        <div style="font-size: 11px; color: var(--text-muted);">Synchronized with PostgreSQL</div>
      </div>
    </section>

    <!-- Bottom Nav -->
    <nav class="app-bottom-nav">
      <button class="nav-btn active" id="nav-btn-home" onclick="switchView('home')">
        <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        <span class="nav-btn-text">Play</span>
      </button>
      <button class="nav-btn" id="nav-btn-wallet" onclick="switchView('wallet')">
        <svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
        <span class="nav-btn-text">Wallet</span>
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

    let activeRoomId = null;
    let activeRoomNumber = null;
    let mySelectedCartelas = [];
    let cartelaMatrixCache = {};
    let pickerSyncInterval = null;
    let gamePollInterval = null;

    function showToast(text) {
      const b = document.getElementById('toast-bar');
      b.innerText = text;
      b.style.display = 'block';
      setTimeout(() => { b.style.display = 'none'; }, 2200);
    }

    function switchView(viewName) {
      document.querySelectorAll('.screen-view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

      const target = document.getElementById('view-' + viewName);
      if (target) target.classList.add('active');

      const navBtn = document.getElementById('nav-btn-' + viewName);
      if (navBtn) navBtn.classList.add('active');

      if (viewName === 'home') {
        if (pickerSyncInterval) clearInterval(pickerSyncInterval);
        loadRooms();
      }
      if (viewName === 'wallet') refreshWallet();
    }

    async function refreshWallet() {
      try {
        const res = await fetch('/api/wallet', { headers: API_HEADERS });
        const data = await res.json();
        if (data.success) {
          const balText = data.balance + ' BIRR';
          document.getElementById('header-wallet-bal').innerText = balText;
          document.getElementById('wallet-big-bal').innerText = balText;
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
          div.style = 'background:var(--bg-card); border:1.5px solid var(--bg-card-border); border-radius:16px; padding:14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;';
          div.innerHTML = \`
            <div>
              <div style="font-size:15px; font-weight:800; color:#fff; margin-bottom:4px;">🎱 ROOM #\${r.room_number}</div>
              <div style="font-size:12px; color:var(--text-secondary);">Stake: <strong style="color:var(--bright-gold);">\${r.stake} BIRR</strong> | Players: <strong>\${r.current_players}/\${r.capacity}</strong></div>
              <div style="font-size:12px; color:var(--text-secondary);">Pot: <strong style="color:var(--bright-gold);">\${pot} BIRR</strong></div>
            </div>
            <button class="btn-gold-cta" onclick="open100CartelaPicker(\${r.id}, \${r.room_number})">JOIN +</button>
          \`;
          container.appendChild(div);
        });
      } catch (e) {
        console.error('Room load error', e);
      }
    }

    // Opens 100-Cartela Screen for Room
    async function open100CartelaPicker(roomId, roomNumber) {
      activeRoomId = roomId;
      activeRoomNumber = roomNumber;
      switchView('cartela-picker');

      await sync100CartelaState();
      if (pickerSyncInterval) clearInterval(pickerSyncInterval);
      pickerSyncInterval = setInterval(sync100CartelaState, 2000); // 2s Realtime sync
    }

    async function sync100CartelaState() {
      if (!activeRoomId) return;
      try {
        const res = await fetch(\`/api/rooms/\${activeRoomId}/cartelas\`, { headers: API_HEADERS });
        const data = await res.json();
        if (!data.success) return;

        // Sync header stats
        document.getElementById('picker-bal').innerText = data.balance;
        document.getElementById('header-wallet-bal').innerText = data.balance + ' BIRR';
        document.getElementById('picker-cost').innerText = (data.selectedCount * data.price).toFixed(2);
        document.getElementById('picker-pot').innerText = (data.cartelas.filter(c => c.status !== 'available').length * data.price).toFixed(2);
        document.getElementById('picker-countdown').innerText = data.startsInSeconds + 's';

        // Auto transition if game started
        if (data.roomStatus === 'PLAYING') {
          if (pickerSyncInterval) clearInterval(pickerSyncInterval);
          proceedToGameSession();
          return;
        }

        mySelectedCartelas = data.selectedCartelas || [];
        updateSummaryFooter(data.selectedCount, data.price);

        // Render 100 Badges
        render100Badges(data.cartelas);

        // Render Previews
        renderSelectedPreviews();
      } catch (e) {
        console.error('Picker sync failed', e);
      }
    }

    function render100Badges(cartelas) {
      const grid = document.getElementById('cartelas-badge-grid');
      grid.innerHTML = '';

      cartelas.forEach(c => {
        const badge = document.createElement('div');
        badge.className = \`badge-cartela \${c.status}\`;
        badge.id = \`cbadge-\${c.number}\`;

        let lbl = 'OPEN';
        if (c.status === 'mine') lbl = 'MINE';
        if (c.status === 'taken') lbl = 'TAKEN';

        badge.innerHTML = \`
          <div class="c-num">#\${c.number}</div>
          <div class="c-lbl">\${lbl}</div>
        \`;

        badge.onclick = () => onCartelaBadgeTap(c.number, c.status);
        grid.appendChild(badge);
      });
    }

    async function onCartelaBadgeTap(cartelaNum, currentStatus) {
      if (currentStatus === 'taken') {
        showToast('🔴 Cartela already taken');
        return;
      }

      const badge = document.getElementById(\`cbadge-\${cartelaNum}\`);
      if (badge) badge.classList.add('loading');

      try {
        const res = await fetch(\`/api/rooms/\${activeRoomId}/cartelas/\${cartelaNum}/toggle\`, {
          method: 'POST',
          headers: API_HEADERS
        });
        const data = await res.json();

        if (data.success) {
          if (data.action === 'selected') {
            showToast(\`✓ Cartela #\${cartelaNum} Selected (-10 BIRR)\`);
          } else {
            showToast(\`✓ Cartela #\${cartelaNum} Released (+10 BIRR)\`);
          }
          await sync100CartelaState();
        } else {
          if (data.error === 'MAX_CARTELAS_REACHED') {
            showToast('⚠️ Maximum 2 Cartelas Allowed');
          } else if (data.error === 'INSUFFICIENT_BALANCE') {
            showToast('💰 Insufficient Balance (Need 10 BIRR)');
          } else if (data.error === 'CARTELA_TAKEN') {
            showToast('🔴 Cartela was just taken');
            await sync100CartelaState();
          } else {
            showToast('Error: ' + data.error);
          }
        }
      } catch (e) {
        showToast('Network error');
      } finally {
        if (badge) badge.classList.remove('loading');
      }
    }

    async function renderSelectedPreviews() {
      const container = document.getElementById('cartela-previews-container');
      const countLabel = document.getElementById('preview-count-label');
      countLabel.innerText = \`\${mySelectedCartelas.length} Cartela(s) Selected\`;

      if (mySelectedCartelas.length === 0) {
        container.innerHTML = \`
          <div style="text-align: center; padding: 18px; color: var(--text-muted); font-size: 12px; background: rgba(0,0,0,0.25); border-radius: 12px;">
            Select any available cartela above to preview its 5x5 numbers.
          </div>\`;
        return;
      }

      container.innerHTML = '';

      for (const cNum of mySelectedCartelas) {
        // Fetch matrix if not cached
        if (!cartelaMatrixCache[cNum]) {
          try {
            const res = await fetch(\`/api/cartelas/\${cNum}/matrix\`, { headers: API_HEADERS });
            const d = await res.json();
            if (d.success) cartelaMatrixCache[cNum] = d.matrix;
          } catch (e) {}
        }

        const matrix = cartelaMatrixCache[cNum];
        if (!matrix) continue;

        const board = document.createElement('div');
        board.className = 'cartela-preview-board';

        let cellsHtml = '';
        ['B', 'I', 'N', 'G', 'O'].forEach(l => {
          cellsHtml += \`<div class="col-lbl">\${l}</div>\`;
        });

        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const val = matrix[r][c];
            if (val === 0) {
              cellsHtml += \`<div class="cell-val free">FREE</div>\`;
            } else {
              cellsHtml += \`<div class="cell-val">\${val}</div>\`;
            }
          }
        }

        board.innerHTML = \`
          <div class="preview-header">
            <span>Ticket #\${cNum}</span>
            <span style="color:var(--text-muted); font-size:10px; cursor:pointer;" onclick="onCartelaBadgeTap(\${cNum}, 'mine')">Tap to Remove ✖</span>
          </div>
          <div class="matrix-5x5">\${cellsHtml}</div>
        \`;
        container.appendChild(board);
      }
    }

    function updateSummaryFooter(count, price) {
      document.getElementById('summary-badge-count').innerText = \`\${count} / 2\`;
      document.getElementById('summary-total-cost').innerText = \`Total: \${(count * price).toFixed(2)} BIRR\`;
      document.getElementById('btn-continue-game').disabled = count === 0;
    }

    async function leaveCurrentRoom() {
      if (!confirm('Leave room and refund all selected cartelas?')) return;
      try {
        const res = await fetch(\`/api/rooms/\${activeRoomId}/leave\`, {
          method: 'POST',
          headers: API_HEADERS
        });
        const d = await res.json();
        if (d.success) {
          showToast(\`Refunded \${d.refundedAmount} BIRR\`);
          switchView('home');
        }
      } catch (e) {
        showToast('Error leaving room');
      }
    }

    function proceedToGameSession() {
      if (pickerSyncInterval) clearInterval(pickerSyncInterval);
      switchView('live-game');
      document.getElementById('live-room-num').innerText = '#' + activeRoomNumber;
      renderLiveBoardsDeck();

      if (gamePollInterval) clearInterval(gamePollInterval);
      gamePollInterval = setInterval(pollLiveGameState, 1800);
      pollLiveGameState();
    }

    function renderLiveBoardsDeck() {
      const deck = document.getElementById('live-boards-deck');
      deck.innerHTML = '';

      mySelectedCartelas.forEach(cNum => {
        const matrix = cartelaMatrixCache[cNum];
        if (!matrix) return;

        const board = document.createElement('div');
        board.className = 'cartela-preview-board';
        board.id = \`live-deck-\${cNum}\`;

        let cells = '';
        ['B', 'I', 'N', 'G', 'O'].forEach(l => {
          cells += \`<div class="col-lbl">\${l}</div>\`;
        });

        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const val = matrix[r][c];
            if (val === 0) {
              cells += \`<div class="cell-val free" data-cell="0">FREE</div>\`;
            } else {
              cells += \`<div class="cell-val" data-cell="\${val}">\${val}</div>\`;
            }
          }
        }

        board.innerHTML = \`
          <div class="preview-header">Cartela #\${cNum}</div>
          <div class="matrix-5x5">\${cells}</div>
        \`;
        deck.appendChild(board);
      });
    }

    async function pollLiveGameState() {
      if (!activeRoomId) return;
      try {
        const res = await fetch(\`/api/game/state?roomId=\${activeRoomId}\`, { headers: API_HEADERS });
        const d = await res.json();
        if (!d.success) return;

        const gs = d.gameState;
        document.getElementById('live-pot').innerText = gs.prizePool || '0.00';
        document.getElementById('live-call-idx').innerText = gs.calledNumbers?.length || '0';
        document.getElementById('live-timer-text').innerText = gs.status === 'PLAYING'
          ? \`Next call: \${gs.nextCallInSeconds}s\`
          : \`Status: \${gs.status}\`;

        if (gs.currentNumber) {
          const n = gs.currentNumber;
          let ltr = 'B';
          if (n > 15 && n <= 30) ltr = 'I';
          if (n > 30 && n <= 45) ltr = 'N';
          if (n > 45 && n <= 60) ltr = 'G';
          if (n > 60) ltr = 'O';

          document.getElementById('live-ball-ltr').innerText = ltr;
          document.getElementById('live-ball-num').innerText = n;
        }

        // Automatic Marking
        const calledSet = new Set(gs.calledNumbers || []);
        document.querySelectorAll('.cell-val').forEach(c => {
          const v = parseInt(c.getAttribute('data-cell'), 10);
          if (v !== 0 && calledSet.has(v)) {
            c.classList.add('marked');
          }
        });

        if (gs.status === 'FINISHED' && gs.winners?.length > 0) {
          clearInterval(gamePollInterval);
          alert(\`🎉 GAME OVER! Winner: \${gs.winners.map(w => w.display_name + ' (#' + w.cartela_number + ')').join(', ')}\`);
          await refreshWallet();
        }
      } catch (e) {
        console.error('Live game poll failed', e);
      }
    }

    async function claimBingoVictory() {
      if (!activeRoomId || mySelectedCartelas.length === 0) return;
      try {
        const res = await fetch('/api/game/bingo', {
          method: 'POST',
          headers: API_HEADERS,
          body: JSON.stringify({ roomId: activeRoomId, cartelaNumber: mySelectedCartelas[0] })
        });
        const d = await res.json();
        if (d.success) {
          alert(\`🎉 BINGO VERIFIED! You won \${d.prizeAmount} BIRR on Cartela #\${d.cartelaNumber}!\`);
          await refreshWallet();
        } else {
          alert('Bingo claim rejected: ' + d.message);
        }
      } catch (e) {
        alert('Verification request failed');
      }
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
// 11. RUNTIME SERVERLESS / HTTP HANDLER
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