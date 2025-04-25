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
// 1) Latest QR code (for the web dashboard)
let currentQR = "";

// 2) Admin JID
const ADMIN_NUMBER = '254701339573@c.us';

// 3) Editable bot texts
let botConfig = {
  fromAdmin:        "Admin GK-FY",
  channelID:        529,
  welcomeMessage:   "*👋 Welcome to FY'S PROPERTY Deposit Bot!*\nHow much would you like to deposit? 💰",
  depositChosen:    "*👍 Great!* You've chosen to deposit *Ksh {amount}*.\nNow, please provide your deposit number 📱",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate:  "*⏳ {seconds} seconds left...*\nFetching status soon!",
  paymentSuccess:   "*🎉 Payment Successful!*\n*💰 Amount:* Ksh {amount}\n*📞 Deposit #:* {depositNumber}\n*🆔 Txn Code:* {mpesaCode}\n*⏰ Time:* {date}\n{footer}",
  paymentFooter:    "Thank you for choosing FY'S PROPERTY! Type *Start* to deposit again."
};

// 4) In-memory state
const conversations = {};   // per-user deposit flow
const adminSessions = {};   // per-admin menu flow
let   savedUsers    = new Set();
let   savedGroups   = new Set();

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
  // Show the admin menu right away
  showAdminMenu(ADMIN_NUMBER);
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
4. Add Group (by JID)
5. View Groups
6. Delete Group
7. Bulk → Users
8. Bulk → Groups
9. Bulk → All
10. Config Bot Texts
11. Find & Join Group (invite link)
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
    amount,
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
          'Content-Type':  'application/json',
          'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6...'
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
      { headers: { 'Authorization': 'Basic QklYOXY0WlR4...'} }
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

  // Ignore anything coming from a group chat
  if (sender.endsWith('@g.us')) return;

  // Grab or initialize this admin's session
  const sess = adminSessions[sender] || {};

  // ──────── ADMIN MENU FLOW ─────────────────────
  if (sender === ADMIN_NUMBER) {
    // If we're in the middle of some submenu step...
    if (sess.awaiting) {

      // ---- 1) Config submenu ----
      if (sess.awaiting === 'configMenu') {
        switch (text) {
          case '0':
            delete adminSessions[sender];
            return showAdminMenu(sender);
          case '1':
            adminSessions[sender] = { awaiting: 'edit:fromAdmin' };
            return message.reply("Enter new Admin label:");
          case '2':
            adminSessions[sender] = { awaiting: 'edit:welcomeMessage' };
            return message.reply("Enter new Welcome Message:");
          case '3':
            adminSessions[sender] = { awaiting: 'edit:depositChosen' };
            return message.reply("Enter new Deposit Prompt template:");
          case '4':
            adminSessions[sender] = { awaiting: 'edit:paymentInitiated' };
            return message.reply("Enter new Payment Initiated template:");
          case '5':
            adminSessions[sender] = { awaiting: 'edit:countdownUpdate' };
            return message.reply("Enter new Countdown Update template:");
          case '6':
            adminSessions[sender] = { awaiting: 'edit:paymentSuccess' };
            return message.reply("Enter new Payment Success template:");
          case '7':
            adminSessions[sender] = { awaiting: 'edit:paymentFooter' };
            return message.reply("Enter new Payment Footer:");
          case '8':
            adminSessions[sender] = { awaiting: 'edit:channelID' };
            return message.reply("Enter new Channel ID (number):");
          default:
            await message.reply("Invalid choice; send 0 to cancel.");
            return showAdminMenu(sender);
        }
      }

      // ---- 2) Handle all the "edit:<key>" states ----
      if (sess.awaiting.startsWith('edit:')) {
        const key = sess.awaiting.split(':')[1];
        let   val = text;
        if (key === 'channelID') {
          const n = parseInt(text);
          if (isNaN(n)) {
            return message.reply("⚠️ Must be a number; try again:");
          }
          val = n;
        }
        botConfig[key] = val;
        await message.reply(`✅ Updated ${key}`);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ---- 3) Add User ----
      if (sess.awaiting === 'addUser') {
        const jid = formatPhoneNumber(text);
        if (!jid) {
          return message.reply("⚠️ Invalid phone; try again:");
        }
        savedUsers.add(jid);
        await message.reply(`*${botConfig.fromAdmin}:* Saved user ${jid}`);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ---- 4) Delete User ----
      if (sess.awaiting === 'delUser') {
        const jid = formatPhoneNumber(text);
        if (!jid || !savedUsers.has(jid)) {
          return message.reply("⚠️ Not found; try again:");
        }
        savedUsers.delete(jid);
        await message.reply(`*${botConfig.fromAdmin}:* Deleted user ${jid}`);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ---- 5) Add Group (must be JID) ----
      if (sess.awaiting === 'addGroup') {
        const jid = text;
        if (!jid.endsWith('@g.us')) {
          return message.reply("⚠️ Must end in @g.us; try again:");
        }
        savedGroups.add(jid);
        await message.reply(`*${botConfig.fromAdmin}:* Saved group ${jid}`);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ---- 6) Delete Group ----
      if (sess.awaiting === 'delGroup') {
        const jid = text;
        if (!jid.endsWith('@g.us') || !savedGroups.has(jid)) {
          return message.reply("⚠️ Not found; try again:");
        }
        savedGroups.delete(jid);
        await message.reply(`*${botConfig.fromAdmin}:* Deleted group ${jid}`);
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ---- 7) Bulk message entry ----
      if (sess.awaiting === 'bulk') {
        sess.message = text;
        adminSessions[sender] = {
          awaiting: 'confirmBulk',
          target: sess.target,
          message: sess.message
        };
        return message.reply(
          `*${botConfig.fromAdmin}:* Confirm send to ${sess.target}?\n\n"${sess.message}"\n\ntype YES or NO`
        );
      }

      // ---- 8) Bulk confirmation ----
      if (sess.awaiting === 'confirmBulk') {
        const payload = `*${botConfig.fromAdmin}:*\n${sess.message}`;
        if (lower === 'yes') {
          if (sess.target === 'users' || sess.target === 'all') {
            for (let u of savedUsers) await client.sendMessage(u, payload);
          }
          if (sess.target === 'groups' || sess.target === 'all') {
            for (let g of savedGroups) await client.sendMessage(g, payload);
          }
          await message.reply("✅ Bulk send complete.");
        } else {
          await message.reply("❌ Bulk send cancelled.");
        }
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }

      // ---- 9) Join any group via invite link ----
      if (sess.awaiting === 'joinGroupLink') {
        // take everything after the last '/'
        const code = text.split('/').pop().trim();
        try {
          const chat = await client.acceptInvite(code);
          savedGroups.add(chat.id._serialized);
          await message.reply(
            `*${botConfig.fromAdmin}:* Joined & saved group:\n` +
            `• Name: ${chat.name}\n` +
            `• JID: ${chat.id._serialized}`
          );
        } catch (e) {
          console.error("Join Group Error:", e);
          await message.reply("❌ Could not join group. Try again.");
        }
        delete adminSessions[sender];
        return showAdminMenu(sender);
      }
    }

    // ─ No submenu pending → interpret main menu choice ─
    switch (text) {
      case '0': return showAdminMenu(sender);
      case '1':
        adminSessions[sender] = { awaiting: 'addUser' };
        return message.reply("Enter phone (e.g. 0712345678):");
      case '2':
        return message.reply(
          savedUsers.size
            ? `*${botConfig.fromAdmin}:* Users:\n` + [...savedUsers].join('\n')
            : `*${botConfig.fromAdmin}:* No users saved.`
        );
      case '3':
        adminSessions[sender] = { awaiting: 'delUser' };
        return message.reply("Enter phone to delete:");
      case '4':
        adminSessions[sender] = { awaiting: 'addGroup' };
        return message.reply("Enter group JID (e.g. 12345@g.us):");
      case '5':
        return message.reply(
          savedGroups.size
            ? `*${botConfig.fromAdmin}:* Groups:\n` + [...savedGroups].join('\n')
            : `*${botConfig.fromAdmin}:* No groups saved.`
        );
      case '6':
        adminSessions[sender] = { awaiting: 'delGroup' };
        return message.reply("Enter group JID to delete:");
      case '7':
      case '8':
      case '9': {
        const target = text==='7'? 'users' : text==='8'? 'groups' : 'all';
        adminSessions[sender] = { awaiting: 'bulk', target };
        return message.reply(`Type message to send to ${target}:`);
      }
      case '10':
        adminSessions[sender] = { awaiting: 'configMenu' };
        return message.reply(
`Config Bot Texts:
1. Admin Label (${botConfig.fromAdmin})
2. Welcome Message
3. Deposit Prompt
4. Payment Initiated
5. Countdown Update
6. Payment Success
7. Payment Footer
8. Channel ID (${botConfig.channelID})
0. Cancel`
        );
      case '11':
        adminSessions[sender] = { awaiting: 'joinGroupLink' };
        return message.reply("Paste the WhatsApp invite link:");
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

  // Stage 1: ask amount
  if (conv.stage === 'awaitingAmount') {
    const amt = parseInt(text);
    if (isNaN(amt) || amt <= 0) {
      return message.reply("⚠️ Enter a valid amount in Ksh.");
    }
    conv.amount = amt;
    conv.stage  = 'awaitingDepositNumber';
    return message.reply(parsePlaceholders(botConfig.depositChosen, { amount: String(amt) }));
  }

  // Stage 2: ask deposit number
  if (conv.stage === 'awaitingDepositNumber') {
    conv.depositNumber = text;
    conv.stage = 'processing';

    const ref = await sendSTKPush(conv.amount, conv.depositNumber);
    if (!ref) {
      delete conversations[sender];
      return message.reply("❌ Error initiating payment. Try again later.");
    }
    conv.stkRef = ref;

    // alert admin
    const now = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    client.sendMessage(
      ADMIN_NUMBER,
      `*${botConfig.fromAdmin}:* Deposit attempt:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Time: ${now}`
    );

    // inform user
    message.reply(parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' }));

    setTimeout(() => {
      client.sendMessage(sender, parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' }));
    }, 10000);

    setTimeout(async () => {
      const status = await fetchTransactionStatus(conv.stkRef);
      const ts     = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!status) {
        delete conversations[sender];
        return message.reply("❌ Error fetching status. Try again later.");
      }
      const st   = (status.status||'').toUpperCase();
      const code = status.provider_reference || '';
      const desc = status.ResultDesc || '';

      if (st === 'SUCCESS') {
        message.reply(parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(conv.amount),
          depositNumber: conv.depositNumber,
          mpesaCode: code,
          date: ts
        }));
        client.sendMessage(
          ADMIN_NUMBER,
          `*${botConfig.fromAdmin}:* Deposit success:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Code: ${code}\n• Time: ${ts}`
        );
      } else {
        let err = 'Please try again.';
        if (/insufficient/i.test(desc)) err = 'Insufficient funds.';
        if (/pin/i.test(desc))        err = 'Incorrect PIN.';
        message.reply(`❌ Payment ${st}. ${err}\nType Start to retry.`);
        client.sendMessage(
          ADMIN_NUMBER,
          `*${botConfig.fromAdmin}:* Deposit failed:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Error: ${err}\n• Time: ${ts}`
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
  let qrImg = "";
  if (currentQR) {
    try { qrImg = await QRCode.toDataURL(currentQR); } catch {}
  }
  res.send(`
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>FY'S PROPERTY Bot QR</title>
<style>
  body { background:#222; color:#fff; text-align:center; font-family:Arial,sans-serif; padding:20px; }
  .qr-box { background:#333; display:inline-block; padding:20px; border-radius:8px; }
  img { max-width:250px; }
</style>
</head>
<body>
  <h1>Scan This QR to Authenticate Your Bot</h1>
  <div class="qr-box">
    ${ qrImg ? `<img src="${qrImg}" alt="QR Code">` : '<p>Waiting for QR…</p>' }
  </div>
</body>
</html>`);
});

app.listen(port, () => console.log(`Express running on port ${port}`));
client.initialize();
