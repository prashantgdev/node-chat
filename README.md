# NodeChat

A private one-to-one chat app built with Node.js, Express, Socket.IO and MongoDB. The current UI is intentionally quiet and editorial rather than copying common messenger patterns: light surfaces, restrained color, clear typography, simple conversation navigation, and responsive mobile behavior.

## Product direction

- Minimal, light visual system with warm neutral surfaces.
- Distinct two-column desktop workspace with a focused conversation canvas.
- Compact, human-readable conversation list instead of dense messenger chrome.
- Search-first flow for starting a new conversation.
- Clear online / last-seen state and connection state.
- Date separators and restrained message metadata.
- Accessible labels, keyboard-friendly controls, focus states and reduced-motion support.
- Responsive mobile layout that switches naturally between the conversation list and active chat.

## Core functionality

- Real account registration and login.
- Email verification with a 6-digit OTP before a new account can sign in.
- OTP expiry, single-use verification, attempt limits and resend cooldown.
- Passwords are hashed with bcryptjs; plain passwords are never stored.
- Username is the unique public identity used throughout the application.
- Login sessions are random, hashed server-side and expire automatically.
- Username search.
- Private 1-to-1 conversations only.
- MongoDB message persistence.
- Socket.IO real-time messaging, typing indicators and presence.
- Responsive desktop/mobile UI.
- Health endpoint: `/api/health`.

## Run in Termux

```bash
pkg update
pkg install nodejs
npm install
cp .env.example .env
nano .env
```

Set your MongoDB Atlas connection string in `.env`:

```env
PORT=3000
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.mongodb.net/?retryWrites=true&w=majority
DB_NAME=nodechat
SESSION_DAYS=30

# Gmail SMTP (use a Google App Password, not your normal Gmail password)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM="NodeChat <your-email@gmail.com>"
```

## Nodemailer App Password Setup

NodeChat uses Nodemailer to send emails. If you are using Gmail, you need to create a Google App Password instead of using your regular Gmail password.

1. Go to your "Google Account" (https://myaccount.google.com/).
2. Enable 2-Step Verification for your Google account.
3. Open App Passwords in your Google Account security settings.
4. Create a new app password for NodeChat.
5. Copy the generated 16-character password.
6. Add it to "SMTP_PASSWORD" in ".env" file.

```bash
npm start
```

Open `http://127.0.0.1:3000`.

## Security notes

This is a solid small-project authentication baseline, not a complete enterprise messenger. For a public production deployment, move OTP state/rate limits to Redis or another shared store, add IP-based rate limiting and abuse controls, password reset, account deletion, stronger session/device management, HTTPS-only deployment, and cursor-based message pagination. Do not commit `.env` or real database credentials to GitHub.

## Database compatibility

The current application uses username-based identity throughout chat logic, sessions, conversations, messages, search and Socket.IO events. Existing databases from an older user-ID-based version are not automatically migrated; use a fresh database or migrate those collections before deployment.
