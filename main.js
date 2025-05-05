/*******************************************************************
 * main.js
 *******************************************************************/
const { Client, LocalAuth } = require('whatsapp-web.js');
const express           = require('express');
const qrcodeTerminal    = require('qrcode-terminal');
const QRCode            = require('qrcode');
const axios             = require('axios');

/***********************************************************
 * GLOBAL / CONFIG
 ***********************************************************/
let currentQR = "";

// Super‐admin and set of admins
const SUPER_ADMIN = '254701339573@c.us';
const adminUsers  = new Set([ SUPER_ADMIN ]);

// Bot configuration
let botConfig = {
  fromAdmin:        "Admin GK-FY",
  channelID:        529,
  welcomeMessage:   "👋 *Welcome to FY'S PROPERTY Deposit Bot!* How much would you like to deposit? 💰",
  depositChosen:    "👍 *Great!* You've chosen to deposit Ksh {amount}. Now, please provide your deposit number (e.g., your account number) 📱",
  paymentInitiated: "⏳ *Payment initiated!* We'll check status in {seconds} seconds... Stay tuned!",
  countdownUpdate:  "⏳ {seconds} seconds left... Fetching status soon!",
  paymentSuccess:   "🎉 *Payment Successful!*\n• Amount: Ksh {amount}\n• Deposit #: {depositNumber}\n• MPESA Code: {mpesaCode}\n• Date/Time: {date}\n\n{footer}",
  paymentFooter:    "Thank you for choosing FY'S PROPERTY! Type *Start* to deposit again."
};

const conversations = {};  // per‐user deposit flows
const adminSessions = {};  // per‐admin menu flows
let savedUsers  = new Set();
let savedGroups = new Set();

/***********************************************************
 * WHATSAPP CLIENT
 ***********************************************************/
const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', qr => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('Bot is ready');
  adminReply(SUPER_ADMIN, "🎉 Bot is now *online* and ready for action!");
  showAdminMenu(SUPER_ADMIN);
});

/***********************************************************
 * HELPERS
 ***********************************************************/
function showAdminMenu(to) {
  const menu =
`${botConfig.fromAdmin}: *Main Menu*
1. Add User
2. View Users
3. Delete User
4. Add Group
5. View Groups
6. Delete Group
7. Bulk → Users
8. Bulk → Groups
9. Bulk → All
10. Config Bot Texts
11. Add Admin
12. Remove Admin`;
  adminReply(to, menu);
}

function formatPhoneNumber(input) {
  let num = input.replace(/[^\d]/g, '');
  if (num.startsWith('0')) num = '254' + num.slice(1);
  if (!num.startsWith('254') || num.length < 12) return null;
  return num + '@c.us';
}

function parsePlaceholders(tpl, data) {
  return tpl
    .replace(/{amount}/g, data.amount || '')
    .replace(/{depositNumber}/g, data.depositNumber || '')
    .replace(/{seconds}/g, data.seconds || '')
    .replace(/{mpesaCode}/g, data.mpesaCode || '')
    .replace(/{date}/g, data.date || '')
    .replace(/{footer}/g, botConfig.paymentFooter);
}

async function safeSend(to, msg) {
  try {
    await client.sendMessage(to, msg);
  } catch (e) {
    console.error(`Error→${to}:`, e.message);
    if (to !== SUPER_ADMIN) {
      await client.sendMessage(SUPER_ADMIN, `⚠️ Failed to send to ${to}:\n${e.message}`);
    }
  }
}

// Always append “Go Back” / “Main Menu” on admin messages
function adminReply(to, msg) {
  const suffix = `\n\n0️⃣ Go Back 🔙\n00️⃣ Main Menu`;
  return safeSend(to, msg + suffix);
}

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
          'Content-Type':'application/json',
          'Authorization':'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
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
          'Authorization':'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
        }
      }
    );
    return res.data;
  } catch (err) {
    console.error("Fetch Status Error:", err.message);
    return null;
  }
}

/***********************************************************
 * MESSAGE HANDLER
 ***********************************************************/
client.on('message', async msg => {
  const from = msg.from, txt = msg.body.trim(), lc = txt.toLowerCase();
  if (from.endsWith('@g.us')) return;  // ignore groups

  // ─── ADMIN FLOW ───────────────────────
  if (adminUsers.has(from)) {
    const sess = adminSessions[from] || {};

    // 00 = main menu | 0 = go back (cancel current step)
    if (txt === '00') { delete adminSessions[from]; return showAdminMenu(from); }
    if (txt === '0')  { delete adminSessions[from]; return adminReply(from, "🔙 Went back!"); }

    // submenu: config texts
    if (sess.awaiting === 'configMenu') {
      switch (txt) {
        case '1': sess.awaiting = 'edit:fromAdmin';   return adminReply(from, "✏️ Enter new *Admin label*:");
        case '2': sess.awaiting = 'edit:welcomeMessage';   return adminReply(from, "✏️ Enter new *Welcome Message*:");
        case '3': sess.awaiting = 'edit:depositChosen';    return adminReply(from, "✏️ Enter new *Deposit Prompt*:");
        case '4': sess.awaiting = 'edit:paymentInitiated'; return adminReply(from, "✏️ Enter new *Payment Initiated*:");
        case '5': sess.awaiting = 'edit:countdownUpdate'; return adminReply(from, "✏️ Enter new *Countdown Update*:");
        case '6': sess.awaiting = 'edit:paymentSuccess';   return adminReply(from, "✏️ Enter new *Payment Success*:");
        case '7': sess.awaiting = 'edit:paymentFooter';    return adminReply(from, "✏️ Enter new *Payment Footer*:");
        case '8': sess.awaiting = 'edit:channelID';        return adminReply(from, "✏️ Enter new *Channel ID* (number):");
        default:  return adminReply(from, "❌ Invalid choice, pick 1–8!");
      }
    }
    // handle edit:<key>
    if (sess.awaiting?.startsWith('edit:')) {
      const key = sess.awaiting.split(':')[1];
      let val = txt;
      if (key === 'channelID') {
        const n = parseInt(txt);
        if (isNaN(n)) return adminReply(from, "⚠️ Must be a number! Try again:");
        val = n;
      }
      botConfig[key] = val;
      delete adminSessions[from];
      return adminReply(from, `🎉 *Success!* Updated *${key}* to:\n${val}`);
    }

    // add user
    if (sess.awaiting === 'addUser') {
      const j = formatPhoneNumber(txt);
      if (!j) return adminReply(from, "⚠️ Invalid phone. Retry:");
      savedUsers.add(j);
      delete adminSessions[from];
      return adminReply(from, `✅ Added user: ${j}`);
    }
    // delete user
    if (sess.awaiting === 'delUser') {
      const j = formatPhoneNumber(txt);
      if (!j || !savedUsers.has(j)) return adminReply(from, "⚠️ Not found. Retry:");
      savedUsers.delete(j);
      delete adminSessions[from];
      return adminReply(from, `🗑️ Removed user: ${j}`);
    }
    // add group
    if (sess.awaiting === 'addGroup') {
      if (!txt.endsWith('@g.us')) return adminReply(from, "⚠️ Must end with @g.us:");
      savedGroups.add(txt);
      delete adminSessions[from];
      return adminReply(from, `✅ Added group: ${txt}`);
    }
    // delete group
    if (sess.awaiting === 'delGroup') {
      if (!txt.endsWith('@g.us') || !savedGroups.has(txt)) return adminReply(from, "⚠️ Not found. Retry:");
      savedGroups.delete(txt);
      delete adminSessions[from];
      return adminReply(from, `🗑️ Removed group: ${txt}`);
    }

    // bulk: enter message
    if (sess.awaiting === 'bulk') {
      sess.message = txt;
      sess.awaiting = 'confirmBulk';
      return adminReply(from,
        `📝 *Preview*:\n"${txt}"\n\n1️⃣ Send to *${sess.target}*\n2️⃣ Cancel`
      );
    }
    // bulk: confirm
    if (sess.awaiting === 'confirmBulk') {
      if (txt === '1') {
        const payload = `*${botConfig.fromAdmin}:*\n${sess.message}`;
        if (sess.target==='users'||sess.target==='all')
          for (let u of savedUsers) await safeSend(u, payload);
        if (sess.target==='groups'||sess.target==='all')
          for (let g of savedGroups) await safeSend(g, payload);
        delete adminSessions[from];
        return adminReply(from, "🎉 Bulk send *completed*!");
      } else {
        delete adminSessions[from];
        return adminReply(from, "❌ Bulk send *cancelled*.");
      }
    }

    // add admin
    if (sess.awaiting === 'addAdmin') {
      if (from !== SUPER_ADMIN) {
        delete adminSessions[from];
        return adminReply(from, "⚠️ Only super-admin can add admins.");
      }
      const j = formatPhoneNumber(txt);
      if (!j) return adminReply(from, "⚠️ Invalid phone. Retry:");
      adminUsers.add(j);
      delete adminSessions[from];
      return adminReply(from, `✅ New admin added: ${j}`);
    }
    // remove admin
    if (sess.awaiting === 'removeAdmin') {
      if (from !== SUPER_ADMIN) {
        delete adminSessions[from];
        return adminReply(from, "⚠️ Only super-admin can remove admins.");
      }
      const j = formatPhoneNumber(txt);
      if (!j||!adminUsers.has(j)||j===SUPER_ADMIN) {
        return adminReply(from, "⚠️ Cannot remove that admin. Retry:");
      }
      adminUsers.delete(j);
      delete adminSessions[from];
      return adminReply(from, `🗑️ Admin removed: ${j}`);
    }

    // no pending → main menu choice
    switch (txt) {
      case '1': adminSessions[from]={awaiting:'addUser'};    return adminReply(from,"📱 Enter phone to add:");
      case '2': return adminReply(from,
                  savedUsers.size ? "👥 Users:\n"+[...savedUsers].join('\n') : "No users.");
      case '3': adminSessions[from]={awaiting:'delUser'};    return adminReply(from,"📱 Enter phone to delete:");
      case '4': adminSessions[from]={awaiting:'addGroup'};   return adminReply(from,"🙌 Enter group JID:");
      case '5': return adminReply(from,
                  savedGroups.size ? "👥 Groups:\n"+[...savedGroups].join('\n') : "No groups.");
      case '6': adminSessions[from]={awaiting:'delGroup'};   return adminReply(from,"📱 Enter group JID to delete:");
      case '7':
      case '8':
      case '9':
        adminSessions[from]={awaiting:'bulk',
          target: txt==='7'?'users':txt==='8'?'groups':'all'};
        return adminReply(from,"📝 Enter message for bulk send:");
      case '10': adminSessions[from]={awaiting:'configMenu'};return adminReply(from,
`⚙️ Config Bot Texts:
1 Admin Label
2 Welcome Msg
3 Deposit Prompt
4 Payment Init
5 Countdown
6 Success Msg
7 Payment Footer
8 Channel ID`
      );
      case '11': adminSessions[from]={awaiting:'addAdmin'};   return adminReply(from,"👤 Enter phone for new admin:");
      case '12': adminSessions[from]={awaiting:'removeAdmin'};return adminReply(from,"🗑️ Enter phone of admin to remove:");
      default:   return showAdminMenu(from);
    }
  }

  // ─── USER DEPOSIT FLOW ─────────────────────
  if (lc === 'start') {
    conversations[from] = { stage:'awaitingAmount' };
    return safeSend(from, botConfig.welcomeMessage);
  }
  if (!conversations[from]) {
    conversations[from] = { stage:'awaitingAmount' };
    return safeSend(from, botConfig.welcomeMessage);
  }
  const conv = conversations[from];

  // amount entered
  if (conv.stage==='awaitingAmount') {
    const a = parseInt(txt);
    if (isNaN(a)||a<=0) {
      return safeSend(from,"⚠️ Enter a valid number in Ksh.");
    }
    conv.amount=a; conv.stage='awaitingDepositNumber';
    return safeSend(from,parsePlaceholders(botConfig.depositChosen,{amount:String(a)}));
  }
  // deposit number
  if (conv.stage==='awaitingDepositNumber') {
    conv.depositNumber=txt; conv.stage='processing';
    const ref=await sendSTKPush(conv.amount,conv.depositNumber);
    if(!ref){ delete conversations[from]; return safeSend(from,"❌ Error initiating payment. Try later."); }
    conv.stkRef=ref;
    const now=new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
    await safeSend(SUPER_ADMIN,
      `📥 Attempt: Ksh ${conv.amount}, #${conv.depositNumber}, at ${now}`
    );
    await safeSend(from,parsePlaceholders(botConfig.paymentInitiated,{seconds:'20'}));
    setTimeout(()=>safeSend(from,parsePlaceholders(botConfig.countdownUpdate,{seconds:'10'})),10000);
    setTimeout(async()=>{
      const status=await fetchTransactionStatus(conv.stkRef);
      const ts=new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
      if(!status){ delete conversations[from]; return safeSend(from,"❌ Error fetching status."); }
      const st=(status.status||'').toUpperCase(),
            code=status.provider_reference||'', desc=status.ResultDesc||'';
      if(st==='SUCCESS'){
        await safeSend(from,parsePlaceholders(botConfig.paymentSuccess,{
          amount:String(conv.amount),
          depositNumber:conv.depositNumber,
          mpesaCode:code,
          date:ts
        }));
        await safeSend(SUPER_ADMIN,`✅ Success: Ksh ${conv.amount}, #${conv.depositNumber}, code ${code}, at ${ts}`);
      } else {
        let err='Please try again.';
        if(/insufficient/i.test(desc)) err='Insufficient funds.';
        if(/pin/i.test(desc)) err='Incorrect PIN.';
        await safeSend(from,`❌ Payment ${st}. ${err}\nType *Start* to retry.`);
        await safeSend(SUPER_ADMIN,`❌ Failed: Ksh ${conv.amount}, #${conv.depositNumber}, err ${err}, at ${ts}`);
      }
      delete conversations[from];
    },20000);
    return;
  }
});

/***********************************************************
 * EXPRESS SERVER (QR Dashboard)
 ***********************************************************/
const app = express(), port = process.env.PORT||3000;
app.get('/', async (req,res)=>{
  let qrImg='';
  if(currentQR){
    try{ qrImg=await QRCode.toDataURL(currentQR); }catch{}
  }
  res.send(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FY'S PROPERTY Bot QR</title>
<style>
  html,body{height:100%;margin:0;display:flex;align-items:center;justify-content:center;
    background:url('https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d')no-repeat center/cover;
    font-family:Arial,sans-serif;}
  .glass{backdrop-filter:blur(10px);background:rgba(255,255,255,0.2);
    padding:2rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:320px;width:90%;text-align:center;}
  .glass h1{color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.5);margin-bottom:1rem;}
  .qr-box img{width:100%;max-width:250px;}
  .footer{margin-top:1rem;color:#eee;font-size:0.9rem;}
</style>
</head><body>
  <div class="glass">
    <h1>Scan to Connect</h1>
    <div class="qr-box">
      ${qrImg?`<img src="${qrImg}">`:'<p style="color:#fff;">Waiting for QR…</p>'}
    </div>
    <div class="footer">Created By FY'S PROPERTY</div>
  </div>
</body></html>`);
});
app.listen(port,()=>console.log(`Express on port ${port}`));
client.initialize();
