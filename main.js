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
// 1) Latest QR code for Express dashboard
let currentQR = "";

// 2) Admin JID
const ADMIN_NUMBER = '254701339573@c.us';

// 3) Bot text & settings (editable via menu)
let botConfig = {
  fromAdmin:       "Admin GK-FY",
  channelID:       529,
  welcomeMessage:  "*👋 Welcome to FY'S PROPERTY Deposit Bot!*\nHow much would you like to deposit? 💰",
  depositChosen:   "*👍 Great!* You've chosen to deposit *Ksh {amount}*.\nNow, please provide your deposit number (e.g., your account number) 📱",
  paymentInitiated:"*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*\nWe will fetch the status soon!",
  paymentSuccess:  "*🎉 Payment Successful!*\n*💰 Amount:* Ksh {amount}\n*📞 Deposit Number:* {depositNumber}\n*🆔 MPESA Transaction Code:* {mpesaCode}\n*⏰ Date/Time (KE):* {date}\n{footer}",
  paymentFooter:   "Thank you for choosing FY'S PROPERTY! Type *Start* to deposit again."
};

// 4) In‐memory state
const conversations    = {};  // per‐user deposit flows
const adminSessions    = {};  // per‐admin menu flows
let   savedUsers       = new Set();
let   savedGroups      = new Set();

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
  // Auto-alert admin and show menu
  showAdminMenu(ADMIN_NUMBER);
});

/***********************************************************
 * HELPERS
 ***********************************************************/
function showAdminMenu(to) {
  const menu =
`${botConfig.fromAdmin}: Please choose an option by number:
1. Add User
2. View Users
3. Delete User
4. Add Group
5. View Groups
6. Delete Group
7. Bulk → Users
8. Bulk → Groups
9. Bulk → All
10. Edit Admin Label
0. Show Menu`;
  client.sendMessage(to, menu);
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

async function sendSTKPush(amount, phone) {
  const payload = {
    amount:           amount,
    phone_number:     phone,
    channel_id:       botConfig.channelID,
    provider:         "m-pesa",
    external_reference: "INV-009",
    customer_name:      "John Doe",
    callback_url:       "https://your-callback-url",
    account_reference:  "FY'S PROPERTY",
    transaction_desc:   "FY'S PROPERTY Payment",
    remarks:            "FY'S PROPERTY",
    business_name:      "FY'S PROPERTY",
    companyName:        "FY'S PROPERTY"
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
    console.error("STK Push Error:", err);
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
    console.error("Status Fetch Error:", err);
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

  // ignore messages from group threads
  if (sender.endsWith('@g.us')) return;

  // ──────── ADMIN MENU FLOW ─────────────────────
  if (sender === ADMIN_NUMBER) {
    const sess = adminSessions[sender] || {};

    // If awaiting a submenu response...
    if (sess.awaiting) {
      switch (sess.awaiting) {
        // Add User
        case 'addUser': {
          const jid = formatPhoneNumber(text);
          if (!jid) {
            await message.reply("⚠️ Invalid number. Try again:");
          } else {
            savedUsers.add(jid);
            await message.reply(`✅ Saved user: ${jid}`);
            delete adminSessions[sender];
            showAdminMenu(sender);
          }
          return;
        }
        // Delete User
        case 'delUser': {
          const jid = formatPhoneNumber(text);
          if (!jid || !savedUsers.has(jid)) {
            await message.reply("⚠️ Not found. Try again:");
          } else {
            savedUsers.delete(jid);
            await message.reply(`🗑️ Deleted user: ${jid}`);
            delete adminSessions[sender];
            showAdminMenu(sender);
          }
          return;
        }
        // Add Group
        case 'addGroup': {
          const jid = text;
          if (!jid.endsWith('@g.us')) {
            await message.reply("⚠️ Must end with @g.us. Try again:");
          } else {
            savedGroups.add(jid);
            await message.reply(`✅ Saved group: ${jid}`);
            delete adminSessions[sender];
            showAdminMenu(sender);
          }
          return;
        }
        // Delete Group
        case 'delGroup': {
          const jid = text;
          if (!jid.endsWith('@g.us') || !savedGroups.has(jid)) {
            await message.reply("⚠️ Not found. Try again:");
          } else {
            savedGroups.delete(jid);
            await message.reply(`🗑️ Deleted group: ${jid}`);
            delete adminSessions[sender];
            showAdminMenu(sender);
          }
          return;
        }
        // Bulk message text entry
        case 'bulk': {
          sess.message = text;
          adminSessions[sender] = { awaiting: 'confirmBulk', target: sess.target, message: sess.message };
          await message.reply(
            `Confirm send to ${sess.target}?\n\n"${sess.message}"\n\ntype YES to send or NO to cancel`
          );
          return;
        }
        // Bulk message confirmation
        case 'confirmBulk': {
          if (lower === 'yes') {
            const { target, message: m } = sess;
            if (target === 'users' || target === 'all') {
              for (let u of savedUsers) await client.sendMessage(u, m);
            }
            if (target === 'groups' || target === 'all') {
              for (let g of savedGroups) await client.sendMessage(g, m);
            }
            await message.reply("✅ Bulk send complete.");
          } else {
            await message.reply("❌ Bulk send cancelled.");
          }
          delete adminSessions[sender];
          showAdminMenu(sender);
          return;
        }
        // Edit Admin Label
        case 'editLabel': {
          botConfig.fromAdmin = text;
          await message.reply(`✅ Admin label updated to: ${text}`);
          delete adminSessions[sender];
          showAdminMenu(sender);
          return;
        }
      }
    }

    // Otherwise treat incoming text as a menu choice
    switch (text) {
      case '0': showAdminMenu(sender); return;
      case '1':
        adminSessions[sender] = { awaiting: 'addUser' };
        return message.reply("Enter phone (e.g. 0712345678) to add:");
      case '2':
        return message.reply(
          savedUsers.size
            ? "Saved Users:\n" + [...savedUsers].join('\n')
            : "No users saved."
        );
      case '3':
        adminSessions[sender] = { awaiting: 'delUser' };
        return message.reply("Enter phone to delete:");
      case '4':
        adminSessions[sender] = { awaiting: 'addGroup' };
        return message.reply("Enter group JID (e.g. 12345@g.us) to add:");
      case '5':
        return message.reply(
          savedGroups.size
            ? "Saved Groups:\n" + [...savedGroups].join('\n')
            : "No groups saved."
        );
      case '6':
        adminSessions[sender] = { awaiting: 'delGroup' };
        return message.reply("Enter group JID to delete:");
      case '7':
      case '8':
      case '9': {
        // Bulk targets
        const target = text === '7' ? 'users' : text === '8' ? 'groups' : 'all';
        adminSessions[sender] = { awaiting: 'bulk', target };
        return message.reply(`Type the message to send to ${target}:`);
      }
      case '10':
        adminSessions[sender] = { awaiting: 'editLabel' };
        return message.reply("Enter new Admin label:");
      default:
        return showAdminMenu(sender);
    }
  }

  // ──────── DEPOSIT BOT FLOW ─────────────────────
  if (lower === 'start') {
    conversations[sender] = { stage: 'awaitingAmount' };
    return message.reply(botConfig.welcomeMessage);
  }
  if (!conversations[sender]) {
    conversations[sender] = { stage: 'awaitingAmount' };
    return message.reply(botConfig.welcomeMessage);
  }

  const conv = conversations[sender];

  // Stage 1: amount entry
  if (conv.stage === 'awaitingAmount') {
    const amt = parseInt(text);
    if (isNaN(amt) || amt <= 0) {
      return message.reply("⚠️ Please enter a valid deposit amount in Ksh.");
    }
    conv.amount = amt;
    conv.stage  = 'awaitingDepositNumber';
    return message.reply(parsePlaceholders(botConfig.depositChosen, { amount: String(amt) }));
  }

  // Stage 2: deposit number
  if (conv.stage === 'awaitingDepositNumber') {
    conv.depositNumber = text;
    conv.stage = 'processing';

    // Initiate STK push
    const ref = await sendSTKPush(conv.amount, conv.depositNumber);
    if (!ref) {
      delete conversations[sender];
      return message.reply("❌ Error initiating payment. Try again later.");
    }
    conv.stkRef = ref;

    // Alert admin of attempt
    const now = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    client.sendMessage(
      ADMIN_NUMBER,
      `${botConfig.fromAdmin}: Deposit attempt:\nAmount: Ksh ${conv.amount}\nNumber: ${conv.depositNumber}\nTime: ${now}`
    );

    // Inform user
    message.reply(parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' }));

    setTimeout(() => {
      client.sendMessage(sender, parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' }));
    }, 10000);

    setTimeout(async () => {
      const status = await fetchTransactionStatus(conv.stkRef);
      const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!status) {
        delete conversations[sender];
        return message.reply("❌ Error fetching status. Try again later.");
      }
      const st = status.status ? status.status.toUpperCase() : 'UNKNOWN';
      const code = status.provider_reference || '';
      const desc = status.ResultDesc || '';

      if (st === 'SUCCESS') {
        message.reply(parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(conv.amount),
          depositNumber: conv.depositNumber,
          mpesaCode: code,
          date: timestamp
        }));
        client.sendMessage(
          ADMIN_NUMBER,
          `${botConfig.fromAdmin}: Deposit success:\nAmount: Ksh ${conv.amount}\nNumber: ${conv.depositNumber}\nCode: ${code}\nTime: ${timestamp}`
        );
      } else {
        let err = 'Please try again.';
        if (/insufficient/i.test(desc)) err = 'Insufficient funds.';
        if (/pin/i.test(desc)) err = 'Incorrect PIN.';
        message.reply(`❌ Payment ${st}. ${err}\nType Start to retry.`);
        client.sendMessage(
          ADMIN_NUMBER,
          `${botConfig.fromAdmin}: Deposit failed:\nAmount: Ksh ${conv.amount}\nNumber: ${conv.depositNumber}\nError: ${err}\nTime: ${timestamp}`
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
<html><head><meta charset="UTF-8"><title>FY'S PROPERTY Bot QR</title>
<style>
  body { background:#222; color:#fff; text-align:center; font-family:Arial,sans-serif; padding:20px; }
  .qr-box { background:#333; display:inline-block; padding:20px; border-radius:8px; }
  img { max-width:250px; }
</style>
</head><body>
  <h1>Scan This QR to Authenticate Your Bot</h1>
  <div class="qr-box">
    ${ qrImg ? `<img src="${qrImg}" alt="QR Code">` : '<p>Waiting for QR…</p>' }
  </div>
</body></html>`);
});

app.listen(port, () => console.log(`Express running on port ${port}`));
client.initialize();
