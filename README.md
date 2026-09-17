# NodeChat

<p align="center" style="background: #fff; padding: 5px; border-radius: 7px;">
  <img src="public/images/logo.png" alt="NodeChat Logo" width="180">
   <br />
  <img src="public/images/text.png" alt="NodeChat Logo" width="180">
</p>

A private 1-to-1 real-time chat application built with **Node.js, Express, Socket.IO, MongoDB, and vanilla JavaScript**.

NodeChat is designed as a simple, self-hostable messaging application with account verification, private conversations, real-time messaging, presence, message management, and session-based authentication.

## Features

- Private 1-to-1 conversations
- Username-based user identity
- Email verification with 6-digit OTP
- OTP expiration and single-use verification
- OTP resend cooldown and attempt limits
- Secure password hashing with bcrypt
- Server-side session authentication
- Hashed session tokens
- Session expiration
- Username search
- MongoDB message persistence
- Real-time messaging with Socket.IO
- Typing indicators
- Online/offline presence
- Last-seen information
- Message delivery status
- Read receipts
- Unread message counts
- Message history pagination
- Message editing
- Permanent message deletion
- Message context menu
- Copy message text
- Mobile-friendly copy fallback
- Automatic reconnection handling
- Date/day separators in conversations
- API health endpoint
- Basic request/rate-limit protection

## Tech Stack

### Backend

- Node.js
- Express
- Socket.IO
- MongoDB
- Nodemailer
- bcryptjs
- dotenv

### Frontend

- HTML
- CSS
- Vanilla JavaScript
- Socket.IO Client

No frontend framework is required.

## Project Structure

```text
node-chat/
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
└── server.js
```

## Requirements

Before running NodeChat, make sure you have:

- Node.js 18+
- npm
- MongoDB
- An SMTP account if email verification is enabled

## Installation

Clone the repository:

```bash
git clone https://github.com/prashantgdev/node-chat.git
cd node-chat
```

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Then configure the values in `.env`.

## Environment Variables

Example:

```env
PORT=3000

MONGODB_URI=mongodb://127.0.0.1:27017
DB_NAME=nodechat

SESSION_DAYS=30

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

### MongoDB

`MONGODB_URI` is the MongoDB connection string.

For a local MongoDB instance:

```env
MONGODB_URI=mongodb://127.0.0.1:27017
```

You can also use a MongoDB Atlas connection string.

### Email / SMTP

SMTP configuration is used for sending email verification OTPs.

If SMTP is not configured, email verification will not function correctly.

For production, use a dedicated SMTP provider rather than exposing email credentials in source code.

## Running the Application

Start the server:

```bash
npm start
```

The application will normally be available at:

```text
http://localhost:3000
```

For development, you can run:

```bash
node server.js
```

## Authentication

NodeChat uses server-side sessions.

The authentication flow is:

```text
Register
   ↓
Email verification
   ↓
OTP verification
   ↓
Login
   ↓
Session creation
   ↓
Authenticated chat
```

Passwords are hashed before being stored.

Session tokens are hashed before being stored in MongoDB.

## Messaging

Conversations are private 1-to-1 chats between two users.

Messages are persisted in MongoDB and delivered in real time using Socket.IO.

The messaging system supports:

- Sending messages
- Message history
- Pagination
- Typing indicators
- Delivery status
- Read status
- Editing messages
- Deleting messages
- Unread counts
- Online presence
- Last seen
- Message context actions

## Socket.IO

The application uses Socket.IO for real-time communication.

Real-time functionality includes:

```text
Message delivery
Typing indicators
Presence updates
Message editing
Message deletion
Read status
Delivery status
```

The client authenticates the Socket.IO connection using the application's session token.

## API

Health check:

```text
GET /api/health
```

Authentication and account endpoints include:

```text
POST /api/auth/register
POST /api/auth/verify-email
POST /api/auth/resend-verification
POST /api/auth/login
POST /api/auth/logout
GET  /api/me
```

User and chat endpoints include:

```text
GET /api/users/search
GET /api/chats
GET /api/chats/:otherUsername/messages
```

The exact request and response behavior is implemented in `server.js`.

## Database

NodeChat uses MongoDB for persistent application data.

Main collections include:

```text
users
sessions
conversations
messages
verification_otps
```

Indexes are created for commonly queried fields and unique constraints.

## Security

The application includes several security measures:

- Password hashing with bcrypt
- Hashed session tokens
- Session expiration
- OTP expiration
- Single-use OTP verification
- OTP attempt limits
- OTP resend cooldown
- Input validation
- Username/email normalization
- MongoDB indexes and unique constraints
- Basic request/rate limiting
- Environment variables for secrets

### Production considerations

Before exposing NodeChat publicly, consider adding:

- HTTPS
- Stronger IP-based rate limiting
- Redis for distributed rate limiting
- Redis/session infrastructure for multi-instance deployments
- CSRF protection where applicable
- Stronger abuse/spam prevention
- Account password reset
- Account deletion
- Device/session management
- More comprehensive security headers
- Message pagination optimized for very large conversations
- Centralized logging
- Monitoring and alerting
- Object storage for media uploads
- Background jobs for email and notifications

## Mobile / Termux

NodeChat can also be run in environments such as Termux.

Basic setup:

```bash
pkg update
pkg install nodejs
```

Then:

```bash
git clone https://github.com/prashantgdev/node-chat.git
cd node-chat
npm install
npm start
```

Make sure MongoDB is accessible from the environment where the server is running.

## Development

The project intentionally uses a simple architecture:

```text
Browser
   │
   ├── HTML
   ├── CSS
   └── Vanilla JavaScript
          │
          │ HTTP
          ▼
       Express
          │
          ├── Authentication
          ├── REST API
          └── Sessions
          │
          │ Socket.IO
          ▼
     Real-time events
          │
          ▼
       MongoDB
```

This keeps the application relatively easy to understand and modify without requiring a frontend framework.

## Data and Privacy

NodeChat is designed to be self-hosted.

If you deploy your own instance, you are responsible for:

- Protecting user data
- Securing the server
- Managing database access
- Managing SMTP credentials
- Configuring HTTPS
- Applying appropriate backups
- Handling legal/privacy requirements applicable to your deployment

Never commit `.env` or other secrets to Git.

## Existing Databases

If you have an older NodeChat database from a previous schema/version, review the current database structure before using it with a newer version.

Back up your database before making significant application updates.