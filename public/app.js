const $ = (id) => document.getElementById(id);
const app = $("chatApp");

let token = localStorage.getItem("chat_token");
let me = null;
let socket = null;
let activeOtherUsername = null;
let activeConversationId = null;
let activeMessages = [];
let typingTimer = null;
let searchTimer = null;
let chats = [];
let registerMode = false;
let toastTimer = null;
let editingMessageId = null;
let contextMessage = null;
let loadingOlder = false;
let hasMoreMessages = false;

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}

function initials(name = "User") {
  return (
    String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"
  );
}

function displayName(user) {
  return user?.name || user?.displayName || user?.username || "User";
}

function handle(user) {
  return user?.username ? `@${user.username}` : "";
}

function time(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function lastSeen(value) {
  if (!value) return "Last seen recently";
  const date = new Date(value);
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60_000) return "Last seen just now";
  if (diff < 3_600_000)
    return `Last seen ${Math.max(1, Math.floor(diff / 60_000))} min ago`;
  if (diff < 86_400_000) return `Last seen today at ${time(value)}`;
  return `Last seen ${date.toLocaleDateString([], { day: "numeric", month: "short" })} at ${time(value)}`;
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function authError(message) {
  $("authError").textContent = message || "";
}

function setAuthMode(register) {
  registerMode = register;
  $("loginTab").classList.toggle("active", !register);
  $("registerTab").classList.toggle("active", register);
  $("loginTab").setAttribute("aria-selected", String(!register));
  $("registerTab").setAttribute("aria-selected", String(register));
  $("nameLabel").classList.toggle("hidden", !register);
  $("usernameLabel").classList.toggle("hidden", !register);
  $("confirmPasswordLabel").classList.toggle("hidden", !register);
  $("loginLabel").textContent = register ? "Email" : "Email or username";
  $("login").placeholder = register
    ? "you@example.com"
    : "you@example.com or username";
  $("authSubmit").innerHTML = register
    ? '<span>Create account</span><span aria-hidden="true">→</span>'
    : '<span>Sign in</span><span aria-hidden="true">→</span>';
  $("password").autocomplete = register ? "new-password" : "current-password";
  $("authEyebrow").textContent = register ? "Start fresh" : "Welcome back";
  $("authTitle").textContent = register ? "Create your account" : "Sign in";
  $("authDescription").textContent = register
    ? "Create your account, then verify your email."
    : "Continue your conversations.";
  authError("");
}

function showVerification(email) {
  $("authForm").classList.add("hidden");
  $("verificationForm").classList.remove("hidden");
  $("loginTab").disabled = true;
  $("registerTab").disabled = true;
  $("authEyebrow").textContent = "One more step";
  $("authTitle").textContent = "Verify your email";
  $("authDescription").textContent =
    "Enter the 6-digit code we sent you to finish creating your account.";
  $("verificationEmail").textContent = `Code sent to ${email}`;
  $("verificationForm").dataset.email = email;
  $("verificationCode").value = "";
  $("verificationCode").focus();
  $("verificationError").textContent = "";
}

function hideVerification() {
  $("verificationForm").classList.add("hidden");
  $("authForm").classList.remove("hidden");
  $("loginTab").disabled = false;
  $("registerTab").disabled = false;
  setAuthMode(registerMode);
}

function verificationError(message, type = "error") {
  const el = $("verificationError");
  el.textContent = message || "";
  el.className = `form-error ${type === "success" ? "form-success" : ""}`;
}

async function auth(event) {
  event.preventDefault();
  authError("");
  const submit = $("authSubmit");
  submit.disabled = true;
  try {
    if (registerMode) {
      const name = $("name").value.trim();
      const username = $("username").value.trim();
      const email = $("login").value.trim();
      const password = $("password").value;
      const confirmPassword = $("confirmPassword").value;

      if (password !== confirmPassword) {
        authError("Passwords do not match.");
        return;
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          username,
          email,
          password,
          confirmPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED" && data.email) {
          showVerification(data.email);
          verificationError(
            "This account already needs email verification. Enter the code or request a new one.",
          );
          return;
        }
        authError(data.error || "Something went wrong. Please try again.");
        return;
      }

      showVerification(data.email || email.toLowerCase());
      return;
    }

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: $("login").value.trim(),
        password: $("password").value,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (data.code === "EMAIL_NOT_VERIFIED" && data.email) {
        showVerification(data.email);
        verificationError("Please verify your email before signing in.");
        return;
      }
      authError(data.error || "Something went wrong. Please try again.");
      return;
    }

    token = data.token;
    localStorage.setItem("chat_token", token);
    await bootApp(data.user);
  } catch {
    authError("Could not connect. Check your connection and try again.");
  } finally {
    submit.disabled = false;
  }
}

async function verifyEmail(event) {
  event.preventDefault();
  verificationError("");

  const email = $("verificationForm").dataset.email;
  const otp = $("verificationCode").value.trim();
  const submit = $("verifySubmit");

  if (!/^\d{6}$/.test(otp)) {
    verificationError("Enter the 6-digit verification code.");
    return;
  }

  submit.disabled = true;
  submit.querySelector("span").textContent = "Verifying…";

  try {
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      verificationError(data.error || "Could not verify your email.");
      return;
    }

    token = data.token;
    localStorage.setItem("chat_token", token);
    await bootApp(data.user);
  } catch {
    verificationError(
      "Could not connect. Check your connection and try again.",
    );
  } finally {
    submit.disabled = false;
    submit.querySelector("span").textContent = "Verify email";
  }
}

async function resendVerification() {
  const email = $("verificationForm").dataset.email;
  if (!email) return;

  const button = $("resendVerification");
  button.disabled = true;
  verificationError("");

  try {
    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      verificationError(data.error || "Could not resend the code.");
      return;
    }

    verificationError(data.message || "A new code has been sent.", "success");
  } catch {
    verificationError(
      "Could not connect. Check your connection and try again.",
    );
  } finally {
    button.disabled = false;
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}), "x-chat-token": token };
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem("chat_token");
    token = null;
    if (socket) socket.disconnect();
    location.reload();
  }
  return response;
}

function formatMemberSince(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function setProfilePanel(panel, open) {
  const backdrop = $("profileBackdrop");
  panel.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  const anyOpen =
    $("myProfilePanel").classList.contains("open") ||
    $("contactProfilePanel").classList.contains("open");
  backdrop.classList.toggle("hidden", !anyOpen);
  backdrop.setAttribute("aria-hidden", anyOpen ? "false" : "true");
}

function openMyProfile() {
  if (!me) return;

  $("profileAvatar").textContent = initials(displayName(me));
  $("profileName").textContent = displayName(me);
  $("profileUsername").textContent = handle(me);
  $("profileNameValue").textContent = displayName(me);
  $("profileUsernameValue").textContent = handle(me);
  $("profileEmailValue").textContent = me.email || "—";

  $("profileShowEmail").checked = me.showEmail === true;

  $("profileJoinedValue").textContent = formatMemberSince(me.createdAt);

  setProfilePanel($("contactProfilePanel"), false);
  setProfilePanel($("myProfilePanel"), true);
}

function openContactProfile() {
  if (!activeOtherUsername) return;

  const chat = chats.find(
    (item) =>
      item.user.username.toLowerCase() === activeOtherUsername.toLowerCase(),
  );

  const user = chat?.user || {
    username: activeOtherUsername,
    name: $("headerName").textContent,
  };

  $("contactProfileAvatar").textContent = initials(displayName(user));
  $("contactProfileName").textContent = displayName(user);
  $("contactProfileUsername").textContent = handle(user);

  $("contactProfileUsernameValue").textContent = handle(user);

  const emailSection = $("contactProfileEmailSection");

  if (user.email) {
    $("contactProfileEmailValue").textContent = user.email;
    emailSection.classList.remove("hidden");
  } else {
    $("contactProfileEmailValue").textContent = "—";
    emailSection.classList.add("hidden");
  }

  $("contactProfileStatus").textContent = user.online
    ? "Online now"
    : lastSeen(user.lastSeenAt);

  $("contactProfileJoinedValue").textContent = formatMemberSince(
    user.createdAt,
  );

  setProfilePanel($("myProfilePanel"), false);
  setProfilePanel($("contactProfilePanel"), true);
}

function closeProfiles() {
  setProfilePanel($("myProfilePanel"), false);
  setProfilePanel($("contactProfilePanel"), false);
}

function renderChats() {
  const list = $("chatList");
  list.innerHTML = "";
  $("emptyChats").classList.toggle("hidden", chats.length > 0);
  $("chatCount").textContent = chats.length;

  for (const chat of chats) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `chat-row ${chat.user.username.toLowerCase() === activeOtherUsername?.toLowerCase() ? "active" : ""}`;
    row.setAttribute("role", "listitem");
    const unread = Number(chat.unreadCount || 0);
    row.innerHTML = `
      <div class="avatar chat-presence ${chat.user.online ? "online" : ""}">${esc(initials(displayName(chat.user)))}</div>
      <div class="chat-info">
        <div class="chat-top">
          <div class="chat-name">${esc(displayName(chat.user))}</div>
          <span class="chat-time">${esc(time(chat.lastMessageAt))}</span>
        </div>
        <div class="chat-last">${esc(chat.lastMessage || (chat.user.online ? "Online now" : lastSeen(chat.user.lastSeenAt)))}</div>
      </div>
      ${unread ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>` : ""}`;
    row.addEventListener("click", () => openChat(chat.user.username));
    list.appendChild(row);
  }
}

function updateChat(username, message, at, user, unreadDelta = 0) {
  let chat = chats.find(
    (item) => item.user.username.toLowerCase() === username.toLowerCase(),
  );
  if (!chat) {
    chat = {
      conversationId: activeConversationId,
      user: user || { username },
      lastMessage: "",
      lastMessageAt: at,
      unreadCount: 0,
    };
  }
  if (user) chat.user = { ...chat.user, ...user };
  if (message !== undefined) chat.lastMessage = message;
  if (at) chat.lastMessageAt = at;
  if (activeConversationId) chat.conversationId = activeConversationId;
  chat.unreadCount = Math.max(0, Number(chat.unreadCount || 0) + unreadDelta);
  chats = chats.filter((item) => item !== chat);
  chats.unshift(chat);
  renderChats();
}

async function loadChats() {
  const response = await api("/api/chats");
  if (!response.ok) throw new Error("Could not load conversations.");
  const data = await response.json();
  chats = data.chats || [];
  renderChats();
}

function findMessageById(messageId) {
  return activeMessages.find(
    (message) => String(message.id) === String(messageId),
  );
}

function hideMessageContextMenu() {
  const menu = $("messageContextMenu");
  if (!menu) return;
  menu.classList.add("hidden");
  contextMessage = null;
}

function positionMessageContextMenu(event, menu) {
  const padding = 8;
  const rect = menu.getBoundingClientRect();
  let x = event.clientX;
  let y = event.clientY;

  if (x + rect.width > window.innerWidth - padding) {
    x = window.innerWidth - rect.width - padding;
  }
  if (y + rect.height > window.innerHeight - padding) {
    y = window.innerHeight - rect.height - padding;
  }

  menu.style.left = `${Math.max(padding, x)}px`;
  menu.style.top = `${Math.max(padding, y)}px`;
}

function openMessageContextMenu(event, message) {
  const menu = $("messageContextMenu");
  if (!menu) return;

  contextMessage = message;

  const mine =
    message.senderUsername.toLowerCase() === me.username.toLowerCase();

  $("contextEditBtn")?.classList.toggle("hidden", !mine);
  $("contextDeleteBtn")?.classList.toggle("hidden", !mine);

  menu.classList.remove("hidden");
  positionMessageContextMenu(event, menu);
}

async function copyMessage(message) {
  const msgText = message.text || "";

  try {
    await navigator.clipboard.writeText(msgText);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = msgText;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";

    document.body.appendChild(textarea);

    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  toast("Message copied");
}

function deleteMessage(message) {
  if (!socket?.connected || !message?.id) return;
  // if (!confirm("Delete this message permanently?")) return;
  socket.emit("chat:delete", { messageId: message.id });
}

function beginMessageEdit(message) {
  const input = $("messageInput");
  input.value = message.text || "";
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  editingMessageId = message.id;
  updateComposer();
  $("sendBtn").querySelector("span").textContent = "Save";
}

function cancelMessageEdit() {
  editingMessageId = null;
  $("messageInput").value = "";

  updateComposer();
}

function messageStatus(message) {
  if (message.senderUsername.toLowerCase() !== me.username.toLowerCase())
    return "";
  const other = activeOtherUsername?.toLowerCase();
  const read = (message.readBy || []).some(
    (name) => name.toLowerCase() === other,
  );
  const delivered =
    message.delivered ||
    (message.deliveredTo || []).some((name) => name.toLowerCase() === other);
  return read ? "read" : delivered ? "delivered" : "sent";
}

function createMessageElement(message) {
  const mine =
    message.senderUsername.toLowerCase() === me.username.toLowerCase();
  const item = document.createElement("div");
  item.className = `message ${mine ? "mine" : "theirs"}`;
  item.dataset.dateKey = dateKey(message.createdAt);
  item.dataset.messageId = message.id || "";
  item.dataset.createdAt = message.createdAt || "";
  item.innerHTML = `
    <div class="message-body">${esc(message.text)}</div>
    <div class="message-meta">
      <span>${esc(time(message.createdAt))}${message.editedAt ? " · edited" : ""}</span>
      ${mine ? `<span class="message-status ${messageStatus(message)}">${messageStatus(message) === "sent" ? "✓" : "✓✓"}</span>` : ""}
    </div>`;
  return item;
}

function appendMessage(message, scroll = true) {
  $("messages").querySelector(".messages-empty")?.remove();

  const messages = $("messages");
  const previous = messages.querySelector(".message:last-of-type");
  const needsDivider =
    !previous || previous.dataset.dateKey !== dateKey(message.createdAt);

  if (needsDivider) {
    const divider = document.createElement("div");
    divider.className = "day-divider";
    divider.dataset.dateKey = dateKey(message.createdAt);
    divider.innerHTML = `<span>${esc(dateLabel(message.createdAt))}</span>`;
    messages.appendChild(divider);
  }

  const item = createMessageElement(message);
  messages.appendChild(item);

  if (scroll) messages.scrollTop = messages.scrollHeight;

  if (
    message.senderUsername.toLowerCase() !== me.username.toLowerCase() &&
    message.id &&
    socket?.connected
  ) {
    socket.emit("chat:delivered", { messageId: message.id });
  }
}

function renderHistory(list, more = false) {
  const messages = $("messages");
  messages.innerHTML = "";
  hasMoreMessages = Boolean(more);
  if (!list.length) {
    messages.innerHTML = `<div class="messages-empty"><strong>No messages yet</strong><span>Say hello and start the conversation.</span></div>`;
    return;
  }
  list.forEach((message) => appendMessage(message, false));
  messages.scrollTop = messages.scrollHeight;
  if (activeConversationId && socket?.connected)
    socket.emit("chat:read", { conversationId: activeConversationId });

  updateEmptyMessagesState();
}

function updateEmptyMessagesState() {
  const messages = $("messages");

  const hasMessages = messages.querySelector(".message");

  let emptyState = messages.querySelector(".messages-empty");

  if (!hasMessages) {
    if (!emptyState) {
      messages.innerHTML = `<div class="messages-empty"><strong>No messages yet</strong><span>Say hello and start the conversation.</span></div>`;
    }
  } else {
    emptyState?.remove();
  }
}

function replaceMessage(message) {
  const old = $("messages").querySelector(
    `[data-message-id="${CSS.escape(message.id)}"]`,
  );
  if (!old) return;
  const next = createMessageElement(message);
  old.replaceWith(next);
}

async function loadOlderMessages() {
  if (
    loadingOlder ||
    !hasMoreMessages ||
    !activeConversationId ||
    !socket?.connected
  )
    return;
  const first = $("messages").querySelector(".message");
  if (!first) return;
  loadingOlder = true;
  socket.emit("chat:older", {
    conversationId: activeConversationId,
    before:
      first.dataset.createdAt ||
      first.querySelector(".message-meta")?.dataset.createdAt,
  });
}

function showOtherPresence(user) {
  const typing = $("typingText");
  typing.dataset.lastSeen = user.lastSeenAt || "";
  typing.dataset.online = user.online ? "1" : "0";
  typing.textContent = user.online ? "Online now" : lastSeen(user.lastSeenAt);
}

function setConnectionState(connected) {
  const state = $("connectionState");
  state.classList.toggle("offline", !connected);
  state.innerHTML = `<span class="connection-dot"></span><span>${connected ? "Connected" : "Reconnecting…"}</span>`;
}

function connect() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });

  socket.on("connect", () => setConnectionState(true));
  socket.on("disconnect", () => setConnectionState(false));
  socket.on("connect_error", (error) => {
    setConnectionState(false);
    if (error.message === "Unauthorized") {
      localStorage.removeItem("chat_token");
      location.reload();
      return;
    }
    toast("Connection interrupted. Retrying…");
  });
  socket.on("chat:error", toast);

  socket.on("chat:history", (data) => {
    activeMessages = data.messages || [];
    activeOtherUsername = data.otherUser.username;
    activeConversationId = data.conversationId;
    hasMoreMessages = Boolean(data.hasMore);
    $("headerName").textContent = displayName(data.otherUser);
    $("headerAvatar").textContent = initials(displayName(data.otherUser));
    showOtherPresence(data.otherUser);
    renderHistory(data.messages, data.hasMore);
    const current = chats.find(
      (item) =>
        item.user.username.toLowerCase() === activeOtherUsername.toLowerCase(),
    );
    if (current) current.unreadCount = 0;
    updateChat(
      activeOtherUsername,
      data.messages.at(-1)?.text || "",
      data.messages.at(-1)?.createdAt || new Date().toISOString(),
      data.otherUser,
    );
    if (activeConversationId)
      socket.emit("chat:read", { conversationId: activeConversationId });
    $("welcome").classList.add("hidden");
    $("chatView").classList.remove("hidden");
    app.classList.add("chat-open");
    updateComposer();
    $("messageInput").focus();
  });

  socket.on("chat:older", (data) => {
    const messages = $("messages");
    const previousHeight = messages.scrollHeight;
    const previousTop = messages.scrollTop;
    const fragment = document.createDocumentFragment();
    const currentFirst = messages.querySelector(".message");
    const existing = Array.from(messages.querySelectorAll(".message")).map(
      (el) => el.dataset.messageId,
    );
    for (const message of data.messages || []) {
      if (existing.includes(message.id)) continue;
      const item = createMessageElement(message);
      fragment.appendChild(item);
    }
    messages.insertBefore(fragment, currentFirst || messages.firstChild);
    hasMoreMessages = Boolean(data.hasMore);
    messages.scrollTop = previousTop + (messages.scrollHeight - previousHeight);
    loadingOlder = false;
  });

  socket.on("chat:message", (message) => {
    if (!activeMessages.some((item) => item.id === message.id))
      activeMessages.push(message);
    const fromMe =
      message.senderUsername.toLowerCase() === me.username.toLowerCase();
    const fromActive =
      message.senderUsername.toLowerCase() ===
      activeOtherUsername?.toLowerCase();
    if (fromMe || fromActive) appendMessage(message);

    const chatUsername = fromMe ? activeOtherUsername : message.senderUsername;
    if (chatUsername) {
      updateChat(
        chatUsername,
        message.text,
        message.createdAt,
        fromMe
          ? null
          : { username: message.senderUsername, name: message.senderName },
        0,
      );
    }
    if (!fromMe && !fromActive) {
      const sender = chats.find(
        (item) =>
          item.user.username.toLowerCase() ===
          message.senderUsername.toLowerCase(),
      )?.user || { username: message.senderUsername, name: message.senderName };
      toast(`New message from ${displayName(sender)}`);
    }
    if (!fromMe && fromActive && activeConversationId) {
      socket.emit("chat:read", { conversationId: activeConversationId });
    }
  });

  socket.on("chat:updated", (data) => {
    const isActive =
      data.fromUsername.toLowerCase() === activeOtherUsername?.toLowerCase();
    updateChat(
      data.fromUsername,
      data.lastMessage,
      data.lastMessageAt,
      { username: data.fromUsername, name: data.fromName },
      0,
    );
    const updatedChat = chats.find(
      (item) =>
        item.user.username.toLowerCase() === data.fromUsername.toLowerCase(),
    );
    if (updatedChat) {
      updatedChat.unreadCount = isActive ? 0 : Number(data.unreadCount || 0);
      renderChats();
    }
    if (!isActive) {
      const sender = chats.find(
        (item) =>
          item.user.username.toLowerCase() === data.fromUsername.toLowerCase(),
      )?.user || { username: data.fromUsername, name: data.fromName };
      toast(`New message from ${displayName(sender)}`);
    }
  });

  // socket.on("chat:status", (data) => {
  //   const item = $("messages").querySelector(
  //     `[data-message-id="${CSS.escape(data.messageId)}"]`,
  //   );
  //   if (item) {
  //     item.querySelector(".message-status").textContent = data.delivered
  //       ? "Delivered"
  //       : "Sent";
  //   }
  // });

  socket.on("chat:status", (data) => {
    const item = $("messages").querySelector(
      `[data-message-id="${CSS.escape(data.messageId)}"]`,
    );

    if (!item) return;

    const status = item.querySelector(".message-status");

    if (!status) return;

    status.classList.remove("sent", "delivered", "read");

    if (data.delivered) {
      status.textContent = "✓✓";
      status.classList.add("delivered");
    } else {
      status.textContent = "✓";
      status.classList.add("sent");
    }
  });

  socket.on("chat:read", (data) => {
    if (data.conversationId !== activeConversationId) return;

    document.querySelectorAll(".message.mine .message-status").forEach((el) => {
      el.textContent = "✓✓";
      el.classList.remove("sent", "delivered");
      el.classList.add("read");
    });
  });

  socket.on("chat:message:update", (message) => {
    const index = activeMessages.findIndex(
      (item) => String(item.id) === String(message.id),
    );

    if (index !== -1) {
      activeMessages[index] = message;
    }

    replaceMessage(message);
    const chat = chats.find(
      (item) => item.conversationId === message.conversationId,
    );

    if (
      chat &&
      message.senderUsername.toLowerCase() === me.username.toLowerCase()
    ) {
      chat.lastMessage = message.text;
      chat.lastMessageAt = message.createdAt;
      renderChats();
    }
  });

  socket.on("chat:message:deleted", (data) => {
    const messageElement = document.querySelector(
      `[data-message-id="${data.messageId}"]`,
    );

    if (!messageElement) return;

    messageElement.remove();

    activeMessages = activeMessages.filter(
      (message) => String(message.id) !== String(data.messageId),
    );

    document.querySelectorAll(".day-divider").forEach((divider) => {
      const next = divider.nextElementSibling;

      if (!next || !next.classList.contains("message")) {
        divider.remove();
      }
    });

    updateEmptyMessagesState();
  });

  socket.on("presence:update", (data) => {
    const chat = chats.find(
      (item) =>
        item.user.username.toLowerCase() === data.username.toLowerCase(),
    );
    if (chat) {
      chat.user.online = Boolean(data.online);
      if (data.lastSeenAt) chat.user.lastSeenAt = data.lastSeenAt;
      renderChats();
    }
    if (data.username.toLowerCase() === activeOtherUsername?.toLowerCase()) {
      const typing = $("typingText");
      typing.dataset.online = data.online ? "1" : "0";
      if (data.lastSeenAt) typing.dataset.lastSeen = data.lastSeenAt;
      typing.textContent = data.online
        ? "Online now"
        : lastSeen(typing.dataset.lastSeen);
    }
  });

  socket.on("chat:typing", (data) => {
    if (data.fromUsername.toLowerCase() !== activeOtherUsername?.toLowerCase())
      return;
    const typing = $("typingText");
    typing.textContent = data.isTyping
      ? "Typing…"
      : typing.dataset.online === "1"
        ? "Online now"
        : typing.dataset.lastSeen
          ? lastSeen(typing.dataset.lastSeen)
          : "Private conversation";
  });
}

function openChat(username) {
  if (!socket || !socket.connected) {
    toast("Still connecting. Please try again in a moment.");
    return;
  }
  activeOtherUsername = username;
  activeConversationId = null;
  const selected = chats.find(
    (item) => item.user.username.toLowerCase() === username.toLowerCase(),
  );
  if (selected) selected.unreadCount = 0;
  $("messages").innerHTML = `<div class="loading">Loading conversation…</div>`;
  const chatUser = chats.find(
    (item) => item.user.username.toLowerCase() === username.toLowerCase(),
  )?.user;
  $("headerName").textContent = displayName(chatUser || { username });
  $("headerAvatar").textContent = initials(
    displayName(chatUser || { username }),
  );
  $("typingText").textContent = "Private conversation";
  $("welcome").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  app.classList.add("chat-open");
  renderChats();
  socket.emit("chat:open", { otherUsername: username });
}

async function search() {
  const query = $("searchInput").value.trim();
  const result = $("searchResult");
  result.classList.add("hidden");
  if (!query) return;

  try {
    const response = await api(
      `/api/users/search?q=${encodeURIComponent(query)}`,
    );
    if (!response.ok) return;
    const data = await response.json();
    if (!data.users?.length) {
      result.innerHTML = `<div class="search-empty">No person found for <strong>${esc(query)}</strong>.</div>`;
      result.classList.remove("hidden");
      return;
    }
    result.innerHTML = data.users
      .map(
        (user) => `
      <button class="search-user" type="button" data-username="${esc(user.username)}">
        <div class="avatar">${esc(initials(displayName(user)))}</div>
        <div><strong>${esc(displayName(user))}</strong><small>${esc(handle(user))} · ${esc(user.online ? "Online now" : lastSeen(user.lastSeenAt))}</small></div>
      </button>`,
      )
      .join("");
    result.classList.remove("hidden");
    result.querySelectorAll(".search-user").forEach((button) =>
      button.addEventListener("click", () => {
        openChat(button.dataset.username);
        result.classList.add("hidden");
        $("searchInput").value = "";
      }),
    );
  } catch {
    toast("Search is unavailable right now.");
  }
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  const query = $("searchInput").value.trim();
  if (!query) {
    $("searchResult").classList.add("hidden");
    return;
  }
  searchTimer = setTimeout(search, 240);
}

function updateComposer() {
  const input = $("messageInput");
  const count = input.value.length;
  $("messageCount").textContent = `${count} / 2000`;

  const editing = Boolean(editingMessageId);
  $("sendBtn").disabled =
    !count || (!editing && !activeOtherUsername) || !socket?.connected;
  $("sendBtn").querySelector("span:first-child").textContent = editing
    ? "Save"
    : "Send";

  const cancel = $("cancelEditBtn");
  if (cancel) cancel.classList.toggle("hidden", !editing);
}

function sendTyping(isTyping) {
  if (!activeOtherUsername || !socket?.connected) return;
  socket.emit("chat:typing", { otherUsername: activeOtherUsername, isTyping });
}

function openSearchSection() {
  const el = document.querySelector(".search-section");

  el.style.display =
    el.style.display === "none" || el.style.display === "" ? "block" : "none";

  if (el.style.display === "block") {
    $("searchInput").focus();
  }
}

$("profileShowEmail").addEventListener("change", async () => {
  const checkbox = $("profileShowEmail");
  const previousValue = !checkbox.checked;

  checkbox.disabled = true;

  try {
    const response = await api("/api/me/email-visibility", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        showEmail: checkbox.checked,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not update email visibility.");
    }

    me = data.user;

    toast(
      me.showEmail
        ? "Your email is now visible to others."
        : "Your email is now hidden from others.",
    );
  } catch (error) {
    checkbox.checked = previousValue;
    toast(error.message || "Could not update email visibility.");
  } finally {
    checkbox.disabled = false;
  }
});
$("authForm").addEventListener("submit", auth);
$("verificationForm").addEventListener("submit", verifyEmail);
$("resendVerification").addEventListener("click", resendVerification);
$("changeVerificationEmail").addEventListener("click", hideVerification);
$("loginTab").addEventListener("click", () => setAuthMode(false));
$("registerTab").addEventListener("click", () => setAuthMode(true));
$("searchInput").addEventListener("input", scheduleSearch);
$("searchInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    clearTimeout(searchTimer);
    search();
  }
  if (event.key === "Escape") {
    $("searchResult").classList.add("hidden");
    $("searchInput").blur();
  }
});
$("newChatBtn").addEventListener("click", () => openSearchSection());
$("emptyNewChat").addEventListener("click", () => openSearchSection());
$("myUsername").addEventListener("click", openMyProfile);
$("logo").addEventListener("click", openMyProfile);
$("closeMyProfile").addEventListener("click", closeProfiles);
$("closeContactProfile").addEventListener("click", closeProfiles);
$("profileBackdrop").addEventListener("click", closeProfiles);
$("headerAvatar").addEventListener("click", openContactProfile);
$("headerName").addEventListener("click", openContactProfile);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfiles();
});
$("backBtn").addEventListener("click", () => {
  app.classList.remove("chat-open");
  activeOtherUsername = null;
  activeConversationId = null;
  renderChats();
});
$("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  if (socket) socket.disconnect();
  localStorage.removeItem("chat_token");
  token = null;
  location.reload();
});

const messageContextMenu = $("messageContextMenu");

if (messageContextMenu) {
  $("messages").addEventListener("contextmenu", (event) => {
    const messageElement = event.target.closest(".message");
    if (!messageElement) return hideMessageContextMenu();

    event.preventDefault();

    const message = findMessageById(messageElement.dataset.messageId);
    if (message) openMessageContextMenu(event, message);
  });

  messageContextMenu.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || !contextMessage) return;

    const action = button.dataset.action;
    const message = contextMessage;
    hideMessageContextMenu();

    if (action === "copy") await copyMessage(message);
    if (action === "reply") toast("Reply feature coming soon");

    if (
      action === "edit" &&
      message.senderUsername.toLowerCase() === me.username.toLowerCase()
    ) {
      beginMessageEdit(message);
    }

    if (
      action === "delete" &&
      message.senderUsername.toLowerCase() === me.username.toLowerCase()
    ) {
      deleteMessage(message);
    }
  });
}

$("cancelEditBtn").addEventListener("click", cancelMessageEdit);

document.addEventListener("click", (event) => {
  if (!event.target.closest("#messageContextMenu")) hideMessageContextMenu();
});

$("messages").addEventListener("scroll", hideMessageContextMenu);
window.addEventListener("resize", hideMessageContextMenu);

$("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("messageInput").value.trim();
  if (!text || !socket?.connected) return;

  if (editingMessageId) {
    socket.emit("chat:edit", { messageId: editingMessageId, text });
    editingMessageId = null;
    $("messageInput").value = "";
    updateComposer();
    return;
  }

  if (!activeOtherUsername) return;
  socket.emit("chat:send", { otherUsername: activeOtherUsername, text });
  $("messageInput").value = "";
  updateComposer();
  sendTyping(false);
});
$("messageInput").addEventListener("input", () => {
  updateComposer();
  sendTyping($("messageInput").value.length > 0);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => sendTyping(false), 900);
});
$("messageInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (editingMessageId) {
      cancelMessageEdit();
    } else {
      $("messageInput").value = "";
      updateComposer();
      sendTyping(false);
    }
  }
});

$("messages").addEventListener("scroll", () => {
  if ($("messages").scrollTop <= 40) loadOlderMessages();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-section"))
    $("searchResult").classList.add("hidden");
});

async function bootApp(user) {
  me = user;
  $("authScreen").classList.add("hidden");
  app.classList.remove("hidden");
  $("myUsername").textContent = displayName(me);
  try {
    await loadChats();
    connect();
  } catch {
    toast("Could not load conversations. Retrying…");
    connect();
  }
}

(async () => {
  if (!token) return;
  try {
    const response = await api("/api/me");
    if (!response.ok) throw new Error("Session expired");
    const data = await response.json();
    await bootApp(data.user);
  } catch {
    localStorage.removeItem("chat_token");
    token = null;
  }
})();
