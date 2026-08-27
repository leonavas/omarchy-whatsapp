# Why it is built this way

Notes for whoever changes this — mostly things that fail *silently*, where the
obvious version of the code looks right and quietly does nothing.

## The count travels DOM → window title → compositor → tray

WhatsApp Web keeps its unread count in `document.title` (`(3) WhatsApp`), and a
Chromium `--app` window **never picks those updates up**: the window title sits
on the origin, `web.whatsapp.com`, for the whole session, so the compositor has
nothing to report. A title written from a content script *does* land, which is
the only reason `chromium/whatsapp-unread` exists — it republishes the count
from inside the page.

Three consequences, each of which cost a debugging round:

- **The count is read from the DOM, not from `document.title`.** The script
  overwrites that title and would otherwise read its own output back.
- **It measures against the live title, not against its last write.** WhatsApp
  keeps setting the title too. A script that trusts its own memory writes once,
  gets overwritten, and never speaks again — and with no unread chats the value
  never changes, so it never recovers. Comparing against what is actually on
  the document makes it self-healing.
- **Archived chats are excluded.** The "Archived" row carries the same unread
  badge as a real chat and WhatsApp leaves it out of its own count. Counting it
  lights the tray up permanently over conversations that are not in the list to
  be read.

Badges are matched on `[data-testid="icon-unread-count"]`, falling back to
badges whose text is a bare number. Neither depends on the interface language.

## Why the tray icon cannot be a plugin

`Quickshell.Services.SystemTray` is a *host*: it consumes items and has no API
to publish one. Appearing in the tray means owning a D-Bus name and answering
`org.kde.StatusNotifierItem`, which no QML plugin loaded into the shell can do.
Hence a separate process.

The right-click menu is a second interface, `com.canonical.dbusmenu`. An SNI
carries no actions of its own beyond a click, so every tray icon that offers a
"Quit" is answering that interface.

A checkable entry in that menu — "Launch on Login" — is an ordinary item that
declares `toggle-type = "checkmark"` and a `toggle-state`; there is no checkbox
*type*, and an item carrying neither property is drawn with no room for a mark.
The host caches what it was handed, so flipping the state has to be followed by
a `LayoutUpdated` or the old checkmark stays on screen until something else
invalidates the menu.

The choice behind it lives in `~/.config/whatsapp-tray/settings.json`: a menu
that forgets at logout is not a login setting, and the daemon has no other
config file — everything else reaches it on the command line.

The unread count is painted into the icon pixmap because the tray renders
whatever image an item hands it: `Status = NeedsAttention` is ignored, and only
a `-symbolic` icon *name* gets recolored, which a pixmap cannot carry.

## Hyprland calls that fail quietly

- A window address has to carry the **`0x` prefix** that Quickshell strips off.
  Without it every dispatch answers `window not found`.
- `hl.dsp.window.move` **without `silent = true`** takes the compositor along
  with the window and leaves it focused — the whole trip in one dispatch. The
  silent form does neither.
- Focusing a window on another workspace lands the **workspace**, leaving the
  focus on whatever was last used there. The window is only reached by asking a
  second time. Two-step behaviour, not a race, so the repeat is the fix.
- Table-vs-positional arguments are not interchangeable:
  `hl.dsp.workspace.toggle_special("name")` wants the name positionally and
  quietly toggles the *default* special workspace when handed a table.

Introspect them rather than guessing — calling with an empty table returns the
accepted argument names:

```bash
hyprctl dispatch 'hl.dsp.window.move({})'
```

## Chromium only reads the flag at startup

The `--load-extension` line and the content script are read when the **browser
process** starts. Closing the window is not enough: a new `--app` launch
attaches to a Chromium that is still shutting down and runs the old code with
no error anywhere. This looked like a broken extension more than once.

A window parked out of sight keeps its websocket and keeps counting, but
Chromium throttles timers in windows it considers hidden. DOM mutations still
reach the observer, so a message landing repaints the tray; if the count ever
looks stale after a long stretch parked,
`--disable-renderer-backgrounding` is the lever, at the cost of applying to
every web app.

## Drawing

Measurements below are from the bar at its real size, not from eyeballing.

**Glyph size.** At parity the glyph's ink box is exactly Slack's — 14×14 px on
the same rows — and still reads smaller, because Slack's is a solid mark while
this is an outline with a tail hanging off the bottom. `--glyph-scale 0.9` runs
the ink to 16×16 and the two circles look the same size.

**Badge position.** Bottom-right, the corner Slack uses: its dot lands +2.5px
right and +2.5px down of its mark's centre. This one is bigger and further out
(10px against 7, at +5 and +4.5) because it has to be legible on its own rather
than decorate a mark you already know.

Pushing a badge into the corner is the one thing the canvas fights: the tray
scales the whole square, so a badge already at the edge cannot travel further
out — the only way to give it the corner is to move the *glyph* aside.
`--glyph-offset` does that sideways only. The same nudge downwards costs the
one thing the eye checks in a row of bar icons: they sit on a shared line, and
a glyph a pixel below it reads as broken long before an off-centre badge does.

**Bar widget alignment.** The bar positions glyphs by the font's **line box**,
not by their ink — that is what keeps letters and digits from drifting against
each other, and the shell's `OpticalGlyph` corrects only the horizontal bounds
for the same reason. `󰖣` has a taller ink box than the text around it, so it
rides high; `glyphSize` and `glyphOffsetY` default to one pixel under the bar's
icon size, nudged half a pixel up, which puts it on the same rows as the
chevron and the same centre as the clock. Change the glyph and re-tune the pair.

## Test coverage

The daemon is exercised end to end over D-Bus: `Activate`, the menu's
`Event`, the show/hide cycle, and the badge appearing and clearing as a window
title changes. The **bar widget's click path is verified by reading only** —
there is no pointer-injection tool on a stock Omarchy box (`wtype` is keyboard
only) and the shell's IPC does not expose bar-widget methods, so a click cannot
be synthesised. Its logic mirrors the daemon's.
