// ==UserScript==
// @name         Warera User Notes
// @namespace    local.warera.notes
// @version      0.1.0
// @description  Add local, persistent notes to Warera user links.
// @match        https://app.warera.io/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
 * ⚠️  LEGACY STANDALONE SCRIPT — no longer actively developed.
 *
 * Player notes are now built into PROST (warera-prost.user.js) as an
 * optional feature. Enable them in the PROST settings (⚙️) under
 * "Spieler-Notizen bei Spieler-Links 📒 (experimentell)".
 *
 * Use this script OR the built-in PROST notes — not both at the same time.
 * Both use the same GM storage keys (warera-note:<userId>) so your saved
 * notes will be visible in either one.
 */

(function () {
  "use strict";

  const LINK_SELECTOR = "a[href*='/user/']";
  const ATTACHED_ATTR = "data-warera-note-attached";
  const NOTE_KEY_PREFIX = "warera-note:";
  const SCAN_DEBOUNCE_MS = 150;

  const I18N = {
    en: {
      editNote: "Edit note",
      editNoteAria: "Edit note for {user}",
      close: "Close",
      closeEditorAria: "Close note editor",
      notePlaceholder: "Note for this player...",
      deleteNote: "Delete",
      cancel: "Cancel",
      save: "Save",
      noteTitle: "Note: {user}",
      userLabel: "User",
    },
    de: {
      editNote: "Notiz bearbeiten",
      editNoteAria: "Notiz für {user} bearbeiten",
      close: "Schließen",
      closeEditorAria: "Notizeditor schließen",
      notePlaceholder: "Notiz zu diesem Spieler...",
      deleteNote: "Löschen",
      cancel: "Abbrechen",
      save: "Speichern",
      noteTitle: "Notiz: {user}",
      userLabel: "Benutzer",
    },
  };

  let activeUserId = null;
  let activeUserName = "";
  let scanTimer = null;

  GM_addStyle(`
    .warera-note-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-left: 4px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: #9ca3af;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      vertical-align: middle;
    }

    .warera-note-icon:hover,
    .warera-note-icon:focus-visible {
      background: rgba(148, 163, 184, 0.18);
      color: #facc15;
      outline: none;
    }

    .warera-note-icon.has-note {
      color: #facc15;
    }

    .warera-note-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(15, 23, 42, 0.62);
    }

    .warera-note-backdrop.is-open {
      display: flex;
    }

    .warera-note-modal {
      width: min(520px, 100%);
      border: 1px solid rgba(148, 163, 184, 0.36);
      border-radius: 8px;
      background: #111827;
      color: #f9fafb;
      box-shadow: 0 18px 55px rgba(0, 0, 0, 0.42);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .warera-note-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    }

    .warera-note-title {
      min-width: 0;
      margin: 0;
      overflow: hidden;
      color: #f9fafb;
      font-size: 16px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .warera-note-close {
      flex: 0 0 auto;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #d1d5db;
      cursor: pointer;
      font-size: 24px;
      line-height: 1;
    }

    .warera-note-close:hover,
    .warera-note-close:focus-visible {
      background: rgba(148, 163, 184, 0.18);
      outline: none;
    }

    .warera-note-body {
      padding: 16px;
    }

    .warera-note-textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 180px;
      resize: vertical;
      border: 1px solid rgba(148, 163, 184, 0.42);
      border-radius: 6px;
      background: #020617;
      color: #f9fafb;
      padding: 10px 12px;
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .warera-note-textarea:focus {
      border-color: #facc15;
      outline: none;
      box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.18);
    }

    .warera-note-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 0 16px 16px;
    }

    .warera-note-button {
      min-height: 36px;
      border: 1px solid rgba(148, 163, 184, 0.42);
      border-radius: 6px;
      background: #1f2937;
      color: #f9fafb;
      cursor: pointer;
      padding: 0 12px;
      font: 600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .warera-note-button:hover,
    .warera-note-button:focus-visible {
      border-color: #facc15;
      outline: none;
    }

    .warera-note-button.primary {
      border-color: #facc15;
      background: #facc15;
      color: #111827;
    }
  `);

  const modal = createModal();
  document.body.appendChild(modal.backdrop);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.backdrop.classList.contains("is-open")) {
      closeEditor();
    }
  });

  scanUserLinks();

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
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

  function getLocale() {
    if (typeof window !== "undefined" && (window.__WIA_LOCALE__ === "de" || window.__WIA_LOCALE__ === "en")) {
      return window.__WIA_LOCALE__;
    }

    const stored = GM_getValue("wia.locale", "de");
    return stored === "en" ? "en" : "de";
  }

  function t(key, params) {
    const locale = getLocale();
    const dict = I18N[locale] || I18N.en;
    let template = dict[key] || I18N.en[key] || key;

    if (params) {
      Object.keys(params).forEach((param) => {
        template = template.replace(new RegExp(`\\{${param}\\}`, "g"), params[param]);
      });
    }

    return template;
  }

  function scanUserLinks() {
    document.querySelectorAll(LINK_SELECTOR).forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }

      if (link.getAttribute(ATTACHED_ATTR) === "true") {
        return;
      }

      const userId = extractUserId(link);
      if (!userId) {
        return;
      }

      attachNoteIcon(link, userId);
    });
  }

  function attachNoteIcon(link, userId) {
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "warera-note-icon";
    icon.textContent = hasNote(userId) ? "📝" : "✎";
    icon.title = t("editNote");
    icon.setAttribute("aria-label", t("editNoteAria", { user: link.textContent.trim() || t("userLabel") }));

    if (hasNote(userId)) {
      icon.classList.add("has-note");
    }

    icon.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openEditor(userId, link.textContent.trim() || "Benutzer");
    });

    link.insertAdjacentElement("afterend", icon);
    link.setAttribute(ATTACHED_ATTR, "true");
  }

  function extractUserId(link) {
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

  function createModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "warera-note-backdrop";

    const dialog = document.createElement("section");
    dialog.className = "warera-note-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "warera-note-title");

    const header = document.createElement("div");
    header.className = "warera-note-header";

    const title = document.createElement("h2");
    title.id = "warera-note-title";
    title.className = "warera-note-title";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "warera-note-close";
    closeButton.textContent = "×";
    closeButton.title = t("close");
    closeButton.setAttribute("aria-label", t("closeEditorAria"));
    closeButton.addEventListener("click", closeEditor);

    const body = document.createElement("div");
    body.className = "warera-note-body";

    const textarea = document.createElement("textarea");
    textarea.className = "warera-note-textarea";
    textarea.placeholder = t("notePlaceholder");

    const actions = document.createElement("div");
    actions.className = "warera-note-actions";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "warera-note-button";
    deleteButton.textContent = t("deleteNote");
    deleteButton.addEventListener("click", () => {
      saveNote("");
      closeEditor();
    });

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "warera-note-button";
    cancelButton.textContent = t("cancel");
    cancelButton.addEventListener("click", closeEditor);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "warera-note-button primary";
    saveButton.textContent = t("save");
    saveButton.addEventListener("click", () => {
      saveNote(textarea.value);
      closeEditor();
    });

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeEditor();
      }
    });

    header.append(title, closeButton);
    body.append(textarea);
    actions.append(deleteButton, cancelButton, saveButton);
    dialog.append(header, body, actions);
    backdrop.append(dialog);

    return {
      backdrop,
      title,
      textarea,
    };
  }

  function openEditor(userId, userName) {
    activeUserId = userId;
    activeUserName = userName;
    modal.title.textContent = t("noteTitle", { user: userName });
    modal.textarea.value = getNote(userId);
    modal.backdrop.classList.add("is-open");
    modal.textarea.focus();
  }

  function closeEditor() {
    activeUserId = null;
    activeUserName = "";
    modal.backdrop.classList.remove("is-open");
  }

  function getNote(userId) {
    return GM_getValue(noteKey(userId), "");
  }

  function hasNote(userId) {
    return getNote(userId).trim().length > 0;
  }

  function saveNote(note) {
    if (!activeUserId) {
      return;
    }

    GM_setValue(noteKey(activeUserId), note.trim());
    refreshIconsForUser(activeUserId);
  }

  function refreshIconsForUser(userId) {
    document.querySelectorAll(LINK_SELECTOR).forEach((link) => {
      if (!(link instanceof HTMLAnchorElement) || extractUserId(link) !== userId) {
        return;
      }

      const icon = link.nextElementSibling;
      if (!icon || !icon.classList.contains("warera-note-icon")) {
        return;
      }

      const hasSavedNote = hasNote(userId);
      icon.classList.toggle("has-note", hasSavedNote);
      icon.textContent = hasSavedNote ? "📝" : "✎";
      icon.setAttribute(
        "aria-label",
        t("editNoteAria", { user: activeUserName || link.textContent.trim() || t("userLabel") }),
      );
    });
  }

  function noteKey(userId) {
    return `${NOTE_KEY_PREFIX}${userId}`;
  }
})();
