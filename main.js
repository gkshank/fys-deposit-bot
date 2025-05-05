/*******************************************************************
 * main.js
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express           = require('express');
const qrcodeTerminal    = require('qrcode-terminal');
const QRCode            = require('qrcode');
const axios             = require('axios');
const fs                = require('fs');
const path              = require('path');

// -----------------
// PERSISTENT STORAGE
// -----------------
const DATA_PATH = path.join(__dirname, 'users.json');
function loadUsers() {
  if (fs.existsSync(DATA_PATH)) {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  }
  return {};
}
function saveUsers(users) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(users, null, 2));
}
let users = loadUsers();

// -----------------
// BOT CONFIG & STATE
// -----------------
const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);

let botConfig = {
  fromAdmin:    "Admin GK-FY",
  channelID:    529,
  costPerChar:  0.01,
  welcome:      "👋 Welcome to FY'S PROPERTY! Please register by sending your *phone number*:",
  askName:      "✅ Got your number! Now please reply with your *name*:",
  regSuccess:   name => `🎉 Hi ${name}, registration complete! Your balance is Ksh 0.\n\n${botConfig.userMenu()}`,
  userMenu:     () => (
    "📋 Main Menu:\n" +
    "1. Send Bulk Message\n" +
    "2. Add Recipient\n" +
    "3. Remove Recipient\n" +
    "4. Top-up Balance\n" +
    "5. Check Balance\n" +
    "6. Contact Support\n" +
    "Type 'menu' anytime to see this again."
  ),
  notEnoughBal: (cost,balance) => `⚠️ Cost is Ksh ${cost.toFixed(2)}, but your balance is Ksh ${balance.toFixed(2)}. Please top-up.`,
  topupPrompt:  "💳 Enter amount to top-up (Ksh):",
  closedSupport:"✅ Support ticket closed.\n\n" + (()=>botConfig.userMenu())(),
};

const conversations = {}; // per-user conversational state
const adminSessions = {}; // per-admin menu state

// -----------------
// WHATSAPP CLIENT
// -----------------
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = '';
client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});
client.on('ready', () => {
  console.log('Bot is ready');
  // Notify super-admin on startup
  adminReply(SUPER_ADMIN, "🚀 Bot deployed! Here's the menu:");
  showAdminMenu(SUPER_ADMIN);
});
client.initialize();

// -----------------
// EXPRESS DASHBOARD
// -----------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  let img = '';
  if (currentQR) {
    try { img = await QRCode.toDataURL(currentQR); } catch {}
  }
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
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
app.listen(PORT, () => console.log(`Express running on port ${PORT}`));

// -----------------
// HELPERS
// -----------------
async function safeSend(jid, msg) {
  try {
    await client.sendMessage(jid, msg);
  } catch (e) {
    console.error(`Error sending to ${jid}:`, e.message);
    if (jid !== SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${jid}: ${e.message}`);
    }
  }
}

function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '254' + n.slice(1);
  if (n.length < 12) return null;
  return n + '@c.us';
}

// Append admin navigation
async function adminReply(jid, msg) {
  const suffix = "\n\n0️⃣ Go Back   00️⃣ Main Menu";
  return safeSend(jid, msg + suffix);
}

// -----------------
// ADMIN MENU LOGIC
// -----------------
function showAdminMenu(jid) {
  adminSessions[jid] = { awaiting: 'main' };
  const menu = `${botConfig.fromAdmin}: *Admin Main Menu*
1. View All Users
2. Change Cost/Char (Ksh ${botConfig.costPerChar})
3. Top-up/Deduct User
4. Ban/Unban User
5. Bulk → All Registered
6. Show QR Dashboard Link
7. Config Bot Texts/ChannelID`;
  return adminReply(jid, menu);
}

function showConfigMenu(jid) {
  adminSessions[jid] = { awaiting: 'config' };
  const cfg = `${botConfig.fromAdmin}: *Config Menu*
1. Edit Admin Label
2. Edit Welcome Text
3. Edit Ask-Name Text
4. Edit Reg-Success Template
5. Edit User-Menu Text
6. Edit Not-Enough-Bal Text
7. Edit Topup Prompt
8. Edit costPerChar (Ksh ${botConfig.costPerChar})
9. Edit Channel ID
0. Back`;
  return adminReply(jid, cfg);
}

// -----------------
// MESSAGE HANDLER
// -----------------
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();

  // ignore group chats
  if (from.endsWith('@g.us')) return;

  // 1) SUPPORT CHANNEL
  if (users[from]?.support?.open && !adminUsers.has(from)) {
    // forward to admin
    const t = users[from].support.ticketId;
    await safeSend(SUPER_ADMIN,
      `🎟️ Support #${t} from ${users[from].name}:\n"${txt}"`
    );
    return msg.reply("📥 Sent to support. Type 'close' to finish.");
  }
  if (lc === 'close' && users[from]?.support?.open) {
    users[from].support.open = false;
    saveUsers(users);
    return msg.reply(botConfig.closedSupport);
  }
  if (adminUsers.has(from) && lc.startsWith('reply ')) {
    const parts = txt.split(' ');
    const ticket = parts[1];
    const content = parts.slice(2).join(' ');
    const target = Object.entries(users).find(([jid,u])=>
      u.support.open && u.support.ticketId === ticket
    );
    if (target) {
      const [jid,u] = target;
      await safeSend(jid, `🛎️ Support Reply:\n"${content}"`);
      return adminReply(from, `✅ Replied to ticket ${ticket}.`);
    } else {
      return adminReply(from, `⚠️ No open ticket ${ticket}.`);
    }
  }

  // 2) ADMIN FLOW
  if (adminUsers.has(from)) {
    // back/main
    if (txt === '00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === '0')  { delete adminSessions[from]; return adminReply(from, "🔙 Went back."); }

    const sess = adminSessions[from] || {};

    // MAIN MENU DISPATCH
    if (!sess.awaiting || sess.awaiting === 'main') {
      switch (txt) {
        case '1': adminSessions[from] = { awaiting:'viewUsers' }; return adminReply(from,"👥 Gathering users...");
        case '2': adminSessions[from] = { awaiting:'chgCost'  }; return adminReply(from,"💱 Enter new costPerChar:");
        case '3': adminSessions[from] = { awaiting:'modBal', step:null };return adminReply(from,"💰 Top-up/Deduct: Enter user phone:");
        case '4': adminSessions[from] = { awaiting:'banUser', step:null };return adminReply(from,"🚫 Ban/Unban: Enter user phone:");
        case '5': adminSessions[from] = { awaiting:'bulkAll', step:null };return adminReply(from,"📝 Bulk to all: Enter message:");
        case '6': adminSessions[from] = { awaiting:'showQR' };    return adminReply(from,`🌐 QR Dashboard: http://<your-host>`);
        case '7': return showConfigMenu(from);
        default:  return showAdminMenu(from);
      }
    }

    // SUBMENU HANDLERS
    switch (sess.awaiting) {
      case 'viewUsers': {
        let out = "👥 Registered Users:\n";
        for (let [jid,u] of Object.entries(users)) {
          out += `\n• ${u.name} (${u.phone})\n  Bal: Ksh ${u.balance.toFixed(2)} | Sent: ${u.messageCount} | Charges: Ksh ${u.totalCharges.toFixed(2)}\n  Banned: ${u.banned?`Yes (${u.banReason})`:'No'}\n`;
        }
        delete adminSessions[from];
        return adminReply(from, out);
      }
      case 'chgCost': {
        const k = parseFloat(txt);
        if (isNaN(k)||k<=0) {
          return adminReply(from,"⚠️ Enter valid number:");
        }
        botConfig.costPerChar = k;
        delete adminSessions[from];
        return adminReply(from,`🎉 costPerChar set to Ksh ${k.toFixed(2)}`);
      }
      case 'modBal': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from,"📱 Enter user phone:");
        }
        if (sess.step === 'getUser') {
          const jid = formatPhone(txt);
          if (!jid||!users[jid]) {
            delete adminSessions[from];
            return adminReply(from,"⚠️ User not found.");
          }
          sess.target = jid;
          sess.step = 'getAmt';
          return adminReply(from,"💰 Enter +amount or -amount:");
        }
        if (sess.step === 'getAmt') {
          const amt = parseFloat(txt);
          if (isNaN(amt)) {
            return adminReply(from,"⚠️ Invalid amount:");
          }
          users[sess.target].balance += amt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,
            `✅ ${amt>=0?'Topped-up':'Deducted'} Ksh ${Math.abs(amt).toFixed(2)} for ${users[sess.target].name}.\nNew bal: Ksh ${users[sess.target].balance.toFixed(2)}`
          );
        }
        break;
      }
      case 'banUser': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from,"📱 Enter user phone:");
        }
        if (sess.step === 'getUser') {
          const jid = formatPhone(txt);
          if (!jid||!users[jid]) {
            delete adminSessions[from];
            return adminReply(from,"⚠️ User not found.");
          }
          sess.target = jid;
          if (users[jid].banned) {
            users[jid].banned = false;
            users[jid].banReason = '';
            saveUsers(users);
            delete adminSessions[from];
            return adminReply(from,`✅ ${users[jid].name} is now unbanned.`);
          } else {
            sess.step = 'getReason';
            return adminReply(from,"✏️ Enter ban reason:");
          }
        }
        if (sess.step === 'getReason') {
          users[sess.target].banned = true;
          users[sess.target].banReason = txt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,`🚫 ${users[sess.target].name} banned for: ${txt}`);
        }
        break;
      }
      case 'bulkAll': {
        if (!sess.step) {
          sess.step = 'getMsg';
          return adminReply(from,"📝 Enter message to send to ALL users:");
        }
        if (sess.step === 'getMsg') {
          sess.message = txt;
          sess.step = 'confirm';
          return adminReply(from,
            `📝 Preview:\n"${txt}"\n\n1️⃣ Send  2️⃣ Cancel`
          );
        }
        if (sess.step === 'confirm') {
          if (txt==='1') {
            for (let jid of Object.keys(users)) {
              await safeSend(jid, sess.message);
            }
            delete adminSessions[from];
            return adminReply(from,"🎉 Sent to all users.");
          } else {
            delete adminSessions[from];
            return adminReply(from,"❌ Bulk cancelled.");
          }
        }
        break;
      }
      case 'config': {
        // re-use our earlier config submenu if desired...
        delete adminSessions[from];
        return showConfigMenu(from);
      }
      default:
        delete adminSessions[from];
        return adminReply(from,"⚠️ Unknown option.");
    }
    return;
  }

  // 3) USER REGISTRATION & MENU
  // new user
  if (!users[from]) {
    if (!conversations[from]) {
      conversations[from] = { stage:'awaitPhone' };
      return msg.reply(botConfig.welcome);
    }
    const conv = conversations[from];
    if (conv.stage === 'awaitPhone') {
      const jid = formatPhone(txt);
      if (!jid) {
        delete conversations[from];
        return msg.reply("⚠️ Invalid phone. Please start again.");
      }
      users[from] = {
        phone:     jid.replace('@c.us',''),
        name:      '',
        registeredAt: new Date().toISOString(),
        balance:   0,
        banned:    false,
        banReason: '',
        messageCount:0,
        totalCharges:0,
        recipients: [],
        support:   { open:false, ticketId:null }
      };
      saveUsers(users);
      conv.stage = 'awaitName';
      return msg.reply(botConfig.askName);
    }
    if (conv.stage === 'awaitName') {
      users[from].name = txt;
      saveUsers(users);
      delete conversations[from];
      return msg.reply(botConfig.regSuccess(users[from].name));
    }
    return;
  }

  // registered user
  const user = users[from];
  if (user.banned) {
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }

  // quick 'menu'
  if (lc === 'menu') {
    return msg.reply(botConfig.userMenu());
  }

  // Support entry
  if (lc === '6') {
    if (!user.support.open) {
      user.support.open = true;
      user.support.ticketId = Date.now().toString().slice(-6);
      saveUsers(users);
      return msg.reply(`🆘 Support opened (#${user.support.ticketId}). Please type your message:`);
    }
    return msg.reply("🆘 Send your support message or 'close' to end.");
  }

  // Check balance
  if (lc === '5') {
    return msg.reply(
      `💰 Balance: Ksh ${user.balance.toFixed(2)}\n` +
      `✉️ Messages sent: ${user.messageCount}\n` +
      `💸 Total charges: Ksh ${user.totalCharges.toFixed(2)}`
    );
  }

  // Top-up
  if (lc === '4' || conversations[from]?.stage === 'topupAmt') {
    if (lc === '4') {
      conversations[from] = { stage:'topupAmt' };
      return msg.reply(botConfig.topupPrompt);
    }
    const amt = parseFloat(txt);
    if (isNaN(amt) || amt <= 0) {
      delete conversations[from];
      return msg.reply("⚠️ Invalid amount. Back to menu.");
    }
    const ref = await sendSTKPush(amt, user.phone);
    if (!ref) {
      delete conversations[from];
      return msg.reply("❌ Top-up failed to initiate.");
    }
    msg.reply("⏳ Top-up initiated. Waiting confirmation...");
    setTimeout(async () => {
      const st = await fetchTransactionStatus(ref);
      if (st?.status === 'SUCCESS') {
        user.balance += amt;
        saveUsers(users);
        await client.sendMessage(from, `🎉 Top-up successful! New bal: Ksh ${user.balance.toFixed(2)}`);
      } else {
        await client.sendMessage(from, "❌ Top-up failed or timed out.");
      }
      delete conversations[from];
    }, 20000);
    return;
  }

  // Send bulk message
  if (lc === '1' || conversations[from]?.stage === 'awaitBulk') {
    if (lc === '1') {
      conversations[from] = { stage:'awaitBulk' };
      return msg.reply("✏️ Please type the message to send:");
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
        `📝 Preview:\n"${message}"\nCost: Ksh ${cost.toFixed(2)}\n1️⃣ Send  2️⃣ Cancel`
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
        return msg.reply(`✅ Sent! Ksh ${cost.toFixed(2)} deducted. New bal: Ksh ${user.balance.toFixed(2)}`);
      } else {
        delete conversations[from];
        return msg.reply("❌ Bulk cancelled.");
      }
    }
    return;
  }

  // Add recipient
  if (lc === '2' || conversations[from]?.stage === 'addRec') {
    if (lc === '2') {
      conversations[from] = { stage:'addRec' };
      return msg.reply("📥 Enter recipient phone:");
    }
    const jid = formatPhone(txt);
    delete conversations[from];
    if (!jid) {
      return msg.reply("⚠️ Invalid phone.");
    }
    if (!user.recipients.includes(jid)) {
      user.recipients.push(jid);
      saveUsers(users);
      return msg.reply(`✅ Added recipient ${jid}`);
    } else {
      return msg.reply("⚠️ Already in your list.");
    }
  }

  // Remove recipient
  if (lc === '3' || conversations[from]?.stage === 'delRec') {
    if (lc === '3') {
      conversations[from] = { stage:'delRec' };
      return msg.reply("🗑️ Enter phone to remove:");
    }
    const jid = formatPhone(txt);
    delete conversations[from];
    if (!jid || !user.recipients.includes(jid)) {
      return msg.reply("⚠️ Not in your list.");
    }
    user.recipients = user.recipients.filter(r=>r!==jid);
    saveUsers(users);
    return msg.reply(`🗑️ Removed recipient ${jid}`);
  }

  // Anything else → show menu
  return msg.reply(botConfig.userMenu());
});

// -----------------
// STK & STATUS
// -----------------
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
