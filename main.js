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
  fromAdmin:    "Admin GK-FY",
  channelID:    529,
  costPerChar:  0.01,
  welcomeText:  "👋 *Welcome to FY'S PROPERTY!* To get started, please register by sending your *phone number* (e.g., 0712345678).",
  askNameText:  "✅ Great! Now reply with your *name* so I can personalize your experience:",
  userMenu(user) {
    const name = user && user.name ? user.name : '';
    return (
      `\n✨ Hello ${name}! What would you like to do today?\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `Type 'menu' anytime to see this again.`
    );
  },
  regSuccess(name) {
    return `🎉 Amazing, *${name}*! You're now registered. Your balance is *Ksh 0.00*.` + this.userMenu({ name });
  },
  notEnoughBal(cost,bal) {
    return `⚠️ The message will cost *Ksh ${cost.toFixed(2)}*, but you only have *Ksh ${bal.toFixed(2)}*. Please top-up first.`;
  },
  topupPrompt:    "💳 How much would you like to top-up? (Enter a number in Ksh)",
  closedSupport:  "✅ Your support ticket is now closed. Feel free to type 'menu' for options.",
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
  adminReply(SUPER_ADMIN, "🤖 Bot deployed and online! Here's your Admin menu:");
  showAdminMenu(SUPER_ADMIN);
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS QR DASHBOARD (GLASS-STYLE)
// ────────────────────────────────────────────────────────────────────
const app = express();
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
      ${img ? `<img src="${img}">` : '<p style="color:#fff;">Waiting for QR…</p>'}
    </div>
    <div class="footer">Created By FY'S PROPERTY</div>
  </div>
</body></html>
`);
});
app.listen(PORT, ()=>console.log(`🌐 QR Dashboard running at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid,message) {
  try {
    await client.sendMessage(jid, message);
  } catch(err) {
    console.error(`❌ Error sending to ${jid}:`, err.message);
    if (jid !== SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${jid}: ${err.message}`);
    }
  }
}
function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if (n.startsWith('0')) n = '254' + n.slice(1);
  return n.length >= 12 ? n + '@c.us' : null;
}
async function adminReply(jid, msg) {
  const suffix = "\n\n0️⃣ Go Back   00️⃣ Main Menu";
  return safeSend(jid, msg + suffix);
}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN PANEL: MENUS & HANDLERS
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
3. Edit Ask-Name Text
4. Edit Registration Success Text
5. Edit User Menu Text
6. Edit Not-Enough-Balance Text
7. Edit Top-up Prompt
8. Edit costPerChar
9. Edit Channel ID
0. Back`;
  return adminReply(jid, cfg);
}

// ────────────────────────────────────────────────────────────────────
// 7) MESSAGE HANDLER (USER + ADMIN + SUPPORT)
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();
  if (from.endsWith('@g.us')) return; // ignore groups

  // 7.1) SUPPORT TICKETS
  if (users[from]?.support?.open && !adminUsers.has(from)) {
    const t = users[from].support.ticketId;
    await safeSend(SUPER_ADMIN, `🎟 #${t} from ${users[from].name}:\n"${txt}"`);
    return msg.reply("📥 Your message has been sent to support. Type 'close' to finish.");
  }
  if (lc === 'close' && users[from]?.support?.open) {
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

  // 7.2) ADMIN FLOW
  if (adminUsers.has(from)) {
    if (txt === '00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === '0')  { delete adminSessions[from]; return adminReply(from, "🔙 Going back."); }

    const sess = adminSessions[from] || {};

    // Main dispatch
    if (!sess.awaiting || sess.awaiting === 'main') {
      switch(txt) {
        case '1': sess.awaiting='viewUsers';   return adminReply(from, "👥 Fetching all users...");
        case '2': sess.awaiting='chgCost';     return adminReply(from, "💱 Enter new costPerChar:");
        case '3': sess.awaiting='modBal'; sess.step=null; return adminReply(from, "💰 Enter user phone to modify balance:");
        case '4': sess.awaiting='banUser'; sess.step=null; return adminReply(from, "🚫 Enter user phone to ban/unban:");
        case '5': sess.awaiting='bulkAll'; sess.step=null; return adminReply(from, "📝 Enter message for ALL users:");
        case '6': sess.awaiting='showQR';      return adminReply(from, `🌐 Dashboard: http://localhost:${PORT}`);
        case '7': return showConfigMenu(from);
        default:  return showAdminMenu(from);
      }
    }

    // Submenu handlers
    switch(sess.awaiting) {
      // 1) View All Users
      case 'viewUsers': {
        let out = "👥 Registered Users:\n";
        for (let [jid,u] of Object.entries(users)) {
          out += `\n• ${u.name} (${u.phone})\n  Bal: Ksh ${u.balance.toFixed(2)} | Sent: ${u.messageCount} | Charges: Ksh ${u.totalCharges.toFixed(2)}\n  Banned: ${u.banned ? `Yes (${u.banReason})` : 'No'}\n`;
        }
        delete adminSessions[from];
        return adminReply(from, out);
      }
      // 2) Change costPerChar
      case 'chgCost': {
        const k = parseFloat(txt);
        if (isNaN(k) || k <= 0) {
          return adminReply(from, "⚠️ Please enter a valid number:");
        }
        botConfig.costPerChar = k;
        delete adminSessions[from];
        return adminReply(from, `🎉 costPerChar updated to Ksh ${k.toFixed(2)}`);
      }
      // 3) Top-up/Deduct User
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
          sess.step = 'getAmt';
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
            `✅ ${amt>=0?'Topped-up':'Deducted'} Ksh ${Math.abs(amt).toFixed(2)} for ${users[sess.target].name}\nNew Balance: Ksh ${users[sess.target].balance.toFixed(2)}`
          );
        }
        break;
      }
      // 4) Ban/Unban User
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
            users[jid].banReason = '';
            saveUsers(users);
            delete adminSessions[from];
            return adminReply(from, `✅ ${users[jid].name} is now unbanned.`);
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
          return adminReply(from, `🚫 ${users[sess.target].name} banned because: ${txt}`);
        }
        break;
      }
      // 5) Bulk → All Registered
      case 'bulkAll': {
        if (!sess.step) {
          sess.step = 'getMsg';
          return adminReply(from, "📝 Enter message to send to ALL users:");
        }
        if (sess.step === 'getMsg') {
          sess.message = txt;
          sess.step = 'confirm';
          return adminReply(from,
            `📝 Preview:\n"${txt}"\n\n1️⃣ Send  2️⃣ Cancel`
          );
        }
        if (sess.step === 'confirm') {
          if (txt === '1') {
            for (let jid of Object.keys(users)) {
              await safeSend(jid, sess.message);
            }
            delete adminSessions[from];
            return adminReply(from, "🎉 Message sent to all users!");
          } else {
            delete adminSessions[from];
            return adminReply(from, "❌ Bulk cancelled.");
          }
        }
        break;
      }
      // 6) Show QR Dashboard
      case 'showQR':
        delete adminSessions[from];
        return adminReply(from, `🌐 Scan QR at http://localhost:${PORT}`);
      // 7) Config submenu
      case 'config':
        delete adminSessions[from];
        return showConfigMenu(from);
      default:
        delete adminSessions[from];
        return adminReply(from, "⚠️ Unknown option, returning to main menu.");
    }
    return;
  }

  // ────────────────────────────────────────────────────────────────────
// 7.3) USER REGISTRATION FLOW (Fixed)
// ────────────────────────────────────────────────────────────────────
if (!users[from]) {
  if (!conversations[from]) {
    // Step 1: ask for phone
    conversations[from] = { stage: 'awaitPhone' };
    return msg.reply(botConfig.welcomeText);
  }

  const conv = conversations[from];

  if (conv.stage === 'awaitPhone') {
    // User sent their phone
    const jid = formatPhone(txt);
    if (!jid) {
      delete conversations[from];
      return msg.reply("⚠️ That doesn't look like a phone number. Please start again.");
    }
    users[from] = {
      phone: jid.replace('@c.us',''),
      name: '',
      registeredAt: new Date().toISOString(),
      balance: 0,
      banned: false,
      banReason: '',
      messageCount: 0,
      totalCharges: 0,
      recipients: [],
      support: { open: false, ticketId: null }
    };
    saveUsers(users);

    // Move to asking name
    conversations[from].stage = 'awaitName';
    return msg.reply(botConfig.askNameText);
  }

  if (conv.stage === 'awaitName') {
    // User sent their name
    users[from].name = txt;
    saveUsers(users);

    // Notify super‐admin of new registration
    await safeSend(SUPER_ADMIN,
      `🆕 *New Registration*\n• Name: ${users[from].name}\n• Phone: ${users[from].phone}`
    );

    // Clean up and send success to user
    delete conversations[from];
    return msg.reply(botConfig.regSuccess(users[from].name));
  }

  // If somehow still in registration, stop here
  return;
}

  // 7.4) REGISTERED USER MAIN FLOW
  const user = users[from];
  if (user.banned) {
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }

  // Quick menu
  if (lc === 'menu') {
    return msg.reply(botConfig.userMenu(user));
  }

  // 6) Contact Support
  if (lc === '6') {
    if (!user.support.open) {
      user.support.open = true;
      user.support.ticketId = Date.now().toString().slice(-6);
      saveUsers(users);
      return msg.reply(`🆘 Support opened (#${user.support.ticketId}). Type your message:`);
    }
    return msg.reply("🆘 Send your support message or type 'close' to end.");
  }

  // 5) Check Balance
  if (lc === '5') {
    return msg.reply(
      `💰 Your balance: Ksh ${user.balance.toFixed(2)}\n` +
      `✉️ Messages sent: ${user.messageCount}\n` +
      `💸 Total charges: Ksh ${user.totalCharges.toFixed(2)}`
    );
  }

  // 4) Top-up Balance
  if (lc === '4' || conversations[from]?.stage === 'topupAmt') {
    if (lc === '4') {
      conversations[from] = { stage:'topupAmt' };
      return msg.reply(botConfig.topupPrompt);
    }
    const amt = parseFloat(txt);
    if (isNaN(amt) || amt <= 0) {
      delete conversations[from];
      return msg.reply("⚠️ Please enter a valid amount.");
    }
    const ref = await sendSTKPush(amt, user.phone);
    if (!ref) {
      delete conversations[from];
      return msg.reply("❌ Could not initiate top-up. Try again later.");
    }
    msg.reply("⏳ Top-up in progress… please wait a moment.");
    setTimeout(async () => {
      const st = await fetchTransactionStatus(ref);
      if (st?.status === 'SUCCESS') {
        user.balance += amt;
        saveUsers(users);
        await client.sendMessage(from, `🎉 Top-up successful! New balance: Ksh ${user.balance.toFixed(2)}`);
      } else {
        await client.sendMessage(from, "❌ Top-up failed or timed out. Please try again.");
      }
      delete conversations[from];
    }, 20000);
    return;
  }

  // 1) Send Bulk Message
  if (lc === '1' || conversations[from]?.stage === 'awaitBulk') {
    if (lc === '1') {
      conversations[from] = { stage:'awaitBulk' };
      return msg.reply("✏️ Please type the message you want to send:");
    }
    if (conversations[from].stage === 'awaitBulk') {
      const message = txt;
      delete conversations[from];
      const cost = message.length * botConfig.costPerChar;
      if (user.balance < cost) {
        return msg.reply(botConfig.notEnoughBal(cost, user.balance));
      }
      conversations[from] = { stage:'confirmBulk', message };
      return msg.reply(
        `📝 Preview:\n"${message}"\nCost: Ksh ${cost.toFixed(2)}\n1️⃣ Confirm Send  2️⃣ Cancel`
      );
    }
    if (conversations[from].stage === 'confirmBulk') {
      if (txt === '1') {
        const message = conversations[from].message;
        delete conversations[from];
        const cost = message.length * botConfig.costPerChar;
        for (let r of user.recipients) {
          await safeSend(r, message);
        }
        user.balance      -= cost;
        user.messageCount += 1;
        user.totalCharges += cost;
        saveUsers(users);
        return msg.reply(`✅ Message sent! Ksh ${cost.toFixed(2)} deducted. New bal: Ksh ${user.balance.toFixed(2)}`);
      } else {
        delete conversations[from];
        return msg.reply("❌ Bulk send cancelled.");
      }
    }
    return;
  }

  // 2) Add Recipient
  if (lc === '2' || conversations[from]?.stage === 'addRec') {
    if (lc === '2') {
      conversations[from] = { stage:'addRec' };
      return msg.reply("📥 Enter the phone number of the recipient to add:");
    }
    const jid = formatPhone(txt);
    delete conversations[from];
    if (!jid) {
      return msg.reply("⚠️ Invalid phone number. Try again.");
    }
    if (!user.recipients.includes(jid)) {
      user.recipients.push(jid);
      saveUsers(users);
      return msg.reply(`✅ Recipient ${jid} added to your list.`);
    } else {
      return msg.reply("⚠️ This recipient is already in your list.");
    }
  }

  // 3) Remove Recipient
  if (lc === '3' || conversations[from]?.stage === 'delRec') {
    if (lc === '3') {
      conversations[from] = { stage:'delRec' };
      return msg.reply("🗑️ Enter the phone number of the recipient to remove:");
    }
    const jid = formatPhone(txt);
    delete conversations[from];
    if (!jid || !user.recipients.includes(jid)) {
      return msg.reply("⚠️ That number is not in your recipient list.");
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
    amount, phone_number: phone,
    channel_id: botConfig.channelID,
    provider: "m-pesa",
    external_reference: "INV-009",
    customer_name: "FY'S PROPERTY User",
    callback_url: "https://your-callback-url",
    account_reference: "FY'S PROPERTY",
    transaction_desc: "FY'S PROPERTY Payment",
    remarks: "FY'S PROPERTY",
    business_name: "FY'S PROPERTY",
    companyName: "FY'S PROPERTY"
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
