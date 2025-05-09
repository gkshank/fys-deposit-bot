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
  fromAdmin:    "Admin GK-FY",
  channelID:    529,
  costPerChar:  0.01,
  welcomeText:  "👋 *Welcome to FY'S PROPERTY!* To get started, please register by sending your *phone number* (e.g., 0712345678).",
  askNameText:  "✅ Great! Now reply with your *name* so I can personalize your experience:",
  userMenu(user) {
    const name = user && user.name ? user.name : '';
    return (
      `\n✨ Hello ${name}! What would you like to do today?\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `7️⃣ Delete My Account\n` +
      `8️⃣ View Recipients\n\n` +
      `Type 'menu' anytime to see this again.`
    );
  },
  regSuccess(name) {
    return `🎉 Amazing, *${name}*! You're now registered. Your balance is *Ksh 0.00*.` + this.userMenu({ name });
  },
  notEnoughBal(cost,bal) {
    return `⚠️ The message will cost *Ksh ${cost.toFixed(2)}*, but you only have *Ksh ${bal.toFixed(2)}*. Please top-up first.`;
  },
  topupPrompt:    "💳 How much would you like to top-up? (Enter a number in Ksh)",
  closedSupport:  "✅ Your support ticket is now closed. To open again, type `#close`.",
};

// Per-chat and admin state
const conversations = {};   // for user flows: { jid: { stage, ... } }
const adminSessions = {};   // for admin flows: { jid: { awaiting, step, target } }

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
  adminReply(SUPER_ADMIN,
    "🤖 Bot deployed and online!\n" +
    "To reply to support: `reply <ticketId> <your message>`"
  );
  showAdminMenu(SUPER_ADMIN);
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', async (req,res) => {
  let img = '';
  if (currentQR) {
    try { img = await QRCode.toDataURL(currentQR); } catch {}
  }
  res.send(`
<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>FY'S PROPERTY Bot QR</title>
<style>
  body { margin:0; display:flex; justify-content:center; align-items:center;
    height:100vh; background:#222; color:#fff; font-family:Arial,sans-serif; }
  .qr { background:#fff; padding:1rem; border-radius:8px; text-align:center; }
  .qr img{ width:200px; }
</style>
</head><body>
  <div class="qr">
    <h2>Scan to Connect</h2>
    ${img ? `<img src="${img}">` : '<p>Waiting for QR…</p>'}
  </div>
</body></html>
`);
});
app.listen(PORT, ()=>console.log(`🌐 QR Dashboard: http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid,message) {
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
  if (n.length === 9  && n.startsWith('7'))  n = '254' + n;
  if (n.length === 10 && n.startsWith('0'))  n = '254' + n.slice(1);
  if (n.length === 12 && n.startsWith('254')) return n + '@c.us';
  return null;
}
async function adminReply(jid, msg) {
  const suffix = "\n\n0️⃣ Go Back   00️⃣ Main Menu";
  return safeSend(jid, msg + suffix);
}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN PANEL MENUS
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid) {
  adminSessions[jid] = { awaiting: 'main', step: null };
  const menu = `${botConfig.fromAdmin}: *Admin Main Menu*
1. View All Users
2. Change Cost/Char (Ksh ${botConfig.costPerChar.toFixed(2)})
3. Top-up/Deduct User
4. Ban/Unban User
5. Bulk → All Registered
6. Show QR Dashboard
7. Config Bot Texts/ChannelID

To reply to support: \`reply <ticketId> <message>\``;
  return adminReply(jid, menu);
}

function showConfigMenu(jid) {
  adminSessions[jid] = { awaiting: 'config', step: null };
  const cfg = `${botConfig.fromAdmin}: *Config Menu*
1. Edit Admin Label
2. Edit Welcome Text
3. Edit Ask-Name Text
4. Edit Registration Success Text
5. Edit User Menu Text
6. Edit Not-Enough-Balance Text
7. Edit Top-up Prompt
8. Edit costPerChar
9. Edit Channel ID
0. Back`;
  return adminReply(jid, cfg);
}

// ────────────────────────────────────────────────────────────────────
// 7) MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();

  if (from.endsWith('@g.us')) return; // ignore groups

  // 7.1) SUPPORT TICKETS (user→admin)
  if (users[from]?.support?.open && !adminUsers.has(from)) {
    await safeSend(SUPER_ADMIN,
      `🎟 #${users[from].support.ticketId} from ${users[from].name}:\n"${txt}"`
    );
    return msg.reply("📥 Sent to support. To close: type `#close`.");
  }
  if (lc === '#close' && users[from]?.support?.open) {
    users[from].support.open = false;
    saveUsers(users);
    return msg.reply(botConfig.closedSupport);
  }

  // 7.2) ADMIN FLOW
  if (adminUsers.has(from)) {
    // global back/menu
    if (txt === '00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === '0')  { delete adminSessions[from]; return adminReply(from, "🔙 Going back."); }

    const sess = adminSessions[from] || { awaiting:'main' };

    // support‐reply
    if (lc.startsWith('reply ')) {
      const [_, ticket, ...rest] = txt.split(' ');
      const content = rest.join(' ');
      const found = Object.entries(users).find(([jid,u]) =>
        u.support.open && u.support.ticketId === ticket
      );
      if (found) {
        const [jid] = found;
        await safeSend(jid, `🛎 Support Reply:\n"${content}"`);
        return adminReply(from, `✅ Replied to ticket ${ticket}.`);
      } else {
        return adminReply(from, `⚠️ No open ticket ${ticket}.`);
      }
    }

    // main menu dispatch
    if (sess.awaiting === 'main') {
      switch(txt) {
        case '1': sess.awaiting='viewUsers';   return adminReply(from,"👥 Fetching all users...");
        case '2': sess.awaiting='chgCost';     return adminReply(from,"💱 Enter new costPerChar:");
        case '3': sess.awaiting='modBal'; sess.step=null; return adminReply(from,"💰 Enter user phone to modify balance:");
        case '4': sess.awaiting='banUser'; sess.step=null; return adminReply(from,"🚫 Enter user phone to ban/unban:");
        case '5': sess.awaiting='bulkAll'; sess.step=null; return adminReply(from,"📝 Enter message for ALL users:");
        case '6': sess.awaiting='showQR';      return adminReply(from,`🌐 Dashboard: http://localhost:${PORT}`);
        case '7': return showConfigMenu(from);
        default:  return showAdminMenu(from);
      }
    }

    // submenus
    switch(sess.awaiting) {
      // 1) View All Users
      case 'viewUsers': {
        let out = "👥 Registered Users:\n";
        for (let [jid,u] of Object.entries(users)) {
          out += `\n• ${u.name} (${u.phone})\n` +
                 `  Bal: Ksh ${u.balance.toFixed(2)} | Sent: ${u.messageCount} | Charges: Ksh ${u.totalCharges.toFixed(2)}\n` +
                 `  Banned: ${u.banned ? `Yes (${u.banReason})` : 'No'}\n`;
        }
        delete adminSessions[from];
        return adminReply(from,out);
      }

      // 2) Change costPerChar
      case 'chgCost': {
        const k = parseFloat(txt);
        if (isNaN(k) || k <= 0) {
          return adminReply(from,"⚠️ Please enter a valid number:");
        }
        botConfig.costPerChar = k;
        delete adminSessions[from];
        return adminReply(from,`🎉 costPerChar updated to Ksh ${k.toFixed(2)}`);
      }

      // 3) Top-up/Deduct User
      case 'modBal': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from,"📱 Enter user phone:");
        }
        if (sess.step === 'getUser') {
          const jid = formatPhone(txt);
          if (!jid) return adminReply(from,"⚠️ Invalid phone number.");
          if (!users[jid]) {
            delete adminSessions[from];
            return adminReply(from,"⚠️ User not found.");
          }
          sess.target = jid;
          sess.step = 'getAmt';
          return adminReply(from,"💰 Enter +amount (top-up) or -amount (deduct):");
        }
        if (sess.step === 'getAmt') {
          const amt = parseFloat(txt);
          if (isNaN(amt)) {
            return adminReply(from,"⚠️ Invalid amount. Try again:");
          }
          users[sess.target].balance += amt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,
            `✅ ${amt>=0?'Topped-up':'Deducted'} Ksh ${Math.abs(amt).toFixed(2)} for ${users[sess.target].name}\n` +
            `New Balance: Ksh ${users[sess.target].balance.toFixed(2)}`
          );
        }
        break;
      }

      // 4) Ban/Unban User
      case 'banUser': {
        if (!sess.step) {
          sess.step = 'getUser';
          return adminReply(from,"📱 Enter user phone:");
        }
        if (sess.step === 'getUser') {
          const jid = formatPhone(txt);
          if (!jid) return adminReply(from,"⚠️ Invalid phone number.");
          if (!users[jid]) {
            delete adminSessions[from];
            return adminReply(from,"⚠️ User not found.");
          }
          sess.target = jid;
          if (users[jid].banned) {
            users[jid].banned = false;
            users[jid].banReason = '';
            saveUsers(users);
            delete adminSessions[from];
            return adminReply(from,`✅ ${users[jid].name} is now unbanned.`);
          } else {
            sess.step = 'getReason';
            return adminReply(from,"✏️ Enter ban reason:");
          }
        }
        if (sess.step === 'getReason') {
          users[sess.target].banned = true;
          users[sess.target].banReason = txt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,`🚫 ${users[sess.target].name} banned because: ${txt}`);
        }
        break;
      }

      // 5) Bulk → All Registered
      case 'bulkAll': {
        if (!sess.step) {
          sess.step = 'getMsg';
          return adminReply(from,"📝 Enter message to send to ALL users:");
        }
        if (sess.step === 'getMsg') {
          sess.message = txt;
          sess.step = 'confirm';
          return adminReply(from,
            `📝 Preview:\n"${txt}"\n\nType 'yes' to send or 'no' to cancel.`
          );
        }
        if (sess.step === 'confirm') {
          delete adminSessions[from];
          if (lc === 'yes') {
            for (let jid of Object.keys(users)) {
              await safeSend(jid, sess.message);
            }
            return adminReply(from,"🎉 Message sent to all users!");
          } else {
            return adminReply(from,"❌ Bulk cancelled.");
          }
        }
        break;
      }

      // 6) Show QR Dashboard
      case 'showQR':
        delete adminSessions[from];
        return adminReply(from,`🌐 Scan QR at http://localhost:${PORT}`);

      // 7) Config submenu
      case 'config':
        // First time: pick which text to edit
        if (!sess.step) {
          switch(txt) {
            case '1': sess.step='editAdmin';       return adminReply(from,"✏️ Enter new Admin Label:");
            case '2': sess.step='editWelcome';     return adminReply(from,"✏️ Enter new Welcome Text:");
            case '3': sess.step='editAskName';     return adminReply(from,"✏️ Enter new Ask-Name Text:");
            case '4': sess.step='editRegSuccess';  return adminReply(from,"✏️ Enter new Registration Success Text (use {name}):");
            case '5': sess.step='editUserMenu';    return adminReply(from,"✏️ Enter new User Menu Text (use {name}):");
            case '6': sess.step='editNotEnough';   return adminReply(from,"✏️ Enter new Not-Enough-Balance Text (use {cost},{bal}):");
            case '7': sess.step='editTopupPrompt'; return adminReply(from,"✏️ Enter new Top-up Prompt:");
            case '8': sess.step='editCost';        return adminReply(from,"✏️ Enter new costPerChar:");
            case '9': sess.step='editChannel';     return adminReply(from,"✏️ Enter new Channel ID:");
            case '0': delete adminSessions[from];  return showAdminMenu(from);
            default: return adminReply(from,"⚠️ Invalid option. Returning to Config menu.");
          }
        } else {
          // apply the edit
          switch(sess.step) {
            case 'editAdmin':
              botConfig.fromAdmin = txt; break;
            case 'editWelcome':
              botConfig.welcomeText = txt; break;
            case 'editAskName':
              botConfig.askNameText = txt; break;
            case 'editRegSuccess':
              botConfig.regSuccess = name => txt.replace('{name}', name); break;
            case 'editUserMenu':
              botConfig.userMenu = user => txt.replace('{name}', user.name||''); break;
            case 'editNotEnough':
              botConfig.notEnoughBal = (cost,bal) =>
                txt.replace('{cost}', cost.toFixed(2)).replace('{bal}', bal.toFixed(2));
              break;
            case 'editTopupPrompt':
              botConfig.topupPrompt = txt; break;
            case 'editCost':
              const c = parseFloat(txt);
              if (!isNaN(c) && c>0) botConfig.costPerChar = c;
              break;
            case 'editChannel':
              const ch = parseInt(txt);
              if (!isNaN(ch)) botConfig.channelID = ch;
              break;
          }
          delete adminSessions[from];
          return adminReply(from,"✅ Configuration updated.");
        }

      default:
        delete adminSessions[from];
        return adminReply(from,"⚠️ Unknown option, returning to main menu.");
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 7.3) USER REGISTRATION FLOW
  // ────────────────────────────────────────────────────────────────────
  if (!users[from]) {
    if (!conversations[from]) {
      conversations[from] = { stage:'awaitPhone' };
      return msg.reply(botConfig.welcomeText);
    }
    const conv = conversations[from];
    if (conv.stage === 'awaitPhone') {
      const jid = formatPhone(txt);
      if (!jid) {
        delete conversations[from];
        return msg.reply("⚠️ That doesn't look like a phone number. Please start again.");
      }
      users[from] = {
        phone: jid.replace('@c.us',''),
        name: '',
        registeredAt: new Date().toISOString(),
        balance: 0,
        banned: false,
        banReason: '',
        messageCount: 0,
        totalCharges: 0,
        recipients: [],
        support: { open:false, ticketId:null }
      };
      saveUsers(users);
      conversations[from].stage = 'awaitName';
      return msg.reply(botConfig.askNameText);
    }
    if (conv.stage === 'awaitName') {
      users[from].name = txt;
      saveUsers(users);
      await safeSend(SUPER_ADMIN,
        `🆕 *New Registration*\n• Name: ${users[from].name}\n• Phone: ${users[from].phone}`
      );
      delete conversations[from];
      return msg.reply(botConfig.regSuccess(users[from].name));
    }
    return;
  }

  // ────────────────────────────────────────────────────────────────────
  // 7.4) REGISTERED USER MAIN FLOW
  // ────────────────────────────────────────────────────────────────────
  const user = users[from];
  if (user.banned) {
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }

  // If in an ongoing user flow, resume it:
  const conv = conversations[from] || {};

  // 7️⃣ Delete My Account
  if (conv.stage === 'confirmDelete') {
    delete conversations[from];
    if (lc === 'yes') {
      delete users[from];
      saveUsers(users);
      return msg.reply("❌ Your account has been deleted. Send your phone to re-register.");
    } else {
      return msg.reply("✅ Deletion cancelled." + botConfig.userMenu(user));
    }
  }
  if (lc === '7' || lc === 'delete my account') {
    conversations[from] = { stage:'confirmDelete' };
    return msg.reply("⚠️ Are you sure you want to delete your account? Type 'yes' to confirm or 'no' to cancel.");
  }

  // 6️⃣ Contact Support
  if (!conv.stage && (lc === '6')) {
    user.support.open = true;
    user.support.ticketId = Date.now().toString().slice(-6);
    saveUsers(users);
    return msg.reply(
      `🆘 Support opened (#${user.support.ticketId}).\n` +
      `Type your message now. To close: type \`#close\`.`
    );
  }

  // 5️⃣ Check Balance
  if (!conv.stage && lc === '5') {
    return msg.reply(
      `💰 Your balance: Ksh ${user.balance.toFixed(2)}\n` +
      `✉️ Messages sent: ${user.messageCount}\n` +
      `💸 Total charges: Ksh ${user.totalCharges.toFixed(2)}`
    );
  }

  // 4️⃣ Top-up Flow (min Ksh 11)
  if (lc === '4' && !conv.stage) {
    conversations[from] = { stage:'topup:amount' };
    return msg.reply(botConfig.topupPrompt);
  }
  if (conv.stage === 'topup:amount') {
    const amt = parseFloat(txt);
    if (isNaN(amt) || amt < 11) {
      delete conversations[from];
      return msg.reply("⚠️ Minimum top-up is Ksh 11. Type '4' to try again.");
    }
    conv.amount = amt;
    conv.stage = 'topup:phone';
    return msg.reply(`📱 Send the M-PESA number to charge Ksh ${amt.toFixed(2)}:`);
  }
  if (conv.stage === 'topup:phone') {
    const mp = formatPhone(txt);
    const amt = conv.amount;
    delete conversations[from];
    if (!mp) {
      return msg.reply("⚠️ Invalid phone. Type '4' to restart.");
    }
    await msg.reply(`⏳ Initiating Ksh ${amt.toFixed(2)} top-up to ${mp.replace('@c.us','')}…`);
    const ref = await sendSTKPush(amt, mp.replace('@c.us',''));
    if (!ref) return msg.reply("❌ STK push failed. Try again.");

    setTimeout(() => safeSend(from,"⏳ 20s left…"),10000);
    setTimeout(() => safeSend(from,"⏳ 10s left…"),20000);

    return setTimeout(async () => {
      const st = await fetchTransactionStatus(ref);
      const ok = st?.status==='SUCCESS';
      const code = st?.provider_reference||'—';
      const now = new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
      if (ok) {
        user.balance += amt;
        saveUsers(users);
        await safeSend(from,
          `🎉 *Top-up Successful!*\n` +
          `• Amount: Ksh ${amt.toFixed(2)}\n` +
          `• Code: ${code}\n` +
          `• New Balance: Ksh ${user.balance.toFixed(2)}`
        );
        await safeSend(SUPER_ADMIN,
          `💰 *Deposit Success*\n` +
          `• User: ${user.name}\n` +
          `• Phone: ${mp.replace('@c.us','')}\n` +
          `• Amount: Ksh ${amt.toFixed(2)}\n` +
          `• Code: ${code}\n` +
          `• Time: ${now}`
        );
      } else {
        await safeSend(from,"❌ Top-up failed or timed out. Please try again.");
      }
    },30000);
  }

  // 1️⃣ Send Bulk Message
  if (lc === '1' && !conv.stage) {
    conversations[from] = { stage:'awaitBulk' };
    return msg.reply("✏️ Please type the message you want to send:");
  }
  if (conv.stage === 'awaitBulk') {
    conv.message = txt;
    conv.stage = 'confirmBulk';
    return msg.reply(
      `📝 Preview:\n"${txt}"\nCost: Ksh ${(txt.length*botConfig.costPerChar).toFixed(2)}\n` +
      `Type 'yes' to send or 'no' to cancel.`
    );
  }
  if (conv.stage === 'confirmBulk') {
    delete conversations[from];
    const cost = conv.message.length * botConfig.costPerChar;
    if (lc === 'yes') {
      for (let r of user.recipients) await safeSend(r, conv.message);
      user.balance -= cost;
      user.messageCount++;
      user.totalCharges += cost;
      saveUsers(users);
      return msg.reply(`✅ Message sent! Ksh ${cost.toFixed(2)} deducted. New bal: Ksh ${user.balance.toFixed(2)}`);
    } else {
      return msg.reply("❌ Bulk send cancelled." + botConfig.userMenu(user));
    }
  }

  // 2️⃣ Add Recipient
  if (lc === '2' && !conv.stage) {
    conversations[from] = { stage:'addRec' };
    return msg.reply("📥 Enter the phone number of the recipient to add:");
  }
  if (conv.stage === 'addRec') {
    delete conversations[from];
    const jid = formatPhone(txt);
    if (!jid) {
      return msg.reply("⚠️ Invalid phone number." + botConfig.userMenu(user));
    }
    if (!user.recipients.includes(jid)) {
      user.recipients.push(jid);
      saveUsers(users);
      return msg.reply(`✅ Recipient ${jid.replace('@c.us','')} added.` + botConfig.userMenu(user));
    } else {
      return msg.reply("⚠️ Already in your list." + botConfig.userMenu(user));
    }
  }

  // 3️⃣ Remove Recipient
  if (lc === '3' && !conv.stage) {
    conversations[from] = { stage:'delRec', target:null };
    return msg.reply("🗑️ Enter the phone number of the recipient to remove:");
  }
  if (conv.stage==='delRec' && !conv.target) {
    const jid = formatPhone(txt);
    if (!jid || !user.recipients.includes(jid)) {
      delete conversations[from];
      return msg.reply("⚠️ That number is not in your list." + botConfig.userMenu(user));
    }
    conv.target = jid;
    return msg.reply(`⚠️ Remove ${jid.replace('@c.us','')}? Type 'yes' to confirm or 'no' to cancel.`);
  }
  if (conv.stage==='delRec' && conv.target) {
    delete conversations[from];
    if (lc==='yes') {
      user.recipients = user.recipients.filter(r=>r!==conv.target);
      saveUsers(users);
      return msg.reply(`🗑️ Recipient ${conv.target.replace('@c.us','')} removed.` + botConfig.userMenu(user));
    } else {
      return msg.reply("✅ Removal cancelled." + botConfig.userMenu(user));
    }
  }

  // 8️⃣ View Recipients
  if (lc === '8' && !conv.stage) {
    if (user.recipients.length === 0) {
      return msg.reply("ℹ️ You have no recipients yet." + botConfig.userMenu(user));
    }
    let list = "📋 Your Recipients:";
    user.recipients.forEach((r,i)=> {
      list += `\n${i+1}. ${r.replace('@c.us','')}`;
    });
    return msg.reply(list + botConfig.userMenu(user));
  }

  // Default: show menu
  return msg.reply(botConfig.userMenu(user));
});

// ────────────────────────────────────────────────────────────────────
// 8) M-PESA STK PUSH & STATUS CHECK
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
      { headers: {
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
    console.error("Fetch Status Error:", err.message);
    return null;
  }
}
