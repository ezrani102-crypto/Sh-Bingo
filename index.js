/**
 * ============================================================================
 * SHISHO BINGO — COMPLETE SINGLE-FILE ARCHITECTURE
 * Engine: Node.js Vanilla HTTP + PostgreSQL (pg) + Telegram Mini App
 * Deployment Target: Vercel Serverless Function & Local Node.js
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
// 2. DATABASE CLIENT & INITIALIZATION
// ============================================================================
let pool;
function getDbPool() {
  if (!pool) {
    if (!CONFIG.DATABASE_URL) {
      console.warn("WARNING: DATABASE_URL is not set.");
    }
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
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

// Generate static 50 standard cartelas if none exist
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
// 3. SECURITY & TELEGRAM AUTHENTICATION
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
    if (!userRaw) return null;
    return JSON.parse(userRaw);
  } catch (err) {
    console.error('Telegram auth verification failed:', err);
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

    // Seed authoritative 0.00 wallet
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
  if (res.rows.length === 0) {
    throw new Error('WALLET_NOT_FOUND');
  }
  return parseFloat(res.rows[0].balance).toFixed(2);
}

async function modifyWalletAtomic(client, { userId, amount, type, referenceId, description }) {
  // Amount can be positive (credit) or negative (debit)
  const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  if (wRes.rows.length === 0) throw new Error('WALLET_NOT_FOUND');

  const currentBal = parseFloat(wRes.rows[0].balance);
  const delta = parseFloat(amount);
  const newBal = parseFloat((currentBal + delta).toFixed(2));

  if (newBal < 0) {
    throw new Error('INSUFFICIENT_FUNDS');
  }

  await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBal, userId]);

  await client.query(
    `INSERT INTO wallet_transactions (user_id, type, amount, balance_before, balance_after, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, type, Math.abs(delta), currentBal, newBal, referenceId, description]
  );

  return newBal.toFixed(2);
}

// Calculate 20% house rake and net prize pool
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
  // Deterministic seedable pseudo-random generation for stable reproducible cartelas
  function pseudoRandom(s) {
    let t = s += 0x6D2B79F5;
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

// Shuffle 1..75 using Fisher-Yates
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
  if (!Array.isArray(cartelaIds) || cartelaIds.length === 0) {
    throw new Error('NO_CARTELAS_SELECTED');
  }
  if (cartelaIds.length > CONFIG.MAX_CARTELAS) {
    throw new Error(`EXCEEDS_MAX_CARTELAS_${CONFIG.MAX_CARTELAS}`);
  }

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Verify Room State
    const rRes = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
    if (rRes.rows.length === 0) throw new Error('ROOM_NOT_FOUND');
    const room = rRes.rows[0];
    if (room.status !== 'WAITING') throw new Error('ROOM_ALREADY_STARTED');

    // 2. Check user's current purchases in this room
    const existingPurchases = await client.query(
      'SELECT cartela_id FROM room_cartelas WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (existingPurchases.rows.length + cartelaIds.length > CONFIG.MAX_CARTELAS) {
      throw new Error('LIMIT_EXCEEDED');
    }

    // 3. Check wallet balance
    const totalCost = (CONFIG.GAME_STAKE * cartelaIds.length).toFixed(2);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) throw new Error('WALLET_NOT_FOUND');
    if (parseFloat(wRes.rows[0].balance) < parseFloat(totalCost)) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    // 4. Reserve Cartelas with UNIQUE protection
    for (const cId of cartelaIds) {
      try {
        await client.query(
          'INSERT INTO room_cartelas (room_id, cartela_id, user_id) VALUES ($1, $2, $3)',
          [roomId, cId, userId]
        );
      } catch (err) {
        if (err.code === '23505') {
          throw new Error(`CARTELA_${cId}_ALREADY_TAKEN`);
        }
        throw err;
      }
    }

    // 5. Ensure room player membership
    await client.query(
      'INSERT INTO room_players (room_id, user_id) VALUES ($1, $2) ON CONFLICT (room_id, user_id) DO NOTHING',
      [roomId, userId]
    );

    // 6. Debit authoritative wallet
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

// Transition WAITING -> STARTING -> PLAYING
async function tryAutoStartRoom(roomId) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query("SELECT * FROM rooms WHERE id = $1 FOR UPDATE", [roomId]);
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

    // If room is full or manually ready (threshold: at least 2 cartelas for game mechanics)
    if (cartelaCount >= 2) {
      const totalPot = (cartelaCount * CONFIG.GAME_STAKE).toFixed(2);
      const { houseFee, prizePool } = calculatePrizeDistribution(totalPot);
      const { sequence, hash } = generateDrawSequence();

      await client.query(
        "UPDATE rooms SET status = 'PLAYING', updated_at = NOW() WHERE id = $1",
        [roomId]
      );

      const nextCallAt = new Date(Date.now() + CONFIG.CALL_INTERVAL_SECONDS * 1000);

      await client.query(
        `INSERT INTO games (room_id, draw_order, draw_hash, called_numbers, current_index, next_call_at, status, total_pot, house_fee, prize_pool, started_at)
         VALUES ($1, $2, $3, '[]'::jsonb, 0, $4, 'PLAYING', $5, $6, $7, NOW())
         ON CONFLICT (room_id) DO NOTHING`,
        [roomId, JSON.stringify(sequence), hash, nextCallAt, totalPot, houseFee, prizePool]
      );

      // Create next waiting room if needed
      await ensureDefaultWaitingRoom();
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to auto-start room:', err);
  } finally {
    client.release();
  }
}

// ============================================================================
// 7. SERVERLESS GAME ENGINE & PROBABILISTIC TICK DRIVER
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

    // Only progress if target timestamp reached
    if (now >= nextCall) {
      const drawOrder = typeof game.draw_order === 'string' ? JSON.parse(game.draw_order) : game.draw_order;
      let called = typeof game.called_numbers === 'string' ? JSON.parse(game.called_numbers) : game.called_numbers;

      if (game.current_index < drawOrder.length) {
        const nextNum = drawOrder[game.current_index];
        called.push(nextNum);
        const newIndex = game.current_index + 1;
        const newNextCallAt = new Date(Date.now() + CONFIG.CALL_INTERVAL_SECONDS * 1000);

        await client.query(
          `UPDATE games 
           SET called_numbers = $1, current_index = $2, next_call_at = $3
           WHERE id = $4`,
          [JSON.stringify(called), newIndex, newNextCallAt, game.id]
        );

        await client.query(
          `INSERT INTO game_events (game_id, event_type, payload) VALUES ($1, 'NUMBER_CALLED', $2)`,
          [game.id, JSON.stringify({ number: nextNum, index: newIndex })]
        );
      } else {
        // Draw pool exhausted without winner
        await client.query("UPDATE games SET status = 'FINISHED', finished_at = NOW() WHERE id = $1", [game.id]);
        await client.query("UPDATE rooms SET status = 'FINISHED', updated_at = NOW() WHERE id = $2", [roomId]);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Game tick error:', err);
  } finally {
    client.release();
  }
}

// ============================================================================
// 8. BINGO VALIDATION ENGINE (LINE & CORNERS)
// ============================================================================
function verifyBingoPattern(matrix, calledSet) {
  // matrix: 5x5 array
  // returns { won: boolean, pattern: string, winningCells: [[r, c], ...] }

  // 1. Check Horizontal Rows
  for (let r = 0; r < 5; r++) {
    let rowMatch = true;
    const cells = [];
    for (let c = 0; c < 5; c++) {
      const val = matrix[r][c];
      if (val === 0 || calledSet.has(val)) {
        cells.push([r, c]);
      } else {
        rowMatch = false;
        break;
      }
    }
    if (rowMatch) return { won: true, pattern: `ROW_${r + 1}`, winningCells: cells };
  }

  // 2. Check Vertical Columns
  for (let c = 0; c < 5; c++) {
    let colMatch = true;
    const cells = [];
    for (let r = 0; r < 5; r++) {
      const val = matrix[r][c];
      if (val === 0 || calledSet.has(val)) {
        cells.push([r, c]);
      } else {
        colMatch = false;
        break;
      }
    }
    if (colMatch) return { won: true, pattern: `COLUMN_${c + 1}`, winningCells: cells };
  }

  // 3. Diagonal Top-Left to Bottom-Right
  let diag1Match = true;
  const diag1Cells = [];
  for (let i = 0; i < 5; i++) {
    const val = matrix[i][i];
    if (val === 0 || calledSet.has(val)) {
      diag1Cells.push([i, i]);
    } else {
      diag1Match = false;
      break;
    }
  }
  if (diag1Match) return { won: true, pattern: 'DIAGONAL_MAIN', winningCells: diag1Cells };

  // 4. Diagonal Top-Right to Bottom-Left
  let diag2Match = true;
  const diag2Cells = [];
  for (let i = 0; i < 5; i++) {
    const val = matrix[i][4 - i];
    if (val === 0 || calledSet.has(val)) {
      diag2Cells.push([i, 4 - i]);
    } else {
      diag2Match = false;
      break;
    }
  }
  if (diag2Match) return { won: true, pattern: 'DIAGONAL_ANTI', winningCells: diag2Cells };

  // 5. Four Corners Pattern
  const corners = [
    [0, 0],
    [0, 4],
    [4, 0],
    [4, 4],
  ];
  const cornersMatch = corners.every(([r, c]) => {
    const val = matrix[r][c];
    return val === 0 || calledSet.has(val);
  });
  if (cornersMatch) return { won: true, pattern: 'FOUR_CORNERS', winningCells: corners };

  return { won: false, pattern: null, winningCells: [] };
}

async function claimBingoAtomic(userId, roomId, cartelaId) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch game and check status
    const gRes = await client.query(
      "SELECT * FROM games WHERE room_id = $1 AND status = 'PLAYING' FOR UPDATE",
      [roomId]
    );
    if (gRes.rows.length === 0) throw new Error('GAME_NOT_ACTIVE');
    const game = gRes.rows[0];

    // 2. Verify user owns cartela in this room
    const rcRes = await client.query(
      'SELECT * FROM room_cartelas WHERE room_id = $1 AND cartela_id = $2 AND user_id = $3',
      [roomId, cartelaId, userId]
    );
    if (rcRes.rows.length === 0) throw new Error('CARTELA_NOT_OWNED');

    // 3. Fetch cartela matrix
    const cRes = await client.query('SELECT * FROM cartelas WHERE id = $1', [cartelaId]);
    if (cRes.rows.length === 0) throw new Error('CARTELA_NOT_FOUND');
    const cartela = cRes.rows[0];
    const matrix = typeof cartela.matrix === 'string' ? JSON.parse(cartela.matrix) : cartela.matrix;

    // 4. Validate Bingo pattern against called numbers
    const calledNumbers = typeof game.called_numbers === 'string' ? JSON.parse(game.called_numbers) : game.called_numbers;
    const calledSet = new Set(calledNumbers);
    const check = verifyBingoPattern(matrix, calledSet);

    if (!check.won) {
      throw new Error('INVALID_BINGO_CLAIM');
    }

    // 5. Atomic winner finalization
    const prizeAmount = parseFloat(game.prize_pool).toFixed(2);

    // Register Winner
    await client.query(
      `INSERT INTO game_winners (game_id, user_id, cartela_id, prize_amount, pattern_matched)
       VALUES ($1, $2, $3, $4, $5)`,
      [game.id, userId, cartelaId, prizeAmount, check.pattern]
    );

    // Credit Winner Authoritative Wallet
    const updatedBalance = await modifyWalletAtomic(client, {
      userId,
      amount: parseFloat(prizeAmount),
      type: 'GAME_PRIZE',
      referenceId: `GAME_${game.id}_WIN_${cartelaId}`,
      description: `Bingo Prize for Room #${roomId}, Cartela #${cartela.cartela_number}`,
    });

    // Mark Game & Room as FINISHED
    await client.query(
      "UPDATE games SET status = 'FINISHED', finished_at = NOW() WHERE id = $1",
      [game.id]
    );
    await client.query(
      "UPDATE rooms SET status = 'FINISHED', updated_at = NOW() WHERE id = $1",
      [roomId]
    );

    await client.query('COMMIT');

    // Dispatch Telegram Bot alert
    const uRes = await query('SELECT telegram_id, display_name FROM users WHERE id = $1', [userId]);
    if (uRes.rows.length > 0) {
      const winner = uRes.rows[0];
      sendTelegramMessage(
        winner.telegram_id,
        `🎉 *BINGO WINNER!*\n\nCongratulations, ${winner.display_name}!\nYou won Cartela *#${cartela.cartela_number}* in Room *#${roomId}*!\n\nPrize Credited: *${prizeAmount} BIRR*\nNew Balance: *${updatedBalance} BIRR*`
      );
    }

    return {
      success: true,
      pattern: check.pattern,
      prizeAmount,
      updatedBalance,
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
// 9. FINANCIAL ACCOUNTING (DEPOSITS & WITHDRAWALS)
// ============================================================================
async function createDepositAtomic(userId, amount, paymentMethod, transactionId) {
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) throw new Error('INVALID_AMOUNT');
  if (!transactionId || transactionId.trim().length === 0) throw new Error('TRANSACTION_ID_REQUIRED');

  const res = await query(
    `INSERT INTO deposits (user_id, amount, payment_method, transaction_id, status)
     VALUES ($1, $2, $3, $4, 'PENDING') RETURNING *`,
    [userId, amt.toFixed(2), paymentMethod, transactionId.trim()]
  );
  const dep = res.rows[0];

  // Notify Super Admin on Telegram
  const uRes = await query('SELECT telegram_id, telegram_username, display_name FROM users WHERE id = $1', [userId]);
  const user = uRes.rows[0];
  if (CONFIG.ADMIN_TELEGRAM_ID) {
    sendTelegramMessage(
      CONFIG.ADMIN_TELEGRAM_ID,
      `🔔 *NEW DEPOSIT REQUEST*\n\n` +
      `User: ${user.display_name} (@${user.telegram_username || 'none'})\n` +
      `Telegram ID: \`${user.telegram_id}\`\n` +
      `Amount: *${amt.toFixed(2)} BIRR*\n` +
      `Method: *${paymentMethod}*\n` +
      `Tx ID: \`${transactionId}\`\n\n` +
      `Approve via API or Admin Panel.`
    );
  }
  return dep;
}

async function approveDepositAtomic(depositId, adminNotes = 'Approved by Admin') {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const dRes = await client.query('SELECT * FROM deposits WHERE id = $1 FOR UPDATE', [depositId]);
    if (dRes.rows.length === 0) throw new Error('DEPOSIT_NOT_FOUND');
    const deposit = dRes.rows[0];
    if (deposit.status !== 'PENDING') throw new Error(`DEPOSIT_ALREADY_${deposit.status}`);

    await client.query(
      "UPDATE deposits SET status = 'APPROVED', admin_notes = $1, updated_at = NOW() WHERE id = $2",
      [adminNotes, depositId]
    );

    const newBal = await modifyWalletAtomic(client, {
      userId: deposit.user_id,
      amount: parseFloat(deposit.amount),
      type: 'DEPOSIT',
      referenceId: `DEP_${deposit.id}`,
      description: `Deposit via ${deposit.payment_method} (Tx:${deposit.transaction_id})`,
    });

    await client.query('COMMIT');

    // Notify User
    const uRes = await query('SELECT telegram_id FROM users WHERE id = $1', [deposit.user_id]);
    if (uRes.rows.length > 0) {
      sendTelegramMessage(
        uRes.rows[0].telegram_id,
        `✅ *Deposit Approved!*\n\nYour deposit of *${deposit.amount} BIRR* has been credited.\nNew Available Balance: *${newBal} BIRR*`
      );
    }

    return { success: true, newBalance: newBal };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function createWithdrawalAtomic(userId, amount, paymentMethod, accountNumber, accountHolder) {
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < CONFIG.MIN_WITHDRAWAL) {
    throw new Error(`MINIMUM_WITHDRAWAL_${CONFIG.MIN_WITHDRAWAL}_BIRR`);
  }

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) throw new Error('WALLET_NOT_FOUND');
    const currentBal = parseFloat(wRes.rows[0].balance);

    if (currentBal - amt < CONFIG.MIN_REMAINING_BALANCE) {
      throw new Error(`MUST_RETAIN_${CONFIG.MIN_REMAINING_BALANCE}_BIRR_FOR_GAMES`);
    }

    // Debit authoritative balance immediately into pending hold
    const newBal = await modifyWalletAtomic(client, {
      userId,
      amount: -amt,
      type: 'WITHDRAWAL',
      referenceId: `PENDING_WD_${Date.now()}`,
      description: `Withdrawal request to ${paymentMethod} (${accountNumber})`,
    });

    const insRes = await client.query(
      `INSERT INTO withdrawals (user_id, amount, payment_method, account_number, account_holder, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING') RETURNING *`,
      [userId, amt.toFixed(2), paymentMethod, accountNumber, accountHolder]
    );
    const wd = insRes.rows[0];

    await client.query('COMMIT');

    // Notify Admin
    if (CONFIG.ADMIN_TELEGRAM_ID) {
      sendTelegramMessage(
        CONFIG.ADMIN_TELEGRAM_ID,
        `💸 *NEW WITHDRAWAL REQUEST*\n\n` +
        `User ID: \`${userId}\`\n` +
        `Amount: *${amt.toFixed(2)} BIRR*\n` +
        `Method: *${paymentMethod}*\n` +
        `Account: \`${accountNumber}\` (${accountHolder})\n\n` +
        `Action needed in Admin panel.`
      );
    }

    return { success: true, withdrawal: wd, newBalance: newBal };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// 10. TELEGRAM BOT ENGINE & WEBHOOK DISPATCHER
// ============================================================================
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !chatId) return;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
  };
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
    req.on('error', (e) => {
      console.error('Telegram API error:', e);
      resolve(null);
    });
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

  // Track / Register User
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
    const welcome =
      `🎉 *Welcome to Shisho Bingo, ${user.display_name}!* 🇪🇹\n\n` +
      `Experience Ethiopia's premier real-time multiplayer 5x5 Bingo.\n\n` +
      `• *Stake per Cartela:* 10 BIRR\n` +
      `• *Max Cartelas:* 2 per room\n` +
      `• *House Rake:* 20%\n\n` +
      `Tap *🎮 Play* below to launch the game!`;
    await sendTelegramMessage(chatId, welcome, defaultKeyboard);
    return;
  }

  if (text === '💰 Balance') {
    const bal = await getAuthoritativeWallet(user.id);
    const balMsg =
      `💰 *Authoritative Balance*\n\n` +
      `Available Balance: *${bal} BIRR*\n\n` +
      `_Synchronized live with your Mini App wallet._`;
    const inlineKb = {
      inline_keyboard: [
        [
          { text: 'Deposit Funds', callback_data: 'btn_deposit' },
          { text: 'Withdraw Funds', callback_data: 'btn_withdraw' },
        ],
      ],
    };
    await sendTelegramMessage(chatId, balMsg, inlineKb);
    return;
  }

  if (text === '💳 Deposit') {
    const depMsg =
      `💳 *Deposit Instructions*\n\n` +
      `Transfer funds via:\n` +
      `1. *Telebirr:* \`${CONFIG.TELEBIRR_ACCOUNT}\`\n` +
      `2. *CBE:* \`${CONFIG.CBE_ACCOUNT}\`\n\n` +
      `Once sent, launch the *🎮 Play* Mini App and navigate to *Wallet -> Deposit* to submit your Transaction Reference.`;
    await sendTelegramMessage(chatId, depMsg, defaultKeyboard);
    return;
  }

  if (text === '💸 Withdraw') {
    const bal = await getAuthoritativeWallet(user.id);
    const wdMsg =
      `💸 *Withdrawal System*\n\n` +
      `Current Balance: *${bal} BIRR*\n` +
      `• Minimum: *${CONFIG.MIN_WITHDRAWAL} BIRR*\n` +
      `• Balance to retain: *${CONFIG.MIN_REMAINING_BALANCE} BIRR*\n\n` +
      `Open *🎮 Play* -> *Wallet* -> *Withdraw* to request cashout.`;
    await sendTelegramMessage(chatId, wdMsg, defaultKeyboard);
    return;
  }

  if (text === '👤 Profile') {
    const bal = await getAuthoritativeWallet(user.id);
    const winsRes = await query('SELECT COUNT(*) FROM game_winners WHERE user_id = $1', [user.id]);
    const gamesRes = await query('SELECT COUNT(*) FROM room_players WHERE user_id = $1', [user.id]);
    const refRes = await query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [user.id]);

    const prof =
      `👤 *User Profile*\n\n` +
      `Name: *${user.display_name}*\n` +
      `Username: @${user.telegram_username || 'N/A'}\n` +
      `Telegram ID: \`${user.telegram_id}\`\n` +
      `Balance: *${bal} BIRR*\n\n` +
      `🎮 Games Played: *${gamesRes.rows[0].count}*\n` +
      `🏆 Bingo Wins: *${winsRes.rows[0].count}*\n` +
      `👥 Referrals: *${refRes.rows[0].count}*\n` +
      `Member Since: *${new Date(user.created_at).toLocaleDateString()}*`;
    await sendTelegramMessage(chatId, prof, defaultKeyboard);
    return;
  }

  if (text === '🎁 Invite') {
    const refLink = `https://t.me/${CONFIG.TELEGRAM_BOT_USERNAME}?start=ref_${user.referral_code}`;
    const invMsg =
      `🎁 *Invite & Earn*\n\n` +
      `Share your link with friends. Earn game bonuses when they participate!\n\n` +
      `Your Referral Link:\n\`${refLink}\``;
    await sendTelegramMessage(chatId, invMsg, defaultKeyboard);
    return;
  }

  if (text === '📜 History') {
    const txs = await query(
      'SELECT type, amount, balance_after, created_at FROM wallet_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 5',
      [user.id]
    );
    let histMsg = `📜 *Recent Wallet Ledger*\n\n`;
    if (txs.rows.length === 0) {
      histMsg += `No transactions recorded yet.`;
    } else {
      txs.rows.forEach((t) => {
        histMsg += `• *${t.type}*: ${t.amount} BIRR (Bal: ${t.balance_after})\n  _${new Date(t.created_at).toLocaleTimeString()}_\n`;
      });
    }
    await sendTelegramMessage(chatId, histMsg, defaultKeyboard);
    return;
  }

  if (text === '🆘 Support') {
    await sendTelegramMessage(
      chatId,
      `🆘 *Customer Support*\n\nContact our 24/7 dedicated support representative: @${CONFIG.SUPPORT_USERNAME}`,
      defaultKeyboard
    );
    return;
  }
}

// ============================================================================
// 11. REST API ROUTER & CONTROLLERS
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
  return null;
}

async function handleApiRequest(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;

  // 1. Health Endpoint
  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      await query('SELECT 1');
      return jsonResponse(res, 200, { success: true, database: 'connected', service: 'shisho-bingo' });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, database: 'disconnected', error: e.message });
    }
  }

  // 2. Telegram Webhook Endpoint
  if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await handleTelegramWebhook(payload);
        return jsonResponse(res, 200, { ok: true });
      } catch (err) {
        console.error('Webhook processing error:', err);
        return jsonResponse(res, 200, { ok: false, error: err.message });
      }
    });
    return;
  }

  // Handle pre-flight CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // Authentication Required for all core user endpoints
  const authUser = await authenticateRequest(req);

  // 3. User & Authoritative Wallet Endpoint
  if (req.method === 'GET' && pathname === '/api/wallet') {
    if (!authUser) {
      return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED', message: 'Valid Telegram initData required' });
    }
    try {
      const balance = await getAuthoritativeWallet(authUser.id);
      return jsonResponse(res, 200, {
        success: true,
        user: {
          id: authUser.id,
          telegram_id: authUser.telegram_id,
          display_name: authUser.display_name,
          username: authUser.telegram_username,
        },
        balance: balance,
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'WALLET_READ_ERROR', message: e.message });
    }
  }

  // 4. Room List Endpoint
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

  // 5. Cartelas Catalog Endpoint
  if (req.method === 'GET' && pathname === '/api/cartelas') {
    const roomId = parsedUrl.query.roomId;
    try {
      const allCartelas = await query('SELECT id, cartela_number, matrix FROM cartelas ORDER BY cartela_number ASC');
      let takenIds = [];
      let myIds = [];

      if (roomId) {
        const takenRes = await query('SELECT cartela_id, user_id FROM room_cartelas WHERE room_id = $1', [roomId]);
        takenIds = takenRes.rows.map((r) => r.cartela_id);
        if (authUser) {
          myIds = takenRes.rows.filter((r) => r.user_id === authUser.id).map((r) => r.cartela_id);
        }
      }

      return jsonResponse(res, 200, {
        success: true,
        cartelas: allCartelas.rows,
        takenCartelaIds: takenIds,
        myCartelaIds: myIds,
      });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'DATABASE_ERROR', message: e.message });
    }
  }

  // 6. Cartela Purchase Endpoint
  if (req.method === 'POST' && pathname === '/api/cartela/purchase') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { roomId, cartelaIds } = JSON.parse(body);
        const result = await purchaseCartelasAtomic(authUser.id, roomId, cartelaIds);
        // Attempt trigger auto-start if capacity/threshold reached
        await tryAutoStartRoom(roomId);
        return jsonResponse(res, 200, result);
      } catch (e) {
        return jsonResponse(res, 409, { success: false, error: 'PURCHASE_FAILED', message: e.message });
      }
    });
    return;
  }

  // 7. Live Game State Endpoint (Drives the Serverless Tick Engine)
  if (req.method === 'GET' && pathname === '/api/game/state') {
    const roomId = parsedUrl.query.roomId;
    if (!roomId) return jsonResponse(res, 400, { success: false, error: 'ROOM_ID_REQUIRED' });

    try {
      // Advance tick if ready
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
        `SELECT gw.*, u.display_name, c.cartela_number 
         FROM game_winners gw 
         JOIN users u ON u.id = gw.user_id 
         JOIN cartelas c ON c.id = gw.cartela_id 
         WHERE gw.game_id = $1`,
        [game.id]
      );

      return jsonResponse(res, 200, {
        success: true,
        gameState: {
          id: game.id,
          roomId: game.room_id,
          status: game.status,
          calledNumbers: typeof game.called_numbers === 'string' ? JSON.parse(game.called_numbers) : game.called_numbers,
          currentNumber: game.called_numbers?.length > 0 ? game.called_numbers[game.called_numbers.length - 1] : null,
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

  // 8. Bingo Claim Endpoint
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
        return jsonResponse(res, 400, { success: false, error: 'BINGO_VERIFICATION_FAILED', message: e.message });
      }
    });
    return;
  }

  // 9. Deposit Creation Endpoint
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
        return jsonResponse(res, 400, { success: false, error: 'DEPOSIT_ERROR', message: e.message });
      }
    });
    return;
  }

  // 10. Withdrawal Creation Endpoint
  if (req.method === 'POST' && pathname === '/api/withdraw') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { amount, paymentMethod, accountNumber, accountHolder } = JSON.parse(body);
        const result = await createWithdrawalAtomic(authUser.id, amount, paymentMethod, accountNumber, accountHolder);
        return jsonResponse(res, 200, result);
      } catch (e) {
        return jsonResponse(res, 400, { success: false, error: 'WITHDRAWAL_ERROR', message: e.message });
      }
    });
    return;
  }

  // 11. Transaction History Endpoint
  if (req.method === 'GET' && pathname === '/api/history') {
    if (!authUser) return jsonResponse(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    try {
      const txs = await query(
        'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
        [authUser.id]
      );
      return jsonResponse(res, 200, { success: true, transactions: txs.rows });
    } catch (e) {
      return jsonResponse(res, 500, { success: false, error: 'DATABASE_ERROR', message: e.message });
    }
  }

  // 12. Admin Action Endpoints (Protected by Super Admin Telegram ID check)
  if (pathname.startsWith('/api/admin/')) {
    if (!authUser || String(authUser.telegram_id) !== CONFIG.ADMIN_TELEGRAM_ID) {
      return jsonResponse(res, 403, { success: false, error: 'UNAUTHORIZED_ADMIN' });
    }

    if (req.method === 'POST' && pathname === '/api/admin/deposits/approve') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { depositId, notes } = JSON.parse(body);
          const result = await approveDepositAtomic(depositId, notes);
          return jsonResponse(res, 200, result);
        } catch (e) {
          return jsonResponse(res, 400, { success: false, error: e.message });
        }
      });
      return;
    }
  }

  // Fallback 404
  return jsonResponse(res, 404, { success: false, error: 'ENDPOINT_NOT_FOUND' });
}

// ============================================================================
// 12. EMBEDDED MINI APP (HTML, CSS, JAVASCRIPT)
// ============================================================================
function getMiniAppHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Shisho Bingo</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      --bg-dark: #0a0612;
      --bg-card: rgba(26, 16, 43, 0.7);
      --purple-accent: #7928ca;
      --gold-primary: #ffb800;
      --gold-glow: rgba(255, 184, 0, 0.35);
      --text-main: #f3f0f7;
      --text-muted: #9f96b0;
      --border-glass: rgba(255, 255, 255, 0.08);
      --success: #00e676;
      --danger: #ff1744;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background-color: var(--bg-dark); color: var(--text-main); min-height: 100vh; padding-bottom: 80px; overflow-x: hidden; }
    
    /* Header & Balance Card */
    .header { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); background: rgba(10, 6, 18, 0.85); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 100; }
    .brand { font-size: 20px; font-weight: 800; color: var(--gold-primary); text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
    .wallet-pill { background: linear-gradient(135deg, rgba(121, 40, 202, 0.4), rgba(255, 184, 0, 0.15)); border: 1px solid var(--gold-primary); padding: 6px 14px; border-radius: 20px; font-weight: 700; color: var(--gold-primary); display: flex; align-items: center; gap: 6px; box-shadow: 0 0 12px var(--gold-glow); }
    
    /* Navigation */
    .tab-content { display: none; padding: 16px; animation: fadeIn 0.25s ease-out; }
    .tab-content.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    
    .nav-bar { position: fixed; bottom: 0; left: 0; right: 0; height: 68px; background: rgba(15, 9, 28, 0.95); backdrop-filter: blur(16px); border-top: 1px solid var(--border-glass); display: flex; justify-content: space-around; align-items: center; z-index: 100; }
    .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text-muted); font-size: 11px; font-weight: 600; text-decoration: none; cursor: pointer; flex: 1; }
    .nav-item.active { color: var(--gold-primary); }
    .nav-item svg { width: 22px; height: 22px; fill: currentColor; }

    /* Common Card Styling */
    .glass-card { background: var(--bg-card); border: 1px solid var(--border-glass); border-radius: 16px; padding: 18px; margin-bottom: 16px; backdrop-filter: blur(8px); }
    .btn { width: 100%; padding: 14px; border: none; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: transform 0.1s, opacity 0.2s; }
    .btn-gold { background: linear-gradient(135deg, #ffb800, #ff8800); color: #000; box-shadow: 0 4px 16px var(--gold-glow); }
    .btn-purple { background: linear-gradient(135deg, #7928ca, #4a00e0); color: #fff; }
    .btn:active { transform: scale(0.98); opacity: 0.9; }

    /* Rooms Grid */
    .room-card { display: flex; justify-content: space-between; align-items: center; border-left: 4px solid var(--gold-primary); }
    .room-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .room-meta { font-size: 13px; color: var(--text-muted); }

    /* Cartela Matrix UI */
    .cartela-picker-container { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px; }
    .cartela-item { border: 1px solid var(--border-glass); border-radius: 12px; padding: 12px; text-align: center; cursor: pointer; background: rgba(255, 255, 255, 0.03); }
    .cartela-item.selected { border-color: var(--gold-primary); background: rgba(255, 184, 0, 0.15); box-shadow: 0 0 10px var(--gold-glow); }
    .cartela-item.taken { opacity: 0.3; cursor: not-allowed; }

    .bingo-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin: 16px 0; }
    .bingo-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-glass); border-radius: 8px; font-weight: 700; font-size: 14px; }
    .bingo-cell.header { background: transparent; border: none; color: var(--gold-primary); font-size: 16px; font-weight: 900; }
    .bingo-cell.marked { background: var(--purple-accent); color: #fff; border-color: var(--gold-primary); }
    .bingo-cell.free { background: var(--gold-primary); color: #000; font-size: 11px; }

    /* Number Caller Display */
    .caller-board { text-align: center; padding: 20px; border: 2px solid var(--purple-accent); background: radial-gradient(circle, rgba(121,40,202,0.3) 0%, rgba(10,6,18,0) 70%); border-radius: 20px; margin-bottom: 16px; }
    .current-number { font-size: 64px; font-weight: 900; color: var(--gold-primary); text-shadow: 0 0 20px var(--gold-glow); line-height: 1; margin: 10px 0; }
    .called-ribbon { display: flex; gap: 8px; overflow-x: auto; padding: 10px 0; scrollbar-width: none; }
    .ribbon-pill { min-width: 36px; height: 36px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--gold-primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; color: #fff; }

    /* Forms */
    .input-field { width: 100%; padding: 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-glass); color: #fff; font-size: 15px; margin-bottom: 12px; }
    .input-field:focus { outline: none; border-color: var(--gold-primary); }
  </style>
</head>
<body>

  <!-- Authoritative Header -->
  <div class="header">
    <div class="brand">
      <span>SHISHO</span>
    </div>
    <div class="wallet-pill" id="wallet-badge" onclick="switchTab('wallet')">
      <span id="header-balance">Loading...</span>
    </div>
  </div>

  <!-- TAB 1: PLAY / ROOMS -->
  <div id="tab-play" class="tab-content active">
    <div class="glass-card">
      <h3 style="color: var(--gold-primary); margin-bottom: 8px;">Multiplayer Bingo 🇪🇹</h3>
      <p style="color: var(--text-muted); font-size: 14px;">Select an active waiting room, pick your cartelas, and compete live.</p>
    </div>

    <div id="rooms-container">
      <!-- Injected Rooms -->
    </div>
  </div>

  <!-- TAB 2: LIVE GAME SCREEN -->
  <div id="tab-game" class="tab-content">
    <div class="caller-board">
      <div style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 1px;">Current Call</div>
      <div class="current-number" id="display-call">-</div>
      <div style="font-size: 13px; color: var(--gold-primary);" id="display-timer">Next Call in 5s</div>
      <div class="called-ribbon" id="called-history"></div>
    </div>

    <div id="game-cartelas-area"></div>

    <button class="btn btn-gold" id="btn-claim-bingo" onclick="submitBingoClaim()" style="margin-top: 12px;">🏆 CLAIM BINGO!</button>
  </div>

  <!-- TAB 3: WALLET -->
  <div id="tab-wallet" class="tab-content">
    <div class="glass-card" style="text-align: center; border-color: var(--gold-primary);">
      <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 6px;">Available Balance</div>
      <div style="font-size: 36px; font-weight: 900; color: var(--gold-primary);" id="wallet-page-balance">Loading...</div>
      <button class="btn btn-purple" style="margin-top: 12px; padding: 8px 16px; width: auto;" onclick="refreshWallet()">🔄 Refresh Balance</button>
    </div>

    <!-- Deposit Box -->
    <div class="glass-card">
      <h3 style="color: var(--gold-primary); margin-bottom: 12px;">Deposit Funds</h3>
      <select class="input-field" id="dep-method">
        <option value="TELEBIRR">Telebirr (0911002233)</option>
        <option value="CBE">Commercial Bank of Ethiopia (1000192837465)</option>
      </select>
      <input type="number" class="input-field" id="dep-amount" placeholder="Amount in BIRR">
      <input type="text" class="input-field" id="dep-txid" placeholder="Transaction Reference ID">
      <button class="btn btn-gold" onclick="submitDeposit()">Submit Deposit</button>
    </div>

    <!-- Withdraw Box -->
    <div class="glass-card">
      <h3 style="color: var(--gold-primary); margin-bottom: 12px;">Withdraw Funds</h3>
      <select class="input-field" id="wd-method">
        <option value="TELEBIRR">Telebirr</option>
        <option value="CBE">CBE Account</option>
      </select>
      <input type="number" class="input-field" id="wd-amount" placeholder="Amount (Min 50 BIRR)">
      <input type="text" class="input-field" id="wd-acc" placeholder="Account / Phone Number">
      <input type="text" class="input-field" id="wd-name" placeholder="Full Account Name">
      <button class="btn btn-purple" onclick="submitWithdrawal()">Request Cashout</button>
    </div>
  </div>

  <!-- TAB 4: HISTORY -->
  <div id="tab-history" class="tab-content">
    <div class="glass-card">
      <h3 style="color: var(--gold-primary); margin-bottom: 12px;">Audit Ledger</h3>
      <div id="history-list" style="font-size: 13px;">Loading transactions...</div>
    </div>
  </div>

  <!-- Bottom App Navigation -->
  <div class="nav-bar">
    <div class="nav-item active" id="nav-play" onclick="switchTab('play')">
      <svg viewBox="0 0 24 24"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
      Play
    </div>
    <div class="nav-item" id="nav-wallet" onclick="switchTab('wallet')">
      <svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
      Wallet
    </div>
    <div class="nav-item" id="nav-history" onclick="switchTab('history')">
      <svg viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
      History
    </div>
  </div>

  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.expand();
      tg.ready();
    }

    const API_HEADERS = {
      'Content-Type': 'application/json',
      'Authorization': 'tma ' + (tg?.initData || '')
    };

    let activeRoomId = null;
    let selectedCartelaIds = [];
    let gamePollInterval = null;
    let activeGameCartelas = [];

    function switchTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      const navEl = document.getElementById('nav-' + tab);
      if (navEl) navEl.classList.add('active');

      if (tab === 'wallet') refreshWallet();
      if (tab === 'history') loadHistory();
      if (tab === 'play' && !activeRoomId) loadRooms();
    }

    async function refreshWallet() {
      try {
        const res = await fetch('/api/wallet', { headers: API_HEADERS });
        const data = await res.json();
        if (data.success) {
          const balText = data.balance + ' BIRR';
          document.getElementById('header-balance').innerText = balText;
          document.getElementById('wallet-page-balance').innerText = balText;
        } else {
          document.getElementById('header-balance').innerText = 'Wallet unavailable';
          document.getElementById('wallet-page-balance').innerText = 'Wallet unavailable';
        }
      } catch (e) {
        document.getElementById('header-balance').innerText = 'Offline';
      }
    }

    async function loadRooms() {
      try {
        const res = await fetch('/api/rooms', { headers: API_HEADERS });
        const data = await res.json();
        const container = document.getElementById('rooms-container');
        container.innerHTML = '';

        if (!data.rooms || data.rooms.length === 0) {
          container.innerHTML = '<div class="glass-card">No waiting rooms available. Refresh in a moment.</div>';
          return;
        }

        data.rooms.forEach(r => {
          const pot = (r.selected_cartelas * r.stake).toFixed(2);
          const div = document.createElement('div');
          div.className = 'glass-card room-card';
          div.innerHTML = \`
            <div>
              <div class="room-title">ROOM #\${r.room_number}</div>
              <div class="room-meta">Stake: \${r.stake} BIRR | Players: \${r.current_players}/\${r.capacity}</div>
              <div class="room-meta">Total Pot: \${pot} BIRR</div>
            </div>
            <button class="btn btn-gold" style="width: auto; padding: 10px 20px;" onclick="enterRoom(\${r.id})">ENTER</button>
          \`;
          container.appendChild(div);
        });
      } catch(e) {
        console.error(e);
      }
    }

    async function enterRoom(roomId) {
      activeRoomId = roomId;
      selectedCartelaIds = [];
      const res = await fetch('/api/cartelas?roomId=' + roomId, { headers: API_HEADERS });
      const data = await res.json();
      
      const container = document.getElementById('rooms-container');
      container.innerHTML = \`
        <div class="glass-card">
          <h3>Select Cartelas (Max 2)</h3>
          <p style="color: var(--text-muted); font-size: 13px;">Cost: 10 BIRR per cartela</p>
          <div class="cartela-picker-container" id="cartela-selector-grid"></div>
          <button class="btn btn-gold" style="margin-top: 16px;" onclick="purchaseSelectedCartelas()">Confirm & Buy</button>
        </div>
      \`;

      const grid = document.getElementById('cartela-selector-grid');
      data.cartelas.slice(0, 20).forEach(c => {
        const isTaken = data.takenCartelaIds.includes(c.id);
        const isMine = data.myCartelaIds.includes(c.id);
        const item = document.createElement('div');
        item.className = 'cartela-item' + (isTaken ? ' taken' : '') + (isMine ? ' selected' : '');
        item.innerText = 'Cartela #' + c.cartela_number;
        if (!isTaken) {
          item.onclick = () => {
            if (selectedCartelaIds.includes(c.id)) {
              selectedCartelaIds = selectedCartelaIds.filter(id => id !== c.id);
              item.classList.remove('selected');
            } else {
              if (selectedCartelaIds.length >= 2) return alert('Max 2 cartelas allowed');
              selectedCartelaIds.push(c.id);
              item.classList.add('selected');
            }
          };
        }
        grid.appendChild(item);
      });
    }

    async function purchaseSelectedCartelas() {
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
          startLiveGameEngine();
        } else {
          alert('Purchase failed: ' + data.message);
        }
      } catch (e) {
        alert('Network error during purchase');
      }
    }

    function startLiveGameEngine() {
      switchTab('game');
      if (gamePollInterval) clearInterval(gamePollInterval);
      gamePollInterval = setInterval(pollGameState, 1800);
      pollGameState();
    }

    async function pollGameState() {
      if (!activeRoomId) return;
      try {
        const res = await fetch('/api/game/state?roomId=' + activeRoomId, { headers: API_HEADERS });
        const data = await res.json();
        if (!data.success) return;

        const gs = data.gameState;
        document.getElementById('display-call').innerText = gs.currentNumber || '-';
        document.getElementById('display-timer').innerText = gs.status === 'PLAYING' 
          ? 'Next call in: ' + gs.nextCallInSeconds + 's' 
          : 'Status: ' + gs.status;

        // Render ribbon
        const ribbon = document.getElementById('called-history');
        ribbon.innerHTML = '';
        (gs.calledNumbers || []).slice(-8).reverse().forEach(num => {
          const pill = document.createElement('div');
          pill.className = 'ribbon-pill';
          pill.innerText = num;
          ribbon.appendChild(pill);
        });

        if (gs.status === 'FINISHED' && gs.winners?.length > 0) {
          clearInterval(gamePollInterval);
          alert('GAME OVER! Winner: ' + gs.winners.map(w => w.display_name + ' (#' + w.cartela_number + ')').join(', '));
          await refreshWallet();
        }
      } catch (e) {
        console.error('Game poll failed:', e);
      }
    }

    async function submitBingoClaim() {
      if (!activeRoomId || selectedCartelaIds.length === 0) return;
      try {
        const res = await fetch('/api/game/bingo', {
          method: 'POST',
          headers: API_HEADERS,
          body: JSON.stringify({ roomId: activeRoomId, cartelaId: selectedCartelaIds[0] })
        });
        const data = await res.json();
        if (data.success) {
          alert('🎉 BINGO VERIFIED! Prize: ' + data.prizeAmount + ' BIRR');
          await refreshWallet();
        } else {
          alert('Bingo claim rejected: ' + data.message);
        }
      } catch (e) {
        alert('Error verifying bingo');
      }
    }

    async function submitDeposit() {
      const amount = document.getElementById('dep-amount').value;
      const paymentMethod = document.getElementById('dep-method').value;
      const transactionId = document.getElementById('dep-txid').value;

      const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ amount, paymentMethod, transactionId })
      });
      const data = await res.json();
      if (data.success) {
        alert('Deposit request submitted! Awaiting Admin verification.');
        document.getElementById('dep-amount').value = '';
        document.getElementById('dep-txid').value = '';
      } else {
        alert('Deposit error: ' + data.message);
      }
    }

    async function submitWithdrawal() {
      const amount = document.getElementById('wd-amount').value;
      const paymentMethod = document.getElementById('wd-method').value;
      const accountNumber = document.getElementById('wd-acc').value;
      const accountHolder = document.getElementById('wd-name').value;

      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ amount, paymentMethod, accountNumber, accountHolder })
      });
      const data = await res.json();
      if (data.success) {
        alert('Withdrawal queued successfully.');
        await refreshWallet();
      } else {
        alert('Withdrawal failed: ' + data.message);
      }
    }

    async function loadHistory() {
      const container = document.getElementById('history-list');
      try {
        const res = await fetch('/api/history', { headers: API_HEADERS });
        const data = await res.json();
        if (!data.transactions || data.transactions.length === 0) {
          container.innerHTML = 'No history records found.';
          return;
        }
        container.innerHTML = data.transactions.map(t => \`
          <div style="padding: 8px 0; border-bottom: 1px solid var(--border-glass);">
            <div style="display:flex; justify-content:space-between; font-weight:700;">
              <span>\${t.type}</span>
              <span style="color:var(--gold-primary);">\${t.amount} BIRR</span>
            </div>
            <div style="color:var(--text-muted); font-size:11px;">Bal after: \${t.balance_after} BIRR | \${new Date(t.created_at).toLocaleDateString()}</div>
          </div>
        \`).join('');
      } catch (e) {
        container.innerHTML = 'Failed to load history.';
      }
    }

    // Initialize application
    window.addEventListener('load', async () => {
      await refreshWallet();
      await loadRooms();
    });
  </script>
</body>
</html>`;
}

// ============================================================================
// 13. HTTP RUNTIME / VERCEL COMPATIBLE SERVERLESS HANDLER
// ============================================================================
async function appHandler(req, res) {
  // Ensure idempotent database initialization
  try {
    await initDatabase();
  } catch (err) {
    console.error('Database connection failed:', err);
  }

  const parsedUrl = url.parse(req.url, true);

  // Serve Embedded Mini App SPA
  if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(getMiniAppHTML());
  }

  // Route API Requests
  if (parsedUrl.pathname.startsWith('/api/')) {
    return handleApiRequest(req, res, parsedUrl);
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

// Export for Vercel Serverless Function engine
module.exports = appHandler;

// Standalone execution for local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(appHandler);
  server.listen(PORT, () => {
    console.log(`Shisho Bingo active on http://localhost:${PORT}`);
  });
}