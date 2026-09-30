/**
 * ============================================================================
 * 👑 SHISHO BINGO — TELEGRAM BOT MENU SYSTEM
 * Architecture: Single-File Telegram Bot Navigation & Routing Layer
 * Runtime: Node.js (Vanilla HTTP / HTTPS + node-postgres 'pg')
 * Languages: English (en) & Amharic (am)
 * ============================================================================
 */

const https = require('https');
const { Pool } = require('pg');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const CONFIG = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '',
  ADMIN_TELEGRAM_ID: String(process.env.ADMIN_TELEGRAM_ID || '').trim(),
  BASE_URL: (process.env.APP_BASE_URL || process.env.BASE_URL || '').replace(/\/$/, ''),
  CHANNEL_URL: process.env.CHANNEL_URL || 'https://t.me/ShishoBingoChannel',
  SUPPORT_USERNAME: (process.env.SUPPORT_USERNAME || 'ShishoSupport').replace('@', ''),
  STAKE_PRICE: parseFloat(process.env.GAME_STAKE || process.env.STAKE_PRICE || '10'),
  MIN_WITHDRAWAL: parseFloat(process.env.MIN_WITHDRAWAL || '50'),
  TELEBIRR_NUMBER: process.env.TELEBIRR_ACCOUNT || process.env.TELEBIRR_NUMBER || '0911002233 (Shisho Official)',
  CBE_ACCOUNT: process.env.CBE_ACCOUNT || '1000192837465 (Shisho Games)',
  DATABASE_URL: process.env.DATABASE_URL || '',
};

// ============================================================================
// 2. DATABASE CLIENT & USER PERSISTENCE
// ============================================================================
let pool;
function getDbPool() {
  if (!pool && CONFIG.DATABASE_URL) {
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

async function queryDb(text, params) {
  const p = getDbPool();
  if (!p) return { rows: [] };
  return p.query(text, params);
}

// User language in-memory cache with fallback to 'en'
const userLanguageCache = new Map();

async function getUserLanguage(telegramId) {
  if (userLanguageCache.has(telegramId)) {
    return userLanguageCache.get(telegramId);
  }
  try {
    const res = await queryDb('SELECT language FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
    if (res.rows.length > 0 && res.rows[0].language) {
      const lang = res.rows[0].language === 'am' ? 'am' : 'en';
      userLanguageCache.set(telegramId, lang);
      return lang;
    }
  } catch (err) {
    // If language column doesn't exist yet, gracefully fallback
  }
  userLanguageCache.set(telegramId, 'en');
  return 'en';
}

async function setUserLanguage(telegramId, lang) {
  const safeLang = lang === 'am' ? 'am' : 'en';
  userLanguageCache.set(telegramId, safeLang);
  try {
    await queryDb(
      `UPDATE users SET language = $1, updated_at = NOW() WHERE telegram_id = $2`,
      [safeLang, telegramId]
    );
  } catch (err) {
    // Column might not exist in old schema; cache handles runtime session
  }
}

async function getOrCreateUserData(tgUser, referredByCode = null) {
  const p = getDbPool();
  if (!p) {
    return {
      id: 0,
      telegram_id: tgUser.id,
      display_name: tgUser.first_name || 'Player',
      username: tgUser.username || 'unknown',
      balance: '0.00',
      reserved: '0.00',
      total: '0.00',
      games_played: 0,
      wins: 0,
      winnings: '0.00',
      referral_code: 'SHISHO' + tgUser.id,
      is_new: false,
    };
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const uRes = await client.query('SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE', [tgUser.id]);
    let user;
    let isNew = false;

    if (uRes.rows.length > 0) {
      user = uRes.rows[0];
      await client.query(
        `UPDATE users SET telegram_username = $1, first_name = $2, last_name = $3, display_name = $4, updated_at = NOW() WHERE id = $5`,
        [tgUser.username || '', tgUser.first_name || '', tgUser.last_name || '', tgUser.first_name || 'Player', user.id]
      );
    } else {
      isNew = true;
      let refId = null;
      if (referredByCode) {
        const rCheck = await client.query('SELECT id FROM users WHERE referral_code = $1 LIMIT 1', [referredByCode]);
        if (rCheck.rows.length > 0) refId = rCheck.rows[0].id;
      }
      const refCode = 'SH' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const insRes = await client.query(
        `INSERT INTO users (telegram_id, telegram_username, first_name, last_name, display_name, referral_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [tgUser.id, tgUser.username || '', tgUser.first_name || '', tgUser.last_name || '', tgUser.first_name || 'Player', refCode, refId]
      );
      user = insRes.rows[0];
      await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0.00) ON CONFLICT DO NOTHING', [user.id]);
    }

    // Authoritative Wallet
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id = $1', [user.id]);
    const balanceNum = wRes.rows.length > 0 ? parseFloat(wRes.rows[0].balance) : 0;

    // Active reserved stakes in WAITING or STARTING rooms
    const rRes = await client.query(
      `SELECT COALESCE(COUNT(rc.id), 0) * $2 AS reserved
       FROM room_cartelas rc
       JOIN rooms r ON r.id = rc.room_id
       WHERE rc.user_id = $1 AND (r.status = 'WAITING' OR r.status = 'STARTING')`,
      [user.id, CONFIG.STAKE_PRICE]
    );
    const reservedNum = rRes.rows.length > 0 ? parseFloat(rRes.rows[0].reserved || 0) : 0;
    const totalNum = balanceNum + reservedNum;

    // Gameplay Statistics
    const gpRes = await client.query('SELECT COUNT(DISTINCT room_id) AS total FROM room_players WHERE user_id = $1', [user.id]);
    const wCountRes = await client.query('SELECT COUNT(id) AS wins, COALESCE(SUM(prize_amount), 0) AS total_prize FROM game_winners WHERE user_id = $1', [user.id]);

    await client.query('COMMIT');

    return {
      id: user.id,
      telegram_id: user.telegram_id,
      display_name: user.display_name || user.first_name || 'Player',
      username: user.telegram_username || '',
      balance: balanceNum.toFixed(2),
      reserved: reservedNum.toFixed(2),
      total: totalNum.toFixed(2),
      games_played: parseInt(gpRes.rows[0]?.total || 0, 10),
      wins: parseInt(wCountRes.rows[0]?.wins || 0, 10),
      winnings: parseFloat(wCountRes.rows[0]?.total_prize || 0).toFixed(2),
      referral_code: user.referral_code,
      is_new: isNew,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error fetching user info:', err);
    return {
      id: 0,
      telegram_id: tgUser.id,
      display_name: tgUser.first_name || 'Player',
      username: tgUser.username || '',
      balance: '0.00',
      reserved: '0.00',
      total: '0.00',
      games_played: 0,
      wins: 0,
      winnings: '0.00',
      referral_code: 'SHISHO' + tgUser.id,
      is_new: false,
    };
  } finally {
    client.release();
  }
}

// ============================================================================
// 3. TRANSLATIONS (BOT_TRANSLATIONS)
// ============================================================================
const BOT_TRANSLATIONS = {
  en: {
    btn_play: '🎮 Play',
    btn_balance: '💰 Balance',
    btn_profile: '👤 Profile',
    btn_deposit: '💳 Deposit',
    btn_withdraw: '💸 Withdraw',
    btn_invite: '🔗 Invite',
    btn_support: '💬 Support',
    btn_language: '🌐 Language',
    btn_channel: '📢 Channel',
    btn_admin: '👑 Admin Dashboard',
    btn_main_menu: '⬅️ Main Menu',
    btn_cancel: '❌ Cancel',
    btn_open_game: '🎮 Open Game',
    btn_telebirr: '📱 Telebirr',
    btn_cbe: '🏦 CBE',
    btn_share_invite: '📤 Share Invite',
    btn_contact_support: '💬 Contact Support',
    btn_join_channel: '📢 Join Channel',
    btn_game_history: '📜 Game History',
    btn_settings: '⚙️ Settings',

    welcome_new: (name) =>
      `👑 *SHISHO BINGO*\n\nWelcome to *SHISHO BINGO*, ${name}! 🎉\n\nPlay Bingo in real time, join competitive rooms, and win instant cash prizes.\n\n💰 *Your balance:* *0.00 BIRR*\n\nChoose an option below to continue:`,
    welcome_back: (name, bal) =>
      `👑 *Welcome back, ${name}!* 🎉\n\n💰 *Available Balance:* *${bal} BIRR*\n\nChoose an option below to play or manage your wallet:`,

    play_title: `🎮 *PLAY BINGO*\n\nReady to play?\nJoin a live multiplayer Bingo room and start winning real rewards!`,
    balance_title: (avail, res, tot) =>
      `💰 *YOUR WALLET*\n\n• Available: *${avail} BIRR*\n• Reserved: *${res} BIRR*\n• Total: *${tot} BIRR*`,
    profile_title: (name, user, games, wins, winAmount, bal) =>
      `👤 *YOUR PROFILE*\n\n• *Name:* ${name}\n• *Username:* @${user || 'N/A'}\n• *Games Played:* ${games}\n• *Wins:* ${wins}\n• *Total Winnings:* ${winAmount} BIRR\n• *Current Balance:* ${bal} BIRR`,

    deposit_select: `💳 *DEPOSIT FUNDS*\n\nChoose your preferred payment method:`,
    deposit_telebirr: `📱 *TELEBIRR DEPOSIT*\n\nAccount: \`${CONFIG.TELEBIRR_NUMBER}\`\n\nEnter the amount in BIRR you wish to deposit:\n_(or tap Cancel below)_`,
    deposit_cbe: `🏦 *CBE DEPOSIT*\n\nAccount: \`${CONFIG.CBE_ACCOUNT}\`\n\nEnter the amount in BIRR you wish to deposit:\n_(or tap Cancel below)_`,

    withdraw_select: (bal, min) =>
      `💸 *WITHDRAW FUNDS*\n\nAvailable to cash out: *${bal} BIRR*\nMinimum withdrawal: *${min} BIRR*\n\nChoose your cashout method:`,
    withdraw_amount_prompt: (method) =>
      `💸 *${method} WITHDRAWAL*\n\nEnter the amount you want to withdraw:`,

    invite_title: (link) =>
      `🔗 *INVITE FRIENDS*\n\nInvite your friends to *SHISHO BINGO*!\n\nYour referral link:\n\`${link}\`\n\nShare this link to earn referral bonuses whenever your friends participate.`,

    support_title: `💬 *CUSTOMER SUPPORT*\n\nNeed assistance or have a transaction inquiry?\nOur support team is active 24/7.\n\nOfficial Representative: @${CONFIG.SUPPORT_USERNAME}`,
    channel_title: `📢 *OFFICIAL CHANNEL*\n\nJoin the official *SHISHO BINGO* channel for:\n\n• Game announcements & schedules\n• Promotions & giveaways\n• Platform updates & notices`,
    language_title: `🌐 *LANGUAGE / ቋንቋ*\n\nChoose your preferred language:`,
    language_set_en: `Language set to English. 🇬🇧`,
    language_set_am: `ቋንቋዎ ወደ አማርኛ ተቀይሯል። 🇪🇹`,

    admin_title: `👑 *ADMIN DASHBOARD*\n\nSuper Administrator Control Panel.\nChoose an action to manage:`,
    action_cancelled: `Action cancelled. Returned to main menu.`,
    invalid_input: `⚠️ Input not recognized. Please use the menu buttons below:`,
  },
  am: {
    btn_play: '🎮 ጨዋታ',
    btn_balance: '💰 ሂሳብ',
    btn_profile: '👤 መገለጫ',
    btn_deposit: '💳 ገንዘብ ያስገቡ',
    btn_withdraw: '💸 ገንዘብ ያውጡ',
    btn_invite: '🔗 ጋብዝ',
    btn_support: '💬 ድጋፍ',
    btn_language: '🌐 ቋንቋ',
    btn_channel: '📢 ቻናል',
    btn_admin: '👑 አስተዳዳሪ',
    btn_main_menu: '⬅️ ዋና ማውጫ',
    btn_cancel: '❌ ሰርዝ',
    btn_open_game: '🎮 ጨዋታውን ክፈት',
    btn_telebirr: '📱 ቴሌብር',
    btn_cbe: '🏦 ንግድ ባንክ (CBE)',
    btn_share_invite: '📤 መጋበዣ ላክ',
    btn_contact_support: '💬 ድጋፍ ሰጪ ያነጋግሩ',
    btn_join_channel: '📢 ቻናሉን ተቀላቀሉ',
    btn_game_history: '📜 የጨዋታ ታሪክ',
    btn_settings: '⚙️ ቅንብሮች',

    welcome_new: (name) =>
      `👑 *ሺሾ ቢንጎ (SHISHO BINGO)*\n\nእንኳን ወደ *ሺሾ ቢንጎ* በደህና መጡ, ${name}! 🎉\n\nየቢንጎ ጨዋታዎችን በቀጥታ ይጫወቱ፣ ክፍሎችን ይቀላቀሉ እና አጓጊ ሽልማቶችን ያሸንፉ።\n\n💰 *ቀሪ ሂሳብዎ:* *0.00 ብር*\n\nለመቀጠል ከታች ካሉት አማራጮች አንዱን ይምረጡ፡`,
    welcome_back: (name, bal) =>
      `👑 *እንኳን ደህና ተመለሱ, ${name}!* 🎉\n\n💰 *ያለዎት ቀሪ ሂሳብ:* *${bal} ብር*\n\nለመጫወት ወይም ዋሌትዎን ለማስተዳደር ከታች ይምረጡ፡`,

    play_title: `🎮 *ቢንጎ ይጫወቱ*\n\nለመጫወት ዝግጁ ኖት?\nየቀጥታ ባለብዙ-ተጫዋች የቢንጎ ክፍልን ይቀላቀሉ እና ማሸነፍ ይጀምሩ!`,
    balance_title: (avail, res, tot) =>
      `💰 *የእርስዎ ዋሌት*\n\n• የሚገኝ ሂሳብ: *${avail} ብር*\n• በጨዋታ የተያዘ: *${res} ብር*\n• ጠቅላላ: *${tot} ብር*`,
    profile_title: (name, user, games, wins, winAmount, bal) =>
      `👤 *የእርስዎ መገለጫ*\n\n• *ስም:* ${name}\n• *የተጠቃሚ ስም:* @${user || 'የለም'}\n• *የተጫወቱት ጨዋታዎች:* ${games}\n• *ያሸነፉት:* ${wins}\n• *አጠቃላይ ያሸነፉት ገንዘብ:* ${winAmount} ብር\n• *አሁን ያለዎት ሂሳብ:* ${bal} ብር`,

    deposit_select: `💳 *ገንዘብ ማስገቢያ*\n\nእባክዎ የሚከፍሉበትን ዘዴ ይምረጡ፡`,
    deposit_telebirr: `📱 *የቴሌብር ክፍያ*\n\nየቴሌብር ቁጥር: \`${CONFIG.TELEBIRR_NUMBER}\`\n\nማስገባት የሚፈልጉትን የብር መጠን ያስገቡ:\n_(ወይም ለመተው ሰርዝ የሚለውን ይጫኑ)_`,
    deposit_cbe: `🏦 *የኢትዮጵያ ንግድ ባንክ ክፍያ*\n\nየሂሳብ ቁጥር: \`${CONFIG.CBE_ACCOUNT}\`\n\nማስገባት የሚፈልጉትን የብር መጠን ያስገቡ:\n_(ወይም ለመተው ሰርዝ የሚለውን ይጫኑ)_`,

    withdraw_select: (bal, min) =>
      `💸 *ገንዘብ ማውጫ*\n\nሊያወጡት የሚችሉት: *${bal} ብር*\nዝቅተኛው የማውጫ መጠን: *${min} ብር*\n\nገንዘብ የሚያወጡበትን መንገድ ይምረጡ፡`,
    withdraw_amount_prompt: (method) =>
      `💸 *በ${method} ገንዘብ ማውጣት*\n\nማውጣት የሚፈልጉትን የገንዘብ መጠን ያስገቡ፡`,

    invite_title: (link) =>
      `🔗 *ጓደኞችን ይጋብዙ*\n\nጓደኞችዎን ወደ ሺሾ ቢንጎ ይጋብዙ!\n\nየእርስዎ መጋበዣ ሊንክ:\n\`${link}\`\n\nጓደኞችዎ ተቀላቅለው ሲጫወቱ ተጨማሪ የቦነስ ገቢዎችን ያግኙ።`,

    support_title: `💬 *የደንበኞች ድጋፍ*\n\nእርዳታ ይፈልጋሉ ወይስ የክፍያ ጥያቄ አለዎት?\nየድጋፍ ቡድናችን ሁልጊዜ ዝግጁ ነው።\n\nየድጋፍ አድራሻ: @${CONFIG.SUPPORT_USERNAME}`,
    channel_title: `📢 *ይፋዊ ቻናል*\n\nለአዳዲስ መረጃዎች እና ማስታወቂያዎች ይፋዊ ቻናላችንን ይቀላቀሉ:\n\n• የጨዋታ መርሃ-ግብሮች\n• ማስተዋወቂያዎች እና ሽልማቶች\n• አስፈላጊ የሲስተም መረጃዎች`,
    language_title: `🌐 *ቋንቋ ይምረጡ / SELECT LANGUAGE*`,
    language_set_en: `Language set to English. 🇬🇧`,
    language_set_am: `ቋንቋዎ ወደ አማርኛ ተቀይሯል። 🇪🇹`,

    admin_title: `👑 *የአስተዳዳሪ ክፍል (ADMIN)*\n\nዋና የአስተዳደር መቆጣጠሪያ። ለመምራት አንዱን ይምረጡ፡`,
    action_cancelled: `ተሰርዟል። ወደ ዋናው ማውጫ ተመልሰዋል።`,
    invalid_input: `⚠️ ያልታወቀ ትዕዛዝ። እባክዎ ከታች ያሉትን ቁልፎች ይጠቀሙ፡`,
  },
};

// ============================================================================
// 4. USER STATE MACHINE
// ============================================================================
const userStates = new Map();

function setUserState(telegramId, state) {
  if (!state) {
    userStates.delete(telegramId);
  } else {
    userStates.set(telegramId, { ...state, updatedAt: Date.now() });
  }
}

function getUserState(telegramId) {
  return userStates.get(telegramId) || null;
}

function clearUserState(telegramId) {
  userStates.delete(telegramId);
}

// ============================================================================
// 5. KEYBOARD BUILDERS
// ============================================================================
function getMainMenu(lang = 'en', isAdmin = false) {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  const keyboard = [
    [{ text: t.btn_play }, { text: t.btn_balance }],
    [{ text: t.btn_profile }, { text: t.btn_deposit }],
    [{ text: t.btn_withdraw }, { text: t.btn_invite }],
    [{ text: t.btn_support }, { text: t.btn_language }],
    [{ text: t.btn_channel }],
  ];

  if (isAdmin) {
    keyboard.push([{ text: t.btn_admin }]);
  }

  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

function getCancelKeyboard(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  return {
    keyboard: [[{ text: t.btn_cancel }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function getPlayMenu(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  const miniAppUrl = CONFIG.BASE_URL ? `${CONFIG.BASE_URL}/` : 'https://shisho-bingo.vercel.app/';
  return {
    inline_keyboard: [
      [{ text: t.btn_open_game, web_app: { url: miniAppUrl } }],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getBalanceMenu(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  return {
    inline_keyboard: [
      [
        { text: t.btn_deposit, callback_data: 'cb_deposit_prompt' },
        { text: t.btn_withdraw, callback_data: 'cb_withdraw_prompt' },
      ],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getProfileMenu(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  return {
    inline_keyboard: [
      [
        { text: t.btn_game_history, callback_data: 'cb_history' },
        { text: t.btn_settings, callback_data: 'cb_settings' },
      ],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getDepositMenu(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  return {
    inline_keyboard: [
      [
        { text: t.btn_telebirr, callback_data: 'cb_dep_telebirr' },
        { text: t.btn_cbe, callback_data: 'cb_dep_cbe' },
      ],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getWithdrawMenu(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  return {
    inline_keyboard: [
      [
        { text: t.btn_telebirr, callback_data: 'cb_wd_telebirr' },
        { text: t.btn_cbe, callback_data: 'cb_wd_cbe' },
      ],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getInviteMenu(lang = 'en', referralLink = '') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  const shareText = encodeURIComponent(`Join me on Shisho Bingo! Play multiplayer 5x5 Bingo & win instant prizes 🏆\n${referralLink}`);
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${shareText}`;

  return {
    inline_keyboard: [
      [{ text: t.btn_share_invite, url: telegramShareUrl }],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getSupportMenu(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  return {
    inline_keyboard: [
      [{ text: t.btn_contact_support, url: `https://t.me/${CONFIG.SUPPORT_USERNAME}` }],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getChannelMenu(lang = 'en') {
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  return {
    inline_keyboard: [
      [{ text: t.btn_join_channel, url: CONFIG.CHANNEL_URL }],
      [{ text: t.btn_main_menu, callback_data: 'cb_main_menu' }],
    ],
  };
}

function getLanguageMenu() {
  return {
    inline_keyboard: [
      [
        { text: '🇬🇧 English', callback_data: 'cb_lang_en' },
        { text: '🇪🇹 አማርኛ', callback_data: 'cb_lang_am' },
      ],
      [{ text: '⬅️ Main Menu', callback_data: 'cb_main_menu' }],
    ],
  };
}

function getAdminMenu() {
  return {
    inline_keyboard: [
      [
        { text: '👥 Users', callback_data: 'cb_adm_users' },
        { text: '💰 Deposits', callback_data: 'cb_adm_deposits' },
      ],
      [
        { text: '💸 Withdrawals', callback_data: 'cb_adm_withdrawals' },
        { text: '🎮 Active Game', callback_data: 'cb_adm_games' },
      ],
      [{ text: '📊 Statistics', callback_data: 'cb_adm_stats' }],
      [{ text: '⬅️ Main Menu', callback_data: 'cb_main_menu' }],
    ],
  };
}

// ============================================================================
// 6. TELEGRAM API CLIENT METHODS
// ============================================================================
async function callTelegramApi(method, payload) {
  if (!CONFIG.BOT_TOKEN) return null;

  return new Promise((resolve) => {
    const postData = JSON.stringify(payload);
    const req = https.request(
      `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`,
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
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ ok: false, error: body });
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error(`Telegram API (${method}) Network Error:`, err);
      resolve({ ok: false, error: err.message });
    });
    req.write(postData);
    req.end();
  });
}

async function sendBotMessage(chatId, text, replyMarkup = null, parseMode = 'Markdown') {
  const payload = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return callTelegramApi('sendMessage', payload);
}

async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
  const payload = { callback_query_id: callbackQueryId };
  if (text) {
    payload.text = text;
    payload.show_alert = showAlert;
  }
  return callTelegramApi('answerCallbackQuery', payload);
}

// ============================================================================
// 7. PRESENTATION HANDLERS (VIEW RENDERING)
// ============================================================================
async function showMainMenu(chatId, tgUser, customText = null) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const isAdmin = String(tgUser.id) === CONFIG.ADMIN_TELEGRAM_ID;
  const userData = await getOrCreateUserData(tgUser);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;

  const text = customText || (userData.is_new
    ? t.welcome_new(userData.display_name)
    : t.welcome_back(userData.display_name, userData.balance));

  await sendBotMessage(chatId, text, getMainMenu(lang, isAdmin));
}

async function showPlay(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  await sendBotMessage(chatId, t.play_title, getPlayMenu(lang));
}

async function showBalance(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  const data = await getOrCreateUserData(tgUser);
  const text = t.balance_title(data.balance, data.reserved, data.total);
  await sendBotMessage(chatId, text, getBalanceMenu(lang));
}

async function showProfile(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  const data = await getOrCreateUserData(tgUser);
  const text = t.profile_title(
    data.display_name,
    data.username,
    data.games_played,
    data.wins,
    data.winnings,
    data.balance
  );
  await sendBotMessage(chatId, text, getProfileMenu(lang));
}

async function showDeposit(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  await sendBotMessage(chatId, t.deposit_select, getDepositMenu(lang));
}

async function showWithdraw(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  const data = await getOrCreateUserData(tgUser);
  await sendBotMessage(chatId, t.withdraw_select(data.balance, CONFIG.MIN_WITHDRAWAL), getWithdrawMenu(lang));
}

async function showInvite(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  const data = await getOrCreateUserData(tgUser);
  const botUser = (process.env.TELEGRAM_BOT_USERNAME || 'ShishoBingoBot').replace('@', '');
  const refLink = `https://t.me/${botUser}?start=ref_${data.referral_code}`;
  await sendBotMessage(chatId, t.invite_title(refLink), getInviteMenu(lang, refLink));
}

async function showSupport(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  await sendBotMessage(chatId, t.support_title, getSupportMenu(lang));
}

async function showChannel(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  await sendBotMessage(chatId, t.channel_title, getChannelMenu(lang));
}

async function showLanguage(chatId, tgUser) {
  clearUserState(tgUser.id);
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  await sendBotMessage(chatId, t.language_title, getLanguageMenu());
}

async function showAdminDashboard(chatId, tgUser) {
  clearUserState(tgUser.id);
  if (String(tgUser.id) !== CONFIG.ADMIN_TELEGRAM_ID) {
    return showMainMenu(chatId, tgUser);
  }
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;
  await sendBotMessage(chatId, t.admin_title, getAdminMenu());
}

// ============================================================================
// 8. CALLBACK & CONTEXTUAL ROUTING
// ============================================================================
async function handleCallbackQuery(cbQuery) {
  const tgUser = cbQuery.from;
  const chatId = cbQuery.message ? cbQuery.message.chat.id : tgUser.id;
  const data = cbQuery.data || '';
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;

  await answerCallbackQuery(cbQuery.id);

  if (data === 'cb_main_menu') {
    return showMainMenu(chatId, tgUser);
  }

  if (data === 'cb_deposit_prompt') {
    return showDeposit(chatId, tgUser);
  }

  if (data === 'cb_withdraw_prompt') {
    return showWithdraw(chatId, tgUser);
  }

  if (data === 'cb_dep_telebirr') {
    setUserState(tgUser.id, { action: 'deposit', method: 'TELEBIRR', step: 'amount' });
    return sendBotMessage(chatId, t.deposit_telebirr, getCancelKeyboard(lang));
  }

  if (data === 'cb_dep_cbe') {
    setUserState(tgUser.id, { action: 'deposit', method: 'CBE', step: 'amount' });
    return sendBotMessage(chatId, t.deposit_cbe, getCancelKeyboard(lang));
  }

  if (data === 'cb_wd_telebirr' || data === 'cb_wd_cbe') {
    const method = data === 'cb_wd_telebirr' ? 'Telebirr' : 'CBE';
    const uData = await getOrCreateUserData(tgUser);
    if (parseFloat(uData.balance) < CONFIG.MIN_WITHDRAWAL) {
      const errTxt = lang === 'am'
        ? `⚠️ ዝቅተኛው የማውጫ መጠን ${CONFIG.MIN_WITHDRAWAL} ብር ነው። ያለዎት ሂሳብ: ${uData.balance} ብር።`
        : `⚠️ Minimum withdrawal is ${CONFIG.MIN_WITHDRAWAL} BIRR. Your available balance is ${uData.balance} BIRR.`;
      return sendBotMessage(chatId, errTxt);
    }
    setUserState(tgUser.id, { action: 'withdraw', method, step: 'amount' });
    return sendBotMessage(chatId, t.withdraw_amount_prompt(method), getCancelKeyboard(lang));
  }

  if (data === 'cb_lang_en') {
    await setUserLanguage(tgUser.id, 'en');
    await sendBotMessage(chatId, BOT_TRANSLATIONS.en.language_set_en);
    return showMainMenu(chatId, tgUser);
  }

  if (data === 'cb_lang_am') {
    await setUserLanguage(tgUser.id, 'am');
    await sendBotMessage(chatId, BOT_TRANSLATIONS.am.language_set_am);
    return showMainMenu(chatId, tgUser);
  }

  if (data === 'cb_history') {
    const histRes = await queryDb(
      'SELECT type, amount, balance_after, created_at FROM wallet_transactions WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1) ORDER BY id DESC LIMIT 5',
      [tgUser.id]
    );
    let msg = `📜 *${t.btn_game_history}*\n\n`;
    if (histRes.rows.length === 0) {
      msg += lang === 'am' ? 'ምንም አይነት ታሪክ አልተገኘም።' : 'No transactions recorded yet.';
    } else {
      histRes.rows.forEach((r) => {
        msg += `• *${r.type}*: ${r.amount} BIRR (Bal: ${r.balance_after})\n  _${new Date(r.created_at).toLocaleTimeString()}_\n`;
      });
    }
    return sendBotMessage(chatId, msg);
  }

  if (data === 'cb_settings') {
    const currentLangName = lang === 'am' ? 'አማርኛ 🇪🇹' : 'English 🇬🇧';
    const settingsMsg = `⚙️ *${t.btn_settings}*\n\n• Current Language: *${currentLangName}*\n• Bot Version: *1.0.0*\n\nTap *${t.btn_language}* from the main menu to change.`;
    return sendBotMessage(chatId, settingsMsg);
  }

  // Admin sub-actions
  if (data.startsWith('cb_adm_')) {
    if (String(tgUser.id) !== CONFIG.ADMIN_TELEGRAM_ID) {
      return showMainMenu(chatId, tgUser);
    }
    const adminAction = data.replace('cb_adm_', '');
    let resMsg = `👑 *ADMIN ${adminAction.toUpperCase()}*\n\n`;

    if (adminAction === 'stats') {
      const uCount = await queryDb('SELECT COUNT(*) FROM users');
      const gCount = await queryDb('SELECT COUNT(*) FROM games');
      const wSum = await queryDb('SELECT COALESCE(SUM(balance), 0) AS total_bal FROM wallets');
      resMsg += `• Total Users: *${uCount.rows[0]?.count || 0}*\n• Total Games: *${gCount.rows[0]?.count || 0}*\n• Total Float in Wallets: *${wSum.rows[0]?.total_bal || '0.00'} BIRR*`;
    } else if (adminAction === 'deposits') {
      const pendDep = await queryDb("SELECT COUNT(*) FROM deposits WHERE status = 'PENDING'");
      resMsg += `• Pending Deposit Requests: *${pendDep.rows[0]?.count || 0}*`;
    } else if (adminAction === 'withdrawals') {
      const pendWd = await queryDb("SELECT COUNT(*) FROM withdrawals WHERE status = 'PENDING'");
      resMsg += `• Pending Withdrawal Requests: *${pendWd.rows[0]?.count || 0}*`;
    } else {
      resMsg += `Section connected. Ready for operational processing.`;
    }
    return sendBotMessage(chatId, resMsg);
  }
}

// ============================================================================
// 9. INCOMING MESSAGE & STATE HANDLER
// ============================================================================
async function handleBotMessage(message) {
  if (!message || !message.chat) return;

  const chatId = message.chat.id;
  const tgUser = message.from;
  const text = (message.text || '').trim();
  const isAdmin = String(tgUser.id) === CONFIG.ADMIN_TELEGRAM_ID;
  const lang = await getUserLanguage(tgUser.id);
  const t = BOT_TRANSLATIONS[lang] || BOT_TRANSLATIONS.en;

  // Handle /start commands (including referral deep-links: /start ref_CODE)
  if (text.startsWith('/start')) {
    let refPayload = null;
    if (text.startsWith('/start ref_')) {
      refPayload = text.replace('/start ref_', '').trim();
    }
    await getOrCreateUserData(tgUser, refPayload);
    return showMainMenu(chatId, tgUser);
  }

  // Handle Cancel action across any flow
  if (text === t.btn_cancel || text === '❌ Cancel' || text === '❌ ሰርዝ') {
    clearUserState(tgUser.id);
    return showMainMenu(chatId, tgUser, t.action_cancelled);
  }

  // Handle Return to Main Menu
  if (text === t.btn_main_menu || text === '⬅️ Main Menu' || text === '⬅️ ዋና ማውጫ') {
    return showMainMenu(chatId, tgUser);
  }

  // State-Driven Input Processing (Deposit, Withdrawal multi-step)
  const currentState = getUserState(tgUser.id);
  if (currentState) {
    if (currentState.action === 'deposit' && currentState.step === 'amount') {
      const amt = parseFloat(text);
      if (isNaN(amt) || amt <= 0) {
        return sendBotMessage(chatId, lang === 'am' ? 'እባክዎ ትክክለኛ የብር መጠን ያስገቡ፡' : 'Please enter a valid numeric amount:', getCancelKeyboard(lang));
      }
      clearUserState(tgUser.id);
      const accInfo = currentState.method === 'TELEBIRR' ? CONFIG.TELEBIRR_NUMBER : CONFIG.CBE_ACCOUNT;
      const resp = lang === 'am'
        ? `✅ *የተቀማጭ ጥያቄ ተመዝግቧል*\n\nየተመረጠው መንገድ: *${currentState.method}*\nመጠን: *${amt.toFixed(2)} ብር*\nሂሳብ ቁጥር: \`${accInfo}\`\n\nእባክዎ ገንዘቡን ከላኩ በኋላ በጨዋታው ሚኒ አፕ (Mini App) ላይ የደረሰኝ ቁጥሩን ያረጋግጡ።`
        : `✅ *Deposit Request Registered*\n\nMethod: *${currentState.method}*\nAmount: *${amt.toFixed(2)} BIRR*\nTarget Account: \`${accInfo}\`\n\nPlease transfer the funds and verify the transaction inside the Mini App.`;
      return showMainMenu(chatId, tgUser, resp);
    }

    if (currentState.action === 'withdraw' && currentState.step === 'amount') {
      const amt = parseFloat(text);
      if (isNaN(amt) || amt < CONFIG.MIN_WITHDRAWAL) {
        return sendBotMessage(chatId, lang === 'am' ? `ዝቅተኛው ማውጫ ${CONFIG.MIN_WITHDRAWAL} ብር ነው። ትክክለኛ መጠን ያስገቡ:` : `Minimum is ${CONFIG.MIN_WITHDRAWAL} BIRR. Enter a valid amount:`, getCancelKeyboard(lang));
      }
      clearUserState(tgUser.id);
      const resp = lang === 'am'
        ? `✅ *የማውጣት ጥያቄ ተቀባይነት አግኝቷል*\n\nዘዴ: *${currentState.method}*\nመጠን: *${amt.toFixed(2)} ብር*\n\nጥያቄዎ በአስተዳዳሪው ተረጋግጦ ይላክልዎታል።`
        : `✅ *Withdrawal Request Queued*\n\nMethod: *${currentState.method}*\nAmount: *${amt.toFixed(2)} BIRR*\n\nYour cashout is pending administrative disbursement.`;
      return showMainMenu(chatId, tgUser, resp);
    }
  }

  // Main Reply Keyboard Text Matching (Both English & Amharic)
  if (text === BOT_TRANSLATIONS.en.btn_play || text === BOT_TRANSLATIONS.am.btn_play) {
    return showPlay(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_balance || text === BOT_TRANSLATIONS.am.btn_balance) {
    return showBalance(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_profile || text === BOT_TRANSLATIONS.am.btn_profile) {
    return showProfile(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_deposit || text === BOT_TRANSLATIONS.am.btn_deposit) {
    return showDeposit(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_withdraw || text === BOT_TRANSLATIONS.am.btn_withdraw) {
    return showWithdraw(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_invite || text === BOT_TRANSLATIONS.am.btn_invite) {
    return showInvite(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_support || text === BOT_TRANSLATIONS.am.btn_support) {
    return showSupport(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_language || text === BOT_TRANSLATIONS.am.btn_language) {
    return showLanguage(chatId, tgUser);
  }

  if (text === BOT_TRANSLATIONS.en.btn_channel || text === BOT_TRANSLATIONS.am.btn_channel) {
    return showChannel(chatId, tgUser);
  }

  if (isAdmin && (text === BOT_TRANSLATIONS.en.btn_admin || text === BOT_TRANSLATIONS.am.btn_admin || text === '/admin')) {
    return showAdminDashboard(chatId, tgUser);
  }

  // Fallback for unrecognized text
  return sendBotMessage(chatId, t.invalid_input, getMainMenu(lang, isAdmin));
}

// ============================================================================
// 10. PRIMARY TELEGRAM WEBHOOK / UPDATE DISPATCHER
// ============================================================================
async function processTelegramUpdate(update) {
  try {
    if (update.message) {
      await handleBotMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.error('Error handling Telegram update:', err);
  }
}

// ============================================================================
// 11. STANDALONE SERVER & VERCEL WEBHOOK INTEGRATION
// ============================================================================
async function telegramBotHandler(req, res) {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const update = JSON.parse(body);
        await processTelegramUpdate(update);
      } catch (err) {
        console.error('Invalid JSON in webhook update:', err);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'active', bot: '👑 SHISHO BINGO MENU SYSTEM' }));
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
}

// Export for direct inclusion in serverless routing or standalone boot
module.exports = {
  telegramBotHandler,
  processTelegramUpdate,
  showMainMenu,
  showBalance,
  showProfile,
  showDeposit,
  showWithdraw,
  showInvite,
  showSupport,
  showChannel,
  showLanguage,
  showAdminDashboard,
};

if (require.main === module) {
  const http = require('http');
  const PORT = process.env.PORT || 3001;
  const server = http.createServer(telegramBotHandler);
  server.listen(PORT, () => {
    console.log(`👑 SHISHO BINGO Bot Menu running on http://localhost:${PORT}`);
  });
}