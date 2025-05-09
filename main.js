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
  return fs.existsSync(DATA_PATH)
    ? JSON.parse(fs.readFileSync(DATA_PATH))
    : {};
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
  welcomeText:    "👋 *Welcome to FY'S PROPERTY!* Send your *username* to register:",
  userMenu(user) {
    return `\n✨ Hello ${user.name}! What would you like to do today?\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `7️⃣ Delete My Account\n` +
      `Type 'menu' anytime to see this again.`;
  },
  regSuccess(name) {
    return `🎉 Fantastic, *${name}*! You’re now registered with *Ksh 0.00*.` +
      this.userMenu({ name });
  },
  notEnoughBal(cost, bal) {
    return `⚠️ This message costs *Ksh ${cost.toFixed(2)}*, but you have only *Ksh ${bal.toFixed(2)}*. Please top-up.`;
  },
  topupPrompt:    "💳 How much would you like to top-up? (enter Ksh)",
  supportText:    "🆘 Need help? Email **gk-y@iname.com** or WhatsApp: [Chat now](https://wa.me/254701339573)."
};

// per-chat state
const conversations = {};    // { jid: { stage, ... } }
const adminSessions = {};    // { jid: { awaiting, step, ... } }

// ────────────────────────────────────────────────────────────────────
// 3) WHATSAPP CLIENT INIT
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = "";

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('🚀 Bot is ready');
  adminReply(SUPER_ADMIN, "🤖 Bot online! Here's your Admin menu:");
  showAdminMenu(SUPER_ADMIN);
});

client.initialize();

// ────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS QR DASHBOARD (GLASS MORPHISM)
// ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", async (req, res) => {
  let imgData = "";
  if (currentQR) {
    try { imgData = await QRCode.toDataURL(currentQR) } catch {}
  }
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>FY'S PROPERTY Bot QR</title>
      <style>
        body {
          margin: 0; height: 100vh;
          background: url('https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?auto=format&fit=crop&w=1500&q=80') center/cover no-repeat;
          display: flex; align-items: center; justify-content: center;
          font-family: Arial, sans-serif;
        }
        .glass {
          background: rgba(255,255,255,0.2);
          backdrop-filter: blur(12px);
          border-radius: 16px;
          padding: 2rem;
          text-align: center;
          box-shadow: 0 8px 32px rgba(0,0,0,0.2);
          max-width: 360px;
          width: 90%;
        }
        .glass h1 {
          margin-bottom: 1rem;
          color: #fff;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }
        .qr-box img {
          width: 100%;
          max-width: 240px;
          border-radius: 8px;
          background: #fff;
          padding: 0.5rem;
        }
        .footer {
          margin-top: 1rem;
          color: rgba(255,255,255,0.8);
          font-size: 0.9rem;
        }
      </style>
    </head>
    <body>
      <div class="glass">
        <h1>Scan to Connect</h1>
        <div class="qr-box">
          ${ imgData
             ? `<img src="${imgData}" alt="Bot QR Code">`
             : '<p style="color:#fff;">Waiting for QR…</p>' }
        </div>
        <div class="footer">Powered by FY’S PROPERTY BOT</div>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(`🌐 QR dashboard: http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid, msg) {
  try {
    await client.sendMessage(jid, msg);
  } catch (err) {
    console.error(`❌ Error sending to ${jid}:`, err.message);
    if (jid !== SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${jid}: ${err.message}`);
    }
  }
}

function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g, "");
  if (n.length === 9  && n.startsWith("7"))    n = "254" + n;
  if (n.length === 10 && n.startsWith("0"))    n = "254" + n.slice(1);
  if (n.length === 12 && n.startsWith("254"))  return n + "@c.us";
  return null;
}

async function adminReply(jid, msg) {
  return safeSend(jid, msg + "\n\n0️⃣ Go Back   00️⃣ Main Menu");
}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN PANEL
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid) {
  adminSessions[jid] = { awaiting: "main" };
  const menu = `${botConfig.fromAdmin}: *Admin Main Menu*
1. View All Users
2. Change Cost/Char (Ksh ${botConfig.costPerChar.toFixed(2)})
3. Top-up/Deduct User
4. Ban/Unban User
5. Bulk → All Registered
6. Add Admin
7. Remove Admin
8. Show QR Dashboard
9. Config Bot Texts & Support`;
  return adminReply(jid, menu);
}

function showConfigMenu(jid) {
  adminSessions[jid] = { awaiting: "config" };
  const cfg = `${botConfig.fromAdmin}: *Config Menu*
1. Edit Admin Label
2. Edit Welcome Text
3. Edit Registration Success Text
4. Edit User Menu Text
5. Edit Not-Enough-Balance Text
6. Edit Top-up Prompt
7. Edit costPerChar
8. Edit Support Text
9. Edit Channel ID
0. Back`;
  return adminReply(jid, cfg);
}

// ────────────────────────────────────────────────────────────────────
// 7) MESSAGE HANDLER (USER + ADMIN)
// ────────────────────────────────────────────────────────────────────
client.on("message", async msg => {
  const from = msg.from, txt = msg.body.trim(), lc = txt.toLowerCase();

  // ignore groups
  if (from.endsWith("@g.us")) return;

  // ADMIN FLOWS
  if (adminUsers.has(from)) {
    // global back/menu
    if (txt === "00") { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === "0")  { delete adminSessions[from]; return adminReply(from, "🔙 Back"); }

    const sess = adminSessions[from] || {};

    // main dispatch
    if (!sess.awaiting || sess.awaiting === "main") {
      switch (txt) {
        case "1": sess.awaiting = "viewUsers";  return adminReply(from, "👥 Fetching all users...");
        case "2": sess.awaiting = "chgCost";    return adminReply(from, "💱 Enter new costPerChar:");
        case "3": sess.awaiting = "modBal"; sess.step = null; return adminReply(from, "💰 Enter user phone:");
        case "4": sess.awaiting = "banUser"; sess.step = null; return adminReply(from, "🚫 Enter user phone:");
        case "5": sess.awaiting = "bulkAll"; sess.step = null; return adminReply(from, "📝 Enter message for ALL users:");
        case "6": sess.awaiting = "addAdmin"; sess.step = null; return adminReply(from, "➕ Enter phone of new admin:");
        case "7": sess.awaiting = "rmvAdmin"; sess.step = null; return adminReply(from, "❌ Enter phone of admin to remove:");
        case "8": return adminReply(from, `🌐 Dash board: http://localhost:${PORT}`);
        case "9": return showConfigMenu(from);
        default:  return showAdminMenu(from);
      }
    }

    // submenu handlers
    switch (sess.awaiting) {
      // 1) View all users
      case "viewUsers": {
        let out = "👥 Registered Users:\n";
        for (let [jid, u] of Object.entries(users)) {
          out += `\n• ${u.name} (${u.phone})\n  Bal: ${u.balance.toFixed(2)} | Sent: ${u.messageCount} | Charges: ${u.totalCharges.toFixed(2)}\n  Banned: ${u.banned?`Yes(${u.banReason})`:"No"}\n`;
        }
        delete adminSessions[from];
        return adminReply(from, out);
      }
      // 2) Change costPerChar
      case "chgCost": {
        const k = parseFloat(txt);
        if (isNaN(k) || k <= 0) return adminReply(from, "⚠️ Invalid number.");
        botConfig.costPerChar = k;
        delete adminSessions[from];
        return adminReply(from, `🎉 costPerChar set to ${k.toFixed(2)}`);
      }
      // 3) Top-up/Deduct user
      case "modBal": {
        if (!sess.step) {
          sess.step = "getUser";
          return adminReply(from, "📱 Enter user phone:");
        }
        if (sess.step === "getUser") {
          const jid = formatPhone(txt);
          if (!jid || !users[jid]) { delete adminSessions[from]; return adminReply(from, "⚠️ User not found."); }
          sess.target = jid; sess.step = "getAmt";
          return adminReply(from, "💰 Enter +amount or -amount:");
        }
        if (sess.step === "getAmt") {
          const amt = parseFloat(txt);
          if (isNaN(amt)) return adminReply(from, "⚠️ Invalid amount.");
          users[sess.target].balance += amt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from, `✅ ${users[sess.target].name}'s balance updated.`);
        }
        break;
      }
      // 4) Ban/unban user
      case "banUser": {
        if (!sess.step) {
          sess.step = "getUser"; return adminReply(from, "📱 Enter user phone:");
        }
        if (sess.step === "getUser") {
          const jid = formatPhone(txt);
          if (!jid || !users[jid]) { delete adminSessions[from]; return adminReply(from, "⚠️ User not found."); }
          sess.target = jid;
          if (users[jid].banned) {
            users[jid].banned = false; users[jid].banReason = "";
            saveUsers(users);
            delete adminSessions[from];
            return adminReply(from, `✅ ${users[jid].name} unbanned.`);
          }
          sess.step = "getReason"; return adminReply(from, "✏️ Enter ban reason:");
        }
        if (sess.step === "getReason") {
          users[sess.target].banned = true;
          users[sess.target].banReason = txt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from, `🚫 ${users[sess.target].name} banned: ${txt}`);
        }
        break;
      }
      // 5) Bulk all
      case "bulkAll": {
        if (!sess.step) {
          sess.step = "getMsg";
          return adminReply(from, "📝 Enter message to send to ALL users:");
        }
        if (sess.step === "getMsg") {
          const m = txt;
          for (let jid of Object.keys(users)) {
            await safeSend(jid, `${botConfig.fromAdmin}: ${m}`);
          }
          delete adminSessions[from];
          return adminReply(from, "🎉 Message sent to all users!");
        }
        break;
      }
      // 6) Add admin
      case "addAdmin": {
        const jid = formatPhone(txt);
        if (!jid) { delete adminSessions[from]; return adminReply(from, "⚠️ Invalid phone."); }
        adminUsers.add(jid);
        delete adminSessions[from];
        return adminReply(from, `➕ ${jid} is now an admin.`);
      }
      // 7) Remove admin
      case "rmvAdmin": {
        const jid = formatPhone(txt);
        if (!jid || !adminUsers.has(jid) || jid === SUPER_ADMIN) {
          delete adminSessions[from];
          return adminReply(from, "⚠️ Cannot remove that admin.");
        }
        adminUsers.delete(jid);
        delete adminSessions[from];
        return adminReply(from, `❌ ${jid} removed from admins.`);
      }
      // 9) Config submenu
      case "config": {
        if (!sess.step) {
          switch (txt) {
            case "1": sess.step="editAdmin";       return adminReply(from,"✏️ Enter new Admin Label:");
            case "2": sess.step="editWelcome";     return adminReply(from,"✏️ Enter new Welcome Text:");
            case "3": sess.step="editRegSuccess";  return adminReply(from,"✏️ Enter new Registration Success Text:");
            case "4": sess.step="editUserMenu";    return adminReply(from,"✏️ Enter new User Menu Text (use {name}):");
            case "5": sess.step="editNotEnough";   return adminReply(from,"✏️ Enter new Not-Enough-Balance Text:");
            case "6": sess.step="editTopupPrompt"; return adminReply(from,"✏️ Enter new Top-up Prompt:");
            case "7": sess.step="editCost";        return adminReply(from,"✏️ Enter new costPerChar:");
            case "8": sess.step="editSupport";     return adminReply(from,"✏️ Enter new Support Info Text:");
            case "9": sess.step="editChannelID";   return adminReply(from,"✏️ Enter new Channel ID:");
            case "0": delete adminSessions[from];  return showAdminMenu(from);
            default:   return adminReply(from,"⚠️ Invalid option.");
          }
        } else {
          switch (sess.step) {
            case "editAdmin":      botConfig.fromAdmin   = txt; break;
            case "editWelcome":    botConfig.welcomeText = txt; break;
            case "editRegSuccess": botConfig.regSuccess  = name=>txt.replace("{name}",name); break;
            case "editUserMenu":   botConfig.userMenu    = u=>txt.replace("{name}",u.name||""); break;
            case "editNotEnough":  botConfig.notEnoughBal= (c,b)=>txt.replace("{cost}",c).replace("{bal}",b); break;
            case "editTopupPrompt":botConfig.topupPrompt = txt; break;
            case "editCost":       botConfig.costPerChar = parseFloat(txt)||botConfig.costPerChar; break;
            case "editSupport":    botConfig.supportText = txt; break;
            case "editChannelID":  botConfig.channelID   = parseInt(txt)||botConfig.channelID; break;
          }
          delete adminSessions[from];
          return adminReply(from,"✅ Configuration updated.");
        }
      }
      default:
        delete adminSessions[from];
        return adminReply(from,"⚠️ Returning to main menu.");
    }
  }

  // USER REGISTRATION
  if (!users[from]) {
    if (!conversations[from]) {
      conversations[from] = { stage: "awaitRegister" };
      return msg.reply(botConfig.welcomeText);
    }
    const conv = conversations[from];
    if (conv.stage === "awaitRegister") {
      const uname = txt;
      if (Object.values(users).some(u=>u.name.toLowerCase()===uname.toLowerCase())) {
        return msg.reply("⚠️ That username is taken—please choose another.");
      }
      users[from] = {
        name: uname,
        phone: from.replace("@c.us",""),
        registeredAt: new Date().toISOString(),
        balance: 0, banned: false, banReason: "",
        messageCount: 0, totalCharges: 0,
        recipients: [], support: { open:false, ticketId:null }
      };
      saveUsers(users);
      delete conversations[from];
      for (let adm of adminUsers) {
        await safeSend(adm,
          `🆕 *New Registration*\n• Username: ${uname}\n• Phone: ${users[from].phone}`
        );
      }
      return msg.reply(botConfig.regSuccess(uname));
    }
    return;
  }

  // REGISTERED USER FLOW
  const user = users[from];
  if (user.banned) {
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }
  if (lc === "menu") {
    return msg.reply(botConfig.userMenu(user));
  }
  if (lc === "7" || lc === "delete my account") {
    delete users[from]; saveUsers(users);
    return msg.reply("❌ Account deleted—send any message to re-register.");
  }
  if (lc === "6") {
    return msg.reply(botConfig.supportText);
  }
  if (lc === "5") {
    return msg.reply(
      `💰 Balance: Ksh ${user.balance.toFixed(2)}\n`+
      `✉️ Sent: ${user.messageCount}\n`+
      `💸 Charges: ${user.totalCharges.toFixed(2)}`
    );
  }

  // USER TOP-UP FLOW
  if (lc === "4" || conversations[from]?.stage?.startsWith("topup")) {
    const conv = conversations[from]||{};
    if (lc === "4") {
      conversations[from] = { stage:"topup:amount" };
      return msg.reply(botConfig.topupPrompt);
    }
    if (conv.stage==="topup:amount") {
      const amt = parseFloat(txt);
      if (isNaN(amt)||amt<11) {
        delete conversations[from];
        return msg.reply("⚠️ Minimum top-up is Ksh 11. Type '4' to try again.");
      }
      conv.amount=amt; conv.stage="topup:phone"; conversations[from]=conv;
      return msg.reply(`📱 Send M-PESA phone to charge Ksh ${amt.toFixed(2)}:`);
    }
    if (conv.stage==="topup:phone") {
      const mp = formatPhone(txt), amt=conv.amount;
      delete conversations[from];
      if (!mp) return msg.reply("⚠️ Invalid phone. Type '4' to restart.");
      await msg.reply(`⏳ Initiating Ksh ${amt.toFixed(2)} top-up…`);
      const ref = await sendSTKPush(amt, mp.replace("@c.us",""));
      if (!ref) return msg.reply("❌ STK push failed.");
      setTimeout(()=>safeSend(from,"⏳ 20s left…"),10000);
      setTimeout(()=>safeSend(from,"⏳ 10s left…"),20000);
      return setTimeout(async()=>{
        const status = await fetchTransactionStatus(ref),
              ok     = status?.status==="SUCCESS",
              code   = status?.provider_reference||"—",
              now    = new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
        if(ok){
          user.balance+=amt; saveUsers(users);
          await safeSend(from,
            `🎉 Top-up Successful!\n• Amount: Ksh ${amt.toFixed(2)}\n`+
            `• Mpesa Code: ${code}\n`+
            `• New Balance: Ksh ${user.balance.toFixed(2)}`
          );
          await safeSend(SUPER_ADMIN,
            `💰 Deposit Success\n• User: ${user.name}\n`+
            `• Amount: Ksh ${amt.toFixed(2)}\n`+
            `• Code: ${code}\n`+
            `• Time: ${now}`
          );
        } else {
          await safeSend(from,"❌ Top-up failed or timed out.");
        }
      },30000);
    }
  }

  // 1) Send Bulk Message (no confirm)
  if (lc === "1" || conversations[from]?.stage==="awaitBulk") {
    if (lc === "1") {
      conversations[from] = { stage:"awaitBulk" };
      return msg.reply("✏️ Type the message you want to send:");
    }
    if (conversations[from].stage==="awaitBulk") {
      const m=txt; delete conversations[from];
      const cost=m.length*botConfig.costPerChar;
      if(user.balance<cost) return msg.reply(botConfig.notEnoughBal(cost,user.balance));
      for(let r of user.recipients){
        await safeSend(r, `${botConfig.fromAdmin}: ${m}`);
      }
      user.balance-=cost; user.messageCount++; user.totalCharges+=cost; saveUsers(users);
      return msg.reply(`✅ Sent! Ksh ${cost.toFixed(2)} deducted. New bal: Ksh ${user.balance.toFixed(2)}`);
    }
  }

  // 2) Add Recipient
  if (lc==="2"||conversations[from]?.stage==="addRec") {
    if(lc==="2"){ conversations[from]={stage:"addRec"}; return msg.reply("📥 Enter recipient phone:"); }
    const jid=formatPhone(txt); delete conversations[from];
    if(!jid) return msg.reply("⚠️ Invalid phone.");
    if(!user.recipients.includes(jid)){
      user.recipients.push(jid); saveUsers(users);
      return msg.reply(`✅ Recipient ${jid} added.`);
    }
    return msg.reply("⚠️ Already in your list.");
  }

  // 3) Remove Recipient
  if (lc==="3"||conversations[from]?.stage==="delRec") {
    if(lc==="3"){ conversations[from]={stage:"delRec"}; return msg.reply("🗑️ Enter recipient phone:"); }
    const jid=formatPhone(txt); delete conversations[from];
    if(!jid||!user.recipients.includes(jid)) {
      return msg.reply("⚠️ That number is not in your list.");
    }
    user.recipients=user.recipients.filter(r=>r!==jid); saveUsers(users);
    return msg.reply(`🗑️ Recipient ${jid} removed.`);
  }

  // default: show menu
  return msg.reply(botConfig.userMenu(user));
});

// ────────────────────────────────────────────────────────────────────
// 8) M-PESA STK PUSH & STATUS CHECK
// ────────────────────────────────────────────────────────────────────
async function sendSTKPush(amount, phone) {
  const payload = {
    amount,
    phone_number:       phone,
    channel_id:         botConfig.channelID,
    provider:           "m-pesa",
    external_reference: "INV-009",
    customer_name:      "FY'S PROPERTY User",
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
      { headers:{
          'Content-Type':'application/json',
          'Authorization':'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
        } }
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
        } }
    );
    return res.data;
  } catch (err) {
    console.error("Fetch Status Error:", err.message);
    return null;
  }
}
