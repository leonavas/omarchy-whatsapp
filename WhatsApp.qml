import QtQuick
import Quickshell
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// WhatsApp: a tray-style button for the bar. It opens the web app, parks it in
// a hidden special workspace so it keeps running out of sight, and reads the
// unread count straight off the window title — "(3) WhatsApp" — into a badge.
BarWidget {
  id: root
  moduleName: "leonavas.whatsapp"

  // ---------------------------------------------------------------- settings
  readonly property string url: String(setting("url", "https://web.whatsapp.com/"))
  readonly property string launchCommand: String(setting("launchCommand", ""))
  readonly property string windowClass: String(setting("windowClass", "whatsapp"))
  readonly property string iconStyle: String(setting("iconStyle", "Glyph"))
  readonly property string glyph: String(setting("glyph", "󰖣"))
  readonly property int glyphSize: Math.max(0, Number(setting("glyphSize", 0)))
  readonly property real glyphOffsetY: Number(setting("glyphOffsetY", -0.5))
  readonly property string badgeStyle: String(setting("badge", "Count"))
  readonly property string badgeOverride: String(setting("badgeColor", ""))
  readonly property bool tintWhenUnread: setting("tintWhenUnread", true) !== false
  readonly property string hideMode: String(setting("hideMode", "Special workspace"))
  readonly property string specialName: String(setting("specialWorkspace", "whatsapp"))
  readonly property bool startHidden: setting("startHidden", true) !== false
  readonly property int hideAfterLaunch: Math.max(0, Number(setting("hideAfterLaunch", 8)))
  readonly property bool autoStart: setting("autoStart", false) === true
  readonly property bool dimWhenClosed: setting("dimWhenClosed", true) !== false
  readonly property bool hideWhenNotRunning: setting("hideWhenNotRunning", false) === true
  readonly property bool closeOnMiddle: setting("middleClickCloses", true) !== false

  // ------------------------------------------------------------------- theme
  readonly property color foreground: bar ? bar.barForeground : Color.foreground
  readonly property color urgentColor: bar ? bar.urgent : Color.urgent
  readonly property color badgeColor: root.badgeOverride.length > 0 ? root.badgeOverride : root.urgentColor
  // The bar's own background can be translucent; the count sits on the badge,
  // not on the bar, so it takes the opaque version of that color.
  readonly property color badgeTextColor: Qt.rgba(Color.background.r, Color.background.g, Color.background.b, 1)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // ------------------------------------------------------------------ window
  //
  // Everything the widget shows is derived from the live toplevel: reading
  // `title`, `workspace` and `activated` through the model helpers is what
  // registers them as binding dependencies, so a new message repaints the
  // badge without a timer anywhere in the widget.
  readonly property var toplevels: Hyprland.toplevels ? (Hyprland.toplevels.values || []) : []
  readonly property var window: Model.findWindow(root.toplevels, root.windowClass)
  readonly property bool running: root.window !== null && root.window !== undefined
  readonly property string windowTitle: Model.titleOf(root.window)
  readonly property int unread: Model.unreadFromTitle(root.windowTitle)
  readonly property bool focused: Model.isActive(root.window)
  readonly property bool parked: Model.isParked(root.window, root.specialName)

  // Where the window belongs when it is not put away. Remembered rather than
  // configured, so it goes back where it was last used instead of surfacing
  // on top of whatever workspace happens to be in front. Mutated in place so
  // it never re-fires the binding that feeds it.
  property string homeWorkspace: ""
  onWindowChanged: root.rememberHome()
  Connections {
    target: root.window
    ignoreUnknownSignals: true
    function onWorkspaceChanged() { root.rememberHome() }
  }

  function rememberHome() {
    var name = Model.workspaceName(root.window)
    if (name.length > 0 && name.indexOf("special:") !== 0) root.homeWorkspace = name
  }

  // ------------------------------------------------------------------- icons
  readonly property string appIconSource: Quickshell.iconPath("whatsapp", true)
  readonly property bool useAppIcon: root.iconStyle === "App icon" && root.appIconSource.length > 0
  readonly property color glyphColor: root.unread > 0 && root.tintWhenUnread ? root.urgentColor : root.foreground

  // The bar aligns glyphs by the font's line box, not by their ink, which is
  // what keeps letters and digits from drifting against each other. An icon
  // glyph with a taller ink box than its neighbours therefore sticks out at
  // the top, so this one is drawn a hair under the bar's icon size — measured
  // against the chevron and the clock, one pixel down lands it on their line.
  readonly property int glyphPixelSize: root.glyphSize > 0
    ? root.glyphSize : Math.max(8, Style.bar.iconFont - 1)

  // ----------------------------------------------------------------- actions
  //
  // Hyprland 0.5x takes dispatchers as Lua calls; older ones only understand
  // the flat syntax. `usingLua` is the compositor's own answer to which one is
  // live, so both forms stay available without probing for failures.
  function dispatch(luaForm, legacyForm) {
    Hyprland.dispatch(Hyprland.usingLua === true ? luaForm : legacyForm)
  }

  // Quickshell hands the address over without the `0x` Hyprland wants back in
  // a dispatch, so every call would come back "window not found" without this.
  function windowAddress() {
    var target = root.window
    if (!target || !target.address) return ""
    var value = String(target.address)
    if (value.indexOf("0x") !== 0) value = "0x" + value
    return "address:" + value
  }

  function launch() {
    if (root.launchCommand.length > 0) Util.execDetached(root.launchCommand)
    else Util.execArgv(["omarchy-launch-webapp", root.url])
    if (root.startHidden && root.hideMode === "Special workspace") {
      parkTimer.attempts = 0
      parkTimer.interval = Math.max(1, root.hideAfterLaunch) * 1000
      parkTimer.restart()
    }
  }

  // Focusing a window that sits on another workspace lands the *workspace* and
  // leaves the focus on whatever was last used there — the window itself is
  // only reached by asking a second time, once its workspace is the current
  // one. Two-step behaviour, not a race, so the repeat is the fix.
  function focusWindow() {
    var address = root.windowAddress()
    if (address.length === 0) return
    root.dispatch('hl.dsp.focus({ window = "' + address + '" })', "focuswindow " + address)
    refocusTimer.address = address
    refocusTimer.restart()
  }

  // Out of sight, still running: the window moves to special:<name> without
  // the compositor following it there, which is as close as Hyprland gets to
  // "minimize to tray".
  function park() {
    var address = root.windowAddress()
    if (address.length === 0) return
    var workspace = "special:" + root.specialName
    root.dispatch(
      'hl.dsp.window.move({ window = "' + address + '", workspace = "' + workspace + '", silent = true })',
      "movetoworkspacesilent " + workspace + "," + address)
  }

  // Back to the workspace it was last used on, taking the compositor along:
  // a move that is not silent follows the window and leaves it focused, so
  // WhatsApp returns as an ordinary window on its own screen rather than an
  // overlay on top of whatever is in front.
  function showWindow() {
    var address = root.windowAddress()
    if (address.length === 0) return
    var target = root.homeWorkspace.length > 0 ? root.homeWorkspace
                                               : Model.activeWorkspaceName(Hyprland)
    if (target.length > 0) {
      root.dispatch(
        'hl.dsp.window.move({ window = "' + address + '", workspace = "' + target + '" })',
        "movetoworkspace " + target + "," + address)
    }
    root.focusWindow()
  }

  function closeWindow() {
    var address = root.windowAddress()
    if (address.length === 0) return
    root.dispatch('hl.dsp.window.close({ window = "' + address + '" })', "closewindow " + address)
  }

  // One button, the whole life cycle: open it, bring it back, put it away.
  function toggle() {
    if (!root.running) root.launch()
    else if (root.parked) root.showWindow()
    else if (root.focused && root.hideMode === "Special workspace") root.park()
    else root.focusWindow()
  }

  // Show it without the second half of the toggle: never hides.
  function open() {
    if (!root.running) root.launch()
    else if (root.parked) root.showWindow()
    else root.focusWindow()
  }

  Timer {
    id: refocusTimer
    property string address: ""
    interval: 120
    repeat: false
    onTriggered: if (address.length > 0)
      root.dispatch('hl.dsp.focus({ window = "' + address + '" })', "focuswindow " + address)
  }

  // A bar surface exists per monitor, so every widget on the bar is really N
  // widgets; only the first of them may act on the session as a whole.
  function isPrimaryInstance() {
    var peers = root.bar && typeof root.bar.moduleWidgets === "function"
      ? root.bar.moduleWidgets(root.moduleName) : []
    return peers.length === 0 || peers[0] === root
  }

  // The window is parked only after the page has had time to load: WhatsApp
  // never finishes coming up in a surface the compositor never shows.
  Timer {
    id: parkTimer
    property int attempts: 0
    repeat: false
    onTriggered: {
      if (root.window && !root.parked) { root.park(); return }
      if (root.window) return
      if (parkTimer.attempts >= 5) return
      parkTimer.attempts += 1
      parkTimer.interval = 2000
      parkTimer.restart()
    }
  }

  Timer {
    id: autoStartTimer
    interval: 2500
    repeat: false
    running: root.autoStart
    onTriggered: if (!root.running && root.isPrimaryInstance()) root.launch()
  }

  // ------------------------------------------------------------------ layout
  visible: root.running || !root.hideWhenNotRunning
  implicitWidth: root.visible ? button.implicitWidth : 0
  implicitHeight: root.visible ? button.implicitHeight : 0

  readonly property string tooltip: {
    if (!root.running) return "WhatsApp — click to open"
    if (root.unread > 0)
      return "WhatsApp — " + root.unread + (root.unread === 1 ? " unread chat" : " unread chats")
    return root.parked ? "WhatsApp — running, hidden" : "WhatsApp"
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
    iconComponent: root.useAppIcon ? appIcon : glyphIcon
    active: root.unread > 0
    useActiveColor: root.tintWhenUnread
    dimmed: !root.running && root.dimWhenClosed
    tooltipText: root.tooltip
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.MiddleButton) {
        if (root.closeOnMiddle) root.closeWindow()
      } else if (mouseButton === Qt.RightButton) {
        root.open()
      } else {
        root.toggle()
      }
    }
  }

  // Same centering the shell's own OpticalGlyph does horizontally — correct
  // the painted bounds, leave the baseline alone — plus a vertical nudge the
  // bar's button does not expose.
  Component {
    id: glyphIcon

    Item {
      TextMetrics {
        id: metrics
        font.family: root.fontFamily
        font.pixelSize: root.glyphPixelSize
        text: root.glyph
      }

      Text {
        id: painted
        anchors.centerIn: parent
        anchors.horizontalCenterOffset: painted.implicitWidth / 2
          - (metrics.tightBoundingRect.x + Math.max(1, metrics.tightBoundingRect.width) / 2)
        anchors.verticalCenterOffset: root.glyphOffsetY
        text: root.glyph
        color: root.glyphColor
        font.family: root.fontFamily
        font.pixelSize: root.glyphPixelSize
        renderType: Text.NativeRendering

        Behavior on color {
          enabled: !root.bar || root.bar.foregroundAnimationEnabled
          ColorAnimation { duration: 160 }
        }
      }
    }
  }

  Component {
    id: appIcon

    Image {
      anchors.fill: parent
      fillMode: Image.PreserveAspectFit
      // Decode at physical pixels: the logical size leaves the PNG upscaled
      // and blurry on HiDPI displays.
      sourceSize.width: Math.round(width * Screen.devicePixelRatio)
      sourceSize.height: Math.round(height * Screen.devicePixelRatio)
      source: root.appIconSource
      asynchronous: true
      smooth: true
    }
  }

  // The badge, over the top-right corner of the icon canvas. Anchoring it to
  // the center with an offset rather than to an edge keeps it in the same
  // place on a vertical bar.
  Rectangle {
    id: badge
    readonly property bool dotOnly: root.badgeStyle === "Dot"

    visible: root.unread > 0 && root.badgeStyle !== "None"
    z: 2
    // Same rule the tray daemon paints by: a dot at roughly three fifths of
    // the icon, big enough to catch the eye at bar size.
    height: dotOnly ? Math.round(Style.bar.iconCanvas * 0.6)
                    : Math.round(count.implicitHeight + Style.space(3))
    width: dotOnly ? height : Math.max(height, Math.round(count.implicitWidth + Style.space(6)))
    radius: height / 2
    color: root.badgeColor

    // Bottom-right, the corner Slack's own tray icon uses, so a row of them
    // reads as one thing. Pushed towards it but never past the edge of the
    // widget: the bar is 30px tall and a badge hanging over the rim would be
    // shaved off by the layer surface.
    readonly property int corner: Math.round(Style.bar.iconCanvas / 2)
    readonly property int maxRight: Math.max(0, Math.round((root.width - width) / 2) - Style.space(1))
    readonly property int maxDown: Math.max(0, Math.round((root.height - height) / 2) - Style.space(1))

    anchors.horizontalCenter: parent.horizontalCenter
    anchors.horizontalCenterOffset: Math.min(corner, maxRight)
    anchors.verticalCenter: parent.verticalCenter
    anchors.verticalCenterOffset: Math.min(corner, maxDown)

    Text {
      id: count
      anchors.centerIn: parent
      visible: !badge.dotOnly
      text: Model.badgeLabel(root.unread)
      color: root.badgeTextColor
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
      renderType: Text.NativeRendering
    }
  }
}
