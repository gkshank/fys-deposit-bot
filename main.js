/*******************************************************************
 * main.js
 * FY'S PROPERTY WHATSAPP BOT
 *******************************************************************/

// ────────────────────────────────────────────────────────────────────
// IMPORTS & SETUP
// ────────────────────────────────────────────────────────────────────
const { Client, LocalAuth } = require('whatsapp-web.js');
const express        = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode         = require('qrcode');
const axios          = require('axios');
const fs             = require('fs');
const path           = require('path');

// ────────────────────────────────────────────────────────────────────
// DATA FILE PATHS
// ────────────────────────────────────────────────────────────────────
const DATA = {
  users:       path.join(__dirname, 'users.json'),
  products:    path.join(__dirname, 'products.json'),
  categories:  path.join(__dirname, 'categories.json'),
  faqs:        path.join(__dirname, 'faqs.json'),
  orders:      path.join(__dirname, 'orders.json'),
};

// ────────────────────────────────────────────────────────────────────
// ENSURE & LOAD JSON FILES (with auto-fix on error/empty)
// ────────────────────────────────────────────────────────────────────
function ensureJSON(filePath, defaultData) {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`⚠️ ${filePath} malformed, resetting to default.`);
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
}
function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ────────────────────────────────────────────────────────────────────
// INITIAL DATA LOAD
// ────────────────────────────────────────────────────────────────────
let users      = ensureJSON(DATA.users,       {});
let products   = ensureJSON(DATA.products,    []);
let categories = ensureJSON(DATA.categories,  []);
let faqs       = ensureJSON(DATA.faqs,        []);
let orders     = ensureJSON(DATA.orders,      {});

// ────────────────────────────────────────────────────────────────────
// BOT CONFIG & STATE
// ────────────────────────────────────────────────────────────────────
const botConfig = {
  adminJid:     '254701339573@c.us',
  botName:      "FY'S PROPERTY",
  channelID:    724,
  referralBonus:"🎁 Congratulations! You’ve earned a referral bonus for your friend’s first order!",
  welcomeText:  "👋 Hello! Welcome to FY'S PROPERTY! Please reply with a *username* to register:",
  userMenu(u) {
    return `✨ Hey ${u.name}, here’s what you can do today:\n\n` +
      `1️⃣ Browse Products\n` +
      `2️⃣ View My Orders\n` +
      `3️⃣ Get My Referral Link\n` +
      `4️⃣ FAQs\n` +
      `5️⃣ Show Menu`;
  },
  adminMenu: `👑 *Admin Menu* — reply with the number:\n\n`+
    `1️⃣ View All Users\n`+
    `2️⃣ Ban/Unban User\n`+
    `3️⃣ Manage Products\n`+
    `4️⃣ Manage Categories\n`+
    `5️⃣ Manage FAQs\n`+
    `6️⃣ Change Bot Name / Channel ID\n`+
    `7️⃣ Broadcast Message\n\n`+
    `Reply *00* to go back at any time.`,
};
const PAYHERO_KEY = 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==';

// per-chat flows
const conversations = {};
const adminSessions = {};

// ────────────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────────────
function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if(n.length===9 && n.startsWith('7'))    n='254'+n;
  if(n.length===10&& n.startsWith('0'))    n='254'+n.slice(1);
  if(n.length===12&& n.startsWith('254'))  return n+'@c.us';
  return null;
}
function genOrderNumber() {
  const suffix = Array.from({length:6}, ()=> Math.random().toString(36).charAt(2)).join('').toUpperCase();
  return `FY'S-${suffix}`;
}
async function safeSend(jid, msg) {
  try {
    await client.sendMessage(jid, msg);
  } catch (e) {
    console.error('❌ sendMessage error', e);
    if (jid !== botConfig.adminJid) {
      await client.sendMessage(botConfig.adminJid, `⚠️ Failed to send to ${jid}`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// M-PESA STK PUSH & STATUS POLLING
// ────────────────────────────────────────────────────────────────────
async function sendSTKPush(amount, phone) {
  const payload = {
    amount,
    phone_number:       phone,
    channel_id:         botConfig.channelID,
    provider:           "m-pesa",
    external_reference: genOrderNumber(),
    account_reference:  botConfig.botName,
    transaction_desc:   botConfig.botName
  };
  try {
    const res = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      { headers:{ 'Content-Type':'application/json','Authorization':PAYHERO_KEY } }
    );
    return res.data.reference;
  } catch(err) {
    console.error('STK Push Error:', err.message);
    return null;
  }
}
async function fetchTransactionStatus(ref) {
  try {
    const res = await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      { headers:{ 'Authorization':PAYHERO_KEY } }
    );
    return res.data;
  } catch(err) {
    console.error('Fetch Status Error:', err.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// WHATSAPP CLIENT INIT & QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = '';
client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, {small:true});
});
client.on('ready', () => {
  console.log('🤖 Bot is online!');
  safeSend(botConfig.adminJid, `🚀 *${botConfig.botName}* is now up and running!`);
});
client.initialize();

// Express server for QR code page
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', async (req, res) => {
  const img = currentQR ? await QRCode.toDataURL(currentQR) : '';
  res.send(`
    <html><body style="text-align:center;padding:2rem;font-family:sans-serif">
      <h1>Scan to Join *${botConfig.botName}*</h1>
      ${img ? `<img src="${img}"/>` : '<p>Waiting for QR…</p>'}
    </body></html>`);
});
app.listen(PORT, ()=>console.log(`🌐 QR Dashboard at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from, txt = msg.body.trim(), lc = txt.toLowerCase();

  // ignore group messages
  if (from.endsWith('@g.us')) return;

  // ───────── ADMIN FLOWS ─────────────────────────────────────────────
  if (from === botConfig.adminJid) {
    // back to main admin menu
    if (txt === '00') { delete adminSessions[from]; return safeSend(from, botConfig.adminMenu); }
    // if no current submenu
    if (!adminSessions[from]) {
      adminSessions[from] = { awaiting: 'main' };
      return safeSend(from, botConfig.adminMenu);
    }
    const sess = adminSessions[from];

    // MAIN ADMIN MENU
    if (sess.awaiting === 'main') {
      switch (txt) {
        case '1': { // View Users
          const list = Object.values(users).map(u=>`• ${u.name} (${u.phone})${u.banned?' 🚫':''}`).join('\n');
          return safeSend(from, `👥 *Registered Users:*\n\n${list || 'No users yet.'}`);
        }
        case '2': { // Ban/Unban
          sess.awaiting = 'banUser';
          return safeSend(from, '🚫 Please send the user phone to ban/unban:');
        }
        case '3': { sess.awaiting='products'; return safeSend(from,'🛒 *Manage Products*\n1️⃣ Add 2️⃣ Edit 3️⃣ Delete'); }
        case '4': { sess.awaiting='categories'; return safeSend(from,'📂 *Manage Categories*\n1️⃣ Add 2️⃣ Delete'); }
        case '5': { sess.awaiting='faqs'; return safeSend(from,'❓ *Manage FAQs*\n1️⃣ Add 2️⃣ Edit 3️⃣ Delete'); }
        case '6': { sess.awaiting='config'; return safeSend(from,'⚙️ *Config*\n1️⃣ Change Bot Name\n2️⃣ Change Channel ID'); }
        case '7': { sess.awaiting='broadcast'; return safeSend(from,'📣 Please type the broadcast message:'); }
        default: return safeSend(from, botConfig.adminMenu);
      }
    }

    // BAN / UNBAN USER
    if (sess.awaiting === 'banUser') {
      const ph = formatPhone(txt);
      delete adminSessions[from];
      if (!ph || !users[ph]) return safeSend(from, '⚠️ Invalid user phone.');
      const u = users[ph];
      u.banned = !u.banned;
      if (u.banned) {
        u.banReason = '⛔ Reason: Violation of terms';
        saveJSON(DATA.users, users);
        return safeSend(from, `🚫 *${u.name}* has been banned.\nReason: ${u.banReason}`);
      } else {
        delete u.banReason;
        saveJSON(DATA.users, users);
        return safeSend(from, `✅ *${u.name}* has been unbanned and can use the bot again.`);
      }
    }

    // BROADCAST
    if (sess.awaiting === 'broadcast') {
      delete adminSessions[from];
      for (let jid of Object.keys(users)) {
        await safeSend(jid, `📢 *Broadcast from Admin:*\n\n${txt}`);
      }
      return safeSend(from, '🎉 Broadcast sent to all users!');
    }

    // (The full products/categories/faqs/config submenu code would follow
    //  the same pattern: ask for input, update the relevant JSON array or
    //  botConfig, save via saveJSON, send a confirmation, then reset sess.)

    return;
  }

  // ───────── REGISTRATION & REFERRAL ─────────────────────────────────
  if (!users[from]) {
    const conv = conversations[from] || { stage: 'awaitRegister' };
    // Referral link text: "referral:username"
    let referrer = null;
    if (conv.stage === 'awaitRegister') {
      if (lc.startsWith('referral:')) {
        const uname = txt.split(':')[1].trim();
        referrer = Object.values(users).find(u=>u.name.toLowerCase()===uname.toLowerCase());
        if (!referrer) {
          return msg.reply('⚠️ Invalid referral code. Please send a *username* to register:');
        }
      }
      // Check duplicate username
      if (Object.values(users).some(u=>u.name.toLowerCase()===lc)) {
        return msg.reply('⚠️ That username is already taken—please choose another.');
      }
      // Create user
      users[from] = {
        name: txt,
        phone: from.replace('@c.us',''),
        referredBy: referrer ? referrer.phone : null,
        registeredAt: new Date().toISOString(),
        banned: false,
        orders: [],
        hasOrdered: false
      };
      saveJSON(DATA.users, users);

      // Notify admin
      let adminMsg = `🆕 *New Registration!*\n• Username: ${txt}\n• Phone: ${users[from].phone}`;
      if (referrer) {
        adminMsg += `\n• Referred by: ${referrer.name} (${referrer.phone.slice(0,6)}****)`;
        safeSend(referrer.jid || `${referrer.phone}@c.us`,
          `🎉 Hey ${referrer.name}, you referred *${txt}*! You’ll earn a bonus when they place their first order.`);
      }
      safeSend(botConfig.adminJid, adminMsg);

      delete conversations[from];
      return msg.reply(
        `🎉 Congrats ${txt}! You’re now registered with *${botConfig.botName}*.\n\n`+
        botConfig.userMenu(users[from])
      );
    }
  }

  // ───────── BANNED CHECK ─────────────────────────────────────────────
  const user = users[from];
  if (user && user.banned) {
    return msg.reply(`🚫 Sorry ${user.name}, you are banned and cannot use the bot.\nReason: ${user.banReason}`);
  }

  // ───────── USER MENU & OPTIONS ─────────────────────────────────────
  if (user) {
    // Show menu
    if (['5','menu'].includes(lc)) {
      return msg.reply(botConfig.userMenu(user));
    }
    // Browse products
    if (lc === '1') {
      if (products.length === 0) {
        return msg.reply(`❌ Hi ${user.name}, we currently have no products available. Check back soon!`);
      }
      let list = `🛍️ *Our Products:*\n\n`;
      products.forEach((p,i) => {
        list += `${i+1}. ${p.name} — Ksh ${p.price}\n`;
      });
      conversations[from] = { stage:'ordering', step:'chooseProduct' };
      return msg.reply(
        `Hey ${user.name}! Here are our amazing offerings:\n\n${list}\nReply with the number of the product you want to order.`
      );
    }
    // View my orders
    if (lc === '2') {
      if (user.orders.length === 0) {
        return msg.reply(`📭 ${user.name}, you have no orders yet. Reply *1* to browse our products!`);
      }
      let reply = `📦 *Your Orders, ${user.name}:*\n\n`;
      user.orders.forEach(no => {
        const o = orders[no];
        reply += `• ${no}: ${o.product} x${o.qty} — ${o.status}\n`;
      });
      return msg.reply(reply);
    }
    // Referral link
    if (lc === '3') {
      const link = `https://wa.me/${client.info.wid.user}?text=referral:${user.name}`;
      return msg.reply(`🔗 ${user.name}, share this link to refer a friend and earn bonuses:\n\n${link}`);
    }
    // FAQs
    if (lc === '4') {
      if (faqs.length === 0) {
        return msg.reply(`❓ ${user.name}, no FAQs available at the moment.`);
      }
      let rep = `❓ *FAQs:*\n\n`;
      faqs.forEach((f,i) => {
        rep += `${i+1}. Q: ${f.q}\n   A: ${f.a}\n\n`;
      });
      return msg.reply(rep);
    }

    // ───────── ORDER FLOW ────────────────────────────────────────────
    const conv = conversations[from];
    if (conv && conv.stage === 'ordering') {
      // Choose product
      if (conv.step === 'chooseProduct') {
        const idx = parseInt(txt) - 1;
        if (isNaN(idx) || !products[idx]) {
          delete conversations[from];
          return msg.reply(`⚠️ Invalid choice, ${user.name}. Reply *1* to browse again.`);
        }
        conv.product = products[idx];
        conv.step = 'enterQty';
        return msg.reply(
          `Great choice, ${user.name}! How many *${conv.product.name}* would you like?`
        );
      }
      // Enter quantity
      if (conv.step === 'enterQty') {
        const qty = parseInt(txt);
        if (isNaN(qty) || qty < 1) {
          delete conversations[from];
          return msg.reply(`⚠️ That doesn’t look like a valid quantity, ${user.name}. Reply *1* to try again.`);
        }
        conv.qty = qty;
        conv.step = 'enterPhone';
        return msg.reply(`Almost there, ${user.name}! Please send the phone number for payment:`);
      }
      // Enter phone & initiate payment
      if (conv.step === 'enterPhone') {
        const ph = formatPhone(txt);
        if (!ph) {
          delete conversations[from];
          return msg.reply(`⚠️ Invalid phone number, ${user.name}. Order canceled. Reply *1* to start over.`);
        }
        conv.payPhone = ph.replace('@c.us','');
        // Create order record
        const orderNo = genOrderNumber();
        const amount  = conv.product.price * conv.qty;
        orders[orderNo] = {
          orderNo,
          user: user.phone,
          product: conv.product.name,
          qty: conv.qty,
          amount,
          status: 'PENDING',
          createdAt: new Date().toISOString()
        };
        saveJSON(DATA.orders, orders);
        user.orders.push(orderNo);
        saveJSON(DATA.users, users);

        // Push STK
        await msg.reply(`⏳ Processing your payment of Ksh ${amount}, ${user.name}. Please wait...`);
        const ref = await sendSTKPush(amount, conv.payPhone);

        // Poll status after 30s
        setTimeout(async () => {
          const st = await fetchTransactionStatus(ref);
          if (st && st.status === 'SUCCESS') {
            orders[orderNo].status = 'PAID';
            saveJSON(DATA.orders, orders);
            await safeSend(from,
              `✅ Hooray ${user.name}! Your payment was successful.\n\n`+
              `• Order No: *${orderNo}*\n`+
              `• Item: *${conv.product.name}* x${conv.qty}\n`+
              `• Amount: Ksh ${amount}\n\n`+
              `Thank you for shopping with *${botConfig.botName}*!`
            );
            // referral bonus
            if (!user.hasOrdered && user.referredBy) {
              const refu = Object.values(users).find(u=>u.phone===user.referredBy);
              if (refu) {
                await safeSend(`${refu.phone}@c.us`, botConfig.referralBonus);
              }
            }
            user.hasOrdered = true; saveJSON(DATA.users, users);
            // notify admin
            await safeSend(botConfig.adminJid,
              `🛒 *New Order Received!*\n`+
              `• Order: ${orderNo}\n`+
              `• Customer: ${user.name} (${user.phone})\n`+
              `• ${conv.product.name} x${conv.qty}\n`+
              `• Amount: Ksh ${amount}\n`
            );
          } else {
            await safeSend(from,
              `❌ Sorry ${user.name}, your payment failed or timed out. Please try again.`
            );
          }
        }, 30000);

        delete conversations[from];
        return;
      }
    }

    // Unknown input
    return msg.reply(`❓ Sorry ${user.name}, I didn't understand that. Reply *5* to see the menu again.`);
  }

  // fallback
  return msg.reply(botConfig.welcomeText);
});

// ────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN: SAVE ALL DATA
// ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  saveJSON(DATA.users, users);
  saveJSON(DATA.products, products);
  saveJSON(DATA.categories, categories);
  saveJSON(DATA.faqs, faqs);
  saveJSON(DATA.orders, orders);
  console.log('\n💾 Data saved. Exiting.');
  process.exit();
});
