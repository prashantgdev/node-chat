import "dotenv/config";
import express from "express";
import http from "http";
import crypto from "crypto";
import { MongoClient } from "mongodb";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "nodechat";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing. Copy .env.example to .env and set it.");
  process.exit(1);
}

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
app.use(express.json({ limit: "50kb" }));
app.use(express.static("public"));

const mailer = process.env.SMTP_USER && process.env.SMTP_PASSWORD
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    })
  : null;

const mongo = new MongoClient(MONGODB_URI);
await mongo.connect();
const db = mongo.db(DB_NAME);
const users = db.collection("users");
const sessions = db.collection("sessions");
const conversations = db.collection("conversations");
const messages = db.collection("messages");
const verificationOtps = db.collection("verification_otps");

await Promise.all([
  users.createIndex({ username: 1 }, { unique: true }),
  users.createIndex({ email: 1 }, { unique: true }),
  sessions.createIndex({ tokenHash: 1 }, { unique: true }),
  sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  conversations.createIndex({ key: 1 }, { unique: true }),
  conversations.createIndex({ members: 1 }),
  messages.createIndex({ conversationId: 1, createdAt: 1 }),
  verificationOtps.createIndex({ email: 1 }, { unique: true }),
  verificationOtps.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
]);

function makeToken() { return crypto.randomBytes(32).toString("hex"); }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function hashOtp(otp) { return crypto.createHash("sha256").update(otp).digest("hex"); }
function sameSecret(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function generateOtp() { return crypto.randomInt(100000, 1000000).toString(); }
function conversationKey(a, b) { return [a, b].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" })).join(":").toLowerCase(); }
function cleanEmail(email) { return String(email || "").trim().toLowerCase(); }
function cleanUsername(username) { return String(username || "").trim().replace(/\s+/g, ""); }
function cleanDisplayName(name) { return String(name || "").trim().replace(/\s+/g, " "); }
function publicUser(user) {
  return {
    name: user.name || user.displayName || user.username,
    username: user.username,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt || null
  };
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function createSession(username) {
  const token = makeToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await sessions.insertOne({ username, tokenHash: hashToken(token), createdAt: now, expiresAt });
  return { token, expiresAt };
}
async function getUserByToken(token) {
  if (!token) return null;
  const session = await sessions.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return users.findOne({ username: session.username });
}
async function getUserByUsername(username) {
  const value = cleanUsername(username);
  return users.findOne({ username: { $regex: `^${escapeRegex(value)}$`, $options: "i" } });
}
async function setLastSeen(username) {
  const now = new Date();
  await users.updateOne({ username }, { $set: { lastSeenAt: now } });
  return now;
}
async function isOnline(username) {
  const sockets = await io.in(`user:${username.toLowerCase()}`).fetchSockets().catch(() => []);
  return sockets.length > 0;
}
async function publicUserWithPresence(user) {
  return { ...publicUser(user), online: await isOnline(user.username) };
}

async function requireUser(req, res, next) {
  try {
    const token = req.header("x-chat-token");
    const user = await getUserByToken(token);
    if (!user) return res.status(401).json({ error: "Please log in again." });
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "nodechat" }));

async function sendVerificationOtp(email) {
  if (!mailer) throw new Error("Email service is not configured.");

  const otp = generateOtp();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  await verificationOtps.updateOne(
    { email },
    {
      $set: {
        email,
        otpHash: hashOtp(otp),
        expiresAt,
        attempts: 0,
        createdAt: now,
        lastSentAt: now
      }
    },
    { upsert: true }
  );

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Verify your NodeChat email",
    text: `Your NodeChat verification code is ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#24231f;max-width:520px;margin:auto">
        <h2 style="margin-bottom:8px">Verify your email</h2>
        <p>Use this code to finish creating your NodeChat account:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${otp}</div>
        <p>This code expires in 10 minutes and can only be used once.</p>
        <p>If you did not create a NodeChat account, you can ignore this email.</p>
      </div>
    `
  });
}

async function issueVerificationOtp(email) {
  if (!mailer) throw new Error("Email service is not configured.");
  const existing = await verificationOtps.findOne({ email });
  if (existing?.lastSentAt && Date.now() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt.getTime())) / 1000);
    const error = new Error("Please wait before requesting another code.");
    error.status = 429;
    error.retryAfter = retryAfter;
    throw error;
  }
  await sendVerificationOtp(email);
}

app.post("/api/auth/register", async (req, res) => {
  try {
    if (!mailer) return res.status(503).json({ error: "Email verification is not configured on the server." });

    const name = cleanDisplayName(req.body.name);
    const username = cleanUsername(req.body.username);
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (name.length < 2 || name.length > 50) return res.status(400).json({ error: "Name must be 2-50 characters." });
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Username must be 3-24 letters, numbers or underscores." });
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 120) return res.status(400).json({ error: "Enter a valid email." });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "Password must be 8-72 characters." });
    if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });

    const exists = await users.findOne({
      $or: [
        { email },
        { username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } }
      ]
    });

    if (exists) {
      if (exists.email === email && exists.emailVerified === false) {
        return res.status(409).json({ error: "This account is waiting for email verification.", code: "EMAIL_NOT_VERIFIED", email });
      }
      return res.status(409).json({ error: "Username or email is already registered." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = {
      name,
      username,
      email,
      passwordHash,
      emailVerified: false,
      createdAt: new Date(),
      lastSeenAt: new Date()
    };

    await users.insertOne(user);

    try {
      await issueVerificationOtp(email);
    } catch (mailError) {
      await users.deleteOne({ username });
      await verificationOtps.deleteOne({ email }).catch(() => {});
      throw mailError;
    }

    res.status(201).json({
      requiresVerification: true,
      email
    });
  } catch (err) {
    console.error(err);
    if (err?.status === 429) return res.status(429).json({ error: err.message, retryAfter: err.retryAfter });
    if (err?.code === 11000) return res.status(409).json({ error: "Username or email is already registered." });
    if (err?.message === "Email service is not configured.") return res.status(503).json({ error: err.message });
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();

    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "Enter the email and 6-digit verification code." });
    }

    const user = await users.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid verification request." });
    if (user.emailVerified !== false) return res.status(400).json({ error: "Email is already verified." });

    const record = await verificationOtps.findOne({ email });
    if (!record) return res.status(400).json({ error: "Code expired or not found. Request a new code." });
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await verificationOtps.deleteOne({ email });
      return res.status(400).json({ error: "Too many attempts. Request a new code." });
    }
    if (record.expiresAt <= new Date()) {
      await verificationOtps.deleteOne({ email });
      return res.status(400).json({ error: "Code expired. Request a new code." });
    }

    if (!sameSecret(hashOtp(otp), record.otpHash)) {
      await verificationOtps.updateOne({ email }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: "Invalid verification code." });
    }

    await users.updateOne({ _id: user._id }, { $set: { emailVerified: true } });
    await verificationOtps.deleteOne({ email });

    const verifiedUser = { ...user, emailVerified: true };
    const session = await createSession(user.username);

    res.json({
      user: publicUser(verifiedUser),
      token: session.token,
      expiresAt: session.expiresAt
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify email." });
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  try {
    if (!mailer) return res.status(503).json({ error: "Email verification is not configured on the server." });

    const email = cleanEmail(req.body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });

    const user = await users.findOne({ email });
    if (!user) return res.status(404).json({ error: "No account found for this email." });
    if (user.emailVerified !== false) return res.status(400).json({ error: "Email is already verified. You can sign in." });

    await issueVerificationOtp(email);
    res.json({ message: "A new verification code has been sent." });
  } catch (err) {
    console.error(err);
    if (err?.status === 429) return res.status(429).json({ error: err.message, retryAfter: err.retryAfter });
    res.status(500).json({ error: "Could not send a new verification code." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const login = String(req.body.login || "").trim();
    const password = String(req.body.password || "");
    if (!login || !password) return res.status(400).json({ error: "Enter your username/email and password." });
    const user = await users.findOne({ $or: [{ email: login.toLowerCase() }, { username: { $regex: `^${escapeRegex(login)}$`, $options: "i" } }] });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Invalid login details." });
    if (user.emailVerified === false) return res.status(403).json({ error: "Please verify your email before signing in.", code: "EMAIL_NOT_VERIFIED", email: user.email });
    const now = await setLastSeen(user.username);
    user.lastSeenAt = now;
    const session = await createSession(user.username);
    res.json({ user: publicUser(user), token: session.token, expiresAt: session.expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not log in." });
  }
});

app.post("/api/auth/logout", requireUser, async (req, res) => {
  const token = req.header("x-chat-token");
  await sessions.deleteOne({ tokenHash: hashToken(token) });
  await setLastSeen(req.user.username);
  res.json({ ok: true });
});

app.get("/api/me", requireUser, async (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/users/search", requireUser, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q || q.length > 40) return res.json({ users: [] });
  const regex = new RegExp(escapeRegex(q), "i");
  const found = await users.find({
    $and: [
      { _id: { $ne: req.user._id } },
      { $or: [{ username: { $regex: regex } }, { name: { $regex: regex } }, { displayName: { $regex: regex } }] }
    ]
  })
    .project({ _id: 0, name: 1, displayName: 1, username: 1, createdAt: 1, lastSeenAt: 1 }).limit(8).toArray();
  res.json({ users: found.map(publicUser) });
});

async function chatListFor(username) {
  const docs = await conversations.find({ members: username }).sort({ updatedAt: -1 }).limit(100).toArray();
  const result = [];
  for (const chat of docs) {
    const otherUsername = chat.members.find(x => x !== username);
    const other = await getUserByUsername(otherUsername);
    if (!other) continue;
    const last = await messages.findOne({ conversationId: chat._id }, { sort: { createdAt: -1 } });
    result.push({ conversationId: String(chat._id), user: publicUser(other), lastMessage: last?.text || "", lastMessageAt: last?.createdAt || chat.updatedAt });
  }
  return result;
}
app.get("/api/chats", requireUser, async (req, res) => res.json({ chats: await chatListFor(req.user.username) }));

async function getOrCreateChat(a, b) {
  const key = conversationKey(a, b);
  let chat = await conversations.findOne({ key });
  if (chat) return chat;
  const fresh = { key, members: [a, b].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" })), createdAt: new Date(), updatedAt: new Date() };
  try {
    const inserted = await conversations.insertOne(fresh);
    fresh._id = inserted.insertedId;
    return fresh;
  } catch (err) {
    if (err?.code === 11000) return conversations.findOne({ key });
    throw err;
  }
}

app.get("/api/chats/:otherUsername/messages", requireUser, async (req, res) => {
  const otherUsername = cleanUsername(req.params.otherUsername);
  if (!otherUsername || otherUsername.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: "You cannot chat with yourself." });
  const other = await getUserByUsername(otherUsername);
  if (!other) return res.status(404).json({ error: "User not found." });
  const chat = await conversations.findOne({ key: conversationKey(req.user.username, other.username) });
  if (!chat) return res.json({ messages: [], conversationId: null, otherUser: publicUser(other) });
  const docs = await messages.find({ conversationId: chat._id }).sort({ createdAt: -1 }).limit(100).toArray();
  docs.reverse();
  res.json({ conversationId: String(chat._id), otherUser: await publicUserWithPresence(other), messages: docs.map(m => ({ id: String(m._id), senderUsername: m.senderUsername, senderName: m.senderName || null, text: m.text, createdAt: m.createdAt })) });
});

io.use(async (socket, next) => {
  try {
    const user = await getUserByToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("Unauthorized"));
    socket.user = user;
    await setLastSeen(user.username);
    next();
  } catch (err) { next(err); }
});

io.on("connection", socket => {
  const me = socket.user.username;
  socket.join(`user:${me.toLowerCase()}`);
  socket.broadcast.emit("presence:update", { username: me, online: true });

  socket.on("chat:open", async ({ otherUsername }) => {
    try {
      otherUsername = cleanUsername(otherUsername);
      if (!otherUsername || otherUsername.toLowerCase() === me.toLowerCase()) return socket.emit("chat:error", "Invalid user.");
      const other = await getUserByUsername(otherUsername);
      if (!other) return socket.emit("chat:error", "User not found.");
      const chat = await getOrCreateChat(me, other.username);
      socket.join(`chat:${chat._id}`);
      const docs = await messages.find({ conversationId: chat._id }).sort({ createdAt: -1 }).limit(100).toArray();
      docs.reverse();
      socket.emit("chat:history", { conversationId: String(chat._id), otherUser: await publicUserWithPresence(other), messages: docs.map(m => ({ id: String(m._id), senderUsername: m.senderUsername, senderName: m.senderName || null, text: m.text, createdAt: m.createdAt })) });
    } catch (err) { console.error(err); socket.emit("chat:error", "Could not open chat."); }
  });

  socket.on("chat:send", async ({ otherUsername, text }) => {
    try {
      otherUsername = cleanUsername(otherUsername);
      text = String(text || "").trim();
      if (!otherUsername || otherUsername.toLowerCase() === me.toLowerCase() || !text || text.length > 2000) return;
      const other = await getUserByUsername(otherUsername);
      if (!other) return socket.emit("chat:error", "User not found.");
      const chat = await getOrCreateChat(me, other.username);
      const message = { conversationId: chat._id, senderUsername: me, senderName: socket.user.name || socket.user.displayName || me, text, createdAt: new Date() };
      const inserted = await messages.insertOne(message);
      message._id = inserted.insertedId;
      await conversations.updateOne({ _id: chat._id }, { $set: { updatedAt: message.createdAt } });
      const payload = { id: String(message._id), conversationId: String(chat._id), senderUsername: me, senderName: message.senderName, text, createdAt: message.createdAt };
      io.to(`chat:${chat._id}`).emit("chat:message", payload);
      io.to(`user:${other.username.toLowerCase()}`).emit("chat:updated", { conversationId: String(chat._id), fromUsername: me, fromName: message.senderName, lastMessage: text, lastMessageAt: message.createdAt });
    } catch (err) { console.error(err); socket.emit("chat:error", "Message could not be sent."); }
  });

  socket.on("chat:typing", async ({ otherUsername, isTyping }) => {
    otherUsername = cleanUsername(otherUsername);
    if (!otherUsername || otherUsername.toLowerCase() === me.toLowerCase()) return;
    const other = await getUserByUsername(otherUsername);
    if (other) io.to(`user:${other.username.toLowerCase()}`).emit("chat:typing", { fromUsername: me, isTyping: Boolean(isTyping) });
  });

  socket.on("disconnect", async () => {
    const stillConnected = await io.in(`user:${me.toLowerCase()}`).fetchSockets().catch(() => []);
    if (stillConnected.length === 0) {
      const lastSeenAt = await setLastSeen(me).catch(() => new Date());
      socket.broadcast.emit("presence:update", { username: me, online: false, lastSeenAt });
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => console.log(`1-on-1 chat running on port ${PORT}`));
