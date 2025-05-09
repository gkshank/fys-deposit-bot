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
  if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH));
  return {};
}
function saveUsers(u) { fs.writeFileSync(DATA_PATH, JSON.stringify(u,null,2)); }
let users = loadUsers();

// ────────────────────────────────────────────────────────────────────
// 2) CONFIG & STATE
// ────────────────────────────────────────────────────────────────────
const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);

const userNavSuffix  = "\n\n0️⃣ Back   00️⃣ Menu";
const adminNavSuffix = "\n\n0️⃣ Back   00️⃣ Main Menu";

let botConfig = {
  fromAdmin:    "Admin GK-FY",
  channelID:    529,
  costPerChar:  0.01,
  welcomeText:  "👋 *Welcome to FY'S PROPERTY!* Please register by sending your *phone number* (e.g. 0712345678).",
  askNameText:  "✅ Perfect! Now send me your *name*:",
  userMenu(user) {
    const name = user.name || '';
    return (
      `✨ Hello *${name}*!\nWhat would you like to do?\n` +
      `1️⃣ Send Bulk Message\n` +
      `2️⃣ Add Recipient\n` +
      `3️⃣ Remove Recipient\n` +
      `4️⃣ Top-up Balance\n` +
      `5️⃣ Check Balance\n` +
      `6️⃣ Contact Support\n` +
      `7️⃣ View Recipients\n` +
      userNavSuffix
    );
  },
  regSuccess(name) {
    return `🎉 Congratulations, *${name}*! You’re now registered.\nYour balance is *Ksh 0.00*.` + this.userMenu({name});
  },
  notEnoughBal(cost,bal) {
    return `⚠️ This will cost *Ksh ${cost.toFixed(2)}*, but your balance is *Ksh ${bal.toFixed(2)}*.` + userNavSuffix;
  },
  topupPhonePrompt: "📱 Enter your Mpesa phone (# must start 07 or 01, 10 digits):",
  topupAmtPrompt:   "💳 Now enter the top-up amount in Ksh:",
  closedSupport:    "✅ Support closed. Anything else?" + userNavSuffix
};

const conversations = {};   // per-user flow
const adminSessions = {};   // per-admin flow

// ────────────────────────────────────────────────────────────────────
// 3) WHATSAPP CLIENT
// ────────────────────────────────────────────────────────────────────
const client = new Client({ authStrategy: new LocalAuth() });
let currentQR = '';

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});
client.on('ready', () => {
  console.log('🚀 Bot is ready');
  adminReply(SUPER_ADMIN, "🤖 Bot deployed! Here's your admin menu:");
  showAdminMenu(SUPER_ADMIN);
});
client.initialize();

// ────────────────────────────────────────────────────────────────────
// 4) EXPRESS QR DASHBOARD
// ────────────────────────────────────────────────────────────────────
const app = express(), PORT = process.env.PORT||3000;
app.get('/', async (req,res) => {
  let img='';
  if(currentQR) try{ img=await QRCode.toDataURL(currentQR); }catch{}
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
    <div class="qr-box">${img?`<img src="${img}">`:'<p style="color:#fff;">Waiting for QR…</p>'}</div>
    <div class="footer">Created By FY'S PROPERTY</div>
  </div>
</body></html>
`);
});
app.listen(PORT,()=>console.log(`🌐 Dashboard at http://localhost:${PORT}`));

// ────────────────────────────────────────────────────────────────────
// 5) HELPERS
// ────────────────────────────────────────────────────────────────────
async function safeSend(jid,msg){
  try{ await client.sendMessage(jid,msg); }
  catch(e){
    console.error(`❌ Error to ${jid}:`, e.message);
    if(jid!==SUPER_ADMIN) await client.sendMessage(SUPER_ADMIN, `⚠️ Couldn’t send to ${jid}: ${e.message}`);
  }
}
function formatPhone(txt){
  let n=txt.replace(/[^\d]/g,'');
  if(n.startsWith('0')) n='254'+n.slice(1);
  return n.length===12? n+'@c.us' : null;
}
async function adminReply(jid,msg){
  return safeSend(jid,msg+adminNavSuffix);
}

// ────────────────────────────────────────────────────────────────────
// 6) ADMIN PANEL
// ────────────────────────────────────────────────────────────────────
function showAdminMenu(jid){
  adminSessions[jid]={awaiting:'main'};
  const menu=`${botConfig.fromAdmin}: *Admin Main Menu*
1️⃣ View All Users
2️⃣ Change Cost/Char (Ksh ${botConfig.costPerChar.toFixed(2)})
3️⃣ Top-up/Deduct User
4️⃣ Ban/Unban User
5️⃣ Bulk → All Registered
6️⃣ Show QR Dashboard
7️⃣ Config Bot Texts/ChannelID` + adminNavSuffix;
  return adminReply(jid,menu);
}
function showConfigMenu(jid){
  adminSessions[jid]={awaiting:'config'};
  const cfg=`${botConfig.fromAdmin}: *Config Menu*
1 Edit Admin Label
2 Edit Welcome Text
3 Edit Ask-Name Text
4 Edit Reg-Success Text
5 Edit User-Menu Text
6 Edit Not-Enough-Bal Text
7 Edit Topup Prompts
8 Edit costPerChar
9 Edit Channel ID
0 Back` + adminNavSuffix;
  return adminReply(jid,cfg);
}

// ────────────────────────────────────────────────────────────────────
// 7) MESSAGE HANDLER
// ────────────────────────────────────────────────────────────────────
client.on('message',async msg=>{
  const from=msg.from, txt=msg.body.trim(), lc=txt.toLowerCase();
  if(from.endsWith('@g.us')) return;

  // 7.1) SUPPORT
  if(users[from]?.support?.open && !adminUsers.has(from)){
    const t=users[from].support.ticketId;
    await safeSend(SUPER_ADMIN,`🎟️ #${t} from ${users[from].name}:\n"${txt}"`);
    return msg.reply("📥 Sent to support. Type 'close' to finish."+userNavSuffix);
  }
  if(lc==='close' && users[from]?.support?.open){
    users[from].support.open=false; saveUsers(users);
    return msg.reply(botConfig.closedSupport);
  }
  if(adminUsers.has(from) && lc.startsWith('reply ')){
    const [_,tkt,...rest]=txt.split(' '), content=rest.join(' ');
    const target=Object.entries(users).find(([jid,u])=>u.support.open&&u.support.ticketId===tkt);
    if(target){
      const [jid,u]=target;
      await safeSend(jid,`🛎 Support Reply:\n"${content}"`);
      return adminReply(from,`✅ Replied to ticket #${tkt}.`);
    }
    return adminReply(from,`⚠️ No open ticket #${tkt}.`);
  }

  // 7.2) ADMIN FLOW
  if(adminUsers.has(from)){
    if(txt==='00'){ delete adminSessions[from]; return showAdminMenu(from); }
    if(txt==='0'){ delete adminSessions[from]; return adminReply(from,"🔙 Back."); }
    const sess=adminSessions[from]||{};
    if(!sess.awaiting||sess.awaiting==='main'){
      switch(txt){
        case '1': sess.awaiting='viewUsers'; return adminReply(from,"👥 Gathering users...");
        case '2': sess.awaiting='chgCost';   return adminReply(from,"💱 Enter new costPerChar:");
        case '3': sess.awaiting='modBal'; sess.step=null; return adminReply(from,"💰 Enter user phone:");
        case '4': sess.awaiting='banUser'; sess.step=null; return adminReply(from,"🚫 Enter user phone:");
        case '5': sess.awaiting='bulkAll'; sess.step=null; return adminReply(from,"📝 Enter broadcast message:");
        case '6': sess.awaiting='showQR';    return adminReply(from,`🌐 Dashboard: http://localhost:${PORT}`);
        case '7': return showConfigMenu(from);
        default:  return showAdminMenu(from);
      }
    }
    // Submenus
    switch(sess.awaiting){
      case 'viewUsers': {
        let out="👥 *Registered Users:*\n";
        for(let [jid,u] of Object.entries(users)){
          out+=`\n• *${u.name}* (${u.phone})\n  • Balance: *Ksh ${u.balance.toFixed(2)}*\n  • Sent: *${u.messageCount}* msgs\n  • Charges: *Ksh ${u.totalCharges.toFixed(2)}*\n  • Banned: ${u.banned?`Yes (${u.banReason})`:'No'}\n`;
        }
        delete adminSessions[from];
        return adminReply(from,out);
      }
      case 'chgCost': {
        const k=parseFloat(txt);
        if(isNaN(k)||k<=0) return adminReply(from,"⚠️ Invalid number:");
        botConfig.costPerChar=k; delete adminSessions[from];
        return adminReply(from,`🎉 costPerChar set to Ksh ${k.toFixed(2)}`);
      }
      case 'modBal': {
        if(!sess.step){ sess.step='getUser'; return adminReply(from,"📱 Enter user phone:"); }
        if(sess.step==='getUser'){
          const jid=formatPhone(txt);
          if(!jid||!users[jid]){ delete adminSessions[from]; return adminReply(from,"⚠️ User not found."); }
          sess.target=jid; sess.step='getAmt'; return adminReply(from,"💰 Enter +amount or -amount:");
        }
        if(sess.step==='getAmt'){
          const amt=parseFloat(txt);
          if(isNaN(amt)) return adminReply(from,"⚠️ Invalid amount:");
          users[sess.target].balance+=amt; saveUsers(users);
          delete adminSessions[from];
          return adminReply(from,`✅ New balance for *${users[sess.target].name}*: Ksh ${users[sess.target].balance.toFixed(2)}`);
        }
        break;
      }
      case 'banUser': {
        if(!sess.step){ sess.step='getUser'; return adminReply(from,"📱 Enter user phone:"); }
        if(sess.step==='getUser'){
          const jid=formatPhone(txt);
          if(!jid||!users[jid]){ delete adminSessions[from]; return adminReply(from,"⚠️ User not found."); }
          sess.target=jid;
          if(users[jid].banned){
            users[jid].banned=false; users[jid].banReason='';
            saveUsers(users); delete adminSessions[from];
            return adminReply(from,`✅ *${users[jid].name}* is now unbanned.`);
          }
          sess.step='getReason'; return adminReply(from,"✏️ Enter ban reason:");
        }
        if(sess.step==='getReason'){
          users[sess.target].banned=true; users[sess.target].banReason=txt;
          saveUsers(users); delete adminSessions[from];
          return adminReply(from,`🚫 *${users[sess.target].name}* banned for: ${txt}`);
        }
        break;
      }
      case 'bulkAll': {
        if(!sess.step){ sess.step='getMsg'; return adminReply(from,"📝 Enter broadcast message:"); }
        if(sess.step==='getMsg'){
          sess.message=txt; sess.step='confirm';
          return adminReply(from,
            `📝 *Preview:*\n"${txt}"\n\n1️⃣ Send  2️⃣ Cancel`
          );
        }
        if(sess.step==='confirm'){
          if(txt==='1'){
            for(let jid of Object.keys(users)) await safeSend(jid,sess.message);
            delete adminSessions[from];
            return adminReply(from,"🎉 Broadcast sent to all users!");
          } else {
            delete adminSessions[from];
            return adminReply(from,"❌ Broadcast cancelled.");
          }
        }
        break;
      }
      case 'showQR':
        delete adminSessions[from];
        return adminReply(from,`🌐 Dashboard at http://localhost:${PORT}`);
      case 'config':
        delete adminSessions[from];
        return showConfigMenu(from);
      default:
        delete adminSessions[from];
        return adminReply(from,"⚠️ Unknown option.");
    }
    return;
  }

  // 7.3) USER REGISTRATION
  if(!users[from]){
    if(!conversations[from]){
      conversations[from]={stage:'awaitPhone'};
      return msg.reply(botConfig.welcomeText+userNavSuffix);
    }
    const conv=conversations[from];
    if(conv.stage==='awaitPhone'){
      const jid=formatPhone(txt);
      if(!jid){ delete conversations[from]; return msg.reply("⚠️ Invalid phone."+userNavSuffix); }
      users[from]={ phone:jid.replace('@c.us',''), name:'', registeredAt:new Date().toISOString(),
        balance:0, banned:false, banReason:'', messageCount:0, totalCharges:0,
        recipients:[], support:{open:false,ticketId:null}
      };
      saveUsers(users);
      conv.stage='awaitName';
      return msg.reply(botConfig.askNameText+userNavSuffix);
    }
    if(conv.stage==='awaitName'){
      users[from].name=txt; saveUsers(users); delete conversations[from];
      return msg.reply(botConfig.regSuccess(users[from].name));
    }
    return;
  }

  // 7.4) REGISTERED USER FLOW
  const user = users[from];
  if(user.banned){
    return msg.reply(`🚫 You are banned.\nReason: ${user.banReason}`+userNavSuffix);
  }
  if(lc==='menu'){
    return msg.reply(botConfig.userMenu(user));
  }

  // 6) Contact Support
  if(lc==='6'){
    if(!user.support.open){
      user.support.open=true;
      user.support.ticketId=Date.now().toString().slice(-6);
      saveUsers(users);
      return msg.reply(`🆘 Ticket #${user.support.ticketId} opened. Type your message.`+userNavSuffix);
    }
    return msg.reply("🆘 Continue your support message or 'close'."+userNavSuffix);
  }

  // 5) Check Balance
  if(lc==='5'){
    return msg.reply(
      `💰 Balance: Ksh ${user.balance.toFixed(2)}\n`+
      `✉️ Messages sent: ${user.messageCount}\n`+
      `💸 Total charges: ${user.totalCharges.toFixed(2)}`+userNavSuffix
    );
  }

  // 4) Top-up: phone → amount → STK
  if(lc==='4'|| conversations[from]?.stage==='topupPhone' || conversations[from]?.stage==='topupAmt'){
    if(lc==='4'){
      conversations[from]={stage:'topupPhone'};
      return msg.reply(botConfig.topupPhonePrompt+userNavSuffix);
    }
    const conv=conversations[from];
    if(conv.stage==='topupPhone'){
      if(!/^(01|07)\d{8}$/.test(txt)){
        return msg.reply("⚠️ Must start 01/07 and be 10 digits."+userNavSuffix);
      }
      conv.phone=txt; conv.stage='topupAmt';
      return msg.reply(botConfig.topupAmtPrompt+userNavSuffix);
    }
    if(conv.stage==='topupAmt'){
      const amt=parseFloat(txt);
      if(isNaN(amt)||amt<=0){
        delete conversations[from];
        return msg.reply("⚠️ Invalid amount."+userNavSuffix);
      }
      const ref=await sendSTKPush(amt,conv.phone);
      // admin alert
      const now=new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
      await safeSend(SUPER_ADMIN,
        `💳 *Top-up Attempt*\n• User: *${user.name}* (${conv.phone})\n• Amount: Ksh ${amt}\n• Ref: ${ref}\n• Time: ${now}`
      );
      msg.reply("⏳ Top-up in progress… (30s)" + userNavSuffix);
      setTimeout(async()=>{
        const st=await fetchTransactionStatus(ref);
        const ts=new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
        if(st?.status==='SUCCESS'){
          user.balance+=amt; saveUsers(users);
          await safeSend(from,`🎉 Top-up successful! New bal: Ksh ${user.balance.toFixed(2)}`+userNavSuffix);
          await safeSend(SUPER_ADMIN,
            `✅ *Top-up Success*\n• User: ${user.name}\n• Amount: ${amt}\n• Ref: ${ref}\n• Time: ${ts}`
          );
        } else {
          await safeSend(from, "❌ Top-up failed."+userNavSuffix);
          await safeSend(SUPER_ADMIN,
            `❌ *Top-up Failed*\n• User: ${user.name}\n• Amount: ${amt}\n• Ref: ${ref}\n• Time: ${ts}`
          );
        }
        delete conversations[from];
      },30000);
      return;
    }
  }

  // 1) Bulk Message
  if(lc==='1'|| conversations[from]?.stage==='awaitBulk'){
    if(lc==='1'){
      conversations[from]={stage:'awaitBulk'};
      return msg.reply("✏️ Type your message to send:" + userNavSuffix);
    }
    if(conversations[from].stage==='awaitBulk'){
      const message=txt; delete conversations[from];
      const cost=message.length*botConfig.costPerChar;
      if(user.balance<cost){
        return msg.reply(botConfig.notEnoughBal(cost,user.balance));
      }
      conversations[from]={stage:'confirmBulk',message};
      return msg.reply(
        `📝 Preview:\n"${message}"\nCost: Ksh ${cost.toFixed(2)}\n1️⃣ Send  2️⃣ Cancel`+userNavSuffix
      );
    }
    if(conversations[from].stage==='confirmBulk'){
      if(txt==='1'){
        const message=conversations[from].message; delete conversations[from];
        const cost=message.length*botConfig.costPerChar;
        for(let r of user.recipients) await safeSend(r,message);
        user.balance-=cost; user.messageCount++; user.totalCharges+=cost; saveUsers(users);
        return msg.reply(`✅ Sent! Ksh ${cost.toFixed(2)} deducted. Bal: Ksh ${user.balance.toFixed(2)}`+userNavSuffix);
      } else {
        delete conversations[from];
        return msg.reply("❌ Cancelled."+userNavSuffix);
      }
    }
    return;
  }

  // 7) View Recipients
  if(lc==='7' || conversations[from]?.stage==='viewRec'){
    if(lc==='7'){
      const recs=user.recipients;
      if(!recs.length){
        return msg.reply("⚠️ No recipients yet."+userNavSuffix);
      }
      let list="📋 Your Recipients:\n";
      recs.forEach((r,i)=> list+=`\n${i+1}. ${r}`);
      list+= `\n\nType the number to delete or '0' to cancel.`;
      conversations[from]={stage:'viewRec'};
      return msg.reply(list);
    }
    if(conversations[from].stage==='viewRec'){
      const idx=parseInt(txt);
      if(isNaN(idx)||idx<1||idx>user.recipients.length){
        delete conversations[from];
        return msg.reply("🔙 Canceled."+userNavSuffix);
      }
      const removed=user.recipients.splice(idx-1,1)[0];
      saveUsers(users);
      delete conversations[from];
      return msg.reply(`🗑️ Removed ${removed}.`+userNavSuffix);
    }
    return;
  }

  // Default → user menu
  return msg.reply(botConfig.userMenu(user));
});

// ────────────────────────────────────────────────────────────────────
// 8) M-PESA STK & STATUS
// ────────────────────────────────────────────────────────────────────
async function sendSTKPush(amount,phone){
  const payload={ amount, phone_number:phone, channel_id:botConfig.channelID,
    provider:"m-pesa", external_reference:"INV-009",
    customer_name:"FY'S PROPERTY User",
    callback_url:"https://your-callback-url",
    account_reference:"FY'S PROPERTY",
    transaction_desc:"FY'S PROPERTY Payment",
    remarks:"FY'S PROPERTY", business_name:"FY'S PROPERTY",
    companyName:"FY'S PROPERTY"
  };
  try{
    const res=await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,{
      headers:{ 'Content-Type':'application/json',
        'Authorization':'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==' }
      }
    );
    return res.data.reference;
  }catch(err){
    console.error("STK Push Error:",err.message);
    return null;
  }
}
async function fetchTransactionStatus(ref){
  try{
    const res=await axios.get(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
      {headers:{ 'Authorization':'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==' }}
    );
    return res.data;
  }catch(err){
    console.error("Fetch Status Error:",err.message);
    return null;
  }
}
