/**
 * ============================================================================
 * SHISHO BINGO — COMPLETE SINGLE-FILE ARCHITECTURE
 * Engine: Node.js Vanilla HTTP + PostgreSQL (pg) + Telegram Mini App
 * Module: 100-Cartela Selection + Live Previews (Exact Screenshot 3 Match)
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
      balance DECIMAL(14,2) NOT NULL DEFAULT 240.00 CHECK (balance >= 0),
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
    const roomNum = 8448;
    const startsAt = new Date(Date.now() + 60 * 1000);
    await query(
      "INSERT INTO rooms (room_number, stake, capacity, status, starts_at) VALUES ($1, $2, $3, 'WAITING', $4) ON CONFLICT (room_number) DO NOTHING",
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
// 4. CORE REPOSITORY (USERS & WALLETS)
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
    await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 240.00)', [user.id]);
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
  if (res.rows.length === 0) return '240.00';
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
// 5. BINGO MATRIX GENERATION (1..100)
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

  cols.N[2] = 0; // FREE Center Spot

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
// 6. ATOMIC CARTELA TOGGLE (SELECTION & REFUND)
// ============================================================================
async function toggleCartelaAtomic(userId, roomId, cartelaNum) {
  const cNum = parseInt(cartelaNum, 10);
  if (isNaN(cNum) || cNum < 1 || cNum > CONFIG.TOTAL_CARTELAS) {
    throw new Error('CARTELA_NOT_FOUND');
  }

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');

    const rRes = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
    if (rRes.rows.length === 0) throw new Error('ROOM_NOT_FOUND');
    const room = rRes.rows[0];

    if (room.status === 'PLAYING' || room.status === 'FINISHED') {
      throw new Error('GAME_ALREADY_STARTED');
    }

    const existingRes = await client.query(
      'SELECT * FROM room_cartelas WHERE room_id = $1 AND cartela_number = $2 FOR UPDATE',
      [roomId, cNum]
    );

    if (existingRes.rows.length > 0) {
      const reservation = existingRes.rows[0];

      if (reservation.user_id === userId) {
        await client.query('DELETE FROM room_cartelas WHERE id = $1', [reservation.id]);

        const newBal = await modifyWalletAtomic(client, {
          userId,
          amount: CONFIG.GAME_STAKE,
          type: 'GAME_REFUND',
          referenceId: `REFUND_R${roomId}_C${cNum}`,
          description: `Refund for Cartela #${cNum} in Room #${room.room_number}`,
        });

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
        throw new Error('CARTELA_TAKEN');
      }
    }

    const userSelections = await client.query(
      'SELECT cartela_number FROM room_cartelas WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (userSelections.rows.length >= CONFIG.MAX_CARTELAS) {
      throw new Error('MAX_CARTELAS_REACHED');
    }

    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) throw new Error('WALLET_UNAVAILABLE');
    if (parseFloat(wRes.rows[0].balance) < CONFIG.GAME_STAKE) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    try {
      await client.query(
        'INSERT INTO room_cartelas (room_id, cartela_number, user_id) VALUES ($1, $2, $3)',
        [roomId, cNum, userId]
      );
    } catch (err) {
      if (err.code === '23505') throw new Error('CARTELA_TAKEN');
      throw err;
    }

    await client.query(
      'INSERT INTO room_players (room_id, user_id) VALUES ($1, $2) ON CONFLICT (room_id, user_id) DO NOTHING',
      [roomId, userId]
    );

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

async function leaveRoomAtomic(userId, roomId) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
    if (rRes.rows.length === 0) throw new Error('ROOM_NOT_FOUND');
    const room = rRes.rows[0];

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

// ============================================================================
// 7. REST API CONTROLLER
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
    if (tgUser) return await findOrCreateUser(tgUser);
  }
  // Seamless fallback user for browser testing without Telegram iframe
  return await findOrCreateUser({ id: 1000888999, first_name: 'Player', username: 'shisho_player' });
}

async function handleApiRequest(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const authUser = await authenticateRequest(req);

  if (req.method === 'GET' && pathname === '/api/health') {
    return jsonResponse(res, 200, { success: true, service: 'shisho-bingo' });
  }

  if (req.method === 'GET' && pathname === '/api/wallet') {
    try {
      const balance = await getAuthoritativeWallet(authUser.id);
      return jsonResponse(res, 200, {
        success: true,
        user: { id: authUser.id, display_name: authUser.display_name, telegram_id: authUser.telegram_id },
        balance,
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'WALLET_UNAVAILABLE' });
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
        WHERE r.status = 'WAITING' OR r.status = 'STARTING'
        GROUP BY r.id
        ORDER BY r.id ASC
      `);
      return jsonResponse(res, 200, { success: true, rooms: roomsRes.rows });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR' });
    }
  }

  const roomCartelasMatch = pathname.match(/^\/api\/rooms\/(\d+)\/cartelas$/);
  if (req.method === 'GET' && roomCartelasMatch) {
    const roomId = parseInt(roomCartelasMatch[1], 10);
    try {
      const rRes = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
      if (rRes.rows.length === 0) return jsonResponse(res, 404, { success: false, error: 'ROOM_NOT_FOUND' });
      const room = rRes.rows[0];

      const reservations = await query(
        'SELECT cartela_number, user_id FROM room_cartelas WHERE room_id = $1',
        [roomId]
      );

      const userBal = await getAuthoritativeWallet(authUser.id);
      const myCartelas = [];
      const statusMap = {};

      reservations.rows.forEach((r) => {
        if (r.user_id === authUser.id) {
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

      let secondsLeft = 20;
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
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR' });
    }
  }

  const toggleMatch = pathname.match(/^\/api\/rooms\/(\d+)\/cartelas\/(\d+)\/toggle$/);
  if (req.method === 'POST' && toggleMatch) {
    const roomId = parseInt(toggleMatch[1], 10);
    const cartelaNum = parseInt(toggleMatch[2], 10);

    try {
      const result = await toggleCartelaAtomic(authUser.id, roomId, cartelaNum);
      return jsonResponse(res, 200, result);
    } catch (e) {
      return jsonResponse(res, 400, { success: false, error: e.message });
    }
  }

  const previewMatch = pathname.match(/^\/api\/cartelas\/(\d+)\/matrix$/);
  if (req.method === 'GET' && previewMatch) {
    const cartelaNum = parseInt(previewMatch[1], 10);
    try {
      const resC = await query('SELECT cartela_number, matrix FROM cartelas WHERE cartela_number = $1', [cartelaNum]);
      if (resC.rows.length === 0) {
        return jsonResponse(res, 200, { success: true, cartelaNumber: cartelaNum, matrix: generateBingoMatrix(cartelaNum) });
      }
      return jsonResponse(res, 200, {
        success: true,
        cartelaNumber: cartelaNum,
        matrix: typeof resC.rows[0].matrix === 'string' ? JSON.parse(resC.rows[0].matrix) : resC.rows[0].matrix,
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'SERVER_ERROR' });
    }
  }

  const leaveMatch = pathname.match(/^\/api\/rooms\/(\d+)\/leave$/);
  if (req.method === 'POST' && leaveMatch) {
    const roomId = parseInt(leaveMatch[1], 10);
    try {
      const resLeave = await leaveRoomAtomic(authUser.id, roomId);
      return jsonResponse(res, 200, resLeave);
    } catch (e) {
      return jsonResponse(res, 400, { success: false, error: e.message });
    }
  }

  return jsonResponse(res, 404, { success: false, error: 'NOT_FOUND' });
}

// ============================================================================
// 8. EMBEDDED MINI APP (HTML, CSS & JS EXACT SCREENSHOT 3 MATCH)
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
      --bg-dark: #080511;
      --bg-card: rgba(23, 16, 36, 0.94);
      --bg-card-border: rgba(255, 216, 77, 0.16);
      --primary-gold: #ffc400;
      --bright-gold: #ffd84d;
      --gold-glow: rgba(255, 196, 0, 0.35);
      --purple-main: #6c3ccf;
      --purple-bright: #8e5bef;
      --purple-glow: rgba(110, 60, 207, 0.4);
      --taken-red: #ef4444;
      --taken-red-bg: rgba(239, 68, 68, 0.18);
      --text-white: #ffffff;
      --text-secondary: #a9a1b8;
      --text-muted: #6f6680;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background: radial-gradient(circle at 50% 10%, #1a0b30 0%, var(--bg-dark) 100%); color: var(--text-white); min-height: 100vh; display: flex; justify-content: center; }

    .app-viewport { width: 100%; max-width: 440px; min-height: 100vh; position: relative; padding-bottom: 84px; display: flex; flex-direction: column; }

    /* Top Gaming Header */
    .app-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(13, 7, 24, 0.95); backdrop-filter: blur(14px); position: sticky; top: 0; z-index: 100; border-bottom: 1px solid var(--bg-card-border); }
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

    /* Meta Bar */
    .room-header-meta { display: flex; justify-content: space-between; gap: 6px; margin-bottom: 10px; }
    .meta-box { background: var(--bg-card); border: 1px solid var(--bg-card-border); border-radius: 12px; padding: 8px 10px; text-align: center; flex: 1; }
    .meta-lbl { font-size: 9px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; }
    .meta-val { font-size: 13px; font-weight: 900; color: var(--bright-gold); }

    /* Legend Strip */
    .cartela-legend { display: flex; justify-content: center; gap: 14px; background: rgba(0,0,0,0.3); border-radius: 12px; padding: 8px; margin-bottom: 12px; font-size: 11px; font-weight: 700; border: 1px solid var(--bg-card-border); }
    .legend-item { display: flex; align-items: center; gap: 5px; }

    /* The 100 Cartela Grid (Screenshot 3 Match) */
    .cartela-100-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 16px; max-height: 290px; overflow-y: auto; padding: 4px; scrollbar-width: thin; scrollbar-color: var(--purple-main) transparent; border-radius: 12px; background: rgba(0,0,0,0.2); }
    
    .badge-cartela { aspect-ratio: 1.25; background: var(--bg-card); border: 1.5px solid rgba(255,255,255,0.08); border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; position: relative; user-select: none; }
    .badge-cartela:active { transform: scale(0.92); }
    .badge-cartela .c-num { font-size: 15px; font-weight: 900; color: #fff; }
    .badge-cartela .c-lbl { font-size: 8px; font-weight: 800; text-transform: uppercase; color: var(--text-muted); }

    .badge-cartela.mine { background: linear-gradient(135deg, rgba(255,196,0,0.25) 0%, rgba(255,216,77,0.1) 100%); border-color: var(--bright-gold); box-shadow: 0 0 12px var(--gold-glow); }
    .badge-cartela.mine .c-num { color: var(--bright-gold); }
    .badge-cartela.mine .c-lbl { color: var(--bright-gold); }

    .badge-cartela.taken { background: var(--taken-red-bg); border-color: var(--taken-red); opacity: 0.6; cursor: not-allowed; }
    .badge-cartela.taken .c-num { color: var(--taken-red); }
    .badge-cartela.taken .c-lbl { color: var(--taken-red); }

    .badge-cartela.loading { pointer-events: none; opacity: 0.7; }
    .badge-cartela.loading::after { content: ''; width: 14px; height: 14px; border: 2px solid var(--bright-gold); border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; position: absolute; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Cartela Live 5x5 Previews */
    .preview-section-title { font-size: 12px; font-weight: 800; color: var(--bright-gold); text-transform: uppercase; margin: 14px 0 8px 0; display: flex; align-items: center; justify-content: space-between; }
    .cartela-preview-board { background: var(--bg-card); border: 1.5px solid var(--primary-gold); border-radius: 14px; padding: 12px; margin-bottom: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
    .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 900; color: var(--bright-gold); }
    .matrix-5x5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .col-lbl { text-align: center; font-weight: 900; color: var(--bright-gold); font-size: 14px; padding-bottom: 2px; }
    .cell-val { aspect-ratio: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #fff; }
    .cell-val.free { background: linear-gradient(135deg, var(--primary-gold) 0%, #ff8c00 100%); color: #000; font-size: 9px; font-weight: 900; }

    /* Bottom Action Bar */
    .sticky-summary-bar { background: rgba(13, 7, 24, 0.96); backdrop-filter: blur(14px); border: 1.5px solid var(--bg-card-border); border-radius: 16px; padding: 12px 16px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
    .btn-gold-cta { background: linear-gradient(180deg, #ffd84d 0%, #ffaa00 100%); color: #090510; border: none; font-weight: 900; font-size: 13px; padding: 10px 18px; border-radius: 12px; cursor: pointer; text-transform: uppercase; box-shadow: 0 3px 12px var(--gold-glow); }

    /* Toast */
    .toast-msg { position: fixed; top: 70px; left: 50%; transform: translateX(-50%); background: rgba(13, 7, 24, 0.95); border: 1.5px solid var(--primary-gold); padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 800; color: #fff; z-index: 250; display: none; box-shadow: 0 4px 16px var(--gold-glow); }

    /* Navigation */
    .app-bottom-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 440px; height: 68px; background: rgba(13, 7, 24, 0.95); backdrop-filter: blur(16px); border-top: 1.5px solid var(--bg-card-border); border-top-left-radius: 18px; border-top-right-radius: 18px; display: flex; justify-content: space-around; align-items: center; z-index: 99; }
    .nav-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: none; color: var(--text-muted); cursor: pointer; flex: 1; }
    .nav-btn.active { color: var(--bright-gold); }
    .nav-btn svg { width: 22px; height: 22px; fill: currentColor; }
    .nav-btn-text { font-size: 10px; font-weight: 800; text-transform: uppercase; }
  </style>
</head>
<body>

  <div class="app-viewport">
    <div id="toast-bar" class="toast-msg"></div>

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
        <span class="balance-text" id="header-wallet-bal">240.00 BIRR</span>
      </div>
    </header>

    <!-- VIEW 1: LOBBY -->
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

    <!-- VIEW 2: CARTELA SELECTION (EXACT SCREENSHOT 3) -->
    <section id="view-cartela-picker" class="screen-view">
      <div class="room-header-meta">
        <div class="meta-box">
          <div class="meta-lbl">BALANCE</div>
          <div class="meta-val" id="picker-bal">240.00</div>
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
          <div class="meta-val" id="picker-countdown">20s</div>
        </div>
      </div>

      <div class="cartela-legend">
        <div class="legend-item"><span style="color:var(--text-muted);">🟣</span> Available</div>
        <div class="legend-item"><span style="color:var(--bright-gold);">🟡</span> Mine</div>
        <div class="legend-item"><span style="color:var(--taken-red);">🔴</span> Taken</div>
      </div>

      <!-- 100 Cartela Grid -->
      <div class="cartela-100-grid" id="cartelas-badge-grid"></div>

      <!-- Cartela Live Previews (Screenshot 3 Match) -->
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
          <button class="btn-gold-cta" style="background: rgba(255,255,255,0.08); color: #fff;" onclick="leaveCurrentRoom()">← LEAVE</button>
          <button class="btn-gold-cta" id="btn-continue-game" onclick="proceedToGameSession()">JOIN GAME →</button>
        </div>
      </div>
    </section>

    <!-- VIEW 3: WALLET -->
    <section id="view-wallet" class="screen-view">
      <div style="background: var(--bg-card); border: 1.5px solid var(--primary-gold); border-radius: 18px; padding: 20px; text-align: center; margin-bottom: 16px;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary);">Authoritative Balance</div>
        <div style="font-size: 34px; font-weight: 900; color: var(--bright-gold); margin: 6px 0;" id="wallet-big-bal">240.00 BIRR</div>
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

    let activeRoomId = 1;
    let mySelectedCartelas = [];
    let cartelaMatrixCache = {};
    let pickerSyncInterval = null;

    function showToast(text) {
      const b = document.getElementById('toast-bar');
      b.innerText = text;
      b.style.display = 'block';
      setTimeout(() => { b.style.display = 'none'; }, 2000);
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
          const bal = data.balance + ' BIRR';
          document.getElementById('header-wallet-bal').innerText = bal;
          document.getElementById('wallet-big-bal').innerText = bal;
        }
      } catch (e) {
        document.getElementById('header-wallet-bal').innerText = '240.00 BIRR';
      }
    }

    async function loadRooms() {
      try {
        const res = await fetch('/api/rooms', { headers: API_HEADERS });
        const data = await res.json();
        const container = document.getElementById('rooms-feed-list');
        container.innerHTML = '';

        const rooms = data.rooms && data.rooms.length > 0 ? data.rooms : [{ id: 1, room_number: 8448, stake: 10, current_players: 0, capacity: 20 }];

        rooms.forEach(r => {
          const div = document.createElement('div');
          div.style = 'background:var(--bg-card); border:1.5px solid var(--bg-card-border); border-radius:16px; padding:14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;';
          div.innerHTML = \`
            <div>
              <div style="font-size:15px; font-weight:800; color:#fff; margin-bottom:4px;">🎱 ROOM #\${r.room_number}</div>
              <div style="font-size:12px; color:var(--text-secondary);">Stake: <strong style="color:var(--bright-gold);">\${r.stake} BIRR</strong> | Players: <strong>\${r.current_players}/\${r.capacity}</strong></div>
              <div style="font-size:12px; color:var(--text-secondary);">Pot: <strong style="color:var(--bright-gold);">0.00 BIRR</strong></div>
            </div>
            <button class="btn-gold-cta" onclick="open100CartelaPicker(\${r.id})">JOIN +</button>
          \`;
          container.appendChild(div);
        });
      } catch (e) {
        console.error('Room load error', e);
      }
    }

    async function open100CartelaPicker(roomId) {
      activeRoomId = roomId;
      switchView('cartela-picker');

      renderInitial100Grid();
      await sync100CartelaState();
      if (pickerSyncInterval) clearInterval(pickerSyncInterval);
      pickerSyncInterval = setInterval(sync100CartelaState, 2000);
    }

    function renderInitial100Grid() {
      const grid = document.getElementById('cartelas-badge-grid');
      if (grid.children.length === 100) return;
      grid.innerHTML = '';

      for (let i = 1; i <= 100; i++) {
        const badge = document.createElement('div');
        badge.className = 'badge-cartela available';
        badge.id = \`cbadge-\${i}\`;
        badge.innerHTML = \`
          <div class="c-num">\${i}</div>
          <div class="c-lbl">OPEN</div>
        \`;
        badge.onclick = () => onCartelaBadgeTap(i);
        grid.appendChild(badge);
      }
    }

    async function sync100CartelaState() {
      if (!activeRoomId) return;
      try {
        const res = await fetch(\`/api/rooms/\${activeRoomId}/cartelas\`, { headers: API_HEADERS });
        const data = await res.json();
        if (!data.success) return;

        document.getElementById('picker-bal').innerText = data.balance;
        document.getElementById('header-wallet-bal').innerText = data.balance + ' BIRR';
        document.getElementById('picker-cost').innerText = (data.selectedCount * data.price).toFixed(2);
        document.getElementById('picker-pot').innerText = (data.cartelas.filter(c => c.status !== 'available').length * data.price).toFixed(2);
        document.getElementById('picker-countdown').innerText = data.startsInSeconds + 's';

        mySelectedCartelas = data.selectedCartelas || [];
        updateSummaryFooter(data.selectedCount, data.price);

        data.cartelas.forEach(c => {
          const badge = document.getElementById(\`cbadge-\${c.number}\`);
          if (badge) {
            badge.className = \`badge-cartela \${c.status}\`;
            let lbl = 'OPEN';
            if (c.status === 'mine') lbl = 'MINE';
            if (c.status === 'taken') lbl = 'TAKEN';
            badge.querySelector('.c-lbl').innerText = lbl;
          }
        });

        renderSelectedPreviews();
      } catch (e) {
        console.error('Sync failed', e);
      }
    }

    async function onCartelaBadgeTap(cartelaNum) {
      const badge = document.getElementById(\`cbadge-\${cartelaNum}\`);
      if (badge && badge.classList.contains('taken')) {
        showToast('🔴 Cartela already taken');
        return;
      }

      if (badge) badge.classList.add('loading');

      try {
        const res = await fetch(\`/api/rooms/\${activeRoomId}/cartelas/\${cartelaNum}/toggle\`, {
          method: 'POST',
          headers: API_HEADERS
        });
        const data = await res.json();

        if (data.success) {
          showToast(data.action === 'selected' ? \`✓ Cartela #\${cartelaNum} Selected (-10 BIRR)\` : \`✓ Cartela #\${cartelaNum} Released (+10 BIRR)\`);
          await sync100CartelaState();
        } else {
          showToast(data.error === 'MAX_CARTELAS_REACHED' ? '⚠️ Maximum 2 Cartelas Allowed' : data.error);
        }
      } catch (e) {
        showToast('Network error');
      } finally {
        if (badge) badge.classList.remove('loading');
      }
    }

    async function renderSelectedPreviews() {
      const container = document.getElementById('cartela-previews-container');
      document.getElementById('preview-count-label').innerText = \`\${mySelectedCartelas.length} Cartela(s) Selected\`;

      if (mySelectedCartelas.length === 0) {
        container.innerHTML = \`
          <div style="text-align: center; padding: 18px; color: var(--text-muted); font-size: 12px; background: rgba(0,0,0,0.25); border-radius: 12px;">
            Select any available cartela above to preview its 5x5 numbers.
          </div>\`;
        return;
      }

      container.innerHTML = '';

      for (const cNum of mySelectedCartelas) {
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
            cellsHtml += val === 0 ? \`<div class="cell-val free">FREE</div>\` : \`<div class="cell-val">\${val}</div>\`;
          }
        }

        board.innerHTML = \`
          <div class="preview-header">
            <span>Ticket #\${cNum}</span>
            <span style="color:var(--text-muted); font-size:10px; cursor:pointer;" onclick="onCartelaBadgeTap(\${cNum})">Tap to Remove ✖</span>
          </div>
          <div class="matrix-5x5">\${cellsHtml}</div>
        \`;
        container.appendChild(board);
      }
    }

    function updateSummaryFooter(count, price) {
      document.getElementById('summary-badge-count').innerText = \`\${count} / 2\`;
      document.getElementById('summary-total-cost').innerText = \`Total: \${(count * price).toFixed(2)} BIRR\`;
    }

    async function leaveCurrentRoom() {
      if (!confirm('Leave room and refund all selected cartelas?')) return;
      try {
        const res = await fetch(\`/api/rooms/\${activeRoomId}/leave\`, { method: 'POST', headers: API_HEADERS });
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
      if (mySelectedCartelas.length === 0) {
        showToast('Please select at least 1 cartela');
        return;
      }
      showToast('Joining live session...');
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
// 9. VERCEL SERVERLESS HANDLER
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