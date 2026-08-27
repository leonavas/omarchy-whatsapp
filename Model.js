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
// at, in the rare case two of them are running.
function findWindow(toplevels, needle) {
  var list = toplevels || []
  var first = null
  for (var i = 0; i < list.length; i++) {
    var toplevel = list[i]
    if (!matches(toplevel, needle)) continue
    if (isActive(toplevel)) return toplevel
    if (first === null) first = toplevel
  }
  return first
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
