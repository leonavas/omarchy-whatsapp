// WhatsApp Web keeps its unread count in `document.title` — "(3) WhatsApp" —
// but a Chromium `--app` window of this page never picks those updates up: the
// window title sits on the origin, "web.whatsapp.com", for the whole session,
// so the compositor has nothing to report. A title written from here does
// land, which is why the count is re-published from inside the page.
//
// The count is read from the DOM rather than from `document.title`, since this
// script overwrites that title and would otherwise read its own output back.
(function () {
  "use strict";

  var applied = null;

  // Chats put away in "Archived" carry the same unread badge, and WhatsApp
  // leaves them out of its own count — a stack of archived chats would
  // otherwise light the tray up permanently, with nothing to open.
  var ARCHIVED = '[data-testid="chatlist-panel-archived-button"]';

  function countBadges(pane) {
    var badges = pane.querySelectorAll('[data-testid="icon-unread-count"]');
    var chats = 0;
    for (var i = 0; i < badges.length; i++) {
      if (badges[i].closest(ARCHIVED)) continue;
      chats += 1;
    }
    return chats;
  }

  // Fallback for a build that renames the test id: any badge whose text is a
  // bare number. Same archived exclusion, same language independence.
  function countNumeric(pane) {
    var spans = pane.querySelectorAll("span[aria-label]");
    var chats = 0;
    for (var i = 0; i < spans.length; i++) {
      if (!/^\d+$/.test((spans[i].textContent || "").trim())) continue;
      if (spans[i].closest(ARCHIVED)) continue;
      chats += 1;
    }
    return chats;
  }

  function unreadChats() {
    var pane = document.getElementById("pane-side");
    if (!pane) return 0;
    return pane.querySelector('[data-testid="icon-unread-count"]')
      ? countBadges(pane) : countNumeric(pane);
  }

  function apply() {
    var count = unreadChats();
    var wanted = count > 0 ? "(" + count + ") WhatsApp" : "WhatsApp";

    // Measured against the *live* title, not against the last value written
    // here. WhatsApp keeps setting the title too, and a script that trusts its
    // own memory writes once, gets overwritten, and never speaks again — the
    // window then falls back to showing the origin, with the count nowhere.
    // Comparing with what is actually on the document makes this self-healing.
    if (document.title === wanted && applied === wanted) return;
    applied = wanted;

    // An assignment that does not change the value fires no title change, so
    // clear it first to make sure the compositor is handed a new one.
    document.title = "";
    document.title = wanted;
  }

  // The chat list re-renders on every message; the interval is the backstop
  // for the renders the observer does not see (a collapsed pane, a reconnect).
  var observer = new MutationObserver(apply);
  function watch() {
    var pane = document.getElementById("pane-side");
    if (pane) observer.observe(pane, { childList: true, subtree: true, characterData: true });
    return !!pane;
  }

  if (!watch()) {
    var waiting = setInterval(function () { if (watch()) clearInterval(waiting) }, 1000);
  }
  setInterval(apply, 3000);
  apply();
})();
