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
// 1) Store the current QR code text for the Express page
let currentQR = "";

// 2) Admin phone number
const ADMIN_NUMBER = '254701339573@c.us';

// 3) Bot config: editable strings and channel ID
//    Admin can change these with commands like: edit <key> <newValue>
let botConfig = {
  welcomeMessage: "*👋 Welcome to FY'S PROPERTY Deposit Bot!*\nHow much would you like to deposit? 💰",
  depositChosen: "*👍 Great!* You've chosen to deposit *Ksh {amount}*.\nNow, please provide your deposit number (e.g., your account number) 📱",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*\nWe will fetch the status soon!",
  paymentSuccess: "*🎉 Payment Successful!*\n*💰 Amount:* Ksh {amount}\n*📞 Deposit Number:* {depositNumber}\n*🆔 MPESA Transaction Code:* {mpesaCode}\n*⏰ Date/Time (KE):* {date}\n{footer}",
  paymentFooter: "Thank you for choosing FY'S PROPERTY! Type *Start* to deposit again.",
  fromAdmin: "From Admin GK-FY",
  channelID: 529
};

// In-memory conversation state per user
const conversations = {};

// In-memory storage for saved users and groups
let savedUsers = new Set();
let savedGroups = new Set();
let bulkMessageSessions = {};

/***********************************************************
 * WHATSAPP CLIENT
 ***********************************************************/
const client = new Client({
  authStrategy: new LocalAuth()
});

// Save QR code text and show in terminal
client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

// When client is ready
client.on('ready', () => {
  console.log('WhatsApp client is *ready*!');
});

/***********************************************************
 * HELPER FUNCTIONS
 ***********************************************************/
// Replaces placeholders in a string, e.g. {amount}, {seconds}, {depositNumber}, {mpesaCode}, {date}, {footer}
function parsePlaceholders(template, data) {
  return template
    .replace(/{amount}/g, data.amount || '')
    .replace(/{depositNumber}/g, data.depositNumber || '')
    .replace(/{seconds}/g, data.seconds || '')
    .replace(/{mpesaCode}/g, data.mpesaCode || '')
    .replace(/{date}/g, data.date || '')
    .replace(/{footer}/g, botConfig.paymentFooter || '');
}

// Formats a phone number for WhatsApp. E.g. "07..." => "2547..."
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/[^\d]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('254')) {
    return null;
  }
  if (cleaned.length < 10) {
    return null;
  }
  return cleaned + '@c.us';
}

// Send STK push to Pay Hero
async function sendSTKPush(amount, phone) {
  const payload = {
    amount: amount,
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
    const response = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
        }
      }
    );
    return response.data.reference;
  } catch (error) {
    console.error("STK Push Error:", error);
    return null;
  }
}

// Fetch transaction status from Pay Hero
async function fetchTransactionStatus(ref) {
  try {
    const response = await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      {
        headers: {
          'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error("Status Fetch Error:", error);
    return null;
  }
}

// Send alert message to admin
function sendAdminAlert(text) {
  client.sendMessage(ADMIN_NUMBER, text);
}

// Admin help message
function getAdminHelp() {
  return (
    "ADMIN COMMANDS:\n" +
    "1) admin - Show this help.\n" +
    "2) edit <key> <newValue> - Edit any botConfig key.\n" +
    "3) save user <phone> - Save a user number.\n" +
    "4) save group <jid> - Save a group JID.\n" +
    "5) view users | view groups - List saved contacts.\n" +
    "6) delete user <phone> | delete group <jid> - Remove saved contact.\n" +
    "7) send to users | send to groups | send to all - Bulk message.\n" +
    "   Then type your message and confirm with yes/no."
  );
}

/***********************************************************
 * MESSAGE EVENT
 ***********************************************************/
client.on('message', async message => {
  const sender = message.from;
  const text = message.body.trim();
  const lowerText = text.toLowerCase();

  // ignore group-originated user messages here
  if (sender.endsWith('@g.us')) {
    return;
  }

  // admin-only commands
  if (sender === ADMIN_NUMBER) {
    if (lowerText === 'admin') {
      return message.reply(getAdminHelp());
    }

    if (lowerText.startsWith('edit ')) {
      const parts = text.split(' ');
      if (parts.length < 3) {
        return message.reply("⚠️ Invalid format. Use: edit <key> <newValue>");
      }
      const key = parts[1];
      const newValue = text.substring(`edit ${key} `.length).trim();
      if (!botConfig.hasOwnProperty(key)) {
        return message.reply("⚠️ Unknown key.");
      }
      if (key === 'channelID') {
        const newID = parseInt(newValue);
        if (isNaN(newID)) {
          return message.reply("⚠️ channelID must be a number.");
        }
        botConfig.channelID = newID;
        return message.reply(`channelID updated to: ${newID}`);
      }
      botConfig[key] = newValue;
      return message.reply(`${key} updated successfully.`);
    }

    // save user
    if (lowerText.startsWith('save user ')) {
      const raw = text.split('save user ')[1].trim();
      const num = formatPhoneNumber(raw);
      if (!num) return message.reply("⚠️ Invalid number format.");
      savedUsers.add(num);
      return message.reply(`✅ Saved user: ${num}`);
    }

    // save group
    if (lowerText.startsWith('save group ')) {
      const jid = text.split('save group ')[1].trim();
      if (!jid.endsWith('@g.us')) {
        return message.reply("⚠️ Invalid group JID.");
      }
      savedGroups.add(jid);
      return message.reply(`✅ Saved group: ${jid}`);
    }

    // view lists
    if (lowerText === 'view users') {
      const list = [...savedUsers].join('\n') || 'No users saved.';
      return message.reply(`Saved users:\n${list}`);
    }
    if (lowerText === 'view groups') {
      const list = [...savedGroups].join('\n') || 'No groups saved.';
      return message.reply(`Saved groups:\n${list}`);
    }

    // delete saved contact
    if (lowerText.startsWith('delete user ')) {
      const raw = text.split('delete user ')[1].trim();
      const num = formatPhoneNumber(raw);
      if (!savedUsers.has(num)) return message.reply("⚠️ Number not found.");
      savedUsers.delete(num);
      return message.reply(`🗑️ Deleted user: ${num}`);
    }
    if (lowerText.startsWith('delete group ')) {
      const jid = text.split('delete group ')[1].trim();
      if (!savedGroups.has(jid)) return message.reply("⚠️ Group not found.");
      savedGroups.delete(jid);
      return message.reply(`🗑️ Deleted group: ${jid}`);
    }

    // initiate bulk message session
    if (lowerText === 'send to users' || lowerText === 'send to groups' || lowerText === 'send to all') {
      const type = lowerText.replace('send to ', '');
      bulkMessageSessions[sender] = { type: type, message: null };
      return message.reply(`Type the message you want to send to ${type.replace('all','users and groups')}:`);
    }

    // collect bulk message text
    if (bulkMessageSessions[sender] && !bulkMessageSessions[sender].message) {
      bulkMessageSessions[sender].message = text;
      return message.reply(`Are you sure you want to send:\n\n"${text}"\n\ntype yes to send or no to cancel`);
    }

    // confirmation step
    if (bulkMessageSessions[sender] && bulkMessageSessions[sender].message) {
      if (lowerText === 'yes') {
        const session = bulkMessageSessions[sender];
        const msgText = session.message;

        if (session.type === 'users' || session.type === 'all') {
          for (let u of savedUsers) {
            await client.sendMessage(u, msgText);
          }
        }
        if (session.type === 'groups' || session.type === 'all') {
          for (let g of savedGroups) {
            await client.sendMessage(g, msgText);
          }
        }
        delete bulkMessageSessions[sender];
        return message.reply("✅ Bulk message sent.");
      }
      if (lowerText === 'no') {
        delete bulkMessageSessions[sender];
        return message.reply("❌ Bulk message cancelled.");
      }
    }

    // fall through to deposit flow if not an admin command
  }

  // deposit flow
  if (text.toLowerCase() === 'start') {
    conversations[sender] = { stage: 'awaitingAmount' };
    return message.reply(botConfig.welcomeMessage);
  }
  if (!conversations[sender]) {
    conversations[sender] = { stage: 'awaitingAmount' };
    return message.reply(botConfig.welcomeMessage);
  }

  const conv = conversations[sender];

  if (conv.stage === 'awaitingAmount') {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      return message.reply("⚠️ Please enter a valid deposit amount in Ksh.");
    }
    conv.amount = amount;
    conv.stage = 'awaitingDepositNumber';
    return message.reply(parsePlaceholders(botConfig.depositChosen, { amount: String(amount) }));
  }

  if (conv.stage === 'awaitingDepositNumber') {
    conv.depositNumber = text;
    conv.stage = 'processing';
    const ref = await sendSTKPush(conv.amount, conv.depositNumber);
    if (!ref) {
      delete conversations[sender];
      return message.reply("❌ Error initiating payment. Try again later.");
    }
    conv.stkRef = ref;
    const attemptTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    sendAdminAlert(
      `Deposit attempt:\nAmount: Ksh ${conv.amount}\nNumber: ${conv.depositNumber}\nTime: ${attemptTime}`
    );
    message.reply(parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' }));

    setTimeout(() => {
      client.sendMessage(sender, parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' }));
    }, 10000);

    setTimeout(async () => {
      const status = await fetchTransactionStatus(conv.stkRef);
      const now = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!status) {
        delete conversations[sender];
        return message.reply("❌ Error fetching status.");
      }
      const stat = status.status ? status.status.toUpperCase() : 'UNKNOWN';
      const refCode = status.provider_reference || '';
      const desc = status.ResultDesc || '';
      if (stat === 'SUCCESS') {
        message.reply(parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(conv.amount),
          depositNumber: conv.depositNumber,
          mpesaCode: refCode,
          date: now
        }));
        sendAdminAlert(`Deposit success:\nAmount: Ksh ${conv.amount}\nNumber: ${conv.depositNumber}\nCode: ${refCode}\nTime: ${now}`);
      } else {
        let errMsg = 'Please try again.';
        if (desc.toLowerCase().includes('insufficient')) errMsg = 'Insufficient funds.';
        if (desc.toLowerCase().includes('pin')) errMsg = 'Incorrect PIN.';
        message.reply(`❌ Payment ${stat}. ${errMsg}\nType Start to retry.`);
        sendAdminAlert(`Deposit failed:\nAmount: Ksh ${conv.amount}\nNumber: ${conv.depositNumber}\nError: ${errMsg}\nTime: ${now}`);
      }
      delete conversations[sender];
    }, 20000);

    return;
  }
});

/***********************************************************
 * EXPRESS SERVER to display the QR code
 ***********************************************************/
const app = express();
const port = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  let qrImage = '';
  if (currentQR) {
    try {
      qrImage = await QRCode.toDataURL(currentQR);
    } catch (err) {
      console.error("QR code error:", err);
    }
  }
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>FY'S PROPERTY - WhatsApp Bot QR</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { background: #222; color: #fff; font-family: Arial, sans-serif; text-align: center; padding: 20px; }
        h1 { color: #12c99b; margin-bottom: 20px; }
        .qr-container { background: #333; display: inline-block; padding: 20px; border-radius: 10px; }
        img { max-width: 250px; margin: 10px; }
      </style>
    </head>
    <body>
      <h1>Scan This QR Code to Authenticate Your Bot</h1>
      <div class="qr-container">
        ${qrImage ? `<img src="${qrImage}" alt="WhatsApp QR Code" />` : '<p>No QR code yet. Please wait...</p>'}
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});

// start client
client.initialize();
