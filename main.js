/*******************************************************************
 * main.js
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express           = require('express');
const qrcodeTerminal    = require('qrcode-terminal');
const QRCode            = require('qrcode');
const axios             = require('axios');

/***********************************************************
 * GLOBAL / CONFIG
 ***********************************************************/
let currentQR = "";

// Super‐admin (initial) and set of admins
const SUPER_ADMIN   = '254701339573@c.us';
const adminUsers    = new Set([ SUPER_ADMIN ]);

// Bot configuration
let botConfig = {
  fromAdmin:        "Admin GK-FY",
  channelID:        529,
  welcomeMessage:   "*👋 Welcome to FY'S PROPERTY Deposit Bot!*\nHow much would you like to deposit? 💰",
  depositChosen:    "*👍 Great!* You've chosen to deposit *Ksh {amount}*.\nNow, please provide your deposit number (e.g., your account number) 📱",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate:  "*⏳ {seconds} seconds left...*\nWe will fetch the status soon!",
  paymentSuccess:   "*🎉 Payment Successful!*\n*💰 Amount:* Ksh {amount}\n*📞 Deposit Number:* {depositNumber}\n*🆔 MPESA Transaction Code:* {mpesaCode}\n*⏰ Date/Time (KE):* {date}\n{footer}",
  paymentFooter:    "Thank you for choosing FY'S PROPERTY! Type *Start* to deposit again."
};

// In‐memory state
const conversations  = {};   // per-user deposit flows
const adminSessions  = {};   // per-admin menu flows
let savedUsers       = new Set();
let savedGroups      = new Set();

/***********************************************************
 * WHATSAPP CLIENT
 ***********************************************************/
const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp client is ready');
  adminReply(SUPER_ADMIN, `${botConfig.fromAdmin}: Bot is online.`);
  showAdminMenu(SUPER_ADMIN);
});

/***********************************************************
 * HELPERS
 ***********************************************************/
function showAdminMenu(to) {
  const menu =
`${botConfig.fromAdmin}: Choose an option:
1. Add User
2. View Users
3. Delete User
4. Add Group
5. View Groups
6. Delete Group
7. Bulk → Users
8. Bulk → Groups
9. Bulk → All
10. Config Bot Texts
11. Add Admin
12. Remove Admin`;
  adminReply(to, menu);
}

function formatPhoneNumber(input) {
  let num = input.replace(/[^\d]/g, '');
  if (num.startsWith('0')) num = '254' + num.slice(1);
  if (!num.startsWith('254') || num.length < 10) return null;
  return num + '@c.us';
}

function parsePlaceholders(template, data) {
  return template
    .replace(/{amount}/g, data.amount || '')
    .replace(/{depositNumber}/g, data.depositNumber || '')
    .replace(/{seconds}/g, data.seconds || '')
    .replace(/{mpesaCode}/g, data.mpesaCode || '')
    .replace(/{date}/g, data.date || '')
    .replace(/{footer}/g, botConfig.paymentFooter);
}

// Wraps sendMessage and never throws; reports failures to super‐admin
async function safeSend(to, content) {
  try {
    await client.sendMessage(to, content);
  } catch (e) {
    console.error(`Error sending to ${to}:`, e.message);
    if (to !== SUPER_ADMIN) {
      await client.sendMessage(
        SUPER_ADMIN,
        `⚠️ Failed to send to ${to}:\n${e.message}`
      );
    }
  }
}

// For admin recipients: append back/main options automatically
function adminReply(to, content) {
  const suffix = `\n\n0. Go Back 🔙\n00. Main Menu`;
  return safeSend(to, content + suffix);
}

async function sendSTKPush(amount, phone) {
  const payload = {
    amount,
    phone_number: phone,
    channel_id: botConfig.channelID,
    provider: "m-pesa",
    external_reference: "INV-009",
    customer_name: "John Doe",
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
      { headers: {
          'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
        }
      }
    );
    return res.data;
  } catch (err) {
    console.error("Status Fetch Error:", err.message);
    return null;
  }
}

/***********************************************************
 * MESSAGE HANDLER
 ***********************************************************/
client.on('message', async message => {
  const sender = message.from;
  const text   = message.body.trim();
  const lower  = text.toLowerCase();

  // ignore any group origin
  if (sender.endsWith('@g.us')) return;

  // ── ADMIN FLOW ──────────────────────────────
  if (adminUsers.has(sender)) {
    const sess = adminSessions[sender] || {};

    // If awaiting submenu input…
    if (sess.awaiting) {
      // 00 = main menu
      if (text === '00') {
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }
      // 0 = go back (cancel this submenu)
      if (text === '0') {
        delete adminSessions[sender];
        return adminReply(sender, "Cancelled, back one step.");
      }

      // CONFIG SUBMENU
      if (sess.awaiting === 'configMenu') {
        switch (text) {
          case '1':
            adminSessions[sender] = { awaiting: 'edit:fromAdmin' };
            return adminReply(sender, "Enter new Admin label:");
          case '2':
            adminSessions[sender] = { awaiting: 'edit:welcomeMessage' };
            return adminReply(sender, "Enter new Welcome Message:");
          case '3':
            adminSessions[sender] = { awaiting: 'edit:depositChosen' };
            return adminReply(sender, "Enter new Deposit Chosen template:");
          case '4':
            adminSessions[sender] = { awaiting: 'edit:paymentInitiated' };
            return adminReply(sender, "Enter new Payment Initiated template:");
          case '5':
            adminSessions[sender] = { awaiting: 'edit:countdownUpdate' };
            return adminReply(sender, "Enter new Countdown Update template:");
          case '6':
            adminSessions[sender] = { awaiting: 'edit:paymentSuccess' };
            return adminReply(sender, "Enter new Payment Success template:");
          case '7':
            adminSessions[sender] = { awaiting: 'edit:paymentFooter' };
            return adminReply(sender, "Enter new Payment Footer:");
          case '8':
            adminSessions[sender] = { awaiting: 'edit:channelID' };
            return adminReply(sender, "Enter new Channel ID (number):");
          default:
            return adminReply(sender, "Invalid choice. Try again.");
        }
      }

      // HANDLE edit:<key>
      if (sess.awaiting.startsWith('edit:')) {
        const key = sess.awaiting.split(':')[1];
        let val = text;
        if (key === 'channelID') {
          const n = parseInt(text);
          if (isNaN(n)) {
            return adminReply(sender, "⚠️ Must be a number. Try again:");
          }
          val = n;
        }
        botConfig[key] = val;
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ADD USER
      if (sess.awaiting === 'addUser') {
        const jid = formatPhoneNumber(text);
        if (!jid) {
          return adminReply(sender, "⚠️ Invalid number. Try again:");
        }
        savedUsers.add(jid);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // DELETE USER
      if (sess.awaiting === 'delUser') {
        const jid = formatPhoneNumber(text);
        if (!jid || !savedUsers.has(jid)) {
          return adminReply(sender, "⚠️ Not found. Try again:");
        }
        savedUsers.delete(jid);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ADD GROUP
      if (sess.awaiting === 'addGroup') {
        const jid = text;
        if (!jid.endsWith('@g.us')) {
          return adminReply(sender, "⚠️ Must end with @g.us. Try again:");
        }
        savedGroups.add(jid);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // DELETE GROUP
      if (sess.awaiting === 'delGroup') {
        const jid = text;
        if (!jid.endsWith('@g.us') || !savedGroups.has(jid)) {
          return adminReply(sender, "⚠️ Not found. Try again:");
        }
        savedGroups.delete(jid);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // BULK MESSAGE ENTRY
      if (sess.awaiting === 'bulk') {
        sess.message = text;
        adminSessions[sender] = {
          awaiting: 'confirmBulk',
          target: sess.target,
          message: sess.message
        };
        return adminReply(
          sender,
          `Confirm send to ${sess.target}?\n\n"${sess.message}"`
        );
      }

      // BULK CONFIRMATION
      if (sess.awaiting === 'confirmBulk') {
        if (lower === 'yes') {
          const { target, message: m } = sess;
          const payload = `*${botConfig.fromAdmin}:*\n${m}`;
          if (target === 'users' || target === 'all') {
            for (let u of savedUsers) await safeSend(u, payload);
          }
          if (target === 'groups' || target === 'all') {
            for (let g of savedGroups) await safeSend(g, payload);
          }
          delete adminSessions[sender];
          return adminReply(sender, "✅ Bulk send complete.");
        } else {
          delete adminSessions[sender];
          return showAdminMenu(sender);
        }
      }

      // ADD ADMIN
      if (sess.awaiting === 'addAdmin') {
        if (sender !== SUPER_ADMIN) {
          delete adminSessions[sender];
          return adminReply(sender, "⚠️ Only super-admin can add admins.");
        }
        const jid = formatPhoneNumber(text);
        if (!jid) {
          return adminReply(sender, "⚠️ Invalid number. Try again:");
        }
        adminUsers.add(jid);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // REMOVE ADMIN
      if (sess.awaiting === 'removeAdmin') {
        if (sender !== SUPER_ADMIN) {
          delete adminSessions[sender];
          return adminReply(sender, "⚠️ Only super-admin can remove admins.");
        }
        const jid = formatPhoneNumber(text);
        if (!jid || !adminUsers.has(jid) || jid === SUPER_ADMIN) {
          return adminReply(sender, "⚠️ Cannot remove that admin. Try again:");
        }
        adminUsers.delete(jid);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }
    }

    // No pending await → main menu choice
    switch (text) {
      case '0': // Go Back (same as cancel)
        return adminReply(sender, "🔙 Back.");
      case '00': // Main Menu
        delete adminSessions[sender];
        return showAdminMenu(sender);
      case '1':
        adminSessions[sender] = { awaiting: 'addUser' };
        return adminReply(sender, "Enter phone (e.g. 0712345678) to add:");
      case '2':
        return adminReply(
          sender,
          savedUsers.size
            ? "Saved Users:\n" + [...savedUsers].join('\n')
            : "No users saved."
        );
      case '3':
        adminSessions[sender] = { awaiting: 'delUser' };
        return adminReply(sender, "Enter phone to delete:");
      case '4':
        adminSessions[sender] = { awaiting: 'addGroup' };
        return adminReply(sender, "Enter group JID (e.g. 12345@g.us) to add:");
      case '5':
        return adminReply(
          sender,
          savedGroups.size
            ? "Saved Groups:\n" + [...savedGroups].join('\n')
            : "No groups saved."
        );
      case '6':
        adminSessions[sender] = { awaiting: 'delGroup' };
        return adminReply(sender, "Enter group JID to delete:");
      case '7': case '8': case '9': {
        const target = text === '7' ? 'users' : text === '8' ? 'groups' : 'all';
        adminSessions[sender] = { awaiting: 'bulk', target };
        return adminReply(sender, `Type the message to send to ${target}:`);
      }
      case '10':
        adminSessions[sender] = { awaiting: 'configMenu' };
        return adminReply(
`Config Bot Texts:
1. Admin Label (${botConfig.fromAdmin})
2. Welcome Message
3. Deposit Prompt
4. Payment Initiated
5. Countdown Update
6. Payment Success
7. Payment Footer
8. Channel ID (${botConfig.channelID})`
        );
      case '11':
        adminSessions[sender] = { awaiting: 'addAdmin' };
        return adminReply(sender, "Enter phone of new admin to add:");
      case '12':
        adminSessions[sender] = { awaiting: 'removeAdmin' };
        return adminReply(sender, "Enter phone of admin to remove:");
      default:
        return showAdminMenu(sender);
    }
  }

  // ── DEPOSIT BOT FLOW ───────────────────────────
  if (lower === 'start') {
    conversations[sender] = { stage: 'awaitingAmount' };
    return safeSend(sender, botConfig.welcomeMessage);
  }
  if (!conversations[sender]) {
    conversations[sender] = { stage: 'awaitingAmount' };
    return safeSend(sender, botConfig.welcomeMessage);
  }
  const conv = conversations[sender];

  // Stage 1: amount
  if (conv.stage === 'awaitingAmount') {
    const amt = parseInt(text);
    if (isNaN(amt) || amt <= 0) {
      return safeSend(sender, "⚠️ Please enter a valid deposit amount in Ksh.");
    }
    conv.amount = amt;
    conv.stage  = 'awaitingDepositNumber';
    return safeSend(sender, parsePlaceholders(botConfig.depositChosen, { amount: String(amt) }));
  }

  // Stage 2: deposit number
  if (conv.stage === 'awaitingDepositNumber') {
    conv.depositNumber = text;
    conv.stage = 'processing';

    const ref = await sendSTKPush(conv.amount, conv.depositNumber);
    if (!ref) {
      delete conversations[sender];
      return safeSend(sender, "❌ Error initiating payment. Try again later.");
    }
    conv.stkRef = ref;

    // notify admin
    const now = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    await safeSend(
      SUPER_ADMIN,
      `*${botConfig.fromAdmin}:* Deposit attempt:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Time: ${now}`
    );

    await safeSend(sender, parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' }));

    setTimeout(() => {
      safeSend(sender, parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' }));
    }, 10000);

    setTimeout(async () => {
      const status = await fetchTransactionStatus(conv.stkRef);
      const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!status) {
        delete conversations[sender];
        return safeSend(sender, "❌ Error fetching status. Try again later.");
      }
      const st   = (status.status || '').toUpperCase();
      const code = status.provider_reference || '';
      const desc = status.ResultDesc || '';

      if (st === 'SUCCESS') {
        await safeSend(sender, parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(conv.amount),
          depositNumber: conv.depositNumber,
          mpesaCode: code,
          date: timestamp
        }));
        await safeSend(
          SUPER_ADMIN,
          `*${botConfig.fromAdmin}:* Deposit success:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Code: ${code}\n• Time: ${timestamp}`
        );
      } else {
        let err = 'Please try again.';
        if (/insufficient/i.test(desc)) err = 'Insufficient funds.';
        if (/pin/i.test(desc))        err = 'Incorrect PIN.';
        await safeSend(sender, `❌ Payment ${st}. ${err}\nType Start to retry.`);
        await safeSend(
          SUPER_ADMIN,
          `*${botConfig.fromAdmin}:* Deposit failed:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Error: ${err}\n• Time: ${timestamp}`
        );
      }
      delete conversations[sender];
    }, 20000);

    return;
  }
});

/***********************************************************
 * EXPRESS SERVER (QR Dashboard)
 ***********************************************************/
const app = express();
const port = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  let qrImg = '';
  if (currentQR) {
    try { qrImg = await QRCode.toDataURL(currentQR); } catch {}
  }
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FY'S PROPERTY Bot QR</title>
  <style>
    body, html {
      height: 100%; margin:0; display:flex;
      justify-content:center; align-items:center;
      background: url('https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d') no-repeat center/cover;
      font-family: Arial, sans-serif;
    }
    .glass {
      background: rgba(255,255,255,0.2);
      border-radius: 16px;
      padding: 2rem;
      max-width: 320px;
      width: 90%;
      text-align: center;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .glass h1 {
      margin-bottom: 1rem;
      color: #fff;
      text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }
    .qr-box img {
      width: 100%;
      max-width: 250px;
    }
    .footer {
      margin-top: 1rem;
      font-size: 0.9rem;
      color: #eee;
    }
  </style>
</head>
<body>
  <div class="glass">
    <h1>Scan to Connect</h1>
    <div class="qr-box">
      ${ qrImg ? `<img src="${qrImg}" alt="QR Code">` : '<p style="color:#fff;">Waiting for QR…</p>' }
    </div>
    <div class="footer">Created By FY'S PROPERTY</div>
  </div>
</body>
</html>`);
});

app.listen(port, () => console.log(`Express running on port ${port}`));
client.initialize();
