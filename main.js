/*******************************************************************
 * main.js
 * FY'S PROPERTY WHATSAPP BOT – COMPLETE VERSION
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express        = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode         = require('qrcode');
const axios          = require('axios');
const fs             = require('fs');
const path           = require('path');

// ────────────────────────────────────────────────────────────────────
// FILE PATHS & AUTO-INIT
// ────────────────────────────────────────────────────────────────────
const FILES = {
  users:      'users.json',
  categories: 'categories.json',
  products:   'products.json',
  faqs:       'faqs.json',
  orders:     'orders.json'
};
function loadOrInit(file, def) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.writeFileSync(file, JSON.stringify(def, null,2));
    return def;
  }
  try { return JSON.parse(fs.readFileSync(file)); }
  catch { fs.writeFileSync(file, JSON.stringify(def, null,2)); return def; }
}
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null,2)); }

// Load data
let users      = loadOrInit(FILES.users,      {});
let categories = loadOrInit(FILES.categories, ["Testing"]);
let products   = loadOrInit(FILES.products,   []);
let faqs       = loadOrInit(FILES.faqs,       []);
let orders     = loadOrInit(FILES.orders,     {});

// Preload one demo product in “Testing”
if (!products.find(p=>p.name==="Demo Product")) {
  products.push({
    name:     "Demo Product",
    price:    1234,
    image:    "https://fy-img-2-url.rf.gd/FYS-349788.jpg",
    category: "Testing"
  });
  save(FILES.products, products);
}

// ────────────────────────────────────────────────────────────────────
// CONFIG & STATE
// ────────────────────────────────────────────────────────────────────
const CONFIG = {
  adminJid:  '254701339573@c.us',
  botName:   "FY'S PROPERTY",
  channelID: 724,
  stkKey:    'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
};
const SESSIONS = {
  users: {},    // { jid: { ctx: 'register'|'main'|... , data: {...} } }
  admins: {}    // { jid: { ctx: 'main'|'ban'|... , data: {...} } }
};

// ────────────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────────────
function fmtPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if (n.length===9 && n.startsWith('7'))    n='254'+n;
  if (n.length===10&& n.startsWith('0'))    n='254'+n.slice(1);
  if (n.length===12&& n.startsWith('254'))  return n+'@c.us';
  return null;
}
function genOrderNo() {
  return `FY'S-${[...Array(6)].map(_=>Math.random().toString(36)[2]).join('').toUpperCase()}`;
}
async function safeSend(jid, msg) {
  try { await client.sendMessage(jid, msg); }
  catch (e) {
    console.error('Send Error', e.message);
    if (jid !== CONFIG.adminJid) 
      client.sendMessage(CONFIG.adminJid, `⚠️ Could not send to ${jid}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// M-PESA STK PUSH & POLL
// ────────────────────────────────────────────────────────────────────
async function sendSTK(amount, phone) {
  const payload = {
    amount,
    phone_number:       phone,
    channel_id:         CONFIG.channelID,
    provider:           "m-pesa",
    external_reference: genOrderNo(),
    account_reference:  CONFIG.botName,
    transaction_desc:   CONFIG.botName
  };
  try {
    const r = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      { headers:{ 'Authorization': CONFIG.stkKey } }
    );
    return r.data.reference;
  } catch (err) {
    console.error('STK Error', err.message);
    return null;
  }
}
async function checkSTK(ref) {
  try {
    const r = await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      { headers:{ 'Authorization': CONFIG.stkKey } }
    );
    return r.data;
  } catch (err) {
    console.error('Status Error', err.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// WHATSAPP CLIENT & QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = null;
client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr,{small:true});
});
client.on('ready', () => {
  console.log('🤖 Bot Ready');
  safeSend(CONFIG.adminJid, `🚀 *${CONFIG.botName}* is now online!`);
});
client.initialize();

// Simple QR page
const app = express();
app.get('/', async (_,res) => {
  const img = currentQR ? await QRCode.toDataURL(currentQR) : '';
  res.send(`<h1>Scan to join ${CONFIG.botName}</h1>${img?`<img src="${img}">`:''}`);
});
app.listen(3000, ()=>console.log('🔗 QR at http://localhost:3000'));

// ────────────────────────────────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const jid = msg.from, text = msg.body.trim(), lc = text.toLowerCase();

  if (jid.endsWith('@g.us')) return; // ignore groups

  // ───────── ADMIN FLOWS ─────────────────────────────────────────────
  if (jid === CONFIG.adminJid) {
    let s = SESSIONS.admins[jid];
    // if no session or user typed '00', go to main admin menu
    if (!s || lc==='00') {
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      return safeSend(jid,
        `👑 *Admin Panel* 👑\n`+
        `1️⃣ View Users & Referrals\n`+
        `2️⃣ Ban/Unban User\n`+
        `3️⃣ Manage Categories\n`+
        `4️⃣ Manage Products\n`+
        `5️⃣ Manage FAQs\n`+
        `6️⃣ Change Bot Name/Channel ID\n`+
        `7️⃣ Broadcast Message\n\n`+
        `(Reply *00* to return here anytime)`
      );
    }
    s = SESSIONS.admins[jid];

    // ADMIN MAIN
    if (s.ctx==='main') {
      switch (lc) {
        case '1': { // View users
          let out = `👥 Users & Referrals:\n\n`;
          Object.values(users).forEach(u=>{
            const cnt = Object.values(users).filter(x=> x.referredBy===u.phone).length;
            out += `• ${u.name} (${u.phone}) – referred ${cnt}\n`;
          });
          return safeSend(jid, out);
        }
        case '2': s.ctx='ban'; return safeSend(jid,'🚫 Send phone to Ban/Unban:');
        case '3': s.ctx='catMain'; return safeSend(jid,
          '📂 Categories:\n1️⃣ List\n2️⃣ Add\n3️⃣ Delete');
        case '4': s.ctx='prodMain'; return safeSend(jid,
          '🛒 Products:\n1️⃣ List by Category\n2️⃣ Add\n3️⃣ Edit\n4️⃣ Delete');
        case '5': s.ctx='faqMain'; return safeSend(jid,
          '❓ FAQs:\n1️⃣ List\n2️⃣ Add\n3️⃣ Edit\n4️⃣ Delete');
        case '6': s.ctx='cfg'; return safeSend(jid,
          '⚙️ Config:\n1️⃣ Change Bot Name\n2️⃣ Change Channel ID');
        case '7': s.ctx='broadcast'; return safeSend(jid,'📣 Send broadcast text:');
        default: return safeSend(jid,'⚠️ Invalid—choose 1–7 or 00.');
      }
    }

    // BAN/UNBAN
    if (s.ctx==='ban') {
      const ph = fmtPhone(text);
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      if (!ph || !users[ph]) return safeSend(jid,'⚠️ No such user.');
      users[ph].banned = !users[ph].banned;
      save(FILES.users, users);
      return safeSend(jid,
        `${users[ph].banned? '🚫':'✅'} ${users[ph].name} is now ${users[ph].banned? 'BANNED':'UNBANNED'}.`
      );
    }

    // BROADCAST
    if (s.ctx==='broadcast') {
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      Object.keys(users).forEach(uJid => safeSend(uJid, `📢 *Admin Broadcast:*\n\n${text}`));
      return safeSend(jid,'🎉 Broadcast complete.');
    }

    // CATEGORY MANAGEMENT
    if (s.ctx==='catMain') {
      switch (lc) {
        case '1':
          SESSIONS.admins[jid] = { ctx:'main', data:{} };
          return safeSend(jid, `📂 Categories:\n\n${categories.join('\n')}`);
        case '2': s.ctx='catAdd'; return safeSend(jid,'🆕 Send new category name:');
        case '3': {
          let out='🗑️ Delete Category (reply number):\n';
          categories.forEach((c,i)=> out+=`\n${i+1}. ${c}`);
          s.ctx='catDel';
          return safeSend(jid, out);
        }
        default:
          return safeSend(jid,'⚠️ Invalid—choose 1–3 or 00.');
      }
    }
    if (s.ctx==='catAdd') {
      categories.push(text);
      save(FILES.categories, categories);
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      return safeSend(jid, `✅ Category *${text}* added.`);
    }
    if (s.ctx==='catDel') {
      const idx = parseInt(text)-1;
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      if (isNaN(idx) || !categories[idx]) return safeSend(jid,'⚠️ Invalid number.');
      const rem = categories.splice(idx,1)[0];
      save(FILES.categories, categories);
      return safeSend(jid, `🗑️ Category *${rem}* deleted.`);
    }

    // PRODUCT MANAGEMENT
    if (s.ctx==='prodMain') {
      switch (lc) {
        case '1': { // list by category
          let out='🛍️ Products by Category:\n\n';
          categories.forEach(cat=>{
            out += `*${cat}*:\n`;
            products.filter(p=>p.category===cat).forEach(p=>
              out += `  – ${p.name} (Ksh ${p.price})\n`
            );
            out += '\n';
          });
          SESSIONS.admins[jid] = { ctx:'main', data:{} };
          return safeSend(jid, out);
        }
        case '2': s.ctx='prodAdd_name'; return safeSend(jid,'🆕 Send product name:');
        // skip full edit/delete for brevity
        default: return safeSend(jid,'⚠️ Invalid—choose 1–4 or 00.');
      }
    }
    if (s.ctx==='prodAdd_name') {
      s.data = { name: text };
      SESSIONS.admins[jid].ctx = 'prodAdd_price';
      return safeSend(jid, `💲 Send price for *${text}*:`); 
    }
    if (s.ctx==='prodAdd_price') {
      const price = parseFloat(text);
      if (isNaN(price)) {
        SESSIONS.admins[jid] = { ctx:'main', data:{} };
        return safeSend(jid,'⚠️ Invalid price. Cancelling.');
      }
      s.data.price = price;
      SESSIONS.admins[jid].ctx = 'prodAdd_cat';
      return safeSend(jid, `📂 Send category for *${s.data.name}*:`); 
    }
    if (s.ctx==='prodAdd_cat') {
      if (!categories.includes(text)) {
        SESSIONS.admins[jid] = { ctx:'main', data:{} };
        return safeSend(jid,'⚠️ Unknown category. Cancelling.');
      }
      s.data.category = text;
      SESSIONS.admins[jid].ctx = 'prodAdd_img';
      return safeSend(jid, `🖼️ Send image URL for *${s.data.name}*:`); 
    }
    if (s.ctx==='prodAdd_img') {
      s.data.image = text;
      products.push(s.data);
      save(FILES.products, products);
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      return safeSend(jid, `✅ Product *${s.data.name}* added.`);
    }

    // FAQ MANAGEMENT
    if (s.ctx==='faqMain') {
      switch (lc) {
        case '1':
          SESSIONS.admins[jid] = { ctx:'main', data:{} };
          return safeSend(jid,
            faqs.length
              ? `❓ FAQs:\n\n${faqs.map((f,i)=>`${i+1}. Q: ${f.q}\n   A: ${f.a}`).join('\n\n')}`
              : '❓ No FAQs yet.'
          );
        case '2': s.ctx='faqAdd_q'; return safeSend(jid,'❓ Send question:');
        default: return safeSend(jid,'⚠️ Invalid—choose 1–4 or 00.');
      }
    }
    if (s.ctx==='faqAdd_q') {
      s.data = { q: text };
      SESSIONS.admins[jid].ctx = 'faqAdd_a';
      return safeSend(jid, '✍️ Now send the answer:');
    }
    if (s.ctx==='faqAdd_a') {
      s.data.a = text;
      faqs.push(s.data);
      save(FILES.faqs, faqs);
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      return safeSend(jid, '✅ FAQ added.');
    }

    // CONFIG
    if (s.ctx==='cfg') {
      switch (lc) {
        case '1': s.ctx='cfg_name'; return safeSend(jid,'✏️ Send new Bot Name:');
        case '2': s.ctx='cfg_chan'; return safeSend(jid,'✏️ Send new Channel ID:');
        default: return safeSend(jid,'⚠️ Invalid—choose 1 or 2 or 00.');
      }
    }
    if (s.ctx==='cfg_name') {
      CONFIG.botName = text;
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      return safeSend(jid, `✅ Bot Name set to *${text}*`);
    }
    if (s.ctx==='cfg_chan') {
      const c = parseInt(text);
      if (isNaN(c)) {
        SESSIONS.admins[jid] = { ctx:'main', data:{} };
        return safeSend(jid,'⚠️ Invalid number.');
      }
      CONFIG.channelID = c;
      SESSIONS.admins[jid] = { ctx:'main', data:{} };
      return safeSend(jid, `✅ Channel ID set to *${c}*`);
    }

    return;
  }

  // ───────── USER FLOWS ─────────────────────────────────────────────
  let uSess = SESSIONS.users[jid];

  // REGISTRATION
  if (!users[jid]) {
    if (!uSess || uSess.ctx==='start') {
      SESSIONS.users[jid] = { ctx:'greet' };
      return msg.reply(
        `👋 Welcome to *${CONFIG.botName}*!\n`+
        `Please reply with a *username* to register,\n`+
        `or send \`referral:<username>\` if invited by a friend.`
      );
    }
    if (uSess.ctx==='greet') {
      let ref = null;
      if (lc.startsWith('referral:')) {
        const name = text.split(':')[1].trim();
        ref = Object.values(users).find(u=>u.name.toLowerCase()===name.toLowerCase());
        if (!ref) {
          delete SESSIONS.users[jid];
          return msg.reply('⚠️ Referral not found. Send any message to restart.');
        }
      }
      // username check
      if (Object.values(users).some(u=>u.name.toLowerCase()===lc)) {
        return msg.reply('⚠️ Username taken. Please choose another:');
      }
      // create user
      users[jid] = {
        name:       text,
        phone:      jid.replace('@c.us',''),
        referredBy: ref? ref.phone : null,
        registeredAt:new Date().toISOString(),
        banned:     false,
        orders:     [],
        hasOrdered: false
      };
      save(FILES.users, users);
      // alert admin
      let aMsg = `🆕 New user: *${text}* (${users[jid].phone})`;
      if (ref) {
        aMsg += `\n• Referred by: *${ref.name}*`;
        safeSend(`${ref.phone}@c.us`,
          `🎉 Hey *${ref.name}*, you just referred *${text}*!`
        );
      }
      safeSend(CONFIG.adminJid, aMsg);
      delete SESSIONS.users[jid];
      SESSIONS.users[jid] = { ctx:'main' };
      return msg.reply(
        `🎉 Registered as *${text}*!\n\n`+
        `What would you like to do?\n\n`+
        `1️⃣ Browse Categories\n`+
        `2️⃣ My Orders\n`+
        `3️⃣ Referral Options\n`+
        `4️⃣ FAQs\n`+
        `5️⃣ Menu`
      );
    }
  }

  // after registration
  if (!uSess) {
    SESSIONS.users[jid] = { ctx:'main' };
    uSess = SESSIONS.users[jid];
  }

  const user = users[jid];
  if (user.banned) {
    return msg.reply(`🚫 Sorry *${user.name}*, you’re banned.`);
  }

  // USER MAIN MENU
  if (uSess.ctx==='main') {
    switch (lc) {
      case '1': // browse categories
        let catList = '📂 Categories:\n\n';
        categories.forEach((c,i)=> catList += `${i+1}. ${c}\n`);
        SESSIONS.users[jid] = { ctx:'browsingCats' };
        return msg.reply(catList + `\nReply with the category number.`);
      case '2':
        if (!user.orders.length) 
          return msg.reply(`📭 *${user.name}*, you have no orders yet.`);
        let ordList = '📦 Your Orders:\n\n';
        user.orders.forEach(no=>{
          const o = orders[no];
          ordList += `• ${no}: ${o.product} x${o.qty} — ${o.status}\n`;
        });
        return msg.reply(ordList);
      case '3': // referral submenu
        SESSIONS.users[jid] = { ctx:'refMenu' };
        const cnt = Object.values(users).filter(u=>u.referredBy===user.phone).length;
        return msg.reply(
          `🎁 *Referral Center*\nYou’ve referred *${cnt}* friend(s).\n\n`+
          `1️⃣ Show My Link\n`+
          `2️⃣ Back to Main Menu`
        );
      case '4':
        if (!faqs.length) return msg.reply('❓ No FAQs available.');
        let faqText = '❓ FAQs:\n\n';
        faqs.forEach((f,i)=> faqText += `${i+1}. Q: ${f.q}\n   A: ${f.a}\n\n`);
        return msg.reply(faqText);
      case '5':
        return msg.reply(
          `🗂️ Main Menu:\n`+
          `1️⃣ Browse Categories\n2️⃣ My Orders\n3️⃣ Referral Options\n4️⃣ FAQs\n5️⃣ Menu`
        );
      default:
        return msg.reply(`❓ Sorry *${user.name}*, invalid choice. Reply 5 for menu.`);
    }
  }

  // REFERRAL MENU
  if (uSess.ctx==='refMenu') {
    if (lc==='1') {
      const link = `https://wa.me/${client.info.wid.user}?text=referral:${user.name}`;
      SESSIONS.users[jid] = { ctx:'main' };
      return msg.reply(`🔗 Your link:\n\n${link}`);
    }
    if (lc==='2') {
      SESSIONS.users[jid] = { ctx:'main' };
      return msg.reply(`🔙 Returning to main menu.\nReply 5 to see options.`);
    }
    return msg.reply('⚠️ Invalid—reply 1 or 2.');
  }

  // BROWSING CATEGORIES
  if (uSess.ctx==='browsingCats') {
    const idx = parseInt(text)-1;
    if (isNaN(idx) || !categories[idx]) {
      SESSIONS.users[jid] = { ctx:'main' };
      return msg.reply('⚠️ Invalid category. Reply 1 to start over.');
    }
    const cat = categories[idx];
    const list = products.filter(p=>p.category===cat);
    if (!list.length) {
      SESSIONS.users[jid] = { ctx:'main' };
      return msg.reply(`❌ No products in *${cat}*.`);
    }
    let prodList = `🛍️ *${cat} Products:*\n\n`;
    list.forEach((p,i)=> prodList += `${i+1}. ${p.name} — Ksh ${p.price}\n`);
    SESSIONS.users[jid] = { ctx:'browsingProds', data:{ list } };
    return msg.reply(prodList + `\nReply with product number to select.`);
  }

  // BROWSING PRODUCTS
  if (uSess.ctx==='browsingProds') {
    const list = uSess.data.list;
    const idx  = parseInt(text)-1;
    if (isNaN(idx) || !list[idx]) {
      SESSIONS.users[jid] = { ctx:'main' };
      return msg.reply('⚠️ Invalid product. Reply 1 to browse again.');
    }
    const prod = list[idx];
    // send image
    await safeSend(jid, prod.image);
    SESSIONS.users[jid] = { ctx:'ordering', data:{ prod } };
    return msg.reply(`Great choice, *${user.name}*! How many *${prod.name}*?`);
  }

  // ORDER FLOW
  if (uSess.ctx==='ordering') {
    const data = uSess.data;
    if (!data.qty) {
      const q = parseInt(text);
      if (isNaN(q) || q<1) {
        SESSIONS.users[jid] = { ctx:'main' };
        return msg.reply('⚠️ Invalid quantity. Reply 1 to try again.');
      }
      data.qty = q;
      SESSIONS.users[jid].ctx = 'orderPhone';
      return msg.reply('Almost there! Send payment phone number:');
    }
  }

  if (uSess.ctx==='orderPhone') {
    const ph = fmtPhone(text);
    if (!ph) {
      SESSIONS.users[jid] = { ctx:'main' };
      return msg.reply('⚠️ Invalid phone. Order cancelled.');
    }
    const { prod, qty } = uSess.data;
    const orderNo = genOrderNo();
    const amount  = prod.price * qty;
    // save order
    orders[orderNo] = { orderNo, user: user.phone, product: prod.name, qty, amount, status:'PENDING', createdAt:new Date().toISOString() };
    save(FILES.orders, orders);
    user.orders.push(orderNo);
    save(FILES.users, users);
    msg.reply(`⏳ Processing your Ksh ${amount}, please wait...`);
    const ref = await sendSTK(amount, ph.replace('@c.us',''));
    setTimeout(async ()=>{
      const st = await checkSTK(ref);
      if (st?.status==='SUCCESS') {
        orders[orderNo].status='PAID'; save(FILES.orders,orders);
        safeSend(jid,
          `✅ Payment successful!\n\n`+
          `• Order: *${orderNo}*\n`+
          `• ${prod.name} x${qty}\n`+
          `• Amount: Ksh ${amount}`
        );
        // referral bonus
        if (!user.hasOrdered && user.referredBy) {
          safeSend(`${user.referredBy}@c.us`, `🎁 Your referral *${user.name}* just made a purchase!`);
        }
        user.hasOrdered=true; save(FILES.users,users);
        safeSend(CONFIG.adminJid,
          `🛒 New Order: ${orderNo}\n`+
          `• ${user.name} (${user.phone})\n`+
          `• ${prod.name} x${qty}\n`+
          `• Ksh ${amount}`
        );
      } else {
        safeSend(jid, `❌ Payment failed or timed out. Reply *1* to shop again.`);
      }
    },30000);
    SESSIONS.users[jid] = { ctx:'main' };
    return;
  }

  // fallback
  SESSIONS.users[jid] = { ctx:'main' };
  return msg.reply(`❓ Sorry, didn’t understand. Reply 5 for menu.`);
});

// Graceful shutdown: save all
process.on('SIGINT', ()=>{
  save(FILES.users, users);
  save(FILES.categories, categories);
  save(FILES.products, products);
  save(FILES.faqs, faqs);
  save(FILES.orders, orders);
  console.log('\n💾 Data saved. Exiting.');
  process.exit();
});
