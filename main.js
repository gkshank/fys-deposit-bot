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
// 1) STORAGE
// ────────────────────────────────────────────────────────────────────
const DATA_PATH = path.join(__dirname, 'users.json');
function loadUsers() {
  if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH));
  return {};
}
function saveUsers(u){ fs.writeFileSync(DATA_PATH, JSON.stringify(u,null,2)); }
let users = loadUsers();

// ────────────────────────────────────────────────────────────────────
// 2) CONFIG
// ────────────────────────────────────────────────────────────────────
const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);
const userNav  = "\n\n0️⃣ Back   00️⃣ Menu";
const adminNav = "\n\n0️⃣ Back   00️⃣ Main Menu";

let botConfig = {
  channelID:   529,
  costPerChar: 0.01,
  welcome:     "👋 Welcome! Send your phone (e.g. 0712345678) to register.",
  askName:     "✅ Now send your *name*:",
  userMenu: u => (
    `✨ Hi *${u.name}*!\n1️⃣ Send Bulk\n2️⃣ Add Recipient\n3️⃣ Remove Recipient\n4️⃣ Top-up\n5️⃣ Check Balance\n6️⃣ Support\n7️⃣ View Recipients`+userNav
  )
};

// per-chat state
const conv = {};   // conv[from] = { stage, ... }
const adminS = {}; // adminS[from] = { awaiting, step, ... }

// ────────────────────────────────────────────────────────────────────
// 3) WA CLIENT
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = '';

client.on('qr', qr=>{
  currentQR = qr;
  qrcodeTerminal.generate(qr,{small:true});
});
client.on('ready', ()=>{
  console.log("Bot ready");
  adminReply(SUPER_ADMIN,"🚀 Bot online!");
  showAdminMenu(SUPER_ADMIN);
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const app=express(), PORT=3000;
app.get('/',async (req,res)=>{
  let img='';
  if(currentQR) try{ img=await QRCode.toDataURL(currentQR);}catch{}
  res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#222;color:#fff;font-family:sans-serif} .box{backdrop-filter:blur(10px);background:rgba(255,255,255,0.1);padding:2rem;border-radius:1rem;text-align:center} .box img{max-width:250px;width:80%}</style></head><body>
<div class="box"><h1>Scan to Connect</h1>${img?`<img src="${img}">`:'<p>Waiting for QR…</p>'}<p style="font-size:0.8rem;color:#ccc">Created by FY’S PROPERTY</p></div></body></html>`);
});
app.listen(PORT,()=>console.log(`QR at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid,msg){
  try{await client.sendMessage(jid,msg);}
  catch(e){
    console.error("Err",e.message);
    if(jid!==SUPER_ADMIN) client.sendMessage(SUPER_ADMIN,`⚠️ Err to ${jid}: ${e.message}`);
  }
}
function fmtPhone(t){let n=t.replace(/\D/g,''); if(n.startsWith('0'))n='254'+n.slice(1);return n.length===12?n+'@c.us':null;}
async function adminReply(jid,msg){return safeSend(jid,msg+adminNav);}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN PANEL (NUMERIC)
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid){
  adminS[jid]={awaiting:'main'};
  const menu=`🛠️ Admin Menu:
1️⃣ View Users
2️⃣ Change Cost/Char
3️⃣ Top-up/Deduct User
4️⃣ Ban/Unban User
5️⃣ Broadcast All
6️⃣ Show QR
7️⃣ Config Texts/ChannelID`+adminNav;
  return adminReply(jid,menu);
}
function showConfigMenu(jid){
  adminS[jid]={awaiting:'config'};
  const cfg=`⚙️ Config Menu:
1 Admin Label
2 Welcome Text
3 Ask-Name Text
4 User-Menu Text
5 costPerChar
6 ChannelID
0 Back`+adminNav;
  return adminReply(jid,cfg);
}

// ────────────────────────────────────────────────────────────────────
// 7) MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message',async m=>{
  const from=m.from, t=m.body.trim(), l=t.toLowerCase();
  if(from.endsWith('@g.us'))return;

  // -- ADMIN MENU FLOW --
  if(adminUsers.has(from)){
    // back/main
    if(t==='00'){delete adminS[from];return showAdminMenu(from);}
    if(t==='0'){delete adminS[from];return adminReply(from,"🔙 Back");}

    const s=adminS[from]||{};
    // main dispatch
    if(!s.awaiting||s.awaiting==='main'){
      switch(t){
        case '1': s.awaiting='view'; return adminReply(from,"👥 Fetching...");
        case '2': s.awaiting='setc'; return adminReply(from,"💱 Enter new cost/char:");
        case '3': s.awaiting='mod'; s.step=null; return adminReply(from,"💰 Enter user phone:");
        case '4': s.awaiting='ban'; s.step=null; return adminReply(from,"🚫 Enter user phone:");
        case '5': s.awaiting='bc'; s.step=null; return adminReply(from,"📝 Enter broadcast msg:");
        case '6': s.awaiting='qr'; return adminReply(from,`🌐 http://localhost:${PORT}`);
        case '7': return showConfigMenu(from);
        default: return showAdminMenu(from);
      }
    }
    // subhandlers
    switch(s.awaiting){
      case 'view': {
        let out="👥 Users:\n";
        Object.values(users).forEach(u=>{
          out+=`\n• ${u.name} (${u.phone})\n  Bal:Ksh${u.balance.toFixed(2)} Sent:${u.messageCount} Chrg:Ksh${u.totalCharges.toFixed(2)} Banned:${u.banned}\n`;
        });
        delete adminS[from]; return adminReply(from,out);
      }
      case 'setc': {
        const v=parseFloat(t);
        if(isNaN(v)||v<=0) return adminReply(from,"⚠️ Invalid");
        botConfig.costPerChar=v; delete adminS[from];
        return adminReply(from,`✅ cost/char=${v}`);
      }
      case 'mod': {
        if(!s.step){s.step='getu'; return adminReply(from,"📱 Enter phone:");}
        if(s.step==='getu'){
          const j=fmtPhone(t); if(!j||!users[j]){delete adminS[from];return adminReply(from,"⚠️ No such user");}
          s.tgt=j; s.step='geta'; return adminReply(from,"💰 +amt or -amt:");
        }
        if(s.step==='geta'){
          const a=parseFloat(t);
          if(isNaN(a)){return adminReply(from,"⚠️ Invalid");}
          users[s.tgt].balance+=a;saveUsers(users);
          delete adminS[from];
          return adminReply(from,`✅ New bal:${users[s.tgt].balance.toFixed(2)}`);
        }
        break;
      }
      case 'ban': {
        if(!s.step){s.step='getu'; return adminReply(from,"📱 Enter phone:");}
        if(s.step==='getu'){
          const j=fmtPhone(t); if(!j||!users[j]){delete adminS[from];return adminReply(from,"⚠️ No user");}
          s.tgt=j;
          if(users[j].banned){users[j].banned=false;users[j].banReason='';saveUsers(users);delete adminS[from];
            return adminReply(from,`✅ ${users[j].name} unbanned`);
          }
          s.step='reason';return adminReply(from,"✏️ Enter reason:");
        }
        if(s.step==='reason'){
          users[s.tgt].banned=true;users[s.tgt].banReason=t;saveUsers(users);
          delete adminS[from];
          return adminReply(from,`🚫 ${users[s.tgt].name} banned`);
        }
        break;
      }
      case 'bc': {
        if(!s.step){s.step='msg';return adminReply(from,"📝 Enter msg:");}
        if(s.step==='msg'){
          Object.keys(users).forEach(j=>safeSend(j,t));
          delete adminS[from];
          return adminReply(from,"🎉 Broadcast sent");
        }
        break;
      }
      case 'qr':
        delete adminS[from];
        return adminReply(from,`🌐 QR at http://localhost:${PORT}`);
      case 'config':
        delete adminS[from];
        return showConfigMenu(from);
    }
    return;
  }

  // -- USER SIDE --
  if(!users[from]){
    if(!conv[from]){
      conv[from]={stage:'phone'};
      return m.reply(botConfig.welcome+userNav);
    }
    if(conv[from].stage==='phone'){
      const j=fmtPhone(t);
      if(!j){delete conv[from];return m.reply("⚠️ Invalid"+userNav);}
      users[from]={phone:j.replace('@c.us',''),name:'',balance:0,banned:false,banReason:'',
        messageCount:0,totalCharges:0,recipients:[],support:{open:false,ticketId:null}};
      saveUsers(users);
      conv[from].stage='name';
      return m.reply(botConfig.askName+userNav);
    }
    if(conv[from].stage==='name'){
      users[from].name=t;saveUsers(users);delete conv[from];
      return m.reply(botConfig.regSuccess?.call(botConfig,t)||"Registered"+userNav);
    }
    return;
  }

  const u=users[from];
  if(u.banned) return m.reply(`🚫 Banned: ${u.banReason}`+userNav);
  // Back/Menu
  if(t==='0'){delete conv[from];return m.reply(botConfig.userMenu(u));}
  if(t==='00'){delete conv[from];return m.reply(botConfig.userMenu(u));}

  switch(t){
    case '1': conv[from]={stage:'bulk'}; return m.reply("✏️ Bulk msg?"+userNav);
    case '2': conv[from]={stage:'add'};  return m.reply("📥 Add phone?"+userNav);
    case '3': // remove via list
      if(!u.recipients.length) return m.reply("⚠️ None"+userNav);
      let l="📋 Recipients:\n";
      u.recipients.forEach((r,i)=>l+=`\n${i+1}. ${r}`); l+=userNav+"\n(Type number)";
      conv[from]={stage:'rem'};
      return m.reply(l);
    case '4': conv[from]={stage:'tp-phone'};return m.reply("📱 Your Mpesa phone?"+userNav);
    case '5': return m.reply(
        `💰${u.balance.toFixed(2)} | Sent:${u.messageCount} | Chrg:${u.totalCharges.toFixed(2)}`+userNav
      );
    case '6':
      if(!u.support.open){
        u.support.open=true;u.support.ticketId=Date.now().toString().slice(-6);saveUsers(users);
        return m.reply(`🆘 Tkt #${u.support.ticketId} open. Message?`+userNav);
      }
      return m.reply("🆘 Continue or 'close'"+userNav);
    case '7':
      if(!u.recipients.length) return m.reply("⚠️ None"+userNav);
      let out="📋 Recipients:\n";u.recipients.forEach((r,i)=>out+=`\n${i+1}. ${r}`);out+=userNav+"\n(Type # to delete)";
      conv[from]={stage:'view'};
      return m.reply(out);
  }

  // conversation states
  if(conv[from]?.stage==='bulk'){
    const mtext=t;delete conv[from];
    const cost=mtext.length*botConfig.costPerChar;
    if(u.balance<cost) return m.reply(botConfig.notEnoughBal(cost,u.balance));
    u.recipients.forEach(r=>safeSend(r,mtext));
    u.balance-=cost;u.messageCount++;u.totalCharges+=cost;saveUsers(users);
    return m.reply(`✅ Sent! Deducted ${cost.toFixed(2)}`+userNav);
  }
  if(conv[from]?.stage==='add'){
    const j=fmtPhone(t);delete conv[from];
    if(!j) return m.reply("⚠️ Invalid"+userNav);
    if(!u.recipients.includes(j)){
      u.recipients.push(j);saveUsers(users);
      return m.reply(`✅ Added ${j}`+userNav);
    }
    return m.reply("⚠️ Exists"+userNav);
  }
  if(conv[from]?.stage==='rem'){
    const i=parseInt(t);delete conv[from];
    if(isNaN(i)||i<1||i>u.recipients.length) return m.reply("🔙"+userNav);
    const r=u.recipients.splice(i-1,1)[0];saveUsers(users);
    return m.reply(`🗑️ Removed ${r}`+userNav);
  }
  if(conv[from]?.stage==='tp-phone'){
    if(!/^(01|07)\d{8}$/.test(t)){delete conv[from];return m.reply("⚠️ Invalid"+userNav);}
    conv[from]={stage:'tp-amt',phone:t};
    return m.reply("💳 Amount?"+userNav);
  }
  if(conv[from]?.stage==='tp-amt'){
    const amt=parseFloat(t), phone=conv[from].phone;delete conv[from];
    if(isNaN(amt)||amt<=0) return m.reply("⚠️ Invalid"+userNav);
    const ref=await sendSTK(amt,phone);
    const now=new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
    await safeSend(SUPER_ADMIN,
      `💳 *Top-up Attempt*\n• ${u.name} (${phone})\n• Ksh ${amt}\n• Ref ${ref}\n• ${now}`
    );
    m.reply("⏳ Processing, wait 30s…"+userNav);
    setTimeout(async()=>{
      const st=await checkStatus(ref);
      const ts=new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
      if(st?.status==='SUCCESS'){
        u.balance+=amt;saveUsers(users);
        await safeSend(from,`🎉 Top-up OK! Bal:${u.balance.toFixed(2)}`+userNav);
        await safeSend(SUPER_ADMIN,`✅ *Success*\n• ${u.name} ${phone}\n• Ksh${amt}\n• Ref${ref}\n• ${ts}`);
      } else {
        await safeSend(from,"❌ Failed"+userNav);
        await safeSend(SUPER_ADMIN,`❌ *Fail*\n• ${u.name} ${phone}\n• Ksh${amt}\n• Ref${ref}\n• ${ts}`);
      }
    },30000);
    return;
  }

  // default
  return m.reply(botConfig.userMenu(u));
});

// -------- M-PESA HELPERS --------
async function sendSTK(amount,phone){
  const pl={ amount,phone_number:phone,channel_id:botConfig.channelID,
    provider:"m-pesa",external_reference:"INV-009",customer_name:"FY'S PROPERTY",
    callback_url:"https://your-callback-url",account_reference:"FY'S PROPERTY",
    transaction_desc:"FY'S PROPERTY",remarks:"FY'S PROPERTY" };
  try{const r=await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',pl,
      {headers:{'Content-Type':'application/json','Authorization':'Basic QklY...'}}
    );return r.data.reference;
  }catch(e){return null;}
}
async function checkStatus(ref){
  try{const r=await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      {headers:{'Authorization':'Basic QklY...'}}
    );return r.data;
  }catch(e){return null;}
}
