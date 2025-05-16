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
// DATA PATHS & UTILITIES
// ────────────────────────────────────────────────────────────────────
const DATA = {
  users:       path.join(__dirname, 'users.json'),
  products:    path.join(__dirname, 'products.json'),
  categories:  path.join(__dirname, 'categories.json'),
  faqs:        path.join(__dirname, 'faqs.json'),
  orders:      path.join(__dirname, 'orders.json'),
};
function load(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ────────────────────────────────────────────────────────────────────
// BOT CONFIG
// ────────────────────────────────────────────────────────────────────
let botConfig = {
  adminJid:     '254701339573@c.us',
  botName:      "FY'S PROPERTY",
  channelID:    724,
  referralBonus:"🎁 You’ve earned a referral bonus!",
  welcomeText:  "👋 Welcome to FY'S PROPERTY! Please reply with a *username* to register:",
  userMenu(u) {
    return `✨ Hi ${u.name}! What would you like to do?\n` +
      `1️⃣ Browse Products\n` +
      `2️⃣ My Orders\n` +
      `3️⃣ Refer a Friend\n` +
      `4️⃣ FAQs\n` +
      `5️⃣ Menu`;
  }
};

// ────────────────────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────────────────────
let users       = load(DATA.users);
let products    = load(DATA.products);
let categories  = load(DATA.categories);
let faqs        = load(DATA.faqs);
let orders      = load(DATA.orders);
const conversations = {};    // per-chat FSM
const adminSessions = {};    // per-admin FSM

// ────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────
function formatPhone(txt) {
  let n = txt.replace(/[^\d]/g,'');
  if(n.length===9 && n.startsWith('7'))    n='254'+n;
  if(n.length===10&& n.startsWith('0'))    n='254'+n.slice(1);
  if(n.length===12&& n.startsWith('254'))  return n+'@c.us';
  return null;
}
function genOrderNumber() {
  const s = [...Array(6)].map(_=> Math.random().toString(36)[2]).join('').toUpperCase();
  return `FY'S-${s}`;
}
async function safeSend(jid,msg){
  try { await client.sendMessage(jid,msg) }
  catch(e){
    console.error('❌ Send error',e);
    if(jid!==botConfig.adminJid)
      client.sendMessage(botConfig.adminJid,`⚠️ Failed to send to ${jid}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// M-PESA INTEGRATION (PayHero)
// ────────────────────────────────────────────────────────────────────
const PAYHERO_KEY = 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==';
async function sendSTKPush(amount,phone){
  const payload = {
    amount, phone_number:phone,
    channel_id:botConfig.channelID,
    provider:"m-pesa",
    external_reference:genOrderNumber(),
    account_reference:botConfig.botName,
    transaction_desc:botConfig.botName
  };
  try {
    const res = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      { headers:{ 'Content-Type':'application/json','Authorization':PAYHERO_KEY } }
    );
    return res.data.reference;
  } catch(e){
    console.error('STK Push Error',e.message);
    return null;
  }
}
async function fetchTransactionStatus(ref){
  try {
    const res = await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      { headers:{ 'Authorization':PAYHERO_KEY } }
    );
    return res.data;
  } catch(e){
    console.error('Fetch Status Error',e.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// WHATSAPP CLIENT INIT
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = '';
client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr,{ small:true });
});
client.on('ready', () => {
  console.log('🤖 Bot ready');
  safeSend(botConfig.adminJid, `🚀 *${botConfig.botName}* is now online!`);
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// EXPRESS QR CODE DASHBOARD
// ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT||3000;
app.get('/', async (req,res)=>{
  let img = currentQR ? await QRCode.toDataURL(currentQR) : '';
  res.send(`
    <html><body style="text-align:center">
      <h1>Scan to join *${botConfig.botName}*</h1>
      ${img? `<img src="${img}">` : '<p>Waiting for QR…</p>'}
    </body></html>
  `);
});
app.listen(PORT, ()=>console.log(`🌐 Dashboard: http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg=>{
  const from = msg.from, txt=msg.body.trim(), lc=txt.toLowerCase();

  // ignore groups
  if(from.endsWith('@g.us')) return;

  // ADMIN FLOWS
  if(from===botConfig.adminJid){
    // back / menu
    if(txt==='00'){ delete adminSessions[from]; return showAdminMenu(); }
    if(txt==='0'){ delete adminSessions[from]; return safeSend(from,'🔙 Back'); }

    const sess = adminSessions[from] || {};
    if(!sess.awaiting || sess.awaiting==='main'){
      return handleAdminMain(txt);
    }
    return handleAdminSubmenu(sess,txt);
  }

  // REGISTRATION (incl. referral)
  if(!users[from]){
    const conv = conversations[from]||{stage:'awaitRegister'};
    if(conv.stage==='awaitRegister'){
      // referral?
      let ref=null;
      if(lc.startsWith('referral:')){
        const uname=txt.split(':')[1].trim();
        ref = Object.values(users).find(u=>u.name.toLowerCase()===uname.toLowerCase());
        if(!ref){
          delete conversations[from];
          return msg.reply('⚠️ Invalid referral link. Please enter a *username* to register:');
        }
      }
      // check duplicate
      if(Object.values(users).some(u=>u.name.toLowerCase()===lc) && !ref){
        return msg.reply('⚠️ That username is taken—please choose another.');
      }
      // create user
      users[from] = {
        name: txt,
        phone: from.replace('@c.us',''),
        referredBy: ref? ref.phone : null,
        registeredAt: new Date().toISOString(),
        banned:false,
        orders: [],
        hasOrdered:false
      };
      save(DATA.users,users);
      // notify admin
      const rp = ref? `\n• Referred by: ${ref.phone.slice(0,6)}**** (${ref.name})` : '';
      safeSend(botConfig.adminJid,
        `🆕 New Registration\n• ${txt} (${from.replace('@c.us','')})${rp}`
      );
      // notify referrer
      if(ref){
        safeSend(ref.jid, `🎉 You referred: ${users[from].name}!`);
      }
      delete conversations[from];
      return msg.reply(botConfig.welcomeText.replace('Welcome','Registered') 
        + '\n\n' + botConfig.userMenu(users[from]));
    }
  }

  // BANNED?
  const user = users[from];
  if(user && user.banned){
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`);
  }

  // USER MENU
  if(user){
    if(lc==='5' || lc==='menu') return msg.reply(botConfig.userMenu(user));

    switch(lc){
      case '1': // Browse Products
        return showProducts(from);
      case '2':
        return showMyOrders(from);
      case '3':
        return msg.reply(`🔗 Your referral link:\nhttps://wa.me/${client.info.wid.user}?text=referral:${user.name}`);
      case '4':
        return showFAQs(from);
      default:
        // handle ongoing convo stages (e.g. ordering)
        return handleUserConversation(from,txt,lc,user);
    }
  }

  // default
  return msg.reply(botConfig.welcomeText);
});

// ────────────────────────────────────────────────────────────────────
// ADMIN: SHOW MAIN MENU
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(){
  adminSessions[botConfig.adminJid] = { awaiting:'main' };
  const m = `👑 *Admin Menu* — Reply by number:
1️⃣ View Users
2️⃣ Ban/Unban User
3️⃣ Add/Edit Products
4️⃣ Add/Edit Categories
5️⃣ Add/Edit FAQs
6️⃣ Change Bot Name / Channel
7️⃣ Bulk Message`;
  safeSend(botConfig.adminJid,m);
}

// ────────────────────────────────────────────────────────────────────
// ADMIN: HANDLE MAIN
// ────────────────────────────────────────────────────────────────────
function handleAdminMain(txt){
  switch(txt){
    case '1': // view users
      const us = Object.values(users).map(u=>`• ${u.name} (${u.phone})${u.banned? '🚫':''}`).join('\n');
      safeSend(botConfig.adminJid, `👥 Users:\n${us}`);
      break;
    case '2':
      adminSessions[botConfig.adminJid]={awaiting:'banUser'};
      safeSend(botConfig.adminJid,'🚫 Enter phone to ban/unban:');
      break;
    case '3':
      adminSessions[botConfig.adminJid]={awaiting:'editProducts'};
      safeSend(botConfig.adminJid,'🛒 *Products*: 1️⃣ Add 2️⃣ Edit 3️⃣ Delete');
      break;
    case '4':
      adminSessions[botConfig.adminJid]={awaiting:'editCats'};
      safeSend(botConfig.adminJid,'📂 *Categories*: 1️⃣ Add 2️⃣ Delete');
      break;
    case '5':
      adminSessions[botConfig.adminJid]={awaiting:'editFAQs'};
      safeSend(botConfig.adminJid,'❓ *FAQs*: 1️⃣ Add 2️⃣ Edit 3️⃣ Delete');
      break;
    case '6':
      adminSessions[botConfig.adminJid]={awaiting:'editConfig'};
      safeSend(botConfig.adminJid,'⚙️ *Config*: 1️⃣ Bot Name 2️⃣ Channel ID');
      break;
    case '7':
      adminSessions[botConfig.adminJid]={awaiting:'bulkMsg'};
      safeSend(botConfig.adminJid,'📣 Enter message to broadcast:');
      break;
    default:
      showAdminMenu();
  }
}

// ────────────────────────────────────────────────────────────────────
// (For brevity: implement handleAdminSubmenu with similar switch/steps
// to Add/Edit/Delete in products.json, categories.json, faqs.json,
// Ban/Unban user (toggle users[jid].banned + reason), Change botConfig,
// Bulk message looping safeSend to all users. Then save files.)
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// USER: SHOW PRODUCTS
// ────────────────────────────────────────────────────────────────────
function showProducts(jid){
  if(!products.length) {
    return safeSend(jid,'❌ No products available.');
  }
  const list = products.map((p,i)=>`${i+1}. ${p.name} — Ksh ${p.price}`).join('\n');
  conversations[jid] = { stage:'ordering', step:'chooseProduct' };
  return safeSend(jid, `🛍️ *Products*\n${list}\n\nReply with number to order.`);
}

// ────────────────────────────────────────────────────────────────────
// USER: HANDLE ORDER FLOW
// ────────────────────────────────────────────────────────────────────
async function handleUserConversation(jid,txt,lc,user){
  const conv = conversations[jid];
  if(!conv) return safeSend(jid,'⚠️ Invalid option. Reply *5* for menu.');

  // Step: chooseProduct
  if(conv.stage==='ordering' && conv.step==='chooseProduct'){
    const idx = parseInt(txt)-1;
    if(isNaN(idx)||idx<0||idx>=products.length){
      delete conversations[jid];
      return safeSend(jid,'⚠️ Invalid selection. Reply *1* to browse again.');
    }
    conv.product = products[idx];
    conv.step='enterQty';
    return safeSend(jid, `📦 How many *${conv.product.name}*?`);
  }

  // Step: enterQty
  if(conv.step==='enterQty'){
    const qty = parseInt(txt);
    if(isNaN(qty)||qty<1){
      delete conversations[jid];
      return safeSend(jid,'⚠️ Invalid quantity. Reply *1* to browse again.');
    }
    conv.qty=qty;
    conv.step='enterPhone';
    return safeSend(jid, `📲 Send phone number for payment:`);
  }

  // Step: enterPhone
  if(conv.step==='enterPhone'){
    const ph = formatPhone(txt);
    if(!ph){
      delete conversations[jid];
      return safeSend(jid,'⚠️ Invalid phone. Order canceled.');
    }
    conv.payPhone = ph.replace('@c.us','');
    // create order record
    const orderNo = genOrderNumber();
    const amount = conv.product.price * conv.qty;
    const order = {
      orderNo, user: user.phone, product: conv.product.name,
      qty:conv.qty, amount, status:'PENDING', createdAt:new Date().toISOString()
    };
    orders[orderNo] = order;
    save(DATA.orders,orders);
    user.orders.push(orderNo);
    save(DATA.users,users);

    // prompt STK Push
    safeSend(jid, `⏳ Initiating payment of Ksh ${amount}…`);
    const ref = await sendSTKPush(amount,conv.payPhone);

    // wait & poll
    setTimeout(async()=>{
      const st = await fetchTransactionStatus(ref);
      if(st && st.status==='SUCCESS'){
        orders[orderNo].status='PAID';
        save(DATA.orders,orders);
        safeSend(jid,
          `✅ Payment received!\n`+
          `• Order: ${orderNo}\n`+
          `• ${conv.product.name} x${conv.qty}\n`+
          `• Amount: Ksh ${amount}`
        );
        // first order referral bonus
        if(!user.hasOrdered && user.referredBy){
          const refu = Object.values(users).find(u=>u.phone===user.referredBy);
          if(refu){
            safeSend(refu.jid||`${refu.phone}@c.us`, botConfig.referralBonus);
          }
        }
        user.hasOrdered = true; save(DATA.users,users);
        // notify admin
        safeSend(botConfig.adminJid,
          `🛒 New Order\n• ${orderNo}\n`+
          `• ${user.name} (${user.phone})\n`+
          `• ${conv.product.name} x${conv.qty}\n`+
          `• Ksh ${amount}\n`
        );
      } else {
        safeSend(jid, '❌ Payment failed or timed out. Please try again.');
      }
    },30000);

    delete conversations[jid];
    return;
  }

  // other stages...
}

// ────────────────────────────────────────────────────────────────────
// USER: SHOW MY ORDERS
// ────────────────────────────────────────────────────────────────────
function showMyOrders(jid){
  const u = users[jid];
  if(!u.orders.length) return safeSend(jid,'📭 No orders yet.');
  const lines = u.orders.map(no=>{
    const o=orders[no];
    return `• ${no}: ${o.product} x${o.qty} — ${o.status}`;
  }).join('\n');
  return safeSend(jid, `📦 Your Orders:\n${lines}`);
}

// ────────────────────────────────────────────────────────────────────
// USER: SHOW FAQs
// ────────────────────────────────────────────────────────────────────
function showFAQs(jid){
  if(!faqs.length) return safeSend(jid,'❌ No FAQs set.');
  const list = faqs.map((f,i)=>`${i+1}. Q: ${f.q}\n   A: ${f.a}`).join('\n\n');
  return safeSend(jid, `❓ FAQs:\n\n${list}`);
}

// ────────────────────────────────────────────────────────────────────
// ON EXIT: SAVE ALL
// ────────────────────────────────────────────────────────────────────
process.on('SIGINT', ()=> {
  save(DATA.users,users);
  save(DATA.products,products);
  save(DATA.categories,categories);
  save(DATA.faqs,faqs);
  save(DATA.orders,orders);
  process.exit();
});
