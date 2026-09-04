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

## The shell app and the hover preview

The window title carries one integer, and that is all a content script in
someone else's browser can publish. Message previews need a script we own, so
the shell app runs the same page on Electron with a preload that scrapes the
chat list and hands it out — and three placement decisions fall out of what
each surface can actually do:

- **The preview pops on the bar widget, not the tray icon.** An SNI item never
  hears about the pointer: hover is the host's business end to end, and
  omarchy's `Tray.qml` answers it with the item's tooltip *title* in the
  shared bar bubble — one line, no description field, no per-item popup. No
  daemon change can add more; the widget's own `PopupCard` can draw anything.
  Its `triggerMode: "hover"` skips the focus grab, which is what lets the
  pointer travel from the button into the card without the card closing.
- **The state crosses processes as a file in `$XDG_RUNTIME_DIR`**, written
  tmp-then-rename. A file is the one transport the widget already knows how
  to watch (`FileView`), atomic rename means it never reads half a JSON
  document, and the runtime dir is a private tmpfs — message text stays off
  disk and dies with the session. The widget still ignores the file whenever
  no whatsapp window exists, because a shell that crashed writes no goodbye:
  the orderly path writes `running: false` on quit, the disorderly one leaves
  yesterday's file behind.
- **The title pipe stays on.** The preload republishes `(N) WhatsApp` exactly
  like the content script does, so the tray daemon, the badge fallback and
  plain-Chromium setups all keep working without knowing the shell exists.

The scrape itself trusts as little as possible: every selector sits in `SEL`
at the top of `preload.js`, rows are read titled-spans-first with the row's
`innerText` lines (`[name, time, preview, badge]` in DOM order) as fallback,
and a chat is "unread" by the same badge test and archived exclusion the
content script uses. When WhatsApp redoes its DOM, that one file is the blast
radius.

**Group or one-to-one**, the thing the badge's color says, is the one fact the
sidebar does not hand over: no row, and no element inside one, carries the chat
jid — the only place `@g.us` would spell the answer out. Two proxies for it,
checked in this order:

1. **The avatar of a group without a picture.** It has moved house — a
   `data-icon="default-group"` span in the builds that had `data-icon`, an
   inline `<svg><title>ic-group-filled</title>` in the one this was last
   checked against (where a person's is `person-refreshed-outline-thin`) — so
   both are looked at and matched on the word "group" rather than the full
   name. Right whenever it fires; silent for a group that has a picture.
2. **The sender prefix.** A group's preview line reads "Ana: oi" and a
   one-to-one's never does. An unread chat's last message is incoming by
   definition, so the prefix is there exactly when it is needed. The cost is a
   one-to-one message that happens to open with "word: ", which is why this
   only gets asked after the avatar has said nothing.

`--probe` counts both signals. Both at zero while unread groups sit in the
list is the sign that this went stale — the badge then paints everything the
one-to-one color, which is the old behaviour rather than a wrong one.

Two Electron details that cost a round each: the default user agent advertises
`Electron/` and WhatsApp turns it away — it is stripped before the first load —
and the Wayland app id comes from the `--wayland-app-id` *Chromium switch*
(`--class` is X11-only), which is what makes Hyprland report a class the
daemon's `whatsapp` substring matches.

Jumping to a chat rides the single-instance lock: a second launch of the
shell never opens a window, it forwards its argv (`--open-chat=NAME`) to the
running instance and exits, so the widget "sends a command" by just running
the launcher. The chat is found by its visible name — the only identity the
scraped rows carry — and clicked with the full synthetic sequence (mousedown,
mouseup, click), since React-style lists tend to act on the press rather than
wait for the click.

## Why the tray icon cannot be a plugin

`Quickshell.Services.SystemTray` is a *host*: it consumes items and has no API
to publish one. Appearing in the tray means owning a D-Bus name and answering
`org.kde.StatusNotifierItem`, which no QML plugin loaded into the shell can do.
Hence a separate process.

The right-click menu is a second interface, `com.canonical.dbusmenu`. An SNI
carries no actions of its own beyond a click, so every tray icon that offers a
"Quit" is answering that interface.

"Quit" takes the icon out of the tray as well as closing the window — an item
left behind after quitting is a launcher for an app that was just closed, and
its count can only be zero. It does that by going `Status = "Passive"`, which
hosts answer by dropping the item (omarchy's own tray skips passive items in
`Tray.qml`), **not** by ending the process: the daemon is the only thing
watching for WhatsApp to come back, and an exited daemon watches nothing. So
the icon returns by itself the next time a WhatsApp window appears, however it
was started, which is the case an exiting daemon got wrong.

Ending the process would also be a one-way door in practice — nothing restarts
it before the next login — so the state lives in the daemon instead: `dismissed`
is set by the menu and cleared when the window count goes from none to one. A
close that does not take is the one way that state could strand a running
WhatsApp with no icon, so it is re-checked five seconds later.

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
