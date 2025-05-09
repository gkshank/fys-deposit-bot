/*******************************************************************
 * main.js
 * FY'S PROPERTY WHATSAPP BOT
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express        = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode         = require('qrcode');
const axios          = require('axios');
const fs             = require('fs');
const path           = require('path');

// ────────────────────────────────────────────────────────────────────
// 1) PERSISTENT STORAGE
// ────────────────────────────────────────────────────────────────────
const DATA_PATH = path.join(__dirname, 'users.json');
function loadUsers() {
  if (fs.existsSync(DATA_PATH)) {
    return JSON.parse(fs.readFileSync(DATA_PATH));
  }
  return {};
}
function saveUsers(users) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(users, null, 2));
}
let users = loadUsers();

// ────────────────────────────────────────────────────────────────────
// 2) BOT CONFIG & GLOBAL STATE
// ────────────────────────────────────────────────────────────────────
const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);

let botConfig = {
  fromAdmin:      "Admin GK-FY",
  channelID:      529,
  costPerChar:    0.01,
  welcomeText:    "👋 *Welcome to FY'S PROPERTY!* Please register by sending your *phone number* (e.g., 0712345678).",
  askNameText:    "✅ Great! Now reply with your *name* so I can personalize your experience:",
  topupAmtPrompt: "💳 How much would you like to top-up? (Enter a number in Ksh)",
  topupPhonePrompt:"📱 Now enter the *M-PESA phone number* to receive the STK push:",
  closedSupport:  "✅ Support ticket closed. Type 'menu' to return to main options.",
  userMenu(user) {
    const name = user && user.name ? user.name : '';
    return (
      `\n✨ Hello ${name}! What would you like to do?\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `7️⃣ List Recipients\n` +
      `Type 'menu' anytime for this list.`
    );
  },
  regSuccess(name) {
    return `🎉 Hi *${name}*! Registration complete. Your balance is *Ksh 0.00*.` + this.userMenu({ name });
  },
  notEnoughBal(cost, bal) {
    return `⚠️ This broadcast costs *Ksh ${cost.toFixed(2)}*, but you have *Ksh ${bal.toFixed(2)}*. Please top-up.`;
  }
};

// Per-chat state
const conversations = {};  // { jid: { stage, ... } }
const adminSessions = {};  // { jid: { awaiting, step, ... } }

// ────────────────────────────────────────────────────────────────────
// 3) WHATSAPP CLIENT INIT
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = '';

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});
client.on('ready', () => {
  console.log('🚀 Bot is ready');
  adminReply(SUPER_ADMIN, "🤖 Bot is live! Here's the Admin menu:");
  showAdminMenu(SUPER_ADMIN);
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS DASHBOARD (GLASS QR)
// ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', async (req, res) => {
  let img = '';
  if (currentQR) {
    try { img = await QRCode.toDataURL(currentQR); } catch {}
  }
  res.send(`
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
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
app.listen(PORT, ()=>console.log(`🌐 QR Dashboard at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid, message) {
  try {
    await client.sendMessage(jid, message);
  } catch(err) {
    console.error(`❌ Error sending to ${jid}:`, err.message);
    if (jid !== SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${jid}: ${err.message}`);
    }
  }
}
function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if (n.startsWith('0')) n = '254'+n.slice(1);
  return n.length >= 12 ? n+'@c.us' : null;
}
async function adminReply(jid, msg) {
  const suffix = "\n\n0️⃣ Go Back   00️⃣ Main Menu";
  return safeSend(jid, msg + suffix);
}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN PANEL
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid) {
  adminSessions[jid] = { awaiting:'main' };
  const menu = `${botConfig.fromAdmin}: *Admin Main Menu*
1. View All Users
2. Change Cost/Char
3. Top-up/Deduct User
4. Ban/Unban User
5. Bulk → All Users
6. Show QR Dashboard
7. Config Texts/ChannelID
8. Add Admin
9. Remove Admin`;
  return adminReply(jid, menu);
}
function showConfigMenu(jid) {
  adminSessions[jid] = { awaiting:'config' };
  const cfg = `${botConfig.fromAdmin}: *Config Menu*
1. Edit Admin Label
2. Edit Welcome Text
3. Edit Ask-Name Text
4. Edit Reg-Success Text
5. Edit User-Menu Text
6. Edit Not-Enough-Bal Text
7. Edit Top-up Prompts
8. Edit costPerChar
9. Edit Channel ID
0. Back`;
  return adminReply(jid, cfg);
}

// ────────────────────────────────────────────────────────────────────
// 7) MESSAGE HANDLER (USER + ADMIN + SUPPORT)
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();
  if (from.endsWith('@g.us')) return;

  // 7.1) SUPPORT TICKETS
  if (users[from]?.support?.open && !adminUsers.has(from)) {
    const t = users[from].support.ticketId;
    await safeSend(SUPER_ADMIN, `🎟 #${t} from ${users[from].name}:\n"${txt}"`);
    return msg.reply("📥 Sent to support. Type 'close' to finish.");
  }
  if (lc === 'close' && users[from]?.support?.open) {
    users[from].support.open = false;
    saveUsers(users);
    return msg.reply(botConfig.closedSupport);
  }
  if (adminUsers.has(from) && lc.startsWith('reply ')) {
    const [_, ticket, ...rest] = txt.split(' ');
    const content = rest.join(' ');
    const target = Object.entries(users).find(([jid,u]) =>
      u.support.open && u.support.ticketId === ticket
    );
    if (target) {
      const [jid,u] = target;
      await safeSend(jid, `🛎 Support Reply:\n"${content}"`);
      return adminReply(from, `✅ Replied to ticket ${ticket}.`);
    } else {
      return adminReply(from, `⚠️ No open ticket ${ticket}.`);
    }
  }

  // 7.2) ADMIN FLOW
  if (adminUsers.has(from)) {
    if (txt==='00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt==='0')  { delete adminSessions[from]; return adminReply(from,"🔙 Going back."); }

    const sess = adminSessions[from] || {};

    // Main dispatch
    if (!sess.awaiting || sess.awaiting==='main') {
      switch(txt) {
        case '1': sess.awaiting='viewUsers';   return adminReply(from,"👥 Fetching users...");
        case '2': sess.awaiting='chgCost';     return adminReply(from,"💱 Enter new costPerChar:");
        case '3': sess.awaiting='modBal'; sess.step=null; return adminReply(from,"💰 Enter user phone to modify balance:");
        case '4': sess.awaiting='banUser'; sess.step=null; return adminReply(from,"🚫 Enter user phone to ban/unban:");
        case '5': sess.awaiting='bulkAll'; sess.step=null; return adminReply(from,"📝 Enter message for ALL users:");
        case '6': sess.awaiting='showQR';      return adminReply(from,`🌐 Dashboard: http://localhost:${PORT}`);
        case '7': return showConfigMenu(from);
        case '8': sess.awaiting='addAdmin';    return adminReply(from,"👤 Enter phone of new admin:");
        case '9': sess.awaiting='removeAdmin'; return adminReply(from,"🚫 Enter phone of admin to remove:");
        default:  return showAdminMenu(from);
      }
    }

    // Submenus
    switch(sess.awaiting) {
      // View All Users
      case 'viewUsers': {
        let lines = ["👥 *Registered Users*:"];
        for (let [jid,u] of Object.entries(users)) {
          lines.push(
            `\n• *${u.name}* (${u.phone})` +
            `\n  • Balance: *Ksh ${u.balance.toFixed(2)}*` +
            `\n  • Sent: *${u.messageCount}*` +
            `\n  • Charges: *Ksh ${u.totalCharges.toFixed(2)}*` +
            `\n  • Banned: *${u.banned ? "Yes ("+u.banReason+")" : "No"}*`
          );
        }
        delete adminSessions[from];
        return adminReply(from, lines.join("\n"));
      }
      // Change costPerChar
      case 'chgCost': {
        const k=parseFloat(txt);
        if(isNaN(k)||k<=0) return adminReply(from,"⚠️ Enter a valid number:");
        botConfig.costPerChar=k;
        delete adminSessions[from];
        return adminReply(from,`🎉 costPerChar set to Ksh ${k.toFixed(2)}`);
      }
      // Top-up/Deduct
      case 'modBal': {
        if(!sess.step){ sess.step='getUser'; return adminReply(from,"📱 Enter user phone:"); }
        if(sess.step==='getUser'){
          const jid=formatPhone(txt);
          if(!jid||!users[jid]){ delete adminSessions[from]; return adminReply(from,"⚠️ User not found."); }
          sess.target=jid; sess.step='getAmt';
          return adminReply(from,"💰 Enter +amount or -amount:");
        }
        if(sess.step==='getAmt'){
          const amt=parseFloat(txt);
          if(isNaN(amt)) return adminReply(from,"⚠️ Invalid amount:");
          users[sess.target].balance+=amt; saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,
            `✅ ${amt>=0?'Topped-up':'Deducted'} Ksh ${Math.abs(amt).toFixed(2)} for ${users[sess.target].name}\n`+
            `New Bal: Ksh ${users[sess.target].balance.toFixed(2)}`
          );
        }
        break;
      }
      // Ban/Unban
      case 'banUser': {
        if(!sess.step){ sess.step='getUser'; return adminReply(from,"📱 Enter user phone:"); }
        if(sess.step==='getUser'){
          const jid=formatPhone(txt);
          if(!jid||!users[jid]){ delete adminSessions[from]; return adminReply(from,"⚠️ User not found."); }
          sess.target=jid;
          if(users[jid].banned){
            users[jid].banned=false; users[jid].banReason=''; saveUsers(users);
            delete adminSessions[from];
            return adminReply(from,`✅ ${users[jid].name} unbanned.`);
          } else {
            sess.step='getReason'; return adminReply(from,"✏️ Enter ban reason:");
          }
        }
        if(sess.step==='getReason'){
          users[sess.target].banned=true; users[sess.target].banReason=txt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,`🚫 ${users[sess.target].name} banned: ${txt}`);
        }
        break;
      }
      // Bulk → All Users
      case 'bulkAll': {
        if(!sess.step){ sess.step='getMsg'; return adminReply(from,"📝 Enter message for ALL users:"); }
        if(sess.step==='getMsg'){
          sess.message=txt; sess.step='confirm';
          return adminReply(from,
            `📝 Preview:\n"${txt}"\n\n1️⃣ Send   2️⃣ Cancel`
          );
        }
        if(sess.step==='confirm'){
          if(txt==='1'){
            for(let jid of Object.keys(users)) await safeSend(jid,sess.message);
            delete adminSessions[from];
            return adminReply(from,"🎉 Sent to all users!");
          } else {
            delete adminSessions[from];
            return adminReply(from,"❌ Bulk cancelled.");
          }
        }
        break;
      }
      // Show QR
      case 'showQR':
        delete adminSessions[from];
        return adminReply(from,`🌐 Dashboard: http://localhost:${PORT}`);
      // Config submenu
      case 'config':
        delete adminSessions[from];
        return showConfigMenu(from);
      // Add Admin
      case 'addAdmin': {
        const jid=formatPhone(txt);
        if(!jid){ delete adminSessions[from]; return adminReply(from,"⚠️ Invalid phone."); }
        adminUsers.add(jid);
        delete adminSessions[from];
        return adminReply(from,`👤 Added admin: ${jid}`);
      }
      // Remove Admin
      case 'removeAdmin': {
        const jid=formatPhone(txt);
        if(!jid||!adminUsers.has(jid)||jid===SUPER_ADMIN){
          delete adminSessions[from];
          return adminReply(from,"⚠️ Cannot remove this admin.");
        }
        adminUsers.delete(jid);
        delete adminSessions[from];
        return adminReply(from,`🚫 Removed admin: ${jid}`);
      }
      default:
        delete adminSessions[from];
        return adminReply(from,"⚠️ Unknown option.");
    }
    return;
  }

  // 7.3) USER REGISTRATION FLOW
  if(!users[from]) {
    if(!conversations[from]) {
      conversations[from] = { stage:'awaitPhone' };
      return msg.reply(botConfig.welcomeText);
    }
    const conv = conversations[from];
    if(conv.stage==='awaitPhone'){
      const jid=formatPhone(txt);
      if(!jid){ delete conversations[from]; return msg.reply("⚠️ Invalid phone."); }
      users[from] = {
        phone:jid.replace('@c.us',''), name:'', registeredAt:new Date().toISOString(),
        balance:0, banned:false, banReason:'', messageCount:0, totalCharges:0,
        recipients:[], support:{open:false,ticketId:null}
      };
      saveUsers(users);
      conv.stage='awaitName';
      return msg.reply(botConfig.askNameText);
    }
    if(conv.stage==='awaitName'){
      users[from].name = txt;
      saveUsers(users);
      // **NEW: notify admin of new registration**
      await safeSend(SUPER_ADMIN,
        `🆕 *New Registration*\n• Name: ${users[from].name}\n• Phone: ${users[from].phone}`
      );
      delete conversations[from];
      return msg.reply(botConfig.regSuccess(users[from].name));
    }
    return;
  }

  // 7.4) REGISTERED USER MAIN FLOW
  const user = users[from];
  if(user.banned){
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }
  // Handle pending conversation states first
  if(conversations[from]?.stage){
    const conv = conversations[from];

    // Top-up: amount → phone
    if(conv.stage==='awaitAmount'){
      const amt=parseFloat(txt);
      if(isNaN(amt)||amt<=0){
        delete conversations[from];
        return msg.reply("⚠️ Invalid amount. Start again with *4*.");
      }
      conv.amount=amt;
      conv.stage='awaitPhone';
      return msg.reply(`📱 Now send the M-PESA number to charge *Ksh ${amt.toFixed(2)}*:`);  
    }
    if(conv.stage==='awaitPhone'){
      const mp=formatPhone(txt);
      const amt=conv.amount;
      delete conversations[from];
      if(!mp){
        return msg.reply("⚠️ Invalid phone. Top-up canceled.");
      }
      const ref=await sendSTKPush(amt, mp.replace('@c.us',''));
      if(!ref) return msg.reply("❌ STK initiation failed.");
      msg.reply("⏳ Please wait…");
      return setTimeout(async()=>{
        const st=await fetchTransactionStatus(ref);
        const now=new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
        if(st?.status==='SUCCESS'){
          user.balance+=amt; saveUsers(users);
          await safeSend(SUPER_ADMIN,
            `💰 *Deposit Success*\n• User: ${user.name}\n• Phone: ${mp}\n• Amount: Ksh ${amt}\n`+
            `• Code: ${st.provider_reference}\n• Time: ${now}`
          );
          return client.sendMessage(from, `🎉 Top-up successful! New bal: *Ksh ${user.balance.toFixed(2)}*`);
        } else {
          return client.sendMessage(from, "❌ Top-up failed or timed out.");
        }
      },20000);
    }

    // Bulk send
    if(conv.stage==='awaitBulk'){
      conv.message=txt;
      const cost=conv.message.length*botConfig.costPerChar;
      if(user.balance<cost){
        delete conversations[from];
        return msg.reply(botConfig.notEnoughBal(cost,user.balance));
      }
      conv.cost=cost;
      conv.stage='confirmBulk';
      return msg.reply(`📝 "${conv.message}"\nCost: *Ksh ${cost.toFixed(2)}*\n1️⃣ Send   2️⃣ Cancel`);
    }
    if(conv.stage==='confirmBulk'){
      if(txt==='1'){
        for(let r of user.recipients) await safeSend(r,conv.message);
        user.balance-=conv.cost;
        user.messageCount++;
        user.totalCharges+=conv.cost;
        saveUsers(users);
        delete conversations[from];
        return msg.reply(`✅ Sent! Ksh ${conv.cost.toFixed(2)} deducted. New bal: Ksh ${user.balance.toFixed(2)}`);
      } else {
        delete conversations[from];
        return msg.reply("❌ Bulk canceled.");
      }
    }

    // Add recipient
    if(conv.stage==='addRec'){
      const jid=formatPhone(txt);
      delete conversations[from];
      if(!jid) return msg.reply("⚠️ Invalid phone.");
      if(!user.recipients.includes(jid)){
        user.recipients.push(jid);
        saveUsers(users);
        return msg.reply(`✅ ${jid} added.`);
      }
      return msg.reply("⚠️ Already in your list.");
    }

    // Remove recipient
    if(conv.stage==='delRec'){
      const jid=formatPhone(txt);
      delete conversations[from];
      if(!jid||!user.recipients.includes(jid)){
        return msg.reply("⚠️ Not in your list.");
      }
      user.recipients=user.recipients.filter(r=>r!==jid);
      saveUsers(users);
      return msg.reply(`🗑️ ${jid} removed.`);
    }

    return; // block further
  }

  // Main menu
  if(lc==='menu') return msg.reply(botConfig.userMenu(user));
  if(lc==='1'){ conversations[from]={stage:'awaitBulk'}; return msg.reply("✏️ Type your broadcast message:"); }
  if(lc==='2'){ conversations[from]={stage:'addRec'}; return msg.reply("📥 Enter phone to add:"); }
  if(lc==='3'){ conversations[from]={stage:'delRec'}; return msg.reply("🗑️ Enter phone to remove:"); }
  if(lc==='4'){ conversations[from]={stage:'awaitAmount'}; return msg.reply(botConfig.topupAmtPrompt); }
  if(lc==='5'){ return msg.reply(`💰 Bal: Ksh ${user.balance.toFixed(2)}\n✉️ Sent: ${user.messageCount}\n💸 Charges: Ksh ${user.totalCharges.toFixed(2)}`); }
  if(lc==='6'){
    if(!user.support.open){
      user.support.open=true;
      user.support.ticketId=Date.now().toString().slice(-6);
      saveUsers(users);
      return msg.reply(`🆘 Support #${user.support.ticketId} opened. Type your message:`); }
    return msg.reply("🆘 Send support message or 'close' to end.");
  }
  if(lc==='7'){
    return msg.reply(
      user.recipients.length
        ? `📋 Your Recipients:\n${user.recipients.join('\n')}`
        : "⚠️ No recipients. Add with *2*."
    );
  }

  // Fallback
  return msg.reply(botConfig.userMenu(user));
});

// ────────────────────────────────────────────────────────────────────
// 8) M-PESA STK & STATUS CHECK
// ────────────────────────────────────────────────────────────────────
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
  } catch(err) {
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
  } catch(err) {
    console.error("Fetch Status Error:", err.message);
    return null;
  }
}
