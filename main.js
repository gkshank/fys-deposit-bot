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
  fromAdmin:        "Admin GK-FY",     // editable label
  channelID:        529,              // editable channel for STK
  welcomeMessage:   "*👋 Welcome to FY'S PROPERTY Deposit Bot!*\nHow much would you like to deposit? 💰",
  depositChosen:    "*👍 Great!* You've chosen to deposit *Ksh {amount}*.\nNow, please provide your deposit number 📱",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate:  "*⏳ {seconds} seconds left...*\nWe will fetch the status soon!",
  paymentSuccess:   "*🎉 Payment Successful!*\n*💰 Amount:* Ksh {amount}\n*📞 Deposit Number:* {depositNumber}\n*🆔 Transaction Code:* {mpesaCode}\n*⏰ Date/Time (KE):* {date}\n{footer}",
  paymentFooter:    "Thank you for choosing FY'S PROPERTY! Type *Start* to deposit again."
};

// 4) In-memory state
const conversations = {};   // per-user deposit flows
const adminSessions = {};   // per-admin menu flows
let savedUsers    = new Set();
let savedGroups   = new Set();

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
  // Auto-alert admin and show menu on startup
  showAdminMenu();
});

/***********************************************************
 * HELPERS
 ***********************************************************/
function showAdminMenu() {
  const menu =
`${botConfig.fromAdmin}: Choose an option by number or paste a group link:
1. Add User
2. View Users
3. Delete User
4. Add Group JID
5. View Groups
6. Delete Group
7. Bulk → Users
8. Bulk → Groups
9. Bulk → All
10. Config Bot Texts
0. Show Menu`;
  client.sendMessage(ADMIN_NUMBER, menu);
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
      { headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic QklYOXY0...'
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
      { headers: { 'Authorization': 'Basic QklYOXY0...' } }
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
  const from = message.from;
  const txt  = message.body.trim();
  const lower = txt.toLowerCase();

  // ignore messages from group threads in deposit/admin logic
  if (from.endsWith('@g.us')) return;

  // ──────── ADMIN LOGIC ─────────────────────────
  if (from === ADMIN_NUMBER) {
    // 1) Automatic group-link parser
    if (txt.includes('chat.whatsapp.com/')) {
      const parts = txt.split('chat.whatsapp.com/')[1].split(/[ \n]/)[0];
      const code  = parts.trim();
      const jid   = `${code}@g.us`;
      savedGroups.add(jid);
      await message.reply(`✅ Parsed & saved group JID:\n${jid}`);
      return showAdminMenu();
    }

    const sess = adminSessions[from] || {};

    // -- if waiting for submenu input --
    if (sess.awaiting) {
      // Config submenu
      if (sess.awaiting === 'configMenu') {
        switch (txt) {
          case '0':
            delete adminSessions[from];
            return showAdminMenu();
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8': {
            const mapping = {
              '1':'fromAdmin','2':'welcomeMessage','3':'depositChosen',
              '4':'paymentInitiated','5':'countdownUpdate','6':'paymentSuccess',
              '7':'paymentFooter','8':'channelID'
            };
            const key = mapping[txt];
            adminSessions[from] = { awaiting: `edit:${key}` };
            return message.reply(`Enter new value for ${key}:`);
          }
          default:
            return message.reply("Invalid. Send 0 to cancel.").then(showAdminMenu);
        }
      }

      // Handle all "edit:<key>" states
      if (sess.awaiting.startsWith('edit:')) {
        const key = sess.awaiting.split(':')[1];
        let val = txt;
        if (key === 'channelID') {
          const n = parseInt(txt);
          if (isNaN(n)) return message.reply("⚠️ Must be a number. Try again:");
          val = n;
        }
        botConfig[key] = val;
        await message.reply(`✅ Updated ${key}.`);
        delete adminSessions[from];
        return showAdminMenu();
      }

      // Add User
      if (sess.awaiting === 'addUser') {
        const jid = formatPhoneNumber(txt);
        if (!jid) return message.reply("⚠️ Invalid. Try again:");
        savedUsers.add(jid);
        await message.reply(`✅ Saved user: ${jid}`);
        delete adminSessions[from];
        return showAdminMenu();
      }

      // Delete User
      if (sess.awaiting === 'delUser') {
        const jid = formatPhoneNumber(txt);
        if (!jid || !savedUsers.has(jid)) return message.reply("⚠️ Not found. Try again:");
        savedUsers.delete(jid);
        await message.reply(`🗑️ Deleted user: ${jid}`);
        delete adminSessions[from];
        return showAdminMenu();
      }

      // Add Group JID manually
      if (sess.awaiting === 'addGroup') {
        const jid = txt;
        if (!jid.endsWith('@g.us')) return message.reply("⚠️ Must end with @g.us. Try again:");
        savedGroups.add(jid);
        await message.reply(`✅ Saved group: ${jid}`);
        delete adminSessions[from];
        return showAdminMenu();
      }

      // Delete Group
      if (sess.awaiting === 'delGroup') {
        const jid = txt;
        if (!jid.endsWith('@g.us') || !savedGroups.has(jid)) {
          return message.reply("⚠️ Not found. Try again:");
        }
        savedGroups.delete(jid);
        await message.reply(`🗑️ Deleted group: ${jid}`);
        delete adminSessions[from];
        return showAdminMenu();
      }

      // Bulk: entering message
      if (sess.awaiting === 'bulk') {
        sess.message = txt;
        adminSessions[from] = { awaiting: 'confirmBulk', target: sess.target, message: sess.message };
        return message.reply(
          `*${botConfig.fromAdmin}:* Confirm send to ${sess.target}?\n\n"${sess.message}"\n\ntype YES or NO`
        );
      }

      // Bulk: confirm
      if (sess.awaiting === 'confirmBulk') {
        if (lower === 'yes') {
          const payload = `*${botConfig.fromAdmin}:*\n${sess.message}`;
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
        delete adminSessions[from];
        return showAdminMenu();
      }
    }

    // -- no pending action: interpret menu choice --
    switch (txt) {
      case '0': return showAdminMenu();
      case '1':
        adminSessions[from] = { awaiting: 'addUser' };
        return message.reply("Enter phone (e.g. 0712345678) to add:");
      case '2':
        return message.reply(
          savedUsers.size
            ? "Saved Users:\n" + [...savedUsers].join('\n')
            : "No users saved."
        );
      case '3':
        adminSessions[from] = { awaiting: 'delUser' };
        return message.reply("Enter phone to delete:");
      case '4':
        adminSessions[from] = { awaiting: 'addGroup' };
        return message.reply("Enter group JID (e.g. ABCDE@g.us) to add:");
      case '5':
        return message.reply(
          savedGroups.size
            ? "Saved Groups:\n" + [...savedGroups].join('\n')
            : "No groups saved."
        );
      case '6':
        adminSessions[from] = { awaiting: 'delGroup' };
        return message.reply("Enter group JID to delete:");
      case '7':
      case '8':
      case '9': {
        const target = txt === '7' ? 'users' : txt === '8' ? 'groups' : 'all';
        adminSessions[from] = { awaiting: 'bulk', target };
        return message.reply(`Type the message to send to ${target}:`);
      }
      case '10':
        adminSessions[from] = { awaiting: 'configMenu' };
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
      default:
        return showAdminMenu();
    }
  }

  // ──────── DEPOSIT BOT FLOW ─────────────────────
  if (lower === 'start') {
    conversations[from] = { stage: 'awaitingAmount' };
    return message.reply(botConfig.welcomeMessage);
  }
  if (!conversations[from]) {
    conversations[from] = { stage: 'awaitingAmount' };
    return message.reply(botConfig.welcomeMessage);
  }
  const conv = conversations[from];

  // Stage 1: amount entry
  if (conv.stage === 'awaitingAmount') {
    const amt = parseInt(txt);
    if (isNaN(amt) || amt <= 0) {
      return message.reply("⚠️ Please enter a valid deposit amount in Ksh.");
    }
    conv.amount = amt;
    conv.stage  = 'awaitingDepositNumber';
    return message.reply(parsePlaceholders(botConfig.depositChosen, { amount: String(amt) }));
  }

  // Stage 2: deposit number
  if (conv.stage === 'awaitingDepositNumber') {
    conv.depositNumber = txt;
    conv.stage = 'processing';

    // Initiate STK push
    const ref = await sendSTKPush(conv.amount, conv.depositNumber);
    if (!ref) {
      delete conversations[from];
      return message.reply("❌ Error initiating payment. Try again later.");
    }
    conv.stkRef = ref;

    // Alert admin
    const now = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    client.sendMessage(
      ADMIN_NUMBER,
      `*${botConfig.fromAdmin}:* Deposit attempt:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Time: ${now}`
    );

    // Inform user
    message.reply(parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' }));

    setTimeout(() => {
      client.sendMessage(from, parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' }));
    }, 10000);

    setTimeout(async () => {
      const status = await fetchTransactionStatus(conv.stkRef);
      const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!status) {
        delete conversations[from];
        return message.reply("❌ Error fetching status. Try again later.");
      }
      const st   = (status.status || '').toUpperCase();
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
          `*${botConfig.fromAdmin}:* Deposit success:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Code: ${code}\n• Time: ${timestamp}`
        );
      } else {
        let err = 'Please try again.';
        if (/insufficient/i.test(desc)) err = 'Insufficient funds.';
        if (/pin/i.test(desc))        err = 'Incorrect PIN.';
        message.reply(`❌ Payment ${st}. ${err}\nType Start to retry.`);
        client.sendMessage(
          ADMIN_NUMBER,
          `*${botConfig.fromAdmin}:* Deposit failed:\n• Amount: Ksh ${conv.amount}\n• Number: ${conv.depositNumber}\n• Error: ${err}\n• Time: ${timestamp}`
        );
      }
      delete conversations[from];
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
</style></head><body>
  <h1>Scan This QR to Authenticate Your Bot</h1>
  <div class="qr-box">
    ${ qrImg ? `<img src="${qrImg}" alt="QR Code">` : '<p>Waiting for QR…</p>' }
  </div>
</body></html>`);
});

app.listen(port, () => console.log(`Express running on port ${port}`));
client.initialize();
