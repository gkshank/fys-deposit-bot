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
  fromAdmin:    "👑 Admin",
  channelID:    529,
  costPerChar:  0.01,
  welcomeText:  "👋 *Welcome!* Choose a *unique username* (3–16 letters/numbers/_):",
  regSuccessText: username => `🎉 Registered as *${username}*! Your balance: *Ksh 0.00*.`,
  userMenu(user) {
    return (
      `\n🌟 *Hello ${user.username}!* What next?\n\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `7️⃣ Delete My Account\n` +
      `8️⃣ View Recipients\n\n` +
      `Type *menu* anytime.`
    );
  },
  notEnoughBal(cost,bal) {
    return `⚠️ Cost *Ksh ${cost.toFixed(2)}*, you have *Ksh ${bal.toFixed(2)}*. Top-up first.`;
  },
  topupPrompt: "💳 How much to top-up? (min Ksh 11)",
  closedSupport: "✅ Support closed. Type *menu*."
};

// Per-chat state
const conversations = {};   // { jid: { stage,… } }
const adminSessions = {};   // { jid: { awaiting, step,… } }

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
  console.log('🚀 Bot ready');
  adminReply(SUPER_ADMIN, "🤖 Bot online").then(()=> showAdminMenu(SUPER_ADMIN));
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT||3000;
app.get('/', async (_,res) => {
  let img='';
  if(currentQR){
    try{ img=await QRCode.toDataURL(currentQR); }catch{}
  }
  res.send(`
    <body style="background:#222;color:#fff;display:flex;
      align-items:center;justify-content:center;height:100vh;
      flex-direction:column">
      <h2>Scan QR to Connect</h2>
      ${img?`<img src="${img}">`:'<p>Waiting…</p>'}
    </body>
  `);
});
app.listen(PORT,()=>console.log(`🌐 QR at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid,msg){
  try{ await client.sendMessage(jid,msg); }
  catch(e){ console.error('Send error',e); }
}
async function adminReply(jid,msg){
  return safeSend(jid, msg + "\n\n0️⃣ Go Back   00️⃣ Main Menu");
}

// format M-PESA number
function formatPhone(txt){
  let n=txt.replace(/\D/g,'');
  if(n.length===9&&n.startsWith('7')) n='254'+n;
  else if(n.length===10&&n.startsWith('0')) n='254'+n.slice(1);
  return n.length===12? n+'@c.us': null;
}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN MENUS
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid){
  adminSessions[jid]={awaiting:'main'};
  const m =
    `👑 *Admin Menu*\n`+
    `1️⃣ View Users\n`+
    `2️⃣ Change Cost/Char\n`+
    `3️⃣ Top-up/Deduct by Username\n`+
    `4️⃣ Ban/Unban by Username\n`+
    `5️⃣ Bulk to All\n`+
    `6️⃣ QR Dashboard\n`+
    `7️⃣ Config Texts/ChannelID\n`;
  return adminReply(jid,m);
}
function showConfigMenu(jid){
  adminSessions[jid]={awaiting:'config'};
  const c =
    `⚙️ *Config Menu*\n`+
    `1️⃣ Admin Label\n`+
    `2️⃣ Welcome Text\n`+
    `3️⃣ Reg-Success Text\n`+
    `4️⃣ User-Menu Text\n`+
    `5️⃣ Cost/Char\n`+
    `6️⃣ Channel ID\n`+
    `0️⃣ Back\n`;
  return adminReply(jid,c);
}

// ────────────────────────────────────────────────────────────────────
// 7) MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message', async msg=>{
  const from=msg.from, txt=msg.body.trim(), lc=txt.toLowerCase();
  if(from.endsWith('@g.us')) return;

  // 7.1) SUPPORT
  if(users[from]?.support?.open && !adminUsers.has(from)){
    await safeSend(SUPER_ADMIN, `🎟 [${users[from].username}] ${txt}`);
    return msg.reply("📥 Sent to support. Type *close* to finish.");
  }
  if(lc==='close'&& users[from]?.support?.open){
    users[from].support.open=false; saveUsers(users);
    return msg.reply(botConfig.closedSupport);
  }

  // 7.2) ADMIN ← support reply
  if(adminUsers.has(from) && lc.startsWith('reply ')){
    const [_, ticket, ...rest]=txt.split(' ');
    const content=rest.join(' ');
    const target=Object.values(users).find(u=>u.support.open&&u.support.ticketId===ticket);
    if(target){
      await safeSend(target.jid,`🛎️ ${content}`);
      return adminReply(from,`✅ Replied #${ticket}`);
    }
    return adminReply(from,"⚠️ No such ticket.");
  }

  // 7.3) ADMIN FLOW
  if(adminUsers.has(from)){
    if(txt==='00'){ delete adminSessions[from]; return showAdminMenu(from); }
    if(txt==='0'){ delete adminSessions[from]; return adminReply(from,"🔙 Back"); }
    const sess=adminSessions[from]||{};
    if(!sess.awaiting||sess.awaiting==='main'){
      switch(txt){
        case'1': sess.awaiting='view';   return adminReply(from,"👥 Loading...");
        case'2': sess.awaiting='chgCost':return adminReply(from,"💱 New cost/char:");
        case'3': sess.awaiting='modBal'; sess.step=null; return adminReply(from,"✍️ Enter username:");
        case'4': sess.awaiting='ban';    sess.step=null; return adminReply(from,"✍️ Enter username:");
        case'5': sess.awaiting='bulk';   sess.step=null; return adminReply(from,"📝 Enter message:");
        case'6': return adminReply(from,`🌐 http://localhost:${PORT}`);
        case'7': return showConfigMenu(from);
        default: return showAdminMenu(from);
      }
    }
    // sub-menus
    switch(sess.awaiting){
      case'view': {
        let out="👥 *Users List:*\n";
        Object.values(users).forEach(u=>{
          out+=`\n• ${u.username} — Ksh ${u.balance.toFixed(2)}`;
        });
        delete adminSessions[from];
        return adminReply(from,out);
      }
      case'chgCost': {
        const v=parseFloat(txt);
        if(isNaN(v)||v<=0) return adminReply(from,"⚠️ Invalid");
        botConfig.costPerChar=v; delete adminSessions[from];
        return adminReply(from,`🎉 cost/char = Ksh ${v.toFixed(2)}`);
      }
      case'modBal': {
        if(!sess.step){
          sess.step='getUser'; return adminReply(from,"✍️ Username:");
        }
        if(sess.step==='getUser'){
          const u=Object.values(users).find(u=>u.username===txt);
          if(!u) return adminReply(from,"⚠️ No such user");
          sess.targetJid=u.jid; sess.step='getAmt';
          return adminReply(from,"💰 +amount or -amount:");
        }
        if(sess.step==='getAmt'){
          const a=parseFloat(txt);
          if(isNaN(a)) return adminReply(from,"⚠️ Invalid");
          users[sess.targetJid].balance+=a; saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,`✅ ${a>=0?'Credited':'Debited'} Ksh ${Math.abs(a)}`);
        }
        break;
      }
      case'ban': {
        if(!sess.step){
          sess.step='getUser'; return adminReply(from,"✍️ Username:");
        }
        if(sess.step==='getUser'){
          const u=Object.values(users).find(u=>u.username===txt);
          if(!u) return adminReply(from,"⚠️ No such user");
          sess.targetJid=u.jid;
          if(u.banned){
            u.banned=false; u.banReason=''; saveUsers(users);
            delete adminSessions[from];
            return adminReply(from,`✅ Unbanned ${u.username}`);
          }
          sess.step='getReason'; return adminReply(from,"✏️ Ban reason:");
        }
        if(sess.step==='getReason'){
          users[sess.targetJid].banned=true;
          users[sess.targetJid].banReason=txt;
          saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,`🚫 Banned`);
        }
        break;
      }
      case'bulk': {
        if(!sess.step){
          sess.step='msg'; return adminReply(from,"📝 Enter text:");
        }
        if(sess.step==='msg'){
          sess.message=txt; sess.step='confirm';
          return adminReply(from,`Preview:\n"${txt}"\n1️⃣ Send  0️⃣ Cancel`);
        }
        if(sess.step==='confirm'){
          delete adminSessions[from];
          if(txt==='1'){
            Object.keys(users).forEach(jid=>safeSend(jid,sess.message));
            return adminReply(from,"🎉 Sent to all");
          }
          return adminReply(from,"❌ Cancelled");
        }
        break;
      }
      case'config': {
        if(!sess.step){
          switch(txt){
            case'1': sess.step='lab'; return adminReply(from,"✏️ New Admin Label:");
            case'2': sess.step='wel'; return adminReply(from,"✏️ New Welcome Text:");
            case'3': sess.step='reg'; return adminReply(from,"✏️ New Reg-Success (use {name}):");
            case'4': sess.step='umenu'; return adminReply(from,"✏️ New User-Menu (use {username}):");
            case'5': sess.step='cost'; return adminReply(from,"✏️ New cost/char:");
            case'6': sess.step='ch'; return adminReply(from,"✏️ New Channel ID:");
            case'0': delete adminSessions[from]; return showAdminMenu(from);
            default: return adminReply(from,"⚠️ Invalid");
          }
        } else {
          switch(sess.step){
            case'lab': botConfig.fromAdmin=txt; break;
            case'wel': botConfig.welcomeText=txt; break;
            case'reg': botConfig.regSuccessText=name=>txt.replace('{name}',name); break;
            case'umenu': botConfig.userMenu=_=>txt.replace('{username}',_.username); break;
            case'cost': botConfig.costPerChar=parseFloat(txt)||botConfig.costPerChar; break;
            case'ch': botConfig.channelID=parseInt(txt)||botConfig.channelID; break;
          }
          delete adminSessions[from];
          return adminReply(from,"✅ Updated");
        }
      }
    }
    return;
  }

  // 7.4) USER REGISTRATION
  if(!users[from]){
    if(!conversations[from]){
      conversations[from]={stage:'awaitUsername'};
      return msg.reply(botConfig.welcomeText);
    }
    const conv=conversations[from];
    if(conv.stage==='awaitUsername'){
      if(!/^[A-Za-z0-9_]{3,16}$/.test(txt)){
        return msg.reply("⚠️ Use 3–16 letters/numbers/_");
      }
      if(Object.values(users).some(u=>u.username===txt)){
        return msg.reply("⚠️ Taken—try another");
      }
      users[from]={
        jid:from,
        username:txt,
        balance:0,
        banned:false,
        banReason:'',
        messageCount:0,
        totalCharges:0,
        recipients:[],
        support:{open:false,ticketId:null}
      };
      saveUsers(users);
      delete conversations[from];
      await safeSend(SUPER_ADMIN,`🆕 ${txt} registered`);
      return msg.reply(botConfig.regSuccessText(txt)+botConfig.userMenu(users[from]));
    }
    return;
  }

  // 7.5) REGISTERED USER MAIN
  const user=users[from];
  if(user.banned){
    return msg.reply(`🚫 Banned.\nReason: ${user.banReason}`);
  }
  if(lc==='menu'){
    return msg.reply(botConfig.userMenu(user));
  }
  if(lc==='7'||lc==='delete my account'){
    delete users[from]; saveUsers(users);
    return msg.reply("❌ Deleted. Type *menu* to re-register.");
  }
  if(lc==='8'||lc==='view recipients'){
    const list=user.recipients.length
      ? user.recipients.map(r=>`• ${r.replace('@c.us','')}`).join('\n')
      : '— none';
    return msg.reply(`📋 Recipients:\n${list}`);
  }
  if(lc==='6'){
    if(!user.support.open){
      user.support.open=true;
      user.support.ticketId=Date.now().toString().slice(-4);
      saveUsers(users);
      return msg.reply(`🆘 Support #${user.support.ticketId}`);
    }
    return msg.reply("🆘 Type your message or *close*");
  }
  if(lc==='5'){
    return msg.reply(
      `💰 Ksh ${user.balance.toFixed(2)}\n`+
      `✉️ Sent: ${user.messageCount}\n`+
      `💸 Charges: Ksh ${user.totalCharges.toFixed(2)}`
    );
  }
  // TOP-UP (min 11)
  if(lc==='4'||conversations[from]?.stage?.startsWith('topup')){
    const conv=conversations[from]||{};
    if(lc==='4'){
      conversations[from]={stage:'topup:amount'};
      return msg.reply(botConfig.topupPrompt);
    }
    if(conv.stage==='topup:amount'){
      const a=parseFloat(txt);
      if(isNaN(a)||a<11){
        delete conversations[from];
        return msg.reply("⚠️ Minimum Ksh11. *4* to retry");
      }
      conv.amount=a; conv.stage='topup:phone'; conversations[from]=conv;
      return msg.reply(`📱 Send M-PESA number for Ksh ${a.toFixed(2)}:`);
    }
    if(conv.stage==='topup:phone'){
      const mp=formatPhone(txt), amt=conv.amount;
      delete conversations[from];
      if(!mp) return msg.reply("⚠️ Invalid. *4* to retry");
      await msg.reply(`⏳ Charging Ksh ${amt.toFixed(2)} to ${mp.replace('@c.us','')}…`);
      const ref=await sendSTKPush(amt, mp.replace('@c.us',''));
      if(!ref) return msg.reply("❌ STK failed");
      setTimeout(()=>safeSend(from,"⏳20s left"),10000);
      setTimeout(()=>safeSend(from,"⏳10s left"),20000);
      setTimeout(async()=>{
        const st=await fetchTransactionStatus(ref);
        if(st?.status==='SUCCESS'){
          user.balance+=amt; saveUsers(users);
          await safeSend(from,`🎉 Top-up Ksh ${amt.toFixed(2)} OK\nBal: Ksh ${user.balance.toFixed(2)}`);
          await safeSend(SUPER_ADMIN,`💰 ${user.username} +Ksh ${amt.toFixed(2)}`);
        } else {
          await safeSend(from,"❌ Top-up failed");
        }
      },30000);
    }
    return;
  }
  // SEND BULK
  if(lc==='1'||conversations[from]?.stage==='bulk'){
    if(lc==='1'){
      conversations[from]={stage:'bulk'};
      return msg.reply("✏️ Type message for your recipients:");
    }
    if(conversations[from].stage==='bulk'){
      const ccon=conversations[from];
      ccon.message=txt; ccon.stage='confirm'; conversations[from]=ccon;
      const cost=txt.length*botConfig.costPerChar;
      return msg.reply(
        `📝 Preview:\n"${txt}"\nCost: Ksh ${cost.toFixed(2)}\n\n✅ yes to send or no to cancel`
      );
    }
    if(conversations[from].stage==='confirm'){
      const ccon=conversations[from];
      delete conversations[from];
      if(lc==='yes'){
        const cost=ccon.message.length*botConfig.costPerChar;
        if(user.balance<cost) return msg.reply(botConfig.notEnoughBal(cost,user.balance));
        user.recipients.forEach(r=>safeSend(r,ccon.message));
        user.balance-=cost; user.messageCount++; user.totalCharges+=cost;
        saveUsers(users);
        return msg.reply(`✅ Sent!\nKsh ${cost.toFixed(2)} deducted\nBal Ksh ${user.balance.toFixed(2)}`);
      }
      return msg.reply("❌ Cancelled");
    }
    return;
  }
  // ADD RECIPIENT
  if(lc==='2'||conversations[from]?.stage==='addRec'){
    if(lc==='2'){
      conversations[from]={stage:'addRec'};
      return msg.reply("📥 Enter number (07xxxxxxxx):");
    }
    const num=formatPhone(txt);
    delete conversations[from];
    if(!num) return msg.reply("⚠️ Invalid");
    if(!user.recipients.includes(num)){
      user.recipients.push(num); saveUsers(users);
      return msg.reply(`✅ ${num.replace('@c.us','')} added`);
    }
    return msg.reply("⚠️ Already added");
  }
  // REMOVE RECIPIENT
  if(lc==='3'||conversations[from]?.stage==='delRec'){
    if(lc==='3'){
      conversations[from]={stage:'delRec'};
      return msg.reply("🗑️ Enter number to remove:");
    }
    const num=formatPhone(txt);
    delete conversations[from];
    if(!num||!user.recipients.includes(num)) return msg.reply("⚠️ Not in list");
    user.recipients=user.recipients.filter(r=>r!==num); saveUsers(users);
    return msg.reply(`🗑️ ${num.replace('@c.us','')} removed`);
  }

  // Default → show menu
  return msg.reply(botConfig.userMenu(user));
});

// ────────────────────────────────────────────────────────────────────
// 9) STK PUSH & STATUS
// ────────────────────────────────────────────────────────────────────
async function sendSTKPush(amount,phone){
  try{
    const res = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      {
        amount,
        phone_number: phone,
        channel_id: botConfig.channelID,
        provider: "m-pesa",
        external_reference: "INV-009",
        customer_name: "Bot User",
        account_reference: "FY'S PROPERTY",
        transaction_desc: "Top-up"
      },
      {
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Basic YOUR_API_KEY'
        }
      }
    );
    return res.data.reference;
  }catch(e){
    console.error('STK Error',e.message);
    return null;
  }
}
async function fetchTransactionStatus(ref){
  try{
    const res=await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      { headers:{ 'Authorization':'Basic YOUR_API_KEY' } }
    );
    return res.data;
  }catch(e){
    console.error('Status Error',e.message);
    return null;
  }
}
