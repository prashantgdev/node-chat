const $ = (id) => document.getElementById(id);
const app = $("chatApp");

let token = localStorage.getItem("chat_token");
let me = null;
let socket = null;
let activeOtherUsername = null;
let activeConversationId = null;
let typingTimer = null;
let searchTimer = null;
let chats = [];
let registerMode = false;
let toastTimer = null;

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
    row.innerHTML = `
      <div class="avatar chat-presence ${chat.user.online ? "online" : ""}">${esc(initials(displayName(chat.user)))}</div>
      <div class="chat-info">
        <div class="chat-top">
          <div class="chat-name">${esc(displayName(chat.user))}</div>
          <span class="chat-time">${esc(time(chat.lastMessageAt))}</span>
        </div>
        <div class="chat-last">${esc(chat.lastMessage || (chat.user.online ? "Online now" : lastSeen(chat.user.lastSeenAt)))}</div>
      </div>`;
    row.addEventListener("click", () => openChat(chat.user.username));
    list.appendChild(row);
  }
}

function updateChat(username, message, at, user) {
  let chat = chats.find(
    (item) => item.user.username.toLowerCase() === username.toLowerCase(),
  );
  if (!chat) {
    chat = {
      conversationId: activeConversationId,
      user: user || { username },
      lastMessage: "",
      lastMessageAt: at,
    };
  }
  if (user) chat.user = { ...chat.user, ...user };
  if (message !== undefined) chat.lastMessage = message;
  if (at) chat.lastMessageAt = at;
  if (activeConversationId) chat.conversationId = activeConversationId;
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

function appendMessage(message, scroll = true) {
  const mine =
    message.senderUsername.toLowerCase() === me.username.toLowerCase();
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

  const item = document.createElement("div");
  item.className = `message ${mine ? "mine" : "theirs"}`;
  item.dataset.dateKey = dateKey(message.createdAt);
  item.dataset.messageId = message.id || "";
  item.innerHTML = `<div>${esc(message.text)}</div><div class="message-meta"><span>${esc(time(message.createdAt))}</span></div>`;
  messages.appendChild(item);

  if (scroll) messages.scrollTop = messages.scrollHeight;
}

function renderHistory(list) {
  const messages = $("messages");
  messages.innerHTML = "";
  if (!list.length) {
    messages.innerHTML = `<div class="messages-empty"><strong>No messages yet</strong><span>Say hello and start the conversation.</span></div>`;
    return;
  }
  list.forEach((message) => appendMessage(message, false));
  messages.scrollTop = messages.scrollHeight;
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
    activeOtherUsername = data.otherUser.username;
    activeConversationId = data.conversationId;
    $("headerName").textContent = displayName(data.otherUser);
    $("headerAvatar").textContent = initials(displayName(data.otherUser));
    showOtherPresence(data.otherUser);
    renderHistory(data.messages);
    updateChat(
      activeOtherUsername,
      data.messages.at(-1)?.text || "",
      data.messages.at(-1)?.createdAt || new Date().toISOString(),
      data.otherUser,
    );
    $("welcome").classList.add("hidden");
    $("chatView").classList.remove("hidden");
    app.classList.add("chat-open");
    updateComposer();
    $("messageInput").focus();
  });

  socket.on("chat:message", (message) => {
    const fromMe =
      message.senderUsername.toLowerCase() === me.username.toLowerCase();
    const fromActive =
      message.senderUsername.toLowerCase() ===
      activeOtherUsername?.toLowerCase();
    if (fromMe || fromActive) appendMessage(message);

    const chatUsername = fromMe ? activeOtherUsername : message.senderUsername;
    if (chatUsername)
      updateChat(
        chatUsername,
        message.text,
        message.createdAt,
        fromMe
          ? null
          : { username: message.senderUsername, name: message.senderName },
      );
    if (!fromMe && !fromActive) {
      const sender = chats.find(
        (item) =>
          item.user.username.toLowerCase() ===
          message.senderUsername.toLowerCase(),
      )?.user || { username: message.senderUsername, name: message.senderName };
      toast(`New message from ${displayName(sender)}`);
    }
  });

  socket.on("chat:updated", (data) => {
    updateChat(data.fromUsername, data.lastMessage, data.lastMessageAt, {
      username: data.fromUsername,
      name: data.fromName,
    });
    if (
      data.fromUsername.toLowerCase() !== activeOtherUsername?.toLowerCase()
    ) {
      const sender = chats.find(
        (item) =>
          item.user.username.toLowerCase() === data.fromUsername.toLowerCase(),
      )?.user || { username: data.fromUsername, name: data.fromName };
      toast(`New message from ${displayName(sender)}`);
    }
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
  $("sendBtn").disabled = !count || !activeOtherUsername || !socket?.connected;
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
$("myAvatar").addEventListener("click", openMyProfile);
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
$("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("messageInput").value.trim();
  if (!text || !activeOtherUsername || !socket?.connected) return;
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
    $("messageInput").value = "";
    updateComposer();
    sendTyping(false);
  }
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
  $("myAvatar").textContent = initials(displayName(me));
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
