// bot.js
/*******************************************************************
 * COMBINED WhatsApp-Web.js + Express Dashboard for FY'S PROPERTY
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express           = require('express');
const qrcodeTerminal    = require('qrcode-terminal');
const QRCode            = require('qrcode');
const axios             = require('axios');
const path              = require('path');

/***********************************************************
 * GLOBAL / CONFIG
 ***********************************************************/
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

// In-memory
let currentQR         = null;
const conversations   = {};
const adminSessions   = {};
const savedUsers      = new Set();
const savedGroups     = new Set();
const depositAttempts = [];  // { amount, from, time, status? }

/***********************************************************
 * WHATSAPP CLIENT
 ***********************************************************/
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

/***********************************************************
 * HELPERS (same as before)…
 ***********************************************************/
function showAdminMenu(to) {
  const menu = `${botConfig.fromAdmin}: *Main Menu*
1. Add User  2. View Users  3. Delete User
4. Add Group 5. View Groups 6. Delete Group
7. Bulk → Users 8. Bulk → Groups 9. Bulk → All
10. Config Bot Texts  11. Add Admin 12. Remove Admin`;
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
    .replace(/{amount}/g, data.amount||'')
    .replace(/{depositNumber}/g, data.depositNumber||'')
    .replace(/{seconds}/g, data.seconds||'')
    .replace(/{mpesaCode}/g, data.mpesaCode||'')
    .replace(/{date}/g, data.date||'')
    .replace(/{footer}/g, botConfig.paymentFooter);
}

async function safeSend(to, msg) {
  try { await client.sendMessage(to, msg); }
  catch (e) {
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
      { headers:{
          'Content-Type':'application/json',
          'Authorization':'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
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
      { headers:{
          'Authorization':'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
        }
      }
    );
    return res.data;
  } catch (err) {
    console.error("Fetch Status Error:", err.message);
    return null;
  }
}

/***********************************************************
 * MESSAGE HANDLER (same as before, plus log attempts)
 ***********************************************************/
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();

  if (from.endsWith('@g.us')) return;  // ignore groups

  // … [ADMIN FLOW UNCHANGED] …

  // ── USER DEPOSIT FLOW ────────────────────────
  if (lc === 'start') {
    conversations[from] = { stage: 'awaitingAmount' };
    return msg.reply(botConfig.welcomeMessage);
  }
  if (!conversations[from]) {
    conversations[from] = { stage: 'awaitingAmount' };
    return msg.reply(botConfig.welcomeMessage);
  }
  const conv = conversations[from];

  if (conv.stage === 'awaitingAmount') {
    const a = parseInt(txt);
    if (isNaN(a) || a <= 0) {
      return msg.reply("⚠️ Please enter a valid deposit amount in Ksh.");
    }
    conv.amount = a;
    conv.stage  = 'awaitingDepositNumber';
    return msg.reply(parsePlaceholders(botConfig.depositChosen, { amount: String(a) }));
  }

  if (conv.stage === 'awaitingDepositNumber') {
    conv.depositNumber = txt;
    conv.stage = 'processing';

    // Log the attempt immediately
    depositAttempts.unshift({
      amount: conv.amount,
      from: conv.depositNumber,
      time: new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"}),
      status: 'Pending'
    });

    // STK push
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

    // User feedback + countdown
    msg.reply(parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' }));
    setTimeout(() => {
      msg.reply(parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' }));
    }, 10000);

    // Final status check
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

/***********************************************************
 * EXPRESS DASHBOARD (QR + Attempts + Restart)
 ***********************************************************/
const app = express();
const PORT = process.env.PORT||3000;

// static Tailwind + FontAwesome inlined via CDN
app.get('/', async (req, res) => {
  let qrImgTag = `<i class="fas fa-spinner fa-spin text-gray-400 text-3xl mb-2"></i><p class="text-gray-500">Waiting for QR…</p>`;
  if (currentQR) {
    try {
      const dataUrl = await QRCode.toDataURL(currentQR);
      qrImgTag = `<img src="${dataUrl}" alt="QR Code" class="w-full h-full object-contain"/>`;
    } catch {}
  }

  // Build table rows
  const rows = depositAttempts.map(d => `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${d.time}</td>
      <td class="px-6 py-4 whitespace-nowrap"><div class="text-sm text-gray-900">${d.from}</div></td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">Ksh ${d.amount}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm">${d.status}</td>
    </tr>
  `).join('');

  res.send(`<!DOCTYPE html>
<html lang="en"><head>…YOUR <head> …</head><body class="min-h-screen">
  <div class="container mx-auto px-4 py-8 max-w-6xl">
    <!-- QR Panel -->
    <div class="bg-white rounded-xl shadow-md overflow-hidden mb-6">
      <div class="p-5 border-b border-gray-100 flex justify-between items-center">
        <h2 class="text-lg font-semibold">WhatsApp Connection</h2>
        <button onclick="refreshQR()" class="px-3 py-1 bg-purple-100 rounded">Refresh QR</button>
      </div>
      <div class="p-6 flex justify-center items-center h-64">${qrImgTag}</div>
    </div>

    <!-- Restart -->
    <div class="flex justify-end mb-4">
      <button onclick="restartBot()" class="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">Restart Bot</button>
    </div>

    <!-- Attempts Table -->
    <div class="bg-white rounded-xl shadow-md overflow-hidden">
      <div class="p-5 border-b border-gray-100">
        <h2 class="text-lg font-semibold">Recent Transactions</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date/Time</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    function refreshQR() { fetch('/api/qr').then(_=>location.reload()) }
    function restartBot() {
      if(confirm('Restart bot now?')) {
        fetch('/api/restart', { method:'POST' });
      }
    }
  </script>
</body></html>`);
});

// QR JSON endpoint
app.get('/api/qr', (req, res) => {
  res.json({ qr: currentQR });
});

// Restart endpoint
app.post('/api/restart', (req, res) => {
  res.json({ restarting: true });
  console.log('⚠️ Restart triggered via dashboard');
  process.exit(0);
});

app.listen(PORT, () => console.log(`Dashboard running on http://localhost:${PORT}`));

client.initialize();
