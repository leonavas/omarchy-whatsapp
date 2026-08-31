// WhatsApp Web in our own browser shell. What this adds over a Chromium
// `--app` window: the preload script runs inside the page and hands the chat
// list (contact, last message, unread count) to this process, which publishes
// it for the bar widget's hover preview — and the window answers commands
// like "open the chat with this name" from outside.
"use strict";

const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WA_URL = "https://web.whatsapp.com/";

// The session (QR pairing included) survives restarts here. State, not
// config: nothing in it is meant to be edited.
const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
app.setPath("userData", path.join(stateHome, "whatsapp-shell"));

// Previews are message text, so they go to the runtime dir: tmpfs, owned by
// this user alone, gone at logout. Nothing readable lands on disk.
const runtimeDir = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), "whatsapp-shell");
const statePath = path.join(runtimeDir, "state.json");

// The Wayland app id is what Hyprland reports as the window class, and the
// tray daemon and bar widget both match "whatsapp" as a substring of it.
// `--class` covers an X11 session the same way.
app.commandLine.appendSwitch("wayland-app-id", "whatsapp-shell");
app.commandLine.appendSwitch("class", "whatsapp-shell");

// One window, ever. A second invocation exists only to carry arguments to
// the first (see `second-instance` below).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null;

// Written atomically: the widget watches this file and must never catch a
// half-written JSON document.
function writeState(state) {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    const tmp = statePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, statePath);
  } catch (err) {
    console.error("whatsapp-shell: state write failed:", err.message);
  }
}

// A stale file would keep showing yesterday's messages in the popup after
// the shell is gone, so leaving is announced rather than silent.
function clearState() {
  writeState({ unread: 0, chats: [], updatedAt: Date.now(), running: false });
}

function handleArgv(argv) {
  let focus = true;
  for (const arg of argv) {
    if (arg.startsWith("--open-chat=")) {
      const name = arg.slice("--open-chat=".length);
      if (win && name) win.webContents.send("wa-open-chat", name);
    } else if (arg === "--test-notification") {
      // Fires an HTML5 notification from inside the page — the same path
      // WhatsApp's own notifications take — without touching the window:
      // pulling focus would defeat a test of something focus can suppress.
      focus = false;
      if (win) win.webContents.send("wa-test-notification");
    }
  }
  if (win && focus) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1150,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    autoHideMenuBar: true,
    backgroundColor: "#111b21",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  // WhatsApp Web turns away user agents it does not recognize, and the
  // default one advertises Electron and this app's own name.
  const ua = win.webContents.userAgent
    .replace(/ whatsapp-shell\/[\d.]+/g, "")
    .replace(/ Electron\/[\d.]+/g, "");
  win.webContents.setUserAgent(ua);

  // Links in messages open in the real browser; the window itself never
  // leaves WhatsApp.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("https://web.whatsapp.com")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on("closed", () => { win = null; });
  win.loadURL(WA_URL);
}

app.on("second-instance", (event, argv) => handleArgv(argv));

app.whenReady().then(() => {
  // WhatsApp asks for notifications always and for the microphone when
  // recording voice messages; everything else stays denied. Both handlers
  // matter: the request handler answers permission prompts, but the check
  // handler is what Notification.permission reads — without it the page can
  // see "denied" and never attempt a notification at all.
  const GRANTED = ["notifications", "media", "clipboard-sanitized-write", "fullscreen"];
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(GRANTED.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => GRANTED.includes(permission));

  ipcMain.on("wa-state", (event, state) => {
    if (state && typeof state === "object") {
      writeState({ ...state, updatedAt: Date.now(), running: true });
    }
  });

  ipcMain.on("wa-debug", (event, line) => {
    console.log("whatsapp-shell:", String(line));
  });

  createWindow();
  handleArgv(process.argv.slice(1));
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", clearState);
