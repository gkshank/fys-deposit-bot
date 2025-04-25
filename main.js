/*******************************************************************
 * main.js
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const axios = require('axios');

/***********************************************************
 * GLOBAL / CONFIG
 ***********************************************************/
// 1) QR code for Express page
let currentQR = "";

// 2) Admin JID
const ADMIN_NUMBER = '254701339573@c.us';

// 3) Bot‐wide texts (admin can edit via menu)
let botConfig = {
  fromAdmin: "Admin GK-FY",   // coachable label
  channelID: 529,
  welcomeMessage: "*👋 Welcome to FY'S PROPERTY Deposit Bot!* ...",
  depositChosen: "*👍 Great!* You've chosen to deposit *Ksh {amount}*.",
  paymentInitiated: "*⏳ Payment initiated!* ...",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  paymentSuccess: "*🎉 Payment Successful!* ...",
  paymentFooter: "Thank you for choosing FY'S PROPERTY!"
};

// 4) In‐memory state
const conversations = {};            // deposit flows
const adminSessions = {};            // numeric‐menu state
let savedUsers = new Set();          // JIDs
let savedGroups = new Set();         // group JIDs

/***********************************************************
 * WHATSAPP CLIENT
 ***********************************************************/
const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('Client is ready');
  //  — Send admin an alert that we’re live!
  client.sendMessage(
    ADMIN_NUMBER,
    `${botConfig.fromAdmin}: Bot is now live!  
Please choose an option by number:  
1. Manage Users  
2. Manage Groups  
3. Bulk Messaging  
4. Edit Bot Config  
0. Show Menu`
  );
});

/***********************************************************
 * HELPERS
 ***********************************************************/
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/[^\d]/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  if (!cleaned.startsWith('254') || cleaned.length < 10) return null;
  return cleaned + '@c.us';
}

function parsePlaceholders(tpl, data) {
  return tpl
    .replace(/{amount}/g, data.amount || '')
    .replace(/{seconds}/g, data.seconds || '')
    .replace(/{depositNumber}/g, data.depositNumber || '')
    .replace(/{mpesaCode}/g, data.mpesaCode || '')
    .replace(/{date}/g, data.date || '')
    .replace(/{footer}/g, botConfig.paymentFooter);
}

async function sendSTKPush(amount, phone) {
  const payload = { /* … your existing payload … */ };
  try {
    const res = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      { headers: { Authorization: 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6...' } }
    );
    return res.data.reference;
  } catch {
    return null;
  }
}

async function fetchTransactionStatus(ref) {
  try {
    const res = await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      { headers: { Authorization: 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6...' } }
    );
    return res.data;
  } catch {
    return null;
  }
}

/***********************************************************
 * ADMIN MENU LOGIC (numeric)
 ***********************************************************/
function showAdminMenu(to) {
  client.sendMessage(
    to,
    `${botConfig.fromAdmin}: Please choose by number:  
1. Add User  
2. View Users  
3. Delete User  
4. Add Group  
5. View Groups  
6. Delete Group  
7. Bulk → Users  
8. Bulk → Groups  
9. Bulk → All  
10. Edit Bot Label  
0. Show Menu`
  );
}

client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();

  // 1) Admin‐only branch
  if (from === ADMIN_NUMBER) {
    const sess = adminSessions[from] || {};

    // If we’re waiting for a reply to a prior option…
    if (sess.awaiting) {
      switch (sess.awaiting) {
        case 'addUser':
          {
            const jid = formatPhoneNumber(txt);
            if (!jid) {
              await msg.reply("⚠️ Invalid phone format. Try again.");
            } else {
              savedUsers.add(jid);
              await msg.reply(`✅ Saved user: ${jid}`);
            }
            delete adminSessions[from];
            return showAdminMenu(from);
          }
        case 'delUser':
          {
            const jid = formatPhoneNumber(txt);
            if (!savedUsers.has(jid)) {
              await msg.reply("⚠️ Not found.");
            } else {
              savedUsers.delete(jid);
              await msg.reply(`🗑️ Deleted user: ${jid}`);
            }
            delete adminSessions[from];
            return showAdminMenu(from);
          }
        case 'addGroup':
          {
            const jid = txt;
            if (!jid.endsWith('@g.us')) {
              await msg.reply("⚠️ Must end with @g.us");
            } else {
              savedGroups.add(jid);
              await msg.reply(`✅ Saved group: ${jid}`);
            }
            delete adminSessions[from];
            return showAdminMenu(from);
          }
        case 'delGroup':
          {
            const jid = txt;
            if (!savedGroups.has(jid)) {
              await msg.reply("⚠️ Not found.");
            } else {
              savedGroups.delete(jid);
              await msg.reply(`🗑️ Deleted group: ${jid}`);
            }
            delete adminSessions[from];
            return showAdminMenu(from);
          }
        case 'bulk':
          {
            // txt = the message to send
            sess.message = txt;
            adminSessions[from] = sess;  // preserve type
            await msg.reply(`Confirm sending to ${sess.target}?  
"${txt}"  
Type YES or NO.`);
            return;
          }
        case 'confirmBulk':
          {
            if (txt.toLowerCase() === 'yes') {
              const { target, message: m } = sess;
              if (target === 'users' || target === 'all') {
                for (let u of savedUsers) await client.sendMessage(u, m);
              }
              if (target === 'groups' || target === 'all') {
                for (let g of savedGroups) await client.sendMessage(g, m);
              }
              await msg.reply("✅ Bulk send complete.");
            } else {
              await msg.reply("❌ Bulk send cancelled.");
            }
            delete adminSessions[from];
            return showAdminMenu(from);
          }
        case 'editLabel':
          {
            botConfig.fromAdmin = txt;
            await msg.reply(`✅ Admin label now: ${txt}`);
            delete adminSessions[from];
            return showAdminMenu(from);
          }
      }
    }

    // Otherwise, interpret txt as menu choice:
    switch (txt) {
      case '0': return showAdminMenu(from);
      case '1':
        adminSessions[from] = { awaiting: 'addUser' };
        return msg.reply("Enter the phone number (e.g. 0712345678) to save:");
      case '2':
        return msg.reply(
          savedUsers.size
            ? "Saved Users:\n" + [...savedUsers].join('\n')
            : "No users saved."
        );
      case '3':
        adminSessions[from] = { awaiting: 'delUser' };
        return msg.reply("Enter the phone number to delete:");
      case '4':
        adminSessions[from] = { awaiting: 'addGroup' };
        return msg.reply("Enter the group JID (e.g. 12345@g.us) to save:");
      case '5':
        return msg.reply(
          savedGroups.size
            ? "Saved Groups:\n" + [...savedGroups].join('\n')
            : "No groups saved."
        );
      case '6':
        adminSessions[from] = { awaiting: 'delGroup' };
        return msg.reply("Enter the group JID to delete:");
      case '7':
      case '8':
      case '9':
        {
          const target = (txt === '7' ? 'users' : txt === '8' ? 'groups' : 'all');
          adminSessions[from] = { awaiting: 'bulk', target };
          return msg.reply(`Type the message you want to send to ${target}:`);
        }
      case '10':
        adminSessions[from] = { awaiting: 'editLabel' };
        return msg.reply("Enter new Admin label (this appears before every admin message):");
      default:
        return showAdminMenu(from);
    }
  }

  // 2) Non‐admin or deposit logic continues here…
  if (txt.toLowerCase() === 'start') {
    conversations[from] = { stage: 'awaitingAmount' };
    return msg.reply(botConfig.welcomeMessage);
  }
  if (!conversations[from]) {
    conversations[from] = { stage: 'awaitingAmount' };
    return msg.reply(botConfig.welcomeMessage);
  }

  // … your existing deposit‐flow code unchanged …
});

/***********************************************************
 * EXPRESS SERVER (QR page)
 ***********************************************************/
const app = express();
const port = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  let qrImage = '';
  if (currentQR) {
    try { qrImage = await QRCode.toDataURL(currentQR); }
    catch { /*ignore*/ }
  }
  res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>FY'S PROPERTY - Bot QR</title>
    <style>body{background:#222;color:#fff;text-align:center;padding:20px;}
    .qr{background:#333;display:inline-block;padding:20px;border-radius:10px;}
    img{max-width:250px;}</style>
    </head><body>
      <h1>Scan QR to auth your bot</h1>
      <div class="qr">
        ${qrImage ? `<img src="${qrImage}"/>` : '<p>Waiting for QR…</p>'}
      </div>
    </body></html>
  `);
});

app.listen(port, () => console.log(`HTTP on port ${port}`));
client.initialize();
