// ==UserScript==
// @name         WareEra Inventory Advisor v0.5.5
// @namespace    https://github.com/dev/warera-inventory-advisor
// @version      0.5.5
// @description  Marks inventory equipment as KEEP / SELL / SCRAP based on stats and live market vs. scrap value.
// @author       dev
// @match        https://app.warera.io/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api2.warera.io
// @connect      gateway.warerastats.io
// ==/UserScript==

/*
 * SECURITY / PRIVACY NOTE
 * ----------------------
 * The API token is YOUR personal credential. A userscript sandbox has no real
 * keystore, so the token is stored locally via GM_setValue. The XOR obfuscation
 * below only protects against casual shoulder-surfing in the GM storage viewer —
 * it is NOT encryption and provides NO protection against local malware or
 * another script with GM access. Treat this machine as trusted. Revoke/rotate
 * the token in WareEra if you suspect exposure.
 *
 * TUNING NOTE
 * -----------
 * WareEra ships dynamically-generated CSS class names, so every brittle
 * assumption (selectors, rarity colors, SVG path fingerprints, stat layout)
 * lives in CONFIG below. If the game updates its markup, edit CONFIG first —
 * the logic underneath should not need to change.
 */

(function () {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────────
  // CONFIG — edit here when the game's markup changes
  // ───────────────────────────────────────────────────────────────────────────
  const CONFIG = {
    // --- API ---
    // tRPC base. The script probes both until one answers; first success wins
    // and is cached for the session.
    apiBases: ['https://api2.warera.io/trpc', 'https://api2.warera.io/api/trpc'],
    authHeaderMode: 'bearer',           // 'bearer' -> "Authorization: Bearer <t>", or 'x-api-token' / 'x-api-key'
    pricesEndpoint: 'itemTrading.getPrices',
    // getPrices returns MATERIALS only; the scrap unit price is the 'scraps' key.
    scrapItemCode: 'scraps',
    // Equipment market data (falls back to api2 instead of load-balanced api1-api6 hosts).
    // One request per itemCode (e.g. "gloves6") returns live sell offers w/ skills.
    offersApiBase: 'https://api2.warera.io/trpc',
    itemOffersEndpoint: 'itemOffer.getItemOffers',
    offersLimit: 20,                    // how many offers to pull per itemCode
    useLiveOffersApi: false,            // disabled to avoid 401, using scraped market floors instead

    // --- caching / rate-limit ---
    priceCacheTtlMs: 20 * 60 * 1000,    // 20 min (spec: 15-30 min)
    scrapedPriceTtlMs: 6 * 60 * 60 * 1000, // 6 hours for scraped market prices
    txCacheTtlMs: 60 * 60 * 1000,       // 1 hour for transaction history
    minRequestIntervalMs: 3000,         // throttle: no two network calls closer than this
    rescanDebounceMs: 150,
    rateLimitBackoffMs: 60 * 1000,      // after a 429, suppress requests this long

    // --- DOM ---
    // Item images all live under this path; we climb from the <img> to its card.
    itemImageSelector: "img[src*='/images/items/']",
    cardAncestorMaxClimb: 6,            // how many parents to walk up looking for the "card"

    // SVG path "d" fingerprints — substring-match to identify the stat by its icon.
    // Confirmed from live DOM: attack (sword), crit (burst), armor (shield).
    // helmet/gloves/boots icons not yet sampled -> handled by the unknown-icon fallback.
    statSvgFingerprints: {
      attack: 'M18.8025 2.44L6.9025',
      crit:   'M4.35 21H21V4.35',
      armor:  'M12,1L3,5V11C3,16.55', // mdi-shield — chest/pants "Armor" stat (bare integer)
    },

    // Rarity TIERS 1-6 from the armor alt suffix (e.g. "chest3" -> tier 3).
    // Weapons are tiered unique codes (knife/gun/rifle/sniper/tank/jet).
    // Tier 5-6 names/colors are ASSUMED — correct them if the game differs.
    tiers: {
      1: { label: 'Common',    rgb: [136, 136, 136] }, // gray
      2: { label: 'Uncommon',  rgb: [70, 180, 80] },   // green
      3: { label: 'Rare',      rgb: [60, 130, 240] },  // blue
      4: { label: 'Epic',      rgb: [160, 90, 220] },  // purple
      5: { label: 'Legendary', rgb: [230, 160, 40] },  // gold (assumed)
      6: { label: 'Mythic',    rgb: [230, 70, 70] },   // red (assumed)
    },
    rarityColorMaxDistance: 90,         // max RGB euclidean distance for the color fallback

    // Scrap yield per tier. Confirmed 1-4 = 6/18/54/162 (x3 each); tiers 5-6
    // extrapolated x3 (486/1458) — confirm in-game. scrapValue = yield * scrapPrice.
    scrapYieldByTier: { 1: 6, 2: 18, 3: 54, 4: 162, 5: 486, 6: 1458 },

    // alt-attribute keyword -> item type. Weapons get the score formula; the rest
    // are single-percent-stat armor slots. 'scraps' is the currency, skipped.
    typeByAltKeyword: {
      // weapons (codes confirmed from live DOM: gun/rifle/sniper/knife/jet/tank)
      gun: 'weapon', rifle: 'weapon', sniper: 'weapon', knife: 'weapon',
      jet: 'weapon', tank: 'weapon',
      // armor slots
      helmet: 'helmet', helm: 'helmet',
      gloves: 'gloves', glove: 'gloves',
      vest: 'chest', chest: 'chest', armor: 'chest', body: 'chest',
      pants: 'pants', trousers: 'pants', legs: 'pants',
      boots: 'boots', shoes: 'boots',
      // currency / non-equipment
      scraps: 'scrap', scrap: 'scrap',
    },

    // armor stat per slot (for tooltip labelling)
    statBySlot: {
      helmet: 'Crit Damage',
      gloves: 'Precision',
      chest:  'Armor',
      pants:  'Armor',
      boots:  'Dodge',
    },

    // weapon score = crit * critWeight + attack
    weaponCritWeight: 4.15,

    // Market tax rate when selling items
    sellTaxRate: 0.01,

    // "Good roll" = item stat in the top fraction of LIVE market offers for its
    // itemCode. Data-driven; no hardcoded stat bands. Applies to armor (single
    // skill) and weapons (score). Falls back to inventory ranking if too few
    // offers; if neither is available, decide purely on scrap-vs-market.
    goodRollTopFraction: 1 / 3,
    goodRollMinOffers: 4,               // need >= this many offers to rank a roll
    weaponMinSampleForRanking: 3,       // inventory fallback: >=3 weapons to rank

    statRangesByTier: {
      gloves: {
        1: { min: 1, max: 5 },
        2: { min: 6, max: 10 },
        3: { min: 11, max: 15 },
        4: { min: 21, max: 25 },
        5: { min: 31, max: 40 },
        6: { min: 51, max: 60 }
      },
      boots: {
        1: { min: 1, max: 5 },
        2: { min: 6, max: 10 },
        3: { min: 11, max: 15 },
        4: { min: 21, max: 25 },
        5: { min: 31, max: 40 },
        6: { min: 51, max: 60 }
      },
      pants: {
        1: { min: 1, max: 5 },
        2: { min: 6, max: 10 },
        3: { min: 11, max: 15 },
        4: { min: 21, max: 30 },
        5: { min: 36, max: 50 },
        6: { min: 56, max: 70 }
      },
      chest: {
        1: { min: 1, max: 5 },
        2: { min: 6, max: 10 },
        3: { min: 11, max: 15 },
        4: { min: 21, max: 30 },
        5: { min: 36, max: 50 },
        6: { min: 56, max: 70 }
      },
      helmet: {
        1: { min: 1, max: 15 },
        2: { min: 16, max: 30 },
        3: { min: 31, max: 50 },
        4: { min: 71, max: 90 },
        5: { min: 91, max: 110 },
        6: { min: 121, max: 150 }
      }
    },

    weaponRanges: {
      1: { dmg: { min: 21, max: 40 }, crit: { min: 1, max: 5 } },
      2: { dmg: { min: 51, max: 60 }, crit: { min: 6, max: 10 } },
      3: { dmg: { min: 71, max: 90 }, crit: { min: 11, max: 15 } },
      4: { dmg: { min: 101, max: 130 }, crit: { min: 16, max: 20 } },
      5: { dmg: { min: 141, max: 170 }, crit: { min: 26, max: 35 } },
      6: { dmg: { min: 221, max: 300 }, crit: { min: 41, max: 50 } }
    },

    useHighCritWeightForHold: false,

    debug: true,
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Storage (namespaced GM_* with light token obfuscation)
  // ───────────────────────────────────────────────────────────────────────────
  const NS = 'wia.';
  const KEYS = {
    token: NS + 'token',
    priceCache: NS + 'priceCache',     // { data, fetchedAt } — materials map
    scrapCache: NS + 'scrapCache',     // { price, fetchedAt } — legacy, unused
    offersCache: NS + 'offersCache',   // { [itemCode]: { data, fetchedAt } } — equipment offers
    transactionsCache: NS + 'transactionsCache', // { [itemCode]: { data, fetchedAt } } — equipment transactions
    apiBase: NS + 'apiBase',
    rateLimitedUntil: NS + 'rlUntil',
    scrapedPrices: NS + 'scrapedPrices',
    highCritWeightForHold: NS + 'highCritHold',
  };
  const OBF_KEY = 'wareEra.advisor.v1'; // XOR pad — obfuscation only, not encryption

  function xor(str, pad) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += String.fromCharCode(str.charCodeAt(i) ^ pad.charCodeAt(i % pad.length));
    }
    return out;
  }
  function setToken(t) {
    GM_setValue(KEYS.token, t ? btoa(xor(t, OBF_KEY)) : '');
  }
  function getToken() {
    const raw = GM_getValue(KEYS.token, '');
    if (!raw) return '';
    try { return xor(atob(raw), OBF_KEY); } catch (e) { return ''; }
  }
  // fallback prices helper removed
  function clearCache() {
    GM_setValue(KEYS.priceCache, null);
    GM_setValue(KEYS.scrapCache, null);
    GM_setValue(KEYS.offersCache, {});
    GM_setValue(KEYS.transactionsCache, {});
    GM_setValue(KEYS.scrapedPrices, {});
    GM_setValue(KEYS.apiBase, '');
    inFlightPrices = null;
    log('cache cleared');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Utils
  // ───────────────────────────────────────────────────────────────────────────
  function log(...a) { if (CONFIG.debug) console.log('[WIA]', ...a); }
  function now() { return Date.now(); }
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
  function colorDistance(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  }
  function parseRgb(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // API layer
  // ───────────────────────────────────────────────────────────────────────────
  let inFlightPrices = null; // promise dedup

  function gmRequest({ method, url, headers, data }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method || 'GET',
        url,
        headers: headers || {},
        data,
        timeout: 15000,
        onload: (res) => resolve({ status: res.status, text: res.responseText }),
        onerror: () => reject(new Error('network error: ' + url)),
        ontimeout: () => reject(new Error('timeout: ' + url)),
      });
    });
  }

  function authHeaders() {
    const t = getToken();
    if (!t) return {};
    switch (CONFIG.authHeaderMode) {
      case 'x-api-token': return { 'x-api-token': t };
      case 'x-api-key':   return { 'x-api-key': t };
      case 'bearer':
      default:            return { Authorization: 'Bearer ' + t };
    }
  }

  function isRateLimited() {
    return now() < GM_getValue(KEYS.rateLimitedUntil, 0);
  }
  function rateLimitRemainingMs() {
    return Math.max(0, GM_getValue(KEYS.rateLimitedUntil, 0) - now());
  }
  function tripRateLimit() {
    GM_setValue(KEYS.rateLimitedUntil, now() + CONFIG.rateLimitBackoffMs);
  }

  // tRPC v10 GET batch URL: ?batch=1&input={"0":{"json":<args>}}
  function trpcUrl(base, procedure, args) {
    const input = encodeURIComponent(JSON.stringify({ 0: { json: args === undefined ? null : args } }));
    // encode the procedure too: defense-in-depth so a future endpoint name can't alter the path
    return `${base}/${encodeURIComponent(procedure)}?batch=1&input=${input}`;
  }

  // tRPC batch responses come back as [{ result: { data: { json: <payload> } } }]
  function unwrapTrpc(text) {
    const parsed = JSON.parse(text);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    if (entry && entry.error) {
      throw new Error('trpc: ' + (entry.error.json?.message || 'error'));
    }
    const data = entry && entry.result && entry.result.data;
    if (!data) {
      throw new Error('trpc: missing result data');
    }
    return 'json' in data ? data.json : data;
  }

  // Serialize through a single chain so parallel callers (Promise.all of
  // prices + scrap) are genuinely spaced by minRequestIntervalMs, not racing
  // on a shared lastRequestAt timestamp.
  let throttleChain = Promise.resolve();
  let nextSlot = 0;
  function throttle() {
    const run = throttleChain.then(() => {
      const wait = Math.max(0, nextSlot - now());
      nextSlot = Math.max(now(), nextSlot) + CONFIG.minRequestIntervalMs;
      return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : undefined;
    });
    // keep the chain alive even if a link rejects
    throttleChain = run.catch(() => {});
    return run;
  }

  // Probe configured bases once, remember the one that works.
  async function resolveApiBase(procedure, args) {
    if (isRateLimited()) throw new Error('429');
    const cached = GM_getValue(KEYS.apiBase, '');
    const bases = cached ? [cached, ...CONFIG.apiBases.filter((b) => b !== cached)] : CONFIG.apiBases;
    let lastErr;
    for (const base of bases) {
      try {
        await throttle();
        const res = await gmRequest({ method: 'GET', url: trpcUrl(base, procedure, args), headers: authHeaders() });
        if (res.status === 429) { tripRateLimit(); throw new Error('429'); }
        if (res.status >= 200 && res.status < 300) {
          GM_setValue(KEYS.apiBase, base);
          return { base, payload: unwrapTrpc(res.text) };
        }
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
        if (String(e.message).includes('429')) break;
      }
    }
    throw lastErr || new Error('all API bases failed');
  }

  // Returns a map { itemCode -> price } (best-effort; shape depends on the API).
  async function fetchPrices(force) {
    const cache = GM_getValue(KEYS.priceCache, null);
    if (!force && cache && now() - cache.fetchedAt < CONFIG.priceCacheTtlMs) {
      return cache.data;
    }
    if (isRateLimited()) {
      log('rate-limited, serving stale prices');
      return cache ? cache.data : {};
    }
    if (inFlightPrices) return inFlightPrices; // dedup parallel callers

    inFlightPrices = (async () => {
      try {
        const { payload } = await resolveApiBase(CONFIG.pricesEndpoint, undefined);
        const map = normalizePrices(payload);
        GM_setValue(KEYS.priceCache, { data: map, fetchedAt: now() });
        renderRateLimitBanner();
        return map;
      } catch (e) {
        log('fetchPrices failed:', e.message);
        renderRateLimitBanner();
        return cache ? cache.data : {}; // graceful fallback to stale/empty
      } finally {
        inFlightPrices = null;
      }
    })();
    return inFlightPrices;
  }

  // Accepts several plausible response shapes -> { code: price }.
  function normalizePrices(payload) {
    const map = {};
    if (!payload) return map;
    if (Array.isArray(payload)) {
      for (const it of payload) {
        const code = it.itemCode || it.code || it.item || it.id;
        if (code === '__proto__' || code === 'constructor' || code === 'prototype') continue;
        const price = it.price ?? it.avgPrice ?? it.value ?? it.lastPrice;
        if (code != null && price != null) map[String(code)] = Number(price);
      }
    } else if (typeof payload === 'object') {
      for (const [k, v] of Object.entries(payload)) {
        if (k === '__proto__') continue; // never assign a proto key from untrusted JSON
        if (typeof v === 'number') map[k] = v;
        else if (v && typeof v === 'object') {
          const p = v.price ?? v.avgPrice ?? v.value;
          if (p != null && !isNaN(Number(p))) map[k] = Number(p); // keep legit 0, drop NaN
        }
      }
    }
    return map;
  }

  // ── Equipment offers (api2/dynamic) ──────────────────────────────────────
  // One request per itemCode ("gloves6"), cached hard (priceCacheTtlMs). Returns
  // { offers: [{price, skills}], floor }. We use the resolved working apiBase to
  // bypass unreachable API hosts.
  const offersInFlight = {}; // code -> promise (dedup)

  async function fetchItemOffers(code, force) {
    if (!code) return null;
    if (!CONFIG.useLiveOffersApi) {
      const store = GM_getValue(KEYS.scrapedPrices, {}) || {};
      const cached = store[code];
      if (cached && now() - cached.fetchedAt < CONFIG.scrapedPriceTtlMs) {
        return { offers: [], floor: cached.price, fetchedAt: cached.fetchedAt };
      }
      return null;
    }
    const store = GM_getValue(KEYS.offersCache, {});
    const cached = store[code];
    if (!force && cached && now() - cached.fetchedAt < CONFIG.priceCacheTtlMs) return cached.data;
    if (isRateLimited()) return cached ? cached.data : null;
    if (offersInFlight[code]) return offersInFlight[code];

    offersInFlight[code] = (async () => {
      try {
        await throttle();
        const input = encodeURIComponent(JSON.stringify({
          0: { itemCode: code, limit: CONFIG.offersLimit, direction: 'forward' },
        }));
        const base = GM_getValue(KEYS.apiBase, CONFIG.offersApiBase);
        const url = `${base}/${encodeURIComponent(CONFIG.itemOffersEndpoint)}?batch=1&input=${input}`;
        const res = await gmRequest({ method: 'GET', url, headers: authHeaders() });
        if (res.status === 429) { tripRateLimit(); return cached ? cached.data : null; }
        if (res.status < 200 || res.status >= 300) return cached ? cached.data : null;
        const data = normalizeOffers(unwrapTrpc(res.text));
        const next = GM_getValue(KEYS.offersCache, {});
        next[code] = { data, fetchedAt: now() };
        GM_setValue(KEYS.offersCache, next);
        return data;
      } catch (e) {
        log('fetchItemOffers failed:', code, e.message);
        return cached ? cached.data : null;
      } finally {
        renderRateLimitBanner();
        delete offersInFlight[code];
      }
    })();
    return offersInFlight[code];
  }

  // ── Equipment transactions (gateway/historical) ──────────────────────────
  const transactionsInFlight = {}; // code -> promise (dedup)

  async function fetchItemTransactions(code, force) {
    if (!code) return null;
    const store = GM_getValue(KEYS.transactionsCache, {}) || {};
    const cached = store[code];
    if (!force && cached && now() - cached.fetchedAt < CONFIG.txCacheTtlMs) return cached.data;
    if (isRateLimited()) return cached ? cached.data : null;
    if (transactionsInFlight[code]) return transactionsInFlight[code];

    transactionsInFlight[code] = (async () => {
      try {
        const url = 'https://gateway.warerastats.io/trpc/transaction.getPaginatedTransactions';
        const body = JSON.stringify({
          limit: 100,
          itemCode: code
        });
        const res = await gmRequest({
          method: 'POST',
          url,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'wia-userscript'
          },
          data: body
        });
        if (res.status === 429) { tripRateLimit(); return cached ? cached.data : null; }
        if (res.status < 200 || res.status >= 300) return cached ? cached.data : null;
        
        const data = JSON.parse(res.text);
        const items = data?.result?.data?.items || [];
        
        const next = GM_getValue(KEYS.transactionsCache, {}) || {};
        next[code] = { data: items, fetchedAt: now() };
        GM_setValue(KEYS.transactionsCache, next);
        return items;
      } catch (e) {
        log('fetchItemTransactions failed:', code, e.message);
        return cached ? cached.data : null;
      } finally {
        renderRateLimitBanner();
        delete transactionsInFlight[code];
      }
    })();
    return transactionsInFlight[code];
  }

  // payload: { items: [{ price, item: { skills: {...} } }], nextCursor }
  function normalizeOffers(payload) {
    const items = (payload && payload.items) || [];
    const offers = items.map((o) => ({
      price: Number(o.price),
      skills: (o.item && o.item.skills) || {},
    })).filter((o) => !isNaN(o.price));
    const floor = offers.length ? Math.min(...offers.map((o) => o.price)) : null;
    return { offers, floor };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DOM parsing
  // ───────────────────────────────────────────────────────────────────────────
  function isInsideModalOrSidebar(el) {
    let parent = el.parentElement;
    while (parent) {
      const className = (parent.className || '').toString().toLowerCase();
      const role = (parent.getAttribute('role') || '').toLowerCase();
      const id = (parent.id || '').toLowerCase();
      if (
        className.includes('modal') ||
        className.includes('drawer') ||
        className.includes('sheet') ||
        className.includes('dialog') ||
        className.includes('sidebar') ||
        className.includes('popup') ||
        className.includes('popover') ||
        className.includes('details') ||
        id.includes('modal') ||
        id.includes('drawer') ||
        id.includes('sheet') ||
        id.includes('dialog') ||
        role === 'dialog' ||
        role === 'alertdialog' ||
        parent.tagName === 'ASIDE'
      ) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function findItemUniqueId(card) {
    if (!card) return null;
    // 1. Check card element itself
    if (card.id && !card.id.startsWith('wia-')) return card.id;
    for (const attr of ['data-id', 'data-item-id', 'data-uid']) {
      const val = card.getAttribute(attr);
      if (val) return val;
    }
    // 2. Check all descendants for typical ID attributes
    const elWithId = card.querySelector('[data-id], [data-item-id], [data-uid], a[href*="/item/"], button[id]');
    if (elWithId) {
      for (const attr of ['data-id', 'data-item-id', 'data-uid']) {
        const val = elWithId.getAttribute(attr);
        if (val) return val;
      }
      if (elWithId.id && !elWithId.id.startsWith('wia-')) return elWithId.id;
      const href = elWithId.getAttribute('href');
      if (href) {
        const m = href.match(/\/item[s]?\/([^/?#]+)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  function findMarketSellContainer() {
    const main = document.querySelector('main') || document.body;
    if (!main) return null;
    const headers = main.querySelectorAll('div');
    for (const h of headers) {
      if (h.textContent.trim() === 'Item' && h.nextElementSibling) {
        const sib = h.nextElementSibling;
        if (sib.querySelector(CONFIG.itemImageSelector)) {
          return sib;
        }
      }
    }
    return null;
  }

  function findItemCards(verbose = false) {
    let root = document;
    if (isMarketPage()) {
      const sellContainer = findMarketSellContainer();
      if (sellContainer) {
        root = sellContainer;
        if (verbose) log("findItemCards: limiting scan to market sell container", sellContainer);
      } else {
        return new Map();
      }
    }
    const imgs = root.querySelectorAll(CONFIG.itemImageSelector);
    if (verbose) log(`findItemCards: found ${imgs.length} raw images on page matching "${CONFIG.itemImageSelector}"`);
    const cards = new Map(); // card element -> img
    imgs.forEach((img, idx) => {
      const isModal = isMarketPage() ? false : isInsideModalOrSidebar(img);
      const card = climbToCard(img);
      if (verbose) {
        log(`  [Image #${idx}] alt="${img.getAttribute('alt')}" src="${img.getAttribute('src')}"`);
        log(`    isInsideModalOrSidebar: ${isModal}`);
        log(`    climbToCard resolved element:`, card ? `${card.tagName}.${card.className}` : 'null');
      }

      if (isModal) {
        if (verbose) log(`    -> Skipped (inside modal/sidebar/drawer)`);
        return;
      }
      if (card) {
        const width = card.offsetWidth;
        if (width > 0 && width < 40) {
          if (verbose) log(`    -> Skipped (card too small: ${width}px)`);
          return;
        }
        if (!cards.has(card)) {
          cards.set(card, img);
          if (verbose) log(`    -> Added card`);
        } else {
          if (verbose) log(`    -> Skipped (card already added)`);
        }
      } else {
        if (verbose) log(`    -> Skipped (no valid card element found)`);
      }
    });
    if (verbose) log(`findItemCards: returning ${cards.size} active cards`);
    return cards;
  }

  // Walk up to the element that visually represents the card (has a colored
  // border/background). Falls back to a few levels up from the image.
  function climbToCard(img) {
    let el = img;
    let best = img.parentElement || img;
    for (let i = 0; i < CONFIG.cardAncestorMaxClimb && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const cs = getComputedStyle(el);
      const hasColor =
        parseRgb(cs.borderColor) || parseRgb(cs.backgroundColor) || parseRgb(cs.outlineColor);
      // a card is usually a sized, bordered box of ~48px width. Limit max width
      // to 90px to avoid climbing up to the entire list/grid container on the market page.
      if (hasColor && el.offsetWidth >= 40 && el.offsetHeight >= 40 && el.offsetWidth <= 90) {
        best = el;
      }
    }
    return best;
  }

  function detectType(img, card) {
    const alt = (img.getAttribute('alt') || '').toLowerCase().trim();
    const src = (img.getAttribute('src') || '').toLowerCase();
    // sprite basename (chest.png -> "chest") is the clean TYPE key.
    const srcBase = (src.match(/\/images\/items\/([^/.?#]+)/) || [])[1] || '';
    // itemCode = the full alt ("gloves6", "chest3", "sniper") — what the market API keys on.
    const code = alt || srcBase || null;
    // tier 1-6 from the trailing digit of the code (armor); weapons have none.
    const tm = (code || '').match(/(\d+)\s*$/);
    let tier = tm ? parseInt(tm[1], 10) : null;

    let type = 'unknown';
    const cleanCode = code ? code.replace(/\d+$/, '').trim() : '';
    const cleanSrcBase = srcBase ? srcBase.replace(/\d+$/, '').trim() : '';
    for (const [kw, t] of Object.entries(CONFIG.typeByAltKeyword)) {
      if (cleanCode === kw || cleanSrcBase === kw || alt === kw) { type = t; break; }
    }

    if (type === 'weapon' && tier == null && card) {
      const stats = parseStats(card, type);
      if (stats.attack != null && stats.crit != null) {
        for (const [tStr, range] of Object.entries(CONFIG.weaponRanges)) {
          const t = Number(tStr);
          if (stats.attack >= range.dmg.min && stats.attack <= range.dmg.max &&
              stats.crit >= range.crit.min && stats.crit <= range.crit.max) {
            tier = t;
            break;
          }
        }
      }
    }
    return { type, alt, code, srcBase, tier };
  }

  // Color-based tier fallback, used ONLY when the alt carries no suffix digit.
  // Border/outline/shadow carry the tier tint; backgroundColor is a last resort
  // (a dark theme bg sits near gray and would mis-lock to tier 1).
  function detectTierByColor(card) {
    const elementsToCheck = [card, ...card.querySelectorAll('div')];
    for (const el of elementsToCheck) {
      if (el.className && el.className.includes('wia-')) continue;
      const cs = getComputedStyle(el);
      const primary = [
        parseRgb(cs.borderTopColor),
        parseRgb(cs.borderColor),
        parseRgb(cs.outlineColor),
        el.style.boxShadow ? null : parseRgb((cs.boxShadow || '').toString()),
      ].filter(Boolean);
      const fallback = [parseRgb(cs.backgroundColor)].filter(Boolean);

      const match = (colors) => {
        let best = null, bestDist = Infinity;
        for (const c of colors) {
          for (const [tier, ref] of Object.entries(CONFIG.tiers)) {
            const d = colorDistance(c, ref.rgb);
            if (d < bestDist) { bestDist = d; best = Number(tier); }
          }
        }
        return bestDist <= CONFIG.rarityColorMaxDistance ? best : null;
      };

      const resolved = match(primary) || match(fallback);
      if (resolved !== null) return resolved;
    }
    return null;
  }

  // Extract stats from the real WareEra card. Each stat is an icon-wrapper
  // (.a6izou0) holding an <svg><path> plus a value <span> as its next text.
  // Weapon: attack (int) + crit (%). Armor: a single bare integer next to a
  // slot icon (shield = Armor). Durability is the only % on an armor card and
  // is rendered in a separate progress bar (NOT under .a6izou0).
  function parseStats(card, type) {
    const cleanCard = card.cloneNode(true);
    cleanCard.querySelectorAll('[class^="wia-"]').forEach((badge) => {
      badge.remove();
    });
    cleanCard.querySelectorAll('*').forEach(child => {
      child.insertAdjacentText('afterend', ' ');
    });

    const stats = { attack: null, crit: null, primaryPercent: null, durability: null };
    const fp = CONFIG.statSvgFingerprints;

    let unknownStatVal = null; // value of an unrecognized stat icon (helmet/gloves/boots)
    const cleanIcons = cleanCard.querySelectorAll('.a6izou0');
    cleanIcons.forEach((cleanIcon) => {
      const path = cleanIcon.querySelector('path');
      const d = path ? (path.getAttribute('d') || '') : '';
      const val = numberNearClean(cleanIcon);
      if (val == null) return;
      if (d.includes(fp.attack)) stats.attack = val;
      else if (d.includes(fp.crit)) stats.crit = val;
      else if (fp.armor && d.includes(fp.armor)) stats.primaryPercent = val;
      else if (unknownStatVal == null) unknownStatVal = val; // first unrecognized slot icon
    });

    // armor slots whose icon we don't fingerprint yet (helmet/gloves/boots/pants):
    // fall back to the first unrecognized stat-icon value.
    if (type !== 'weapon' && stats.primaryPercent == null && unknownStatVal != null) {
      stats.primaryPercent = unknownStatVal;
    }

    // durability = the trailing % in the card (the progress bar). Stat icons
    // carry their own numbers above, so the last % is durability.
    const text = (cleanCard.textContent || '').replace(/\s+/g, ' ').trim();
    const percents = (text.match(/(\d+(?:\.\d+)?)\s*%/g) || []).map(parseFloat);
    if (percents.length) stats.durability = percents[percents.length - 1];

    // scrap yield is NOT shown on the inventory card in WareEra; fall back to a
    // configurable per-rarity table (set in evaluate, where rarity is known).
    stats.scrapYield = extractScrapYieldClean(card, cleanCard);
    return stats;
  }

  // Find the numeric text associated with a clean svg/path element. Climb until
  // an ancestor's text contains exactly one number — that is the stat's own
  // value box. A multi-number ancestor means we climbed too far (it now spans
  // sibling stats), so return the last single-number result instead of grabbing
  // an unrelated figure.
  function numberNearClean(cleanNode) {
    let el = cleanNode;
    for (let i = 0; i < 4 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const nums = text.match(/\d+(?:\.\d+)?/g) || [];
      if (nums.length === 1) {
        return parseFloat(nums[0]);
      } else if (nums.length > 1) {
        break; // spans more than this stat — stop
      }
    }
    return null;
  }

  function extractScrapYieldClean(originalCard, cleanCard) {
    // Look for a scrap icon inside the card and read its adjacent number,
    // otherwise scan text near the word "scrap".
    const scrapImg = originalCard.querySelector("img[src*='scrap'], img[alt*='scrap' i]");
    if (scrapImg) {
      const imgs = Array.from(originalCard.querySelectorAll('img'));
      const idx = imgs.indexOf(scrapImg);
      if (idx !== -1) {
        const cleanImgs = cleanCard.querySelectorAll('img');
        if (cleanImgs[idx]) {
          const n = numberNearClean(cleanImgs[idx]);
          if (n != null) return n;
        }
      }
    }
    const text = (cleanCard.textContent || '').replace(/\s+/g, ' ').trim();
    const m = (text || '').match(/(\d+)\s*scraps?/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Evaluation
  // ───────────────────────────────────────────────────────────────────────────
  const ACTION = { KEEP: 'KEEP', SELL: 'SELL', SCRAP: 'SCRAP', HOLD: 'HOLD', UNKNOWN: 'UNKNOWN' };

  // The comparable scalar for an item/offer of a given type:
  // weapon -> score (crit*weight + attack); armor -> its single skill value.
  function statForType(type, skills) {
    if (!skills) return null;
    if (type === 'weapon') {
      const crit = Number(skills.criticalChance ?? skills.critChance ?? skills.crit ?? 0);
      const attack = Number(skills.attack ?? 0);
      if (!attack && !crit) return null;
      return crit * CONFIG.weaponCritWeight + attack;
    }
    const vals = Object.values(skills).map(Number).filter((n) => !isNaN(n));
    return vals.length ? vals[0] : null; // single skill per armor piece
  }

  // My item's comparable scalar, from the DOM-parsed stats.
  function itemStat(item) {
    if (item.type === 'weapon') return statForType('weapon', { attack: item.stats.attack, crit: item.stats.crit });
    return item.stats.primaryPercent;
  }

  // Market value for MY roll: cheapest live offer at-or-above my stat (what I'd
  // have to undercut), else the floor. null if no offers.
  function marketForRoll(offerData, type, myStat) {
    if (!offerData || !offerData.offers.length) return null;
    if (myStat == null) return offerData.floor;
    const atOrAbove = offerData.offers
      .filter((o) => { const s = statForType(type, o.skills); return s != null && s >= myStat; })
      .map((o) => o.price);
    return atOrAbove.length ? Math.min(...atOrAbove) : offerData.floor;
  }

  // Is my stat in the top fraction of the live offer distribution? null if too
  // few offers to judge.
  function isTopRoll(offerData, type, myStat) {
    if (!offerData) return null;
    const stats = offerData.offers.map((o) => statForType(type, o.skills)).filter((n) => n != null).sort((a, b) => a - b);
    if (stats.length < CONFIG.goodRollMinOffers) return null;
    const k = Math.max(1, Math.floor(stats.length * CONFIG.goodRollTopFraction));
    const cutoff = stats[stats.length - k];
    return myStat != null && myStat >= cutoff;
  }

  function getTransactionReferencePrice(txs, type, myStat) {
    if (!txs || !txs.length || myStat == null) return null;
    
    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
    
    const validTxs = txs.map(tx => {
      const t = tx.createdAt ? Date.parse(tx.createdAt) : NaN;
      if (!Number.isFinite(t) || t < sixDaysAgo) return null;
      if (tx.transactionType !== 'itemMarket') return null;
      
      const score = statForType(type, tx.item?.skills);
      return {
        price: tx.money,
        score,
        diff: score != null ? Math.abs(score - myStat) : Infinity
      };
    }).filter(t => t != null && t.price != null && t.score != null && t.diff !== Infinity);

    if (!validTxs.length) return null;

    // Sort by diff ascending
    validTxs.sort((a, b) => a.diff - b.diff);

    const closest = [];
    let i = 0;
    while (i < validTxs.length) {
      const currentDiff = validTxs[i].diff;
      const group = [];
      while (i < validTxs.length && validTxs[i].diff === currentDiff) {
        group.push(validTxs[i]);
        i++;
      }
      closest.push(...group);
      if (closest.length >= 3) {
        break;
      }
    }

    const sum = closest.reduce((acc, t) => acc + t.price, 0);
    return {
      price: sum / closest.length,
      count: closest.length,
      diff: closest[0]?.diff ?? 0
    };
  }

  function evaluate(item, ctx) {
    const { type, tier, stats } = item;
    const reasons = [];

    if (type === 'scrap' || type === 'unknown') {
      return { action: ACTION.UNKNOWN, reason: 'not equipment', market: null, scrapValue: null };
    }

    item.stale = ctx.stale;
    const myStat = itemStat(item);
    item.myStat = myStat;
    if (type === 'weapon') item.weaponScore = myStat;

    // Calculate HOLD range-based check dynamically
    const critWeight = CONFIG.useHighCritWeightForHold ? 6.0 : CONFIG.weaponCritWeight;
    let isTopItemscore = false;
    let rangeLabel = '';
    let thresholdVal = 0;
    let rangeMin = 0;
    let rangeMax = 0;

    if (type === 'weapon') {
      const wRange = CONFIG.weaponRanges[tier];
      if (wRange && myStat != null) {
        const attack = stats.attack ?? 0;
        const crit = stats.crit ?? 0;
        const holdScore = attack + crit * critWeight;
        rangeMin = wRange.dmg.min + wRange.crit.min * critWeight;
        rangeMax = wRange.dmg.max + wRange.crit.max * critWeight;
        thresholdVal = rangeMin + 0.90 * (rangeMax - rangeMin);
        if (holdScore >= thresholdVal) {
          isTopItemscore = true;
        }
        rangeLabel = `score ${fmt(holdScore)} >= ${fmt(thresholdVal)} [90% of range ${fmt(rangeMin)} - ${fmt(rangeMax)}]`;
      }
    } else {
      const range = CONFIG.statRangesByTier[type]?.[tier];
      if (range && myStat != null) {
        rangeMin = range.min;
        rangeMax = range.max;
        thresholdVal = rangeMin + 0.90 * (rangeMax - rangeMin);
        if (myStat >= thresholdVal) {
          isTopItemscore = true;
        }
        const isPercent = type === 'helmet' ? '%' : '';
        rangeLabel = `stat ${fmt(myStat)}${isPercent} >= ${fmt(thresholdVal)}${isPercent} [90% of range ${rangeMin}${isPercent} - ${rangeMax}${isPercent}]`;
      }
    }

    // scrap value = live scrap unit price * per-tier yield.
    const scrapPrice = ctx.scrapPrice;
    const scrapYield = tier != null ? CONFIG.scrapYieldByTier[tier] ?? null : null;
    item.scrapYield = scrapYield;
    item.scrapPriceUnit = scrapPrice;
    const scrapValue = scrapPrice != null && scrapYield != null ? scrapPrice * scrapYield : null;

    // market value from live offers (roll-aware)
    const offerData = item.code ? ctx.offers[item.code] : null;
    const txData = item.code ? ctx.txs[item.code] : null;

    const txRef = getTransactionReferencePrice(txData, type, myStat);
    item.txRefPrice = txRef ? txRef.price : null;
    item.txClosestCount = txRef ? txRef.count : 0;
    item.txClosestDiff = txRef ? txRef.diff : null;
    
    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
    item.txCount = txData ? txData.filter(t => {
      const parsedTime = t.createdAt ? Date.parse(t.createdAt) : NaN;
      return Number.isFinite(parsedTime) && parsedTime >= sixDaysAgo && t.money != null && t.transactionType === 'itemMarket';
    }).length : 0;

    let market = item.txRefPrice;
    let marketSource = 'transactions';

    if (market == null) {
      market = marketForRoll(offerData, type, myStat);
      marketSource = 'offers';
      if (market == null) {
        if (offerData && offerData.floor != null) {
          market = offerData.floor;
          marketSource = 'offersFloor';
        }
      }
    }
    item.marketSource = marketSource;
    item.marketIsFallback = false;
    item.marketFloor = offerData ? offerData.floor : null;
    item.offerCount = offerData ? offerData.offers.length : 0;

    // 1) Rule: Keep top 3 of stock per color/tier
    if (item.isStockKeep === true) {
      const label = type === 'weapon' ? `weapon (T${tier})` : item.code;
      reasons.push(`Stock: top 3 roll (#${item.stockRank} of ${item.stockSize} ${label})`);
      return decide(ACTION.KEEP, reasons, market, scrapValue);
    }

    // 2) Rule: Blue (T3) shoes/gloves/vest/pants basestat >= 11
    if (tier === 3 && type !== 'weapon' && (type === 'boots' || type === 'gloves' || type === 'chest' || type === 'pants')) {
      if (myStat >= 11) {
        reasons.push(`high roll basestat ${fmt(myStat)} >= 11 (T3 blue)`);
        return decide(ACTION.KEEP, reasons, market, scrapValue);
      }
    }

    // 3) Rule: Weapon Crit checks to avoid scrap for T1/T2
    let avoidScrap = false;
    if (type === 'weapon') {
      const crit = stats.crit ?? 0;
      if (tier === 1 && crit >= 4) {
        avoidScrap = true;
        reasons.push(`Critical Condition: T1 weapon crit ${fmt(crit)}% >= 4.00% (range 1% - 5%)`);
      } else if (tier === 2 && crit >= 8) {
        avoidScrap = true;
        reasons.push(`Critical Condition: T2 weapon crit ${fmt(crit)}% >= 8.00% (range 6% - 10%)`);
      }
    }

    // 4) top roll -> KEEP (data-driven against live offers)
    const top = isTopRoll(offerData, type, myStat);
    if (top === true) {
      reasons.push(`stat ${fmt(myStat)} in top ${Math.round(CONFIG.goodRollTopFraction * 100)}% of ${item.offerCount} live offers`);
      return decide(ACTION.KEEP, reasons, market, scrapValue);
    }
    if (top === false) {
      reasons.push(`stat ${fmt(myStat)} not top-roll (${item.offerCount} offers)`);
    } else {
      if (item.isInventoryTopRoll === true) {
        reasons.push(`stat ${fmt(myStat)} in top ${Math.round(CONFIG.goodRollTopFraction * 100)}% of ${item.inventorySampleCount} inventory items`);
        return decide(ACTION.KEEP, reasons, market, scrapValue);
      } else if (item.isInventoryTopRoll === false) {
        reasons.push(`stat ${fmt(myStat)} not top-roll in inventory (${item.inventorySampleCount} items)`);
      } else {
        reasons.push(`roll rank unknown (no offers/inventory comparison)`);
      }
    }

    // 5) economic decision: scrap value vs market value
    const finalDecision = priceDecision({ value: market, isFallback: false }, scrapValue, reasons, avoidScrap);

    if (finalDecision.action !== ACTION.KEEP && isTopItemscore) {
      finalDecision.action = ACTION.HOLD;
      reasons.unshift(`Top Itemscore (${rangeLabel})`);
      finalDecision.reason = reasons.join('; ');
    }

    return finalDecision;
  }

  function priceDecision(mkt, scrapValue, reasons, avoidScrap) {
    const { value } = mkt;

    if (value == null && scrapValue == null) {
      return decide(ACTION.UNKNOWN, [...reasons, 'no price data'], value, scrapValue);
    }
    const taxRate = CONFIG.sellTaxRate ?? 0.01;
    const netMarketValue = value != null ? value * (1 - taxRate) : null;

    if (scrapValue == null) { // no scrap basis -> sell on whatever market we have
      reasons.push(`market ${fmt(value)} (net ${fmt(netMarketValue)}, no scrap value)`);
      if (avoidScrap) {
        reasons.push(`held for Critical Condition`);
        return decide(ACTION.HOLD, reasons, value, scrapValue);
      }
      return decide(ACTION.SELL, reasons, value, scrapValue);
    }
    if (value == null) { // no market -> scrap
      if (avoidScrap) {
        reasons.push(`no market price, but held for Critical Condition`);
        return decide(ACTION.HOLD, reasons, value, scrapValue);
      }
      reasons.push(`scrap ${fmt(scrapValue)} (no market price)`);
      return decide(ACTION.SCRAP, reasons, value, scrapValue);
    }
    if (scrapValue > netMarketValue) {
      if (avoidScrap) {
        reasons.push(`scrap ${fmt(scrapValue)} > market net ${fmt(netMarketValue)} (gross ${fmt(value)}), but held for Critical Condition`);
        return decide(ACTION.HOLD, reasons, value, scrapValue);
      }
      reasons.push(`scrap ${fmt(scrapValue)} > market net ${fmt(netMarketValue)} (gross ${fmt(value)})`);
      return decide(ACTION.SCRAP, reasons, value, scrapValue);
    }
    if (avoidScrap) {
      reasons.push(`market net ${fmt(netMarketValue)} (gross ${fmt(value)}) >= scrap ${fmt(scrapValue)}, but held for Critical Condition`);
      return decide(ACTION.HOLD, reasons, value, scrapValue);
    }
    reasons.push(`market net ${fmt(netMarketValue)} (gross ${fmt(value)}) >= scrap ${fmt(scrapValue)}`);
    return decide(ACTION.SELL, reasons, value, scrapValue);
  }

  function decide(action, reasons, market, scrapValue) {
    return { action, reason: reasons.join('; '), market, scrapValue };
  }
  function fmt(n) { return n == null ? '?' : Number(n).toFixed(2); }

  // "5 min ago" / "just now" / "never" for a stored fetchedAt timestamp.
  function ageLabel(t) {
    if (!t) return 'never';
    const min = Math.floor((now() - t) / 60000);
    if (min <= 0) return 'just now';
    if (min < 60) return `${min} min ago`;
    return `${Math.floor(min / 60)}h ${min % 60}m ago`;
  }

  // Snapshot of cache freshness for the UI indicators.
  function cacheStatus() {
    const pc = GM_getValue(KEYS.priceCache, null);
    const oc = GM_getValue(KEYS.offersCache, {}) || {};
    const tc = GM_getValue(KEYS.transactionsCache, {}) || {};
    const priceStale = pc ? now() - pc.fetchedAt > CONFIG.priceCacheTtlMs : true;
    const offerTimes = Object.values(oc).map((o) => o.fetchedAt).filter(Boolean);
    const txTimes = Object.values(tc).map((t) => t.fetchedAt).filter(Boolean);
    const newestOffer = offerTimes.length ? Math.max(...offerTimes) : null;
    const newestTx = txTimes.length ? Math.max(...txTimes) : null;
    const newestMkt = newestOffer && newestTx ? Math.max(newestOffer, newestTx) : (newestOffer || newestTx);
    return {
      scrapPrice: pc && pc.data ? pc.data[CONFIG.scrapItemCode] ?? null : null,
      scrapFetchedAt: pc ? pc.fetchedAt : null,
      priceFetchedAt: pc ? pc.fetchedAt : null,
      priceCount: pc && pc.data ? Object.keys(pc.data).length : 0,
      offerCodes: Object.keys(oc).length,
      txCodes: Object.keys(tc).length,
      offerFetchedAt: newestMkt,
      // "stale" = materials cache past TTL / missing, or actively rate-limited
      stale: isRateLimited() || priceStale,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rendering
  // ───────────────────────────────────────────────────────────────────────────
  const BADGE_COLORS = {
    KEEP: '#388bfd',   // blue
    SELL: '#3fb950',   // green
    SCRAP: '#f85149',  // red
    HOLD: '#d29922',   // orange
    UNKNOWN: '#8b949e',// gray
  };

  function renderItem(card, item, result) {
    card.dataset.wiaDone = '1';
    card.style.position = card.style.position || 'relative';

    // 1. Existing Badge (action recommendation)
    let badge = card.querySelector('.wia-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'wia-badge';
      card.appendChild(badge);
    }
    const emojiMap = { KEEP: '💎', SELL: '💰', SCRAP: '🔨', HOLD: '✋', UNKNOWN: '❓' };
    badge.textContent = emojiMap[result.action] || '❓';
    badge.style.background = BADGE_COLORS[result.action] || BADGE_COLORS.UNKNOWN;
    badge.style.opacity = item.stale ? '0.55' : '1'; // dim when on cached/stale prices

    const tooltipText = buildTooltip(item, result);
    badge.title = tooltipText;
    card.title = tooltipText;

    // Ensure the card uses column flex direction to stack the banner vertically without shifting
    card.style.display = 'flex';
    card.style.flexDirection = 'column';

    // Clean up old classes if they exist from hot-reloads
    const oldScore = card.querySelector('.wia-score-banner');
    if (oldScore) oldScore.remove();
    const oldPrice = card.querySelector('.wia-price-banner');
    if (oldPrice) oldPrice.remove();
    const oldBottomRow = card.querySelector('.wia-bottom-row');
    if (oldBottomRow) oldBottomRow.remove();

    // 2. Top Banner Container
    let topBanner = card.querySelector('.wia-top-banner');
    if (!topBanner) {
      topBanner = document.createElement('div');
      topBanner.className = 'wia-top-banner';
      card.insertBefore(topBanner, card.firstChild);
    }

    // Score Sub-badge
    let scoreSub = topBanner.querySelector('.wia-score-sub');
    const showScore = item.myStat != null && item.type !== 'helmet';
    if (showScore) {
      if (!scoreSub) {
        scoreSub = document.createElement('div');
        scoreSub.className = 'wia-score-sub';
        topBanner.appendChild(scoreSub);
      }
      const scoreVal = item.myStat;
      scoreSub.textContent = item.type === 'weapon' ? scoreVal.toFixed(0) : scoreVal;
      // Blue if top 3 stock keep, otherwise gray
      const isGood = item.isStockKeep === true;
      scoreSub.style.background = isGood ? '#388bfd' : '#8b949e';
      scoreSub.style.display = 'flex';
    } else if (scoreSub) {
      scoreSub.remove();
    }

    // Price Sub-badge
    let priceSub = topBanner.querySelector('.wia-price-sub');
    const showPrice = result.scrapValue != null || result.market != null;
    if (showPrice) {
      if (!priceSub) {
        priceSub = document.createElement('div');
        priceSub.className = 'wia-price-sub';
        topBanner.appendChild(priceSub);
      }
      const sVal = result.scrapValue;
      const mVal = result.market;

      const formatVal = (v) => {
        if (v == null) return '?';
        if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        if (v >= 100) return v.toFixed(0);
        return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      };

      priceSub.textContent = `${formatVal(sVal)}/${formatVal(mVal)}`;

      // Color: green if scrap > market, orange if scrap <= market, gray if either is null
      if (sVal != null && mVal != null) {
        priceSub.style.background = sVal > mVal ? '#3fb950' : '#d29922';
      } else {
        priceSub.style.background = '#8b949e';
      }
      priceSub.style.display = 'flex';
    } else if (priceSub) {
      priceSub.remove();
    }

    // subtle border tint
    card.style.boxShadow = `inset 0 0 0 2px ${BADGE_COLORS[result.action] || 'transparent'}`;
  }

  function buildTooltip(item, result) {
    const lines = [];
    const tierLabel = item.tier != null ? (CONFIG.tiers[item.tier] || {}).label || `T${item.tier}` : '—';
    lines.push(`${item.code || item.type} · ${tierLabel}${item.tier != null ? ` (T${item.tier})` : ''}`);
    if (item.type === 'weapon') {
      lines.push(`Attack: ${item.stats.attack ?? '?'}  Crit: ${item.stats.crit ?? '?'}%`);
      if (item.weaponScore != null) lines.push(`Weapon score: ${item.weaponScore.toFixed(1)}`);
    } else {
      const label = CONFIG.statBySlot[item.type] || 'Stat';
      lines.push(`${label}: ${item.stats.primaryPercent ?? '?'}`);
    }
    if (item.stats.durability != null) lines.push(`Durability: ${item.stats.durability}%`);
    // scrap side: yield × unit-price = total (yield is a per-tier estimate)
    lines.push(`Scrap: ${item.scrapYield ?? '?'} (est.) × ${fmt(item.scrapPriceUnit)}/u = ${fmt(result.scrapValue)}`);
    // market side: transactions reference, live offers (floor + count) or per-tier estimate
    if (item.marketSource === 'transactions') {
      const diffStr = item.txClosestDiff === 0 ? 'exact match' : `diff ±${fmt(item.txClosestDiff)}`;
      lines.push(`Market value (6d tx ref): ${fmt(result.market)} (avg of ${item.txClosestCount} txs with ${diffStr}, total ${item.txCount} txs)`);
    } else if (item.marketIsFallback) {
      lines.push(`Market value (est., no offers): ${fmt(result.market)}`);
    } else if (item.offerCount === 0 && item.marketFloor != null) {
      lines.push(`Market value (scraped floor): ${fmt(item.marketFloor)}`);
    } else {
      lines.push(`Market value @ roll: ${fmt(result.market)} (floor ${fmt(item.marketFloor)}, ${item.offerCount} offers)`);
    }
    lines.push(`→ ${result.action}: ${result.reason}`);
    if (item.stale) lines.push('⚠ cached/stale prices — refresh in settings');
    return lines.join('\n');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Market scraping & Scan orchestration
  // ───────────────────────────────────────────────────────────────────────────
  let lastNotificationTime = 0;
  function showScrapeNotification(count) {
    if (now() - lastNotificationTime < 3000) return; // debounce toast
    lastNotificationTime = now();

    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 20px; left: 20px; z-index: 100000;
      background: #238636; color: #fff; padding: 12px 18px; border-radius: 6px;
      font: 600 13px system-ui, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,.5);
      border: 1px solid #2ea043; transition: opacity 0.5s ease;
    `;
    toast.textContent = `✓ ${count} Equipment-Preise erfolgreich gescannt!`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 500);
    }, 2500);
  }

  function scrapeMarketPrices() {
    const selectorElements = document.querySelectorAll("[id^='item-code-selector-']");
    if (!selectorElements.length) return;

    const store = GM_getValue(KEYS.scrapedPrices, {}) || {};
    let updatedCount = 0;

    selectorElements.forEach(el => {
      const itemCode = el.id.replace('item-code-selector-', '').trim();
      if (!itemCode) return;

      const text = el.textContent || '';
      const match = text.match(/(\d+(?:\.\d+)?)/);
      if (match) {
        const price = parseFloat(match[1]);
        if (!isNaN(price)) {
          const old = store[itemCode];
          if (!old || old.price !== price || now() - old.fetchedAt > 10 * 60 * 1000) {
            store[itemCode] = { price, fetchedAt: now() };
            updatedCount++;
          }
        }
      }
    });

    if (updatedCount > 0) {
      GM_setValue(KEYS.scrapedPrices, store);
      log(`Scraped ${updatedCount} updated prices`);
      showScrapeNotification(updatedCount);
    }
  }

  function calculateInventoryRankings(items) {
    // Group items by category/tier
    const stockGroups = {}; // stockKey -> array of items
    items.forEach(item => {
      // Group both weapons and armor by their specific item code and tier (e.g. gloves3, rifle-2, gun-1)
      const key = item.type === 'weapon' ? `${item.code}-${item.tier}` : item.code;
      if (!key || item.myStat == null) return;
      if (!stockGroups[key]) stockGroups[key] = [];
      stockGroups[key].push(item);
    });

    for (const key in stockGroups) {
      const groupItems = stockGroups[key];
      // Sort descending (highest stat/score first)
      groupItems.sort((a, b) => b.myStat - a.myStat);
      
      const size = groupItems.length;
      groupItems.forEach((item, index) => {
        item.isStockKeep = index < 3; // Keep the top 3 of stock
        item.stockRank = index + 1;
        item.stockSize = size;

        // Inventory ranking fallback (if size >= 3)
        if (size >= 3) {
          const fraction = index / size;
          item.isInventoryTopRoll = fraction < CONFIG.goodRollTopFraction;
          item.inventorySampleCount = size;
        } else {
          item.isInventoryTopRoll = false;
          item.inventorySampleCount = size;
        }
      });
    }
  }

  let observer = null;
  let observerSuspendCount = 0;
  let scanning = false;
  let lastInventoryCards = null;

  function suspendObserver() {
    observerSuspendCount++;
    if (observerSuspendCount === 1 && observer) {
      observer.disconnect();
    }
  }

  function resumeObserver() {
    observerSuspendCount = Math.max(0, observerSuspendCount - 1);
    if (observerSuspendCount === 0 && observer) {
      updateObserverTarget();
    }
  }

  function hasInventoryChanged(cards) {
    if (!lastInventoryCards || lastInventoryCards.size !== cards.size) return true;

    const currentCards = Array.from(cards.keys());
    const lastCards = Array.from(lastInventoryCards.keys());

    for (let i = 0; i < currentCards.length; i++) {
      const card = currentCards[i];
      const lastCard = lastCards[i];
      if (card !== lastCard) return true;

      const img = cards.get(card);
      const lastImg = lastInventoryCards.get(card);
      if (img !== lastImg) return true;
      if (img.getAttribute('src') !== lastImg.getAttribute('src')) return true;
      if (img.getAttribute('alt') !== lastImg.getAttribute('alt')) return true;

      const itemId = findItemUniqueId(card);
      const lastItemId = findItemUniqueId(lastCard);
      if (itemId !== lastItemId) return true;

      if (!card.querySelector('.wia-badge')) return true;
    }
    return false;
  }

  const pendingFetches = new Set();

  function hasFreshCachedData(code) {
    const oc = GM_getValue(KEYS.offersCache, {}) || {};
    const tc = GM_getValue(KEYS.transactionsCache, {}) || {};
    const cachedOffer = oc[code];
    const cachedTx = tc[code];
    if (CONFIG.useLiveOffersApi) {
      if (!cachedOffer || now() - cachedOffer.fetchedAt >= CONFIG.priceCacheTtlMs) return false;
    }
    if (!cachedTx || now() - cachedTx.fetchedAt >= CONFIG.txCacheTtlMs) return false;
    return true;
  }

  async function fetchAndRenderItemCodeInBackground(code, force) {
    if (pendingFetches.has(code)) return;
    pendingFetches.add(code);

    try {
      log(`Background load started for ${code}`);
      // fetch live equipment offers + transactions
      const [offerData, txData] = await Promise.all([
        fetchItemOffers(code, force),
        fetchItemTransactions(code, force)
      ]);

      const cards = findItemCards(false);
      if (!cards.size) return;

      const allItems = [];
      cards.forEach((img, card) => {
        const { type, alt, code: cCode, tier } = detectType(img, card);
        if (type === 'scrap' || type === 'unknown') return;
        const stats = parseStats(card, type);
        if (stats.durability != null && stats.durability < 100) return;
        const resolvedTier = tier != null ? tier : detectTierByColor(card);
        const item = { card, img, type, alt, code: cCode, tier: resolvedTier, stats };
        item.myStat = itemStat(item);
        if (type === 'weapon') item.weaponScore = item.myStat;
        allItems.push(item);
      });

      if (!allItems.length) return;

      calculateInventoryRankings(allItems);

      const prices = await fetchPrices(false); // from cache, instant
      const scrapPrice = prices ? prices[CONFIG.scrapItemCode] ?? null : null;

      const offers = {};
      const txs = {};
      const uniqueCodes = [...new Set(allItems.map((i) => i.code).filter(Boolean))];
      
      const oc = GM_getValue(KEYS.offersCache, {}) || {};
      const tc = GM_getValue(KEYS.transactionsCache, {}) || {};
      const scraped = GM_getValue(KEYS.scrapedPrices, {}) || {};

      uniqueCodes.forEach((c) => {
        if (!CONFIG.useLiveOffersApi) {
          const cached = scraped[c];
          if (cached && now() - cached.fetchedAt < CONFIG.scrapedPriceTtlMs) {
            offers[c] = { offers: [], floor: cached.price, fetchedAt: cached.fetchedAt };
          }
        } else if (oc[c]) {
          offers[c] = oc[c].data;
        }

        if (tc[c]) {
          txs[c] = tc[c].data;
        }
      });

      const ctx = { prices, scrapPrice, offers, txs, stale: cacheStatus().stale };

      suspendObserver();
      try {
        allItems.forEach((item) => {
          if (item.code === code) {
            const result = evaluate(item, ctx);
            renderItem(item.card, item, result);
          }
        });
      } finally {
        resumeObserver();
      }
      updateStatusIndicator();
      log(`Background update finished for ${code}`);
    } catch (e) {
      log(`Background load failed for ${code}:`, e);
    } finally {
      pendingFetches.delete(code);
    }
  }

  async function scanInventory(force) {
    if (scanning) {
      return;
    }
    const cards = findItemCards(false);
    if (!cards.size) {
      return;
    }

    const changed = hasInventoryChanged(cards);
    if (!changed && !force) {
      return;
    }

    log(`scanInventory started (force=${force})`);
    scanning = true;
    lastInventoryCards = cards;

    try {
      const items = [];
      cards.forEach((img, card) => {
        const { type, alt, code, tier } = detectType(img, card);
        if (type === 'scrap' || type === 'unknown') return;
        const stats = parseStats(card, type);
        
        if (stats.durability != null && stats.durability < 100) {
          const badge = card.querySelector('.wia-badge');
          if (badge) badge.remove();
          const topBanner = card.querySelector('.wia-top-banner');
          if (topBanner) topBanner.remove();
          card.style.boxShadow = '';
          delete card.dataset.wiaDone;
          return;
        }

        const resolvedTier = tier != null ? tier : detectTierByColor(card);
        const item = { card, img, type, alt, code, tier: resolvedTier, stats };
        item.myStat = itemStat(item);
        if (type === 'weapon') item.weaponScore = item.myStat;
        items.push(item);
      });
      if (!items.length) {
        scanning = false;
        return;
      }

      calculateInventoryRankings(items);

      const prices = await fetchPrices(force);
      const scrapPrice = prices ? prices[CONFIG.scrapItemCode] ?? null : null;

      const oc = GM_getValue(KEYS.offersCache, {}) || {};
      const tc = GM_getValue(KEYS.transactionsCache, {}) || {};
      const scraped = GM_getValue(KEYS.scrapedPrices, {}) || {};

      const offers = {};
      const txs = {};
      const codesToFetch = [];

      items.forEach((item) => {
        const c = item.code;
        if (!c) return;

        const hasFresh = hasFreshCachedData(c);

        if (!hasFresh || force) {
          if (!codesToFetch.includes(c) && !pendingFetches.has(c)) {
            codesToFetch.push(c);
          }
        }

        if (!CONFIG.useLiveOffersApi) {
          const cached = scraped[c];
          if (cached && now() - cached.fetchedAt < CONFIG.scrapedPriceTtlMs) {
            offers[c] = { offers: [], floor: cached.price, fetchedAt: cached.fetchedAt };
          }
        } else if (oc[c]) {
          offers[c] = oc[c].data;
        }

        if (tc[c]) {
          txs[c] = tc[c].data;
        }
      });

      const ctx = { prices, scrapPrice, offers, txs, stale: cacheStatus().stale };

      suspendObserver();
      try {
        for (const item of items) {
          const result = evaluate(item, ctx);
          renderItem(item.card, item, result);
        }
      } finally {
        resumeObserver();
      }
      updateStatusIndicator();
      log(`scanned ${items.length} items (immediate render done)`);

      if (codesToFetch.length > 0) {
        log(`Triggering background loads for: ${codesToFetch.join(', ')}`);
        suspendObserver();
        Promise.all(codesToFetch.map((c) => fetchAndRenderItemCodeInBackground(c, force)))
          .finally(() => {
            resumeObserver();
          });
      }

    } catch (e) {
      log('scan error:', e);
    } finally {
      scanning = false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Settings UI
  // ───────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    GM_addStyle(`
      .wia-badge {
        position: absolute; top: 30%; transform: translateY(-50%); right: 4px; z-index: 50;
        width: 20px; height: 20px; border-radius: 50%;
        font: 12px system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        cursor: help; box-shadow: 0 0 4px rgba(0,0,0,.6);
        user-select: none;
        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      }
      .wia-top-banner {
        position: relative; width: 100%; height: 12px; z-index: 60;
        display: flex; justify-content: space-between; box-sizing: border-box;
        margin-bottom: 3px;
      }
      .wia-score-sub, .wia-price-sub {
        font: bold 8px system-ui, sans-serif; padding: 1px 3px; border-radius: 2px;
        color: #fff; display: flex; align-items: center; justify-content: center;
        text-shadow: 0 1px 1px rgba(0,0,0,.5); box-shadow: 0 1px 2px rgba(0,0,0,.3);
      }
      .wia-price-sub {
        margin-left: auto;
      }
      .wia-gear {
        position: fixed; bottom: 18px; right: 18px; z-index: 99999;
        width: 40px; height: 40px; border-radius: 50%;
        background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
        font-size: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.5);
      }
      .wia-gear:hover { background: #30363d; }
      .wia-gear-dot {
        position: absolute; top: -2px; right: -2px;
        width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid #161b22; background: #8b949e;
      }
      .wia-data {
        margin: 10px 0; padding: 8px 10px; border-radius: 6px;
        background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;
        font: 12px/1.5 ui-monospace, monospace; white-space: pre-line;
      }
      .wia-modal-bg {
        position: fixed; inset: 0; z-index: 100000;
        background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center;
      }
      .wia-modal {
        background: #161b22; color: #c9d1d9; border: 1px solid #30363d;
        border-radius: 10px; padding: 20px; width: 420px; max-width: 95vw;
        font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.6);
      }
      .wia-help-details {
        margin-top: 15px; border-top: 1px solid #30363d; padding-top: 10px;
      }
      .wia-help-summary {
        font-weight: 600; color: #58a6ff; cursor: pointer; user-select: none; margin-bottom: 8px;
      }
      .wia-help-content {
        font-size: 11px; line-height: 1.45; color: #8b949e; max-height: 200px; overflow-y: auto; padding-right: 5px;
      }
      .wia-help-content ul { margin: 5px 0; padding-left: 15px; }
      .wia-help-content li { margin-bottom: 4px; }
      .wia-modal h2 { margin: 0 0 12px; font-size: 16px; }
      .wia-modal label { display: block; margin: 10px 0 4px; font-weight: 600; }
      .wia-modal input {
        width: 100%; box-sizing: border-box; padding: 7px 9px;
        background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px;
      }
      .wia-row { display: flex; gap: 8px; }
      .wia-row > div { flex: 1; }
      .wia-btns { display: flex; gap: 8px; margin-top: 16px; }
      .wia-btn {
        flex: 1; padding: 8px; border-radius: 6px; cursor: pointer; border: 1px solid #30363d;
        background: #21262d; color: #c9d1d9; font-weight: 600;
      }
      .wia-btn.primary { background: #238636; border-color: #2ea043; color: #fff; }
      .wia-btn.danger { background: #6e2024; border-color: #b62324; color: #fff; }
      .wia-warn {
        margin: 10px 0; padding: 8px 10px; border-radius: 6px;
        background: #5a1e02; border: 1px solid #bd561d; color: #ffce91; font-weight: 600;
      }
      .wia-note { color: #8b949e; font-size: 11px; margin-top: 6px; }
    `);
  }

  // Color the dot on the gear button: red = rate-limited, amber = stale/missing
  // data, green = fresh. title carries the live numbers on hover.
  function updateStatusIndicator() {
    const dot = document.querySelector('.wia-gear-dot');
    const gear = document.querySelector('.wia-gear');
    if (!dot || !gear) return;
    const s = cacheStatus();
    const color = isRateLimited() ? '#f85149' : s.stale ? '#d29922' : '#3fb950';
    dot.style.background = color;
    gear.title =
      `Inventory Advisor\n` +
      `Scrap price: ${fmt(s.scrapPrice)}/u (${ageLabel(s.scrapFetchedAt)})\n` +
      `Item prices: ${s.priceCount} cached (${ageLabel(s.priceFetchedAt)})\n` +
      `Tx history: ${s.txCodes || 0} items cached` +
      (isRateLimited() ? `\n⚠ API limit — waiting ${Math.ceil(rateLimitRemainingMs() / 1000)}s` : '');
  }

  // Live data strip inside the settings modal. Built with textContent (never
  // innerHTML) so cached values can't become an injection vector.
  function renderDataStrip(el) {
    if (!el) return;
    const s = cacheStatus();
    const scraped = GM_getValue(KEYS.scrapedPrices, {});
    const scrapedCount = Object.keys(scraped).length;
    el.textContent =
      `Scrap price:  ${fmt(s.scrapPrice)} / unit   (fetched ${ageLabel(s.scrapFetchedAt)})\n` +
      `Item prices:  ${s.priceCount} cached         (fetched ${ageLabel(s.priceFetchedAt)})\n` +
      `Scraped mkt:  ${scrapedCount} items stored    (visit Market -> Equipments to update)\n` +
      `Tx history:   ${s.txCodes || 0} items cached\n` +
      `Status:       ${isRateLimited() ? 'RATE-LIMITED' : s.stale ? 'stale (past cache TTL)' : 'fresh'}`;
  }

  let warnBanner = null;
  function renderRateLimitBanner() {
    updateStatusIndicator();
    if (!warnBanner) return;
    if (isRateLimited()) {
      const sec = Math.ceil(rateLimitRemainingMs() / 1000);
      warnBanner.style.display = 'block';
      warnBanner.textContent = `⚠ API-Limit erreicht! Wartezeit aktiv (${sec}s) — zeige zwischengespeicherte Preise.`;
    } else {
      warnBanner.style.display = 'none';
    }
  }

  function openSettings() {
    const bg = document.createElement('div');
    bg.className = 'wia-modal-bg';
    bg.innerHTML = `
      <div class="wia-modal">
        <h2>WareEra Inventory Advisor</h2>
        <div style="font-size: 12px; color: #8b949e; margin-bottom: 12px; line-height: 1.4;">Der Inventory Advisor soll eine schnelle Übersicht geben, ob Items behalten (KEEP/HOLD), gewinnbringend verkauft (SELL) oder zerschreddert (SCRAP) werden sollten.</div>
        <div class="wia-warn" style="display:none"></div>
        <div class="wia-data"></div>
        <label>API-Token (api2.warera.io)</label>
        <input type="password" class="wia-token" placeholder="Bearer token" />
        <div class="wia-note">Lokal gespeichert (GM_setValue, leicht verschleiert — keine echte Verschlüsselung).</div>
        <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" class="wia-high-crit" style="width: auto;" ${CONFIG.useHighCritWeightForHold ? 'checked' : ''} />
          <label style="margin: 0; font-weight: normal; cursor: pointer;">Erhöhte Crit-Gewichtung für HOLD-Bewertung verwenden (6.00 statt 4.15)</label>
        </div>
        <details class="wia-help-details">
          <summary class="wia-help-summary">ℹ Spickzettel (Hilfe & Erklärung)</summary>
          <div class="wia-help-content">
            <strong>Bedeutung der Empfehlungen (Farbe + Symbol):</strong>
            <ul>
              <li>💎 <strong>KEEP (Blau)</strong>: Item behalten. Gilt für die Top 3 deines Bestands (pro Typ/Tier) oder falls das Item unter den besten 33% (Top-Roll) der Live-Angebote oder deines Inventars liegt.</li>
              <li>✋ <strong>HOLD (Orange)</strong>: Behalten / Aufheben. Das Item liegt in den besten 10% des theoretisch möglichen Wertebereichs (Top-Itemscore). Wird nur vergeben, wenn es kein 💎 KEEP ist.</li>
              <li>💰 <strong>SELL (Grün)</strong>: Im Markt verkaufen. Lohnt sich wirtschaftlich, da der Netto-Marktpreis (abzüglich 1% Steuer) den Schredder-Wert übersteigt.</li>
              <li>🔨 <strong>SCRAP (Rot)</strong>: Zerschreddern. Lohnt sich wirtschaftlich, da der Schredder-Wert höher ist als der Netto-Verkaufspreis.</li>
            </ul>
            <strong>Anzeigen auf den Inventarkarten:</strong>
            <ul>
              <li><strong>Oben links (Stat-Wert):</strong> Der Rüstungs-Stat bzw. Waffenscore (Attack + Crit * Gewicht). <em>Blau unterlegt</em> = Top 3 in deinem Bestand (Stock Keep). <em>Grau</em> = Normal.</li>
              <li><strong>Oben rechts (Preise):</strong> Format <code>[Schredder-Wert]/[Marktpreis]</code>. <em>Grün unterlegt</em> = Schreddern lohnt sich mehr. <em>Orange</em> = Verkaufen lohnt sich mehr.</li>
            </ul>
            <strong>Einstellungen:</strong>
            <ul>
              <li><strong>API-Token</strong>: Erforderlich für den Abruf aktueller Marktpreise (Ausrüstung und Schrott).</li>
              <li><strong>Erhöhte Crit-Gewichtung</strong>: Erhöht den Crit-Gewichtungsfaktor bei Waffen von 4.15 auf 6.00 für die HOLD-Prüfung.</li>
            </ul>
          </div>
        </details>
        <div class="wia-btns">
          <button class="wia-btn primary wia-save">Speichern</button>
          <button class="wia-btn wia-clear">Cache leeren</button>
          <button class="wia-btn wia-close">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(bg);

    warnBanner = bg.querySelector('.wia-warn');
    const dataStrip = bg.querySelector('.wia-data');
    renderDataStrip(dataStrip);
    renderRateLimitBanner();

    const tokenInput = bg.querySelector('.wia-token');
    const oldToken = getToken();
    tokenInput.value = oldToken;

    bg.querySelector('.wia-save').onclick = () => {
      const newToken = tokenInput.value.trim();
      const tokenChanged = oldToken !== newToken;
      setToken(newToken);

      const useHighCrit = bg.querySelector('.wia-high-crit').checked;
      GM_setValue(KEYS.highCritWeightForHold, useHighCrit);
      CONFIG.useHighCritWeightForHold = useHighCrit;

      if (tokenChanged) {
        clearCache();
      }
      bg.remove();
      warnBanner = null;
      scanInventory(tokenChanged);
    };
    bg.querySelector('.wia-clear').onclick = () => { clearCache(); renderDataStrip(dataStrip); updateStatusIndicator(); };
    bg.querySelector('.wia-close').onclick = () => { bg.remove(); warnBanner = null; };
    bg.onclick = (e) => { if (e.target === bg) { bg.remove(); warnBanner = null; } };
  }

  function injectGear() {
    if (document.querySelector('.wia-gear')) return;
    const gear = document.createElement('button');
    gear.className = 'wia-gear';
    gear.textContent = '⚙';
    gear.title = 'Inventory Advisor — Einstellungen';
    gear.onclick = openSettings;
    const dot = document.createElement('span'); // live freshness indicator
    dot.className = 'wia-gear-dot';
    gear.appendChild(dot);
    document.body.appendChild(gear);
    updateStatusIndicator();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bootstrap + MutationObserver
  // ───────────────────────────────────────────────────────────────────────────
  function isInventoryPage() {
    return /\/user\/[^/]+\/inventory/.test(location.pathname);
  }

  function isMarketPage() {
    return /\/market\/equipments/.test(location.pathname);
  }

  const debouncedScan = debounce(() => {
    if (isInventoryPage()) {
      scanInventory(false);
    } else if (isMarketPage()) {
      scrapeMarketPrices();
      scanInventory(false);
    }
  }, CONFIG.rescanDebounceMs);

  function updateObserverTarget() {
    if (!observer) return;
    observer.disconnect();

    if (isInventoryPage()) {
      const cards = findItemCards();
      const validCards = Array.from(cards.keys()).filter(card => card.offsetWidth >= 40);
      if (validCards.length > 0) {
        const firstCard = validCards[0];
        let gridContainer = firstCard.parentElement;
        while (gridContainer && gridContainer.tagName !== 'BODY') {
          if (gridContainer.offsetWidth > 150) {
            break;
          }
          gridContainer = gridContainer.parentElement;
        }
        if (gridContainer) {
          log(`Observing inventory grid container:`, gridContainer);
          observer.observe(gridContainer, { childList: true, subtree: true });
          return;
        }
      }
      log(`No inventory cards found yet, observing body for initial load...`);
      observer.observe(document.body, { childList: true, subtree: true });
    } else if (isMarketPage()) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  let lastPath = location.pathname;
  let routePollInterval = null;

  function startRoutePolling() {
    if (routePollInterval) clearInterval(routePollInterval);
    let attempts = 0;
    routePollInterval = setInterval(() => {
      attempts++;
      const cards = findItemCards();
      if (cards.size > 0) {
        log(`Route polling: found ${cards.size} cards after ${attempts} attempts`);
        clearInterval(routePollInterval);
        routePollInterval = null;
        if (isInventoryPage()) {
          scanInventory(false);
        } else if (isMarketPage()) {
          scrapeMarketPrices();
          scanInventory(false);
        }
      }
      if (attempts >= 20) { // stop polling after 5 seconds
        clearInterval(routePollInterval);
        routePollInterval = null;
      }
    }, 250);
  }

  function handleRouteChange() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    lastInventoryCards = null; // Reset fingerprint on route change
    
    if (routePollInterval) {
      clearInterval(routePollInterval);
      routePollInterval = null;
    }
    
    if (isInventoryPage() || isMarketPage()) {
      updateObserverTarget();
      debouncedScan();
      startRoutePolling();
    } else {
      observer.disconnect();
    }
  }

  function start() {
    CONFIG.useHighCritWeightForHold = GM_getValue(KEYS.highCritWeightForHold, false);
    injectStyles();
    injectGear();
    GM_registerMenuCommand('Inventory Advisor — Einstellungen', openSettings);
    GM_registerMenuCommand('Cache leeren + neu scannen', () => { clearCache(); if (isInventoryPage()) scanInventory(true); });

    observer = new MutationObserver(debouncedScan);
    if (isInventoryPage() || isMarketPage()) {
      updateObserverTarget();
      if (isInventoryPage()) {
        scanInventory(false);
      } else {
        scrapeMarketPrices();
        scanInventory(false);
      }
      startRoutePolling();
    }

    // Intercept pushState / replaceState for instant route detection in Next.js SPA
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(handleRouteChange, 50);
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(handleRouteChange, 50);
    };

    window.addEventListener('popstate', handleRouteChange);

    // Fallback interval check
    setInterval(handleRouteChange, 800);
  }

  start();
})();
