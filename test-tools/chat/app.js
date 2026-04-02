const ROOM_ID = "global";

const elements = {
  baseUrl: document.querySelector("#chat-base-url"),
  feedTopic: document.querySelector("#feed-topic"),
  feedToken: document.querySelector("#feed-token"),
  serviceStatus: document.querySelector("#service-status"),
  feedStatus: document.querySelector("#feed-status"),
  connectAll: document.querySelector("#connect-all"),
  disconnectAll: document.querySelector("#disconnect-all"),
  refreshAll: document.querySelector("#refresh-all"),
  feedList: document.querySelector("#feed-events"),
  feedForm: document.querySelector("#feed-form"),
  feedKind: document.querySelector("#feed-kind"),
  feedTitle: document.querySelector("#feed-title"),
  feedBody: document.querySelector("#feed-body"),
  panes: {
    a: {
      status: document.querySelector("#pane-a-status"),
      token: document.querySelector("#pane-a-token"),
      body: document.querySelector("#pane-a-body"),
      list: document.querySelector("#pane-a-messages"),
      form: document.querySelector("#pane-a-form"),
    },
    b: {
      status: document.querySelector("#pane-b-status"),
      token: document.querySelector("#pane-b-token"),
      body: document.querySelector("#pane-b-body"),
      list: document.querySelector("#pane-b-messages"),
      form: document.querySelector("#pane-b-form"),
    },
  },
};

const state = {
  roomMessages: [],
  feedEvents: [],
  roomSource: null,
  feedSource: null,
  healthTimer: null,
};

function setStatus(node, tone, text) {
  node.className = `status-chip ${tone}`;
  node.textContent = text;
}

function normalizeBaseUrl() {
  return elements.baseUrl.value.trim().replace(/\/+$/, "");
}

function getFeedTopic() {
  return elements.feedTopic.value.trim() || "lobby";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "unknown";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

function renderMessageList(target, items, emptyText, authorKey) {
  if (!items.length) {
    target.innerHTML = `<li class="empty">${escapeHtml(emptyText)}</li>`;
    return;
  }

  target.innerHTML = items
    .map(
      (item) => `
        <li>
          <div class="message-meta">
            <span class="message-author">${escapeHtml(item[authorKey])}</span>
            <span>${escapeHtml(formatTimestamp(item.createdAt))}</span>
          </div>
          <p>${escapeHtml(item.body)}</p>
        </li>
      `,
    )
    .join("");
}

function renderRoomMessages() {
  renderMessageList(elements.panes.a.list, state.roomMessages, "No chat messages yet.", "username");
  renderMessageList(elements.panes.b.list, state.roomMessages, "No chat messages yet.", "username");
}

function renderFeedEvents() {
  renderMessageList(elements.feedList, state.feedEvents, "No feed events yet.", "title");
}

async function fetchJson(path, init = {}) {
  const response = await fetch(`${normalizeBaseUrl()}${path}`, init);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { response, json };
}

async function refreshHealth() {
  try {
    const { response } = await fetchJson("/health");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    setStatus(elements.serviceStatus, "ok", "Healthy");
  } catch (error) {
    setStatus(elements.serviceStatus, "error", "Unavailable");
    setStatus(elements.feedStatus, "error", "Degraded");
    for (const pane of Object.values(elements.panes)) {
      setStatus(pane.status, "error", "Degraded");
    }
    console.error(error);
  }
}

async function loadHistories() {
  const roomResult = await fetchJson(`/rooms/${ROOM_ID}/messages`);
  if (roomResult.response.ok) {
    state.roomMessages = roomResult.json?.messages ?? [];
    renderRoomMessages();
  } else {
    state.roomMessages = [];
    renderRoomMessages();
    setStatus(elements.serviceStatus, "warn", `Room ${roomResult.response.status}`);
  }

  const feedResult = await fetchJson(`/feeds/${encodeURIComponent(getFeedTopic())}/events`);
  if (feedResult.response.ok) {
    state.feedEvents = feedResult.json?.events ?? [];
    renderFeedEvents();
  } else {
    state.feedEvents = [];
    renderFeedEvents();
    setStatus(elements.feedStatus, "warn", `Feed ${feedResult.response.status}`);
  }
}

function closeSources() {
  state.roomSource?.close();
  state.feedSource?.close();
  state.roomSource = null;
  state.feedSource = null;
  clearInterval(state.healthTimer);
  state.healthTimer = null;
}

function connectStreams() {
  closeSources();
  const baseUrl = normalizeBaseUrl();
  const feedTopic = encodeURIComponent(getFeedTopic());

  state.roomSource = new EventSource(`${baseUrl}/rooms/${ROOM_ID}/stream`);
  state.feedSource = new EventSource(`${baseUrl}/feeds/${feedTopic}/stream`);

  state.roomSource.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    state.roomMessages = [...state.roomMessages.filter((item) => item.id !== payload.id), payload];
    renderRoomMessages();
    setStatus(elements.panes.a.status, "ok", "Streaming");
    setStatus(elements.panes.b.status, "ok", "Streaming");
  });

  state.feedSource.addEventListener("feed", (event) => {
    const payload = JSON.parse(event.data);
    state.feedEvents = [...state.feedEvents.filter((item) => item.id !== payload.id), payload];
    renderFeedEvents();
    setStatus(elements.feedStatus, "ok", "Streaming");
  });

  state.roomSource.onerror = () => {
    setStatus(elements.panes.a.status, "error", "Stream down");
    setStatus(elements.panes.b.status, "error", "Stream down");
  };

  state.feedSource.onerror = () => {
    setStatus(elements.feedStatus, "error", "Stream down");
  };

  state.healthTimer = setInterval(refreshHealth, 10_000);
  void refreshHealth();
  void loadHistories();
}

async function sendMessage(paneKey) {
  const pane = elements.panes[paneKey];
  const token = pane.token.value.trim();
  const body = pane.body.value.trim();

  if (!token) {
    setStatus(pane.status, "warn", "Token required");
    return;
  }

  if (!body) {
    setStatus(pane.status, "warn", "Message required");
    return;
  }

  setStatus(pane.status, "neutral", "Sending");

  const { response, json } = await fetchJson(`/rooms/${ROOM_ID}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    setStatus(pane.status, "error", json?.error ?? `HTTP ${response.status}`);
    return;
  }

  pane.body.value = "";
  setStatus(pane.status, "ok", "Sent");
}

async function publishFeedEvent(event) {
  event.preventDefault();

  const token = elements.feedToken.value.trim();
  if (!token) {
    setStatus(elements.feedStatus, "warn", "Feed token required");
    return;
  }

  setStatus(elements.feedStatus, "neutral", "Publishing");

  const { response, json } = await fetchJson(
    `/internal/feeds/${encodeURIComponent(getFeedTopic())}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Feed-Token": token,
      },
      body: JSON.stringify({
        kind: elements.feedKind.value.trim(),
        title: elements.feedTitle.value.trim(),
        body: elements.feedBody.value.trim(),
      }),
    },
  );

  if (!response.ok) {
    setStatus(elements.feedStatus, "error", json?.error ?? `HTTP ${response.status}`);
    return;
  }

  setStatus(elements.feedStatus, "ok", "Published");
}

elements.connectAll.addEventListener("click", connectStreams);
elements.disconnectAll.addEventListener("click", () => {
  closeSources();
  setStatus(elements.serviceStatus, "warn", "Stopped");
  setStatus(elements.feedStatus, "warn", "Stopped");
  for (const pane of Object.values(elements.panes)) {
    setStatus(pane.status, "warn", "Stopped");
  }
});
elements.refreshAll.addEventListener("click", () => {
  void refreshHealth();
  void loadHistories();
});
elements.feedForm.addEventListener("submit", publishFeedEvent);
elements.panes.a.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage("a");
});
elements.panes.b.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage("b");
});

renderRoomMessages();
renderFeedEvents();
void refreshHealth();
