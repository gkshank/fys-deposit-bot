/*******************************************************************
 * main.js
 * FY'S PROPERTY WHATSAPP BOT
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express        = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode         = require('qrcode');
const axios          = require('axios');
const fs             = require('fs');
const path           = require('path');

// ────────────────────────────────────────────────────────────────────
// 1) PERSISTENT STORAGE
// ────────────────────────────────────────────────────────────────────
const DATA_PATH = path.join(__dirname, 'users.json');
function loadUsers() {
  if (fs.existsSync(DATA_PATH)) {
    return JSON.parse(fs.readFileSync(DATA_PATH));
  }
  return {};
}
function saveUsers(users) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(users, null, 2));
}
let users = loadUsers();

// ────────────────────────────────────────────────────────────────────
// 2) BOT CONFIG & GLOBAL STATE
// ────────────────────────────────────────────────────────────────────
const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);

let botConfig = {
  fromAdmin:    "👑 Admin",
  channelID:    529,
  costPerChar:  0.01,
  welcomeText:  "👋 *Welcome!* Please choose a *unique username* to register (3–16 letters, numbers, or underscores):",
  regSuccessText: username => `🎉 You're registered as *${username}!* Your balance is *Ksh 0.00*.`,
  userMenu(user) {
    return (
      `\n🌟 *Hello ${user.username}!* What would you like to do?\n\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `7️⃣ Delete My Account\n` +
      `8️⃣ View Recipients\n\n` +
      `Type *menu* anytime to see this again.`
    );
  },
  notEnoughBal(cost,bal) {
    return `⚠️ Sending costs *Ksh ${cost.toFixed(2)}*, but you have *Ksh ${bal.toFixed(2)}*. Please top-up first.`;
  },
  topupPrompt: "💳 How much would you like to top-up? (min Ksh 11)",
  closedSupport: "✅ Support closed. Type *menu* to continue.",
};

// Per-chat state
const conversations = {};   // { jid: { stage, ... } }
const adminSessions = {};   // { jid: { awaiting, step, ... } }

// ────────────────────────────────────────────────────────────────────
// 3) WHATSAPP CLIENT INIT
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = '';

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});
client.on('ready', () => {
  console.log('🚀 Bot is ready');
  adminReply(SUPER_ADMIN, "🤖 Bot is online!").then(() => showAdminMenu(SUPER_ADMIN));
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', async (req,res) => {
  let img = '';
  if (currentQR) {
    try { img = await QRCode.toDataURL(currentQR); } catch {}
  }
  res.send(`
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot QR</title></head>
<body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#222;color:#fff">
  <div style="text-align:center">
    <h2>Scan to Connect</h2>
    ${img ? `<img src="${img}">` : '<p>Waiting QR…</p>'}
  </div>
</body></html>`);
});
app.listen(PORT, ()=>console.log(`🌐 QR Dashboard at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid,msg) {
  try {
    await client.sendMessage(jid,msg);
  } catch(err) {
    console.error(`❌ Error sending to ${jid}:`, err.message);
  }
}
async function adminReply(jid,msg) {
  const suffix = "\n\n0️⃣ Go Back   00️⃣ Main Menu";
  return safeSend(jid, msg + suffix);
}

// ────────────────────────────────────────────────────────────────────
// 6) PHONE FORMAT (for top-up)
// ────────────────────────────────────────────────────────────────────
function formatPhone(txt) {
  let n = txt.replace(/\D/g,'');
  if (n.length === 9 && n.startsWith('7'))        n = '254' + n;
  else if (n.length === 10 && n.startsWith('0'))  n = '254' + n.slice(1);
  return (n.length === 12 ? n + '@c.us' : null);
}

// ────────────────────────────────────────────────────────────────────
// 7) ADMIN MENUS
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid) {
  adminSessions[jid] = { awaiting: 'main' };
  const menu =
    `👑 *Admin Menu*\n\n` +
    `1️⃣ View All Users\n` +
    `2️⃣ Change Cost/Char (Ksh ${botConfig.costPerChar.toFixed(2)})\n` +
    `3️⃣ Top-up/Deduct by Username\n` +
    `4️⃣ Ban/Unban by Username\n` +
    `5️⃣ Bulk Message to All\n` +
    `6️⃣ Show QR Dashboard\n` +
    `7️⃣ Config Texts & ChannelID\n`;
  return adminReply(jid, menu);
}

function showConfigMenu(jid) {
  adminSessions[jid] = { awaiting: 'config' };
  const cfg =
    `⚙️ *Config Menu*\n\n` +
    `1️⃣ Admin Label\n` +
    `2️⃣ Welcome Text\n` +
    `3️⃣ Registration Success Text\n` +
    `4️⃣ User Menu Text\n` +
    `5️⃣ Cost/Char\n` +
    `6️⃣ Channel ID\n` +
    `0️⃣ Back\n`;
  return adminReply(jid, cfg);
}

// ────────────────────────────────────────────────────────────────────
// 8) MAIN MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();
  if (from.endsWith('@g.us')) return;

  // 8.1) SUPPORT FOR USERS
  if (users[from]?.support?.open && !adminUsers.has(from)) {
    await safeSend(SUPER_ADMIN, `🎟 [${users[from].username}] ${txt}`);
    return msg.reply("📥 Sent to support. Type *close* to finish.");
  }
  if (lc === 'close' && users[from]?.support?.open) {
    users[from].support.open = false;
    saveUsers(users);
    return msg.reply(botConfig.closedSupport);
  }

  // 8.2) ADMIN REPLIES TO SUPPORT
  if (adminUsers.has(from) && lc.startsWith('reply ')) {
    const [_, ticket, ...rest] = txt.split(' ');
    const content = rest.join(' ');
    const target = Object.values(users).find(u => u.support.open && u.support.ticketId === ticket);
    if (target) {
      await safeSend(target.jid, `🛎 Support Reply:\n${content}`);
      return adminReply(from, `✅ Replied to ticket #${ticket}`);
    }
    return adminReply(from, "⚠️ No such ticket.");
  }

  // 8.3) ADMIN FLOW
  if (adminUsers.has(from)) {
    // Back / Main menu
    if (txt === '00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === '0')  { delete adminSessions[from]; return adminReply(from, "🔙 Back"); }

    const sess = adminSessions[from] || {};

    // Main dispatch
    if (!sess.awaiting || sess.awaiting === 'main') {
      switch (txt) {
        case '1': sess.awaiting = 'view';   return adminReply(from, "👥 Fetching users...");
        case '2': sess.awaiting = 'chgCost';return adminReply(from, "💱 Enter new cost/char:");
        case '3': sess.awaiting = 'modBal'; sess.step = null; return adminReply(from, "✍️ Enter username:");
        case '4': sess.awaiting = 'ban';    sess.step = null; return adminReply(from, "✍️ Enter username:");
        case '5': sess.awaiting = 'bulk';   sess.step = null; return adminReply(from, "📝 Enter message:");
        case '6': return adminReply(from, `🌐 http://localhost:${PORT}`);
        case '7': return showConfigMenu(from);
        default:  return showAdminMenu(from);
      }
    }

    // Submenus
    switch (sess.awaiting) {
      case 'view': {
        let out = "👥 *All Users:*\n\n";
        Object.values(users).forEach(u => {
          out += `• ${u.username} — Ksh ${u.balance.toFixed(2)}\n`;
        });
        delete adminSessions[from];
        return adminReply(from, out);
      }
      case 'chgCost': {
        const v = parseFloat(txt);
        if (isNaN(v) || v <= 0) return adminReply(from, "⚠️ Invalid value.");
        botConfig.costPerChar = v;
        delete adminSessions[from];
        return adminReply(from, `🎉 cost/char set to Ksh ${v.toFixed(2)}`);
      }
      case 'modBal': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from, "✍️ Enter username:");
        }
        if (sess.step === 'getUser') {
          const u = Object.values(users).find(u => u.username === txt);
          if (!u) return adminReply(from, "⚠️ No such user. Try again:");
          sess.targetJid = u.jid;
          sess.step = 'getAmt';
          return adminReply(from, "💰 Enter +amount or -amount:");
        }
        if (sess.step === 'getAmt') {
          const a = parseFloat(txt);
          if (isNaN(a)) return adminReply(from, "⚠️ Invalid amount. Try again:");
          users[sess.targetJid].balance += a;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from, `✅ ${a >= 0 ? 'Credited' : 'Debited'} Ksh ${Math.abs(a)} to ${users[sess.targetJid].username}`);
        }
        break;
      }
      case 'ban': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from, "✍️ Enter username:");
        }
        if (sess.step === 'getUser') {
          const u = Object.values(users).find(u => u.username === txt);
          if (!u) return adminReply(from, "⚠️ No such user. Try again:");
          sess.targetJid = u.jid;
          if (u.banned) {
            u.banned = false;
            u.banReason = '';
            saveUsers(users);
            delete adminSessions[from];
            return adminReply(from, `✅ Unbanned ${u.username}`);
          }
          sess.step = 'getReason';
          return adminReply(from, "✏️ Enter ban reason:");
        }
        if (sess.step === 'getReason') {
          users[sess.targetJid].banned = true;
          users[sess.targetJid].banReason = txt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from, `🚫 Banned ${users[sess.targetJid].username}`);
        }
        break;
      }
      case 'bulk': {
        if (!sess.step) {
          sess.step = 'msg';
          return adminReply(from, "📝 Enter message for all users:");
        }
        if (sess.step === 'msg') {
          sess.message = txt;
          sess.step = 'confirm';
          return adminReply(from, `Preview:\n"${txt}"\nType 1 to send or 0 to cancel`);
        }
        if (sess.step === 'confirm') {
          delete adminSessions[from];
          if (txt === '1') {
            Object.keys(users).forEach(jid => safeSend(jid, sess.message));
            return adminReply(from, "🎉 Sent to all users!");
          } else {
            return adminReply(from, "❌ Bulk cancelled.");
          }
        }
        break;
      }
      case 'config': {
        if (!sess.step) {
          switch (txt) {
            case '1': sess.step = 'lab';   return adminReply(from, "✏️ New Admin label:");
            case '2': sess.step = 'wel';   return adminReply(from, "✏️ New welcome text:");
            case '3': sess.step = 'reg';   return adminReply(from, "✏️ New reg-success text (use {name}):");
            case '4': sess.step = 'umenu'; return adminReply(from, "✏️ New user-menu text (use {username}):");
            case '5': sess.step = 'cost';  return adminReply(from, "✏️ New cost/char:");
            case '6': sess.step = 'ch';    return adminReply(from, "✏️ New channel ID:");
            case '0': delete adminSessions[from]; return showAdminMenu(from);
            default:  return adminReply(from, "⚠️ Invalid option.");
          }
        } else {
          switch (sess.step) {
            case 'lab':   botConfig.fromAdmin   = txt; break;
            case 'wel':   botConfig.welcomeText = txt; break;
            case 'reg':   botConfig.regSuccessText = name => txt.replace('{name}', name); break;
            case 'umenu': botConfig.userMenu = _ => txt.replace('{username}', _.username); break;
            case 'cost':  botConfig.costPerChar = parseFloat(txt) || botConfig.costPerChar; break;
            case 'ch':    botConfig.channelID = parseInt(txt) || botConfig.channelID; break;
          }
          delete adminSessions[from];
          return adminReply(from, "✅ Configuration updated.");
        }
      }
    }
    return;
  }

  // 8.4) USER REGISTRATION
  if (!users[from]) {
    if (!conversations[from]) {
      conversations[from] = { stage: 'awaitUsername' };
      return msg.reply(botConfig.welcomeText);
    }
    const conv = conversations[from];
    if (conv.stage === 'awaitUsername') {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(txt)) {
        return msg.reply("⚠️ Use 3–16 letters, numbers, or underscores.");
      }
      const exists = Object.values(users).some(u => u.username === txt);
      if (exists) {
        return msg.reply("⚠️ Username taken—try another.");
      }
      users[from] = {
        jid: from,
        username: txt,
        balance: 0,
        banned: false,
        banReason: '',
        messageCount: 0,
        totalCharges: 0,
        recipients: [],
        support: { open: false, ticketId: null },
      };
      saveUsers(users);
      delete conversations[from];
      await safeSend(SUPER_ADMIN, `🆕 New user registered: ${txt}`);
      return msg.reply(
        botConfig.regSuccessText(txt) +
        botConfig.userMenu(users[from])
      );
    }
    return;
  }

  // 8.5) REGISTERED USER MAIN
  const user = users[from];
  if (user.banned) {
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }

  // Show menu
  if (lc === 'menu') {
    return msg.reply(botConfig.userMenu(user));
  }

  // Delete account
  if (lc === '7' || lc === 'delete my account') {
    delete users[from];
    saveUsers(users);
    return msg.reply("❌ Account deleted. Type *menu* to re-register.");
  }

  // View recipients
  if (lc === '8' || lc === 'view recipients') {
    const list = user.recipients.length
      ? user.recipients.map(r => `• ${r.replace('@c.us','')}`).join('\n')
      : '— No recipients added.';
    return msg.reply(`📋 *Your Recipients:*\n${list}`);
  }

  // Contact support
  if (lc === '6') {
    if (!user.support.open) {
      user.support.open     = true;
      user.support.ticketId = Date.now().toString().slice(-4);
      saveUsers(users);
      return msg.reply(`🆘 Support opened (#${user.support.ticketId}). Type your message:`);
    }
    return msg.reply("🆘 Send message or type *close* to end.");
  }

  // Check balance
  if (lc === '5') {
    return msg.reply(
      `💰 Balance: Ksh ${user.balance.toFixed(2)}\n` +
      `✉️ Messages sent: ${user.messageCount}\n` +
      `💸 Total charges: Ksh ${user.totalCharges.toFixed(2)}`
    );
  }

  // Top-up flow (min Ksh 11)
  if (lc === '4' || conversations[from]?.stage?.startsWith('topup')) {
    const conv = conversations[from] || {};
    if (lc === '4') {
      conversations[from] = { stage: 'topup:amount' };
      return msg.reply(botConfig.topupPrompt);
    }
    if (conv.stage === 'topup:amount') {
      const amt = parseFloat(txt);
      if (isNaN(amt) || amt < 11) {
        delete conversations[from];
        return msg.reply("⚠️ Minimum top-up is Ksh 11. Type *4* to retry.");
      }
      conv.amount = amt;
      conv.stage  = 'topup:phone';
      conversations[from] = conv;
      return msg.reply(`📱 Send M-PESA number to charge Ksh ${amt.toFixed(2)}:`);
    }
    if (conv.stage === 'topup:phone') {
      const mp  = formatPhone(txt);
      const amt = conv.amount;
      delete conversations[from];
      if (!mp) {
        return msg.reply("⚠️ Invalid number. Type *4* to retry.");
      }
      await msg.reply(`⏳ Charging Ksh ${amt.toFixed(2)} to ${mp.replace('@c.us','')}…`);
      const ref = await sendSTKPush(amt, mp.replace('@c.us',''));
      if (!ref) return msg.reply("❌ STK push failed.");
      setTimeout(() => safeSend(from, "⏳ 20s left…"), 10000);
      setTimeout(() => safeSend(from, "⏳ 10s left…"), 20000);
      setTimeout(async () => {
        const st = await fetchTransactionStatus(ref);
        if (st?.status === 'SUCCESS') {
          user.balance += amt;
          saveUsers(users);
          await safeSend(from,
            `🎉 Top-up successful!\nNew balance: Ksh ${user.balance.toFixed(2)}`
          );
          await safeSend(SUPER_ADMIN,
            `💰 ${user.username} topped up Ksh ${amt.toFixed(2)}`
          );
        } else {
          await safeSend(from, "❌ Top-up failed or timed out.");
        }
      }, 30000);
    }
    return;
  }

  // Send bulk message
  if (lc === '1' || conversations[from]?.stage === 'bulk') {
    if (lc === '1') {
      conversations[from] = { stage: 'bulk' };
      return msg.reply("✏️ Type the message to send to your recipients:");
    }
    if (conversations[from].stage === 'bulk') {
      const conv2 = conversations[from];
      conv2.message = txt;
      conv2.stage = 'confirm';
      const cost = txt.length * botConfig.costPerChar;
      return msg.reply(
        `📝 Preview:\n"${txt}"\nCost: Ksh ${cost.toFixed(2)}\n\n✅ Type *yes* to send or *no* to cancel.`
      );
    }
    if (conversations[from].stage === 'confirm') {
      const conv2 = conversations[from];
      delete conversations[from];
      if (lc === 'yes') {
        const cost = conv2.message.length * botConfig.costPerChar;
        if (user.balance < cost) {
          return msg.reply(botConfig.notEnoughBal(cost, user.balance));
        }
        user.recipients.forEach(r => safeSend(r, conv2.message));
        user.balance -= cost;
        user.messageCount++;
        user.totalCharges += cost;
        saveUsers(users);
        return msg.reply(`✅ Sent! Ksh ${cost.toFixed(2)} deducted. New bal: Ksh ${user.balance.toFixed(2)}`);
      } else {
        return msg.reply("❌ Cancelled.");
      }
    }
    return;
  }

  // Add recipient
  if (lc === '2' || conversations[from]?.stage === 'addRec') {
    if (lc === '2') {
      conversations[from] = { stage: 'addRec' };
      return msg.reply("📥 Enter number to add (e.g., 07xxxxxxxx):");
    }
    const num = formatPhone(txt);
    delete conversations[from];
    if (!num) return msg.reply("⚠️ Invalid number. Try again.");
    if (!user.recipients.includes(num)) {
      user.recipients.push(num);
      saveUsers(users);
      return msg.reply(`✅ ${num.replace('@c.us','')} added.`);
    } else {
      return msg.reply("⚠️ Already in your list.");
    }
  }

  // Remove recipient
  if (lc === '3' || conversations[from]?.stage === 'delRec') {
    if (lc === '3') {
      conversations[from] = { stage: 'delRec' };
      return msg.reply("🗑️ Enter number to remove:");
    }
    const num = formatPhone(txt);
    delete conversations[from];
    if (!num || !user.recipients.includes(num)) {
      return msg.reply("⚠️ That number is not in your list.");
    }
    user.recipients = user.recipients.filter(r => r !== num);
    saveUsers(users);
    return msg.reply(`🗑️ ${num.replace('@c.us','')} removed.`);
  }

  // Default → menu
  return msg.reply(botConfig.userMenu(user));
});

// ────────────────────────────────────────────────────────────────────
// 9) M-PESA STK PUSH & STATUS CHECK
// ────────────────────────────────────────────────────────────────────
async function sendSTKPush(amount, phone) {
  try {
    const res = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      {
        amount,
        phone_number: phone,
        channel_id: botConfig.channelID,
        provider: "m-pesa",
        external_reference: "INV-009",
        customer_name: "FY'S PROPERTY User",
        account_reference: "FY'S PROPERTY",
        transaction_desc: "Top-up",
        remarks: "FY'S PROPERTY",
        business_name: "FY'S PROPERTY",
        companyName: "FY'S PROPERTY"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic YOUR_API_KEY'
        }
      }
    );
    return res.data.reference;
  } catch (err) {
    console.error("STK Push Error:", err.message);
    return null;
  }
}

async function fetchTransactionStatus(ref) {
  try {
    const res = await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      {
        headers: {
          'Authorization': 'Basic YOUR_API_KEY'
        }
      }
    );
    return res.data;
  } catch (err) {
    console.error("Fetch Status Error:", err.
