// main.js
/*******************************************************************
 * FY'S PROPERTY WhatsApp Deposit Bot + Express Dashboard
 * - Filename preserved as main.js
 * - Full original bot logic intact
 * - Tailwind/FontAwesome HTML dashboard embedded
 * - QR scan, Recent Transactions, Restart Bot
 *******************************************************************/

// ──────────────────────────────────────────────────────────────────
// IMPORTS & CONFIGURATION
// ──────────────────────────────────────────────────────────────────
const { Client, LocalAuth } = require('whatsapp-web.js');
const express           = require('express');
const qrcodeTerminal    = require('qrcode-terminal');
const QRCode            = require('qrcode');
const axios             = require('axios');

const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);

let botConfig = {
  fromAdmin:        "Admin GK-FY",
  channelID:        529,
  welcomeMessage:   "👋 *Welcome to FY'S PROPERTY Deposit Bot!* How much would you like to deposit? 💰",
  depositChosen:    "👍 *Great!* You've chosen to deposit Ksh {amount}. Now, please provide your deposit number (e.g., your account number) 📱",
  paymentInitiated: "⏳ *Payment initiated!* We'll check status in {seconds} seconds... Stay tuned!",
  countdownUpdate:  "⏳ {seconds} seconds left... Fetching status soon!",
  paymentSuccess:   "🎉 *Payment Successful!*\n• *Amount:* Ksh {amount}\n• *Deposit #:* {depositNumber}\n• *MPESA Code:* {mpesaCode}\n• *Date/Time:* {date}\n\n{footer}",
  paymentFooter:    "Thank you for choosing FY'S PROPERTY! Type *Start* to deposit again."
};

let currentQR = "";
const conversations   = {};
const adminSessions   = {};
const savedUsers      = new Set();
const savedGroups     = new Set();
const depositAttempts = [];  // { amount, from, time, status }

// ──────────────────────────────────────────────────────────────────
// WHATSAPP CLIENT
// ──────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('Bot is ready');
  adminReply(SUPER_ADMIN, "🎉 Bot is now *online* and ready for action!");
  showAdminMenu(SUPER_ADMIN);
});

// ──────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────
function showAdminMenu(to) {
  const menu = `${botConfig.fromAdmin}: *Main Menu*
1. Add User   2. View Users   3. Delete User
4. Add Group  5. View Groups  6. Delete Group
7. Bulk → Users   8. Bulk → Groups   9. Bulk → All
10. Config Bot Texts   11. Add Admin   12. Remove Admin`;
  adminReply(to, menu);
}

function formatPhoneNumber(input) {
  let num = input.replace(/[^\d]/g, '');
  if (num.startsWith('0')) num = '254' + num.slice(1);
  if (!num.startsWith('254') || num.length < 12) return null;
  return num + '@c.us';
}

function parsePlaceholders(tpl, data) {
  return tpl
    .replace(/{amount}/g, data.amount || '')
    .replace(/{depositNumber}/g, data.depositNumber || '')
    .replace(/{seconds}/g, data.seconds || '')
    .replace(/{mpesaCode}/g, data.mpesaCode || '')
    .replace(/{date}/g, data.date || '')
    .replace(/{footer}/g, botConfig.paymentFooter);
}

async function safeSend(to, msg) {
  try {
    await client.sendMessage(to, msg);
  } catch (e) {
    console.error(`Error→${to}:`, e.message);
    if (to !== SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${to}:\n${e.message}`);
    }
  }
}

function adminReply(to, msg) {
  const suffix = `\n\n0️⃣ Go Back 🔙\n00️⃣ Main Menu`;
  return safeSend(to, msg + suffix);
}

async function sendSTKPush(amount, phone) {
  const payload = {
    amount,
    phone_number: phone,
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
      {
        headers: {
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
      {
        headers: {
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

// ──────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ──────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();

  if (from.endsWith('@g.us')) return;

  // ── ADMIN FLOW ─────────────────────────────────────────────
  if (adminUsers.has(from)) {
    const sess = adminSessions[from] || {};

    if (txt === '00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === '0')  { delete adminSessions[from]; return adminReply(from, "🔙 Went back!"); }

    if (sess.awaiting === 'configMenu') {
      switch (txt) {
        case '1': sess.awaiting = 'edit:fromAdmin';   return adminReply(from,"✏️ Enter new *Admin label*:");
        case '2': sess.awaiting = 'edit:welcomeMessage'; return adminReply(from,"✏️ Enter new *Welcome Message*:");
        case '3': sess.awaiting = 'edit:depositChosen';  return adminReply(from,"✏️ Enter new *Deposit Prompt*:");
        case '4': sess.awaiting = 'edit:paymentInitiated'; return adminReply(from,"✏️ Enter new *Payment Initiated*:");
        case '5': sess.awaiting = 'edit:countdownUpdate'; return adminReply(from,"✏️ Enter new *Countdown Update*:");
        case '6': sess.awaiting = 'edit:paymentSuccess';   return adminReply(from,"✏️ Enter new *Payment Success*:");
        case '7': sess.awaiting = 'edit:paymentFooter';    return adminReply(from,"✏️ Enter new *Payment Footer*:");
        case '8': sess.awaiting = 'edit:channelID';        return adminReply(from,"✏️ Enter new *Channel ID*:");
        default:  return adminReply(from,"❌ Invalid, choose 1–8!");
      }
    }
    if (sess.awaiting?.startsWith('edit:')) {
      const key = sess.awaiting.split(':')[1];
      let val = txt;
      if (key === 'channelID') {
        const n = parseInt(txt);
        if (isNaN(n)) return adminReply(from,"⚠️ Must be number!");
        val = n;
      }
      botConfig[key] = val;
      delete adminSessions[from];
      return adminReply(from, `🎉 Updated *${key}*:\n${val}`);
    }

    if (sess.awaiting === 'addUser') {
      const j = formatPhoneNumber(txt);
      if (!j) return adminReply(from,"⚠️ Invalid phone. Retry:");
      savedUsers.add(j);
      delete adminSessions[from];
      return adminReply(from, `✅ Added user: ${j}`);
    }
    if (sess.awaiting === 'delUser') {
      const j = formatPhoneNumber(txt);
      if (!j||!savedUsers.has(j)) return adminReply(from,"⚠️ Not found. Retry:");
      savedUsers.delete(j);
      delete adminSessions[from];
      return adminReply(from, `🗑️ Removed user: ${j}`);
    }
    if (sess.awaiting === 'addGroup') {
      if (!txt.endsWith('@g.us')) return adminReply(from,"⚠️ Must end @g.us");
      savedGroups.add(txt);
      delete adminSessions[from];
      return adminReply(from, `✅ Added group: ${txt}`);
    }
    if (sess.awaiting === 'delGroup') {
      if (!txt.endsWith('@g.us')||!savedGroups.has(txt)) return adminReply(from,"⚠️ Not found.");
      savedGroups.delete(txt);
      delete adminSessions[from];
      return adminReply(from, `🗑️ Removed group: ${txt}`);
    }

    if (sess.awaiting === 'bulk') {
      sess.message = txt;
      sess.awaiting = 'confirmBulk';
      return adminReply(from,
        `📝 *Preview*:\n"${txt}"\n\n1️⃣ Send to *${sess.target}*\n2️⃣ Cancel`
      );
    }
    if (sess.awaiting === 'confirmBulk') {
      if (txt === '1') {
        const payload = `*${botConfig.fromAdmin}:*\n${sess.message}`;
        if (sess.target==='users'||sess.target==='all')
          for (let u of savedUsers) await safeSend(u,payload);
        if (sess.target==='groups'||sess.target==='all')
          for (let g of savedGroups) await safeSend(g,payload);
        delete adminSessions[from];
        return adminReply(from, "🎉 Bulk send completed!");
      }
      delete adminSessions[from];
      return adminReply(from, "❌ Bulk send cancelled.");
    }

    if (sess.awaiting === 'addAdmin') {
      if (from !== SUPER_ADMIN) {
        delete adminSessions[from];
        return adminReply(from,"⚠️ Only super-admin.");
      }
      const j = formatPhoneNumber(txt);
      if (!j) return adminReply(from,"⚠️ Invalid phone.");
      adminUsers.add(j);
      delete adminSessions[from];
      return adminReply(from, `✅ New admin: ${j}`);
    }
    if (sess.awaiting === 'removeAdmin') {
      if (from !== SUPER_ADMIN) {
        delete adminSessions[from];
        return adminReply(from,"⚠️ Only super-admin.");
      }
      const j = formatPhoneNumber(txt);
      if (!j||!adminUsers.has(j)||j===SUPER_ADMIN) {
        return adminReply(from,"⚠️ Cannot remove.");
      }
      adminUsers.delete(j);
      delete adminSessions[from];
      return adminReply(from, `🗑️ Removed admin: ${j}`);
    }

    switch (txt) {
      case '1': adminSessions[from]={awaiting:'addUser'};    return adminReply(from,"📱 Enter phone to add:");
      case '2': return adminReply(from,
        savedUsers.size? `👥 Users:\n${[...savedUsers].join('\n')}`:"No users."
      );
      case '3': adminSessions[from]={awaiting:'delUser'};    return adminReply(from,"📱 Enter phone to delete:");
      case '4': adminSessions[from]={awaiting:'addGroup'};   return adminReply(from,"🙌 Enter group JID:");
      case '5': return adminReply(from,
        savedGroups.size? `👥 Groups:\n${[...savedGroups].join('\n')}`:"No groups."
      );
      case '6': adminSessions[from]={awaiting:'delGroup'};   return adminReply(from,"📱 Enter group JID to delete:");
      case '7':
      case '8':
      case '9':
        adminSessions[from]={awaiting:'bulk',
          target: txt==='7'?'users':txt==='8'?'groups':'all'};
        return adminReply(from,"📝 Enter message for bulk:");
      case '10': adminSessions[from]={awaiting:'configMenu'};return adminReply(from,
        `⚙️ Config Texts:\n1 Admin Label\n2 Welcome Msg\n3 Deposit Prompt\n4 Payment Init\n5 Countdown\n6 Success Msg\n7 Footer\n8 Channel ID`
      );
      case '11': adminSessions[from]={awaiting:'addAdmin'};   return adminReply(from,"👤 Enter phone for new admin:");
      case '12': adminSessions[from]={awaiting:'removeAdmin'};return adminReply(from,"🗑️ Enter phone of admin to remove:");
      default:   return showAdminMenu(from);
    }
  }

  // ── USER DEPOSIT FLOW ─────────────────────────
  if (lc === 'start') {
    conversations[from] = { stage: 'awaitingAmount' };
    return msg.reply(botConfig.welcomeMessage);
  }
  if (!conversations[from]) {
    conversations[from] = { stage: 'awaitingAmount' };
    return msg.reply(botConfig.welcomeMessage);
  }
  const conv = conversations[from];

  // Stage 1: amount
  if (conv.stage === 'awaitingAmount') {
    const a = parseInt(txt);
    if (isNaN(a) || a <= 0) {
      return msg.reply("⚠️ Please enter a valid deposit amount in Ksh.");
    }
    conv.amount = a;
    conv.stage  = 'awaitingDepositNumber';
    return msg.reply(parsePlaceholders(botConfig.depositChosen, { amount: String(a) }));
  }

  // Stage 2: deposit number
  if (conv.stage === 'awaitingDepositNumber') {
    conv.depositNumber = txt;
    conv.stage = 'processing';

    // Log attempt
    depositAttempts.unshift({
      amount: conv.amount,
      from: conv.depositNumber,
      time: new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"}),
      status: 'Pending'
    });

    const ref = await sendSTKPush(conv.amount, conv.depositNumber);
    if (!ref) {
      depositAttempts[0].status = 'Error Initiating';
      delete conversations[from];
      return msg.reply("❌ Error initiating payment. Please try again later.");
    }
    conv.stkRef = ref;

    // Notify admin
    const now = depositAttempts[0].time;
    const attemptMsg =
`*${botConfig.fromAdmin}:* 🚀 *New Deposit Attempt*
• *Amount:* Ksh ${conv.amount}
• *From:* ${conv.depositNumber}
• *Time:* ${now}`;
    await safeSend(SUPER_ADMIN, attemptMsg);

    msg.reply(parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' }));
    setTimeout(() => {
      msg.reply(parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' }));
    }, 10000);

    setTimeout(async () => {
      const status = await fetchTransactionStatus(conv.stkRef);
      const ts     = new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
      if (!status) {
        depositAttempts[0].status = 'Error Fetching';
        delete conversations[from];
        return msg.reply("❌ Error fetching status. Please try again later.");
      }
      const st   = (status.status||'').toUpperCase();
      const code = status.provider_reference||'';
      const desc = status.ResultDesc||'';

      if (st === 'SUCCESS') {
        depositAttempts[0].status = 'Success';
        msg.reply(parsePlaceholders(botConfig.paymentSuccess,{
          amount: String(conv.amount),
          depositNumber: conv.depositNumber,
          mpesaCode: code,
          date: ts
        }));
        safeSend(SUPER_ADMIN,
          `✅ *Deposit Success!*\n• Amount: Ksh ${conv.amount}\n• From: ${conv.depositNumber}\n• Code: ${code}\n• Time: ${ts}`
        );
      } else {
        let err = 'Please try again.';
        if (/insufficient/i.test(desc)) err = 'Insufficient funds.';
        if (/pin/i.test(desc)) err = 'Incorrect PIN.';
        depositAttempts[0].status = `Failed (${err})`;
        msg.reply(`❌ Payment ${st}. ${err}\nType *Start* to retry.`);
        safeSend(SUPER_ADMIN,
          `❌ *Deposit Failed!*\n• Amount: Ksh ${conv.amount}\n• From: ${conv.depositNumber}\n• Error: ${err}\n• Time: ${ts}`
        );
      }
      delete conversations[from];
    }, 20000);

    return;
  }
});

// ──────────────────────────────────────────────────────────────────
// EXPRESS DASHBOARD
// ──────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  let qrImg = `<div class="text-center text-gray-500">Waiting for QR…</div>`;
  if (currentQR) {
    try {
      const dataUrl = await QRCode.toDataURL(currentQR);
      qrImg = `<img src="${dataUrl}" alt="QR Code" class="w-full h-auto object-contain"/>`;
    } catch {}
  }

  const rows = depositAttempts.map(d => `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">Ksh ${d.amount}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${d.from}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${d.time}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm">${d.status}</td>
    </tr>
  `).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FY'S PROPERTY Deposit Bot</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
    body { font-family: 'Poppins', sans-serif; background-color: #f5f7fa; }
    .gradient-bg { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .glass-card { background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); }
    .qr-container:hover { transform: scale(1.03); box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
  </style>
</head>
<body class="min-h-screen">
  <div class="container mx-auto px-4 py-8 max-w-6xl">

    <!-- Header -->
    <header class="gradient-bg text-white rounded-xl shadow-lg mb-8 overflow-hidden">
      <div class="p-6 md:p-8 flex items-center justify-between">
        <div class="flex items-center">
          <div class="w-14 h-14 rounded-full bg-white flex items-center justify-center mr-4">
            <i class="fas fa-home text-2xl text-purple-600"></i>
          </div>
          <div>
            <h1 class="text-2xl md:text-3xl font-bold">FY'S PROPERTY</h1>
            <p class="text-white/80">Deposit Bot Dashboard</p>
          </div>
        </div>
        <div class="flex items-center space-x-4">
          <div class="flex items-center bg-white/20 px-4 py-2 rounded-full">
            <i class="fas fa-circle text-green-400 mr-2 text-xs"></i>
            <span class="text-sm font-medium">Bot Online</span>
          </div>
        </div>
      </div>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- QR Code Panel -->
      <div class="bg-white rounded-xl shadow-md p-6 lg:col-span-1">
        <h2 class="text-lg font-semibold mb-4">
          <i class="fas fa-qrcode mr-2 text-purple-500"></i> WhatsApp Connection
        </h2>
        <div class="qr-container glass-card p-4">
          ${qrImg}
        </div>
        <button onclick="refreshQR()" class="mt-4 w-full bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 transition">
          <i class="fas fa-sync-alt mr-2"></i> Refresh QR
        </button>
      </div>

      <!-- Recent Transactions -->
      <div class="bg-white rounded-xl shadow-md p-6 lg:col-span-2">
        <h2 class="text-lg font-semibold mb-4">
          <i class="fas fa-exchange-alt mr-2 text-purple-500"></i> Recent Transactions
        </h2>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${rows}
            </tbody>
          </table>
        </div>
        <button onclick="restartBot()" class="mt-6 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition">
          <i class="fas fa-redo-alt mr-2"></i> Restart Bot
        </button>
      </div>
    </div>
  </div>

  <script>
    async function refreshQR() {
      await fetch('/api/qr');
      location.reload();
    }
    async function restartBot() {
      if (!confirm('Restart bot now?')) return;
      await fetch('/api/restart', { method: 'POST' });
    }
    setInterval(() => {
      fetch('/api/transactions').then(r => r.json());
    }, 10000);
  </script>
</body>
</html>`);
});

app.get('/api/qr', (req, res) => {
  res.json({ qr: currentQR });
});

app.get('/api/transactions', (req, res) => {
  res.json(depositAttempts);
});

app.post('/api/restart', (req, res) => {
  res.json({ restarting: true });
  console.log('⚠️ Restart triggered via dashboard');
  process.exit(0);
});

app.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));
client.initialize();
