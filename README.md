# leonavas.whatsapp

WhatsApp as a tray icon on the Omarchy desktop, the way Slack's behaves: click
to open it, click again to put it away without closing it, and a red dot on the
icon while there are unread chats.

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
| Left click | Open WhatsApp, bring it back, or put it away | same |
| Middle click | Open or focus it, never hides it | Close WhatsApp |
| Right click | Menu: Open / Hide / Quit WhatsApp | Open or focus it, never hides it |

Hiding does not close WhatsApp: the window moves to the `special:whatsapp`
workspace, where it keeps running and keeps counting. Bringing it back returns
it to the workspace it was last used on and takes you there.

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
| `--autostart` | off | Open WhatsApp on login when it is not already running |
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
| `url` | `https://web.whatsapp.com/` | Opened with `omarchy-launch-webapp` |
| `launchCommand` | — | Overrides the launch entirely, e.g. `whatsapp-for-linux` |
| `windowClass` | `whatsapp` | Case-insensitive substring of the window class to watch |
| `iconStyle` | `Glyph` | `Glyph` (Nerd Font, bar colored) or `App icon` (the green icon) |
| `glyph` | `󰖣` | The character drawn by the `Glyph` style |
| `glyphSize` | `0` | Glyph size in px; `0` follows the bar |
| `glyphOffsetY` | `-0.5` | Vertical nudge in px, negative is up |
| `badge` | `Dot` | `Dot`, `Count` or `None` |
| `badgeColor` | — | A hex color; empty follows the theme's urgent color |
| `tintWhenUnread` | `true` | Colors the icon while there is something unread |
| `hideMode` | `Special workspace` | `Never hide` leaves clicking as focus only |
| `specialWorkspace` | `whatsapp` | Used as `special:<name>` |
| `startHidden` | `true` | Parks the window shortly after opening it |
| `hideAfterLaunch` | `8` | Seconds of loading before it is parked |
| `autoStart` | `false` | Opens WhatsApp when the shell starts |
| `dimWhenClosed` | `true` | Dims the icon while WhatsApp is not running |
| `hideWhenNotRunning` | `false` | Removes the icon from the bar while it is closed |
| `middleClickCloses` | `true` | Turn off to keep the middle button inert |

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
| `chromium/whatsapp-unread/` | Content script that publishes the count into the window title |
| `WhatsApp.qml`, `Model.js` | The bar widget |
| `manifest.json` | Metadata and settings read by the shell |

[`NOTES.md`](NOTES.md) explains why it is built this way — worth reading before
changing any of it.

## License

MIT — see [`LICENSE`](LICENSE).
