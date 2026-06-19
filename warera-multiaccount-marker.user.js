// ==UserScript==
// @name         Warera Multiaccount Ban Marker
// @namespace    local.warera.multiaccount-marker
// @version      0.1.0
// @description  Mark locally known Warera users who have a visible multiaccount ban entry.
// @match        https://app.warera.io/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  "use strict";

  const LINK_SELECTOR = "a[href*='/user/']";
  const ATTACHED_ATTR = "data-warera-multi-marker-attached";
  const STORE_KEY = "warera-multiaccount-banned-users";
  const SCAN_DEBOUNCE_MS = 150;
  const MULTI_REASON_PATTERN = /using\s+multiaccounts?|multi\s*accounts?/i;

  let scanTimer = null;

  GM_addStyle(`
    .warera-multi-marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-left: 4px;
      border-radius: 4px;
      background: rgba(239, 68, 68, 0.16);
      color: #fca5a5;
      cursor: help;
      font-size: 13px;
      font-weight: 800;
      line-height: 1;
      vertical-align: middle;
    }

    .warera-multi-marker:hover {
      background: rgba(239, 68, 68, 0.24);
      color: #fecaca;
    }

    .warera-multi-link {
      text-decoration: underline;
      text-decoration-color: #ef4444;
      text-decoration-thickness: 2px;
      text-underline-offset: 3px;
    }
  `);

  learnFromCurrentBanPage();
  scanUserLinks();

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
      learnFromCurrentBanPage();
      scheduleScan();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanUserLinks, SCAN_DEBOUNCE_MS);
  }

  function scanUserLinks() {
    const knownUsers = getKnownUsers();

    document.querySelectorAll(LINK_SELECTOR).forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }

      const userId = extractExactProfileUserId(link);
      if (!userId || !knownUsers[userId]) {
        return;
      }

      link.classList.add("warera-multi-link");

      if (link.getAttribute(ATTACHED_ATTR) === "true") {
        return;
      }

      attachMarker(link, knownUsers[userId]);
    });
  }

  function attachMarker(link, userRecord) {
    const marker = document.createElement("span");
    marker.className = "warera-multi-marker";
    marker.textContent = "M";
    marker.title = buildTooltip(userRecord);
    marker.setAttribute("aria-label", buildTooltip(userRecord));

    link.insertAdjacentElement("afterend", marker);
    link.setAttribute(ATTACHED_ATTR, "true");
  }

  function learnFromCurrentBanPage() {
    const userId = extractBanPageUserId(window.location.pathname);
    if (!userId || !MULTI_REASON_PATTERN.test(document.body.textContent || "")) {
      return;
    }

    const userName = getVisibleUserName(userId);
    const knownUsers = getKnownUsers();
    knownUsers[userId] = {
      userId,
      userName,
      reason: "Using multiaccounts",
      sourcePath: window.location.pathname,
      seenAt: new Date().toISOString(),
    };

    GM_setValue(STORE_KEY, knownUsers);
  }

  function getVisibleUserName(userId) {
    const profileLink = document.querySelector(`a[href="/user/${cssEscape(userId)}"]`);
    if (profileLink && profileLink.textContent.trim()) {
      return profileLink.textContent.trim();
    }

    return userId;
  }

  function getKnownUsers() {
    const value = GM_getValue(STORE_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function buildTooltip(userRecord) {
    const name = userRecord.userName || userRecord.userId || "Spieler";
    const date = userRecord.seenAt ? new Date(userRecord.seenAt).toLocaleString() : "unbekannt";
    return `${name}: bekannter Multiaccount-Ban, lokal gesehen am ${date}`;
  }

  function extractExactProfileUserId(link) {
    const href = link.getAttribute("href");
    if (!href) {
      return null;
    }

    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/^\/user\/([^/]+)\/?$/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_) {
      return null;
    }
  }

  function extractBanPageUserId(pathname) {
    const match = pathname.match(/^\/user\/([^/]+)\/bans\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return value.replace(/["\\]/g, "\\$&");
  }
})();
