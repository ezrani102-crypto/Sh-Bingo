/**
 * SHISHO BINGO
 * Telegram Bot Menu — Vercel Node.js
 *
 * File:
 *   api/node.js
 *
 * This version ONLY handles:
 *   - /start
 *   - Main menu
 *   - Play
 *   - Balance
 *   - Profile
 *   - Deposit menu
 *   - Withdrawal menu
 *   - Invite
 *   - Support
 *   - Channel
 *   - Language
 *   - Admin menu
 *   - Back / Cancel navigation
 *
 * It does NOT implement:
 *   - Bingo game engine
 *   - Mini App UI
 *   - Payments
 *   - Database
 *   - Game rooms
 *   - Bingo cards
 *
 * Node.js 18+ / Vercel
 */

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',

  ADMIN_TELEGRAM_ID:
    process.env.ADMIN_TELEGRAM_ID || '7336477309',

  MINI_APP_URL:
    process.env.MINI_APP_URL || '',

  CHANNEL_URL:
    process.env.CHANNEL_URL || 'https://t.me/shishobingo',

  SUPPORT_USERNAME:
    process.env.SUPPORT_USERNAME || '@bigbards',

  BOT_USERNAME:
    process.env.BOT_USERNAME || '',

  TELEBIRR_NUMBER:
    process.env.TELEBIRR_NUMBER || '+251900000000',

  CBE_ACCOUNT:
    process.env.CBE_ACCOUNT || '1000000000000',

  STAKE_PRICE:
    Number(process.env.STAKE_PRICE || 10),

  MIN_WITHDRAWAL:
    Number(process.env.MIN_WITHDRAWAL || 50),

  WEBHOOK_SECRET:
    process.env.WEBHOOK_SECRET || '',

  WEBHOOK_PATH:
    process.env.WEBHOOK_PATH || 'shisho-bingo-webhook',

  // Set to true only if you want /start to request phone number.
  REQUIRE_PHONE:
    process.env.REQUIRE_PHONE === 'true',
};

// ============================================================
// BASIC VALIDATION
// ============================================================

if (!CONFIG.BOT_TOKEN) {
  console.warn('[SHISHO] BOT_TOKEN is not configured.');
}

// ============================================================
// TEMPORARY USER STATE
// ============================================================
//
// IMPORTANT:
//
// Vercel Functions are serverless. This Map is NOT durable storage.
// It is enough for this first menu-only stage, but later the state
// should move into your database.
//
// ============================================================

const USER_STATE = globalThis.__SHISHO_USER_STATE__ ||
  new Map();

globalThis.__SHISHO_USER_STATE__ = USER_STATE;

// Temporary user profile/cache.
//
// Later replace this with your existing database/finance functions.

const USERS = globalThis.__SHISHO_USERS__ ||
  new Map();

globalThis.__SHISHO_USERS__ = USERS;

// ============================================================
// TELEGRAM API
// ============================================================

const TELEGRAM_API =
  `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}`;

async function telegram(method, payload = {}) {
  if (!CONFIG.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is missing.');
  }

  const response = await fetch(
    `${TELEGRAM_API}/${method}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram API ${method}: ${data.description || 'Unknown error'}`
    );
  }

  return data.result;
}

// ============================================================
// HELPERS
// ============================================================

function userId(update) {
  return String(
    update?.message?.from?.id ||
    update?.callback_query?.from?.id ||
    ''
  );
}

function chatId(update) {
  return (
    update?.message?.chat?.id ||
    update?.callback_query?.message?.chat?.id ||
    null
  );
}

function fromUser(update) {
  return (
    update?.message?.from ||
    update?.callback_query?.from ||
    null
  );
}

function getUser(tgId, telegramUser = null) {
  const id = String(tgId);

  if (!USERS.has(id)) {
    USERS.set(id, {
      tgId: id,

      firstName:
        telegramUser?.first_name || 'Player',

      lastName:
        telegramUser?.last_name || '',

      username:
        telegramUser?.username || '',

      phone: '',

      language:
        telegramUser?.language_code === 'am'
          ? 'am'
          : 'en',

      balance: 0,
      playBalance: 0,
      reservedBalance: 0,

      gamesPlayed: 0,
      totalWins: 0,
      totalWinnings: 0,
      cartelasPurchased: 0,

      registeredAt:
        new Date().toISOString(),

      isRegistered: true,
    });
  }

  const user = USERS.get(id);

  // Refresh Telegram profile data.
  if (telegramUser) {
    user.firstName =
      telegramUser.first_name ||
      user.firstName ||
      'Player';

    user.lastName =
      telegramUser.last_name ||
      user.lastName ||
      '';

    user.username =
      telegramUser.username ||
      user.username ||
      '';
  }

  return user;
}

function fullName(user) {
  return [
    user.firstName,
    user.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim() || 'Player';
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('en-US')} BIRR`;
}

function languageOf(tgId) {
  return getUser(tgId).language === 'am'
    ? 'am'
    : 'en';
}

function setState(tgId, state) {
  USER_STATE.set(String(tgId), state);
}

function getState(tgId) {
  return USER_STATE.get(String(tgId)) || null;
}

function clearState(tgId) {
  USER_STATE.delete(String(tgId));
}

function isAdmin(tgId) {
  return String(tgId) ===
    String(CONFIG.ADMIN_TELEGRAM_ID);
}

// ============================================================
// TRANSLATIONS
// ============================================================

const TEXT = {
  en: {
    welcome:
      `👑 SHISHO BINGO\n\n` +
      `Welcome to SHISHO BINGO! 🎉\n\n` +
      `Play Bingo in real time, join rooms, ` +
      `and win exciting rewards.\n\n` +
      `💰 Balance: {balance}\n\n` +
      `Choose an option below.`,

    welcomeBack:
      `👑 SHISHO BINGO\n\n` +
      `Welcome back, {name}! 🎉\n\n` +
      `💰 Balance: {balance}\n\n` +
      `Choose an option below.`,

    wallet:
      `💰 YOUR WALLET\n\n` +
      `Available: {available}\n` +
      `Reserved: {reserved}\n` +
      `Total: {total}`,

    profile:
      `👤 YOUR PROFILE\n\n` +
      `Name: {name}\n` +
      `Username: {username}\n\n` +
      `🎮 Games: {games}\n` +
      `🏆 Wins: {wins}\n` +
      `💰 Winnings: {winnings}\n` +
      `💳 Balance: {balance}`,

    play:
      `🎮 PLAY BINGO\n\n` +
      `Ready to play?\n\n` +
      `Join a live Bingo room and start playing.`,

    deposit:
      `💳 DEPOSIT\n\n` +
      `Choose your payment method:`,

    withdraw:
      `💸 WITHDRAW\n\n` +
      `Choose your withdrawal method:\n\n` +
      `Minimum withdrawal: {minimum}\n` +
      `Available: {available}`,

    invite:
      `🔗 INVITE FRIENDS\n\n` +
      `Invite your friends to SHISHO BINGO.\n\n` +
      `Share your referral link and earn referral ` +
      `rewards when applicable.`,

    support:
      `💬 SUPPORT\n\n` +
      `Need help?\n\n` +
      `Our support team is available here:\n` +
      `{support}`,

    channel:
      `📢 OFFICIAL CHANNEL\n\n` +
      `Join the official SHISHO BINGO channel for:\n\n` +
      `• Game announcements\n` +
      `• Promotions\n` +
      `• Updates\n` +
      `• Important notices`,

    language:
      `🌐 LANGUAGE\n\n` +
      `Choose your language:`,

    languageEnglish:
      `Language set to English. 🇬🇧`,

    languageAmharic:
      `Language set to Amharic. 🇪🇹`,

    admin:
      `👑 ADMIN DASHBOARD\n\n` +
      `Choose an administrative section:`,

    depositTelebirr:
      `📱 TELEBIRR DEPOSIT\n\n` +
      `Send your deposit using the details below:\n\n` +
      `📱 Telebirr: {number}\n\n` +
      `After payment, the transaction will be ` +
      `verified through the deposit process.`,

    depositCbe:
      `🏦 CBE DEPOSIT\n\n` +
      `Send your deposit using the details below:\n\n` +
      `🏦 CBE Account: {account}\n\n` +
      `After payment, the transaction will be ` +
      `verified through the deposit process.`,

    withdrawTelebirr:
      `📱 TELEBIRR WITHDRAWAL\n\n` +
      `You selected Telebirr.\n\n` +
      `Minimum withdrawal: {minimum}\n` +
      `Available balance: {available}\n\n` +
      `The actual withdrawal request flow will ` +
      `be connected to the wallet system.`,

    withdrawCbe:
      `🏦 CBE WITHDRAWAL\n\n` +
      `You selected CBE.\n\n` +
      `Minimum withdrawal: {minimum}\n` +
      `Available balance: {available}\n\n` +
      `The actual withdrawal request flow will ` +
      `be connected to the wallet system.`,

    noMiniApp:
      `🎮 The Bingo Mini App is not configured yet.\n\n` +
      `Please set MINI_APP_URL in your Vercel environment variables.`,

    noInvite:
      `🔗 Your invite link is not configured yet.\n\n` +
      `Please set BOT_USERNAME in your Vercel environment variables.`,

    adminDenied:
      `⛔ You are not authorized to access the admin dashboard.`,

    cancelled:
      `❌ Cancelled.\n\nChoose an option below.`,

    phoneRequired:
      `📱 Welcome to SHISHO BINGO!\n\n` +
      `Please share your phone number to continue.`,

    phoneSaved:
      `✅ Phone number verified!\n\n` +
      `Welcome to SHISHO BINGO!`,
  },

  am: {
    welcome:
      `👑 SHISHO BINGO\n\n` +
      `ወደ SHISHO BINGO እንኳን በደህና መጡ! 🎉\n\n` +
      `Bingo በቀጥታ ይጫወቱ፣ ወደ ክፍሎች ይግቡ፣ ` +
      `እና ሽልማቶችን ያሸንፉ።\n\n` +
      `💰 ቀሪ ሂሳብ: {balance}\n\n` +
      `ከታች አንዱን ይምረጡ።`,

    welcomeBack:
      `👑 SHISHO BINGO\n\n` +
      `እንኳን ደህና መጡ፣ {name}! 🎉\n\n` +
      `💰 ቀሪ ሂሳብ: {balance}\n\n` +
      `ከታች አንዱን ይምረጡ።`,

    wallet:
      `💰 የእርስዎ ቦርሳ\n\n` +
      `የሚገኝ: {available}\n` +
      `የተያዘ: {reserved}\n` +
      `ጠቅላላ: {total}`,

    profile:
      `👤 መገለጫዎ\n\n` +
      `ስም: {name}\n` +
      `የተጠቃሚ ስም: {username}\n\n` +
      `🎮 ጨዋታዎች: {games}\n` +
      `🏆 ድሎች: {wins}\n` +
      `💰 ያገኙት: {winnings}\n` +
      `💳 ቀሪ ሂሳብ: {balance}`,

    play:
      `🎮 ጨዋታ\n\n` +
      `ለመጫወት ዝግጁ ነዎት?\n\n` +
      `የቀጥታ Bingo ክፍል ይቀላቀሉ።`,

    deposit:
      `💳 ገንዘብ ማስገባት\n\n` +
      `የክፍያ ዘዴ ይምረጡ:`,

    withdraw:
      `💸 ገንዘብ ማውጣት\n\n` +
      `የማውጣት ዘዴ ይምረጡ:\n\n` +
      `ዝቅተኛው: {minimum}\n` +
      `የሚገኝ: {available}`,

    invite:
      `🔗 ጓደኞችን ይጋብዙ\n\n` +
      `ጓደኞችዎን ወደ SHISHO BINGO ይጋብዙ።\n\n` +
      `የግብዣ ሊንክዎን ያጋሩ።`,

    support:
      `💬 ድጋፍ\n\n` +
      `እርዳታ ያስፈልግዎታል?\n\n` +
      `የድጋፍ ቡድናችን:\n` +
      `{support}`,

    channel:
      `📢 ኦፊሴላዊ ቻናል\n\n` +
      `ለዜናዎች፣ ማስታወቂያዎች፣ ` +
      `ማስተዋወቂያዎች እና ዝመናዎች ቻናላችንን ይቀላቀሉ።`,

    language:
      `🌐 ቋንቋ\n\n` +
      `ቋንቋዎን ይምረጡ:`,

    languageEnglish:
      `ቋንቋ ወደ እንግሊዝኛ ተቀይሯል። 🇬🇧`,

    languageAmharic:
      `ቋንቋዎ ወደ አማርኛ ተቀይሯል። 🇪🇹`,

    admin:
      `👑 የአስተዳዳሪ ዳሽቦርድ\n\n` +
      `የአስተዳደር ክፍል ይምረጡ:`,

    depositTelebirr:
      `📱 TELEBIRR ማስገባት\n\n` +
      `📱 Telebirr: {number}\n\n` +
      `ከክፍያ በኋላ ግብይቱ ይረጋገጣል።`,

    depositCbe:
      `🏦 CBE ማስገባት\n\n` +
      `🏦 CBE Account: {account}\n\n` +
      `ከክፍያ በኋላ ግብይቱ ይረጋገጣል።`,

    withdrawTelebirr:
      `📱 TELEBIRR ማውጣት\n\n` +
      `የመረጡት: Telebirr\n\n` +
      `ዝቅተኛው: {minimum}\n` +
      `የሚገኝ ሂሳብ: {available}`,

    withdrawCbe:
      `🏦 CBE ማውጣት\n\n` +
      `የመረጡት: CBE\n\n` +
      `ዝቅተኛው: {minimum}\n` +
      `የሚገኝ ሂሳብ: {available}`,

    noMiniApp:
      `🎮 Mini App ገና አልተዘጋጀም።\n\n` +
      `MINI_APP_URL በVercel Environment Variables ውስጥ ያስገቡ።`,

    noInvite:
      `🔗 የግብዣ ሊንክ ገና አልተዘጋጀም።\n\n` +
      `BOT_USERNAME ያስገቡ።`,

    adminDenied:
      `⛔ የአስተዳዳሪ ፍቃድ የለዎትም።`,

    cancelled:
      `❌ ተሰርዟል።\n\n` +
      `ከታች አንዱን ይምረጡ።`,

    phoneRequired:
      `📱 ወደ SHISHO BINGO እንኳን በደህና መጡ!\n\n` +
      `ለመቀጠል ስልክዎን ያጋሩ።`,

    phoneSaved:
      `✅ ስልክዎ ተረጋግጧል!\n\n` +
      `ወደ SHISHO BINGO እንኳን በደህና መጡ!`,
  },
};

function t(tgId, key, vars = {}) {
  const lang = languageOf(tgId);
  let value =
    TEXT[lang]?.[key] ||
    TEXT.en[key] ||
    key;

  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(
      `{${name}}`,
      String(replacement ?? '')
    );
  }

  return value;
}

// ============================================================
// BUTTON LABELS
// ============================================================

const LABELS = {
  en: {
    play: '🎮 Play',
    balance: '💰 Balance',
    profile: '👤 Profile',
    deposit: '💳 Deposit',
    withdraw: '💸 Withdraw',
    invite: '🔗 Invite',
    support: '💬 Support',
    channel: '📢 Channel',
    language: '🌐 Language',

    admin: '👑 Admin Dashboard',

    openGame: '🎮 Open Game',
    gameHistory: '📜 Game History',
    settings: '⚙️ Settings',

    telebirr: '📱 Telebirr',
    cbe: '🏦 CBE',

    shareInvite: '📤 Share Invite',
    contactSupport: '💬 Contact Support',
    joinChannel: '📢 Join Channel',

    english: '🇬🇧 English',
    amharic: '🇪🇹 አማርኛ',

    users: '👥 Users',
    deposits: '💰 Deposits',
    withdrawals: '💸 Withdrawals',
    activeGame: '🎮 Active Game',
    statistics: '📊 Statistics',

    mainMenu: '⬅️ Main Menu',
    cancel: '❌ Cancel',
  },

  am: {
    play: '🎮 ጨዋታ',
    balance: '💰 ሂሳብ',
    profile: '👤 መገለጫ',
    deposit: '💳 ገንዘብ ያስገቡ',
    withdraw: '💸 ገንዘብ ያውጡ',
    invite: '🔗 ጋብዝ',
    support: '💬 ድጋፍ',
    channel: '📢 ቻናል',
    language: '🌐 ቋንቋ',

    admin: '👑 የአስተዳዳሪ ዳሽቦርድ',

    openGame: '🎮 ጨዋታ ክፈት',
    gameHistory: '📜 የጨዋታ ታሪክ',
    settings: '⚙️ ማስተካከያ',

    telebirr: '📱 Telebirr',
    cbe: '🏦 CBE',

    shareInvite: '📤 ግብዣ አጋራ',
    contactSupport: '💬 ድጋፍ ያግኙ',
    joinChannel: '📢 ቻናል ይቀላቀሉ',

    english: '🇬🇧 English',
    amharic: '🇪🇹 አማርኛ',

    users: '👥 ተጠቃሚዎች',
    deposits: '💰 ማስገቢያዎች',
    withdrawals: '💸 ማውጫዎች',
    activeGame: '🎮 የቀጥታ ጨዋታ',
    statistics: '📊 ስታቲስቲክስ',

    mainMenu: '⬅️ ዋና ምናሌ',
    cancel: '❌ ሰርዝ',
  },
};

function L(tgId, key) {
  return LABELS[languageOf(tgId)]?.[key] ||
    LABELS.en[key] ||
    key;
}

// ============================================================
// MAIN REPLY KEYBOARD
// ============================================================

function mainKeyboard(tgId) {
  const rows = [
    [
      { text: L(tgId, 'play') },
      { text: L(tgId, 'balance') },
    ],
    [
      { text: L(tgId, 'profile') },
      { text: L(tgId, 'deposit') },
    ],
    [
      { text: L(tgId, 'withdraw') },
      { text: L(tgId, 'invite') },
    ],
    [
      { text: L(tgId, 'support') },
      { text: L(tgId, 'language') },
    ],
    [
      { text: L(tgId, 'channel') },
    ],
  ];

  if (isAdmin(tgId)) {
    rows.push([
      { text: L(tgId, 'admin') },
    ]);
  }

  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder:
      languageOf(tgId) === 'am'
        ? 'አንዱን ይምረጡ...'
        : 'Choose an option...',
  };
}

// ============================================================
// INLINE KEYBOARDS
// ============================================================

function backKeyboard(tgId) {
  return {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };
}

function cancelKeyboard(tgId) {
  return {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'cancel'),
          callback_data: 'cancel',
        },
      ],
    ],
  };
}

function playKeyboard(tgId) {
  const rows = [];

  if (CONFIG.MINI_APP_URL) {
    rows.push([
      {
        text: L(tgId, 'openGame'),
        web_app: {
          url: CONFIG.MINI_APP_URL,
        },
      },
    ]);
  }

  rows.push([
    {
      text: L(tgId, 'mainMenu'),
      callback_data: 'main_menu',
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

function profileKeyboard(tgId) {
  return {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'gameHistory'),
          callback_data: 'profile_history',
        },
        {
          text: L(tgId, 'settings'),
          callback_data: 'profile_settings',
        },
      ],
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };
}

function balanceKeyboard(tgId) {
  return {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'deposit'),
          callback_data: 'deposit',
        },
        {
          text: L(tgId, 'withdraw'),
          callback_data: 'withdraw',
        },
      ],
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };
}

function depositKeyboard(tgId) {
  return {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'telebirr'),
          callback_data: 'deposit_telebirr',
        },
        {
          text: L(tgId, 'cbe'),
          callback_data: 'deposit_cbe',
        },
      ],
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };
}

function withdrawKeyboard(tgId) {
  return {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'telebirr'),
          callback_data: 'withdraw_telebirr',
        },
        {
          text: L(tgId, 'cbe'),
          callback_data: 'withdraw_cbe',
        },
      ],
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };
}

function languageKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: '🇬🇧 English',
          callback_data: 'language_en',
        },
        {
          text: '🇪🇹 አማርኛ',
          callback_data: 'language_am',
        },
      ],
    ],
  };
}

function adminKeyboard(tgId) {
  return {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'users'),
          callback_data: 'admin_users',
        },
        {
          text: L(tgId, 'deposits'),
          callback_data: 'admin_deposits',
        },
      ],
      [
        {
          text: L(tgId, 'withdrawals'),
          callback_data: 'admin_withdrawals',
        },
        {
          text: L(tgId, 'activeGame'),
          callback_data: 'admin_game',
        },
      ],
      [
        {
          text: L(tgId, 'statistics'),
          callback_data: 'admin_statistics',
        },
      ],
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };
}

// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage(
  chat,
  text,
  replyMarkup = null,
  extra = {}
) {
  const payload = {
    chat_id: chat,
    text,
    disable_web_page_preview: true,
    ...extra,
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return telegram('sendMessage', payload);
}

// ============================================================
// EDIT MESSAGE
// ============================================================

async function editMessage(
  chatIdValue,
  messageId,
  text,
  replyMarkup = null
) {
  const payload = {
    chat_id: chatIdValue,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return telegram(
    'editMessageText',
    payload
  );
}

// ============================================================
// ANSWER CALLBACK
// ============================================================

async function answerCallback(
  callbackId,
  text = '',
  showAlert = false
) {
  try {
    return await telegram(
      'answerCallbackQuery',
      {
        callback_query_id: callbackId,
        text,
        show_alert: showAlert,
      }
    );
  } catch (error) {
    console.warn(
      '[SHISHO] Callback answer error:',
      error.message
    );
  }
}

// ============================================================
// /START
// ============================================================

async function handleStart(update) {
  const tgUser = update.message.from;
  const tgId = String(tgUser.id);
  const chat = update.message.chat.id;

  const user = getUser(
    tgId,
    tgUser
  );

  clearState(tgId);

  if (
    CONFIG.REQUIRE_PHONE &&
    !user.phone
  ) {
    await sendMessage(
      chat,
      t(tgId, 'phoneRequired'),
      {
        keyboard: [
          [
            {
              text:
                languageOf(tgId) === 'am'
                  ? '📱 ስልኬን አጋራ'
                  : '📱 Share Phone Number',
              request_contact: true,
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      }
    );

    return;
  }

  const isExisting =
    user.registeredAt &&
    user.registeredAt !== '';

  const text =
    isExisting
      ? t(tgId, 'welcomeBack', {
          name: fullName(user),
          balance: formatMoney(user.balance),
        })
      : t(tgId, 'welcome', {
          balance: formatMoney(user.balance),
        });

  await sendMessage(
    chat,
    text,
    mainKeyboard(tgId)
  );
}

// ============================================================
// PHONE
// ============================================================

async function handleContact(update) {
  const message = update.message;
  const tgUser = message.from;
  const tgId = String(tgUser.id);

  const contact = message.contact;

  if (!contact) {
    return;
  }

  // Only accept the user's own contact.
  if (
    String(contact.user_id || '') !== tgId
  ) {
    await sendMessage(
      message.chat.id,
      languageOf(tgId) === 'am'
        ? '⚠️ እባክዎ የራስዎን ስልክ ያጋሩ።'
        : '⚠️ Please share your own phone number.',
      mainKeyboard(tgId)
    );

    return;
  }

  const user = getUser(
    tgId,
    tgUser
  );

  user.phone =
    contact.phone_number || '';

  clearState(tgId);

  await sendMessage(
    message.chat.id,
    t(tgId, 'phoneSaved'),
    mainKeyboard(tgId)
  );
}

// ============================================================
// PLAY
// ============================================================

async function showPlay(
  chat,
  tgId,
  edit = false,
  messageId = null
) {
  const text = t(
    tgId,
    'play'
  );

  if (
    edit &&
    messageId
  ) {
    await editMessage(
      chat,
      messageId,
      text,
      playKeyboard(tgId)
    );
  } else {
    await sendMessage(
      chat,
      text,
      playKeyboard(tgId)
    );
  }
}

// ============================================================
// BALANCE
// ============================================================

async function showBalance(
  chat,
  tgId,
  edit = false,
  messageId = null
) {
  const user = getUser(tgId);

  const balance =
    Number(user.balance || 0);

  const reserved =
    Number(user.reservedBalance || 0);

  const available =
    Math.max(
      0,
      balance - reserved
    );

  const text = t(
    tgId,
    'wallet',
    {
      available:
        formatMoney(available),

      reserved:
        formatMoney(reserved),

      total:
        formatMoney(balance),
    }
  );

  if (
    edit &&
    messageId
  ) {
    await editMessage(
      chat,
      messageId,
      text,
      balanceKeyboard(tgId)
    );
  } else {
    await sendMessage(
      chat,
      text,
      balanceKeyboard(tgId)
    );
  }
}

// ============================================================
// PROFILE
// ============================================================

async function showProfile(
  chat,
  tgId,
  edit = false,
  messageId = null
) {
  const user = getUser(tgId);

  const username =
    user.username
      ? `@${user.username}`
      : '—';

  const text = t(
    tgId,
    'profile',
    {
      name:
        fullName(user),

      username,

      games:
        Number(user.gamesPlayed || 0),

      wins:
        Number(user.totalWins || 0),

      winnings:
        formatMoney(
          user.totalWinnings || 0
        ),

      balance:
        formatMoney(
          user.balance || 0
        ),
    }
  );

  if (
    edit &&
    messageId
  ) {
    await editMessage(
      chat,
      messageId,
      text,
      profileKeyboard(tgId)
    );
  } else {
    await sendMessage(
      chat,
      text,
      profileKeyboard(tgId)
    );
  }
}

// ============================================================
// DEPOSIT
// ============================================================

async function showDeposit(
  chat,
  tgId,
  edit = false,
  messageId = null
) {
  clearState(tgId);

  const text = t(
    tgId,
    'deposit'
  );

  if (
    edit &&
    messageId
  ) {
    await editMessage(
      chat,
      messageId,
      text,
      depositKeyboard(tgId)
    );
  } else {
    await sendMessage(
      chat,
      text,
      depositKeyboard(tgId)
    );
  }
}

async function showDepositTelebirr(
  chat,
  tgId,
  messageId = null
) {
  const text = t(
    tgId,
    'depositTelebirr',
    {
      number:
        CONFIG.TELEBIRR_NUMBER,
    }
  );

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };

  if (messageId) {
    await editMessage(
      chat,
      messageId,
      text,
      keyboard
    );
  } else {
    await sendMessage(
      chat,
      text,
      keyboard
    );
  }
}

async function showDepositCBE(
  chat,
  tgId,
  messageId = null
) {
  const text = t(
    tgId,
    'depositCbe',
    {
      account:
        CONFIG.CBE_ACCOUNT,
    }
  );

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };

  if (messageId) {
    await editMessage(
      chat,
      messageId,
      text,
      keyboard
    );
  } else {
    await sendMessage(
      chat,
      text,
      keyboard
    );
  }
}

// ============================================================
// WITHDRAW
// ============================================================

async function showWithdraw(
  chat,
  tgId,
  edit = false,
  messageId = null
) {
  clearState(tgId);

  const user = getUser(tgId);

  const balance =
    Number(user.balance || 0);

  const reserved =
    Number(user.reservedBalance || 0);

  const available =
    Math.max(
      0,
      balance - reserved
    );

  const text = t(
    tgId,
    'withdraw',
    {
      minimum:
        formatMoney(
          CONFIG.MIN_WITHDRAWAL
        ),

      available:
        formatMoney(
          available
        ),
    }
  );

  if (
    edit &&
    messageId
  ) {
    await editMessage(
      chat,
      messageId,
      text,
      withdrawKeyboard(tgId)
    );
  } else {
    await sendMessage(
      chat,
      text,
      withdrawKeyboard(tgId)
    );
  }
}

async function showWithdrawTelebirr(
  chat,
  tgId,
  messageId = null
) {
  const user = getUser(tgId);

  const available =
    Math.max(
      0,
      Number(user.balance || 0) -
      Number(user.reservedBalance || 0)
    );

  const text = t(
    tgId,
    'withdrawTelebirr',
    {
      minimum:
        formatMoney(
          CONFIG.MIN_WITHDRAWAL
        ),

      available:
        formatMoney(
          available
        ),
    }
  );

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };

  if (messageId) {
    await editMessage(
      chat,
      messageId,
      text,
      keyboard
    );
  } else {
    await sendMessage(
      chat,
      text,
      keyboard
    );
  }
}

async function showWithdrawCBE(
  chat,
  tgId,
  messageId = null
) {
  const user = getUser(tgId);

  const available =
    Math.max(
      0,
      Number(user.balance || 0) -
      Number(user.reservedBalance || 0)
    );

  const text = t(
    tgId,
    'withdrawCbe',
    {
      minimum:
        formatMoney(
          CONFIG.MIN_WITHDRAWAL
        ),

      available:
        formatMoney(
          available
        ),
    }
  );

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: L(tgId, 'mainMenu'),
          callback_data: 'main_menu',
        },
      ],
    ],
  };

  if (messageId) {
    await editMessage(
      chat,
      messageId,
      text,
      keyboard
    );
  } else {
    await sendMessage(
      chat,
      text,
      keyboard
    );
  }
}

// ============================================================
// INVITE
// ============================================================

async function showInvite(
  chat,
  tgId
) {
  if (!CONFIG.BOT_USERNAME) {
    await sendMessage(
      chat,
      t(tgId, 'noInvite'),
      backKeyboard(tgId)
    );

    return;
  }

  const referralLink =
    `https://t.me/${CONFIG.BOT_USERNAME}` +
    `?start=ref_${tgId}`;

  const shareUrl =
    `https://t.me/share/url?url=` +
    `${encodeURIComponent(referralLink)}` +
    `&text=` +
    `${encodeURIComponent(
      'Join me on SHISHO BINGO 🎮🎉'
    )}`;

  await sendMessage(
    chat,
    `${t(tgId, 'invite')}\n\n` +
    `🔗 ${referralLink}`,
    {
      inline_keyboard: [
        [
          {
            text: L(
              tgId,
              'shareInvite'
            ),
            url: shareUrl,
          },
        ],
        [
          {
            text: L(
              tgId,
              'mainMenu'
            ),
            callback_data: 'main_menu',
          },
        ],
      ],
    }
  );
}

// ============================================================
// SUPPORT
// ============================================================

async function showSupport(
  chat,
  tgId
) {
  let supportUrl =
    CONFIG.SUPPORT_USERNAME;

  if (
    supportUrl.startsWith('@')
  ) {
    supportUrl =
      `https://t.me/${supportUrl.slice(1)}`;
  }

  await sendMessage(
    chat,
    t(tgId, 'support', {
      support:
        CONFIG.SUPPORT_USERNAME,
    }),
    {
      inline_keyboard: [
        [
          {
            text: L(
              tgId,
              'contactSupport'
            ),
            url: supportUrl,
          },
        ],
        [
          {
            text: L(
              tgId,
              'mainMenu'
            ),
            callback_data: 'main_menu',
          },
        ],
      ],
    }
  );
}

// ============================================================
// CHANNEL
// ============================================================

async function showChannel(
  chat,
  tgId
) {
  await sendMessage(
    chat,
    t(tgId, 'channel'),
    {
      inline_keyboard: [
        [
          {
            text: L(
              tgId,
              'joinChannel'
            ),
            url: CONFIG.CHANNEL_URL,
          },
        ],
        [
          {
            text: L(
              tgId,
              'mainMenu'
            ),
            callback_data: 'main_menu',
          },
        ],
      ],
    }
  );
}

// ============================================================
// LANGUAGE
// ============================================================

async function showLanguage(
  chat,
  tgId,
  messageId = null
) {
  const keyboard =
    languageKeyboard();

  if (messageId) {
    await editMessage(
      chat,
      messageId,
      t(tgId, 'language'),
      keyboard
    );
  } else {
    await sendMessage(
      chat,
      t(tgId, 'language'),
      keyboard
    );
  }
}

// ============================================================
// ADMIN
// ============================================================

async function showAdmin(
  chat,
  tgId,
  messageId = null
) {
  if (!isAdmin(tgId)) {
    const text =
      t(tgId, 'adminDenied');

    if (messageId) {
      await editMessage(
        chat,
        messageId,
        text,
        backKeyboard(tgId)
      );
    } else {
      await sendMessage(
        chat,
        text,
        backKeyboard(tgId)
      );
    }

    return;
  }

  if (messageId) {
    await editMessage(
      chat,
      messageId,
      t(tgId, 'admin'),
      adminKeyboard(tgId)
    );
  } else {
    await sendMessage(
      chat,
      t(tgId, 'admin'),
      adminKeyboard(tgId)
    );
  }
}

// ============================================================
// ADMIN PLACEHOLDERS
// ============================================================
//
// These are intentionally menu-only.
// They do not perform financial/admin operations yet.
// ============================================================

async function adminSection(
  chat,
  tgId,
  section
) {
  if (!isAdmin(tgId)) {
    await sendMessage(
      chat,
      t(tgId, 'adminDenied'),
      backKeyboard(tgId)
    );

    return;
  }

  const labels = {
    users:
      L(tgId, 'users'),

    deposits:
      L(tgId, 'deposits'),

    withdrawals:
      L(tgId, 'withdrawals'),

    game:
      L(tgId, 'activeGame'),

    statistics:
      L(tgId, 'statistics'),
  };

  await sendMessage(
    chat,
    `👑 ${labels[section] || 'Admin'}\n\n` +
    `This section is prepared for the next development stage.\n\n` +
    `No administrative operation is performed yet.`,
    adminKeyboard(tgId)
  );
}

// ============================================================
// PROFILE SUBMENU
// ============================================================

async function profileHistory(
  chat,
  tgId
) {
  await sendMessage(
    chat,
    languageOf(tgId) === 'am'
      ? `📜 የጨዋታ ታሪክ\n\n` +
        `የጨዋታ ታሪክ በሚቀጥለው የBackend ደረጃ ይገናኛል።`
      : `📜 GAME HISTORY\n\n` +
        `Game history will be connected to the backend ` +
        `in the next development stage.`,
    backKeyboard(tgId)
  );
}

async function profileSettings(
  chat,
  tgId
) {
  await sendMessage(
    chat,
    languageOf(tgId) === 'am'
      ? `⚙️ ማስተካከያ\n\n` +
        `የድምጽ፣ vibration እና auto-mark ማስተካከያዎች ` +
        `በMini App ውስጥ ይገነባሉ።`
      : `⚙️ SETTINGS\n\n` +
        `Audio, vibration and auto-mark settings ` +
        `will be implemented inside the Mini App.`,
    backKeyboard(tgId)
  );
}

// ============================================================
// MAIN MENU
// ============================================================

async function showMainMenu(
  chat,
  tgId,
  customText = null
) {
  const user = getUser(tgId);

  const text =
    customText ||
    t(tgId, 'welcomeBack', {
      name:
        fullName(user),

      balance:
        formatMoney(
          user.balance
        ),
    });

  clearState(tgId);

  await sendMessage(
    chat,
    text,
    mainKeyboard(tgId)
  );
}

// ============================================================
// REPLY KEYBOARD TEXT ROUTING
// ============================================================

async function handleTextMessage(
  update
) {
  const message =
    update.message;

  const chat =
    message.chat.id;

  const tgUser =
    message.from;

  const tgId =
    String(tgUser.id);

  const text =
    String(message.text || '')
      .trim();

  const user =
    getUser(
      tgId,
      tgUser
    );

  // ----------------------------------------------------------
  // COMMANDS
  // ----------------------------------------------------------

  if (
    text === '/start' ||
    text.startsWith('/start ')
  ) {
    await handleStart(update);
    return;
  }

  if (
    text === '/menu' ||
    text === '/help'
  ) {
    await showMainMenu(chat, tgId);
    return;
  }

  if (
    text === '/admin'
  ) {
    await showAdmin(chat, tgId);
    return;
  }

  // ----------------------------------------------------------
  // CURRENT STATE
  // ----------------------------------------------------------

  const state =
    getState(tgId);

  if (state) {
    if (
      text === L(tgId, 'cancel') ||
      text === '❌ Cancel' ||
      text === '❌ ሰርዝ'
    ) {
      clearState(tgId);

      await sendMessage(
        chat,
        t(tgId, 'cancelled'),
        mainKeyboard(tgId)
      );

      return;
    }

    // Menu-only stage:
    // We don't process amounts/payment information yet.

    await sendMessage(
      chat,
      languageOf(tgId) === 'am'
        ? `ℹ️ ይህ ደረጃ የምናሌ አሰሳን ብቻ ይደግፋል።`
        : `ℹ️ This first version only handles menu navigation.`,
      cancelKeyboard(tgId)
    );

    return;
  }

  // ----------------------------------------------------------
  // MAIN MENU BUTTONS
  // ----------------------------------------------------------

  const labels =
    LABELS[languageOf(tgId)];

  if (
    text === labels.play ||
    text === LABELS.en.play ||
    text === LABELS.am.play
  ) {
    await showPlay(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.balance ||
    text === LABELS.en.balance ||
    text === LABELS.am.balance
  ) {
    await showBalance(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.profile ||
    text === LABELS.en.profile ||
    text === LABELS.am.profile
  ) {
    await showProfile(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.deposit ||
    text === LABELS.en.deposit ||
    text === LABELS.am.deposit
  ) {
    await showDeposit(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.withdraw ||
    text === LABELS.en.withdraw ||
    text === LABELS.am.withdraw
  ) {
    await showWithdraw(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.invite ||
    text === LABELS.en.invite ||
    text === LABELS.am.invite
  ) {
    await showInvite(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.support ||
    text === LABELS.en.support ||
    text === LABELS.am.support
  ) {
    await showSupport(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.channel ||
    text === LABELS.en.channel ||
    text === LABELS.am.channel
  ) {
    await showChannel(
      chat,
      tgId
    );

    return;
  }

  if (
    text === labels.language ||
    text === LABELS.en.language ||
    text === LABELS.am.language
  ) {
    await showLanguage(
      chat,
      tgId
    );

    return;
  }

  if (
    isAdmin(tgId) &&
    (
      text === labels.admin ||
      text === LABELS.en.admin ||
      text === LABELS.am.admin
    )
  ) {
    await showAdmin(
      chat,
      tgId
    );

    return;
  }

  // ----------------------------------------------------------
  // UNKNOWN MESSAGE
  // ----------------------------------------------------------

  await sendMessage(
    chat,
    languageOf(tgId) === 'am'
      ? `እባክዎ ከምናሌው ውስጥ አንዱን ይምረጡ።`
      : `Please choose an option from the menu.`,
    mainKeyboard(tgId)
  );
}

// ============================================================
// CALLBACK ROUTER
// ============================================================

async function handleCallbackQuery(
  update
) {
  const callback =
    update.callback_query;

  const data =
    String(callback.data || '');

  const tgId =
    String(callback.from.id);

  const chat =
    callback.message.chat.id;

  const messageId =
    callback.message.message_id;

  getUser(
    tgId,
    callback.from
  );

  await answerCallback(
    callback.id
  );

  // ----------------------------------------------------------
  // MAIN MENU
  // ----------------------------------------------------------

  if (
    data === 'main_menu'
  ) {
    await showMainMenu(
      chat,
      tgId
    );

    return;
  }

  // ----------------------------------------------------------
  // CANCEL
  // ----------------------------------------------------------

  if (
    data === 'cancel'
  ) {
    clearState(tgId);

    await showMainMenu(
      chat,
      tgId,
      t(tgId, 'cancelled')
    );

    return;
  }

  // ----------------------------------------------------------
  // PLAY
  // ----------------------------------------------------------

  if (
    data === 'play'
  ) {
    await showPlay(
      chat,
      tgId,
      true,
      messageId
    );

    return;
  }

  // ----------------------------------------------------------
  // BALANCE
  // ----------------------------------------------------------

  if (
    data === 'balance'
  ) {
    await showBalance(
      chat,
      tgId,
      true,
      messageId
    );

    return;
  }

  // ----------------------------------------------------------
  // PROFILE
  // ----------------------------------------------------------

  if (
    data === 'profile'
  ) {
    await showProfile(
      chat,
      tgId,
      true,
      messageId
    );

    return;
  }

  if (
    data === 'profile_history'
  ) {
    await profileHistory(
      chat,
      tgId
    );

    return;
  }

  if (
    data === 'profile_settings'
  ) {
    await profileSettings(
      chat,
      tgId
    );

    return;
  }

  // ----------------------------------------------------------
  // DEPOSIT
  // ----------------------------------------------------------

  if (
    data === 'deposit'
  ) {
    await showDeposit(
      chat,
      tgId,
      true,
      messageId
    );

    return;
  }

  if (
    data === 'deposit_telebirr'
  ) {
    await showDepositTelebirr(
      chat,
      tgId,
      messageId
    );

    return;
  }

  if (
    data === 'deposit_cbe'
  ) {
    await showDepositCBE(
      chat,
      tgId,
      messageId
    );

    return;
  }

  // ----------------------------------------------------------
  // WITHDRAW
  // ----------------------------------------------------------

  if (
    data === 'withdraw'
  ) {
    await showWithdraw(
      chat,
      tgId,
      true,
      messageId
    );

    return;
  }

  if (
    data === 'withdraw_telebirr'
  ) {
    await showWithdrawTelebirr(
      chat,
      tgId,
      messageId
    );

    return;
  }

  if (
    data === 'withdraw_cbe'
  ) {
    await showWithdrawCBE(
      chat,
      tgId,
      messageId
    );

    return;
  }

  // ----------------------------------------------------------
  // LANGUAGE
  // ----------------------------------------------------------

  if (
    data === 'language_en'
  ) {
    const user =
      getUser(tgId);

    user.language = 'en';

    clearState(tgId);

    await answerCallback(
      callback.id,
      'Language set to English.'
    );

    await showMainMenu(
      chat,
      tgId,
      t(tgId, 'languageEnglish')
    );

    return;
  }

  if (
    data === 'language_am'
  ) {
    const user =
      getUser(tgId);

    user.language = 'am';

    clearState(tgId);

    await answerCallback(
      callback.id,
      'ቋንቋዎ ወደ አማርኛ ተቀይሯል።'
    );

    await showMainMenu(
      chat,
      tgId,
      t(tgId, 'languageAmharic')
    );

    return;
  }

  // ----------------------------------------------------------
  // ADMIN
  // ----------------------------------------------------------

  if (
    data === 'admin'
  ) {
    await showAdmin(
      chat,
      tgId,
      messageId
    );

    return;
  }

  if (
    data === 'admin_users'
  ) {
    await adminSection(
      chat,
      tgId,
      'users'
    );

    return;
  }

  if (
    data === 'admin_deposits'
  ) {
    await adminSection(
      chat,
      tgId,
      'deposits'
    );

    return;
  }

  if (
    data === 'admin_withdrawals'
  ) {
    await adminSection(
      chat,
      tgId,
      'withdrawals'
    );

    return;
  }

  if (
    data === 'admin_game'
  ) {
    await adminSection(
      chat,
      tgId,
      'game'
    );

    return;
  }

  if (
    data === 'admin_statistics'
  ) {
    await adminSection(
      chat,
      tgId,
      'statistics'
    );

    return;
  }

  // ----------------------------------------------------------
  // UNKNOWN CALLBACK
  // ----------------------------------------------------------

  await sendMessage(
    chat,
    languageOf(tgId) === 'am'
      ? `⚠️ ይህ አማራጭ አይገኝም።`
      : `⚠️ This option is not available.`,
    mainKeyboard(tgId)
  );
}

// ============================================================
// UPDATE ROUTER
// ============================================================

async function processUpdate(
  update
) {
  if (
    update.message
  ) {
    if (
      update.message.contact
    ) {
      await handleContact(
        update
      );

      return;
    }

    if (
      update.message.text
    ) {
      await handleTextMessage(
        update
      );

      return;
    }

    return;
  }

  if (
    update.callback_query
  ) {
    await handleCallbackQuery(
      update
    );

    return;
  }
}

// ============================================================
// BOT SETUP
// ============================================================

async function configureBot() {
  if (!CONFIG.BOT_TOKEN) {
    throw new Error(
      'BOT_TOKEN is not configured.'
    );
  }

  await telegram(
    'setMyCommands',
    {
      commands: [
        {
          command: 'start',
          description:
            'Start SHISHO BINGO',
        },
        {
          command: 'menu',
          description:
            'Open main menu',
        },
        {
          command: 'help',
          description:
            'Show main menu',
        },
      ],
    }
  );

  return true;
}

// ============================================================
// WEBHOOK SETUP
// ============================================================
//
// Open:
//
// https://YOUR-DOMAIN.vercel.app/api/node?setup=1&key=YOUR_WEBHOOK_SETUP_KEY
//
// The code then calls Telegram setWebhook.
// ============================================================

async function setupWebhook(requestUrl) {
  if (!CONFIG.WEBHOOK_SECRET) {
    throw new Error(
      'WEBHOOK_SECRET is required for webhook setup.'
    );
  }

  const urlObject =
    new URL(requestUrl);

  const providedKey =
    urlObject.searchParams.get(
      'key'
    );

  if (
    !providedKey ||
    providedKey !==
      CONFIG.WEBHOOK_SECRET
  ) {
    throw new Error(
      'Invalid webhook setup key.'
    );
  }

  const publicUrl =
    urlObject.origin;

  const webhookUrl =
    `${publicUrl}/api/node`;

  await telegram(
    'setWebhook',
    {
      url: webhookUrl,

      secret_token:
        CONFIG.WEBHOOK_SECRET,

      allowed_updates: [
        'message',
        'callback_query',
      ],

      drop_pending_updates: false,
    }
  );

  await configureBot();

  return {
    ok: true,
    webhookUrl,
  };
}

// ============================================================
// WEBHOOK SECRET VERIFICATION
// ============================================================

function validWebhookRequest(req) {
  if (!CONFIG.WEBHOOK_SECRET) {
    return true;
  }

  const received =
    req.headers[
      'x-telegram-bot-api-secret-token'
    ];

  return (
    typeof received === 'string' &&
    received ===
      CONFIG.WEBHOOK_SECRET
  );
}

// ============================================================
// VERCEL HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {
  try {
    // --------------------------------------------------------
    // HEALTH / SETUP
    // --------------------------------------------------------

    if (
      req.method === 'GET'
    ) {
      const urlObject =
        new URL(
          req.url,
          `https://${req.headers.host}`
        );

      if (
        urlObject.searchParams.get(
          'setup'
        ) === '1'
      ) {
        const result =
          await setupWebhook(
            urlObject.toString()
          );

        res.status(200).json({
          ok: true,
          message:
            'SHISHO BINGO webhook configured.',
          ...result,
        });

        return;
      }

      res.status(200).json({
        ok: true,
        service:
          'SHISHO BINGO Telegram Bot',
        status:
          'online',
        version:
          'menu-v1',
        runtime:
          'vercel-nodejs',
        timestamp:
          new Date().toISOString(),
      });

      return;
    }

    // --------------------------------------------------------
    // ONLY POST IS ACCEPTED FOR TELEGRAM WEBHOOK
    // --------------------------------------------------------

    if (
      req.method !== 'POST'
    ) {
      res.status(405).json({
        ok: false,
        error:
          'Method Not Allowed',
      });

      return;
    }

    // --------------------------------------------------------
    // VERIFY TELEGRAM WEBHOOK
    // --------------------------------------------------------

    if (
      !validWebhookRequest(req)
    ) {
      res.status(401).json({
        ok: false,
        error:
          'Unauthorized',
      });

      return;
    }

    // --------------------------------------------------------
    // VERCEL MAY PROVIDE req.body AS OBJECT OR STRING
    // --------------------------------------------------------

    let update =
      req.body;

    if (
      typeof update === 'string'
    ) {
      try {
        update =
          JSON.parse(update);
      } catch {
        res.status(400).json({
          ok: false,
          error:
            'Invalid JSON',
        });

        return;
      }
    }

    if (
      !update ||
      typeof update !== 'object'
    ) {
      res.status(400).json({
        ok: false,
        error:
          'Invalid Telegram update',
      });

      return;
    }

    // --------------------------------------------------------
    // ACK TELEGRAM QUICKLY
    // --------------------------------------------------------
    //
    // Telegram webhooks expect a successful HTTP response.
    // We still process the update before returning.
    //
    // --------------------------------------------------------

    await processUpdate(
      update
    );

    res.status(200).json({
      ok: true,
    });

  } catch (error) {
    console.error(
      '[SHISHO ERROR]',
      error
    );

    // Telegram only needs a successful webhook response
    // once the update has been received. For development,
    // return the error information.
    res.status(500).json({
      ok: false,
      error:
        error?.message ||
        'Internal Server Error',
    });
  }
}