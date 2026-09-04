.pragma library

// Pure helpers for the WhatsApp widget. Everything here only reads properties
// off Hyprland objects, which is what keeps QML binding capture working: the
// widget re-evaluates whenever a title, a workspace, or the window list moves.

function classOf(toplevel) {
  if (!toplevel) return ""
  var wayland = toplevel.wayland
  if (wayland && wayland.appId) return String(wayland.appId)
  var ipc = toplevel.lastIpcObject
  if (ipc) {
    if (ipc["class"]) return String(ipc["class"])
    if (ipc["initialClass"]) return String(ipc["initialClass"])
  }
  return ""
}

function titleOf(toplevel) {
  if (!toplevel) return ""
  var title = String(toplevel.title || "")
  if (title.length > 0) return title
  var wayland = toplevel.wayland
  return wayland ? String(wayland.title || "") : ""
}

// Read both the Hyprland flag and the Wayland one, so a focus change repaints
// on whichever side reports it first.
function isActive(toplevel) {
  if (!toplevel) return false
  var wayland = toplevel.wayland
  return toplevel.activated === true || !!(wayland && wayland.activated)
}

function matches(toplevel, needle) {
  var value = String(needle || "").toLowerCase()
  if (value.length === 0) return false
  return classOf(toplevel).toLowerCase().indexOf(value) >= 0
}

// The window the widget speaks for. A focused match wins over a parked one so
// that clicking while WhatsApp is on screen acts on the copy you are looking
// at. Among unfocused matches, a class that *begins* with the needle — a real
// client, "whatsapp-shell" — beats one that merely contains it, a browser
// wrapper's "chrome-web.whatsapp.com__-Default": with both open (the shell
// being tried while the web app still runs), every click must land on the
// same window, not on whichever the toplevel list happens to yield first.
function findWindow(toplevels, needle) {
  var value = String(needle || "").toLowerCase()
  var list = toplevels || []
  var best = null
  var bestRank = -1
  for (var i = 0; i < list.length; i++) {
    var toplevel = list[i]
    if (!matches(toplevel, value)) continue
    if (isActive(toplevel)) return toplevel
    var rank = classOf(toplevel).toLowerCase().indexOf(value) === 0 ? 1 : 0
    if (rank > bestRank) {
      best = toplevel
      bestRank = rank
    }
  }
  return best
}

// WhatsApp Web writes the number of conversations with something new into
// `document.title` — "(3) WhatsApp" — and a browser app window carries that
// title verbatim, which is the whole trick behind the badge. The trailing form
// covers native clients that append the count instead.
function unreadFromTitle(title) {
  var value = String(title || "")
  var match = value.match(/^\s*\((\d+)\+?\)/)
  if (!match) match = value.match(/\((\d+)\+?\)\s*$/)
  if (!match) return 0
  var count = parseInt(match[1], 10)
  return isFinite(count) && count > 0 ? count : 0
}

function badgeLabel(count) {
  return count > 99 ? "99+" : String(count)
}

// The shell app (shell/whatsapp-shell) publishes what it scrapes out of the
// page — unread chats with contact, last message, count and time — as JSON
// in the runtime dir. Absent or malformed means "no shell running": the
// widget then falls back to the title pipe and simply has no previews.
function parseState(text) {
  var value = String(text || "").trim()
  if (value.length === 0) return null
  var data
  try {
    data = JSON.parse(value)
  } catch (e) {
    return null
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.chats)) return null
  return data
}

function stateUnread(state) {
  if (!state) return 0
  var count = Number(state.unread)
  return isFinite(count) && count > 0 ? Math.floor(count) : 0
}

function countOf(value) {
  var count = Number(value)
  return isFinite(count) && count > 0 ? Math.floor(count) : 0
}

// How many unread chats of each kind are waiting. The shell counts both over
// the whole sidebar, past the cap on how many chats travel in the file; the
// scan over `chats` is the fallback for a state file written before the shell
// learned the difference, and the title pipe has no idea either way — which is
// why "no group and no direct" has to read as "unknown", not as "none".
function stateGroupUnread(state) {
  if (!state) return 0
  if (state.groups !== undefined || state.direct !== undefined) return countOf(state.groups)
  return countKind(state, "group")
}

function stateDirectUnread(state) {
  if (!state) return 0
  if (state.groups !== undefined || state.direct !== undefined) return countOf(state.direct)
  return countKind(state, "direct")
}

function countKind(state, kind) {
  var total = 0
  var list = Array.isArray(state.chats) ? state.chats : []
  for (var i = 0; i < list.length; i++) {
    var chat = list[i]
    if (!chat || typeof chat !== "object") continue
    // A chat with no kind at all predates the split; it counts as direct, the
    // color this widget has always painted.
    var value = String(chat.kind || "direct")
    if (value === kind) total += 1
  }
  return total
}

// The rows the hover popup renders, already trimmed and clamped so the QML
// side can trust every field to exist.
function stateChats(state, max) {
  if (!state) return []
  var limit = Math.max(1, Number(max) || 6)
  var rows = []
  for (var i = 0; i < state.chats.length && rows.length < limit; i++) {
    var chat = state.chats[i]
    if (!chat || typeof chat !== "object") continue
    var name = String(chat.name || "").trim()
    if (name.length === 0) continue
    var count = Number(chat.count)
    var messagesIn = Array.isArray(chat.messages) ? chat.messages : []
    var messages = []
    for (var m = 0; m < messagesIn.length && messages.length < 10; m++) {
      var text = String(messagesIn[m] || "").trim()
      if (text.length > 0) messages.push(text)
    }
    rows.push({
      name: name,
      preview: String(chat.preview || "").trim(),
      time: String(chat.time || "").trim(),
      count: isFinite(count) && count > 0 ? Math.floor(count) : 1,
      kind: String(chat.kind || "direct") === "group" ? "group" : "direct",
      messages: messages,
    })
  }
  return rows
}

function workspaceName(toplevel) {
  if (!toplevel) return ""
  var workspace = toplevel.workspace
  if (workspace && workspace.name) return String(workspace.name)
  var ipc = toplevel.lastIpcObject
  if (ipc && ipc["workspace"] && ipc["workspace"]["name"]) return String(ipc["workspace"]["name"])
  return ""
}

// Parked means "sitting in the special workspace this widget owns", i.e. out
// of sight but still running and still counting.
function isParked(toplevel, specialName) {
  var name = String(specialName || "")
  if (name.length === 0) return false
  return workspaceName(toplevel) === "special:" + name
}

// Where to send a window that has no remembered home: wherever you are.
function activeWorkspaceName(hyprland) {
  if (!hyprland) return ""
  var workspace = hyprland.focusedWorkspace
  return workspace && workspace.name ? String(workspace.name) : ""
}
