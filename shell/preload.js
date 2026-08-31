// Runs inside WhatsApp Web with DOM access. Two jobs:
//
// 1. Republish the unread count into the window title — "(3) WhatsApp" — the
//    same pipe chromium/whatsapp-unread/unread.js feeds, so the tray daemon
//    and the widget badge work identically whichever shell runs the page.
// 2. Scrape the unread chats (contact, last message, count, time) and hand
//    them to the main process, which publishes them for the hover preview.
//
// WhatsApp's DOM drifts between builds. Every selector this file trusts is
// in SEL, and everything read out of a row goes through defensive fallbacks.
"use strict";

const { ipcRenderer } = require("electron");

const SEL = {
  pane: "#pane-side",
  row: '[role="listitem"]',
  badge: '[data-testid="icon-unread-count"]',
  // Chats put away in "Archived" carry the same badge and WhatsApp leaves
  // them out of its own count; counting them lights the badge permanently.
  archived: '[data-testid="chatlist-panel-archived-button"]',
  // The contact name (and often the message preview) sit in spans that
  // carry their full text in a title attribute.
  titled: "span[title]",
};

const MAX_CHATS = 20;

let appliedTitle = null;
let lastPayload = "";

function pane() {
  return document.querySelector(SEL.pane);
}

// A row's badge: the test id when the build has one, else any span whose
// aria-label text is a bare number — neither depends on the UI language.
function badgeIn(row) {
  const badge = row.querySelector(SEL.badge);
  if (badge) return badge;
  for (const span of row.querySelectorAll("span[aria-label]")) {
    if (/^\d+$/.test((span.textContent || "").trim())) return span;
  }
  return null;
}

function badgeCount(badge) {
  const text = (badge.textContent || "").trim();
  const count = parseInt(text, 10);
  // A badge with no number (muted style) still marks one unread chat.
  return isFinite(count) && count > 0 ? count : 1;
}

// The row renders as [name, time] over [preview, badge], and innerText
// yields those lines in that order — which is what the time and the preview
// fallback lean on when the titled spans are not there to be read.
function rowInfo(row) {
  const titled = row.querySelectorAll(SEL.titled);
  const name = titled.length > 0
    ? (titled[0].getAttribute("title") || titled[0].textContent || "").trim()
    : "";
  if (!name) return null;

  let preview = "";
  if (titled.length > 1) {
    const last = titled[titled.length - 1];
    preview = (last.getAttribute("title") || last.textContent || "").trim();
  }

  const lines = (row.innerText || "").split("\n").map(s => s.trim()).filter(Boolean);
  const time = lines.length >= 2 && lines[1] !== preview ? lines[1] : "";
  if (!preview) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === name || line === time || /^\d+$/.test(line)) continue;
      preview = line;
      break;
    }
  }

  return { name, preview, time };
}

function collect() {
  const side = pane();
  if (!side) return { unread: 0, chats: [] };

  const chats = [];
  let unread = 0;
  for (const row of side.querySelectorAll(SEL.row)) {
    if (row.closest(SEL.archived) || row.querySelector(SEL.archived)) continue;
    const badge = badgeIn(row);
    if (!badge) continue;
    unread += 1;
    if (chats.length >= MAX_CHATS) continue;
    const info = rowInfo(row);
    if (info) chats.push({ ...info, count: badgeCount(badge) });
  }
  return { unread, chats };
}

function publishTitle(count) {
  const wanted = count > 0 ? "(" + count + ") WhatsApp" : "WhatsApp";
  // Measured against the live title, not the last value written here:
  // WhatsApp keeps setting the title too, and trusting our own memory means
  // writing once, being overwritten, and never speaking again.
  if (document.title === wanted && appliedTitle === wanted) return;
  appliedTitle = wanted;
  // An assignment that does not change the value fires no title change.
  document.title = "";
  document.title = wanted;
}

function apply() {
  const state = collect();
  publishTitle(state.unread);
  const payload = JSON.stringify(state);
  if (payload !== lastPayload) {
    lastPayload = payload;
    ipcRenderer.send("wa-state", state);
  }
}

// The chat list re-renders on every message; debounce folds a burst of
// mutations into one pass, and the interval is the backstop for renders the
// observer does not see (a collapsed pane, a reconnect).
let pending = null;
function schedule() {
  if (pending !== null) return;
  pending = setTimeout(() => { pending = null; apply(); }, 150);
}

const observer = new MutationObserver(schedule);
function watch() {
  const side = pane();
  if (side) observer.observe(side, { childList: true, subtree: true, characterData: true });
  return !!side;
}

window.addEventListener("DOMContentLoaded", () => {
  if (!watch()) {
    const waiting = setInterval(() => { if (watch()) clearInterval(waiting); }, 1000);
  }
  setInterval(apply, 3000);
  apply();

  // One line in the shell's log saying whether the page can notify at all —
  // the first thing to look at when notifications go quiet.
  const perm = typeof Notification !== "undefined" ? Notification.permission : "unavailable";
  ipcRenderer.send("wa-debug", "notification-permission=" + perm);
});

// "Open the chat named X": find its row and click it the way a person would.
// Matched on the visible name — exact first, then prefix — because the name
// is the only identity the preview rows carry.
ipcRenderer.on("wa-open-chat", (event, name) => {
  const side = pane();
  if (!side || !name) return;
  let match = null;
  for (const row of side.querySelectorAll(SEL.row)) {
    if (row.closest(SEL.archived)) continue;
    const info = rowInfo(row);
    if (!info) continue;
    if (info.name === name) { match = row; break; }
    if (!match && info.name.indexOf(name) === 0) match = row;
  }
  if (!match) return;
  for (const type of ["mousedown", "mouseup", "click"]) {
    match.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
});
