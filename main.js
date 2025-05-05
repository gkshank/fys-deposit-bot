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

////////////////////////////////////////////////////////////////////////////////
// CONFIG & STORAGE
////////////////////////////////////////////////////////////////////////////////
const DATA_PATH     = path.join(__dirname, 'users.json');
const loadUsers     = () => {
  if (fs.existsSync(DATA_PATH)) {
    return JSON.parse(fs.readFileSync(DATA_PATH));
  }
  return {};
};
const saveUsers     = users => fs.writeFileSync(DATA_PATH, JSON.stringify(users, null,2));

let users = loadUsers();
// Structure: {
//   "<jid>": {
//     phone, name, registeredAt, balance,
//     banned: false, banReason: '',
//     messageCount:0, totalCharges:0,
//     recipients: [ '<jid>', ... ],
//     support: { open: false, ticketId: null }
//   }, ...
// }

////////////////////////////////////////////////////////////////////////////////
// BOT & EXPRESS SETUP
////////////////////////////////////////////////////////////////////////////////
const client   = new Client({ authStrategy: new LocalAuth() });
const app      = express();
const PORT     = process.env.PORT || 3000;

let currentQR = '';
client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

////////////////////////////////////////////////////////////////////////////////
// BOT CONFIG
////////////////////////////////////////////////////////////////////////////////
let botConfig = {
  fromAdmin:    "Admin GK-FY",
  channelID:    529,
  costPerChar:  0.01,     // Ksh per character
  // existing texts...
  welcome:      "👋 Welcome to FY'S PROPERTY Bot! Please register by sending your *phone number* (e.g. 0712345678).",
  askName:      "✅ Got it! Now please reply with your *name* to complete registration.",
  regSuccess:   (name)=>`🎉 Thanks ${name}! You’re all set. Your balance is Ksh 0. You can now:\n1. Send Bulk Message\n2. Add Recipient\n3. Remove Recipient\n4. Top-up Balance\n5. Check Balance\n6. Contact Support`,
  userMenu:     "Please choose:\n1. Send Bulk Message\n2. Add Recipient\n3. Remove Recipient\n4. Top-up Balance\n5. Check Balance\n6. Contact Support",
  notEnoughBal: (cost,balance)=>`⚠️ Cost is Ksh ${cost.toFixed(2)}, but your balance is Ksh ${balance.toFixed(2)}. Please top-up first.`,
  topupPrompt:  "Enter amount to top-up (Ksh):",
  supportPrompt:"Please type your support message; we’ll connect you to admin.",
  closedSupport:"✅ Your support ticket is closed. Back to main menu:\n"  
};

////////////////////////////////////////////////////////////////////////////////
// ADMIN CONFIG
////////////////////////////////////////////////////////////////////////////////
const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);

// helper: always append back/menu to admin messages
async function adminReply(jid,text) {
  const suffix = "\n\n0️⃣ Go Back 🔙\n00️⃣ Main Menu";
  await safeSend(jid, text + suffix);
}

////////////////////////////////////////////////////////////////////////////////
// SAFE SEND (catches errors)
////////////////////////////////////////////////////////////////////////////////
async function safeSend(jid, msg) {
  try { await client.sendMessage(jid, msg); }
  catch(e){
    console.error(`Error→${jid}:`,e.message);
    if (jid!==SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${jid}:\n${e.message}`);
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// USER FLOW
////////////////////////////////////////////////////////////////////////////////
const conversations = {}; // per-user state

client.on('message', async msg => {
  const from = msg.from, txt = msg.body.trim(), lc = txt.toLowerCase();
  if (from.endsWith('@g.us')) return;

  // -- ADMIN receives support replies from user --
  // if user has support.open and no admin flow, forward to admin
  if (users[from]?.support?.open && !adminUsers.has(from)) {
    // tag by ticketId
    const ticket = users[from].support.ticketId;
    await safeSend(SUPER_ADMIN,
      `🎟️ Support #${ticket} from ${users[from].name}:\n"${txt}"`
    );
    return msg.reply("📥 Message sent to support. Type 'close' to end.");
  }
  if (lc==='close' && users[from]?.support?.open) {
    users[from].support.open = false;
    saveUsers(users);
    return msg.reply(botConfig.closedSupport + botConfig.userMenu);
  }

  // -- ADMIN replies into support --
  // If adminUsers send "reply <ticketId> <message>"
  if (adminUsers.has(from) && lc.startsWith('reply ')) {
    const [_, tid, ...rest] = txt.split(' ');
    const supportText = rest.join(' ');
    // find user with that ticket
    const targetJid = Object.keys(users).find(j=>
      users[j].support.open && users[j].support.ticketId===tid
    );
    if (targetJid) {
      await client.sendMessage(targetJid, `🛎️ Support Reply:\n"${supportText}"`);
      return adminReply(from, `✅ Replied to ticket ${tid}.`);
    } else {
      return adminReply(from, `⚠️ No open ticket ${tid}.`);
    }
  }

  // **User registration & main menu**
  if (!users[from]) {
    // registration stages
    if (!conversations[from]) {
      conversations[from] = { stage:'awaitPhone' };
      return msg.reply(botConfig.welcome);
    }
    const conv = conversations[from];

    if (conv.stage==='awaitPhone') {
      // store phone, ask name
      const normalized = txt.replace(/[^\d]/g,'');
      users[from] = {
        phone: normalized,
        name:'',
        registeredAt: new Date().toISOString(),
        balance:0,
        banned:false, banReason:'',
        messageCount:0, totalCharges:0,
        recipients:[],
        support:{ open:false, ticketId:null }
      };
      saveUsers(users);
      conv.stage = 'awaitName';
      return msg.reply(botConfig.askName);
    }
    if (conv.stage==='awaitName') {
      users[from].name = txt;
      saveUsers(users);
      delete conversations[from];
      return msg.reply(botConfig.regSuccess(txt));
    }
  }

  // registered user flows…
  const user = users[from];

  // banned?
  if (user.banned) {
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }

  // user menu
  if (lc==='menu' || lc==='6' && !user.support.open) {
    return msg.reply(botConfig.userMenu);
  }

  // 1. Send Bulk Message
  if (lc==='1' || lc.startsWith('send ')) {
    // format: send <your message>
    const message = lc==='1'? null : txt.slice(5).trim();
    if (!message) {
      conversations[from] = { stage:'awaitBulk' };
      return msg.reply("✏️ Please type the message to send to your recipients:");
    }
    // else inline
    return handleBulk(from, message, msg);
  }
  if (conversations[from]?.stage==='awaitBulk') {
    const message = txt;
    delete conversations[from];
    return handleBulk(from, message, msg);
  }

  // 2. Add Recipient
  if (lc==='2' || conversations[from]?.stage==='addRec') {
    if (lc==='2') {
      conversations[from] = { stage:'addRec' };
      return msg.reply("📥 Enter the phone number to add as recipient:");
    }
    const norm = formatPhone(txt);
    if (!norm) return msg.reply("⚠️ Invalid phone. Retry:");
    if (!user.recipients.includes(norm)) {
      user.recipients.push(norm);
      saveUsers(users);
      delete conversations[from];
      return msg.reply(`✅ Added recipient ${norm}`);
    } else {
      delete conversations[from];
      return msg.reply("⚠️ Already in your list.");
    }
  }

  // 3. Remove Recipient
  if (lc==='3' || conversations[from]?.stage==='delRec') {
    if (lc==='3') {
      conversations[from] = { stage:'delRec' };
      return msg.reply("🗑️ Enter the phone number to remove:");
    }
    const norm = formatPhone(txt);
    if (!norm || !user.recipients.includes(norm)) {
      delete conversations[from];
      return msg.reply("⚠️ Not in your list.");
    }
    user.recipients = user.recipients.filter(r=>r!==norm);
    saveUsers(users);
    delete conversations[from];
    return msg.reply(`🗑️ Removed recipient ${norm}`);
  }

  // 4. Top-up Balance
  if (lc==='4' || conversations[from]?.stage==='topupAmt') {
    if (lc==='4') {
      conversations[from] = { stage:'topupAmt' };
      return msg.reply(botConfig.topupPrompt);
    }
    const ksh = parseFloat(txt);
    if (isNaN(ksh) || ksh<=0) {
      return msg.reply("⚠️ Enter a valid top-up amount:");
    }
    // send STK
    const ref = await sendSTKPush(ksh, user.phone);
    if (!ref) {
      delete conversations[from];
      return msg.reply("❌ Top-up failed to initiate. Try later.");
    }
    // after some seconds we fetch status
    msg.reply("⏳ Top-up initiated. Waiting for confirmation...");
    setTimeout(async()=>{
      const st = await fetchTransactionStatus(ref);
      if (st?.status==='SUCCESS') {
        user.balance += ksh;
        saveUsers(users);
        await client.sendMessage(from, `🎉 Top-up successful! New balance: Ksh ${user.balance.toFixed(2)}`);
      } else {
        await client.sendMessage(from, "❌ Top-up failed or timed out.");
      }
      delete conversations[from];
    },20000);
    return;
  }

  // 5. Check Balance
  if (lc==='5') {
    return msg.reply(`💰 Your balance: Ksh ${user.balance.toFixed(2)}\nMessages sent: ${user.messageCount}\nTotal charges: Ksh ${user.totalCharges.toFixed(2)}`);
  }

  // 6. Contact Support
  if (lc==='6') {
    if (!user.support.open) {
      // open ticket
      const ticket = Date.now().toString().slice(-6);
      user.support = { open:true, ticketId:ticket };
      saveUsers(users);
      await msg.reply(`🆘 Support opened (#${ticket}). Please type your message:`);
    } else {
      await msg.reply("🆘 Your support is already open. Type your message or 'close' to end.");
    }
    return;
  }

  // anything else → show menu
  return msg.reply(botConfig.userMenu);
});

////////////////////////////////////////////////////////////////////////////////
// BULK HANDLER
////////////////////////////////////////////////////////////////////////////////
async function handleBulk(from, message, msg) {
  const user = users[from];
  if (user.recipients.length===0) {
    return msg.reply("⚠️ You have no recipients. Add some first.");
  }
  // cost
  const cost = message.length * botConfig.costPerChar;
  if (user.balance < cost) {
    return msg.reply(botConfig.notEnoughBal(cost, user.balance));
  }
  // yes/no confirm
  conversations[from] = { stage:'confirmBulk', message };
  return msg.reply(
    `📝 Preview:\n"${message}"\nCost: Ksh ${cost.toFixed(2)}\n1️⃣ Send  2️⃣ Cancel`
  );
}

client.on('message', async msg => {
  // confirm bulk
  const from=msg.from, txt=msg.body.trim();
  if (conversations[from]?.stage==='confirmBulk') {
    if (txt==='1') {
      const { message } = conversations[from];
      delete conversations[from];
      const user = users[from];
      const cost = message.length * botConfig.costPerChar;
      // send to each
      for (let r of user.recipients) {
        await safeSend(r, message);
      }
      // deduct
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
});

////////////////////////////////////////////////////////////////////////////////
// ADMIN MENU & FLOWS (extended)
////////////////////////////////////////////////////////////////////////////////
const adminSessions = {};

client.on('message', async msg => {
  const from = msg.from, txt = msg.body.trim(), lc = txt.toLowerCase();
  if (!adminUsers.has(from)) return;  // only admin here

  const sess = adminSessions[from] || {};

  // back/main
  if (txt==='00') { delete adminSessions[from]; return adminReply(from,"🏠 Back to main."); }
  if (txt==='0')  { delete adminSessions[from]; return adminReply(from,"🔙 Went back."); }

  // main menu
  if (!sess.awaiting) {
    const menu = 
`${botConfig.fromAdmin}: *Admin Main Menu*
1. View All Users
2. Change Cost/Char (current Ksh ${botConfig.costPerChar})
3. Top-up/Deduct User
4. Ban/Unban User
5. Bulk → All Registered
6. View Recipients of User
7. Show QR Dashboard
8. Other Configs (texts, channelID...)`;
    return adminReply(from, menu);
  }

  // handle options
  switch (sess.awaiting) {
    // ...
    // For brevity, assume you’ll implement each:
    // - on "1": iterate users and show details
    // - on "2": ask new costPerChar, then update
    // - on "3": top-up/deduct by asking phone + amount + add/deduct
    // - on "4": ban/unban by phone + reason
    // - on "5": ask message, confirm, send to all registered <jid>
    // - on "6": ask phone, list recipients
    // - on "7": show the glass-style QR HTML endpoint
    // - on "8": fall through to your existing configMenu flow
    //
    // Use adminReply(...) for all prompts and confirmations,
    // updating `botConfig`, `users[...]`, and saving to disk.

    default:
      delete adminSessions[from];
      return adminReply(from, "⚠️ Option not recognized. Back to main.");
  }
});

////////////////////////////////////////////////////////////////////////////////
// EXPRESS SERVER (QR Dashboard)
////////////////////////////////////////////////////////////////////////////////
app.get('/', async (req,res)=>{
  let qrImg = '';
  if (currentQR) {
    try{ qrImg = await QRCode.toDataURL(currentQR); }catch{}
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
  .glass{backdrop-filter:blur(10px);background:rgba(255,255,255,0.2);
    padding:2rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);
    max-width:320px;width:90%;text-align:center;font-family:Arial,sans-serif;}
  .glass h1{color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.5);}
  .qr-box img{width:100%;max-width:250px;}
  .footer{margin-top:1rem;color:#eee;font-size:0.9rem;}
</style>
</head><body>
  <div class="glass">
    <h1>Scan to Connect</h1>
    <div class="qr-box">
      ${ qrImg? `<img src="${qrImg}">`: '<p style="color:#fff;">Waiting for QR…</p>' }
    </div>
    <div class="footer">Created By FY'S PROPERTY</div>
  </div>
</body></html>`);
});

app.listen(PORT, ()=>console.log(`Express on port ${PORT}`));
client.initialize();

////////////////////////////////////////////////////////////////////////////////
// UTIL
////////////////////////////////////////////////////////////////////////////////
function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if (n.startsWith('0')) n = '254'+n.slice(1);
  if (n.length<12) return null;
  return n+'@c.us';
}

////////////////////////////////////////////////////////////////////////////////
// STK & STATUS (unchanged)
////////////////////////////////////////////////////////////////////////////////
async function sendSTKPush(amount, phone) { /* … */ }
async function fetchTransactionStatus(ref)    { /* … */ }
