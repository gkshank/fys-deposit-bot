/*******************************************************************
 * main.js
 * FY'S PROPERTY WHATSAPP BOT – FULLY FUNCTIONAL VERSION
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
// ENSURE & LOAD JSON FILES (auto-fix empty/malformed)
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
    console.warn(`⚠️ ${filePath} malformed; resetting.`);
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
  referralBonus:"🎁 Fantastic! You’ve earned a referral bonus after your friend’s first purchase!",
  welcomeText:  "👋 Hello and welcome to *FY'S PROPERTY*! I’m here to help you shop easily.\n\nPlease reply with a *username* to get started:",
  userMenu(u) {
    return `✨ Hey *${u.name}* – here’s what you can do:\n\n` +
      `1️⃣ Browse Products\n` +
      `2️⃣ View My Orders\n` +
      `3️⃣ Get My Referral Link\n` +
      `4️⃣ FAQs\n` +
      `5️⃣ Show Menu\n\n` +
      `Just send the number of your choice!`;
  },
  adminMenu: `👑 *Admin Control Center* 👑\n\nReply with the number:\n\n`+
    `1️⃣ View All Users\n`+
    `2️⃣ Ban or Unban a User\n`+
    `3️⃣ Manage Products\n`+
    `4️⃣ Manage Categories\n`+
    `5️⃣ Manage FAQs\n`+
    `6️⃣ Change Bot Name or Channel ID\n`+
    `7️⃣ Broadcast a Message\n\n`+
    `Reply *00* anytime to return here.`,
};
const PAYHERO_KEY = 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==';

// per-chat finite-state trackers
const conversations = {};
const adminSessions = {};

// ────────────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────────────
function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if (n.length===9  && n.startsWith('7'))    n = '254'+n;
  if (n.length===10 && n.startsWith('0'))    n = '254'+n.slice(1);
  if (n.length===12 && n.startsWith('254'))  return n+'@c.us';
  return null;
}
function genOrderNumber() {
  const suffix = Array.from({length:6},()=> Math.random().toString(36)[2]).join('').toUpperCase();
  return `FY'S-${suffix}`;
}
async function safeSend(jid, msg) {
  try {
    await client.sendMessage(jid, msg);
  } catch (e) {
    console.error('❌ Error sending to', jid, e.message);
    if (jid !== botConfig.adminJid) {
      await client.sendMessage(botConfig.adminJid, `⚠️ Could not send message to ${jid}`);
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
  qrcodeTerminal.generate(qr,{ small:true });
});
client.on('ready', () => {
  console.log('🤖 Bot is LIVE!');
  safeSend(botConfig.adminJid, `🚀 *${botConfig.botName}* is now up and ready for action!`);
});
client.initialize();

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', async (req,res) => {
  const img = currentQR ? await QRCode.toDataURL(currentQR) : '';
  res.send(`
    <html><body style="font-family:sans-serif; text-align:center; padding:2rem">
      <h1>Scan to Join *${botConfig.botName}*</h1>
      ${img ? `<img src="${img}" />` : `<p>Waiting for QR code...</p>`}
      <p style="margin-top:1rem; color:#666">Make sure your phone is online and WhatsApp is open.</p>
    </body></html>`);
});
app.listen(PORT, ()=>console.log(`🌐 QR Dashboard: http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const from = msg.from;
  const txt  = msg.body.trim();
  const lc   = txt.toLowerCase();

  // ignore group chats
  if (from.endsWith('@g.us')) return;

  // ───────── ADMIN SECTION ───────────────────────────────────────────
  if (from === botConfig.adminJid) {
    // return to main admin menu
    if (lc === '00') {
      delete adminSessions[from];
      return safeSend(from, botConfig.adminMenu);
    }
    // start admin menu if no active session
    if (!adminSessions[from]) {
      adminSessions[from] = { awaiting: 'main' };
      return safeSend(from, botConfig.adminMenu);
    }
    const sess = adminSessions[from];

    // MAIN ADMIN MENU CHOICES
    if (sess.awaiting === 'main') {
      switch (lc) {
        case '1': {
          const userList = Object.values(users)
            .map(u=>`• ${u.name} (${u.phone})${u.banned?' 🚫':''}`)
            .join('\n') || '— No users registered yet —';
          return safeSend(from, `👥 *Registered Users:*\n\n${userList}`);
        }
        case '2': {
          sess.awaiting = 'banUser';
          return safeSend(from, '🚫 *Ban/Unban*\nSend the user’s phone number to toggle ban status:');
        }
        case '3': {
          sess.awaiting = 'manageProducts';
          return safeSend(from,
            '🛒 *Manage Products*\n' +
            'Reply with:\n1️⃣ Add Product\n2️⃣ Edit Product\n3️⃣ Delete Product'
          );
        }
        case '4': {
          sess.awaiting ='manageCategories';
          return safeSend(from,
            '📂 *Manage Categories*\n' +
            'Reply with:\n1️⃣ Add Category\n2️⃣ Delete Category'
          );
        }
        case '5': {
          sess.awaiting ='manageFAQs';
          return safeSend(from,
            '❓ *Manage FAQs*\n' +
            'Reply with:\n1️⃣ Add FAQ\n2️⃣ Edit FAQ\n3️⃣ Delete FAQ'
          );
        }
        case '6': {
          sess.awaiting = 'manageConfig';
          return safeSend(from,
            '⚙️ *Change Config*\n' +
            'Reply with:\n1️⃣ Change Bot Name\n2️⃣ Change Channel ID'
          );
        }
        case '7': {
          sess.awaiting = 'broadcast';
          return safeSend(from, '📣 *Broadcast*\nPlease type the message you want to send to everyone:');
        }
        default:
          return safeSend(from, botConfig.adminMenu);
      }
    }

    // BAN / UNBAN FLOW
    if (sess.awaiting === 'banUser') {
      const ph = formatPhone(txt);
      delete adminSessions[from];
      if (!ph || !users[ph]) {
        return safeSend(from, '⚠️ That phone is invalid or not registered. Start again with *00*.');
      }
      const u = users[ph];
      u.banned = !u.banned;
      if (u.banned) {
        u.banReason = 'Violation of terms';
        saveJSON(DATA.users, users);
        return safeSend(from, `🚫 User *${u.name}* has been banned.\nReason: ${u.banReason}`);
      } else {
        delete u.banReason;
        saveJSON(DATA.users, users);
        return safeSend(from, `✅ User *${u.name}* has been unbanned and may use the bot again.`);
      }
    }

    // BROADCAST FLOW
    if (sess.awaiting === 'broadcast') {
      delete adminSessions[from];
      const allJids = Object.keys(users);
      for (let jid of allJids) {
        await safeSend(jid, `📢 *Broadcast from Admin:*\n\n${txt}`);
      }
      return safeSend(from, `🎉 Your message has been broadcast to ${allJids.length} user(s)!`);
    }

    // ─── MANAGE PRODUCTS ──────────────────────────────────────────────
    if (sess.awaiting === 'manageProducts') {
      if (lc === '1') { // Add Product
        sess.awaiting = 'addProduct_name';
        return safeSend(from, '🆕 *Add Product*\nPlease send the product name:');
      }
      if (lc === '2') { // Edit Product
        if (products.length === 0) {
          delete adminSessions[from];
          return safeSend(from, '❌ No products to edit. Returning to Admin Menu.', botConfig.adminMenu);
        }
        // list products
        let msgList = '✏️ *Edit Product*\nWhich one? Reply with the number:\n';
        products.forEach((p,i)=> msgList += `\n${i+1}. ${p.name} (Ksh ${p.price})`);
        sess.awaiting = 'editProduct_select';
        return safeSend(from, msgList);
      }
      if (lc === '3') { // Delete Product
        if (products.length === 0) {
          delete adminSessions[from];
          return safeSend(from, '❌ No products to delete. Returning to Admin Menu.');
        }
        let msgList = '🗑️ *Delete Product*\nWhich one? Reply with number:\n';
        products.forEach((p,i)=> msgList += `\n${i+1}. ${p.name} (Ksh ${p.price})`);
        sess.awaiting = 'deleteProduct_select';
        return safeSend(from, msgList);
      }
    }
    // Add Product Steps
    if (sess.awaiting === 'addProduct_name') {
      sess.newProduct = { name: txt };
      sess.awaiting    = 'addProduct_price';
      return safeSend(from, `Got it! Now send the price for *${txt}* (e.g. 2500):`);
    }
    if (sess.awaiting === 'addProduct_price') {
      const price = parseFloat(txt);
      if (isNaN(price)) {
        delete adminSessions[from];
        return safeSend(from, '⚠️ Invalid price. Operation canceled.');
      }
      sess.newProduct.price = price;
      sess.awaiting = 'addProduct_image';
      return safeSend(from, `Perfect. Finally, send the image URL for *${sess.newProduct.name}*:`);  
    }
    if (sess.awaiting === 'addProduct_image') {
      sess.newProduct.image = txt;
      products.push(sess.newProduct);
      saveJSON(DATA.products, products);
      delete adminSessions[from];
      return safeSend(from, `✅ Product *${sess.newProduct.name}* added successfully!`);
    }
    // Edit Product Steps
    if (sess.awaiting === 'editProduct_select') {
      const idx = parseInt(txt)-1;
      if (isNaN(idx) || !products[idx]) {
        delete adminSessions[from];
        return safeSend(from, '⚠️ Invalid selection. Returning to Admin Menu.');
      }
      sess.editIndex = idx;
      sess.awaiting  = 'editProduct_field';
      return safeSend(from,
        `Editing *${products[idx].name}*.\n` +
        `Reply with:\n1️⃣ New Name\n2️⃣ New Price\n3️⃣ New Image URL`
      );
    }
    if (sess.awaiting === 'editProduct_field') {
      const field = txt;
      if (!['1','2','3'].includes(field)) {
        delete adminSessions[from];
        return safeSend(from, '⚠️ Invalid choice. Operation canceled.');
      }
      sess.editField = field;
      sess.awaiting  = 'editProduct_value';
      let prompt = field==='1' ? 'Send the new name:' 
                 : field==='2' ? 'Send the new price:' 
                 : 'Send the new image URL:';
      return safeSend(from, prompt);
    }
    if (sess.awaiting === 'editProduct_value') {
      const prod = products[sess.editIndex];
      if (sess.editField==='1') prod.name  = txt;
      if (sess.editField==='2') {
        const p = parseFloat(txt);
        if (isNaN(p)) {
          delete adminSessions[from];
          return safeSend(from, '⚠️ That isn’t a valid price. Cancelled.');
        }
        prod.price = p;
      }
      if (sess.editField==='3') prod.image = txt;
      saveJSON(DATA.products, products);
      delete adminSessions[from];
      return safeSend(from, `✅ Product updated: *${prod.name}* (Ksh ${prod.price})`);
    }
    // Delete Product Step
    if (sess.awaiting === 'deleteProduct_select') {
      const idx = parseInt(txt)-1;
      if (isNaN(idx) || !products[idx]) {
        delete adminSessions[from];
        return safeSend(from, '⚠️ Invalid choice. Cancelled.');
      }
      const removed = products.splice(idx,1)[0];
      saveJSON(DATA.products, products);
      delete adminSessions[from];
      return safeSend(from, `🗑️ Product *${removed.name}* has been deleted.`);
    }

    // ─── MANAGE CATEGORIES ─────────────────────────────────────────────
    if (sess.awaiting === 'manageCategories') {
      if (lc==='1') {
        sess.awaiting = 'addCategory';
        return safeSend(from, '🆕 *Add Category*\nSend the category name:');
      }
      if (lc==='2') {
        if (categories.length===0) {
          delete adminSessions[from];
          return safeSend(from, '❌ No categories to delete.');
        }
        let list = '🗑️ *Delete Category*\nWhich one? Reply with number:\n';
        categories.forEach((c,i)=> list+= `\n${i+1}. ${c}`);
        sess.awaiting = 'deleteCategory';
        return safeSend(from, list);
      }
    }
    if (sess.awaiting==='addCategory') {
      categories.push(txt);
      saveJSON(DATA.categories, categories);
      delete adminSessions[from];
      return safeSend(from, `✅ Category *${txt}* added.`);
    }
    if (sess.awaiting==='deleteCategory') {
      const idx = parseInt(txt)-1;
      if (isNaN(idx)||!categories[idx]) {
        delete adminSessions[from];
        return safeSend(from, '⚠️ Invalid choice. Cancelled.');
      }
      const removed = categories.splice(idx,1)[0];
      saveJSON(DATA.categories, categories);
      delete adminSessions[from];
      return safeSend(from, `🗑️ Category *${removed}* deleted.`);
    }

    // ─── MANAGE FAQs ───────────────────────────────────────────────────
    if (sess.awaiting==='manageFAQs') {
      if (lc==='1'){ sess.awaiting='addFAQ_q'; return safeSend(from,'❓ Add FAQ – send the question:'); }
      if (lc==='2'){
        if (faqs.length===0){ delete adminSessions[from]; return safeSend(from,'❌ No FAQs to edit.'); }
        let list='✏️ Edit FAQ – which one? Reply number:\n';
        faqs.forEach((f,i)=> list+=`\n${i+1}. Q: ${f.q}`);
        sess.awaiting='editFAQ_select';
        return safeSend(from,list);
      }
      if (lc==='3'){
        if (faqs.length===0){ delete adminSessions[from]; return safeSend(from,'❌ No FAQs to delete.'); }
        let list='🗑️ Delete FAQ – which one? Reply number:\n';
        faqs.forEach((f,i)=> list+=`\n${i+1}. Q: ${f.q}`);
        sess.awaiting='deleteFAQ_select';
        return safeSend(from,list);
      }
    }
    if (sess.awaiting==='addFAQ_q') {
      sess.newFAQ = { q: txt };
      sess.awaiting = 'addFAQ_a';
      return safeSend(from,'Got it. Now send the answer:');
    }
    if (sess.awaiting==='addFAQ_a') {
      sess.newFAQ.a = txt;
      faqs.push(sess.newFAQ);
      saveJSON(DATA.faqs, faqs);
      delete adminSessions[from];
      return safeSend(from,'✅ FAQ added successfully!');
    }
    if (sess.awaiting==='editFAQ_select') {
      const idx = parseInt(txt)-1;
      if (isNaN(idx)||!faqs[idx]) {
        delete adminSessions[from];
        return safeSend(from,'⚠️ Invalid selection. Cancelled.');
      }
      sess.editFAQidx = idx;
      sess.awaiting = 'editFAQ_q';
      return safeSend(from,'Send the new question:');
    }
    if (sess.awaiting==='editFAQ_q') {
      faqs[sess.editFAQidx].q = txt;
      sess.awaiting = 'editFAQ_a';
      return safeSend(from,'Now send the new answer:');
    }
    if (sess.awaiting==='editFAQ_a') {
      faqs[sess.editFAQidx].a = txt;
      saveJSON(DATA.faqs, faqs);
      delete adminSessions[from];
      return safeSend(from,'✅ FAQ updated!');
    }
    if (sess.awaiting==='deleteFAQ_select') {
      const idx = parseInt(txt)-1;
      if (isNaN(idx)||!faqs[idx]) {
        delete adminSessions[from];
        return safeSend(from,'⚠️ Invalid choice. Cancelled.');
      }
      const removed = faqs.splice(idx,1)[0];
      saveJSON(DATA.faqs, faqs);
      delete adminSessions[from];
      return safeSend(from,`🗑️ Removed FAQ: "${removed.q}"`);
    }

    // ─── CHANGE CONFIG ─────────────────────────────────────────────────
    if (sess.awaiting==='manageConfig') {
      if (lc==='1') {
        sess.awaiting = 'config_botName';
        return safeSend(from,'✏️ Send the new Bot Name:');
      }
      if (lc==='2') {
        sess.awaiting = 'config_channelID';
        return safeSend(from,'✏️ Send the new Channel ID (number):');
      }
    }
    if (sess.awaiting==='config_botName') {
      botConfig.botName = txt;
      delete adminSessions[from];
      return safeSend(from,`✅ Bot Name changed to *${botConfig.botName}*`);
    }
    if (sess.awaiting==='config_channelID') {
      const c = parseInt(txt);
      if (isNaN(c)) {
        delete adminSessions[from];
        return safeSend(from,'⚠️ That isn’t a valid number. Cancelled.');
      }
      botConfig.channelID = c;
      delete adminSessions[from];
      return safeSend(from,`✅ Channel ID updated to *${c}*`);
    }

    return; // end admin handler
  }

  // ───────── USER REGISTRATION & REFERRAL ─────────────────────────────
  if (!users[from]) {
    const conv = conversations[from] || { stage: 'awaitRegister' };

    // First greet & prompt for username
    if (conv.stage === 'awaitRegister') {
      conversations[from] = { stage: 'gotGreeting' };
      return msg.reply(botConfig.welcomeText);
    }

    // Got greeting, now expecting username or referral:text
    if (conv.stage === 'gotGreeting') {
      let referrer = null;
      if (lc.startsWith('referral:')) {
        const uname = txt.split(':')[1].trim();
        referrer = Object.values(users).find(u=>u.name.toLowerCase()===uname.toLowerCase());
        if (!referrer) {
          delete conversations[from];
          return msg.reply('⚠️ That referral code is invalid. Let’s start over. Send any message.');
        }
      }
      // Check duplicate username
      if (Object.values(users).some(u=>u.name.toLowerCase()===lc)) {
        return msg.reply('⚠️ That username is already taken—please choose another.');
      }
      // Create user record
      users[from] = {
        name:       txt,
        phone:      from.replace('@c.us',''),
        referredBy: referrer ? referrer.phone : null,
        registeredAt:new Date().toISOString(),
        banned:     false,
        orders:     [],
        hasOrdered: false
      };
      saveJSON(DATA.users, users);

      // Notify admin
      let adminMsg = `🆕 *New User Registration!*\n• Username: ${txt}\n• Phone: ${users[from].phone}`;
      if (referrer) {
        adminMsg += `\n• Referred by: ${referrer.name} (${referrer.phone.slice(0,6)}****)`;
        safeSend(`${referrer.phone}@c.us`,
          `🎉 Great news, *${referrer.name}*! You referred *${txt}*. You’ll earn a bonus when they place their first order.`
        );
      }
      safeSend(botConfig.adminJid, adminMsg);

      delete conversations[from];
      return msg.reply(
        `🎉 Success *${txt}*! You’re now registered with *${botConfig.botName}*.\n\n`+
        botConfig.userMenu(users[from])
      );
    }
  }

  // ───────── BANNED CHECK ─────────────────────────────────────────────
  const user = users[from];
  if (user && user.banned) {
    return msg.reply(`🚫 Sorry *${user.name}*, you’re currently banned.\nReason: ${user.banReason}`);
  }

  // ───────── USER MENU & WORKFLOWS ───────────────────────────────────
  if (user) {
    // Show menu
    if (['5','menu'].includes(lc)) {
      return msg.reply(botConfig.userMenu(user));
    }
    // Browse products
    if (lc === '1') {
      if (products.length === 0) {
        return msg.reply(`❌ Hey *${user.name}*, we have no products right now. Check back soon!`);
      }
      let list = `🛍️ *${botConfig.botName} Products:*\n\n`;
      products.forEach((p,i)=>{
        list += `*${i+1}.* ${p.name} — Ksh ${p.price}\n`;
      });
      conversations[from] = { stage:'ordering', step:'chooseProduct' };
      return msg.reply(
        `Awesome, *${user.name}*! Here are our current offerings:\n\n${list}\nReply with the number of the product to order.`
      );
    }
    // View my orders
    if (lc === '2') {
      if (user.orders.length === 0) {
        return msg.reply(`📭 *${user.name}*, you haven’t placed any orders yet. Reply *1* to shop now!`);
      }
      let out = `📦 *Your Orders, ${user.name}:*\n\n`;
      user.orders.forEach(no=>{
        const o = orders[no];
        out += `• *${no}*: ${o.product} x${o.qty} — ${o.status}\n`;
      });
      return msg.reply(out);
    }
    // Get referral link
    if (lc === '3') {
      const link = `https://wa.me/${client.info.wid.user}?text=referral:${user.name}`;
      return msg.reply(
        `🔗 *${user.name}*, share this link to refer friends and earn rewards:\n\n${link}`
      );
    }
    // FAQs
    if (lc === '4') {
      if (faqs.length === 0) {
        return msg.reply(`❓ Sorry *${user.name}*, no FAQs are set up yet.`);
      }
      let out = `❓ *Frequently Asked Questions:*\n\n`;
      faqs.forEach((f,i)=>{
        out += `*${i+1}.* Q: ${f.q}\n   A: ${f.a}\n\n`;
      });
      return msg.reply(out);
    }

    // ─── ORDER FLOW ───────────────────────────────────────────────────
    const conv = conversations[from];
    if (conv && conv.stage === 'ordering') {
      // Choose product
      if (conv.step === 'chooseProduct') {
        const idx = parseInt(txt)-1;
        if (isNaN(idx) || !products[idx]) {
          delete conversations[from];
          return msg.reply(`⚠️ Invalid choice, *${user.name}*. Reply *1* to browse again.`);
        }
        conv.product = products[idx];
        conv.step    = 'enterQty';
        return msg.reply(
          `Great pick, *${user.name}*! How many *${conv.product.name}* would you like?`
        );
      }
      // Enter quantity
      if (conv.step === 'enterQty') {
        const qty = parseInt(txt);
        if (isNaN(qty) || qty < 1) {
          delete conversations[from];
          return msg.reply(`⚠️ That doesn’t look valid, *${user.name}*. Reply *1* to restart.`);
        }
        conv.qty  = qty;
        conv.step = 'enterPhone';
        return msg.reply(
          `Almost done, *${user.name}*! Please send the phone number you’ll use for payment:`
        );
      }
      // Enter phone & initiate payment
      if (conv.step === 'enterPhone') {
        const ph = formatPhone(txt);
        if (!ph) {
          delete conversations[from];
          return msg.reply(`⚠️ Invalid phone, *${user.name}*. Order canceled. Reply *1* to try again.`);
        }
        conv.payPhone = ph.replace('@c.us','');

        // Create order record
        const orderNo = genOrderNumber();
        const amount  = conv.product.price * conv.qty;
        orders[orderNo] = {
          orderNo,
          user:    user.phone,
          product: conv.product.name,
          qty:     conv.qty,
          amount,
          status:  'PENDING',
          createdAt: new Date().toISOString()
        };
        saveJSON(DATA.orders, orders);
        user.orders.push(orderNo);
        saveJSON(DATA.users, users);

        // Prompt STK Push
        await msg.reply(`⏳ Processing payment of *Ksh ${amount}* now, *${user.name}*. Please wait...`);
        const ref = await sendSTKPush(amount, conv.payPhone);

        // Poll for 30s
        setTimeout(async ()=>{
          const st = await fetchTransactionStatus(ref);
          if (st && st.status === 'SUCCESS') {
            orders[orderNo].status = 'PAID';
            saveJSON(DATA.orders, orders);

            // Notify user
            await safeSend(from,
              `✅ *Payment Successful!* 🎉\n\n`+
              `• Order No: *${orderNo}*\n`+
              `• Item: *${conv.product.name}* x${conv.qty}\n`+
              `• Amount: *Ksh ${amount}*\n\n`+
              `Thank you for trusting *${botConfig.botName}*, *${user.name}*!`
            );

            // Referral bonus
            if (!user.hasOrdered && user.referredBy) {
              const refuJid = `${user.referredBy}@c.us`;
              await safeSend(refuJid, botConfig.referralBonus);
            }
            user.hasOrdered = true;
            saveJSON(DATA.users, users);

            // Notify admin
            await safeSend(botConfig.adminJid,
              `🛒 *New Order!*\n`+
              `• *${orderNo}*\n`+
              `• Customer: ${user.name} (${user.phone})\n`+
              `• ${conv.product.name} x${conv.qty}\n`+
              `• Amount: Ksh ${amount}`
            );
          } else {
            await safeSend(from,
              `❌ *Payment Failed or Timed Out*, *${user.name}*.\n`+
              `Feel free to try again by replying *1*.`
            );
          }
        }, 30000);

        delete conversations[from];
        return;
      }
    }

    // Unknown user input
    return msg.reply(`🤔 Sorry *${user.name}*, I didn’t catch that. Reply *5* to see the menu again.`);
  }

  // fallback: unrecognized, send greeting
  return msg.reply(botConfig.welcomeText);
});

// ────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN: SAVE DATA
// ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  saveJSON(DATA.users, users);
  saveJSON(DATA.products, products);
  saveJSON(DATA.categories, categories);
  saveJSON(DATA.faqs, faqs);
  saveJSON(DATA.orders, orders);
  console.log('\n💾 All data saved. Goodbye!');
  process.exit();
});
