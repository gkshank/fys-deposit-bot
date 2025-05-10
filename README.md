```markdown
**FY’S PROPERTY WhatsApp Bot**

**A fully featured WhatsApp automation bot built with [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) for broadcasting, support tickets, balance management, and multi-admin control.**

---

**🚀 Key Features**

**1. Username-Only Registration**  
- Users simply send a unique **username** to register.  
- Duplicate-username checks: prompts to choose another if taken.

**2. Numeric Menus & Easy Navigation**  
- Every menu and prompt uses **numbers** (1, 2, 3, …).  
- All user replies append:  
```

0. Back   menu

```
so it’s easy to return to the previous screen or main menu at any time.

**3. Bulk Messaging**  
- **Option 1**: Send a broadcast message instantly to **all** your added recipients.  
- No extra confirmation step—just type your message, and it goes out prefixed with the admin label (e.g. “Admin GK-FY: Your message…”).  
- Cost computed at **costPerChar** (configurable), deducted from balance automatically.

**4. Recipient Management**  
- **Option 2**: **View Recipients**  
Lists all phone numbers you’ve added.  
- **Option 3**: **Add Recipient**  
Enter a phone number in any common format; it’s normalized and stored.  
- **Option 4**: **Remove Recipient**  
Delete a number from your list.

**5. Balance Top-Up & Reporting**  
- **Option 5**: Top-up via M-PESA STK push (minimum Ksh 11).  
- Real-time “20s left” and “10s left” updates, plus final success/failure alert.  
- Admin is notified on every successful deposit with user, amount, code, and timestamp.

**6. Check Balance & Usage**  
- **Option 6**: View your current balance, messages sent, and total charges.

**7. Contact Support**  
- **Option 7**: Sends a rich support message:  
```

🆘 Need help? Contact us:
• Email: [gk-y@iname.com](mailto:gk-y@iname.com)
• WhatsApp: [https://wa.me/254701339573](https://wa.me/254701339573)

```
- Fully editable via the **Config Menu**.

**8. Delete Account**  
- **Option 8**: Delete your account—clears your data so you can re-register if needed.

---

**🛠️ Admin Panel**

**Only numbers in `adminUsers` can access:**

```

1. View All Users
2. Change Cost/Char
3. Top-up/Deduct User
4. Ban/Unban User
5. Bulk → All Registered
6. Add Admin
7. Remove Admin
8. Show QR Dashboard
9. Config Bot Texts & Support

````

- **Add/Remove Admin**: Manage admin rights on the fly.  
- **Global Broadcast**: Send a message to every registered user.  
- **Ban/Unban**: Block misbehaving users.

---

**🔧 Installation & Setup**

**1. Clone repository**  
```bash
git clone https://github.com/your-repo/fys-property-bot.git
cd fys-property-bot
````

**2. Install dependencies**

```bash
npm install whatsapp-web.js express qrcode-terminal qrcode axios
```

**3. Configure** (in `main.js`)

* **`SUPER_ADMIN`** phone number
* Default **`botConfig`** texts
* M-PESA credentials

**4. Run the bot**

```bash
npm start
```

**5. Access QR dashboard**
Open [http://localhost:3000](http://localhost:3000) for the glass-style QR scanner.

---

**## 📋 Example: Using the **Config Menu****

Below is a walkthrough showing how you—as an admin—can tweak every bit of bot text on the fly:

1. **Type** `9` at the **Admin Main Menu** to open **Config Menu**.
2. **Enter** the number (1–9) of the item you want to change.
3. **Send** the new text or value.
4. **Receive** a “✅ Configuration updated!” confirmation.

---

**1. Edit Admin Label**

> **Admin Main Menu →** `9`
> **Config Menu →** `1`
> **Bot asks:**
> `✏️ Enter new Admin Label:`
>
> **You reply:**
> `📣 Team FY-Property`
>
> **Bot confirms:**
> `✅ Configuration updated!`

All admin-originated messages now start with **“Team FY-Property”**.

---

**2. Edit Welcome Text**

> **Config Menu →** `2`
> **Bot asks:**
> `✏️ Enter new Welcome Text:`
>
> **You reply:**
>
> ```
> 👋 Hey there! Welcome to FY’s Property Bot!  
> Please send me your *username* to get started—and enjoy exclusive offers! 🎉
> ```
>
> **Bot confirms:**
> `✅ Configuration updated!`

---

**3. Edit Registration Success Text**

> **Config Menu →** `3`
> **Bot asks:**
> `✏️ Enter new Registration Success Text:`
>
> **You reply** (use `{name}` placeholder):
>
> ```
> 🎉 Woohoo, {name}! Your account is live.  
> Your starting balance is *Ksh 0.00*.  
> Ready to broadcast? 🚀
> ```
>
> **Bot confirms:**
> `✅ Configuration updated!`

---

**4. Edit User Menu Text**

> **Config Menu →** `4`
> **Bot asks:**
> `✏️ Enter new User Menu Text (use {name}):`
>
> **You reply:**
>
> ```
> ✨ Greetings, {name}! What can I do for you today?  
> 1. Send Broadcast  
> 2. View Your Contacts  
> 3. Add a Contact  
> 4. Remove a Contact  
> 5. Top-up  
> 6. Check Account  
> 7. Help & Support  
> 8. Delete My Account
> ```
>
> **Bot confirms:**
> `✅ Configuration updated!`

---

**5. Edit “Not Enough Balance” Text**

> **Config Menu →** `5`
> **Bot asks:**
> `✏️ Enter new Not-Enough-Balance Text:`
>
> **You reply:**
>
> ```
> 😢 Oh no—you need Ksh {cost} but have only Ksh {bal}.  
> Please top-up before sending. 💳
> ```
>
> **Bot confirms:**
> `✅ Configuration updated!`

---

**6. Edit Top-up Prompt**

> **Config Menu →** `6`
> **Bot asks:**
> `✏️ Enter new Top-up Prompt:`
>
> **You reply:**
> `💳 How much would you like to add to your wallet? (Min Ksh 11)`
>
> **Bot confirms:**
> `✅ Configuration updated!`

---

**7. Edit costPerChar**

> **Config Menu →** `7`
> **Bot asks:**
> `✏️ Enter new costPerChar:`
>
> **You reply:**
> `0.02`
>
> **Bot confirms:**
> `✅ costPerChar set to Ksh 0.02`

---

**### 8. Edit Support Text**

> **Config Menu →** `8`
> **Bot asks:**
> `✏️ Enter new Support Info Text:`
>
> **You reply:**
>
> ```
> 🆘 Stuck or need assistance?  
> • Email: support@fyproperty.com  
> • WhatsApp: https://wa.me/254701339573  
> We’re here 24/7! 😊
> ```
>
> **Bot confirms:**
> `✅ Configuration updated!`

---

**9. Edit Channel ID**

> **Config Menu →** `9`
> **Bot asks:**
> `✏️ Enter new Channel ID:`
>
> **You reply:**
> `750`
>
> **Bot confirms:**
> `✅ Configuration updated!`

---

**All changes take effect immediately—no bot restart required.**
Type `0` at any time to return to the **Admin Main Menu**. Happy customizing! 🎨✨

---

**❤️Contributing**
Pull requests, issues, and suggestions are very welcome! Let’s make this bot even better.

---

**📄 License**
MIT © FY’S PROPERTY

```
```
