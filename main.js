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
  return fs.existsSync(DATA_PATH)
    ? JSON.parse(fs.readFileSync(DATA_PATH))
    : {};
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
  fromAdmin:    "Admin GK-FY",
  channelID:    529,
  costPerChar:  0.01,
  welcomeText:  "👋 *Welcome to FY'S PROPERTY!* To get started, please reply with your *username*.",
  userMenu(user) {
    return (
      `\n✨ Hello ${user.username}! What would you like to do today?\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `7️⃣ Delete My Account\n` +
      `Type 'menu' anytime to see this again.`
    );
  },
  regSuccess(user) {
    return `🎉 Amazing, *${user.username}*! You're now registered with Ksh 0.00 balance.` 
         + this.userMenu(user);
  },
  notEnoughBal(cost,bal) {
    return `⚠️ This message costs Ksh ${cost.toFixed(2)}, but you have only Ksh ${bal.toFixed(2)}. Please top-up first.`;
  },
  topupPrompt:   "💳 How much would you like to top-up? (Enter a number in Ksh)",
  closedSupport: "✅ Your support ticket is now closed. Type 'menu' to continue.",
};

// Per-chat state
const conversations = {};   // { jid: { stage, ... } }
const adminSessions  = {};  // { jid: { awaiting, step, ... } }

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
  adminReply(SUPER_ADMIN, "🤖 Bot deployed and online! Here's your Admin menu:");
  showAdminMenu(SUPER_ADMIN);
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.get('/', async (req,res) => {
  let img = '';
  if (currentQR) {
    try { img = await QRCode.toDataURL(currentQR); } catch {}
  }
  res.send(`
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FY'S PROPERTY Bot QR</title>
<style>
  html,body{height:100%;margin:0;display:flex;justify-content:center;align-items:center;
    background:url('https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d')center/cover;}
  .glass{background:rgba(255,255,255,0.2);backdrop-filter:blur(10px);
    padding:2rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);
    text-align:center;font-family:Arial,sans-serif;max-width:320px;width:90%;}
  .glass h1{color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.5);}
  .qr-box img{width:100%;max-width:250px;}
  .footer{margin-top:1rem;color:#eee;font-size:0.9rem;}
</style>
</head><body>
  <div class="glass">
    <h1>Scan to Connect</h1>
    <div class="qr-box">
      ${ img ? `<img src="${img}">` : '<p style="color:#fff;">Waiting for QR…</p>' }
    </div>
    <div class="footer">Created By FY'S PROPERTY</div>
  </div>
</body></html>`);
});
app.listen(PORT, ()=>console.log(`🌐 QR Dashboard at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid, msg) {
  try {
    await client.sendMessage(jid, msg);
  } catch (err) {
    console.error(`Error sending to ${jid}:`, err.message);
    if (jid !== SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${jid}: ${err.message}`);
    }
  }
}
async function adminReply(jid, msg) {
  const suffix = "\n\n0️⃣ Go Back   00️⃣ Main Menu";
  return safeSend(jid, msg + suffix);
}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN PANEL
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid) {
  adminSessions[jid] = { awaiting: 'main' };
  const menu = `${botConfig.fromAdmin}: *Admin Main Menu*
1. View All Users
2. Change Cost/Char (Ksh ${botConfig.costPerChar.toFixed(2)})
3. Top-up/Deduct User
4. Ban/Unban User
5. Bulk → All Registered
6. Show QR Dashboard
7. Config Bot Texts/ChannelID`;
  return adminReply(jid, menu);
}

function showConfigMenu(jid) {
  adminSessions[jid] = { awaiting: 'config' };
  const cfg = `${botConfig.fromAdmin}: *Config Menu*
1. Edit Admin Label
2. Edit Welcome Text
3. Edit User Menu Text
4. Edit costPerChar
0. Back`;
  return adminReply(jid, cfg);
}

// ────────────────────────────────────────────────────────────────────
// 7) MAIN MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();
  if (from.endsWith('@g.us')) return; // ignore groups

  // 7.1) SUPPORT TICKETS
  if (users[from]?.support?.open && !adminUsers.has(from)) {
    const t = users[from].support.ticketId;
    await safeSend(SUPER_ADMIN, `🎟 #${t} from ${users[from].username}:\n"${txt}"`);
    return msg.reply("📥 Sent to support. Type 'tktClose' to finish.");
  }
  if (lc === 'tktclose' && users[from]?.support?.open) {
    users[from].support.open = false;
    saveUsers(users);
    return msg.reply(botConfig.closedSupport);
  }
  if (adminUsers.has(from) && lc.startsWith('reply ')) {
    const [_, ticket, ...rest] = txt.split(' ');
    const content = rest.join(' ');
    const target = Object.entries(users).find(([jid,u]) =>
      u.support.open && u.support.ticketId === ticket
    );
    if (target) {
      const [jid,u] = target;
      await safeSend(jid, `🛎 Support Reply:\n"${content}"`);
      return adminReply(from, `✅ Replied to ticket ${ticket}.`);
    } else {
      return adminReply(from, `⚠️ No open ticket ${ticket}.`);
    }
  }

  // 7.2) ADMIN FLOWS
  if (adminUsers.has(from)) {
    // Global back/menu
    if (txt === '00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === '0')  { delete adminSessions[from]; return adminReply(from, "🔙 Back"); }

    const sess = adminSessions[from] || {};

    // Main dispatch
    if (!sess.awaiting || sess.awaiting === 'main') {
      switch(txt) {
        case '1': sess.awaiting='viewUsers';   return adminReply(from, "👥 Fetching users...");
        case '2': sess.awaiting='chgCost';     return adminReply(from, "💱 Enter new costPerChar:");
        case '3': sess.awaiting='modBal'; sess.step=null; return adminReply(from, "💰 Enter user phone:");
        case '4': sess.awaiting='banUser'; sess.step=null; return adminReply(from, "🚫 Enter user phone:");
        case '5': sess.awaiting='bulkAll'; sess.step=null; return adminReply(from, "📝 Bulk → All Registered");
        case '6': sess.awaiting='showQR';      return adminReply(from, `🌐 http://localhost:${PORT}`);
        case '7': return showConfigMenu(from);
        default:  return showAdminMenu(from);
      }
    }

    // Sub-handlers
    switch(sess.awaiting) {
      // View All Users
      case 'viewUsers': {
        let out = "👥 Registered Users:\n";
        for (let [jid,u] of Object.entries(users)) {
          out += `\n• ${u.username} (${u.phone})\n  Bal: Ksh ${u.balance.toFixed(2)} | Sent: ${u.messageCount} | Charges: Ksh ${u.totalCharges.toFixed(2)}\n`;
        }
        delete adminSessions[from];
        return adminReply(from, out);
      }

      // Change costPerChar
      case 'chgCost': {
        const k = parseFloat(txt);
        if (isNaN(k) || k <= 0) {
          return adminReply(from, "⚠️ Please enter a valid number:");
        }
        botConfig.costPerChar = k;
        delete adminSessions[from];
        return adminReply(from, `🎉 costPerChar updated to Ksh ${k.toFixed(2)}`);
      }

      // Top-up/Deduct User
      case 'modBal': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from, "📱 Enter user phone:");
        }
        if (sess.step === 'getUser') {
          const jid = formatPhone(txt);
          if (!jid || !users[jid]) {
            delete adminSessions[from];
            return adminReply(from, "⚠️ User not found.");
          }
          sess.target = jid;
          sess.step   = 'getAmt';
          return adminReply(from, "💰 Enter +amount or -amount:");
        }
        if (sess.step === 'getAmt') {
          const amt = parseFloat(txt);
          if (isNaN(amt)) {
            return adminReply(from, "⚠️ Invalid amount. Try again:");
          }
          users[sess.target].balance += amt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,
            `✅ ${amt>=0?'Topped-up':'Deducted'} Ksh ${Math.abs(amt).toFixed(2)} for ${users[sess.target].username}`
          );
        }
        break;
      }

      // Ban/Unban User
      case 'banUser': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from, "📱 Enter user phone:");
        }
        if (sess.step === 'getUser') {
          const jid = formatPhone(txt);
          if (!jid || !users[jid]) {
            delete adminSessions[from];
            return adminReply(from, "⚠️ User not found.");
          }
          sess.target = jid;
          if (users[jid].banned) {
            users[jid].banned = false;
            saveUsers(users);
            delete adminSessions[from];
            return adminReply(from, `✅ ${users[jid].username} is now unbanned.`);
          } else {
            sess.step = 'getReason';
            return adminReply(from, "✏️ Enter ban reason:");
          }
        }
        if (sess.step === 'getReason') {
          users[sess.target].banned = true;
          users[sess.target].banReason = txt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from, `🚫 ${users[sess.target].username} banned: ${txt}`);
        }
        break;
      }

      // Bulk → All Registered (yes/no)
      case 'bulkAll': {
        if (!sess.step) {
          sess.step = 'getMsg';
          return adminReply(from, "📝 Enter message for ALL users:");
        }
        if (sess.step === 'getMsg') {
          sess.message = txt;
          sess.step    = 'confirm';
          return adminReply(from,
            `📝 Preview:\n"${txt}"\n\nPlease reply *yes* or *no*.`
          );
        }
        if (sess.step === 'confirm') {
          if (lc === 'yes') {
            for (let jid of Object.keys(users)) {
              await safeSend(jid, sess.message);
            }
            delete adminSessions[from];
            return adminReply(from, "🎉 Sent to all users!");
          } else {
            delete adminSessions[from];
            return adminReply(from, "❌ Bulk cancelled.");
          }
        }
        break;
      }

      // Show QR
      case 'showQR':
        delete adminSessions[from];
        return adminReply(from, `🌐 http://localhost:${PORT}`);

      // Config submenu
      case 'config':
        if (!sess.step) {
          switch(txt) {
            case '1': sess.step='editAdmin';   return adminReply(from,"✏️ Enter new Admin Label:");
            case '2': sess.step='editWelcome'; return adminReply(from,"✏️ Enter new Welcome Text:");
            case '3': sess.step='editUserMenu';return adminReply(from,"✏️ Enter new User Menu Text (use {username}):");
            case '4': sess.step='editCost';    return adminReply(from,"✏️ Enter new costPerChar:");
            case '0': delete adminSessions[from]; return showAdminMenu(from);
            default:  return adminReply(from,"⚠️ Invalid option.");
          }
        } else {
          switch(sess.step) {
            case 'editAdmin':    botConfig.fromAdmin   = txt; break;
            case 'editWelcome':  botConfig.welcomeText = txt; break;
            case 'editUserMenu': botConfig.userMenu    = u=> txt.replace('{username}',u.username); break;
            case 'editCost':     botConfig.costPerChar = parseFloat(txt) || botConfig.costPerChar; break;
          }
          delete adminSessions[from];
          return adminReply(from, "✅ Configuration updated.");
        }

      default:
        delete adminSessions[from];
        return adminReply(from, "⚠️ Returning to main menu.");
    }
  }

  // 7.3) USER REGISTRATION (username only)
  if (!users[from]) {
    if (!conversations[from]) {
      conversations[from] = { stage: 'awaitUsername' };
      return msg.reply(botConfig.welcomeText);
    }
    const conv = conversations[from];
    if (conv.stage === 'awaitUsername') {
      const uname = txt;
      users[from] = {
        username: uname,
        phone:    from.replace('@c.us',''),
        registeredAt: new Date().toISOString(),
        balance: 0,
        banned: false,
        messageCount: 0,
        totalCharges: 0,
        recipients: [],
        support: { open: false, ticketId: null }
      };
      saveUsers(users);
      await safeSend(SUPER_ADMIN,
        `🆕 *New Registration*\n• Username: ${uname}\n• Phone: ${users[from].phone}`
      );
      delete conversations[from];
      return msg.reply(botConfig.regSuccess(users[from]));
    }
    return;
  }

  // 7.4) REGISTERED USER MAIN FLOW
  const user = users[from];
  if (user.banned) {
    return msg.reply(`🚫 You are banned.`);
  }
  if (lc === 'menu') {
    return msg.reply(botConfig.userMenu(user));
  }
  if (lc === '7' || lc === 'delete my account') {
    delete users[from];
    saveUsers(users);
    return msg.reply("❌ Account deleted. Send any message to re-register.");
  }

  // Contact Support
  if (lc === '6') {
    if (!user.support.open) {
      user.support.open    = true;
      user.support.ticketId = Date.now().toString().slice(-6);
      saveUsers(users);
      return msg.reply(`🆘 Support opened (#${user.support.ticketId}). Type your message:`);
    }
    return msg.reply("🆘 Type your support message or 'tktClose' to end.");
  }

  // Check Balance
  if (lc === '5') {
    return msg.reply(
      `💰 Balance: Ksh ${user.balance.toFixed(2)}\n` +
      `✉️ Sent: ${user.messageCount}\n` +
      `💸 Charges: Ksh ${user.totalCharges.toFixed(2)}`
    );
  }

  // USER TOP-UP FLOW (unchanged)...
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
        return msg.reply("⚠️ Minimum top-up is Ksh 11. Please type *4* to try again.");
      }
      conv.amount = amt;
      conv.stage  = 'topup:phone';
      conversations[from] = conv;
      return msg.reply(`📱 Send the M-PESA phone number to charge Ksh ${amt.toFixed(2)}:`);
    }
    if (conv.stage === 'topup:phone') {
      const mp   = formatPhone(txt);
      const amt  = conv.amount;
      delete conversations[from];
      if (!mp) return msg.reply("⚠️ Invalid phone. Type *4* to restart.");
      await msg.reply(`⏳ Initiating Ksh ${amt.toFixed(2)} top-up…`);
      const ref = await sendSTKPush(amt, mp.replace('@c.us',''));
      if (!ref) return msg.reply("❌ STK push failed. Try again.");
      setTimeout(() => safeSend(from, "⏳ 20s left…"), 10000);
      setTimeout(() => safeSend(from, "⏳ 10s left…"), 20000);
      return setTimeout(async () => {
        const status = await fetchTransactionStatus(ref);
        const ok     = status?.status === 'SUCCESS';
        const code   = status?.provider_reference || '—';
        const now    = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
        if (ok) {
          user.balance += amt;
          saveUsers(users);
          await safeSend(from,
            `🎉 Top-up Successful!\n• Amount: Ksh ${amt.toFixed(2)}\n• Mpesa Code: ${code}\n• New Balance: Ksh ${user.balance.toFixed(2)}`
          );
          await safeSend(SUPER_ADMIN,
            `💰 Deposit Success\n• User: ${user.username}\n• Phone: ${mp.replace('@c.us','')}\n• Amount: Ksh ${amt.toFixed(2)}\n• Code: ${code}\n• Time: ${now}`
          );
        } else {
          await safeSend(from, "❌ Top-up failed. Please try again.");
        }
      }, 30000);
    }
  }

  // 1️⃣ Send Bulk Message (yes/no)
  if (lc === '1' || conversations[from]?.stage === 'awaitBulk') {
    if (lc === '1') {
      conversations[from] = { stage:'awaitBulk' };
      return msg.reply("✏️ Type the message you want to send:");
    }
    if (conversations[from].stage === 'awaitBulk') {
      const message = txt;
      delete conversations[from];
      const cost = message.length * botConfig.costPerChar;
      if (user.balance < cost) {
        return msg.reply(botConfig.notEnoughBal(cost, user.balance));
      }
      conversations[from] = { stage:'confirmBulk', message, cost };
      return msg.reply(
        `📝 Preview:\n"${message}"\nCost: Ksh ${cost.toFixed(2)}\n\nReply *yes* to send or *no* to cancel.`
      );
    }
    if (conversations[from].stage === 'confirmBulk') {
      if (lc === 'yes') {
        const { message, cost } = conversations[from];
        delete conversations[from];
        for (let r of user.recipients) {
          await safeSend(r, message);
        }
        user.balance      -= cost;
        user.messageCount += 1;
        user.totalCharges += cost;
        saveUsers(users);
        return msg.reply(`✅ Sent! Ksh ${cost.toFixed(2)} deducted. New bal: Ksh ${user.balance.toFixed(2)}`);
      } else {
        delete conversations[from];
        return msg.reply("❌ Bulk cancelled.");
      }
    }
    return;
  }

  // 2) Add Recipient
  if (lc === '2' || conversations[from]?.stage === 'addRec') {
    if (lc === '2') {
      conversations[from] = { stage:'addRec' };
      return msg.reply("📥 Enter recipient phone number:");
    }
    const jid = formatPhone(txt);
    delete conversations[from];
    if (!jid) return msg.reply("⚠️ Invalid phone number.");
    if (!user.recipients.includes(jid)) {
      user.recipients.push(jid);
      saveUsers(users);
      return msg.reply(`✅ Recipient ${jid} added.`);
    } else {
      return msg.reply("⚠️ Already in your list.");
    }
  }

  // 3) Remove Recipient
  if (lc === '3' || conversations[from]?.stage === 'delRec') {
    if (lc === '3') {
      conversations[from] = { stage:'delRec' };
      return msg.reply("🗑️ Enter recipient phone number to remove:");
    }
    const jid = formatPhone(txt);
    delete conversations[from];
    if (!jid || !user.recipients.includes(jid)) {
      return msg.reply("⚠️ That number is not in your list.");
    }
    user.recipients = user.recipients.filter(r => r !== jid);
    saveUsers(users);
    return msg.reply(`🗑️ Recipient ${jid} removed.`);
  }

  // Default → show menu
  return msg.reply(botConfig.userMenu(user));
});

// ────────────────────────────────────────────────────────────────────
// 8) M-PESA STK PUSH & STATUS CHECK
// ────────────────────────────────────────────────────────────────────
async function sendSTKPush(amount, phone) {
  const payload = {
    amount,
    phone_number:        phone,
    channel_id:          botConfig.channelID,
    provider:            "m-pesa",
    external_reference:  "INV-009",
    customer_name:       "FY'S PROPERTY User",
    callback_url:        "https://your-callback-url",
    account_reference:   "FY'S PROPERTY",
    transaction_desc:    "FY'S PROPERTY Payment",
    remarks:             "FY'S PROPERTY",
    business_name:       "FY'S PROPERTY",
    companyName:         "FY'S PROPERTY"
  };
  try {
    const res = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      { headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
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
      { headers: {
          'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
        }
      }
    );
    return res.data;
  } catch (err) {
    console.error("Fetch Status Error:", err.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Utility: formatPhone
// ────────────────────────────────────────────────────────────────────
function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if (n.length === 9 && n.startsWith('7'))       n = '254' + n;
  if (n.length === 10 && n.startsWith('0'))
