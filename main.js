/*******************************************************************
 * main.js
 * FY'S PROPERTY WHATSAPP BOT – FULLY FEATURED
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express        = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode         = require('qrcode');
const axios          = require('axios');
const fs             = require('fs');

// ────────────────────────────────────────────────────────────────────
// FILES & AUTO-INIT
// ────────────────────────────────────────────────────────────────────
const FILES = {
  users:       'users.json',
  categories:  'categories.json',
  products:    'products.json',
  faqs:        'faqs.json',
  orders:      'orders.json',
  withdrawals: 'withdrawals.json'
};
function loadOrInit(file, def) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
    return def;
  }
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
    return def;
  }
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users       = loadOrInit(FILES.users,       {});
let categories  = loadOrInit(FILES.categories,  ["Testing"]);
let products    = loadOrInit(FILES.products,    []);
let faqs        = loadOrInit(FILES.faqs,        []);
let orders      = loadOrInit(FILES.orders,      {});
let withdrawals = loadOrInit(FILES.withdrawals, {});

// Preload demo product
if (!products.find(p => p.name === "Demo Product")) {
  products.push({
    name:     "Demo Product",
    price:    1234,
    image:    "https://fy-img-2-url.rf.gd/FYS-349788.jpg",
    category: "Testing"
  });
  save(FILES.products, products);
}

// ────────────────────────────────────────────────────────────────────
// CONFIG & SESSION STORE
// ────────────────────────────────────────────────────────────────────
const CONFIG = {
  adminJid:     '254701339573@c.us',
  botName:      "FY'S PROPERTY",
  channelID:    724,
  stkKey:       'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==',
  minWithdraw:  100,
  maxWithdraw:  75000
};
const SESSIONS = { users: {}, admins: {} };

// ────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────
function fmtPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if (n.length===9 && n.startsWith('7'))    n = '254'+n;
  if (n.length===10 && n.startsWith('0'))    n = '254'+n.slice(1);
  if (n.length===12 && n.startsWith('254'))  return n+'@c.us';
  return null;
}
function genID(pref) {
  return `${pref}-${[...Array(6)].map(_=>Math.random().toString(36)[2]).join('').toUpperCase()}`;
}
async function safeSend(jid, msg) {
  try {
    await client.sendMessage(jid, msg);
  } catch (e) {
    console.error('Send Error', e.message);
    if (jid !== CONFIG.adminJid) {
      await client.sendMessage(CONFIG.adminJid, `⚠️ Could not send to ${jid}`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// M-PESA STK PUSH & STATUS POLLING
// ────────────────────────────────────────────────────────────────────
async function sendSTK(amount, phone) {
  const payload = {
    amount,
    phone_number:       phone,
    channel_id:         CONFIG.channelID,
    provider:           "m-pesa",
    external_reference: genID("INV"),
    account_reference:  CONFIG.botName,
    transaction_desc:   CONFIG.botName
  };
  try {
    const r = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      { headers: { Authorization: CONFIG.stkKey } }
    );
    return r.data.reference;
  } catch (e) {
    console.error('STK Error', e.message);
    return null;
  }
}
async function checkSTK(ref) {
  try {
    const r = await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      { headers: { Authorization: CONFIG.stkKey } }
    );
    return r.data;
  } catch (e) {
    console.error('Status Error', e.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// WHATSAPP CLIENT INIT & QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = null;
client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});
client.on('ready', () => {
  console.log('🤖 Bot Ready');
  safeSend(CONFIG.adminJid, `🚀 *${CONFIG.botName}* is now online!`);
});
client.initialize();

const app = express();
app.get('/', async (_, res) => {
  const img = currentQR ? await QRCode.toDataURL(currentQR) : '';
  res.send(`
    <h1>Scan to join ${CONFIG.botName}</h1>
    ${img ? `<img src="${img}"/>` : '<p>Waiting for QR…</p>'}
  `);
});
app.listen(3000, () => console.log('🔗 QR at http://localhost:3000'));

// ────────────────────────────────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
  const jid = msg.from;
  const txt = msg.body.trim();
  const lc  = txt.toLowerCase();

  // Ignore group messages
  if (jid.endsWith('@g.us')) return;

  // --------- ADMIN SECTION ---------
  if (jid === CONFIG.adminJid) {
    let s = SESSIONS.admins[jid];

    // If no session or "00", show main admin menu
    if (!s || lc === '00') {
      SESSIONS.admins[jid] = { ctx: 'main', data: {} };
      return safeSend(jid,
        "👑 *Admin Panel* 👑\n\n" +
        "1️⃣ View Users & Referrals\n" +
        "2️⃣ Ban/Unban User\n" +
        "3️⃣ Manage Categories\n" +
        "4️⃣ Manage Products\n" +
        "5️⃣ Manage FAQs\n" +
        "6️⃣ Manage Config\n" +
        "7️⃣ Broadcast Message\n" +
        "8️⃣ Manage Withdrawals\n" +
        "9️⃣ Manage Referral Earnings\n" +
        "🔟 Edit Order Status\n\n" +
        "*00* to return here."
      );
    }
    s = SESSIONS.admins[jid];

    // Handle each admin context...

    // 1) View Users & Referrals
    if (s.ctx === 'main' && lc === '1') {
  // Build a rich report of every user
  let report = "👥 *Registered Users Overview*\n\n";

  Object.entries(users).forEach(([jid, u], idx) => {
    report += `*${idx + 1}.* ${u.name} (${u.phone})\n`;                              // Name & phone
    report += `   └ Registered: ${new Date(u.registeredAt).toLocaleString()}\n`;    // Registration time
    report += `   ├ Status: ${u.banned ? "🚫 Banned" : "✅ Active"}\n`;                // Active / Banned
    if (u.banned && u.banReason) {
      report += `   │ Reason: ${u.banReason}\n`;                                      // Ban reason
    }
    report += `   ├ Balance: Ksh ${u.earnings?.toFixed(2) || "0.00"}\n`;               // Referral earnings balance
    report += `   ├ Orders Placed: ${u.orders.length}\n`;                             // Number of orders
    report += `   ├ Referral Count: ${
      Object.values(users).filter(x => x.referredBy === u.phone).length
    }\n`;                                                                             // Referrals made
    report += `   └ Last Seen: ${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : "—"}\n\n`;  
  });

  // Send the formatted report
  return safeSend(jid, report.trim());
}
    // 2) Ban/Unban User
    if (s.ctx === 'main' && lc === '2') {
      s.ctx = 'ban';
      return safeSend(jid, "🚫 *Ban/Unban* – Please send the user's phone number:");
    }
    if (s.ctx === 'ban') {
      const ph = fmtPhone(txt);
      SESSIONS.admins[jid].ctx = 'main';
      if (!ph || !users[ph]) return safeSend(jid, "⚠️ User not found.");
      users[ph].banned = !users[ph].banned;
      save(FILES.users, users);
      return safeSend(jid,
        `${users[ph].banned ? '🚫' : '✅'} *${users[ph].name}* is now ` +
        `${users[ph].banned ? 'BANNED' : 'UNBANNED'}.`
      );
    }

    // 3) Manage Categories
    if (s.ctx === 'main' && lc === '3') {
      s.ctx = 'cat';
      return safeSend(jid, "📂 *Manage Categories*\n1️⃣ List\n2️⃣ Add\n3️⃣ Delete");
    }
    if (s.ctx === 'cat' && lc === '1') {
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, `📂 *Categories:*\n\n${categories.join('\n')}`);
    }
    if (s.ctx === 'cat' && lc === '2') {
      s.ctx = 'catAdd';
      return safeSend(jid, "🆕 Send the new category name:");
    }
    if (s.ctx === 'catAdd') {
      categories.push(txt);
      save(FILES.categories, categories);
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, `✅ Category *${txt}* added.`);
    }
    if (s.ctx === 'cat' && lc === '3') {
      let list = "🗑️ *Delete Category* – Reply with the number:\n";
      categories.forEach((c, i) => list += `\n${i+1}. ${c}`);
      s.ctx = 'catDel';
      return safeSend(jid, list);
    }
    if (s.ctx === 'catDel') {
      const idx = parseInt(txt) - 1;
      SESSIONS.admins[jid].ctx = 'main';
      if (isNaN(idx) || !categories[idx]) return safeSend(jid, "⚠️ Invalid selection.");
      const removed = categories.splice(idx, 1)[0];
      save(FILES.categories, categories);
      return safeSend(jid, `🗑️ Category *${removed}* deleted.`);
    }

    // 4) Manage Products
    if (s.ctx === 'main' && lc === '4') {
      s.ctx = 'prod';
      return safeSend(jid, "🛒 *Manage Products*\n1️⃣ List by Category\n2️⃣ Add\n3️⃣ Delete");
    }
    if (s.ctx === 'prod' && lc === '1') {
      let out = "🛍️ *Products by Category:*\n\n";
      categories.forEach(cat => {
        out += `*${cat}*:\n`;
        products.filter(p => p.category === cat).forEach(p =>
          out += `  – ${p.name} (Ksh ${p.price})\n`
        );
        out += "\n";
      });
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, out);
    }
    if (s.ctx === 'prod' && lc === '2') {
      s.ctx = 'prodAddName';
      return safeSend(jid, "🆕 *Add Product* – Send product name:");
    }
    if (s.ctx === 'prodAddName') {
      s.data = { name: txt };
      s.ctx = 'prodAddPrice';
      return safeSend(jid, `💲 Send price for *${txt}* (number only):`);
    }
    if (s.ctx === 'prodAddPrice') {
      const price = parseFloat(txt);
      if (isNaN(price)) {
        SESSIONS.admins[jid].ctx = 'main';
        return safeSend(jid, "⚠️ Invalid price. Cancelling.");
      }
      s.data.price = price;
      s.ctx = 'prodAddCat';
      return safeSend(jid, "📂 Send category name for this product:");
    }
    if (s.ctx === 'prodAddCat') {
      if (!categories.includes(txt)) {
        SESSIONS.admins[jid].ctx = 'main';
        return safeSend(jid, "⚠️ Category not found. Cancelling.");
      }
      s.data.category = txt;
      s.ctx = 'prodAddImage';
      return safeSend(jid, "🖼️ Send product image URL:");
    }
    if (s.ctx === 'prodAddImage') {
      s.data.image = txt;
      products.push(s.data);
      save(FILES.products, products);
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, `✅ Product *${s.data.name}* added under *${s.data.category}*.`);
    }
    if (s.ctx === 'prod' && lc === '3') {
      let list = "🗑️ *Delete Product* – Reply with the number:\n";
      products.forEach((p, i) => list += `\n${i+1}. ${p.name}`);
      s.ctx = 'prodDel';
      return safeSend(jid, list);
    }
    if (s.ctx === 'prodDel') {
      const idx = parseInt(txt) - 1;
      SESSIONS.admins[jid].ctx = 'main';
      if (isNaN(idx) || !products[idx]) return safeSend(jid, "⚠️ Invalid selection.");
      const removed = products.splice(idx, 1)[0];
      save(FILES.products, products);
      return safeSend(jid, `🗑️ Product *${removed.name}* deleted.`);
    }

    // 5) Manage FAQs
    if (s.ctx === 'main' && lc === '5') {
      s.ctx = 'faq';
      return safeSend(jid, "❓ *Manage FAQs*\n1️⃣ List\n2️⃣ Add\n3️⃣ Delete");
    }
    if (s.ctx === 'faq' && lc === '1') {
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid,
        faqs.length
          ? `❓ *FAQs:*\n\n${faqs.map((f,i)=>`${i+1}. Q: ${f.q}\n   A: ${f.a}`).join('\n\n')}`
          : '❓ No FAQs available.'
      );
    }
    if (s.ctx === 'faq' && lc === '2') {
      s.ctx = 'faqAddQ';
      return safeSend(jid, "❓ Send the FAQ question:");
    }
    if (s.ctx === 'faqAddQ') {
      s.data = { q: txt };
      s.ctx = 'faqAddA';
      return safeSend(jid, "✍️ Now send the FAQ answer:");
    }
    if (s.ctx === 'faqAddA') {
      s.data.a = txt;
      faqs.push(s.data);
      save(FILES.faqs, faqs);
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, "✅ FAQ added.");
    }
    if (s.ctx === 'faq' && lc === '3') {
      let list = "🗑️ *Delete FAQ* – Reply with the number:\n";
      faqs.forEach((f, i) => list += `\n${i+1}. Q: ${f.q}`);
      s.ctx = 'faqDel';
      return safeSend(jid, list);
    }
    if (s.ctx === 'faqDel') {
      const idx = parseInt(txt) - 1;
      SESSIONS.admins[jid].ctx = 'main';
      if (isNaN(idx) || !faqs[idx]) return safeSend(jid, "⚠️ Invalid selection.");
      faqs.splice(idx, 1);
      save(FILES.faqs, faqs);
      return safeSend(jid, "🗑️ FAQ deleted.");
    }

    // 6) Manage Config
    if (s.ctx === 'main' && lc === '6') {
      s.ctx = 'cfg';
      return safeSend(jid, "⚙️ *Manage Config*\n1️⃣ Bot Name\n2️⃣ Channel ID\n3️⃣ Withdrawal Limits");
    }
    if (s.ctx === 'cfg' && lc === '1') {
      s.ctx = 'cfgName';
      return safeSend(jid, "✏️ Send the new Bot Name:");
    }
    if (s.ctx === 'cfgName') {
      CONFIG.botName = txt;
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, `✅ Bot name changed to *${txt}*.`);
    }
    if (s.ctx === 'cfg' && lc === '2') {
      s.ctx = 'cfgChan';
      return safeSend(jid, "✏️ Send the new Channel ID (number):");
    }
    if (s.ctx === 'cfgChan') {
      const c = parseInt(txt); 
      if (!isNaN(c)) CONFIG.channelID = c;
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, `✅ Channel ID set to *${CONFIG.channelID}*.`);
    }
    if (s.ctx === 'cfg' && lc === '3') {
      s.ctx = 'cfgWDLimits';
      return safeSend(jid,
        `💰 *Set Withdrawal Limits*\n` +
        `Current Min: ${CONFIG.minWithdraw}, Max: ${CONFIG.maxWithdraw}\n\n` +
        `Send in format: MIN,MAX`
      );
    }
    if (s.ctx === 'cfgWDLimits') {
      const [min,max] = txt.split(',').map(x=>parseInt(x));
      if (!isNaN(min)&&!isNaN(max)&&min<=max) {
        CONFIG.minWithdraw = min;
        CONFIG.maxWithdraw = max;
        SESSIONS.admins[jid].ctx = 'main';
        return safeSend(jid, `✅ Withdrawal limits set to Min:${min}, Max:${max}.`);
      } else {
        SESSIONS.admins[jid].ctx = 'main';
        return safeSend(jid, `⚠️ Invalid input. Use MIN,MAX.`);
      }
    }

    // 7) Broadcast
    if (s.ctx === 'main' && lc === '7') {
      s.ctx = 'bcast';
      return safeSend(jid, "📣 Send the broadcast message:");
    }
    if (s.ctx === 'bcast') {
      delete SESSIONS.admins[jid];
      Object.keys(users).forEach(u => safeSend(u, `📢 *Broadcast:*\n\n${txt}`));
      return safeSend(jid, "🎉 Broadcast sent to all users.");
    }

    // 8) Manage Withdrawals
    if (s.ctx === 'main' && lc === '8') {
      s.ctx = 'wd';
      return safeSend(jid, "💰 *Manage Withdrawals*\n1️⃣ List\n2️⃣ Approve\n3️⃣ Decline");
    }
    if (s.ctx === 'wd' && lc === '1') {
      s.ctx = 'main';
      let out = "💰 Withdrawal Requests:\n\n";
      Object.values(withdrawals).forEach(w => {
        out += `• ${w.id}: ${w.amount} – ${w.status}\n`;
      });
      return safeSend(jid, out);
    }
    if (s.ctx === 'wd' && lc === '2') {
      s.ctx = 'wdAppId';
      return safeSend(jid, "✅ Approve – send Withdrawal ID:");
    }
    if (s.ctx === 'wd' && lc === '3') {
      s.ctx = 'wdDecId';
      return safeSend(jid, "❌ Decline – send Withdrawal ID:");
    }
    if (s.ctx === 'wdAppId') {
      if (!withdrawals[txt]) {
        s.ctx = 'main';
        return safeSend(jid, `⚠️ No withdrawal with ID ${txt}.`);
      }
      s.data = { id: txt, action: 'approve' };
      s.ctx = 'wdAppRem';
      return safeSend(jid, "✏️ Send approval remarks:");
    }
    if (s.ctx === 'wdAppRem') {
      const w = withdrawals[s.data.id];
      w.status = 'APPROVED';
      w.remarks = txt;
      save(FILES.withdrawals, withdrawals);
      safeSend(w.jid,
        `✅ Your withdrawal *${w.id}* has been APPROVED.\nRemarks: ${txt}`
      );
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, `✅ Withdrawal ${w.id} approved.`);
    }
    if (s.ctx === 'wdDecId') {
      if (!withdrawals[txt]) {
        s.ctx = 'main';
        return safeSend(jid, `⚠️ No withdrawal with ID ${txt}.`);
      }
      s.data = { id: txt, action: 'decline' };
      s.ctx = 'wdDecRem';
      return safeSend(jid, "✏️ Send decline reason:");
    }
    if (s.ctx === 'wdDecRem') {
      const w = withdrawals[s.data.id];
      w.status = 'DECLINED';
      w.remarks = txt;
      save(FILES.withdrawals, withdrawals);
      safeSend(w.jid,
        `❌ Your withdrawal *${w.id}* has been DECLINED.\nReason: ${txt}`
      );
      SESSIONS.admins[jid].ctx = 'main';
      return safeSend(jid, `❌ Withdrawal ${w.id} declined.`);
    }

    // 9) Manage Referral Earnings
    if (s.ctx === 'main' && lc === '9') {
      s.ctx = 'refEarn';
      return safeSend(jid, "💎 Referral Earnings – send in format: phone,amount (use negative to deduct)");
    }
    if (s.ctx === 'refEarn') {
      const [phTxt, amtTxt] = txt.split(',');
      const ph = fmtPhone(phTxt);
      const amt = parseInt(amtTxt);
      s.ctx = 'main';
      if (!ph || !users[ph] || isNaN(amt)) {
        return safeSend(jid, "⚠️ Invalid input. Use: phone,amount");
      }
      users[ph].earnings = (users[ph].earnings||0) + amt;
      save(FILES.users, users);
      safeSend(ph, `🎁 Your referral earnings have been ${amt>=0?'increased':'decreased'} by Ksh ${Math.abs(amt)}. New balance: Ksh ${users[ph].earnings}`);
      return safeSend(jid, `✅ Updated earnings for ${users[ph].name}.`);
    }

    // 10) Edit Order Status
    if (s.ctx === 'main' && lc === '10') {
      s.ctx = 'ordStat';
      return safeSend(jid, "📦 Edit Order – send the Order ID:");
    }
    if (s.ctx === 'ordStat') {
      const o = orders[txt];
      if (!o) {
        SESSIONS.admins[jid].ctx = 'main';
        return safeSend(jid, `⚠️ No order with ID ${txt}.`);
      }
      s.data = { orderNo: txt };
      s.ctx = 'ordStatNew';
      return safeSend(jid, `Current status: ${o.status}\nSend the new status:`);
    }
    if (s.ctx === 'ordStatNew') {
      orders[s.data.orderNo].status = txt;
      save(FILES.orders, orders);
      SESSIONS.admins[jid].ctx = 'main';
      const o = orders[s.data.orderNo];
      safeSend(o.user + '@c.us', `🔄 Your order *${o.orderNo}* status has been updated to *${txt}*.`);
      return safeSend(jid, `✅ Order ${o.orderNo} status set to ${txt}.`);
    }

    return;
  }

  // --------- USER SECTION ---------
  let uSess = SESSIONS.users[jid];

  // Registration
  if (!users[jid]) {
    if (!uSess || uSess.ctx === 'start') {
      SESSIONS.users[jid] = { ctx: 'greet' };
      return msg.reply(
        `👋 Welcome to *${CONFIG.botName}*! To get started, reply with a *username* to register,\n` +
        `or send \`referral:<username>\` if you have a referral code.`
      );
    }
    if (uSess.ctx === 'greet') {
      let ref = null;
      if (lc.startsWith('referral:')) {
        const nm = txt.split(':')[1].trim();
        ref = Object.values(users).find(x => x.name.toLowerCase() === nm.toLowerCase());
        if (!ref) {
          delete SESSIONS.users[jid];
          return msg.reply('⚠️ Invalid referral code. Please try again.');
        }
      }
      if (Object.values(users).some(x => x.name.toLowerCase() === lc)) {
        return msg.reply('⚠️ Username taken. Please choose another:');
      }
      users[jid] = {
        name:       txt,
        phone:      jid.replace('@c.us',''),
        referredBy: ref? ref.phone : null,
        registeredAt: new Date().toISOString(),
        banned:     false,
        orders:     [],
        hasOrdered: false,
        earnings:   0
      };
      save(FILES.users, users);
      // Notify admin
      let aMsg = `🆕 New User: *${txt}* (${users[jid].phone})`;
      if (ref) {
        aMsg += `\n• Referred by: *${ref.name}*`;
        safeSend(`${ref.phone}@c.us`, `🎉 You referred *${txt}*! You’ll earn a bonus when they first order.`);
      }
      safeSend(CONFIG.adminJid, aMsg);
      // Move to main menu
      SESSIONS.users[jid] = { ctx: 'main' };
      return msg.reply(
        `🎉 Hello *${txt}*! You’re now registered with *${CONFIG.botName}*.\n\n` +
        `1️⃣ Browse Categories\n` +
        `2️⃣ My Orders\n` +
        `3️⃣ Referral Center\n` +
        `4️⃣ Withdrawal Center\n` +
        `5️⃣ FAQs\n` +
        `6️⃣ Menu`
      );
    }
  }

  // Post-registration
  if (!uSess) {
    SESSIONS.users[jid] = { ctx: 'main' };
    uSess = SESSIONS.users[jid];
  }
  const user = users[jid];
  if (user.banned) {
    return msg.reply(`🚫 Sorry *${user.name}*, you are banned and cannot use this bot.`);
  }

  // USER MAIN MENU
  if (uSess.ctx === 'main') {
    switch (lc) {
      case '1': { // Browse Categories
        let out = "📂 *Categories:*\n\n";
        categories.forEach((c,i) => out += `${i+1}. ${c}\n`);
        SESSIONS.users[jid].ctx = 'browsingCats';
        return msg.reply(out + "\nReply with the category number.");
      }
      case '2': { // My Orders
        if (!user.orders.length) {
          return msg.reply(`📭 *${user.name}*, you have no orders yet.`);
        }
        let out = "📦 *Your Orders:*\n\n";
        user.orders.forEach(no => {
          const o = orders[no];
          out += `• ${no}: ${o.product} x${o.qty} — ${o.status}\n`;
        });
        return msg.reply(out);
      }
      case '3': { // Referral Center
        const cnt = Object.values(users).filter(x=>x.referredBy===user.phone).length;
        SESSIONS.users[jid].ctx = 'refMenu';
        return msg.reply(
          `🎁 *Referral Center*\n` +
          `You’ve referred *${cnt}* friend(s).\n\n` +
          `1️⃣ Show My Referral Link\n` +
          `2️⃣ Back to Main Menu`
        );
      }
      case '4': { // Withdrawal Center
        SESSIONS.users[jid].ctx = 'wdMenu';
        return msg.reply(
          `💰 *Withdrawal Center*\n` +
          `Your earnings balance: *Ksh ${user.earnings}*\n\n` +
          `1️⃣ Request Withdrawal\n` +
          `2️⃣ Check Withdrawal Status\n` +
          `3️⃣ Back to Main Menu`
        );
      }
      case '5': { // FAQs
        if (!faqs.length) return msg.reply('❓ No FAQs available at the moment.');
        let out = "❓ *FAQs:*\n\n";
        faqs.forEach((f,i) => out += `${i+1}. Q: ${f.q}\n   A: ${f.a}\n\n`);
        return msg.reply(out);
      }
      case '6': { // Menu
        return msg.reply(
          "🗂️ *Main Menu:*\n\n" +
          "1️⃣ Browse Categories\n" +
          "2️⃣ My Orders\n" +
          "3️⃣ Referral Center\n" +
          "4️⃣ Withdrawal Center\n" +
          "5️⃣ FAQs\n" +
          "6️⃣ Menu"
        );
      }
      default:
        return msg.reply(`❓ Sorry *${user.name}*, invalid choice. Please reply 6 for the menu.`);
    }
  }

  // REFERRAL MENU
  if (uSess.ctx === 'refMenu') {
    if (lc === '1') {
      SESSIONS.users[jid].ctx = 'main';
      const link = `https://wa.me/${client.info.wid.user}?text=referral:${user.name}`;
      return msg.reply(`🔗 *Your Referral Link:*\n\n${link}`);
    }
    if (lc === '2') {
      SESSIONS.users[jid].ctx = 'main';
      return msg.reply("🔙 Returning to main menu.");
    }
    return msg.reply("⚠️ Invalid. Please choose 1 or 2.");
  }

  // WITHDRAWAL CENTER MENU
  if (uSess.ctx === 'wdMenu') {
    if (lc === '1') {
      SESSIONS.users[jid].ctx = 'wdRequestAmt';
      return msg.reply(
        `💸 *Request Withdrawal*\n` +
        `You have *Ksh ${user.earnings}* available.\n` +
        `Enter the amount to withdraw (min:${CONFIG.minWithdraw}, max:${CONFIG.maxWithdraw}):`
      );
    }
    if (lc === '2') {
      SESSIONS.users[jid].ctx = 'wdCheckId';
      return msg.reply("🔍 Enter your Withdrawal ID to check status:");
    }
    if (lc === '3') {
      SESSIONS.users[jid].ctx = 'main';
      return msg.reply("🔙 Back to main menu.");
    }
    return msg.reply("⚠️ Invalid. Choose 1–3.");
  }

  // WITHDRAWAL REQUEST – AMOUNT
  if (uSess.ctx === 'wdRequestAmt') {
    const amt = parseInt(txt);
    SESSIONS.users[jid].ctx = 'main';
    if (isNaN(amt) || amt < CONFIG.minWithdraw || amt > CONFIG.maxWithdraw || amt > user.earnings) {
      return msg.reply(
        `⚠️ Invalid amount. Ensure:\n` +
        `• Between Min:${CONFIG.minWithdraw} and Max:${CONFIG.maxWithdraw}\n` +
        `• Not exceeding your earnings (Ksh ${user.earnings})\n\n` +
        `Returning to main menu.`
      );
    }
    user.earnings -= amt;
    save(FILES.users, users);
    SESSIONS.users[jid] = { ctx: 'wdRequestPhone', data: { amt } };
    return msg.reply(`📲 Enter the phone number (07 or 01) to receive *Ksh ${amt}*:`);
  }

  // WITHDRAWAL REQUEST – PHONE
  if (uSess.ctx === 'wdRequestPhone') {
    const ph = fmtPhone(txt);
    if (!ph) {
      SESSIONS.users[jid].ctx = 'main';
      return msg.reply("⚠️ Invalid phone. Withdrawal cancelled.");
    }
    const wid = genID("WD");
    withdrawals[wid] = {
      id: wid,
      user: user.phone,
      jid,
      amount: uSess.data.amt,
      phone: ph.replace('@c.us',''),
      status: 'PENDING',
      remarks: null,
      requestedAt: new Date().toISOString()
    };
    save(FILES.withdrawals, withdrawals);
    safeSend(CONFIG.adminJid,
      `💰 *New Withdrawal Request*\n` +
      `• ID: ${wid}\n` +
      `• User: ${user.name} (${user.phone})\n` +
      `• Amount: Ksh ${uSess.data.amt}\n` +
      `• Phone: ${withdrawals[wid].phone}`
    );
    SESSIONS.users[jid].ctx = 'main';
    return msg.reply(
      `✅ Withdrawal Requested!\n\n` +
      `• Withdrawal ID: *${wid}*\n` +
      `• Amount: Ksh ${uSess.data.amt}\n` +
      `• Destination: ${withdrawals[wid].phone}\n\n` +
      `Your request will be processed shortly. Thank you!`
    );
  }

  // WITHDRAWAL STATUS CHECK
  if (uSess.ctx === 'wdCheckId') {
    const w = withdrawals[txt];
    SESSIONS.users[jid].ctx = 'main';
    if (!w || w.user !== user.phone) {
      return msg.reply(`⚠️ No withdrawal found with ID *${txt}* under your account.`);
    }
    return msg.reply(
      `🔍 *Withdrawal Status*\n\n` +
      `• ID: ${w.id}\n` +
      `• Amount: Ksh ${w.amount}\n` +
      `• Status: ${w.status}\n` +
      (w.remarks ? `• Remarks: ${w.remarks}\n` : '') +
      `\nReply 4 for more options.`
    );
  }

  // BROWSING CATEGORIES
  if (uSess.ctx === 'browsingCats') {
    const idx = parseInt(txt) - 1;
    if (isNaN(idx) || !categories[idx]) {
      SESSIONS.users[jid].ctx = 'main';
      return msg.reply("⚠️ Invalid selection. Returning to main menu.");
    }
    const cat = categories[idx];
    const list = products.filter(p => p.category === cat);
    if (!list.length) {
      SESSIONS.users[jid].ctx = 'main';
      return msg.reply(`❌ No products in category *${cat}*.`);
    }
    let out = `🛍️ *Products in ${cat}:*\n\n`;
    list.forEach((p,i) => out += `${i+1}. ${p.name} — Ksh ${p.price}\n`);
    SESSIONS.users[jid] = { ctx:'browsingProds', data:{ list } };
    return msg.reply(out + "\nReply with the product number to select.");
  }

  // BROWSING PRODUCTS → ORDER START
  if (uSess.ctx === 'browsingProds') {
    const list = uSess.data.list;
    const idx = parseInt(txt) - 1;
    if (isNaN(idx) || !list[idx]) {
      SESSIONS.users[jid].ctx = 'main';
      return msg.reply("⚠️ Invalid selection. Returning to main menu.");
    }
    const prod = list[idx];
    // Send image preview
    safeSend(jid, prod.image);
    SESSIONS.users[jid] = { ctx:'ordering', data:{ prod } };
    return msg.reply(`Great choice, *${user.name}*! How many *${prod.name}* would you like?`);
  }

  // ORDER FLOW
  if (uSess.ctx === 'ordering') {
    const d = uSess.data;
    if (!d.qty) {
      const q = parseInt(txt);
      if (isNaN(q) || q < 1) {
        SESSIONS.users[jid].ctx = 'main';
        return msg.reply("⚠️ Invalid quantity. Returning to main menu.");
      }
      d.qty = q;
      SESSIONS.users[jid].ctx = 'orderPhone';
      return msg.reply("📲 Enter the M-Pesa/Airtel/Telkom number for payment:");
    }
  }
  if (uSess.ctx === 'orderPhone') {
    const ph = fmtPhone(txt);
    if (!ph) {
      SESSIONS.users[jid].ctx = 'main';
      return msg.reply("⚠️ Invalid phone. Order cancelled.");
    }
    const { prod, qty } = uSess.data;
    const oid = genID("ORD");
    const amt = prod.price * qty;
    orders[oid] = {
      orderNo: oid,
      user:    user.phone,
      product: prod.name,
      qty,
      amount:  amt,
      status:  'PENDING',
      createdAt: new Date().toISOString()
    };
    save(FILES.orders, orders);
    user.orders.push(oid);
    save(FILES.users, users);
    msg.reply(`⏳ Processing your payment of Ksh ${amt}. Please wait...`);
    (async () => {
      const ref = await sendSTK(amt, ph.replace('@c.us',''));
      setTimeout(async () => {
        const st = await checkSTK(ref);
        if (st?.status === 'SUCCESS') {
          orders[oid].status = 'PAID';
          save(FILES.orders, orders);
          safeSend(jid,
            `✅ *Payment Successful!*\n\n` +
            `• Order: *${oid}*\n` +
            `• ${prod.name} x${qty}\n` +
            `• Amount: Ksh ${amt}\n\n` +
            `Thank you for choosing *${CONFIG.botName}*, *${user.name}*!`
          );
          if (!user.hasOrdered && user.referredBy) {
            safeSend(`${user.referredBy}@c.us`,
              `🎁 Your referral *${user.name}* just made their first order!`
            );
          }
          user.hasOrdered = true;
          save(FILES.users, users);
          safeSend(CONFIG.adminJid,
            `🛒 *New Order!*\n` +
            `• ${oid}\n` +
            `• ${user.name} (${user.phone})\n` +
            `• ${prod.name} x${qty}\n` +
            `• Ksh ${amt}`
          );
        } else {
          safeSend(jid, "❌ Payment failed or timed out. Reply 1 to browse again.");
        }
      }, 30000);
    })();
    SESSIONS.users[jid].ctx = 'main';
    return;
  }

  // Fallback to main
  SESSIONS.users[jid].ctx = 'main';
  return msg.reply(`❓ Sorry *${user ? user.name : 'there'}*, I didn't understand. Reply 6 for menu.`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  Object.entries(FILES).forEach(([k,f]) => save(f, eval(k)));
  console.log('\n💾 Data saved. Exiting.');
  process.exit();
});
