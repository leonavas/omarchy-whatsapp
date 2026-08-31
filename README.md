# leonavas.whatsapp

WhatsApp as a tray icon on the Omarchy desktop, the way Slack's behaves: click
to open it, click again to put it away without closing it, and a red dot on the
icon while there are unread chats. With the bundled shell app, hovering the bar
icon previews the unread chats — contact, last message, count — in the bar's
own UI.

WhatsApp has no Linux client and a browser web app publishes no tray icon, so
this builds one: a content script counts the unread chats inside the page, and
a small daemon turns that into a real tray item.

It comes in two shapes, and you only need one:

| | Where it lives |
|---|---|
| **`tray/whatsapp-tray`** | in the tray next to Slack — pin, hide and unpin like any other item |
| `WhatsApp.qml` | its own slot in the bar, as a Quickshell widget |

The tray daemon is the default. The bar widget stays off unless you enable it,
and both drive the window the same way — running both just gives you the same
icon twice.

## Requirements

WhatsApp opened as a browser web app (not a tab), plus `python-dbus`,
`python-gobject` and ImageMagick — all of which an Omarchy box already has.

## Installing

```bash
omarchy plugin add https://github.com/leonavas/omarchy-whatsapp.git
```

**1. The content script.** Without it nothing counts. Append its directory to
the `--load-extension` line in `~/.config/chromium-flags.conf`:

```
--load-extension=…/copy-url,…/yt-dlp,…/whatsapp-slim,~/.config/omarchy/plugins/leonavas.whatsapp/chromium/whatsapp-unread
```

Chromium reads that line only when the browser process starts, and closing the
window is not enough — a new launch attaches to a Chromium that is still
shutting down and quietly runs without it. Wait for it to be gone:

```bash
pgrep -f 'chromium.*--app=https://web.whatsapp' || echo gone
```

**2. The daemon**, started at login from `~/.config/hypr/autostart.lua`:

```lua
o.launch_on_start("~/.config/omarchy/plugins/leonavas.whatsapp/tray/whatsapp-tray")
```

**3. The bar widget**, only if you want that shape instead:

```bash
omarchy plugin enable leonavas.whatsapp --section right
```

Then open WhatsApp from the icon and pair the session once. From there the
window can live parked out of sight.

## Using it

| Action | Tray icon | Bar widget |
|---|---|---|
| Left click | Open WhatsApp, bring it back, or put it away | Open WhatsApp and focus it |
| Middle click | Open or focus it, never hides it | Close WhatsApp |
| Right click | Menu: Open / Hide / Launch on Login / Quit WhatsApp | The same menu |
| Hover | One-line tooltip | Preview of the unread chats (needs the shell app) |

Hiding does not close WhatsApp: the window moves to the `special:whatsapp`
workspace, where it keeps running and keeps counting. Bringing it back returns
it to the workspace it was last used on and takes you there.

**Quit WhatsApp** closes the window *and* takes the icon away, the way
quitting any tray application does — from the tray and from the bar widget
alike. Both keep watching, unseen, and put the icon back the moment WhatsApp
is started again — from the launcher, a keybind, anything. Nothing has to be
restarted.

**Launch on Login** is a checkmark in the tray menu, the same one Slack has:
with it on, the daemon opens WhatsApp a few seconds after login unless it is
already running — parked out of sight if `--start-hidden` is set, so login ends
with nothing on screen but the icon and its count. The choice is remembered in
`~/.config/whatsapp-tray/settings.json` and outlives the session; `--autostart`
only decides what happens until the menu is used once. It needs the daemon
itself to start at login, which is step 2 above.

## Daemon options

`tray/whatsapp-tray --help` lists them all.

| Option | Default | What it does |
|---|---|---|
| `--window-class` | `whatsapp` | Case-insensitive substring of the window class to watch |
| `--url` | `https://web.whatsapp.com/` | Opened with `omarchy-launch-webapp` |
| `--launch` | — | A command to open WhatsApp instead of the web app |
| `--badge` | `dot` | `dot`, `count` or `none` |
| `--special` | `whatsapp` | Name of the special workspace used to park it |
| `--no-hide` | — | Clicking a focused window does not park it |
| `--start-hidden` | off | Park the window shortly after opening it |
| `--hide-after` | `8` | Seconds of loading before it is parked |
| `--autostart` | off | Open WhatsApp on login when it is not already running, until the menu's "Launch on Login" is used |
| `--glyph` | `󰖣` | The character drawn as the icon |
| `--font-family` | `JetBrainsMono Nerd Font` | Family to take the glyph from |
| `--font` | — | Path to a font file, overriding the family |
| `--icon-size` | `64` | Pixmap size handed to the tray |
| `--glyph-scale` | `0.9` | How much of the icon the glyph fills |
| `--badge-scale` | `0.6` | Dot diameter, as a fraction of the icon |
| `--glyph-offset` | `4` | Pixels the glyph is nudged left to clear the badge |
| `--color`, `--badge-color` | — | Empty follows the theme's bar text and bar active |

Colors follow the theme and repaint themselves when you switch it.

### A native client instead of the web app

Point `--launch` at it and leave `--window-class` alone — `whatsapp` also
matches `whatsapp-for-linux` and friends.

## The shell app

`shell/whatsapp-shell` runs WhatsApp Web in its own Electron window instead of
a Chromium `--app` one. Same page, one difference that matters: the script
inside it belongs to us, so more than a number fits through the pipe. It hands
the unread chats — contact, last message, count, time — to the bar widget,
which shows them in a popup when you hover the icon. Clicking a row jumps
straight to that conversation.

Nothing to build or install beyond Electron itself (`pacman -S electron`,
already present on a box with another Electron app). The bar widget launches
it by default — `launchCommand` only exists to run something else — and the
tray daemon reaches it with `--launch .../shell/whatsapp-shell`. First launch
shows the QR pairing screen — the shell keeps its own session, separate from
the browser's, under `~/.local/state/whatsapp-shell`.

The hover preview renders on the **bar widget**, not on the tray icon: an SNI
tray item never hears about the pointer, so its hover behaviour belongs to the
tray host and stops at a one-line tooltip. Running the widget means unpinning
the tray icon (or quitting the daemon) unless you want the icon twice.

Everything else keeps working as before: the shell still publishes
`(N) WhatsApp` into the window title and its window class still matches
`whatsapp`, so the tray daemon, the badge and the park/show logic neither know
nor care which shell runs the page. The previews live only in
`$XDG_RUNTIME_DIR/whatsapp-shell/state.json` — a private tmpfs, gone at
logout; message text never lands on disk.

Invoking the launcher while the shell runs forwards its arguments to the open
window instead of starting a second one — that is the whole command interface:
`--open-chat=NAME` jumps to a conversation, and `--test-notification` fires a
notification from inside the page through the same path WhatsApp's own
notifications take, which is the first thing to run when they go quiet.

## Bar widget settings

Through the shell's plugin panel, or directly in `~/.config/omarchy/shell.json`:

```json
{
  "id": "leonavas.whatsapp",
  "badge": "Dot",
  "startHidden": true,
  "autoStart": false
}
```

| Setting | Default | What it does |
|---|---|---|
| `launchCommand` | — | Empty launches the bundled shell app; set it to run e.g. `whatsapp-for-linux` or `omarchy-launch-webapp https://web.whatsapp.com/` |
| `windowClass` | `whatsapp` | Case-insensitive substring of the window class to watch |
| `iconStyle` | `Glyph` | `Glyph` (Nerd Font, bar colored) or `App icon` (the green icon) |
| `glyph` | `󰖣` | The character drawn by the `Glyph` style |
| `glyphSize` | `0` | Glyph size in px; `0` follows the bar, a point over its icon size |
| `glyphOffsetY` | `-0.5` | Vertical nudge in px, negative is up |
| `badge` | `Dot` | `Dot`, `Count` or `None` |
| `badgeColor` | — | A hex color; empty follows the theme's urgent color |
| `badgeScale` | `0.6` | Dot diameter as a fraction of the icon — the tray daemon's own scale |
| `tintWhenUnread` | `false` | Colors the icon while there is something unread; off, only the badge lights up |
| `hideMode` | `Special workspace` | `Never hide` leaves clicking as focus only |
| `specialWorkspace` | `whatsapp` | Used as `special:<name>` |
| `startHidden` | `true` | Parks the window shortly after opening it |
| `hideAfterLaunch` | `8` | Seconds of loading before it is parked |
| `autoStart` | `false` | Opens WhatsApp when the shell starts — the icon's menu toggles this as "Launch on Login" |
| `dimWhenClosed` | `true` | Dims the icon while WhatsApp is not running |
| `hideWhenNotRunning` | `false` | Removes the icon from the bar while it is closed |
| `middleClickCloses` | `true` | Turn off to keep the middle button inert |
| `hoverPreview` | `true` | Hovering the icon previews the unread chats; needs the shell app |
| `previewRows` | `6` | Most chats the preview shows before saying "+N more" |

`shell.json` reloads on save, so setting changes apply immediately. Editing the
QML needs `omarchy restart shell` to reach widgets already on the bar.

## When the dot never lights up

- **The window title is still `web.whatsapp.com`.** The content script is not
  running in that window: check the `--load-extension` line, then quit Chromium
  completely and open WhatsApp again. `~/.config/chromium-flags.conf` is a copy
  of Omarchy's, so an update that refreshes it drops the entry.
- **WhatsApp is closed.** The count lives in the window title, so a closed
  WhatsApp counts nothing — that is what parking it is for.
- **WhatsApp is a browser tab.** In a tab the title belongs to whichever tab is
  in front. Use the web app window.
- **Only archived chats are unread.** Those are left out on purpose, the same
  way WhatsApp leaves them out of its own count.

## Files

| File | Contents |
|---|---|
| `tray/whatsapp-tray` | The tray daemon |
| `shell/` | The Electron shell app: WhatsApp Web plus the chat scrape feeding the hover preview |
| `chromium/whatsapp-unread/` | Content script that publishes the count into the window title (plain-Chromium setups) |
| `WhatsApp.qml`, `Model.js` | The bar widget, hover preview included |
| `manifest.json` | Metadata and settings read by the shell |

[`NOTES.md`](NOTES.md) explains why it is built this way — worth reading before
changing any of it.

## License

MIT — see [`LICENSE`](LICENSE).
