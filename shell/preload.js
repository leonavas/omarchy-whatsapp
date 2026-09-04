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
  // Chat rows were role="listitem" for years and are role="row" today; the
  // probe (--probe) is how the next rename gets caught.
  row: '[role="row"], [role="listitem"]',
  badge: '[data-testid="icon-unread-count"]',
  // Chats put away in "Archived" carry the same badge and WhatsApp leaves
  // them out of its own count; counting them lights the badge permanently.
  archived: '[data-testid="chatlist-panel-archived-button"]',
  // The contact name (and often the message preview) sit in spans that
  // carry their full text in a title attribute.
  titled: "span[title]",
  // A group with no picture draws WhatsApp's own two-person avatar. Which
  // element carries it has moved — `data-icon="default-group"` in the builds
  // that had data-icon, an inline <svg><title>ic-group-filled</title> in the
  // build this was last checked against — but the word "group" has survived
  // every one of those renames, so both places are read and matched loosely.
  groupIcon: '[data-icon*="group"]',
  iconTitle: "svg title",
};

const GROUP_IN_ICON = /group/i;

// The sidebar prefixes a group's preview line with who wrote it — "Ana: oi" —
// and never does that for a one-to-one chat. An unread chat's last message is
// incoming by definition, so the prefix is there whenever it matters — which
// is what covers the groups that do have a picture and so draw no icon.
const SENDER_PREFIX = /^~?\s?[^:\n]{1,30}:\s/;

const MAX_CHATS = 20;
const MAX_MESSAGES = 10;

let appliedTitle = null;
let lastPayload = "";

// The sidebar only ever shows a chat's latest message — but it shows every
// one of them in turn: each arrival rewrites the preview line and bumps the
// badge. Diffing the line whenever the count rises replays the sequence,
// which is how the popup gets all of a conversation's messages instead of
// just the last. Gated on the count on purpose: the preview line also
// flickers through "typing…" and drafts, and none of those move the badge.
// Keyed by chat name; forgotten the moment the chat's badge clears.
const trackByChat = new Map();

function remember(info, count) {
  let entry = trackByChat.get(info.name);
  if (!entry) {
    // First sighting: whatever came before this line is gone for good — the
    // sidebar has no history — so an already-piled-up chat starts at one.
    entry = { count: count, messages: info.preview ? [info.preview] : [] };
    trackByChat.set(info.name, entry);
    return entry.messages;
  }
  if (count > entry.count && info.preview
      && entry.messages[entry.messages.length - 1] !== info.preview) {
    entry.messages.push(info.preview);
    while (entry.messages.length > MAX_MESSAGES) entry.messages.shift();
  }
  entry.count = count;
  return entry.messages;
}

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

// Group or one-to-one, from two independent signals. The avatar comes first:
// it reads the chat's identity and cannot be wrong. The prefix reads the
// message instead — it is what answers for a group that has a picture, at the
// price of being fooled by a one-to-one message opening with "word: ".
function isGroupRow(row, preview) {
  if (row.querySelector(SEL.groupIcon)) return true;
  for (const title of row.querySelectorAll(SEL.iconTitle)) {
    if (GROUP_IN_ICON.test(title.textContent || "")) return true;
  }
  return SENDER_PREFIX.test(preview || "");
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
  if (!preview) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === name || /^\d+$/.test(line)) continue;
      preview = line;
      break;
    }
  }

  // The line order inside a row is not stable across builds, so the time is
  // recognized rather than positioned: a clock or a date wherever it sits,
  // else the shortest leftover line ("Ontem", a weekday), else nothing.
  let time = "";
  const leftovers = lines.filter(l => l !== name && l !== preview && !/^\d+$/.test(l));
  for (const line of leftovers) {
    if (/\d{1,2}:\d{2}/.test(line) || /\d{1,2}[\/.\-]\d{1,2}/.test(line)) { time = line; break; }
  }
  if (!time && leftovers.length > 0) {
    const shortest = leftovers.reduce((a, b) => (a.length <= b.length ? a : b));
    if (shortest.length <= 16) time = shortest;
  }

  return { name, preview, time, kind: isGroupRow(row, preview) ? "group" : "direct" };
}

function collect() {
  const side = pane();
  if (!side) return { unread: 0, groups: 0, direct: 0, chats: [] };

  const chats = [];
  let unread = 0;
  // Counted over every unread row, not only the ones that fit in `chats`, so
  // the widget's badge can be colored by what is waiting even when the list
  // sent for the preview is capped.
  let groups = 0;
  let direct = 0;
  for (const row of side.querySelectorAll(SEL.row)) {
    if (row.closest(SEL.archived) || row.querySelector(SEL.archived)) continue;
    const badge = badgeIn(row);
    if (!badge) continue;
    unread += 1;
    const info = rowInfo(row);
    if (info && info.kind === "group") groups += 1; else direct += 1;
    if (!info || chats.length >= MAX_CHATS) continue;
    const count = badgeCount(badge);
    chats.push({
      ...info,
      count: count,
      messages: remember(info, count),
    });
  }

  // A chat read is a chat forgotten: keeping its captured messages would
  // resurrect them the next time a single message arrives.
  const unreadNames = new Set(chats.map(c => c.name));
  for (const name of trackByChat.keys()) {
    if (!unreadNames.has(name)) trackByChat.delete(name);
  }

  return { unread, groups, direct, chats };
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
// The notification the diagnostic command asks for. Success or failure goes
// to the shell's log either way — a notification that throws is invisible by
// definition, which is exactly when the log line earns its keep.
ipcRenderer.on("wa-test-notification", () => {
  try {
    const note = new Notification("WhatsApp shell", { body: "As notificações estão funcionando" });
    note.onerror = () => ipcRenderer.send("wa-debug", "test-notification-error");
    ipcRenderer.send("wa-debug", "test-notification-sent permission=" + Notification.permission);
  } catch (err) {
    ipcRenderer.send("wa-debug", "test-notification-threw=" + err);
  }
});

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
