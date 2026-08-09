// ==UserScript==
// @name         PROST
// @namespace    https://github.com/beertierchen/warera-prost
// @version      0.12.0
// @description  PROST-Personal Recommendation Overlay & Support Tool for WareEra. KEEP/SELL/SCRAP advice from local stats + official API market data. Optional official game API via your own key. No automation.
// @author       beertierchen
// @homepageURL  https://github.com/beertierchen/warera-prost
// @supportURL   https://github.com/beertierchen/warera-prost/issues
// @updateURL    https://update.greasyfork.org/scripts/583766/PROST.meta.js
// @downloadURL  https://update.greasyfork.org/scripts/583766/PROST.user.js
// @match        https://app.warera.io/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        window.onurlchange
// @grant        unsafeWindow
// @connect      api2.warera.io
// @connect      gateway.warerastats.io
// @connect      ntfy.sh
// @connect      greasyfork.org
// @license MIT
// ==/UserScript==

/*
 * DISCLAIMER — USE AT YOUR OWN RISK
 * ---------------------------------
 * PROST is free, open-source software provided "AS IS", without warranty of any
 * kind (MIT license). You alone are responsible for how you use it. Running a
 * userscript on WareEra may conflict with the game's terms of service and could
 * put your account at risk. The author accepts NO liability for any consequence
 * of your use (account action, data loss, or otherwise). If in doubt, don't run it.
 *
 * This project is deliberately open source and NOT claimed as private intellectual
 * property — copy, fork, modify, and redistribute freely under the MIT license.
 * Cooperation is welcome: https://github.com/beertierchen/warera-prost
 * Full text: DISCLAIMER.md
 *
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
  // CONFIG-edit here when the game's markup changes
  // ───────────────────────────────────────────────────────────────────────────
  const CONFIG = {
    // --- API ---
    // tRPC base. The script probes both until one answers; first success wins
    // and is cached for the session.
    apiBases: ['https://gateway.warerastats.io/trpc', 'https://api2.warera.io/trpc', 'https://api2.warera.io/api/trpc'],
    pricesEndpoint: 'itemTrading.getPrices',
    // getPrices returns MATERIALS only; the scrap unit price is the 'scraps' key.
    scrapItemCode: 'scraps',
    featScratchpad: false,               // In-game Scratchpad / Notepad
    featNotes: false,                    // experimental: user notes on /user/ links (off by default)
    featBattleAdvisor: false,            // experimental: highlight ally button on /battle/<id> pages
    featOrderRadar: true,                // compact order radar in country & MU headers
    featTroopRadar: true,                // troop radar in MU member list & header
    featProfileCharsheet: true,          // user profile RPG character sheet (HP, Hunger, build class)
    featSystemAlerts: true,               // receive signed system alerts
    alliedCountryCodes: ['de','pt','es','gm','ir','na','sr','th','at','fi','ie','no','se','uk','va','bf','cd','ye','ne','au','br','id'],
    featMarketGraph: false,
    featTour: true,                      // interactive API-token onboarding overlay (issue #50)
    featPnlTracker: false,
    featItemAdvisor: true,
    featCraftingAdvisor: true,
    featCompanyEco: true,
    featCompanyAlerts: true,
    featAlertCompanyStorage: true,
    featAlertCompanyBonus: true,
    featAlertCompanyTax: true,
    featAlertCompanyDeposit: true,
    featBetterRegion: true,
    ecoTaxTtlMs: 1800000,
    ecoRecipeTtlMs: 6 * 3600 * 1000,
    ecoDetailTtlMs: 300000,
    stockKeepCount: 3,

    // --- caching / rate-limit ---
    priceCacheTtlMs: 20 * 60 * 1000,    // 20 min (spec: 15-30 min)
    txCacheTtlMs: 60 * 60 * 1000,       // 1 hour for transaction history
    priceSampleIntervalMs: 15 * 60 * 1000, // sample every 15 mins
    priceSeriesWindowMs: 3 * 24 * 60 * 60 * 1000, // 3 days history
    minRequestIntervalMs: 3000,         // throttle: no two network calls closer than this (official limits: 100 rpm anonymous / 200 rpm keyed)
    rescanDebounceMs: 150,
    rateLimitBackoffMs: 60 * 1000,      // after a 429, suppress requests this long
    // ntfy.sh has its own (stricter) per-IP budget and BANS IPs that keep
    // sending after a 429 — back off much longer than for the game API.
    ntfyBackoffMs: 5 * 60 * 1000,       // after an ntfy 429, suppress ALL ntfy traffic this long

    // Max simultaneous item-transaction fetches during an inventory scan. The
    // gateway token bucket is ~100 rpm; a full inventory triggers ~20 fetches
    // at once without this cap, exhausting the bucket and timing out (#82).
    itemFetchConcurrency: 3,

    requestTimeoutMs: 15000,             // default GM_xmlhttpRequest timeout

    // --- DOM ---
    // Item images all live under this path; we climb from the <img> to its card.
    itemImageSelector: "img[src*='/images/items/'], img[src*='/images/skins/']",
    cardAncestorMaxClimb: 6,            // how many parents to walk up looking for the "card"

    // SVG path "d" fingerprints-substring-match to identify the stat by its icon.
    // Confirmed from live DOM: attack (sword), crit (burst), armor (shield).
    // helmet/gloves/boots icons not yet sampled -> handled by the unknown-icon fallback.
    statSvgFingerprints: {
      attack: 'M18.8025 2.44L6.9025',
      crit:   'M4.35 21H21V4.35',
      armor:  'M12,1L3,5V11C3,16.55', // mdi-shield-chest/pants "Armor" stat (bare integer)
    },

    // Rarity TIERS 1-6 from the armor alt suffix (e.g. "chest3" -> tier 3).
    // Weapons are tiered unique codes (knife/gun/rifle/sniper/tank/jet).
    // Tier 5-6 names/colors are ASSUMED-correct them if the game differs.
    weaponCodeToTier: { knife: 1, gun: 2, rifle: 3, sniper: 4, tank: 5, jet: 6 },
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
    // extrapolated x3 (486/1458)-confirm in-game. scrapValue = yield * scrapPrice.
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

    skinToSlot: {
      // weapons
      gsg9Sniper: 'sniper', ctKnife: 'knife', gsg9Rifle: 'rifle',
      gsg9Knife: 'knife', ctRifle: 'rifle', gsg9Jet: 'jet', ctJet: 'jet',
      gsg9Tank: 'tank', gsg9Gun: 'gun',
      // armor
      gsg9Chest: 'chest', gsg9Helmet: 'helmet', gsg9Gloves: 'gloves',
      gsg9Pants: 'pants', gsg9Boots: 'boots',
      ctChest: 'chest', ctHelmet: 'helmet', ctGloves: 'gloves',
      ctPants: 'pants', ctBoots: 'boots',
      // consumables
      wc2026: 'lightAmmo',
      ctHeavyAmmo: 'heavyAmmo',
      ctAmmo: 'ammo',
      ctLightAmmo: 'lightAmmo',
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
    critItemMinPercent: 0,

    // --- market reference price (item advisor + crafting advisor) ---
    txRefLookbackDays: 6,       // only consider transactions from the last N days
    txRefMinSample: 6,          // widen the closest-by-score group to at least this many txs before averaging
    txRefMaxSample: 12,         // ...but never grow it past this, so we stay near myStat's actual score
    txRefOutlierRatio: 3,       // reject prices outside [median/ratio, median*ratio] as gift-cap dumps or wash-trade pumps
    // market-value icon (inline SVG, coin stack). Scrap uses the 🔨 emoji.
    marketIconSvg: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" style="filter:drop-shadow(1px 1px 0 #000)"><path d="M12 5C7.031 5 2 6.546 2 9.5S7.031 14 12 14c4.97 0 10-1.546 10-4.5S16.97 5 12 5zm-5 9.938v3c1.237.299 2.605.482 4 .541v-3a21.166 21.166 0 0 1-4-.541zm6 .54v3a20.994 20.994 0 0 0 4-.541v-3a20.994 20.994 0 0 1-4 .541zm6-1.181v3c1.801-.755 3-1.857 3-3.297v-3c0 1.44-1.199 2.542-3 3.297zm-14 3v-3C3.2 13.542 2 12.439 2 11v3c0 1.439 1.2 2.542 3 3.297z"/></svg>',

    // Market tax rate when selling items (now dynamic via getCountryTax)
    // removed static sellTaxRate: 0.01

    // "Good roll" = item stat in the top fraction of the user's own inventory items.
    // Ranks an item's stat against the user's OWN INVENTORY items only.
    // Too few items in inventory -> no roll verdict, decide purely scrap-vs-market.
    goodRollTopFraction: 1 / 3,

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
        5: { min: 35, max: 50 },
        6: { min: 56, max: 70 }
      },
      chest: {
        1: { min: 1, max: 5 },
        2: { min: 6, max: 10 },
        3: { min: 11, max: 15 },
        4: { min: 21, max: 30 },
        5: { min: 35, max: 50 },
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

    PILL_BUFF_PCT: 60,
    AMMO_GREEN_PCT: 10,
    FOOD_PCT_STEAK: 0.5,
    BASELINE_TIER: 3,

    // ── Custom-Baseline-Set — basis for the "Tag" (daily) damage calc ────────────
    // SHARED baseline assumed for EVERY MU member (default = average blue / tier 3).
    // Hand-edit to model your own reference loadout. NO validation — a typo just
    // gives a wrong number (non-numeric → 0). Live mode floors real gear at this set.
    // Units: weapon.dmg / *.precision / *.armor / *.dodge = raw POINTS;
    //        weapon.crit / helmet.critDmg = whole PERCENT (13 = 13%).
    // precision + critChance are clamped to 100 together with the player's skill —
    // overshooting is wasted, not an error.
    // Cheat-sheet — valid stat range per tier (from statRangesByTier/weaponRanges):
    //   slot     | T1    T2     T3(blue) T4     T5      T6
    //   weaponDmg| 21-40 51-60  71-90    101-130 141-170 221-300
    //   weaponCr | 1-5   6-10   11-15    16-20   26-35   41-50
    //   gloves(P)| 1-5   6-10   11-15    21-25   31-40   51-60
    //   helmet(C)| 1-15  16-30  31-50    71-90   91-110  121-150
    //   chest(A) | 1-5   6-10   11-15    21-30   35-50   56-70
    //   pants(A) | 1-5   6-10   11-15    21-30   35-50   56-70
    //   boots(D) | 1-5   6-10   11-15    21-25   31-40   51-60
    CUSTOM_SET: {
      weapon: { dmg: 80.5, crit: 13 },
      gloves: { precision: 13 },
      helmet: { critDmg: 40.5 },
      chest:  { armor: 13 },
      pants:  { armor: 13 },
      boots:  { dodge: 13 },
    },

    DAILY_RESET_HOUR: 2, // local wall-clock; UNVERIFIED: confirm vs game server TZ

    // --- Equipment Sell Calculator ---
    featEquipSellCalc: false,
    featEquipSellCalcIntroducedIn: '0.12.0',

    featPillReminder: false,
    featPillNotifHnH: false,
    featPillNotifWindow: false,
    featPillNotifDebuff: false,
    featMuHealDim: false,
    featBountyNotify: false,
    featBountyNotif: false,
    bountyMuteDebuff: false,
    ntfyTopic: '',
    ntfyTopicSecret: '',
    personalTopic: '',
    personalTopicSecret: '',
    bountyOwnCountryOverride: '',
    bountyScope: 'cascade',
    pillBuffH: 8,
    pillKnifeH: 6,
    pillDebuffH: 15.5,
    pillPrefWindowFrom: '19:00',
    pillPrefWindowTo: '20:00',
    // After an H&H-full notification, suppress re-fire for this long even if
    // both100 briefly toggles (threshold flicker / multi-tab race) (#80).
    hnhNotifyCooldownMs: 15 * 60 * 1000,
    coinsIconPathPrefix: 'M12 5C7.031', // anchor for the gold-coins value icon in selector tiles
    hpIconPath: 'M12,21.35L10.55,20.03',
    hungerIconPath: 'M11,9H9V2H7V9',
    doubleChevronPath: 'M7.41,18.41',
    pillBuffIconPath: 'M4.22,11.29L11.29,4.22',
    pillDebuffIconPath: 'M22.11 21.46L2.39 1.73',
    muHealHeartPathFingerprint: 'M12,21.35',
    muHealButtonTextFallbackEN: 'Ask for help',
    muHealButtonTextFallbackDE: 'Hilfe anfordern',

    debug: false,
    verboseDebug: false,

    locale: 'de', // default locale; can be changed in settings

    i18n: {
      en: {
        equipSellCalcTitle: 'Equipment Price Calculator',
        equipSellCalcTargetLabel: 'Target Price (Buyer Pays)',
        equipSellCalcTaxLabel: 'Market Tax (%)',
        equipSellCalcResultLabel: 'Enter Price (List for)',
        equipSellCalcCopyHint: 'Click to copy',
        settingsFeatEquipSellCalcHint: 'Calculate the exact listing price so buyers see your target price after tax. Uses your country\'s market tax rate automatically.',
        settingsNewBadge: 'New!',

        never: 'never',
        justNow: 'just now',
        minAgo: '{min} min ago',
        hMAgo: '{h}h {m}m ago',
        priceTooltip: 'Top: Scrap Value · Bottom: Market Value',
        weaponStats: 'Attack: {attack}  Crit: {crit}%',
        weaponScore: 'Weapon score: {score}',
        durability: 'Durability: {durability}%',
        scrapTooltip: 'Scrap: {yield} (est.) × {price}/u = {val}',
        txRef: 'Market value (6d tx ref): {val} (avg of {count} txs with {diff}, total {total} txs)',
        exactMatch: 'exact match',
        diffMatch: 'diff ±{diff}',
        stalePrices: '⚠ cached/stale prices-refresh in settings',
        notEquipment: 'not equipment',
        rangeLabelWeapon: 'score {score} >= {threshold} [90% of range {min} - {max}]',
        rangeLabelArmor: 'stat {stat}{pct} >= {threshold}{pct} [90% of range {min}{pct} - {max}{pct}]',
        topItemscore: 'Top Itemscore',
        settingsGearTitle: 'Inventory Advisor Settings',
        stockKeepReason: 'Stock: top 3 roll (#{rank} of {size} {label})',
        highRollT3: 'high roll basestat {stat} >= 11 (T3 blue)',
        critCondition: 'Critical Condition: {tierLabel} weapon crit {crit}% >= {min}% (range {range})',
        topRollInv: 'stat {stat} in top {pct}% of {items} inventory items',
        notTopRollInv: 'stat {stat} not top-roll in inventory ({items} items)',
        unknownRollRank: 'roll rank unknown (no inventory comparison)',
        noPriceData: 'no price data',
        mktNoScrap: 'market {val} (net {net}, no scrap value)',
        heldCrit: 'held for Critical Condition',
        noMktHeldCrit: 'no market price, but held for Critical Condition',
        scrapNoMkt: 'scrap {val} (no market price)',
        scrapOverMkt: 'scrap {scrap} > market net {net} (gross {val})',
        scrapOverMktHeld: 'scrap {scrap} > market net {net} (gross {val}), but held for Critical Condition',
        mktOverScrapHeld: 'market net {net} (gross {val}) >= scrap {scrap}, but held for Critical Condition',
        mktOverScrap: 'market net {net} (gross {val}) >= scrap {scrap}',
        statLabel_helmet: 'Crit Damage',
        statLabel_gloves: 'Precision',
        statLabel_chest: 'Armor',
        statLabel_pants: 'Armor',
        statLabel_boots: 'Dodge',
        statLabel_stat: 'Stat',
        defend: 'Defend',
        resist: 'Resist',
        allies: 'Allies',
        enemies: 'Enemies',
        yourCountry: 'Your country',
        editNote: 'Edit Note',
        editNoteAria: 'Edit note for {user}',
        deleteNote: 'Delete',
        saveNote: 'Save',
        cancel: 'Cancel',
        notePlaceholder: 'Enter note...',
        noteTitle: 'Note: {user}',
        noteClose: 'Close',
        noteCloseAria: 'Close note editor',
        noteUserLabel: 'User',
        settingsFeatScratchpadCheckbox: 'In-game Scratchpad / Notepad (floating panel)',
        settingsFeatScratchpadHint: 'Provides a draggable, persistent notepad for quick notes in-game.',
        settingsFeatNotesCheckbox: 'User notes on player links 📒 (experimental)',
        settingsFeatNotesHint: 'Adds a note icon next to player links. Disable if the standalone Warera User Notes script is also active.',
        settingsFeatItemAdvisorCheckbox: 'Item Advisor (KEEP/SELL/SCRAP badges)',
        settingsFeatItemAdvisorHint: 'Show KEEP/SELL/SCRAP advice badges on inventory and market item cards.',
        settingsFeatCraftingAdvisorCheckbox: 'Crafting Advisor',
        settingsFeatCraftingAdvisorHint: 'Show worst-case/best-case profit advice inside the in-game crafting dialog.',
        settingsFeatBattleCheckbox: 'Battle advisor ⚔️ (experimental)',
        settingsFeatBattleHint: 'Highlights the button for your side on battle pages using automatically resolved allied country codes.',
        settingsTitle: 'WareEra Inventory Advisor',
        gearTitle: 'WareEra Inventory Advisor-Settings',
        settingsAdvisorSettingsLabel: 'Inventory Advisor Options',
        settingsStockKeepCountLabel: 'Stock items to keep per type:',
        settingsStockKeepCountSub: '(Items beyond this limit will not get a 💎 KEEP badge)',
        settingsDesc: 'The Inventory Advisor gives a quick overview of whether items should be kept (KEEP/HOLD), sold (SELL), or salvaged (SCRAP).',
        settingsHeaderFeature: 'Feature / Option',
        settingsHeaderNotif: '🔔 Notif',
        settingsCategoryWar: '⚔️ War',
        settingsCategoryEco: '💰 Economy',
        settingsCategoryMisc: '🔧 Other',
        settingsApiToken: 'API Key (api2.warera.io)',
        settingsTokenPlaceholder: 'API Key',
        settingsTokenNote: 'API key — required for all official-API features. Without it the script only uses the community gateway (prices, transactions, battles); alliance- and search-based features stay off. Never your game session.',
        // UNVERIFIED: steps to create an API key in-game
        settingsTokenHelpText: 'No API key set — official-API features are disabled. To get a key: 1. Go to Settings > API Keys in the game. 2. Create a read-only key. 3. Paste it above. (Required for official-API features, never touches your game session. Detail guide: https://github.com/beertierchen/warera-prost/wiki/Settings)',
        tourSettingsBtn: '🍺 Tour of Beers — set up my API token',
        tourPromptTitle: 'New to PROST?',
        tourPromptBody: 'PROST needs a WareEra API token to unlock its features. Let me point you to it — takes about a minute.',
        tourPromptStart: 'Show me how',
        tourPromptLater: 'Not now',
        tourPromptNever: "Don't show again",
        tourNext: 'Next',
        tourBack: 'Back',
        tourSkip: 'Skip',
        tourFinish: 'Finish 🍺',
        tourPaste: 'Paste & Save',
        tourWaiting: 'Waiting for the game… do the highlighted action, then hit Next.',
        tourNotFound: "Can't find this on screen — scroll to it or continue with Next.",
        tourStep1Title: 'Open your player menu',
        tourStep1Body: 'Click your avatar in the top bar to open the player menu.',
        tourStep2Title: 'Go to Settings',
        tourStep2Body: "Choose the Settings entry to open your account configuration.",
        tourStep3Title: 'Find the API Tokens section',
        tourStep3Body: 'Scroll down until you see the “API Tokens” section.',
        tourStep4Title: 'Create a token',
        tourStep4Body: 'Click the Create-token button to open the dialog.',
        tourStep5Title: 'Name it and confirm',
        tourStep5Body: 'Give the token any name (e.g. “PROST”) and confirm to create it.',
        tourStep6Title: 'Copy your token',
        tourStep6Body: "Copy the token now — the game shows it only once. Then hit Next.",
        tourStep7Title: 'Paste it into PROST',
        tourStep7Body: 'Paste your token here, then click Save. That’s it — Prost! 🍻',
        tokenStorageUpgraded: 'API key storage was upgraded — please re-enter your API key in Settings. API features stay off until you re-enter it.',
        tokenStorageUpgradedTitle: 'API key upgraded',
        apiKeyRequiredMsg: 'This feature needs your API key (Settings).',
        apiKeyRequiredSuffix: 'needs key',
        hintToggleLabel: 'Explanation',
        settingsFeatPillCheckbox: 'Pill Reminder (configurable pill-timing overlay) 💊',
        settingsFeatPillHint: 'Shows a top-bar status and countdown timer for the pill cycle, highlights ready pills, and checks health/hunger levels.',
        wageMedianLine: '📊 {sparkline} (you: {pctl} pctl, median: {median})',
        wageMedianOnly: '📊 {sparkline} (median: {median})',
        wageMedianFallback: '(Median unavailable)',
        wageUncompetitive25: '⚠ Below 25th percentile',
        ntfyBountyTitle: '⚔️ {type}: {defender} vs {attacker}',
        ntfyBountyBody: 'Fight for {allyCountry} ({side}) · Pool {moneyPool} · {ratePer1k}/1k',
        bountyAttackerSide: 'Attacker',
        bountyDefenderSide: 'Defender',
        bountyPopupAction: 'Fight for',
        bountyPopupContext: '{side} · vs {opponent}',
        bountyStatPool: 'Pool',
        bountyStatRate: 'Rate/1k',
        bountyPopupClose: 'Close',
        bountyTopicLinkLabel: 'Open topic',
        bountyLabelAll: 'Bounty',
        bountyLabelAllies: 'Ally-Bounty',
        bountyLabelCascade: 'Ally-Casc-Bounty',
        settingsFeatBounty: 'Bounty notifications',
        settingsNtfyTopic: 'ntfy topic (base)',
        settingsNtfyTopicSecret: 'Topic secret (optional)',
        settingsBountyOwnCountry: 'Own country / ally override (name or countryIds)',
        settingsNotifTitle: '🔔 Notification Options (ntfy.sh)',
        settingsPersonalTopic: 'Personal Topic',
        settingsPersonalTopicSecret: 'Personal Secret (optional)',
        settingsPersonalTopicLinkText: 'Subscribe / Open',
        settingsFeatSystemAlerts: 'Receive critical plugin update & safety alerts (read-only system channel)',
        settingsBellTitle: 'Toggle push notifications',
        settingsBountyScope: 'Notification scope',
        bountyScopeAll: 'All battles (no filter)',
        bountyScopeAllies: 'Only allies (own country + alliance + own allies/pacts)',
        bountyScopeCascade: 'Allies + Cascading (alliance members\' allies/pacts)',
        settingsBountyMuteDebuff: 'Mute bounty notifications while debuff is active',
        settingsPillSettingsLabel: 'Pill timing options',
        settingsPillBuffLabel: 'Buff Duration (hours)',
        settingsPillKnifeLabel: 'Knife Duration (hours)',
        settingsPillDebuffLabel: 'Total Debuff (hours)',
        settingsPillPrefFromLabel: 'Preferred Time From',
        settingsPillPrefToLabel: 'Preferred Time To',
        settingsFeatPillNotifHnH: 'H&H full notifications (ntfy.sh)',
        settingsFeatPillNotifWindow: 'Preferred pill window notifications (ntfy.sh)',
        settingsFeatPillNotifDebuff: 'Debuff expired notifications (ntfy.sh)',
        settingsFeatCompanyEco: 'Enable Company Economy overlay',
        settingsFeatCompanyEcoHint: 'Shows net profit and storage capacity on companies. If the bell icon is checked, it also sends a desktop & ntfy.sh alert when storage is full.',
        settingsFeatCompanyAlertsInline: '🔔 Storage Alerts',
        settingsFeatAlertCompanyStorage: 'Alert: Storage Full / No Materials',
        settingsFeatAlertCompanyBonus: 'Alert: Production Bonus Drop',
        settingsFeatAlertCompanyTax: 'Alert: Income Tax Increase',
        settingsFeatAlertCompanyDeposit: 'Alert: Region Deposit Expiring',
        settingsFeatBetterRegion: 'Alert: Better Region Available',
        settingsFeatMuHealDim: 'Dim MU heal request while debuffed / at full HP',
        muHealDimReasonDebuff: 'debuff active',
        muHealDimReasonFullHP: 'HP full',
        muHealDimReasonBoth: 'debuff active & HP full',
        ntfyHnHFullTitle: '🍗 Health & Hunger Full',
        ntfyHnHFullBody: 'Your Health and Hunger are both at 100%. Ready to take a pill.',
        ntfyPillWindowTitle: '💊 Preferred Pill Window Reached',
        ntfyPillWindowBody: 'You have entered your preferred pill consumption window ({time}).',
        ntfyDebuffGoneTitle: '✨ Pill Debuff Expired',
        ntfyDebuffGoneBody: 'Your pill debuff has expired. You can take your next pill now.',
        pillTakeNowOverlay: 'TAKE NOW',
        pillTopUpOverlay: 'TOP UP FIRST',
        pillPreferredWindow: '{from} - {to}',
        pillPhaseBuff: 'Active-Phase',
        pillPhaseKnife: 'Knife-Phase',
        pillPhaseRecover: 'Recover-Phase',
        pillPhaseReady: 'READY',
        pillPhaseGated: 'Pill in',
        pillGatingHeader: 'Pill gates',
        pillHeadlineWindow: 'from {time}',
        pillHeadlineWindowTimer: 'until {duration}',
        pillHeadlineHnH: 'H&H full',
        pillHeadlineHnHTimer: 'in {duration}',
        pillGateHnHWait: 'H&H full in ~{time} ({pct}%)',
        pillGateHnHReady: '✓ H&H 100%',
        pillGateDebuffWait: 'Debuff ends in ~{time}',
        pillGateDebuffReady: '✓ Debuff ends',
        pillGateNoAnchor: 'no pill anchor',
        pillGateWindowWait: 'Window from {time} (in {duration})',
        pillGateWindowReady: '✓ Window from {time}',
        pillOverlayReady: 'now',
        pillDetailNext: 'Next transition',
        pillDetailPreferred: 'Preferred window',
        pillDetailGatingReady: 'Ready to take pill!',
        pillDetailGatingTopUp: 'Waiting for H&H: ~{time} ({pct}%, next update in {next})',
        pillSpendableFree: '⬇ {val} free',
        pillSpendableNone: '✕ 0 free',
        pillHnHFullIn: 'H&H full in {duration}',
        pillNextTickIn: 'Tick in {duration}',
        craftTitle: 'Crafting Advisor',
        craftResourceCost: 'Resource cost: {val} Gold (Steel: {steelPrice}/u, Scraps: {scrapsPrice}/u)',
        craftProfitRange: 'Profit range (ranked by typical price):',
        craftProfitSpecific: 'Profit range: {min} to {max}',
        craftProfitMedian: 'Expected profit (typical price): {profit}',
        craftWorstItem: 'Worst option ({item}): {profit}',
        craftBestItem: 'Best option ({item}): {profit}',
        craftMarketRange: 'Market range: {min} to {max} Gold',
        craftItemRange: 'range {min}–{max}',
        craftMissingPrices: '⚠️ Market prices for steel/scraps not found. Visit Market to update.',
        today: 'today',
        tomorrow: 'tomorrow',
        yesterday: 'yesterday',
        settingsSave: 'Save',
        settingsClear: 'Clear Cache',
        settingsClose: 'Close',
        settingsHelpSummary: 'ℹ Cheat Sheet (Help & Explanation)',
        settingsHelpTitle: 'ℹ Cheat Sheet (Help & Explanation)',
        localeOption_de: 'German',
        localeOption_en: 'English',
        settingsHelpContent: `<strong>Meaning of recommendations (Color + Symbol):</strong>
            <ul>
              <li>💎 <strong>KEEP (Blue)</strong>: Keep the item. Applies to your top 3 stock (by type/tier) or if the item is in the top 33% (Top Roll) of your inventory.</li>
              <li>✋ <strong>HOLD (Orange)</strong>: Keep/reserve. The item lies in the best 10% of the theoretically possible stat range (Top Itemscore). Only assigned if it is not 💎 KEEP.</li>
              <li>💰 <strong>SELL (Green)</strong>: Sell on the market. Economically sound as the net market price (minus 1% tax) exceeds salvage value.</li>
              <li>🔨 <strong>SCRAP (Red)</strong>: Scrap/salvage. Economically sound as salvage value exceeds net market price.</li>
            </ul>
            <strong>Overlays on inventory cards:</strong>
            <ul>
              <li><strong>Top left (Stat value):</strong> The armor stat or weapon score. <em>Blue background</em> = Top 3 in stock (Stock Keep). <em>Gray</em> = Normal.</li>
              <li><strong>Bottom (Prices):</strong> Stacked 🔨 [Scrap value] and 💰 [Market price]. <em>Green background</em> = Scrapping is better. <em>Orange</em> = Selling is better.</li>
            </ul>
            <strong>Settings:</strong>
            <ul>
              <li><strong>API Token</strong>: Required to fetch fresh market values (equipment and scrap).</li>
            </ul>
            <strong>Pill timer 💊:</strong>
            <ul>
              <li>Counts down to your next pill-the latest of: <em>H&amp;H full</em>, <em>debuff ended</em>, and your <em>preferred window</em> start.</li>
              <li>Buff/debuff is detected from the pill icon on your own profile. "no pill anchor" just means none has been detected yet.</li>
            </ul>
            <strong>H&amp;H budget bars:</strong>
            <ul>
              <li>The notch on your Health &amp; Hunger bar is the <em>floor</em>: spend down to it and natural regen still refills you to 100% by pill time.</li>
              <li>The bright segment above the floor is <em>free to spend</em> (attack / get eaten). <em>✕ 0 free</em> = don't spend, you need it all to refill in time.</li>
            </ul>`,
        settingsPriceFormat: 'Price format: [Scrap Value]/[Market Price]',
        menuSettings: 'Inventory Advisor-Settings',
        menuClearRescan: 'Clear Cache + Rescan',
        menuCheckUpdates: 'Check for updates',
        updateAvailableTitle: '⚠ Update available (v{ver})',
        updateAvailableBody: 'A newer PROST version (v{ver}) is available. Update now — outdated versions may contain code that violates game rules.',
        directUpdateLink: 'Direct Update',
        updateAvailableBodyShort: 'New version available.',
        updateConfirmText: 'A newer version of PROST (v{ver}) is available!\n\nCurrent version: v{current}\n\nWould you like to install the update now?',
        updateUpToDateText: 'PROST is up to date (v{current}).',
        gearTooltipTitle: 'Inventory Advisor-Settings',
        gearTooltipScrapPrice: 'Scrap price: {price}/u ({age})',
        gearTooltipItemPrices: 'Item prices: {count} cached ({age})',
        gearTooltipTxHistory: 'Tx history: {count} items cached',
        gearTooltipRateLimited: 'API limit-waiting {sec}s',
        dataStrip_scrapPrice: 'Scrap price:  {price} / unit   (fetched {age})\n',
        dataStrip_itemPrices: 'Item prices:  {count} cached         (fetched {age})\n',
        dataStrip_scrapedMkt: 'Scraped mkt:  {count} items stored    (visit Market -> Equipments to update)\n',
        dataStrip_txHistory: 'Tx history:   {count} items cached\n',
        dataStrip_status: 'Status:       {status}',
        status_rateLimited: 'RATE-LIMITED',
        status_stale: 'stale (past cache TTL)',
        status_fresh: 'fresh',
        rateLimitBanner: '⚠ API limit reached! Backoff active ({sec}s)-displaying cached prices.',
        marketGraph24h: '24h',
        marketGraph3d: '3d',
        marketGraphLegendNative: 'Daily avg',
        marketGraphLegendIntraday: 'Intraday',
        marketGraphHoverPrice: '☉ {price}',
        settingsFeatMarketGraphCheckbox: 'Resource Market Intraday Graph',
        settingsFeatMarketGraphHint: 'Overlay an intraday (24h/3d) price graph on resource market buy/sell modals.',
        settingsFeatPnlTrackerCheckbox: 'Daily P&L Tracker',
        settingsFeatPnlTrackerHint: 'Display your daily profit/loss tracker in the topbar next to your gold balance.',
        orderRadarTitle: '⚔ ORDERS',
        orderRadarDef: 'Def',
        orderRadarAtt: 'Att',
        settingsFeatOrderRadarCheckbox: 'Order-Radar (Country & MU Header)',
        settingsFeatOrderRadarHint: 'Displays active battle orders directly inside the header banner on Country and MU pages.',
        settingsBattleSettingsLabel: '⚔️ Battle Advisor Options',
        orderRadarPriorityRed: 'High-priority order',
        orderRadarPriorityYellow: 'Medium-priority order',
        orderRadarPriorityGreen: 'Low-priority order',
        troopRadarTitle: '⚔ TROOP RADAR',
        troopRadarReady: 'Ready for Battle',
        troopRadarWarskiller: 'Warskillers',
        troopRadarPilled: 'Pilled',
        troopRadarAvgHp: 'Avg HP',
        troopRadarWar: 'WAR',
        troopRadarEco: 'Eco',
        troopRadarHybrid: 'Hybrid',
        troopRadarPillOn: 'pilled',
        troopRadarPillOff: 'ready to pill',
        troopRadarPillCd: 'not ready',
        troopRadarDamagePotential: 'Damage Pot.',
        troopRadarDmgComputed: '{done}/{total} calc.',
        troopRadarModeTag: 'Day',
        troopRadarModeLive: 'Live',
        troopRadarLiveUntil: 'until {time}',
        troopRadarLiveObserved: 'obs. avg {val}',
        troopRadarSubWarskiller: 'of warskillers',
        troopRadarSubActive: 'of active members',
        troopRadarHunger: 'Hunger',
        troopRadarHpHunger: 'Ø HP / Hunger',
        troopRadarLiveHorizonTitle: 'Edit Live Horizon',
        troopRadarLiveHorizonHint: 'Select target hour (0-23) for live damage potential calculation:',
        troopRadarPillReadyShort: 'ready',
        troopRadarPillCdShort: 'not ready',
        troopRadarPillOffShort: 'unpilled',
        settingsFeatTroopRadarCheckbox: 'Troop-Radar (MU Member List & Header)',
        settingsFeatTroopRadarHint: 'Displays member combat readiness (HP, pill status, skill orientation) in MU member lists and header.',
        supporterAdj0: 'Legendary',
        supporterAdj1: 'Glorious',
        supporterAdj2: 'Honorable',
        supporterAdj3: 'Valiant',
        supporterAdj4: 'Relentless',
        supporterAdj5: 'Feared',
        supporterAdj6: 'Unstoppable',
        supporterAdj7: 'Fearless',
        supporterAdj8: 'Masterful',
        supporterAdj9: 'Invincible',
        settingsFeatProfileCharsheetCheckbox: 'Character Sheet Strip (Player Profiles)',
        settingsFeatProfileCharsheetHint: 'Shows a DnD-style RPG character sheet (HP, Hunger, build orientation) on player profile pages.',
        profileClassWar: 'Warrior',
        profileClassHybrid: 'Mercenary',
        profileClassEco: 'Magnate',
        profileClassBrawler: 'Brawler',
        profileClassGunslinger: 'Gunslinger',
        profileClassRifleman: 'Rifleman',
        profileClassSniper: 'Sniper',
        profileClassTankCommander: 'Tank Commander',
        profileClassFighterPilot: 'Fighter Pilot',
        profileClassThug: 'Thug',
        profileClassMercenary: 'Mercenary',
        profileClassBulwark: 'Bulwark',
        profileClassJuggernaut: 'Juggernaut',
        profileClassFortress: 'Fortress',
        profileClassTitan: 'Titan',
        profileClassThief: 'Thief',
        profileClassScout: 'Scout',
        profileClassSkirmisher: 'Skirmisher',
        profileClassAssassin: 'Assassin',
        profileClassPhantom: 'Phantom',
        profileClassShadow: 'Shadow',
        profileClassWorker: 'Worker',
        profileClassCreator: '🍻 PROST Brewmaster',
        profileClassShiftSupervisor: 'Shift Supervisor',
        profileClassForeman: 'Foreman',
        profileClassTechnician: 'Technician',
        profileClassMasterCraftsman: 'Master Craftsman',
        profileClassChiefEngineer: 'Chief Engineer',
        profileClassTrader: 'Trader',
        profileClassMerchant: 'Merchant',
        profileClassEntrepreneur: 'Entrepreneur',
        profileClassInvestor: 'Investor',
        profileClassTycoon: 'Tycoon',
        profileClassMagnate: 'Magnate',
        profileClassOverseer: 'Overseer',
        profileClassAdministrator: 'Administrator',
        profileClassManager: 'Manager',
        profileClassDirector: 'Director',
        profileClassCEO: 'CEO',
        profileClassChairman: 'Chairman',
        profileClassAdventurer: 'Adventurer',
        profileClassFreelancer: 'Freelancer',
        profileClassVeteran: 'Veteran',
        profileClassWarlord: 'Warlord',
        profileClassSyndicateBoss: 'Syndicate Boss',
        profileClassEmperor: 'Emperor',
        profileClassOpportunist: 'Opportunist',
        profileClassFortuneHunter: 'Fortune Hunter',
        profileClassGambler: 'Gambler',
        profileClassHighRoller: 'High Roller',
        profileClassSpeculator: 'Speculator',
        profileClassCasinoBoss: 'Casino Boss',
        profileHp: 'HP',
        profileHunger: 'Hunger',
        customBaselineTitle: 'Edit Baseline-Set',
        customBaselineHint: 'Applies to Tag only. JSON — only shape/number-format is checked. Invalid → Default.',
        customBaselineCheatTitle: 'Cheat Sheet · valid stat range per tier',
        customBaselineBtnReset: 'Reset',
        customBaselineBtnCancel: 'Cancel',
        customBaselineBtnSave: 'Save',
        customBaselineToastReset: 'Reset to default baseline set',
        customBaselineToastSaved: 'Saved · Tag damage recalculated',
        customBaselineToastInvalid: 'Format invalid — reset to default'
      },
      de: {
        equipSellCalcTitle: 'Equipment Preisrechner',
        equipSellCalcTargetLabel: 'Zielpreis (Käufer zahlt)',
        equipSellCalcTaxLabel: 'Marktsteuer (%)',
        equipSellCalcResultLabel: 'Listenpreis (Eingeben)',
        equipSellCalcCopyHint: 'Klicken zum Kopieren',
        settingsFeatEquipSellCalcHint: 'Berechnet den exakten Listenpreis, damit Käufer nach Steuer deinen Zielpreis sehen. Nutzt automatisch die Marktsteuer deines Landes.',
        settingsNewBadge: 'Neu!',

        never: 'nie',
        justNow: 'gerade eben',
        minAgo: 'vor {min} Min.',
        hMAgo: 'vor {h}h {m}m',
        priceTooltip: 'Oben: Schrottwert · Unten: Marktwert',
        weaponStats: 'Angriff: {attack}  Krit: {crit}%',
        weaponScore: 'Waffen-Score: {score}',
        durability: 'Haltbarkeit: {durability}%',
        scrapTooltip: 'Schrott: {yield} (ca.) × {price}/Einh. = {val}',
        txRef: 'Marktwert (6t Transaktions-Ref): {val} (Schnitt aus {count} Transaktionen mit {diff}, insg. {total} Transaktionen)',
        exactMatch: 'genaue Übereinstimmung',
        diffMatch: 'Diff. ±{diff}',
        stalePrices: '⚠ Veraltete Preise-in den Einstellungen aktualisieren',
        notEquipment: 'keine Ausrüstung',
        rangeLabelWeapon: 'Score {score} >= {threshold} [90% des Bereichs {min} - {max}]',
        rangeLabelArmor: 'Stat {stat}{pct} >= {threshold}{pct} [90% des Bereichs {min}{pct} - {max}{pct}]',
        topItemscore: 'Top-Itemscore',
        settingsGearTitle: 'Inventory Advisor Einstellungen',
        stockKeepReason: 'Lagerbestand: Top 3 Roll (#{rank} von {size} {label})',
        highRollT3: 'Hoher Roll: Basiswert {stat} >= 11 (T3 Blau)',
        critCondition: 'Kritischer Zustand: {tierLabel} Waffenkrit {crit}% >= {min}% (Bereich {range})',
        topRollInv: 'Wert {stat} in den Top {pct}% von {items} Inventar-Gegenständen',
        notTopRollInv: 'Wert {stat} nicht im Top-Roll im Inventar ({items} Gegenstände)',
        unknownRollRank: 'Roll-Rang unbekannt (kein Inventarvergleich)',
        noPriceData: 'keine Preisdaten',
        mktNoScrap: 'Markt {val} (Netto {net}, kein Schrottwert)',
        heldCrit: 'behalten wegen kritischem Zustand',
        noMktHeldCrit: 'kein Marktpreis, aber behalten wegen kritischem Zustand',
        scrapNoMkt: 'Schrott {val} (kein Marktpreis)',
        scrapOverMkt: 'Schrott {scrap} > Markt Netto {net} (Brutto {val})',
        scrapOverMktHeld: 'Schrott {scrap} > Markt Netto {net} (Brutto {val}), aber behalten wegen kritischem Zustand',
        mktOverScrapHeld: 'Markt Netto {net} (Brutto {val}) >= Schrott {scrap}, aber behalten wegen kritischem Zustand',
        mktOverScrap: 'Markt Netto {net} (Brutto {val}) >= Schrott {scrap}',
        statLabel_helmet: 'Kritischer Schaden',
        statLabel_gloves: 'Präzision',
        statLabel_chest: 'Rüstung',
        statLabel_pants: 'Rüstung',
        statLabel_boots: 'Ausweichen',
        statLabel_stat: 'Wert',
        defend: 'Verteidigen',
        resist: 'Widerstehen',
        allies: 'Verbündete',
        enemies: 'Gegner',

        yourCountry: 'Dein Land',
        editNote: 'Notiz bearbeiten',
        editNoteAria: 'Notiz für {user} bearbeiten',
        deleteNote: 'Löschen',
        saveNote: 'Speichern',
        cancel: 'Abbrechen',
        notePlaceholder: 'Notiz zu diesem Spieler...',
        noteTitle: 'Notiz: {user}',
        noteClose: 'Schließen',
        noteCloseAria: 'Notizeditor schließen',
        noteUserLabel: 'Benutzer',
        settingsFeatScratchpadCheckbox: 'In-Game Scratchpad / Notizen-Tool (schwebendes Panel)',
        settingsFeatScratchpadHint: 'Bietet einen verschiebbaren, persistenten Notizblock für schnelle Notizen im Spiel.',
        settingsFeatNotesCheckbox: 'Spieler-Notizen bei Spieler-Links 📒 (experimentell)',
        settingsFeatNotesHint: 'Fügt ein Notiz-Icon neben Spieler-Links hinzu. Deaktivieren, wenn das separate Warera User Notes-Script ebenfalls aktiv ist.',
        settingsFeatItemAdvisorCheckbox: 'Item Advisor (KEEP/SELL/SCRAP Badges)',
        settingsFeatItemAdvisorHint: 'Zeigt KEEP/SELL/SCRAP-Empfehlungs-Badges auf Inventar- und Markt-Item-Karten an.',
        settingsFeatCraftingAdvisorCheckbox: 'Crafting-Berater',
        settingsFeatCraftingAdvisorHint: 'Zeigt Worst-Case/Best-Case-Gewinnberatung im Crafting-Dialog des Spiels an.',
        settingsFeatBattleCheckbox: 'Battle-Advisor ⚔️ (experimentell)',
        settingsFeatBattleHint: 'Hebt den richtigen Angriffs-/Verteidigungsbutton auf Kampfseiten hervor unter Verwendung automatisch ermittelter verbündeter Ländercodes.',
        settingsTitle: 'WareEra Inventory Advisor',
        gearTitle: 'WareEra Inventory Advisor-Einstellungen',
        settingsAdvisorSettingsLabel: 'Optionen für den Item Advisor',
        settingsStockKeepCountLabel: 'Anzahl zu behaltender Items im Bestand (pro Typ/Tier):',
        settingsStockKeepCountSub: '(Gegenstände außerhalb dieser Grenze erhalten keinen Diamanten 💎)',
        settingsDesc: 'Der Inventory Advisor soll eine schnelle Übersicht geben, ob Items behalten (KEEP/HOLD), gewinnbringend verkauft (SELL) oder zerschreddert (SCRAP) werden sollten.',
        settingsHeaderFeature: 'Feature / Option',
        settingsHeaderNotif: '🔔 Benachr.',
        settingsCategoryWar: '⚔️ Krieg',
        settingsCategoryEco: '💰 Wirtschaft',
        settingsCategoryMisc: '🔧 Sonstiges',
        settingsApiToken: 'API-Key (api2.warera.io)',
        settingsTokenPlaceholder: 'API-Key',
        settingsTokenNote: 'API-Key — erforderlich für alle offiziellen API-Funktionen. Ohne Key nutzt das Skript nur das Community-Gateway (Preise, Transaktionen, Schlachten); Allianz- und Suchfunktionen bleiben deaktiviert. Niemals deine Spiel-Session.',
        // UNVERIFIED: steps to create an API key in-game
        settingsTokenHelpText: 'Kein API-Key gesetzt — offizielle API-Funktionen sind deaktiviert. Um einen Key zu erstellen: 1. Gehe im Spiel auf Einstellungen > API-Keys. 2. Erstelle einen Key mit Lese-Rechten. 3. Oben einfügen. (Erforderlich für offizielle API-Funktionen, nutzt niemals deine Spiel-Session. Anleitung: https://github.com/beertierchen/warera-prost/wiki/Settings.de)',
        tourSettingsBtn: '🍺 Bier-Tour — meinen API-Token einrichten',
        tourPromptTitle: 'Neu bei PROST?',
        tourPromptBody: 'PROST braucht einen WareEra API-Token, um seine Funktionen freizuschalten. Ich zeig dir, wo — dauert etwa eine Minute.',
        tourPromptStart: 'Zeig mir wie',
        tourPromptLater: 'Später',
        tourPromptNever: 'Nicht mehr anzeigen',
        tourNext: 'Weiter',
        tourBack: 'Zurück',
        tourSkip: 'Überspringen',
        tourFinish: 'Fertig 🍺',
        tourPaste: 'Einfügen & Speichern',
        tourWaiting: 'Warte auf das Spiel… führe die markierte Aktion aus und klicke dann Weiter.',
        tourNotFound: 'Nicht auf dem Bildschirm gefunden — scrolle dorthin oder klicke Weiter.',
        tourStep1Title: 'Spielermenü öffnen',
        tourStep1Body: 'Klicke oben auf deinen Avatar, um das Spielermenü zu öffnen.',
        tourStep2Title: 'Zu den Einstellungen',
        tourStep2Body: 'Wähle den Eintrag „Einstellungen“, um deine Kontoeinstellungen zu öffnen.',
        tourStep3Title: 'API-Token-Bereich finden',
        tourStep3Body: 'Scrolle nach unten bis zum Bereich „API-Tokens“.',
        tourStep4Title: 'Token erstellen',
        tourStep4Body: 'Klicke auf den Token-erstellen-Button, um den Dialog zu öffnen.',
        tourStep5Title: 'Benennen und bestätigen',
        tourStep5Body: 'Gib dem Token einen Namen (z. B. „PROST“) und bestätige, um ihn zu erstellen.',
        tourStep6Title: 'Token kopieren',
        tourStep6Body: 'Kopiere den Token jetzt — das Spiel zeigt ihn nur einmal. Dann klicke Weiter.',
        tourStep7Title: 'In PROST einfügen',
        tourStep7Body: 'Füge deinen Token hier ein und klicke auf Speichern. Fertig — Prost! 🍻',
        tokenStorageUpgraded: 'Der Speicherort für den API-Key wurde aktualisiert — bitte trage deinen API-Key in den Einstellungen neu ein. API-Funktionen bleiben deaktiviert, bis du ihn neu einträgst.',
        tokenStorageUpgradedTitle: 'API-Key aktualisiert',
        apiKeyRequiredMsg: 'Diese Funktion benötigt deinen API-Key (Einstellungen).',
        apiKeyRequiredSuffix: 'benötigt Key',
        hintToggleLabel: 'Erklärung',
        settingsFeatPillCheckbox: 'Pill-Reminder (konfigurierbares Pillen-Timing Overlay)',
        settingsFeatPillHint: 'Zeigt einen Status und Countdown in der Menüleiste, markiert nimmbereite Pillen und prüft HP/Hunger-Werte.',
        wageMedianLine: '📊 {sparkline} (du: {pctl}. Pzt, Median: {median})',
        wageMedianOnly: '📊 {sparkline} (Median: {median})',
        wageMedianFallback: '(Median nicht verfügbar)',
        wageUncompetitive25: '⚠ Unter 25. Perzentil',
        ntfyBountyTitle: '⚔️ {type}: {defender} vs {attacker}',
        ntfyBountyBody: 'Kämpfe für {allyCountry} ({side}) · Topf {moneyPool} · {ratePer1k}/1k',
        bountyAttackerSide: 'Angreifer',
        bountyDefenderSide: 'Verteidiger',
        bountyPopupAction: 'Kämpfe für',
        bountyPopupContext: '{side} · gegen {opponent}',
        bountyStatPool: 'Topf',
        bountyStatRate: 'Rate/1k',
        bountyPopupClose: 'Schließen',
        bountyTopicLinkLabel: 'Topic öffnen',
        bountyLabelAll: 'Kopfgeld',
        bountyLabelAllies: 'Ally-Bounty',
        bountyLabelCascade: 'Ally-Casc-Bounty',
        settingsFeatBounty: 'Bounty-Benachrichtigungen',
        settingsNtfyTopic: 'ntfy-Topic (Basis)',
        settingsNtfyTopicSecret: 'Topic-Secret (optional)',
        settingsBountyOwnCountry: 'Eigenes Land / Ally-Override (Name oder countryIds)',
        settingsNotifTitle: '🔔 Benachrichtigungs-Optionen (ntfy.sh)',
        settingsPersonalTopic: 'Persönliches Topic',
        settingsPersonalTopicSecret: 'Persönliches Secret (optional)',
        settingsPersonalTopicLinkText: 'Abonnieren / Öffnen',
        settingsFeatSystemAlerts: 'Kritische Plugin-Update- & Sicherheitswarnungen empfangen (schreibgeschützter System-Kanal)',
        settingsBellTitle: 'Push-Benachrichtigungen an-/ausschalten',
        settingsBountyScope: 'Benachrichtigungs-Umfang',
        bountyScopeAll: 'Alle Schlachten (kein Filter)',
        bountyScopeAllies: 'Nur Verbündete (eigenes Land + Allianz + eigene Allies/Pakte)',
        bountyScopeCascade: 'Verbündete + Kaskade (Allianz-Mitglieder Allies/Pakte)',
        settingsBountyMuteDebuff: 'Stummschalten während Debuff aktiv ist',
        settingsPillSettingsLabel: 'Optionen für Pillen-Timing',
        settingsPillBuffLabel: 'Buff-Dauer (Stunden)',
        settingsPillKnifeLabel: 'Messer-Dauer (Stunden)',
        settingsPillDebuffLabel: 'Debuff gesamt (Stunden)',
        settingsPillPrefFromLabel: 'Bevorzugtes Fenster ab',
        settingsPillPrefToLabel: 'Bevorzugtes Fenster bis',
        settingsFeatPillNotifHnH: 'H&H voll Benachrichtigungen (ntfy.sh)',
        settingsFeatPillNotifWindow: 'Bevorzugtes Pillenfenster Benachrichtigungen (ntfy.sh)',
        settingsFeatPillNotifDebuff: 'Debuff abgelaufen Benachrichtigungen (ntfy.sh)',
        settingsFeatCompanyEco: 'Firmen-Ökonomie Overlay aktivieren',
        settingsFeatCompanyEcoHint: 'Zeigt Nettoprofit und Lagerkapazität bei Firmen. Wenn die Glocke aktiviert ist, wird zusätzlich ein Alarm (Desktop & ntfy.sh) gesendet, sobald das Lager voll ist.',
        settingsFeatCompanyAlertsInline: '🔔 Lager-Alarm',
        settingsFeatAlertCompanyStorage: 'Alarm: Lager voll / Keine Rohstoffe',
        settingsFeatAlertCompanyBonus: 'Alarm: Produktionsbonus gesunken',
        settingsFeatAlertCompanyTax: 'Alarm: Lohnsteuer gestiegen',
        settingsFeatAlertCompanyDeposit: 'Alarm: Regions-Deposit läuft ab',
        settingsFeatBetterRegion: 'Alarm: Bessere Region verfügbar',
        settingsFeatMuHealDim: 'MU-Heilung ausgrauen während Debuff / bei vollem Leben',
        muHealDimReasonDebuff: 'Pillen-Debuff aktiv',
        muHealDimReasonFullHP: 'Leben voll',
        muHealDimReasonBoth: 'Debuff aktiv & Leben voll',
        ntfyHnHFullTitle: '🍗 Leben & Hunger voll',
        ntfyHnHFullBody: 'Dein Leben und dein Hunger sind beide bei 100%! Bereit für eine Pille.',
        ntfyPillWindowTitle: '💊 Bevorzugtes Pillenfenster erreicht',
        ntfyPillWindowBody: 'Du hast dein bevorzugtes Pillenzeitfenster ({time}) erreicht.',
        ntfyDebuffGoneTitle: '✨ Pillen-Debuff abgelaufen',
        ntfyDebuffGoneBody: 'Dein Pillen-Debuff ist abgelaufen. Du kannst jetzt die nächste Pille nehmen.',
        pillTakeNowOverlay: 'NEHMEN',
        pillTopUpOverlay: 'ERST FÜLLEN',
        pillPreferredWindow: '{from} - {to}',
        pillPhaseBuff: 'Aktiv-Phase',
        pillPhaseKnife: 'Messer-Phase',
        pillPhaseRecover: 'Regen-Phase',
        pillPhaseReady: 'BEREIT',
        pillPhaseGated: 'Pille in',
        pillGatingHeader: 'Pillen-Bedingungen',
        pillHeadlineWindow: 'ab {time}',
        pillHeadlineWindowTimer: 'für {duration}',
        pillHeadlineHnH: 'H&H voll',
        pillHeadlineHnHTimer: 'in {duration}',
        pillGateHnHWait: 'H&H voll in ~{time} ({pct}%)',
        pillGateHnHReady: '✓ H&H 100%',
        pillGateDebuffWait: 'Debuff weg in ~{time}',
        pillGateDebuffReady: '✓ kein Debuff',
        pillGateNoAnchor: 'kein Pillen-Anker',
        pillGateWindowWait: 'Fenster ab {time} (in {duration})',
        pillGateWindowReady: '✓ Fenster ab {time}',
        pillOverlayReady: 'jetzt',
        pillDetailNext: 'Nächste Transition',
        pillDetailPreferred: 'Zeitfenster',
        pillDetailGatingReady: 'Bereit für die Pille!',
        pillDetailGatingTopUp: 'Warten auf H&H: ~{time} ({pct}%, nächstes Update in {next})',
        pillSpendableFree: '⬇ {val} frei',
        pillSpendableNone: '✕ 0 frei',
        pillHnHFullIn: 'H&H voll in {duration}',
        pillNextTickIn: 'Tick in {duration}',
        craftTitle: 'Crafting-Berater',
        craftResourceCost: 'Ressourcenkosten: {val} Gold (Stahl: {steelPrice}/Einh., Schrott: {scrapsPrice}/Einh.)',
        craftProfitRange: 'Profit-Spanne (nach typischem Preis sortiert):',
        craftProfitSpecific: 'Profit-Spanne: {min} bis {max}',
        craftProfitMedian: 'Erwarteter Profit (typischer Preis): {profit}',
        craftWorstItem: 'Schlechteste Option ({item}): {profit}',
        craftBestItem: 'Beste Option ({item}): {profit}',
        craftMarketRange: 'Marktspanne: {min} bis {max} Gold',
        craftItemRange: 'Spanne {min}–{max}',
        craftMissingPrices: '⚠️ Marktpreise für Stahl/Schrott nicht gefunden. Besuche den Markt zum Aktualisieren.',
        today: 'heute',
        tomorrow: 'morgen',
        yesterday: 'gestern',
        settingsSave: 'Speichern',
        settingsClear: 'Cache leeren',
        settingsClose: 'Schließen',
        settingsHelpSummary: 'ℹ Spickzettel (Hilfe & Erklärung)',
        settingsHelpTitle: 'ℹ Spickzettel (Hilfe & Erklärung)',
        localeOption_de: 'Deutsch',
        localeOption_en: 'Englisch',
        settingsHelpContent: `<strong>Bedeutung der Empfehlungen (Farbe + Symbol):</strong>
            <ul>
              <li>💎 <strong>KEEP (Blau)</strong>: Item behalten. Gilt für die Top 3 deines Bestands (pro Typ/Tier) oder falls das Item unter den besten 33% (Top-Roll) deines Inventars liegt.</li>
              <li>✋ <strong>HOLD (Orange)</strong>: Behalten / Aufheben. Das Item liegt in den besten 10% des theoretisch möglichen Wertebereichs (Top-Itemscore). Wird nur vergeben, wenn es kein 💎 KEEP ist.</li>
              <li>💰 <strong>SELL (Grün)</strong>: Im Markt verkaufen. Lohnt sich wirtschaftlich, da der Netto-Marktpreis (abzüglich 1% Steuer) den Schredder-Wert übersteigt.</li>
              <li>🔨 <strong>SCRAP (Rot)</strong>: Zerschreddern. Lohnt sich wirtschaftlich, da der Schredder-Wert höher ist als der Netto-Verkaufspreis.</li>
            </ul>
            <strong>Anzeigen auf den Inventarkarten:</strong>
            <ul>
              <li><strong>Oben links (Stat-Wert):</strong> Der Rüstungs-Stat bzw. Waffenscore (Attack + Crit * Gewicht). <em>Blau unterlegt</em> = Top 3 in deinem Bestand (Stock Keep). <em>Grau</em> = Normal.</li>
              <li><strong>Unten (Preise):</strong> Untereinander 🔨 [Schrottwert] und 💰 [Marktpreis]. <em>Grün unterlegt</em> = Schreddern lohnt sich mehr. <em>Orange</em> = Verkaufen lohnt sich mehr.</li>
            </ul>
            <strong>Einstellungen:</strong>
            <ul>
              <li><strong>API-Token</strong>: Erforderlich für den Abruf aktueller Marktpreise (Ausrüstung und Schrott).</li>
            </ul>
            <strong>Pillentimer 💊:</strong>
            <ul>
              <li>Zählt zur nächsten Pille runter-das Späteste aus: <em>H&amp;H voll</em>, <em>Debuff vorbei</em> und Beginn deines <em>Wunschfensters</em>.</li>
              <li>Buff/Debuff wird am Pillen-Icon auf deinem eigenen Profil erkannt. „kein Pillen-Anker" heißt nur: noch keiner erkannt.</li>
            </ul>
            <strong>H&amp;H-Budget-Balken:</strong>
            <ul>
              <li>Die Kerbe im Leben-/Hunger-Balken ist der <em>Floor</em>: bis dahin runterspielen, dann füllt dich die Regeneration bis zur Pillenzeit wieder auf 100%.</li>
              <li>Der helle Abschnitt über dem Floor ist <em>frei verspielbar</em> (attacken / gegessen werden). <em>✕ 0 frei</em> = nicht anfassen, du brauchst alles zum Auffüllen.</li>
            </ul>`,
        settingsPriceFormat: 'Preisformat: [Schrottwert]/[Marktpreis]',
        menuSettings: 'Inventory Advisor-Einstellungen',
        menuClearRescan: 'Cache leeren + neu scannen',
        menuCheckUpdates: 'Nach Updates suchen',
        updateAvailableTitle: '⚠ Update verfügbar (v{ver})',
        updateAvailableBody: 'Eine neuere PROST-Version (v{ver}) ist verfügbar. Aktualisiere jetzt — veraltete Versionen können Code enthalten, der gegen Spielregeln verstößt.',
        directUpdateLink: 'Direkt-Update',
        updateAvailableBodyShort: 'Neue Version verfügbar.',
        updateConfirmText: 'Eine neuere Version von PROST (v{ver}) ist verfügbar!\n\nAktuelle Version: v{current}\n\nMöchtest du das Update jetzt direkt installieren?',
        updateUpToDateText: 'PROST ist auf dem neuesten Stand (v{current}).',
        gearTooltipTitle: 'Inventory Advisor-Einstellungen',
        gearTooltipScrapPrice: 'Schrottpreis: {price}/Einh. ({age})',
        gearTooltipItemPrices: 'Item-Preise: {count} im Cache ({age})',
        gearTooltipTxHistory: 'Transaktions-Verlauf: {count} Items im Cache',
        gearTooltipRateLimited: 'API-Limit-Wartezeit {sec}s',
        dataStrip_scrapPrice: 'Schrottpreis:  {price} / Einh.   (geladen {age})\n',
        dataStrip_itemPrices: 'Item-Preise:  {count} im Cache   (geladen {age})\n',
        dataStrip_scrapedMkt: 'Gescrapter Markt: {count} Items   (besuche Markt -> Ausrüstung zum Updaten)\n',
        dataStrip_txHistory: 'Transaktions-Verlauf: {count} Items im Cache\n',
        dataStrip_status: 'Status:       {status}',
        status_rateLimited: 'API-LIMITERREICHT',
        status_stale: 'veraltet (Cache TTL abgelaufen)',
        status_fresh: 'aktuell',
        rateLimitBanner: '⚠ API-Limit erreicht! Wartezeit aktiv ({sec}s)-zeige zwischengespeicherte Preise.',
        marketGraph24h: '24h',
        marketGraph3d: '3d',
        marketGraphLegendNative: 'Tagesschnitt',
        marketGraphLegendIntraday: 'Intraday',
        marketGraphHoverPrice: '☉ {price}',
        settingsFeatMarketGraphCheckbox: 'Ressourcen-Markt Intraday-Grafik',
        settingsFeatMarketGraphHint: 'Blendet einen Intraday-Preisverlauf (24h/3d) im Kauf-/Verkaufs-Modal von Ressourcen ein.',
        settingsFeatPnlTrackerCheckbox: 'Täglicher P&L Tracker',
        settingsFeatPnlTrackerHint: 'Zeigt deinen täglichen Gewinn/Verlust Tracker in der Topbar neben deinem Goldstand an.',
        orderRadarTitle: '⚔ ORDERS',
        orderRadarDef: 'Def',
        orderRadarAtt: 'Att',
        settingsFeatOrderRadarCheckbox: 'Order-Radar (Länder- & MU-Header)',
        settingsFeatOrderRadarHint: 'Zeigt aktuell gesetzte Battle-Orders direkt im Header-Banner von Länder- und MU-Seiten an.',
        settingsBattleSettingsLabel: '⚔️ Battle-Advisor Optionen',
        orderRadarPriorityRed: 'Order mit hoher Priorität',
        orderRadarPriorityYellow: 'Order mit mittlerer Priorität',
        orderRadarPriorityGreen: 'Order mit niedriger Priorität',
        troopRadarTitle: '⚔ TRUPPEN-RADAR',
        troopRadarReady: 'Kampfbereit',
        troopRadarWarskiller: 'Warskiller',
        troopRadarPilled: 'Gepillt',
        troopRadarAvgHp: 'Ø HP',
        troopRadarWar: 'WAR',
        troopRadarEco: 'Eco',
        troopRadarHybrid: 'Hybrid',
        troopRadarPillOn: 'gepillt',
        troopRadarPillOff: 'bereit zu pillen',
        troopRadarPillCd: 'nicht bereit',
        troopRadarDamagePotential: 'Schadenspot.',
        troopRadarDmgComputed: '{done}/{total} ber.',
        troopRadarModeTag: 'Tag',
        troopRadarModeLive: 'Live',
        troopRadarLiveUntil: 'bis {time}',
        troopRadarLiveObserved: 'Ø real {val}',
        troopRadarSubWarskiller: 'von Warskillern',
        troopRadarSubActive: 'von aktiven Mitgliedern',
        troopRadarHunger: 'Hunger',
        troopRadarHpHunger: 'Ø Leben/Hunger',
        troopRadarLiveHorizonTitle: 'Live-Horizont anpassen',
        troopRadarLiveHorizonHint: 'Wähle die Ziel-Uhrzeit (0-23 Uhr) für die Live-Schadensberechnung:',
        troopRadarPillReadyShort: 'bereit',
        troopRadarPillCdShort: 'n. bereit',
        troopRadarPillOffShort: 'ungepillt',
        settingsFeatTroopRadarCheckbox: 'Truppen-Radar (MU-Member-Liste & Header)',
        settingsFeatTroopRadarHint: 'Zeigt Kampfbereitschaft (HP, Pillen-Status, Skill-Klasse) in MU-Mitgliederlisten und Header an.',
        supporterAdj0: 'Legendärer',
        supporterAdj1: 'Glorreicher',
        supporterAdj2: 'Ehrenhafter',
        supporterAdj3: 'Tapferer',
        supporterAdj4: 'Unerbittlicher',
        supporterAdj5: 'Gefürchteter',
        supporterAdj6: 'Unaufhaltsamer',
        supporterAdj7: 'Furchtloser',
        supporterAdj8: 'Meisterhafter',
        supporterAdj9: 'Unbezwingbarer',
        settingsFeatProfileCharsheetCheckbox: 'Charakterbogen-Strip (Spieler-Profile)',
        settingsFeatProfileCharsheetHint: 'Zeigt einen DnD-artigen Charakterbogen (Leben, Hunger, Skill-Klasse) auf Spieler-Profilseiten.',
        profileClassWar: 'Krieger',
        profileClassHybrid: 'Söldner',
        profileClassEco: 'Magnat',
        profileClassBrawler: 'Raufbold',
        profileClassGunslinger: 'Revolverheld',
        profileClassRifleman: 'Schütze',
        profileClassSniper: 'Scharfschütze',
        profileClassTankCommander: 'Panzerfahrer',
        profileClassFighterPilot: 'Kampfjet-Pilot',
        profileClassThug: 'Schläger',
        profileClassMercenary: 'Söldner',
        profileClassBulwark: 'Bollwerk',
        profileClassJuggernaut: 'Juggernaut',
        profileClassFortress: 'Festung',
        profileClassTitan: 'Titan',
        profileClassThief: 'Dieb',
        profileClassScout: 'Späher',
        profileClassSkirmisher: 'Plänkler',
        profileClassAssassin: 'Assassine',
        profileClassPhantom: 'Phantom',
        profileClassShadow: 'Schatten',
        profileClassWorker: 'Arbeiter',
        profileClassCreator: '🍻 PROST-Braumeister',
        profileClassShiftSupervisor: 'Schichtleiter',
        profileClassForeman: 'Vorarbeiter',
        profileClassTechnician: 'Techniker',
        profileClassMasterCraftsman: 'Meister',
        profileClassChiefEngineer: 'Chefingenieur',
        profileClassTrader: 'Händler',
        profileClassMerchant: 'Kaufmann',
        profileClassEntrepreneur: 'Unternehmer',
        profileClassInvestor: 'Investor',
        profileClassTycoon: 'Tycoon',
        profileClassMagnate: 'Magnat',
        profileClassOverseer: 'Aufseher',
        profileClassAdministrator: 'Verwalter',
        profileClassManager: 'Manager',
        profileClassDirector: 'Direktor',
        profileClassCEO: 'Geschäftsführer',
        profileClassChairman: 'Vorstand',
        profileClassAdventurer: 'Abenteurer',
        profileClassFreelancer: 'Freiberufler',
        profileClassVeteran: 'Veteran',
        profileClassWarlord: 'Warlord',
        profileClassSyndicateBoss: 'Syndikat-Boss',
        profileClassEmperor: 'Imperator',
        profileClassOpportunist: 'Opportunist',
        profileClassFortuneHunter: 'Glücksritter',
        profileClassGambler: 'Zocker',
        profileClassHighRoller: 'Hasardeur',
        profileClassSpeculator: 'Spekulant',
        profileClassCasinoBoss: 'Casino-Boss',
        profileHp: 'Leben',
        profileHunger: 'Hunger',
        customBaselineTitle: 'Baseline-Set bearbeiten',
        customBaselineHint: 'Gilt nur für Tag. JSON — nur Format wird geprüft (Slots + Zahlen). Ungültig → Standard.',
        customBaselineCheatTitle: 'Cheat-Sheet · gültige Stat-Ranges je Tier',
        customBaselineBtnReset: 'Zurücksetzen',
        customBaselineBtnCancel: 'Abbrechen',
        customBaselineBtnSave: 'Speichern',
        customBaselineToastReset: 'Auf Standard zurückgesetzt',
        customBaselineToastSaved: 'Gespeichert · Tag-Schaden neu berechnet',
        customBaselineToastInvalid: 'Format ungültig — auf Standard zurückgesetzt'
      }
    },

  };

  const originalTitles = new WeakMap();

  const SCOPING_STATS = {
    scansCount: 0,
    imagesChecked: 0,
    skinsDetected: 0,
    itemsDetected: 0,
    shopChecksCount: 0,
    lastScanTimeMs: 0
  };
  let cachedCards = null;
  let cachedCardsTime = 0;

  // ───────────────────────────────────────────────────────────────────────────
  // Storage (namespaced GM_* with light token obfuscation)
  // ───────────────────────────────────────────────────────────────────────────
  const NS = 'wia.';
  const KEYS = {
    token: NS + 'token',
    tokenFormat: NS + 'tokenFormat',
    customBaselineSet: NS + 'customBaselineSet',
    locale: NS + 'locale',
    priceCache: NS + 'priceCache',     // { data, fetchedAt }-materials map
    scrapCache: NS + 'scrapCache',     // { price, fetchedAt }-legacy, unused
    transactionsCache: NS + 'transactionsCache', // { [itemCode]: { data, fetchedAt } }-equipment transactions
    apiBase: NS + 'apiBase',
    rateLimitedUntil: NS + 'rlUntil',
    ntfyRateLimitedUntil: NS + 'ntfyRlUntil',
    ntfy429Streak: NS + 'ntfy429Streak',
    stockKeepCount: NS + 'stockKeepCount',
    featCompanyEco: NS + 'featCompanyEco',
    featCompanyAlerts: NS + 'featCompanyAlerts',
    featAlertCompanyStorage: NS + 'featAlertCompanyStorage',
    featAlertCompanyBonus: NS + 'featAlertCompanyBonus',
    featAlertCompanyTax: NS + 'featAlertCompanyTax',
    featAlertCompanyDeposit: NS + 'featAlertCompanyDeposit',
    featBetterRegion: NS + 'featBetterRegion',
    ecoBetterRegionAlerts: NS + 'ecoBetterRegionAlerts',
    ecoTrackingState: NS + 'ecoTrackingState',
    ecoCountryTax: NS + 'ecoCountryTax',
    ecoRegionData: NS + 'ecoRegionData',
    featScratchpad: NS + 'featScratchpad',
    featNotes: NS + 'featNotes',
    featBattleAdvisor: NS + 'featBattle',
    featOrderRadar: NS + 'featOrderRadar',
    featTroopRadar: NS + 'featTroopRadar',
    troopRadarLiveHorizonHour: NS + 'troopRadarLiveHorizonHour',
    featProfileCharsheet: NS + 'featProfileCharsheet',
    regionMap: NS + 'regionMap',
    alliedCountryCodes: NS + 'alliedCodes',
    featPillReminder: NS + 'featPill',
    featPillNotifHnH: NS + 'featPillNotifHnH',
    featPillNotifWindow: NS + 'featPillNotifWindow',
    featPillNotifDebuff: NS + 'featPillNotifDebuff',
    lastNotifiedHnH: NS + 'lastNotifiedHnH',
    hnhNotifyCooldownUntil: NS + 'hnhNotifyCooldownUntil',
    lastNotifiedPillWindowDate: NS + 'lastNotifiedPillWindowDate',
    lastNotifiedDebuffEnd: NS + 'lastNotifiedDebuffEnd',
    featBountyNotify: NS + 'featBounty',
    featBountyNotif: NS + 'featBountyNotif',
    ntfyTopic: NS + 'ntfyTopic',
    ntfyTopicSecret: NS + 'ntfyTopicSecret',
    personalTopic: NS + 'personalTopic',
    personalTopicSecret: NS + 'personalTopicSecret',
    bountyOwnCountryOverride: NS + 'bountyOwnCountry',
    bountyLastPollAt: NS + 'bountyLastPollAt',
    bountyPollLock: NS + 'bountyPollLock',
    bountySeen: NS + 'bountySeen',
    ownCountryCache: NS + 'ownCountryCache',
    featEquipSellCalc: NS + 'featEquipSellCalc',
    equipSellCalcLastPrice: NS + 'equipSellCalcLastPrice',
    seenFeatures: NS + 'seenFeatures',
    baselineVersion: NS + 'baselineVer',
    bountyLocalSeen: NS + 'bountyLocalSeen',
    bountyMirrorSeen: NS + 'bountyMirrorSeen',
    bountyClientId: NS + 'bountyClientId',
    bountyTopicBase: NS + 'bountyTopicBase',
    bountyMirrorLastPollAt: NS + 'bountyMirrorLastPollAt',
    bountyMirrorPollLock: NS + 'bountyMirrorPollLock',
    bountyMirrorProcessedHashes: NS + 'bountyMirrorProcessedHashes',
    bountyAllyCache: NS + 'bountyAllyCache',
    bountyCountryMap: NS + 'bountyCountryMap',
    pillTakenAt: NS + 'pillTakenAt',
    pillState: NS + 'pillState',
    pillBuffH: NS + 'pillBuffH',
    pillKnifeH: NS + 'pillKnifeH',
    pillDebuffH: NS + 'pillDebuffH',
    pillPrefWindowFrom: NS + 'pillPrefFrom',
    pillPrefWindowTo: NS + 'pillPrefTo',
    featMarketGraph: NS + 'featMarketGraph',
    marketGraphRange: NS + 'mktGraphRange',
    priceSeries: NS + 'priceSeries',
    resourceTransactionsCache: NS + 'resTxsCache',
    persistedAdvice: NS + 'persistedAdvice',
    featPnlTracker: NS + 'featPnlTracker',
    featItemAdvisor: NS + 'featItemAdvisor',
    featCraftingAdvisor: NS + 'featCraftingAdvisor',
    pnlLedger: NS + 'pnl.ledger',
    pnlYesterday: NS + 'pnl.yesterday',
    pnlCostBasis: NS + 'pnl.costBasis',
    pnlSnapshots: NS + 'pnl.snapshots',
    pnlSchemaVersion: NS + 'pnl.schemaVersion',
    debug: NS + 'debug',
    pnlProcessedTxs: NS + 'pnl.processedTxs',  // persistent (history-spanning) tx-id dedup for cost-basis + booking
    pnlBadTx: NS + 'pnl.badTx',                // quarantine retry attempts mapping for bad transactions
    gatewayTimeoutLog: NS + 'gatewayTimeoutLog',   // persisted timestamps, to correlate timeouts with time-of-day across sessions
    gatedProcedures: NS + 'gatedProcedures',
    gatedResetV090: NS + 'gatedResetV090',
    bountyScope: NS + 'bountyScope',
    bountyAllianceNameCache: NS + 'bountyAllianceNameCache',
    apiBaseGatewayMigrated: NS + 'apiBaseGatewayMigrated',
    bountyAutoTopic: NS + 'bountyAutoTopic',
    bountyIdentityCache: NS + 'bountyIdentityCache',
    bountyMuteDebuff: NS + 'bountyMuteDebuff',
    featMuHealDim: NS + 'featMuHealDim',
    lastVersionCheckAt: NS + 'lastVersionCheckAt',
    latestKnownVersion: NS + 'latestKnownVersion',
    featSystemAlerts: NS + 'featSystemAlerts',
    systemAlertLastPollAt: NS + 'systemAlertLastPollAt',
    systemAlertPollLock: NS + 'systemAlertPollLock',
    systemAlertSeenSeq: NS + 'systemAlertSeenSeq',
    tourDismissed: NS + 'tourDismissed',   // user chose "don't show again" for the onboarding prompt
    tourCompleted: NS + 'tourCompleted',   // token successfully configured via the tour
  };

  let _resolvedMarketTaxPct = null;

  const gatewayBases = CONFIG.apiBases.filter((b) => {
    try { return new URL(b).hostname === 'gateway.warerastats.io'; } catch (e) { return false; }
  });
  const api2Bases = CONFIG.apiBases.filter((b) => {
    try { return new URL(b).hostname === 'api2.warera.io'; } catch (e) { return false; }
  });

  const memoryCache = {};

  function readCache(key) {
    if (memoryCache[key] !== undefined) {
      return memoryCache[key];
    }
    const val = GM_getValue(key, null);
    let defaultVal = {};
    if (key === KEYS.priceCache || key === KEYS.pnlLedger || key === KEYS.pnlYesterday || key === KEYS.pnlCostBasis || key === KEYS.pnlSnapshots || key === KEYS.pnlProcessedTxs || key === KEYS.pnlBadTx) {
      defaultVal = null;
    }
    let valWithDefault = (val === undefined || val === null) ? defaultVal : val;
    if (typeof valWithDefault === 'string' && (valWithDefault.startsWith('{') || valWithDefault.startsWith('['))) {
      try {
        valWithDefault = JSON.parse(valWithDefault);
      } catch (e) {
        // Fallback if parsing fails
      }
    }
    memoryCache[key] = valWithDefault;
    return valWithDefault;
  }

  function writeCache(key, value) {
    memoryCache[key] = value;
    if (value != null && (typeof value === 'object' || Array.isArray(value))) {
      GM_setValue(key, JSON.stringify(value));
    } else {
      GM_setValue(key, value);
    }
  }

  function getPersistedAdvice(itemId, statsHash, priceFetchedAt) {
    if (!itemId) return null;
    const pa = readCache(KEYS.persistedAdvice);
    const cached = pa[itemId];
    if (!cached) return null;
    if (cached.statsHash !== statsHash || cached.priceFetchedAt !== priceFetchedAt) {
      return null;
    }
    return cached.result;
  }

  function setPersistedAdvice(itemId, result, statsHash, priceFetchedAt) {
    if (!itemId) return;
    const pa = { ...readCache(KEYS.persistedAdvice) };
    pa[itemId] = { result, statsHash, priceFetchedAt };
    writeCache(KEYS.persistedAdvice, pa);
  }

  let menuSettingsId = null;
  let menuClearId = null;
  let menuUpdateId = null;
  let menuDebugId = null;
  let menuPickId = null;
  function setToken(t) {
    const old = getToken();
    // Plaintext storage makes stored values auditable.
    // TM/GM storage is sandboxed and not accessible by page scripts.
    GM_setValue(KEYS.token, t || '');
    GM_setValue(KEYS.tokenFormat, 'plain');
    if (old !== t) {
      GM_setValue(KEYS.gatedProcedures, []);
    }
  }
  function getToken() {
    const token = GM_getValue(KEYS.token, '');
    const format = GM_getValue(KEYS.tokenFormat, '');
    if (token && format !== 'plain') {
      // One-time upgrade: clear legacy key and set marker
      GM_setValue(KEYS.token, '');
      GM_setValue(KEYS.tokenFormat, 'plain');
      const msg = t('tokenStorageUpgraded') || 'API key storage was upgraded — please re-enter your API key in Settings.';
      setHealth('api', 'warn', msg);
      if (typeof showLocalPersonalPopup === 'function') {
        showLocalPersonalPopup('api', t('tokenStorageUpgradedTitle') || 'API Key Upgraded', msg, '⚠️');
      }
      return '';
    }
    if (!token && format !== 'plain') {
      GM_setValue(KEYS.tokenFormat, 'plain');
    }
    return token;
  }
  // fallback prices helper removed
  function clearCache() {
    writeCache(KEYS.priceCache, null);
    writeCache(KEYS.transactionsCache, {});
    writeCache(KEYS.persistedAdvice, {});
    GM_setValue(KEYS.gatedProcedures, []);
    writeCache(KEYS.pnlLedger, null);
    writeCache(KEYS.pnlYesterday, null);
    writeCache(KEYS.pnlCostBasis, null);
    writeCache(KEYS.pnlSnapshots, null);
    GM_setValue(KEYS.scrapCache, null);
    GM_setValue(KEYS.resourceTransactionsCache, {});
    GM_setValue(KEYS.priceSeries, {});
    GM_setValue(KEYS.apiBase, '');
    for (const key in memoryCache) {
      delete memoryCache[key];
    }
    inFlightPrices = null;
    log('cache cleared');
  }

  let settingsModalBg = null;

  function localeFlag(locale) {
    return locale === 'en' ? '🇬🇧' : '🇩🇪';
  }

  function localeMenuLabel(locale) {
    return locale === 'en' ? t('localeOption_en') : t('localeOption_de');
  }

  function setLocale(locale) {
    if (locale !== 'de' && locale !== 'en') return;
    CONFIG.locale = locale;
    if (typeof window !== 'undefined') {
      window.__WIA_LOCALE__ = locale;
    }
    GM_setValue(KEYS.locale, locale);
    refreshMenuCommands();
    updateStatusIndicator();
    if (settingsModalBg && document.body.contains(settingsModalBg)) {
      renderSettingsModal(settingsModalBg);
    }
  }

  function refreshMenuCommands() {
    if (typeof GM_unregisterMenuCommand === 'function') {
      if (menuSettingsId != null) GM_unregisterMenuCommand(menuSettingsId);
      if (menuClearId != null) GM_unregisterMenuCommand(menuClearId);
      if (menuDebugId != null) GM_unregisterMenuCommand(menuDebugId);
      if (menuPickId != null) GM_unregisterMenuCommand(menuPickId);
      if (menuUpdateId != null) GM_unregisterMenuCommand(menuUpdateId);
    }
    menuSettingsId = GM_registerMenuCommand(t('menuSettings'), openSettings);
    menuClearId = GM_registerMenuCommand(t('menuClearRescan'), () => {
      clearCache();
      if (isInventoryPage()) scanInventory(true);
    });
    menuUpdateId = GM_registerMenuCommand(t('menuCheckUpdates'), () => checkForUpdates(true));
    menuDebugId = GM_registerMenuCommand(
      CONFIG.debug ? '🐞 Debug: AN (klick = aus)' : '🐞 Debug: AUS (klick = an)',
      () => setDebug(!CONFIG.debug)
    );
    if (CONFIG.debug) {
      menuPickId = GM_registerMenuCommand(
        '🐞 Debug: Scan First Card Scoping',
        runFirstCardScopingLog
      );
    } else {
      menuPickId = null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Utils
  // ───────────────────────────────────────────────────────────────────────────
  function isNewer(remote, local) {
    if (!remote || !local) return false;
    const cleanRemote = String(remote).split('-')[0];
    const cleanLocal = String(local).split('-')[0];
    const rParts = cleanRemote.split('.').map((x) => parseInt(x, 10) || 0);
    const lParts = cleanLocal.split('.').map((x) => parseInt(x, 10) || 0);
    const len = Math.max(rParts.length, lParts.length);
    for (let i = 0; i < len; i++) {
      const r = rParts[i] || 0;
      const l = lParts[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false;
  }

  function checkForUpdates(manual = false) {
    const nowMs = Date.now();
    const lastCheck = GM_getValue(KEYS.lastVersionCheckAt, 0);
    if (!manual && nowMs - lastCheck < 30 * 60 * 1000) {
      return Promise.resolve();
    }
    return gmRequest({
      method: 'GET',
      url: 'https://api.greasyfork.org/en/scripts/583766.json'
    }).then((res) => {
      if (res.status !== 200) {
        throw new Error('HTTP ' + res.status);
      }
      const data = JSON.parse(res.text);
      if (data && typeof data.version === 'string') {
        GM_setValue(KEYS.lastVersionCheckAt, nowMs);
        GM_setValue(KEYS.latestKnownVersion, data.version);
        const current = SCRIPT_VERSION;
        const newer = isNewer(data.version, current);
        if (manual) {
          if (newer) {
            const yes = confirm(t('updateConfirmText', { ver: data.version, current }));
            if (yes) {
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem('wia-update-pending', 'true');
              }
              window.open('https://update.greasyfork.org/scripts/583766/PROST.user.js', '_blank');
            }
          } else {
            alert(t('updateUpToDateText', { current }));
          }
        }
        if (newer && settingsModalBg && document.body.contains(settingsModalBg)) {
          renderSettingsModal(settingsModalBg);
        }
      }
    }).catch((err) => {
      console.warn('[PROST:update] check failed:', err.message);
      // Backoff: set last version check to 23 hours ago so we retry in ~1 hour instead of instantly hammering on failure
      GM_setValue(KEYS.lastVersionCheckAt, nowMs - 23 * 60 * 60 * 1000);
      if (manual) {
        alert('Check for updates failed: ' + err.message);
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DEBUG / HEALTH layer (see DEBUG_PLAN.md)
  // Toggle via GM menu, URL hash #wia-debug, or WIA.debug(true). All gated on
  // CONFIG.debug → zero overhead in prod. Health is in-memory ONLY (never
  // persisted: GM_setValue is async/expensive on hot paths like the gold observer).
  // ───────────────────────────────────────────────────────────────────────────
  const Debug = { buf: [], max: 300 };   // ring buffer of recent log lines

  const _logRepeat = new Map(); // key -> { count, windowStart, warned }
  function _trackRepeat(feat, level, msg) {
    const key = `${feat}:${level}:${String(msg).slice(0, 80)}`;
    const t = Date.now(); const W = 3000, LIMIT = 15;
    let r = _logRepeat.get(key);
    if (!r || t - r.windowStart > W) { r = { count: 0, windowStart: t, warned: false }; _logRepeat.set(key, r); }
    r.count++;
    if (_logRepeat.size > 200) _logRepeat.delete(_logRepeat.keys().next().value); // bound
    if (r.count > LIMIT) {
      if (!r.warned) {            // surface ONCE per window
        r.warned = true;
        // Only escalate to a health warning for warn/error repeats. A burst of
        // identical DEBUG lines (e.g. 20+ "user.getUserById succeeded" during a
        // legitimately fast bulk batch fetch) is expected, not a sign of a
        // runaway loop — still suppress the console spam below, just don't flip
        // the ampel to warn over it.
        if (level !== 'debug') {
          setHealth(feat, 'warn', `possible loop: "${String(msg).slice(0,60)}" ×${r.count} in ${W}ms`);
        }
        console.warn(`[PROST:${feat}] possible loop — "${String(msg).slice(0,60)}" repeated; suppressing`);
      }
      return true; // caller: suppress further console output for this key this window
    }
    return false;
  }

  // 2 levels only: 'debug' | 'error'. dbg(featureId, level, ...msg)
  function dbg(feat, level, ...msg) {
    const isError = level === 'error';
    if (!isError && !CONFIG.debug) return;

    const msgStr = msg.map(m => (m && m.message) || (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ');
    const isRepeated = _trackRepeat(feat, level, msgStr);

    Debug.buf.push({ t: Date.now(), feat, level, msg });
    if (Debug.buf.length > Debug.max) Debug.buf.shift();

    if (isRepeated) return;

    if (isError || CONFIG.debug) {
      // Route by real console level so browser DevTools' Info/Warnings/Errors
      // filters actually work — previously only 'error' got console.error and
      // everything else (including 'warn') went through console.log, making
      // warnings invisible whenever the console's "Info"/"Log" filter is off.
      const consoleFn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
      consoleFn(`[PROST:${feat}]`, ...msg);
    }
  }

  function reportError(feat, e, ctx, status = 'fail') {
    const msg = (e && e.message) || String(e);
    const fullMsg = ctx ? `${ctx}: ${msg}` : msg;
    const isRepeated = _trackRepeat(feat, 'error', fullMsg);

    Debug.buf.push({ t: Date.now(), feat, level: 'error', msg: [ctx, msg].filter(Boolean) });
    if (Debug.buf.length > Debug.max) Debug.buf.shift();

    setHealth(feat, status, fullMsg, { logChange: false });   // already logged above

    if (!isRepeated) {
      console.error(`[PROST:${feat}]${ctx ? ' ' + ctx : ''}`, e);
    }
    return msg;
  }

  const _loopGuard = new Map();
  function loopGuard(key, max = 20, windowMs = 5000) {
    const t = Date.now(); let r = _loopGuard.get(key);
    if (!r || t - r.start > windowMs) { r = { start: t, n: 0 }; _loopGuard.set(key, r); }
    if (++r.n > max) { reportError('core', new Error('runaway'), `loopGuard ${key} ${r.n}/${windowMs}ms`); return true; }
    return false;
  }

  function exportDebugLog() {
    const lines = [];
    lines.push(`=== PROST Debug Log Export ===`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Version: ${SCRIPT_VERSION}`);
    lines.push(`Has API Key: ${!!getToken()}`);
    lines.push(`Debug Mode: ${!!CONFIG.debug}`);
    lines.push(`Gated Procedures: ${JSON.stringify(GM_getValue(KEYS.gatedProcedures, []))}`);
    lines.push(`Rate Limited Until: ${GM_getValue(KEYS.rateLimitedUntil, 0)} (now: ${now()})`);
    lines.push(`NTFY Rate Limited Until: ${GM_getValue(KEYS.ntfyRateLimitedUntil, 0)}`);
    lines.push(``);
    lines.push(`=== API Observability & Monitoring ===`);
    lines.push(`Total Requests: ${ApiMonitor.metrics.totalRequests}`);
    lines.push(`Successes: ${ApiMonitor.metrics.totalSuccesses} | Failures: ${ApiMonitor.metrics.totalFailures}`);
    lines.push(`Rate Limit Trips: ${ApiMonitor.metrics.rateLimitTrips} | Gated Blocks: ${ApiMonitor.metrics.gatedRequests} | Blocked Requests: ${ApiMonitor.metrics.blockedRequests}`);
    lines.push(`Throttling Wait Time: ${ApiMonitor.metrics.totalWaitTimeMs}ms (${ApiMonitor.metrics.waitCount} calls delayed)`);
    lines.push(`Current Tokens - Official: ${officialBucket.tokens.toFixed(2)} / ${officialBucket.maxTokens} | Gateway: ${gatewayBucket.tokens.toFixed(2)} / ${gatewayBucket.maxTokens}`);
    lines.push(``);
    lines.push(`=== API Procedures ===`);
    for (const [proc, meta] of Object.entries(ApiMonitor.metrics.procedures)) {
      const successRate = meta.calls > 0 ? ((meta.successes / meta.calls) * 100).toFixed(1) : '0.0';
      const lastCallAgoSec = meta.lastCallAt > 0 ? ((Date.now() - meta.lastCallAt) / 1000).toFixed(1) : 'never';
      const errDist = Object.entries(meta.errorsByStatus).map(([st, cnt]) => `${st}:${cnt}`).join(', ') || 'none';
      lines.push(`- ${proc}: ${meta.calls} calls (${meta.successes} ok, ${meta.failures} err, ${successRate}% ok)`);
      lines.push(`  Last call: ${lastCallAgoSec}s ago | Last Error: "${meta.lastError || 'none'}" | Error distribution: ${errDist}`);
    }
    lines.push(``);
    lines.push(`=== Recent API Call History (Last 30) ===`);
    const recent = ApiMonitor.metrics.recentCalls.slice(-30);
    for (const call of recent) {
      const timeStr = new Date(call.t).toISOString().split('T')[1].replace('Z', '');
      const waitStr = call.waitMs > 0 ? ` [waited ${call.waitMs}ms]` : '';
      const durStr = call.duration !== null ? ` in ${call.duration}ms` : '';
      const errStr = call.error ? ` - error: ${call.error}` : '';
      lines.push(`[${timeStr}] ${call.method} ${call.procedure} -> ${call.status}${durStr}${waitStr}${errStr}`);
    }
    lines.push(``);
    lines.push(`=== Recent API Error Intervals (Last 20) ===`);
    const errors = ApiMonitor.metrics.recentErrors;
    for (const err of errors) {
      const timeStr = new Date(err.t).toISOString().split('T')[1].replace('Z', '');
      const intervalStr = err.timeSinceLastErr !== null ? ` (+${(err.timeSinceLastErr / 1000).toFixed(1)}s since last error)` : ' (first error)';
      lines.push(`[${timeStr}] ${err.procedure} -> ${err.status} (${err.error})${intervalStr}`);
    }
    lines.push(``);
    lines.push(`=== Gateway Timeout History (persisted across sessions, last ${GATEWAY_TIMEOUT_LOG_MAX}) ===`);
    const timeoutLog = GM_getValue(KEYS.gatewayTimeoutLog, []);
    if (!timeoutLog.length) {
      lines.push(`(none recorded yet)`);
    } else {
      const first = timeoutLog[0].t;
      const last = timeoutLog[timeoutLog.length - 1].t;
      const spanHours = (last - first) / 3600000;
      lines.push(`Total: ${timeoutLog.length} timeouts over ${spanHours.toFixed(1)}h (${new Date(first).toISOString()} to ${new Date(last).toISOString()})`);
      // Local-hour-of-day histogram — is this worse at certain hours (peak load)
      // or evenly spread (random)? A single session's data can't answer that.
      const byHour = new Array(24).fill(0);
      for (const entry of timeoutLog) byHour[new Date(entry.t).getHours()]++;
      const maxCount = Math.max(1, ...byHour);
      lines.push(`By local hour-of-day:`);
      for (let h = 0; h < 24; h++) {
        if (byHour[h] === 0) continue;
        const barLen = Math.round((byHour[h] / maxCount) * 30);
        lines.push(`  ${String(h).padStart(2, '0')}:00  ${'#'.repeat(barLen)} ${byHour[h]}`);
      }
    }
    lines.push(``);
    lines.push(`=== Feature Health Registry ===`);
    for (const [id, h] of Object.entries(Health)) {
      lines.push(`[${id}] status=${h.status} info="${h.info || ''}" lastRun=${h.lastRun ? new Date(h.lastRun).toISOString() : 'never'}`);
    }
    lines.push(``);
    lines.push(`=== Recent Debug Logs (${Debug.buf.length} entries) ===`);
    for (const entry of Debug.buf) {
      const timeStr = new Date(entry.t).toISOString().split('T')[1].replace('Z', '');
      const msgStr = Array.isArray(entry.msg)
        ? entry.msg.map(m => (m && m.message) || (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ')
        : String(entry.msg);
      lines.push(`${timeStr} [PROST:${entry.feat}] [${(entry.level || 'info').toUpperCase()}] ${msgStr}`);
    }
    return lines.join('\n');
  }
  globalThis.exportDebugLog = exportDebugLog;

  function log(...a) { dbg('core', 'debug', ...a); }   // back-compat alias

  // Health registry: id -> live status. status: 'ok'|'warn'|'fail'|'idle'.
  const Health = {};
  function regFeature(id, name) {
    if (!Health[id]) {
      Health[id] = { name: name || id, status: 'idle', reason: '', lastRun: 0, runs: 0, errors: 0, lastError: '' };
    } else if (name) {
      Health[id].name = name;
    }
    return Health[id];
  }
  function setHealth(id, status, reason = '', { logChange = true } = {}) {
    const h = regFeature(id);
    const changed = h.status !== status || h.reason !== reason;
    h.status = status;
    h.reason = reason;
    h._touched = true;                 // tells guard() not to overwrite with 'ok'
    if (status === 'fail') h.lastError = reason;
    // Many call sites set health directly (selector-miss, loop-detector, feature-
    // specific degraded states) without also calling dbg()/reportError() — those
    // warn/fail transitions were only visible in the live health panel, never in
    // exportDebugLog()'s log. Only log on actual change so a persistent warning
    // re-asserted every poll tick doesn't spam the ring buffer.
    if (logChange && changed && (status === 'warn' || status === 'fail')) {
      Debug.buf.push({ t: Date.now(), feat: id, level: status === 'fail' ? 'error' : 'warn', msg: [reason || status] });
      if (Debug.buf.length > Debug.max) Debug.buf.shift();
    }
    if (typeof updateDebugHud === 'function') updateDebugHud();
    return h;
  }
  // Wrap a feature entrypoint: isolates crashes (one broken feature no longer
  // kills the others) and flips the ampel red with the error reason.
  async function guard(id, fn) {
    const h = regFeature(id);
    h.runs++; h.lastRun = Date.now(); h._touched = false;
    try {
      const r = await fn();
      if (!h._touched) { h.status = 'ok'; h.reason = ''; }   // success & feature didn't self-report
      return r;
    } catch (e) {
      h.errors++;
      reportError(id, e, 'guard');
      return undefined;
    }
  }

  function pick(id, sel, root = document) {
    if (!root) return [];
    const els = root.querySelectorAll(sel);
    if (!els.length) {
      setHealth(id, 'fail', `selector miss: ${sel}`);
      dbg(id, 'debug', `selector miss: ${sel}`);
    }
    return els;
  }


  function setDebug(on) {
    CONFIG.debug = !!on;
    GM_setValue(KEYS.debug, CONFIG.debug);
    if (typeof refreshMenuCommands === 'function') refreshMenuCommands();
    if (CONFIG.debug && typeof runProbes === 'function') runProbes();
    if (typeof updateDebugHud === 'function') updateDebugHud();
    console.log(`[PROST] debug = ${CONFIG.debug}`);
  }

  // Console API. Open DevTools and use WIA.health() / WIA.logs() / WIA.debug(true).
  // Must attach to unsafeWindow-the page console runs in the page realm, not the
  // Tampermonkey sandbox, so a plain `window.WIA` would be invisible there.
  const PAGE_WINDOW = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : (typeof window !== 'undefined' ? window : null);
  function getPagePathname() {
    return (PAGE_WINDOW && PAGE_WINDOW.location && PAGE_WINDOW.location.pathname) || location.pathname;
  }
  if (PAGE_WINDOW) {
    PAGE_WINDOW.PROST = PAGE_WINDOW.WIA = PAGE_WINDOW.PROST_DEBUG = {
      debug: setDebug,
      health() {
        if (typeof runProbes === 'function') runProbes();   // refresh before showing
        const t = {};
        for (const [k, v] of Object.entries(Health)) {
          t[k] = { status: v.status, reason: v.reason, runs: v.runs, errors: v.errors };
        }
        console.table(t);
        return Health;
      },
      probe(id) {
        if (typeof runProbe !== 'function') return 'probes unavailable';
        return id ? runProbe(id) : runProbes();
      },
      logs(n = 50) { return Debug.buf.slice(-n); },
      apiObservability() {
        console.log("=== API Observability ===");
        console.log(`Requests: ${ApiMonitor.metrics.totalRequests} (Success: ${ApiMonitor.metrics.totalSuccesses}, Failure: ${ApiMonitor.metrics.totalFailures})`);
        console.log(`Blocked: ${ApiMonitor.metrics.blockedRequests} (Gated: ${ApiMonitor.metrics.gatedRequests}, Rate-limited: ${ApiMonitor.metrics.rateLimitTrips})`);
        console.log(`Throttling Wait Time: ${ApiMonitor.metrics.totalWaitTimeMs}ms across ${ApiMonitor.metrics.waitCount} delayed calls`);
        console.log(`Tokens - Official: ${officialBucket.tokens.toFixed(2)} / ${officialBucket.maxTokens} | Gateway: ${gatewayBucket.tokens.toFixed(2)} / ${gatewayBucket.maxTokens}`);
        console.table(ApiMonitor.metrics.procedures);
        return {
          metrics: ApiMonitor.metrics,
          officialBucket,
          gatewayBucket,
          dumpLog() {
            return exportDebugLog();
          }
        };
      },
      troopRadar: {
        classify: (skills) => typeof classifyWarskiller === 'function' ? classifyWarskiller(skills) : null,
        evaluatePill: (skills, health, hunger) => typeof evaluatePillStatus === 'function' ? evaluatePillStatus(skills, health, hunger) : null,
        summarize: (members) => typeof summarizeTroops === 'function' ? summarizeTroops(members) : null,
        fetchRoster: (muId) => typeof fetchMuRoster === 'function' ? fetchMuRoster(muId) : null,
        fetchMember: (userId) => typeof fetchTroopMemberData === 'function' ? fetchTroopMemberData(userId) : null,
        fetch: (muId) => typeof fetchFullTroopRadar === 'function' ? fetchFullTroopRadar(muId) : null,
        damage: async (explicitId) => {
          if (typeof printTroopDamageBreakdown === 'function') {
            return await printTroopDamageBreakdown(explicitId);
          }
          return 'printTroopDamageBreakdown not loaded';
        },
        test: async (explicitId) => {
          if (typeof fetchFullTroopRadar !== 'function') return 'troopRadar not loaded';
          let muId = explicitId;
          if (!muId || muId === '<muId>' || (typeof muId === 'string' && muId.includes('<'))) {
            const route = typeof getEntityFromRoute === 'function' ? getEntityFromRoute() : null;
            if (route && route.type === 'mu') {
              muId = route.rawId;
              console.log(`[PROST:troopRadar] Auto-detected MU ID from current route: ${muId}`);
            } else {
              console.warn('[PROST:troopRadar] No MU ID provided. Usage: PROST.troopRadar.test("65a123...") or run while on a /mu/<id> page.');
              return 'Missing MU ID';
            }
          }
          console.log(`[PROST:troopRadar] Testing MU ID: ${muId}...`);
          try {
            const res = await fetchFullTroopRadar(muId);
            console.log('[PROST:troopRadar] Roster:', res.roster);
            console.log('[PROST:troopRadar] Initial Summary (Optimistic):', res.summary);
            const full = await res.detailsPromise;
            console.log('[PROST:troopRadar] Full Members Data:', full.membersData);
            console.log('[PROST:troopRadar] Full Summary:', full.summary);
            return full;
          } catch (err) {
            console.error('[PROST:troopRadar] Test failed:', err.message);
            return { error: err.message };
          }
        }
      },
      tour() { return (typeof startTour === 'function') ? startTour() : 'tour not loaded'; },
      tourDemo(stepIdx) {
        if (typeof PROST !== 'undefined' && typeof PROST.tourDemo === 'function') {
          PROST.tourDemo(stepIdx);
        } else {
          console.warn('[PROST] tourDemo not registered yet (wait for DOM/onboarding module loading)');
        }
      }
    };
  }

  const HEALTH_DOT = { ok: '#3fb950', warn: '#d29922', fail: '#f85149', idle: '#6e7681' };
  let healthShowIdle = false; // session-only; hides idle (not-applicable) rows by default

  // Render the feature ampel list into a container element (in-game Diagnose panel).
  function renderHealthPanel(el) {
    if (!el) return;
    const ids = Object.keys(Health);
    if (!ids.length) { el.innerHTML = '<div style="color:#8b949e; font-size:12px;">keine Features registriert</div>'; return; }

    const idleIds = ids.filter((id) => Health[id].status === 'idle');
    const visibleIds = healthShowIdle ? ids : ids.filter((id) => Health[id].status !== 'idle');

    const toggleBtn = idleIds.length
      ? `<button type="button" class="wia-health-idle-toggle" style="font-size:10px; padding:2px 6px; margin-bottom:6px; cursor:pointer; background:#21262d; color:#8b949e; border:1px solid #30363d; border-radius:4px;">${
          healthShowIdle ? 'idle ausblenden' : `idle anzeigen (${idleIds.length})`
        }</button>`
      : '';

    const rows = visibleIds.map((id) => {
      const h = Health[id];
      const color = HEALTH_DOT[h.status] || HEALTH_DOT.idle;
      const reason = h.reason ? `-<span style="color:#8b949e;">${String(h.reason).replace(/</g, '&lt;')}</span>` : '';
      const meta = `<span style="color:#6e7681; font-size:10px;">runs ${h.runs}, err ${h.errors}</span>`;
      return `<div style="display:flex; align-items:center; gap:8px; padding:3px 0; font-size:12px;">
        <span style="width:9px; height:9px; border-radius:50%; background:${color}; flex:0 0 auto; box-shadow:0 0 4px ${color};"></span>
        <span style="font-weight:600; min-width:96px;">${h.name}</span>
        <span style="color:#c9d1d9;">${h.status}</span>${reason}
        <span style="margin-left:auto;">${meta}</span>
      </div>`;
    }).join('');

    let ampelColor = '#3fb950'; // green
    if (SCOPING_STATS.lastScanTimeMs >= 150) {
      ampelColor = '#f85149'; // red
    } else if (SCOPING_STATS.lastScanTimeMs >= 50) {
      ampelColor = '#d29922'; // yellow
    }

    const perfRow = `
      <div style="border-top:1px solid rgba(148,163,184,.15); margin-top:8px; padding-top:8px; font-size:11px; color:#8b949e; line-height:1.4;">
        <div style="font-weight:bold; color:#c9d1d9; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          <span style="width:7px; height:7px; border-radius:50%; background:${ampelColor}; flex:0 0 auto; box-shadow:0 0 4px ${ampelColor};"></span>
          Scan Performance / Scoping Stats
        </div>
        <div>Last Scan Duration: <strong style="color:#c9d1d9;">${SCOPING_STATS.lastScanTimeMs.toFixed(2)} ms</strong></div>
        <div>Scans Count: <strong style="color:#c9d1d9;">${SCOPING_STATS.scansCount}</strong></div>
        <div>Images Scanned: <strong style="color:#c9d1d9;">${SCOPING_STATS.imagesChecked}</strong> (Skins: ${SCOPING_STATS.skinsDetected}, Items: ${SCOPING_STATS.itemsDetected})</div>
        <div>Shop Checks (URL): <strong style="color:#c9d1d9;">${SCOPING_STATS.shopChecksCount}</strong></div>
      </div>
    `;

    el.innerHTML = `<div style="background:#0d1117; border:1px solid rgba(148,163,184,.25); border-radius:6px; padding:8px; max-height:320px; overflow-y:auto;">${toggleBtn}${rows}${perfRow}</div>`;

    const idleToggleBtn = el.querySelector('.wia-health-idle-toggle');
    if (idleToggleBtn) {
      idleToggleBtn.onclick = (e) => { e.preventDefault(); healthShowIdle = !healthShowIdle; renderHealthPanel(el); };
    }
  }

  // ── Phase 2: route-aware probes ──────────────────────────────────────────
  // Each probe inspects the CURRENT page + injected DOM and returns the real
  // status. This is the source of truth (the start()-time guard status goes
  // stale on SPA navigation). Run on "Aktualisieren" and on every route change.
  const PROBES = {
    advisor() {
      if (!CONFIG.featItemAdvisor) return ['idle', 'disabled in settings'];
      if (!(isInventoryPage() || isMarketPage())) return ['idle', 'not on inventory/market'];
      let cards;
      try { cards = (globalThis.findItemCards || findItemCards)(false); } catch (e) { return ['fail', 'findItemCards threw: ' + e.message]; }
      const n = cards ? cards.size : 0;
      if (!n) return ['fail', 'no item cards found (selector drift?)'];

      let skinCount = 0;
      let unknownSkinCount = 0;
      cards.forEach((img, card) => {
        const info = detectItem(img, card);
        if (info && info.isSkin) {
          skinCount++;
          if (info.type === 'unknown') {
            unknownSkinCount++;
          }
        }
      });

      const badges = document.querySelectorAll('.wia-badge').length;
      if (badges === 0) {
        return ['fail', `advice not rendered (0 badges on ${n} cards)`];
      }

      if (unknownSkinCount > 0) {
        return ['warn', `${unknownSkinCount} Skins ohne Slot — Dump-Tool laufen lassen`];
      }

      return ['ok', skinCount > 0 ? `${skinCount} Skins erkannt` : ''];
    },
    wageMedian() {
      if (!companyEcoModalNode) return ['idle', 'modal closed'];
      if (companyEcoMarketWages) return ['ok', 'market API data active'];
      return ['warn', 'API fallback / top-3 active'];
    },
    battleAdvisor() {
      if (!CONFIG.featBattleAdvisor) return ['idle', 'disabled in settings'];
      if (!isBattlePage()) return ['idle', 'not on battle page'];
      const present = document.querySelector('.wia-battle-primary, .wia-battle-muted');
      return present ? ['ok', ''] : ['fail', 'advisory not injected on battle page'];
    },
    orderRadar() {
      if (!CONFIG.featBattleAdvisor || !CONFIG.featOrderRadar) return ['idle', 'disabled in settings'];
      if (!getToken()) return ['idle', 'no API token set'];
      const route = typeof getEntityFromRoute === 'function' ? getEntityFromRoute() : null;
      if (!route) return ['idle', 'not on country or MU page'];
      const strip = document.getElementById('wia-order-radar');
      if (strip) return ['ok', ''];
      if (typeof orderRadarLastOrders !== 'undefined' && orderRadarLastOrders && orderRadarLastOrders.length === 0) return ['idle', 'no active orders for this entity'];
      const anchor = typeof findEntityBannerAnchor === 'function' ? findEntityBannerAnchor(route) : null;
      if (!anchor) return ['fail', 'header banner container not found'];
      return ['warn', 'radar not injected yet'];
    },
    troopRadar() {
      if (!CONFIG.featTroopRadar) return ['idle', 'disabled in settings'];
      if (!getToken()) return ['idle', 'no API token set'];
      if (!isMuPage()) return ['idle', 'not on MU page'];

      const horizon = String(getLiveHorizonHour()).padStart(2, '0') + ':00';
      const mode = troopRadarDamageMode;
      const details = `Live-Horizont ${horizon}, Modus ${mode}`;

      const injected = document.getElementById('wia-troop-radar-summary');
      if (!injected) {
        return ['warn', `troop radar not injected yet, ${details}`];
      }

      const current = Health['troopRadar'];
      if (current && (current.status === 'warn' || current.status === 'fail')) {
        return [current.status, `${details} (${current.reason})`];
      }

      return ['ok', details];
    },
    pnl() {
      if (!CONFIG.featPnlTracker) return ['idle', 'disabled in settings'];
      const money = document.getElementById('money') || (document.getElementById('layoutUserMenu') && document.getElementById('layoutUserMenu').querySelector('#money'));
      if (!money) return ['warn', 'gold element (#money) not found'];
      const chip = document.getElementById('wia-pnl-tracker');
      return chip ? ['ok', ''] : ['fail', 'chip not injected (#wia-pnl-tracker)'];
    },
    pillReminder() {
      if (!CONFIG.featPillReminder) return ['idle', 'disabled in settings'];
      return document.getElementById('wia-pill-badge') ? ['ok', ''] : ['fail', 'badge not injected (#wia-pill-badge)'];
    },
    marketGraph() {
      if (!CONFIG.featMarketGraph) return ['idle', 'disabled in settings'];
      if (!isMarketPage()) return ['idle', 'not on market page'];
      return document.querySelector('.wia-mkt-overlay-svg') ? ['ok', ''] : ['warn', 'graph not drawn yet'];
    },
    craftAdvisor() {
      if (!CONFIG.featCraftingAdvisor) return ['idle', 'disabled in settings'];
      const modal = document.querySelector('div[id^="headlessui-dialog-panel-"]');
      if (!modal) return ['idle', 'crafting modal not open'];
      return modal.querySelector('.wia-craft-advisor-panel') ? ['ok', ''] : ['warn', 'panel not rendered yet'];
    },
    notes() {
      if (!CONFIG.featNotes) return ['idle', 'disabled in settings'];
      const icons = document.querySelectorAll('.warera-note-icon').length;
      return icons > 0 ? ['ok', ''] : ['idle', 'no player links on this page'];
    },
    api() {
      if (!getToken()) return ['warn', 'no API token set'];
      if (typeof isRateLimited === 'function' && isRateLimited()) return ['warn', 'rate-limited'];
      return ['ok', ''];
    },
    bountyNotify() {
      if (!CONFIG.featBountyNotify) return ['idle', 'disabled in settings'];
      const topic = getEffectiveTopic();
      if (!topic) return ['idle', 'no ntfy topic'];
      const lastPoll = GM_getValue(KEYS.bountyLastPollAt, 0);
      const pollAge = lastPoll ? Math.round((now() - lastPoll) / 1000) : null;
      const ageStr = pollAge !== null ? `${pollAge}s ago` : 'never';
      const allies = GM_getValue(KEYS.bountyAllyCache + '_allies', null);
      const casc = GM_getValue(KEYS.bountyAllyCache + '_casc', null);
      const resolved = (allies && allies.ids ? allies.ids.length : 0) + '/' + (casc && casc.ids ? casc.ids.length : 0);
      return ['ok', `topic: ${topic}, resolved: ${resolved}, last poll: ${ageStr}, cid: ${bountyClientId()}`];
    },
    tour() {
      if (!CONFIG.featTour) return ['idle', 'disabled in settings'];
      if (tourState && tourState.active) {
        const step = TOUR_STEPS[tourState.index];
        const found = !!(step && step.find());
        return found
          ? ['ok', `step ${tourState.index + 1}/${TOUR_STEPS.length}: ${step.id}`]
          : ['warn', `step ${tourState.index + 1} anchor not found: ${step ? step.id : '?'}`];
      }
      if (getToken()) return ['idle', 'token already set'];
      const dismissed = !!GM_getValue(KEYS.tourDismissed, false);
      const completed = !!GM_getValue(KEYS.tourCompleted, false);
      if (completed) return ['idle', 'completed'];
      if (dismissed) return ['idle', 'dismissed'];
      return ['idle', 'not running (prompt available)'];
    },
  };

  function runProbe(id) {
    const p = PROBES[id];
    if (!p) return null;
    let res;
    try { res = p(); } catch (e) { res = ['fail', 'probe threw: ' + e.message]; }
    setHealth(id, res[0], res[1]);
    return { id, status: res[0], reason: res[1] };
  }
  function runProbes() {
    const out = {};
    for (const id of Object.keys(PROBES)) out[id] = runProbe(id);
    return out;
  }

  // ── Phase 3: persistent on-screen HUD (bug button + ampel list) ──────────
  // Only present when CONFIG.debug. A floating button bottom-left shows the
  // worst feature status as a colored dot; click toggles the ampel panel.
  let debugHudEl = null;
  let debugHudOpen = false;
  let hudRefreshPending = false;
  const HEALTH_RANK = { fail: 3, warn: 2, ok: 1, idle: 0 };

  function worstHealthStatus() {
    let worst = 'idle';
    for (const v of Object.values(Health)) {
      if ((HEALTH_RANK[v.status] || 0) > (HEALTH_RANK[worst] || 0)) worst = v.status;
    }
    return worst;
  }

  function buildDebugHud() {
    const wrap = document.createElement('div');
    wrap.id = 'wia-debug-hud';
    wrap.style.cssText = 'position:fixed; left:12px; bottom:12px; z-index:2147483600; font:12px/1.4 system-ui,sans-serif;';
    wrap.innerHTML = `
      <div class="wia-hud-panel" style="display:none; width:300px; margin-bottom:8px; background:#161b22; border:1px solid #30363d; border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,.6); padding:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
          <strong style="color:#c9d1d9;">Feature-Health</strong>
          <div>
            <button type="button" class="wia-hud-reset-sp" style="font-size:11px; padding:2px 8px; cursor:pointer; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:5px; margin-right:4px;" title="Reset Scratchpad Position">SP Reset</button>
            <button type="button" class="wia-hud-refresh" style="font-size:11px; padding:2px 8px; cursor:pointer; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:5px;">↻</button>
          </div>
        </div>
        <div class="wia-hud-body"></div>
      </div>
      <button type="button" class="wia-hud-btn" title="PROST Debug Health" style="width:38px; height:38px; border-radius:50%; cursor:pointer; background:#161b22; border:1px solid #30363d; box-shadow:0 4px 14px rgba(0,0,0,.5); font-size:18px; line-height:1; position:relative;">🐞
        <span class="wia-hud-dot" style="position:absolute; top:-2px; right:-2px; width:12px; height:12px; border-radius:50%; border:2px solid #161b22; background:${HEALTH_DOT.idle};"></span>
      </button>`;
    const btn = wrap.querySelector('.wia-hud-btn');
    const panel = wrap.querySelector('.wia-hud-panel');
    const body = wrap.querySelector('.wia-hud-body');
    btn.onclick = () => {
      debugHudOpen = !debugHudOpen;
      panel.style.display = debugHudOpen ? 'block' : 'none';
      if (debugHudOpen) { runProbes(); renderHealthPanel(body); }
    };
    wrap.querySelector('.wia-hud-refresh').onclick = () => { runProbes(); renderHealthPanel(body); };
    const spResetBtn = wrap.querySelector('.wia-hud-reset-sp');
    if (spResetBtn) {
      spResetBtn.onclick = () => {
        try { GM_deleteValue('wia.scratchpadPanel'); } catch(e){}
        const sp = document.querySelector('.sp-panel');
        if (sp) {
          sp.style.left = '70px';
          sp.style.top = '60px';
          sp.style.width = '340px';
          sp.style.height = '420px';
        }
      };
    }
    return wrap;
  }

  function updateDebugHud() {
    if (!CONFIG.debug || typeof document === 'undefined' || !document.body) {
      if (debugHudEl) { debugHudEl.remove(); debugHudEl = null; debugHudOpen = false; }
      return;
    }
    if (!debugHudEl) {
      debugHudEl = buildDebugHud();
      document.body.appendChild(debugHudEl);
    }
    if (hudRefreshPending) return;
    hudRefreshPending = true;
    setTimeout(() => {
      hudRefreshPending = false;
      if (!debugHudEl) return;
      const dot = debugHudEl.querySelector('.wia-hud-dot');
      if (dot) dot.style.background = HEALTH_DOT[worstHealthStatus()] || HEALTH_DOT.idle;
      if (debugHudOpen) renderHealthPanel(debugHudEl.querySelector('.wia-hud-body'));
    }, 200);
  }

  function now() { return Date.now(); }
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // Run `worker` over `items` with at most `limit` in flight at once, preserving
  // input order in the returned array. Used to throttle bulk gateway fetches so a
  // full-inventory scan doesn't exhaust the token bucket (#82). A worker rejection
  // propagates — callers keep their own per-item try/catch, matching Promise.all.
  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    const width = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    const runner = async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await worker(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: width }, runner));
    return results;
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

  // COMPLIANCE INVARIANT (enforced by tests/test-advisor-load.js compliance suite):
  // Every request is anonymous (no game session cookies) and its headers are built
  // from a fixed allowlist. Cookie / Authorization / bearer tokens can NEVER be sent,
  // regardless of what a caller passes. The user's optional API key travels ONLY as
  // x-api-key. Cross-engine note: Tampermonkey honors `anonymous`; some Violentmonkey
  // builds do not — the allowlist below, not the flag, is the real guarantee.
  const GM_HEADER_ALLOWLIST = ['content-type', 'accept', 'x-api-key', 'title', 'priority', 'tags', 'click'];

  function gmRequest({ method, url, headers, data, timeout }) {
    const safe = {};
    for (const [k, v] of Object.entries(headers || {})) {
      if (v == null) continue;
      if (GM_HEADER_ALLOWLIST.includes(String(k).toLowerCase())) {
        safe[k] = v;
      }
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method || 'GET',
        url,
        headers: safe,
        data,
        anonymous: true,            // strip ambient game-session cookies
        timeout: timeout || CONFIG.requestTimeoutMs,
        onload: (res) => resolve({ status: res.status, text: res.responseText, responseHeaders: res.responseHeaders || '' }),
        onerror: () => reject(new Error('network error: ' + url)),
        ontimeout: () => reject(new Error('timeout: ' + url)),
      });
    });
  }

  function isTimeoutError(err) {
    return !!err && typeof err.message === 'string' && err.message.startsWith('timeout:');
  }

  const GATEWAY_TIMEOUT_LOG_MAX = 500;
  // Persisted (survives reload/session, unlike the in-memory Debug ring buffer)
  // so timeout occurrences can be correlated with time-of-day across many
  // sessions — is the community gateway worse at certain hours, or is it just
  // random? One session's data isn't enough to tell.
  function recordGatewayTimeout(procedure) {
    try {
      const log = GM_getValue(KEYS.gatewayTimeoutLog, []);
      log.push({ t: now(), procedure });
      if (log.length > GATEWAY_TIMEOUT_LOG_MAX) log.splice(0, log.length - GATEWAY_TIMEOUT_LOG_MAX);
      GM_setValue(KEYS.gatewayTimeoutLog, log);
    } catch (e) { /* best-effort */ }
  }

  // Classify + report a failed resolveApi* attempt for one base in the fallback
  // loop: timeouts get a visible api-health warn (so the ampel surfaces gateway
  // degradation instead of a silent hang, #81); other errors just get a debug log.
  function reportApiAttemptFailure(fnName, procedure, base, e) {
    if (isTimeoutError(e)) {
      setHealth('api', 'warn', `${isGateway(base) ? 'gateway' : 'API'} timeout — retrying/degraded`);
      dbg('api', 'warn', `${fnName} ${procedure} timed out on ${base}`);
      if (isGateway(base)) recordGatewayTimeout(procedure);
    } else {
      dbg('api', 'warn', `${fnName} ${procedure} failed on ${base}: ${e.message}`);
    }
  }

  function keyedHeaders() {                               // key only upgrades rate limit
    const k = getToken();
    return k ? { 'x-api-key': k } : {};
  }
  function headersForBase(base) {
    try {
      const h = new URL(base).hostname;
      if (h === 'api2.warera.io') {
        return keyedHeaders();
      }
      if (h === 'gateway.warerastats.io') {
        return { 'X-API-Key': 'prost-userscript' };
      }
    } catch (e) {}
    return {};
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

  const GATED_PROCEDURE_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL for gated procedures

  function sanitizeGatedProcedures() {
    try {
      const raw = GM_getValue(KEYS.gatedProcedures, []);
      if (!Array.isArray(raw)) {
        GM_setValue(KEYS.gatedProcedures, []);
        return [];
      }
      const currentTime = now();
      const clean = [];
      for (const item of raw) {
        const procName = typeof item === 'string' ? item : item?.procedure;
        const timestamp = typeof item === 'object' && item?.at ? item.at : 0;
        if (!procName) continue;
        if (timestamp > 0 && currentTime - timestamp > GATED_PROCEDURE_TTL_MS) {
          dbg('api', 'debug', `un-gated procedure ${procName} (TTL expired)`);
          continue;
        }
        clean.push(typeof item === 'object' ? item : { procedure: procName, at: currentTime });
      }
      GM_setValue(KEYS.gatedProcedures, clean);
      return clean;
    } catch (e) {
      GM_setValue(KEYS.gatedProcedures, []);
      return [];
    }
  }

  function isProcedureGated(procedure) {
    const gated = sanitizeGatedProcedures();
    return gated.some((item) => item.procedure === procedure);
  }
  function gateProcedure(procedure) {
    const gated = sanitizeGatedProcedures();
    if (!gated.some((item) => item.procedure === procedure)) {
      gated.push({ procedure, at: now() });
      GM_setValue(KEYS.gatedProcedures, gated);
      console.warn(`[PROST:api] procedure gated: ${procedure} (auth/permission failure)`);
      dbg('api', 'warn', `procedure gated: ${procedure} (auth/permission failure)`);
      setHealth('api', 'warn', `procedure gated: ${procedure} (auth/permission failure)`);
    }
  }

  // ── ntfy.sh rate-limit layer (separate from the game-API backoff above) ──
  // ntfy.sh temporarily BANS IPs that keep sending after a 429, so every ntfy
  // request (GET history reads AND POST publishes) must go through ntfyRequest().
  // The backoff is GM-persisted → shared across tabs and survives reloads.
  function isNtfyLimited() {
    return now() < GM_getValue(KEYS.ntfyRateLimitedUntil, 0);
  }
  function ntfyLimitRemainingMs() {
    return Math.max(0, GM_getValue(KEYS.ntfyRateLimitedUntil, 0) - now());
  }
  // Backoff escalates with consecutive 429s (5 → 10 → 20 → 40 → 60 min cap):
  // a burst-limit hit recovers after one window, but an exhausted DAILY quota
  // (free tier: 250 msgs/day) would otherwise get poked every 5 min for hours.
  const NTFY_BACKOFF_CAP_MS = 60 * 60 * 1000;
  function ntfyBackoffMsFor(retryAfterSec, streak) {
    const escalated = Math.min(CONFIG.ntfyBackoffMs * Math.pow(2, Math.max(0, (streak || 1) - 1)), NTFY_BACKOFF_CAP_MS);
    return Math.max(escalated, (retryAfterSec || 0) * 1000);
  }
  function parseRetryAfterSec(rawHeaders) {
    const m = /^retry-after:\s*(\d+)\s*$/im.exec(rawHeaders || '');
    return m ? Number.parseInt(m[1], 10) : 0;
  }
  function tripNtfyLimit(scope, url, retryAfterSec) {
    const streak = (GM_getValue(KEYS.ntfy429Streak, 0) || 0) + 1;
    GM_setValue(KEYS.ntfy429Streak, streak);
    const ms = ntfyBackoffMsFor(retryAfterSec, streak);
    GM_setValue(KEYS.ntfyRateLimitedUntil, now() + ms);
    // 'error' level → always logged + in the debug ring buffer, even with CONFIG.debug off.
    dbg(scope, 'error', 'ntfy 429', url, `backoff ${Math.ceil(ms / 1000)}s (streak ${streak})`);
    setHealth(scope, 'warn', `ntfy 429 — backoff ${Math.ceil(ms / 1000)}s`);
  }
  // Returns the response, or null when the request was suppressed (backoff
  // active) or answered 429. Callers must treat null as "retry after backoff":
  // do NOT mark the item as seen/sent, do NOT fall back to sending blind.
  async function ntfyRequest(scope, opts) {
    if (isNtfyLimited()) {
      dbg(scope, 'debug', 'ntfy suppressed', `${Math.ceil(ntfyLimitRemainingMs() / 1000)}s backoff left`, opts.url);
      return null;
    }
    const res = await gmRequest(opts);
    if (res.status === 429) {
      tripNtfyLimit(scope, opts.url, parseRetryAfterSec(res.responseHeaders));
      return null;
    }
    if (GM_getValue(KEYS.ntfy429Streak, 0)) GM_setValue(KEYS.ntfy429Streak, 0);
    return res;
  }

  // tRPC v10 GET query URL: ?input={"key":"value"}
  function trpcUrl(base, procedure, args) {
    const input = encodeURIComponent(JSON.stringify(args === undefined ? {} : args));
    return `${base}/${encodeURIComponent(procedure)}?input=${input}`;
  }

  function unwrapTrpc(text) {
    const parsed = JSON.parse(text);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    if (entry && entry.error) {
      throw new Error('trpc: ' + (entry.error.json?.message || entry.error.message || 'error'));
    }
    const data = entry && entry.result && entry.result.data;
    if (data !== undefined && data !== null) {
      return (typeof data === 'object' && 'json' in data) ? data.json : data;
    }
    if (entry && entry.result !== undefined && entry.result !== null) {
      return entry.result;
    }
    return parsed;
  }

  function unwrapTrpcBatch(text) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('trpc batch: expected array response');
    }
    return parsed.map((entry) => {
      if (entry && entry.error) {
        return { error: new Error('trpc: ' + (entry.error.json?.message || entry.error.message || 'error')) };
      }
      const data = entry && entry.result && entry.result.data;
      if (data !== undefined && data !== null) {
        return { payload: (typeof data === 'object' && 'json' in data) ? data.json : data };
      }
      if (entry && entry.result !== undefined && entry.result !== null) {
        return { payload: entry.result };
      }
      return { payload: entry };
    });
  }

  // ── API Observability & Monitoring ──
  const ApiMonitor = {
    metrics: {
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitTrips: 0,
      gatedRequests: 0,
      blockedRequests: 0,
      totalWaitTimeMs: 0,
      waitCount: 0,
      procedures: {}, // procedure -> { calls: 0, successes: 0, failures: 0, lastCallAt: 0, lastError: '', errorsByStatus: {} }
      recentCalls: [], // ring buffer of last 50 requests
      recentErrors: [], // ring buffer of last 20 failures
    },

    trackCall(procedure, method, args) {
      this.metrics.totalRequests++;
      if (!this.metrics.procedures[procedure]) {
        this.metrics.procedures[procedure] = { calls: 0, successes: 0, failures: 0, lastCallAt: 0, lastError: '', errorsByStatus: {} };
      }
      this.metrics.procedures[procedure].calls++;
      this.metrics.procedures[procedure].lastCallAt = Date.now();

      const callEntry = {
        t: Date.now(),
        procedure,
        method,
        status: null,
        duration: null,
        error: null,
        waitMs: 0,
        blocked: false
      };
      this.metrics.recentCalls.push(callEntry);
      if (this.metrics.recentCalls.length > 50) this.metrics.recentCalls.shift();
      return callEntry;
    },

    trackWait(callEntry, ms) {
      if (ms > 0) {
        this.metrics.waitCount++;
        this.metrics.totalWaitTimeMs += ms;
        if (callEntry) callEntry.waitMs = ms;
      }
    },

    trackBlocked(procedure, reason) {
      this.metrics.totalRequests++;
      this.metrics.totalFailures++;
      this.metrics.blockedRequests++;
      if (reason === 'Gated') {
        this.metrics.gatedRequests++;
      }
      if (!this.metrics.procedures[procedure]) {
        this.metrics.procedures[procedure] = { calls: 0, successes: 0, failures: 0, lastCallAt: 0, lastError: '', errorsByStatus: {} };
      }
      const p = this.metrics.procedures[procedure];
      p.calls++;
      p.failures++;
      p.lastCallAt = Date.now();
      p.lastError = reason;

      const callEntry = {
        t: Date.now(),
        procedure,
        method: 'BLOCKED',
        status: reason,
        duration: 0,
        error: reason,
        waitMs: 0,
        blocked: true
      };
      this.metrics.recentCalls.push(callEntry);
      if (this.metrics.recentCalls.length > 50) this.metrics.recentCalls.shift();
    },

    trackRateLimitTrip() {
      this.metrics.rateLimitTrips++;
    },

    trackResult(callEntry, res, duration, err) {
      if (!callEntry) return;
      callEntry.duration = duration;
      if (res && res.status >= 200 && res.status < 300) {
        this.metrics.totalSuccesses++;
        const p = this.metrics.procedures[callEntry.procedure];
        if (p) p.successes++;
        callEntry.status = res.status;
      } else {
        this.metrics.totalFailures++;
        const status = res ? res.status : 'ERR';
        const errMsg = err ? err.message || String(err) : 'HTTP ' + status;

        const p = this.metrics.procedures[callEntry.procedure];
        if (p) {
          p.failures++;
          p.lastError = errMsg;
          p.errorsByStatus[status] = (p.errorsByStatus[status] || 0) + 1;
        }

        callEntry.status = status;
        callEntry.error = errMsg;

        const lastErr = this.metrics.recentErrors[this.metrics.recentErrors.length - 1];
        const nowMs = Date.now();
        const timeSinceLastErr = lastErr ? nowMs - lastErr.t : null;

        const errEntry = {
          t: nowMs,
          procedure: callEntry.procedure,
          status,
          error: errMsg,
          timeSinceLastErr
        };
        this.metrics.recentErrors.push(errEntry);
        if (this.metrics.recentErrors.length > 20) this.metrics.recentErrors.shift();
      }
    }
  };

  // ── Token Bucket Rate Limiter for Official API ──
  let officialBucket = {
    tokens: 10,
    maxTokens: 10,
    refillRate: 100 / (60 * 1000), // default to anonymous 100 rpm
    lastRefill: Date.now()
  };

  function updateBucketRate() {
    const hasKey = !!getToken();
    const limitPerMin = hasKey ? 200 : 100;
    officialBucket.maxTokens = hasKey ? 15 : 8;
    officialBucket.refillRate = limitPerMin / (60 * 1000);
    officialBucket.tokens = Math.min(officialBucket.tokens, officialBucket.maxTokens);
  }

  // Priority-aware token-bucket acquire, shared by the official-API and gateway
  // buckets. Foreground features (troop-radar/order-radar — whatever the user is
  // actively looking at right now) pass priority: 'high' so they aren't stuck
  // queued behind background pollers (bounty/pnl/craft-advisor) sharing the same
  // rate limit — a 25-member troop-radar fetch was observed taking 100+ seconds
  // because it queued FIFO behind unrelated background traffic. Within a
  // priority tier, order is still FIFO. 'high' cannot starve 'normal' forever:
  // each drain tick empties whatever's in 'high' first, then serves 'normal' —
  // it never re-checks 'high' again mid-tick, so a steady trickle of 'normal'
  // requests always keeps making progress.
  function refillBucket(bucket) {
    const nowMs = Date.now();
    const elapsed = Math.max(0, nowMs - bucket.lastRefill);
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = nowMs;
  }

  function drainBucketQueue(bucket, q) {
    refillBucket(bucket);
    while (bucket.tokens >= 1 && (q.high.length || q.normal.length)) {
      const grant = q.high.length ? q.high.shift() : q.normal.shift();
      bucket.tokens -= 1;
      grant();
    }
    if (q.high.length || q.normal.length) {
      const needed = 1 - bucket.tokens;
      const waitMs = Math.max(16, needed / bucket.refillRate);
      q.timer = setTimeout(() => { q.timer = null; drainBucketQueue(bucket, q); }, waitMs);
    } else if (q.timer) {
      clearTimeout(q.timer);
      q.timer = null;
    }
  }

  function acquireFromBucket(bucket, q, priority) {
    refillBucket(bucket);
    // Only grant immediately when nobody is already waiting — otherwise a steady
    // stream of arriving 'high' calls could keep bypassing an already-queued
    // 'normal' caller forever (never actually FIFO for it).
    if (!q.high.length && !q.normal.length && bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return Promise.resolve(0);
    }
    return new Promise((resolve) => {
      (priority === 'high' ? q.high : q.normal).push(() => resolve(0));
      if (!q.timer) drainBucketQueue(bucket, q);
    });
  }

  const officialQueue = { high: [], normal: [], timer: null };

  function acquireOfficialToken(priority = 'normal') {
    updateBucketRate();
    return acquireFromBucket(officialBucket, officialQueue, priority);
  }

  // ── Token Bucket Rate Limiter for Gateway API ──
  let gatewayBucket = {
    tokens: 10,
    maxTokens: 10,
    refillRate: 100 / (60 * 1000), // constant 100 rpm limit for gateway
    lastRefill: Date.now()
  };
  const gatewayQueue = { high: [], normal: [], timer: null };

  function acquireGatewayToken(priority = 'normal') {
    return acquireFromBucket(gatewayBucket, gatewayQueue, priority);
  }

  function isGateway(base) {
    try {
      return new URL(base).hostname === 'gateway.warerastats.io';
    } catch (e) {
      return false;
    }
  }

  function resolveBases(opts, hasKey, cached) {
    const allowedBases = opts.gatewayOnly
      ? gatewayBases
      : (hasKey ? [...api2Bases, ...gatewayBases] : gatewayBases);

    if (hasKey && !opts.gatewayOnly) {
      const cachedApi2 = api2Bases.includes(cached) ? cached : null;
      if (cachedApi2) {
        return [cachedApi2, ...api2Bases.filter(b => b !== cachedApi2), ...gatewayBases];
      }
      return [...api2Bases, ...gatewayBases];
    }

    return cached && allowedBases.includes(cached)
      ? [cached, ...allowedBases.filter((b) => b !== cached)]
      : allowedBases;
  }

  // Probe configured bases once, remember the one that works.
  async function resolveApiBase(procedure, args, opts = {}) {
    if (isRateLimited()) {
      ApiMonitor.trackBlocked(procedure, 'RateLimited');
      throw new Error('429');
    }
    if (isProcedureGated(procedure)) {
      ApiMonitor.trackBlocked(procedure, 'Gated');
      throw new Error('gated: ' + procedure);
    }
    const cached = GM_getValue(KEYS.apiBase, '');
    const hasKey = !!getToken();
    const bases = resolveBases(opts, hasKey, cached);

    const callEntry = ApiMonitor.trackCall(procedure, 'GET', args);
    const startTime = Date.now();
    let lastErr;
    let res;
    for (const base of bases) {
      try {
        if (!opts.skipThrottle) {
          const throttleStart = Date.now();
          if (isGateway(base)) {
            await acquireGatewayToken(opts.priority);
          } else {
            await acquireOfficialToken(opts.priority);
          }
          ApiMonitor.trackWait(callEntry, Date.now() - throttleStart);
        }
        res = await gmRequest({
          method: 'GET',
          url: trpcUrl(base, procedure, args),
          headers: headersForBase(base),
          timeout: CONFIG.requestTimeoutMs,
        });
        if (res.status === 429) {
          dbg('api', 'warn', `base ${base} rate-limited (429) for ${procedure}, attempting fallback base`);
          tripRateLimit();
          ApiMonitor.trackRateLimitTrip();
          lastErr = new Error('429');
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          dbg('api', 'warn', `base ${base} returned ${res.status} for ${procedure}, attempting gateway fallback`);
          lastErr = new Error(String(res.status));
          continue;
        }
        if (res.status >= 200 && res.status < 300) {
          GM_setValue(KEYS.apiBase, base);
          dbg('api', 'debug', `resolveApiBase ${procedure} succeeded on ${base}`);
          ApiMonitor.trackResult(callEntry, res, Date.now() - startTime);
          return { base, payload: unwrapTrpc(res.text) };
        }
        throw new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
        reportApiAttemptFailure('resolveApiBase', procedure, base, e);
      }
    }
    ApiMonitor.trackResult(callEntry, res, Date.now() - startTime, lastErr);
    if (lastErr && (lastErr.message === '401' || lastErr.message === '403')) {
      gateProcedure(procedure);
    }
    if (!hasKey && api2Bases.length > 0) {
      throw new Error('apiKeyRequired: ' + procedure);
    }
    throw lastErr || new Error('all API bases failed');
  }

  async function resolveApiPost(procedure, args, opts = {}) {
    if (isRateLimited()) {
      ApiMonitor.trackBlocked(procedure, 'RateLimited');
      throw new Error('429');
    }
    if (isProcedureGated(procedure)) {
      ApiMonitor.trackBlocked(procedure, 'Gated');
      throw new Error('gated: ' + procedure);
    }
    const cached = GM_getValue(KEYS.apiBase, '');
    const hasKey = !!getToken();
    const bases = resolveBases(opts, hasKey, cached);

    const callEntry = ApiMonitor.trackCall(procedure, 'POST', args);
    const startTime = Date.now();
    let lastErr;
    let res;
    for (const base of bases) {
      try {
        if (!opts.skipThrottle) {
          const throttleStart = Date.now();
          if (isGateway(base)) {
            await acquireGatewayToken(opts.priority);
          } else {
            await acquireOfficialToken(opts.priority);
          }
          ApiMonitor.trackWait(callEntry, Date.now() - throttleStart);
        }
        const url = `${base}/${encodeURIComponent(procedure)}`;
        const headers = {
          ...headersForBase(base),
          'Content-Type': 'application/json',
          'accept': '*/*'
        };
        res = await gmRequest({
          method: 'POST',
          url,
          headers,
          data: JSON.stringify(args),
          timeout: CONFIG.requestTimeoutMs,
        });
        if (res.status === 429) {
          dbg('api', 'warn', `base ${base} rate-limited (429) for ${procedure}, attempting fallback base`);
          tripRateLimit();
          ApiMonitor.trackRateLimitTrip();
          lastErr = new Error('429');
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          dbg('api', 'warn', `base ${base} returned ${res.status} for ${procedure}, attempting gateway fallback`);
          lastErr = new Error(String(res.status));
          continue;
        }
        if (res.status >= 200 && res.status < 300) {
          GM_setValue(KEYS.apiBase, base);
          dbg('api', 'debug', `resolveApiPost ${procedure} succeeded on ${base}`);
          ApiMonitor.trackResult(callEntry, res, Date.now() - startTime);
          return { base, payload: unwrapTrpc(res.text) };
        }
        throw new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
        reportApiAttemptFailure('resolveApiPost', procedure, base, e);
      }
    }
    ApiMonitor.trackResult(callEntry, res, Date.now() - startTime, lastErr);
    if (lastErr && (lastErr.message === '401' || lastErr.message === '403')) {
      gateProcedure(procedure);
    }
    if (!hasKey && api2Bases.length > 0) {
      throw new Error('apiKeyRequired: ' + procedure);
    }
    throw lastErr || new Error('all API bases failed');
  }

  async function resolveApiBatch(procedure, batchArgs, opts = {}) {
    if (!batchArgs || batchArgs.length === 0) return [];

    if (batchArgs.length === 1) {
      const { payload } = await resolveApiBase(procedure, batchArgs[0], opts);
      return [{ payload }];
    }

    if (isRateLimited()) {
      ApiMonitor.trackBlocked(procedure + ' (Batch)', 'RateLimited');
      throw new Error('429');
    }
    if (isProcedureGated(procedure)) {
      ApiMonitor.trackBlocked(procedure + ' (Batch)', 'Gated');
      throw new Error('gated: ' + procedure);
    }
    const cached = GM_getValue(KEYS.apiBase, '');
    const hasKey = !!getToken();
    const bases = resolveBases(opts, hasKey, cached);

    let lastErr;
    let res;
    for (const base of bases) {
      if (!isGateway(base)) {
        try {
          dbg('api', 'debug', `resolveApiBatch: splitting batch of size ${batchArgs.length} for non-batch base ${base}`);
          const results = await mapWithConcurrency(batchArgs, 2, async (args) => {
            try {
              const { payload } = await resolveApiBase(procedure, args, opts);
              return { payload };
            } catch (err) {
              return { error: err };
            }
          });
          const allFailed = results.every(r => r.error);
          if (allFailed && batchArgs.length > 0) {
            lastErr = results[0].error;
            continue;
          }
          return results;
        } catch (e) {
          lastErr = e;
          continue;
        }
      }

      // Gateway batch request path
      const procNames = Array(batchArgs.length).fill(procedure).join(',');
      const inputObj = {};
      batchArgs.forEach((args, idx) => {
        inputObj[idx] = args === undefined ? {} : args;
      });
      const batchInput = encodeURIComponent(JSON.stringify(inputObj));

      const callEntry = ApiMonitor.trackCall(procedure + ` (Batch x${batchArgs.length})`, 'GET', batchArgs);
      const startTime = Date.now();
      try {
        if (!opts.skipThrottle) {
          const throttleStart = Date.now();
          await acquireGatewayToken(opts.priority);
          ApiMonitor.trackWait(callEntry, Date.now() - throttleStart);
        }
        const url = `${base}/${encodeURIComponent(procNames)}?input=${batchInput}`;
        res = await gmRequest({ method: 'GET', url, headers: headersForBase(base) });
        if (res.status === 429) {
          dbg('api', 'warn', `base ${base} rate-limited (429) for batch ${procedure}, attempting fallback base`);
          tripRateLimit();
          ApiMonitor.trackRateLimitTrip();
          lastErr = new Error('429');
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          dbg('api', 'warn', `base ${base} returned ${res.status} for batch ${procedure}, attempting gateway fallback`);
          lastErr = new Error(String(res.status));
          continue;
        }
        if (res.status >= 200 && res.status < 300) {
          GM_setValue(KEYS.apiBase, base);
          dbg('api', 'debug', `resolveApiBatch ${procedure} (x${batchArgs.length}) succeeded on ${base}`);
          ApiMonitor.trackResult(callEntry, res, Date.now() - startTime);
          return unwrapTrpcBatch(res.text);
        }
        throw new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
        dbg('api', 'warn', `resolveApiBatch ${procedure} (x${batchArgs.length}) failed on ${base}: ${e.message}`);
      }
      ApiMonitor.trackResult(callEntry, res, Date.now() - startTime, lastErr);
    }
    if (lastErr && (lastErr.message === '401' || lastErr.message === '403')) {
      gateProcedure(procedure);
    }
    if (!hasKey && api2Bases.length > 0) {
      throw new Error('apiKeyRequired: ' + procedure);
    }
    throw lastErr || new Error('all API bases failed');
  }

  // --- Shared API / Context Utils ---

  async function resolveOwnCountry() {
    const ov = (CONFIG.bountyOwnCountryOverride || '').trim();
    if (ov) {
      const match = ov.match(/[a-f0-9]{24}/i);
      if (match) return match[0];
    }
    const ckey = KEYS.ownCountryCache;
    const cached = GM_getValue(ckey, null);
    const TTL_24H_MS = 24 * 60 * 60 * 1000;
    if (cached && (now() - cached.at) < TTL_24H_MS) { 
      return cached.country;
    }
    const uid = getCurrentUserId();
    if (!uid) return null;
    try {
      const u = await resolveApiPost('user.getUserById', { userId: uid });
      const country = u.payload?.country || null;
      if (country) {
        GM_setValue(ckey, { at: now(), country });
      }
      return country;
    } catch (e) {
      dbg('api', 'error', 'own country resolve failed', e.message);
      return null;
    }
  }

  async function initMarketTax() {
    try {
      const cid = await resolveOwnCountry();
      if (cid) {
        const taxes = await getCountryTax(cid);
        _resolvedMarketTaxPct = taxes?.market ?? 1;
        dbg('api', 'debug', 'Resolved market tax pct: ' + _resolvedMarketTaxPct);
      }
    } catch (e) {
      dbg('api', 'warn', 'initMarketTax failed', e.message);
    }
  }

  // Returns a map { itemCode -> price } (best-effort; shape depends on the API).
  async function fetchPrices(force) {
    const cache = readCache(KEYS.priceCache);

    let baseData = {};
    if (!force && cache && now() - cache.fetchedAt < CONFIG.priceCacheTtlMs) {
      baseData = cache.data || {};
    } else if (isRateLimited()) {
      log('rate-limited, serving stale prices');
      baseData = cache ? cache.data : {};
    } else if (inFlightPrices) {
      baseData = await inFlightPrices;
    } else {
      inFlightPrices = (async () => {
        try {
          const { payload } = await resolveApiBase(CONFIG.pricesEndpoint, undefined);
          const map = normalizePrices(payload);
          writeCache(KEYS.priceCache, { data: map, fetchedAt: now() });
          renderRateLimitBanner();
          return map;
        } catch (e) {
          reportError('api', e, 'fetchPrices failed, using fallback', 'warn');
          renderRateLimitBanner();
          return cache ? cache.data : {}; // graceful fallback to stale/empty
        } finally {
          inFlightPrices = null;
        }
      })();
      baseData = await inFlightPrices;
    }

    return baseData;
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
        if (code != null && price != null) {
          const normCode = normalizeItemCode(String(code));
          map[normCode] = Number(price);
        }
      }
    } else if (typeof payload === 'object') {
      for (const [k, v] of Object.entries(payload)) {
        if (k === '__proto__') continue; // never assign a proto key from untrusted JSON
        const normKey = normalizeItemCode(k);
        if (typeof v === 'number') map[normKey] = v;
        else if (v && typeof v === 'object') {
          const p = v.price ?? v.avgPrice ?? v.value;
          if (p != null && !Number.isNaN(Number(p))) map[normKey] = Number(p); // keep legit 0, drop NaN
        }
      }
    }
    return map;
  }


  function getTypeFromCode(code) {
    if (!code) return 'unknown';
    const cleanCode = code.replace(/\d+$/, '').trim().toLowerCase();
    for (const [kw, t] of Object.entries(CONFIG.typeByAltKeyword)) {
      if (cleanCode === kw) return t;
    }
    return 'unknown';
  }

  function getTxPrice(tx) {
    return tx.p !== undefined ? tx.p : tx.money;
  }

  function getTxTimestamp(tx) {
    return tx.t !== undefined ? tx.t : (tx.createdAt ? Date.parse(tx.createdAt) : 0);
  }

  function getTxScore(tx, type) {
    if (tx.s !== undefined) return tx.s;
    return statForType(type, tx.item?.skills);
  }

  function txRefLookbackMs() {
    return CONFIG.txRefLookbackDays * 24 * 60 * 60 * 1000;
  }

  function isRecentMarketTx(tx, lookbackMs) {
    const t = getTxTimestamp(tx);
    if (!t || t < Date.now() - lookbackMs) return false;
    return tx.transactionType === undefined || tx.transactionType === 'itemMarket';
  }

  function median(nums) {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Rejects price outliers relative to the pool's own median: near-zero
  // gift/friend sales (min-cap dumps) and wash-trade "boost" sales (max-cap
  // pumps) both sit far outside a real market cluster's price ratio.
  function rejectPriceOutliers(entries, getPrice) {
    if (entries.length < 2) return entries;
    const priced = entries.map((e) => [e, getPrice(e)]);
    const mid = median(priced.map(([, p]) => p));
    if (!mid) return entries;
    const ratio = CONFIG.txRefOutlierRatio;
    const kept = priced.filter(([, p]) => p >= mid / ratio && p <= mid * ratio).map(([e]) => e);
    return kept.length ? kept : entries;
  }

  function migrateTransactionsCache() {
    const key = NS + 'cacheSchemaVersion';
    const currentVersion = GM_getValue(key, 0);
    if (currentVersion === 2) return;

    log('Migrating transactionsCache to schema version 2...');
    const store = GM_getValue(KEYS.transactionsCache, {}) || {};
    let migrated = false;
    for (const [code, entry] of Object.entries(store)) {
      if (entry && Array.isArray(entry.data)) {
        const isOld = entry.data.some(tx => tx && (tx.transactionType !== undefined || tx.money !== undefined));
        if (isOld) {
          const type = getTypeFromCode(code);
          entry.data = entry.data.map(tx => {
            if (!tx) return null;
            if (tx.transactionType !== undefined && tx.transactionType !== 'itemMarket') return null;
            const price = tx.p !== undefined ? tx.p : tx.money;
            const timestamp = tx.t !== undefined ? tx.t : (tx.createdAt ? new Date(tx.createdAt).getTime() : null);
            const score = tx.s !== undefined ? tx.s : statForType(type, tx.item?.skills);
            if (price == null || timestamp == null) return null;
            return { p: price, t: timestamp, s: score };
          }).filter(Boolean);
          migrated = true;
        }
      }
    }
    if (migrated) {
      GM_setValue(KEYS.transactionsCache, store);
      log('transactionsCache successfully migrated to schema version 2.');
    }
    GM_setValue(key, 2);
  }

  // ── Equipment transactions (gateway/historical) ──────────────────────────
  const transactionsInFlight = {}; // code -> promise (dedup)
  // code -> timestamp of last attempt, success or failure. A timeout doesn't
  // trip isRateLimited() (that's 429-only), so without this a code that keeps
  // timing out gets re-requested on every call site's next tick, forever.
  const transactionsLastAttempt = {};

  async function fetchItemTransactions(code, force) {
    if (!code) return null;
    const store = readCache(KEYS.transactionsCache) || {};
    const cached = store[code];
    if (!force && cached && now() - cached.fetchedAt < CONFIG.txCacheTtlMs) return cached.data;
    if (isRateLimited()) return cached ? cached.data : null;
    if (transactionsInFlight[code]) return transactionsInFlight[code];
    const lastAttempt = transactionsLastAttempt[code];
    if (!force && lastAttempt && now() - lastAttempt < CONFIG.rateLimitBackoffMs) return cached ? cached.data : null;
    transactionsLastAttempt[code] = now();

    transactionsInFlight[code] = (async () => {
      try {
        const { payload } = await resolveApiBase('transaction.getPaginatedTransactions', {
          limit: 100,
          itemCode: code
        });
        const items = payload?.items || [];

        const type = getTypeFromCode(code);
        const mapped = items.map(tx => {
          if (tx.transactionType !== 'itemMarket' || tx.money == null || !tx.createdAt) return null;
          const score = statForType(type, tx.item?.skills);
          return {
            p: Number(tx.money),
            t: new Date(tx.createdAt).getTime(),
            s: score
          };
        }).filter(Boolean);

        const next = { ...readCache(KEYS.transactionsCache) };
        next[code] = { data: mapped, fetchedAt: now() };
        writeCache(KEYS.transactionsCache, next);
        return mapped;
      } catch (e) {
        reportError('api', e, 'fetchItemTransactions failed for ' + code, 'warn');
        return cached ? cached.data : null;
      } finally {
        renderRateLimitBanner();
        delete transactionsInFlight[code];
      }
    })();
    return transactionsInFlight[code];
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

  function isShopPage() {
    return /\/shop(\/|$)/.test(getPagePathname());
  }

  function runFirstCardScopingLog() {
    const img = document.querySelector(CONFIG.itemImageSelector);
    if (!img) {
      console.log('[PROST:debug] No card image found on page matching selector:', CONFIG.itemImageSelector);
      return;
    }
    const isModal = isMarketPage() ? false : isInsideModalOrSidebar(img);
    const isProfile = isMarketPage() ? false : isInsideProfileEquipment(img);
    const isShop = isShopPage();
    const card = climbToCard(img);
    const itemInfo = detectItem(img, card);
    console.log('[PROST:debug] Scoping Debug for first image:', {
      img,
      isInsideModalOrSidebar: isModal,
      isInsideProfileEquipment: isProfile,
      isShopPage: isShop,
      climbToCard: card ? `${card.tagName}.${card.className}` : 'null',
      detectItem: itemInfo
    });
  }

  function isInsideProfileEquipment(el) {
    let parent = el.parentElement;
    for (let i = 0; i < 9 && parent; i++) {
      if (
        parent.querySelector('.CircularProgressbar') ||
        parent.querySelector('img[src*="/avatars/"]') ||
        parent.querySelector('img[alt*="avatar"]') ||
        parent.querySelector('img[alt*="Avatar"]')
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
    if (card.dataset) {
      const val = card.dataset.id || card.dataset.itemId || card.dataset.uid;
      if (val) return val;
    }
    // 2. Check all descendants for typical ID attributes
    const elWithId = card.querySelector('[data-id], [data-item-id], [data-uid], a[href*="/item/"], button[id]');
    if (elWithId) {
      if (elWithId.dataset) {
        const val = elWithId.dataset.id || elWithId.dataset.itemId || elWithId.dataset.uid;
        if (val) return val;
      }
      if (elWithId.id && !elWithId.id.startsWith('wia-')) return elWithId.id;
      const href = elWithId.getAttribute('href');
      if (href) {
        const m = /\/item[s]?\/([^/?#]+)/.exec(href);
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
    const startTime = performance.now();
    SCOPING_STATS.scansCount++;

    if (!verbose && cachedCards && (performance.now() - cachedCardsTime < 50)) {
      return cachedCards;
    }

    // Reset per-scan counts
    SCOPING_STATS.imagesChecked = 0;
    SCOPING_STATS.skinsDetected = 0;
    SCOPING_STATS.itemsDetected = 0;
    SCOPING_STATS.shopChecksCount = 0;

    try {
      if (isShopPage()) {
        SCOPING_STATS.lastScanTimeMs = performance.now() - startTime;
        cachedCards = new Map();
        cachedCardsTime = performance.now();
        return cachedCards;
      }

      let root = document;
      if (isMarketPage()) {
        const sellContainer = findMarketSellContainer();
        if (sellContainer) {
          root = sellContainer;
          if (verbose) log("findItemCards: limiting scan to market sell container", sellContainer);
        } else {
          SCOPING_STATS.lastScanTimeMs = performance.now() - startTime;
          cachedCards = new Map();
          cachedCardsTime = performance.now();
          return cachedCards;
        }
      }
      const imgs = root.querySelectorAll(CONFIG.itemImageSelector);
      if (verbose) log(`findItemCards: found ${imgs.length} raw images on page matching "${CONFIG.itemImageSelector}"`);
      const cards = new Map(); // card element -> img

      imgs.forEach((img, idx) => {
        SCOPING_STATS.imagesChecked++;
        SCOPING_STATS.shopChecksCount++;

        const isModal = isMarketPage() ? false : isInsideModalOrSidebar(img);
        const isProfile = isMarketPage() ? false : isInsideProfileEquipment(img);
        const card = climbToCard(img);

        const src = img.getAttribute('src') || '';
        const isSkin = src.includes('/skins/') || (typeof skinNameFromSrc === 'function' && skinNameFromSrc(src) !== null);
        if (isSkin) {
          SCOPING_STATS.skinsDetected++;
        } else {
          SCOPING_STATS.itemsDetected++;
        }

        if (verbose) {
          const itemInfo = detectItem(img, card);
          log(`  [Image #${idx}] alt="${img.getAttribute('alt')}" src="${img.getAttribute('src')}"`);
          log(`    isInsideModalOrSidebar: ${isModal}`);
          log(`    isInsideProfileEquipment: ${isProfile}`);
          log(`    isShopPage: false`);
          log(`    climbToCard resolved element:`, card ? `${card.tagName}.${card.className}` : 'null');
          log(`    detectItem: type=${itemInfo.type}, code=${itemInfo.code}, tier=${itemInfo.tier}, isSkin=${itemInfo.isSkin}`);
        }

        if (isModal) {
          if (verbose) log(`    -> Skipped (inside modal/sidebar/drawer)`);
          return;
        }
        if (isProfile) {
          if (verbose) log(`    -> Skipped (inside character profile equipment)`);
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

      SCOPING_STATS.lastScanTimeMs = performance.now() - startTime;
      cachedCards = cards;
      cachedCardsTime = performance.now();
      return cards;
    } catch (e) {
      reportError('advisor', e, 'findItemCards');
      SCOPING_STATS.lastScanTimeMs = performance.now() - startTime;
      cachedCards = new Map();
      cachedCardsTime = performance.now();
      return cachedCards;
    }
  }

  // Returns the element that contains the image AND the stat/durability/equip siblings
  function getItemCell(card) {
    return card.closest('[aria-haspopup="dialog"]') || card.parentElement || card;
  }

  // The durability bar = the parent of the scaleX progress fill element.
  function findDurabilityBar(cell) {
    const scaleXEl = cell.querySelector('[style*="scaleX"]');
    if (!scaleXEl) return null;
    return scaleXEl.parentElement;
  }

  // Extracts text content from a DOM node excluding PROST-injected elements and icons.
  function getCleanTextContent(rootEl, excludeStats = false) {
    if (!rootEl) return '';
    if (rootEl.nodeType === 3) { // Node.TEXT_NODE
      return rootEl.nodeValue || '';
    }
    const hasIconChild = Array.from(rootEl.children || []).some(child => {
      const cls = child.className || '';
      return cls.toString().includes('a6izou0');
    });
    const className = (rootEl.className || '').toString();
    const id = (rootEl.id || '').toString();
    if (
      className.includes('wia-') ||
      id.includes('wia-') ||
      className.includes('a6izou0') ||
      (excludeStats && hasIconChild)
    ) {
      return ' ';
    }
    if (rootEl.children && rootEl.children.length === 0) {
      return (rootEl.textContent || '') + ' ';
    }
    let text = '';
    const kids = rootEl.childNodes || rootEl.children || [];
    for (let i = 0; i < kids.length; i++) {
      text += getCleanTextContent(kids[i], excludeStats) + ' ';
    }
    return text;
  }

  // Removes priceSub and resets durBar inline position styling
  function cleanupPriceSub(cell) {
    const priceSub = cell.querySelector('.wia-price-sub');
    if (priceSub) {
      priceSub.remove();
    }
    const durBar = findDurabilityBar(cell);
    if (durBar) {
      durBar.style.position = '';
      durBar.style.minHeight = '';
      delete durBar.dataset.wiaGrown;
    }
  }

  function cleanupCardHeader(card) {
    const cell = getItemCell(card);
    cell.style.position = '';
    cell.style.overflow = '';
    cell.style.boxSizing = '';
    cell.style.paddingTop = '';
    cell.style.paddingBottom = '';
    delete card.dataset.wiaHeader;
  }

  // Locale-safe number parser supporting commas, dots, and k/m/tsd/mio suffixes
  function parseNum(str) {
    if (str == null) return null;
    if (typeof str === 'number') return str;
    let s = str.toString().replace(/\s+/g, ' ').trim();
    if (!s) return null;

    let multiplier = 1;
    let hasSuffix = false;
    const suffixMatch = s.match(/([0-9][0-9.,\s]*)\s*(k|tsd\.?|mio\.?|m)\s*$/i);
    if (suffixMatch) {
      hasSuffix = true;
      const suffix = suffixMatch[2].toLowerCase();
      if (suffix === 'k' || suffix.startsWith('tsd')) {
        multiplier = 1000;
      } else if (suffix === 'm' || suffix.startsWith('mio')) {
        multiplier = 1000000;
      }
      s = suffixMatch[1].trim();
    }

    // Extract the main numeric block (digits, signs, dots, commas)
    const numMatch = /-?\d+(?:[.,\s]\d+){0,10}/.exec(s);
    if (!numMatch) return null;
    let numStr = numMatch[0].replace(/\s+/g, '');

    // Resolve decimal separator vs thousand grouping separator
    const separators = numStr.match(/[.,]/g);
    if (separators) {
      if (separators.length > 1) {
        // Multiple separators: last one is decimal, others are grouping
        const lastSep = separators[separators.length - 1];
        const parts = numStr.split(lastSep);
        const integerPart = parts[0].replace(/[.,]/g, '');
        const decimalPart = parts[1];
        numStr = integerPart + '.' + decimalPart;
      } else {
        // Single separator
        const sep = separators[0];
        const parts = numStr.split(sep);
        const decimalPart = parts[1];
        if (!hasSuffix && decimalPart.length === 3) {
          // Exactly 3 digits -> grouping separator
          numStr = parts[0] + decimalPart;
        } else {
          // Decimal separator
          numStr = parts[0] + '.' + decimalPart;
        }
      }
    }

    const parsed = Number.parseFloat(numStr);
    return Number.isNaN(parsed) ? null : parsed * multiplier;
  }

  function tierForCode(itemCode) {
    if (!itemCode) return null;
    const code = String(itemCode).trim().toLowerCase();
    const digitMatch = code.match(/(\d+)$/);
    if (digitMatch) return Number.parseInt(digitMatch[1], 10);
    return CONFIG.weaponCodeToTier[code] ?? null;
  }

  function itemCodeFromUrl() {
    try {
      return new URLSearchParams(location.search).get('item');
    } catch (e) {
      return null;
    }
  }

  function isMarketGridPage() {
    return isMarketPage() && !itemCodeFromUrl();
  }

  function isMarketDetailPage() {
    return isMarketPage() && !!itemCodeFromUrl();
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.tierForCode = tierForCode;
    globalThis.itemCodeFromUrl = itemCodeFromUrl;
    globalThis.isMarketGridPage = isMarketGridPage;
    globalThis.isMarketDetailPage = isMarketDetailPage;
    globalThis.CONFIG = CONFIG;
    globalThis.KEYS = KEYS;
    // Export internal functions for unit tests
    globalThis.setToken = setToken;
    globalThis.getToken = getToken;
    globalThis.gateProcedure = gateProcedure;
    globalThis.isProcedureGated = isProcedureGated;
    globalThis.sanitizeGatedProcedures = sanitizeGatedProcedures;
    globalThis.Health = Health;
    globalThis.renderHealthPanel = renderHealthPanel;
    globalThis.regFeature = regFeature;
    globalThis.setHealth = setHealth;
    globalThis.parseStats = parseStats;
    globalThis.getItemState = getItemState;
    globalThis.isInsideProfileEquipment = isInsideProfileEquipment;
    globalThis.shouldSuppressItem = shouldSuppressItem;
    globalThis.originalTitles = originalTitles;
    globalThis.detectAllySide = detectAllySide;
    globalThis.battleFlagCode = battleFlagCode;
    globalThis.injectCompactOrders = injectCompactOrders;
    globalThis.renderSettingsModal = renderSettingsModal;
    globalThis.initNotes = initNotes;
    globalThis.scanNoteLinks = scanNoteLinks;
    globalThis.attachNoteIcon = attachNoteIcon;
    globalThis.getCurrentUserId = getCurrentUserId;
    globalThis.WIA_resolve = resolveApiBase;
    globalThis.WIA_post = resolveApiPost;
    globalThis.getEffectiveTopic = getEffectiveTopic;
    globalThis.testBountyPush = testBountyPush;
    globalThis.testLocalBounty = testLocalBounty;
    globalThis.testPersonalPush = testPersonalPush;
    const bountyAllies = () => resolveAllyCountryIds().then((s) => [...s]);
    globalThis.bountyAllies = bountyAllies;
    globalThis.extractAllyBounties = extractAllyBounties;
    globalThis.isValidBaselineShape = isValidBaselineShape;
    globalThis.loadBaselineSet = loadBaselineSet;
    globalThis.getActiveBaselineSet = getActiveBaselineSet;
    globalThis.setActiveBaselineSet = setActiveBaselineSet;
    if (typeof unsafeWindow !== 'undefined' && CONFIG.debug) {
      unsafeWindow.getCurrentUserId = getCurrentUserId;
      unsafeWindow.WIA_resolve = resolveApiBase;
      unsafeWindow.WIA_post = resolveApiPost;
      unsafeWindow.WIA_gmRequest = gmRequest;
      unsafeWindow.testBountyPush = testBountyPush;
      unsafeWindow.testLocalBounty = testLocalBounty;
      unsafeWindow.testPersonalPush = testPersonalPush;
      unsafeWindow.getEffectiveTopic = getEffectiveTopic;
      unsafeWindow.bountyAllies = bountyAllies;
      unsafeWindow.extractAllyBounties = extractAllyBounties;
      unsafeWindow.isValidBaselineShape = isValidBaselineShape;
      unsafeWindow.loadBaselineSet = loadBaselineSet;
      unsafeWindow.getActiveBaselineSet = getActiveBaselineSet;
      unsafeWindow.setActiveBaselineSet = setActiveBaselineSet;
    }
    globalThis.parseHealthAndHunger = parseHealthAndHunger;
    globalThis.updatePillState = updatePillState;
    globalThis.injectPillBadge = injectPillBadge;
    globalThis.shouldPillFloat = shouldPillFloat;
    globalThis.highlightCocaineItems = highlightCocaineItems;
    globalThis.teardownPillReminder = teardownPillReminder;
    globalThis.tickPillReminder = tickPillReminder;
    globalThis.checkPersonalNotifications = checkPersonalNotifications;
    globalThis.shouldDimMuHeal = shouldDimMuHeal;
    globalThis.findMuHealButton = findMuHealButton;
    globalThis.WIA_muHealDiag = muHealDiag;
    if (typeof unsafeWindow !== 'undefined' && CONFIG.debug) {
      unsafeWindow.WIA_muHealDiag = muHealDiag;
    }
    globalThis.simpleHash = simpleHash;
    globalThis.pollBountyTopic = pollBountyTopic;
    globalThis.renderHnHBudget = renderHnHBudget;
    globalThis.removeHnHBudget = removeHnHBudget;
    globalThis.nextWindowStart = nextWindowStart;
    globalThis.getCurrentWindowStart = getCurrentWindowStart;
    globalThis.isInsidePreferredWindow = isInsidePreferredWindow;
    globalThis.getTierItemCodes = getTierItemCodes;
    globalThis.formatItemCode = formatItemCode;
    globalThis.parseCraftingState = parseCraftingState;
    globalThis.formatHoverTime = formatHoverTime;
    globalThis.getModalResourceCode = getModalResourceCode;
    globalThis.getNativeSvgFingerprint = getNativeSvgFingerprint;
    globalThis.scanInventory = scanInventory;
    globalThis.fetchPrices = fetchPrices;
    globalThis.getPnlDayKey = getPnlDayKey;
    globalThis.getGoldBalance = getGoldBalance;
    globalThis.checkPnlDayReset = checkPnlDayReset;
    globalThis.updatePnlUi = updatePnlUi;
    globalThis.clearCache = clearCache;
    globalThis.todayResetTime = todayResetTime;
    globalThis.processTransactionsList = processTransactionsList;
    globalThis.fetchAndProcessTransactions = fetchAndProcessTransactions;
    globalThis.parseCardQuantity = parseCardQuantity;
    globalThis.getInventoryQuantities = getInventoryQuantities;
    globalThis.bookClickConsumption = bookClickConsumption;
    globalThis.checkInventoryDeltaConsumption = checkInventoryDeltaConsumption;
    globalThis.checkInventoryDeltaWear = checkInventoryDeltaWear;
    globalThis.findItemCards = findItemCards;
    globalThis.writeCache = writeCache;
    globalThis.readCache = readCache;
    globalThis.getActiveInventoryTab = getActiveInventoryTab;
    globalThis.isConsumablesVisible = isConsumablesVisible;
    globalThis.isEquipmentVisible = isEquipmentVisible;
    globalThis.skinNameFromSrc = skinNameFromSrc;
    globalThis.slotForSkin = slotForSkin;
    globalThis.isShopPage = isShopPage;
    globalThis.detectItem = detectItem;
    globalThis.evaluate = evaluate;
    globalThis.calculateInventoryRankings = calculateInventoryRankings;
    globalThis.getTransactionReferencePrice = getTransactionReferencePrice;
    globalThis.getItemPriceRange = getItemPriceRange;
    globalThis.rejectPriceOutliers = rejectPriceOutliers;
    globalThis.median = median;
    globalThis.ensureCraftingPricesFetched = ensureCraftingPricesFetched;
    globalThis.mapWithConcurrency = mapWithConcurrency;
    globalThis.advisorLoadHealth = advisorLoadHealth;
    globalThis.isTimeoutError = isTimeoutError;
  }

  function getLocale() {
    if (CONFIG.locale === 'de' || CONFIG.locale === 'en') return CONFIG.locale;
    if (typeof window !== 'undefined' && (window.__WIA_LOCALE__ === 'de' || window.__WIA_LOCALE__ === 'en')) {
      return window.__WIA_LOCALE__;
    }
    return 'de';
  }

  // Translation helper function
  function t(key, params) {
    const locale = getLocale();
    const dict = CONFIG.i18n[locale] || CONFIG.i18n.en;
    let template = dict[key] || CONFIG.i18n.en[key] || key;

    if (params) {
      Object.keys(params).forEach(k => {
        template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
      });
    }
    return template;
  }

  // Walk up to the element that visually represents the card (has a colored
  // border/background). Falls back to a few levels up from the image.
  function climbToCard(img) {
    let el = img;
    for (let i = 0; i < CONFIG.cardAncestorMaxClimb && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const cs = getComputedStyle(el);
      const hasColor =
        parseRgb(cs.borderColor) || parseRgb(cs.backgroundColor) || parseRgb(cs.outlineColor);
      // a card is usually a sized, bordered box of ~48px width. Limit max width
      // to 90px to avoid climbing up to the entire list/grid container on the market page.
      if (hasColor && el.offsetWidth >= 40 && el.offsetHeight >= 40 && el.offsetWidth <= 90) {
        return el;
      }
    }
    return img.parentElement || img;
  }

  function skinNameFromSrc(src) {
    if (!src) return null;
    const match = src.match(/\/images\/skins\/([^/.?#]+)/);
    return match ? match[1] : null;
  }

  // Lazily built, memoized: CONFIG.skinToSlot is a static literal, so this
  // only needs to be derived once regardless of how many hot paths (DOM
  // mutation observer, crafting-modal poll) call slotForSkin per second.
  let skinToSlotLowerCache = null;
  function skinToSlotLower() {
    if (!skinToSlotLowerCache) {
      skinToSlotLowerCache = {};
      for (const [key, slot] of Object.entries(CONFIG.skinToSlot || {})) {
        skinToSlotLowerCache[key.toLowerCase()] = slot;
      }
    }
    return skinToSlotLowerCache;
  }

  function slotForSkin(skinName) {
    if (!skinName) return null;

    // 1. Wissensbibliothek CONFIG.skinToSlot
    if (CONFIG.skinToSlot) {
      if (CONFIG.skinToSlot[skinName]) {
        return CONFIG.skinToSlot[skinName];
      }
      const lowerHit = skinToSlotLower()[skinName.toLowerCase()];
      if (lowerHit) return lowerHit;
    }

    // 2. Suffix-Auto-Fallback
    const lowerName = skinName.toLowerCase();
    for (const kw of Object.keys(CONFIG.typeByAltKeyword)) {
      if (lowerName.endsWith(kw)) {
        return kw;
      }
    }

    return null;
  }



  // A skin's slot (e.g. "jet", "chest") isn't always its item type ("weapon",
  // "chest") — typeByAltKeyword maps the ones that differ. Shared by
  // detectType() (inventory items) and parseCraftingState() (crafting modal).
  function slotType(slot) {
    return CONFIG.typeByAltKeyword[slot] || slot;
  }

  function detectType(img, card) {
    const alt = (img.getAttribute('alt') || '').toLowerCase().trim();
    const src = (img.getAttribute('src') || '').toLowerCase();

    // Skin Branch
    const rawSrc = img.getAttribute('src') || '';
    const skinName = skinNameFromSrc(rawSrc);
    if (skinName) {
      if (card && card.querySelector('.a6izou0') && !findDurabilityBar(getItemCell(card))) {
        return { type: 'unknown', alt, code: null, srcBase: skinName, tier: null, isSkin: true };
      }

      const slot = slotForSkin(skinName);
      if (!slot) return { type: 'unknown', alt, code: null, srcBase: skinName, tier: null, isSkin: true };
      const type = slotType(slot);
      if (type === 'weapon') {
        // Weapon-Code = Slot; Tier deterministisch
        return {
          type,
          alt,
          code: slot,
          srcBase: skinName,
          tier: CONFIG.weaponCodeToTier[slot] ?? null,
          isSkin: true
        };
      }
      if (typeof isConsumable === 'function' && isConsumable(slot)) {
        return {
          type,
          alt,
          code: slot,
          srcBase: skinName,
          tier: null,
          isSkin: true
        };
      }
      // Armor: Slot bekannt, Tier offen -> downstream resolvedTier füllt
      return {
        type,
        alt,
        code: null,
        srcBase: skinName,
        tier: null,
        isSkin: true
      };
    }

    // sprite basename (chest.png -> "chest") is the clean TYPE key.
    const srcBase = (src.match(/\/images\/items\/([^/.?#]+)/) || [])[1] || '';
    // itemCode = the full alt ("gloves6", "chest3", "sniper")-what the market API keys on.
    const code = alt || srcBase || null;
    // tier 1-6 from the trailing digit of the code (armor); weapons have none.
    const tm = (code || '').match(/(\d+)\s*$/);
    let tier = tm ? Number.parseInt(tm[1], 10) : null;

    let type = 'unknown';
    const cleanCode = code ? code.replace(/\d+$/, '').trim() : '';
    const cleanSrcBase = srcBase ? srcBase.replace(/\d+$/, '').trim() : '';
    for (const [kw, t] of Object.entries(CONFIG.typeByAltKeyword)) {
      if (cleanCode === kw || cleanSrcBase === kw || alt === kw) { type = t; break; }
    }

    // Tier from the alt-suffix digit only; stat-range/color resolution is
    // centralised in detectItem (stat range is the primary indicator there).
    return { type, alt, code, srcBase, tier, isSkin: false };
  }

  // Tier from stat ranges — the PRIMARY tier indicator (works for skinned and
  // unskinned items alike, unlike the alt-suffix digit which skins lack and the
  // border color which skin art covers). Weapons match attack+crit against
  // weaponRanges; armor matches its single stat against statRangesByTier. The
  // ranges are the per-tier roll bands, so a valid item's stat falls in exactly
  // one band; a value in a between-tier gap or out of range returns null and the
  // caller falls back to the alt digit / color.
  function tierFromStats(type, stats) {
    if (!stats) return null;
    if (type === 'weapon') {
      const { attack, crit } = stats;
      if (attack == null || crit == null) return null;
      for (const [tStr, r] of Object.entries(CONFIG.weaponRanges)) {
        if (attack >= r.dmg.min && attack <= r.dmg.max &&
            crit >= r.crit.min && crit <= r.crit.max) return Number(tStr);
      }
      return null;
    }
    const bands = CONFIG.statRangesByTier[type];
    const v = stats.primaryPercent;
    if (!bands || v == null) return null;
    for (const [tStr, r] of Object.entries(bands)) {
      if (v >= r.min && v <= r.max) return Number(tStr);
    }
    return null;
  }

  function detectItem(img, card) {
    const det = detectType(img, card);
    if (det.type === 'unknown' || det.type === 'scrap') return det;
    if (typeof isConsumable === 'function' && isConsumable(det.type)) return det;

    // Tier resolution, in priority order:
    //   1. stat range (primary; covers skinned items that carry no alt digit)
    //   2. deterministic class tier for weapons (knife=T1 … jet=T6)
    //   3. alt-suffix digit (e.g. "pants4") for unskinned items
    //   4. tier-tinted border color (last resort)
    let tier = null;
    if (card) tier = tierFromStats(det.type, parseStats(card, det.type));
    if (tier == null && det.type === 'weapon') tier = CONFIG.weaponCodeToTier[det.code] ?? null;
    if (tier == null) tier = det.tier;
    if (tier == null) tier = detectTierByColor(card);

    // Keep the armor market code consistent with the resolved tier
    // ("pants" + 4 -> "pants4"); weapons keep their slot code and pair the tier
    // at lookup time, so only rebuild for armor.
    let code = det.code;
    if (det.type !== 'weapon' && tier != null) code = det.type + tier;

    return { ...det, tier, code };
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
    const cell = getItemCell(card);
    const stats = { attack: null, crit: null, primaryPercent: null, durability: null };
    const fp = CONFIG.statSvgFingerprints;

    // 1. Durability from bar (primary source)
    const durBar = findDurabilityBar(cell);
    if (durBar) {
      const barText = getCleanTextContent(durBar, true);
      const pctMatch = barText.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) {
        stats.durability = parseNum(pctMatch[1]);
      } else {
        const scaleXEl = durBar.querySelector('[style*="scaleX"]');
        if (scaleXEl) {
          const style = scaleXEl.getAttribute('style') || '';
          const m = style.match(/scaleX\(([\d.]+)\)/);
          if (m) {
            const val = Number.parseFloat(m[1]);
            stats.durability = val <= 1.0 ? Math.round(val * 100) : Math.round(val);
          }
        }
      }
    }

    // 2. Parse stats from icons
    let unknownStatVal = null;
    const icons = cell.querySelectorAll('.a6izou0');
    icons.forEach((icon) => {
      const path = icon.querySelector('path');
      const d = path ? (path.getAttribute('d') || '') : '';
      const val = numberNearClean(icon);
      if (val == null) return;
      if (d.includes(fp.attack)) stats.attack = val;
      else if (d.includes(fp.crit)) stats.crit = val;
      else if (fp.armor && d.includes(fp.armor)) stats.primaryPercent = val;
      else if (unknownStatVal == null) unknownStatVal = val;
    });

    if (type !== 'weapon' && stats.primaryPercent == null && unknownStatVal != null) {
      stats.primaryPercent = unknownStatVal;
    }

    // 3. Durability fallback (if not resolved from bar)
    if (stats.durability == null) {
      const text = getCleanTextContent(cell, true).replace(/\s+/g, ' ').trim();
      const percents = (text.match(/(\d+(?:[.,\s]\d+)?)\s*%/g) || [])
        .map(p => parseNum(p));
      if (percents.length) stats.durability = percents[percents.length - 1];
    }

    stats.scrapYield = extractScrapYield(card);
    return stats;
  }

  // Find the numeric text associated with a clean svg/path element. Climb until
  // an ancestor's text contains exactly one number-that is the stat's own
  // value box. A multi-number ancestor means we climbed too far (it now spans
  // sibling stats), so return the last single-number result instead of grabbing
  // an unrelated figure.
  function numberNearClean(cleanNode) {
    let el = cleanNode;
    for (let i = 0; i < 4 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const text = getCleanTextContent(el).replace(/\s+/g, ' ').trim();
      const nums = text.match(/\d+(?:[.,\s]\d+){0,10}/g) || [];
      if (nums.length === 1) {
        return parseNum(nums[0]);
      } else if (nums.length > 1) {
        break; // spans more than this stat-stop
      }
    }
    return null;
  }

  function extractScrapYield(card) {
    // Look for a scrap icon inside the card and read its adjacent number,
    // otherwise scan text near the word "scrap".
    const scrapImg = card.querySelector("img[src*='scrap'], img[alt*='scrap' i]");
    if (scrapImg) {
      const imgs = Array.from(card.querySelectorAll('img'));
      const idx = imgs.indexOf(scrapImg);
      if (idx !== -1 && imgs[idx]) {
        const n = numberNearClean(imgs[idx]);
        if (n != null) return n;
      }
    }
    const text = getCleanTextContent(card).replace(/\s+/g, ' ').trim();
    const m = /(\d+(?:[.,\s]\d+){0,10})\s*(?:scraps?|schrott)/i.exec(text || '');
    return m ? parseNum(m[1]) : null;
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
    const vals = Object.values(skills).map(Number).filter((n) => !Number.isNaN(n));
    return vals.length ? vals[0] : null; // single skill per armor piece
  }

  // My item's comparable scalar, from the DOM-parsed stats.
  function itemStat(item) {
    if (item.type === 'weapon') return statForType('weapon', { attack: item.stats.attack, crit: item.stats.crit });
    return item.stats.primaryPercent;
  }


  function getTransactionReferencePrice(txs, type, myStat) {
    if (!txs || !txs.length || myStat == null) return null;

    const lookbackMs = txRefLookbackMs();

    const validTxs = txs.map(tx => {
      if (!isRecentMarketTx(tx, lookbackMs)) return null;

      const score = getTxScore(tx, type);
      return {
        price: getTxPrice(tx),
        score,
        diff: score != null ? Math.abs(score - myStat) : Infinity
      };
    }).filter(t => t != null && t.price != null && t.score != null && t.diff !== Infinity);

    if (!validTxs.length) return null;

    // Sort by diff ascending
    validTxs.sort((a, b) => a.diff - b.diff);

    // Widen the pool to at least txRefMinSample entries (grouping same-diff
    // ties atomically, same as before), then hard-cap at txRefMaxSample —
    // a single huge tie-group could otherwise blow past it in one step.
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
      if (closest.length >= CONFIG.txRefMinSample) break;
    }
    if (closest.length > CONFIG.txRefMaxSample) closest.length = CONFIG.txRefMaxSample;

    const kept = rejectPriceOutliers(closest, (t) => t.price);
    if (kept.length < closest.length) {
      dbg('advisor', 'debug', 'txRef: rejected price outliers', {
        rejected: closest.length - kept.length,
        kept: kept.length,
        prices: closest.map((t) => t.price)
      });
    }

    const sum = kept.reduce((acc, t) => acc + t.price, 0);
    return {
      price: sum / kept.length,
      count: kept.length,
      diff: closest[0]?.diff ?? 0
    };
  }

  function evaluate(item, ctx) {
    const { type, tier, stats } = item;
    const reasons = [];

    if (type === 'scrap' || type === 'unknown') {
      return { action: ACTION.UNKNOWN, reason: t('notEquipment'), market: null, scrapValue: null };
    }

    item.stale = ctx.stale;
    const myStat = itemStat(item);
    item.myStat = myStat;
    if (type === 'weapon') item.weaponScore = myStat;

    // Calculate HOLD range-based check dynamically
    const critWeight = CONFIG.weaponCritWeight;
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
        rangeLabel = t('rangeLabelWeapon', { score: fmt(holdScore), threshold: fmt(thresholdVal), min: fmt(rangeMin), max: fmt(rangeMax) });
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
        rangeLabel = t('rangeLabelArmor', { stat: fmt(myStat), threshold: fmt(thresholdVal), min: rangeMin, max: rangeMax, pct: isPercent });
      }
    }

    // scrap value = live scrap unit price * per-tier yield.
    const scrapPrice = ctx.scrapPrice;
    const scrapYield = tier != null ? CONFIG.scrapYieldByTier[tier] ?? null : null;
    item.scrapYield = scrapYield;
    item.scrapPriceUnit = scrapPrice;
    const scrapValue = scrapPrice != null && scrapYield != null ? scrapPrice * scrapYield : null;

    const txData = item.code ? ctx.txs[item.code] : null;

    const txRef = getTransactionReferencePrice(txData, type, myStat);
    item.txRefPrice = txRef ? txRef.price : null;
    item.txClosestCount = txRef ? txRef.count : 0;
    item.txClosestDiff = txRef ? txRef.diff : null;

    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
    item.txCount = txData ? txData.filter(t => {
      const parsedTime = getTxTimestamp(t);
      const price = getTxPrice(t);
      const isMarket = t.transactionType === undefined || t.transactionType === 'itemMarket';
      return Number.isFinite(parsedTime) && parsedTime >= sixDaysAgo && price != null && isMarket;
    }).length : 0;

    let market = item.txRefPrice;
    let marketSource = 'transactions';
    item.marketSource = marketSource;

    // 1) Rule: Keep top 3 of stock per color/tier
    if (item.isStockKeep === true) {
      const label = type === 'weapon' ? (getLocale() === 'de' ? `Waffe (T${tier})` : `weapon (T${tier})`) : item.code;
      reasons.push(t('stockKeepReason', { rank: item.stockRank, size: item.stockSize, label: label }));
      return decide(ACTION.KEEP, reasons, market, scrapValue);
    }

    // 2) Rule: (Removed legacy T3 exception rule)

    // 3) Rule: Weapon Crit checks to avoid scrap for T1/T2 (only absolute TOP-stats)
    let avoidScrap = false;
    if (type === 'weapon') {
      const crit = stats.crit ?? 0;
      if (tier === 1 && crit >= 5) {
        avoidScrap = true;
        reasons.push(t('critCondition', { tierLabel: 'T1', crit: fmt(crit), min: '5.00', range: '1% - 5%' }));
      } else if (tier === 2 && crit >= 10) {
        avoidScrap = true;
        reasons.push(t('critCondition', { tierLabel: 'T2', crit: fmt(crit), min: '10.00', range: '6% - 10%' }));
      }
    }

    // 4) top roll -> KEEP (data-driven against inventory rolls) - only if not explicitly rejected from stock keep
    if (item.isStockKeep !== false) {
      if (item.isInventoryTopRoll === true) {
        reasons.push(t('topRollInv', { stat: fmt(myStat), pct: Math.round(CONFIG.goodRollTopFraction * 100), items: item.inventorySampleCount }));
        return decide(ACTION.KEEP, reasons, market, scrapValue);
      } else if (item.isInventoryTopRoll === false) {
        reasons.push(t('notTopRollInv', { stat: fmt(myStat), items: item.inventorySampleCount }));
      } else {
        reasons.push(t('unknownRollRank'));
      }
    }

    // 5) economic decision: scrap value vs market value
    const finalDecision = priceDecision({ value: market, isFallback: false }, scrapValue, reasons, avoidScrap);

    if (finalDecision.action !== ACTION.KEEP && isTopItemscore) {
      finalDecision.action = ACTION.HOLD;
      reasons.unshift(t('topItemscore') + ` (${rangeLabel})`);
      finalDecision.reason = reasons.join('; ');
    }

    return finalDecision;
  }

  function priceDecision(mkt, scrapValue, reasons, avoidScrap) {
    const { value } = mkt;

    if (value == null && scrapValue == null) {
      if (avoidScrap) {
        reasons.push(t('noPriceData') + ' (Held: Crit)');
        return decide(ACTION.HOLD, reasons, value, scrapValue);
      }
      reasons.push(t('noPriceData') + ' (Fallback)');
      return decide(ACTION.SCRAP, reasons, value, scrapValue);
    }
    const taxPct = _resolvedMarketTaxPct ?? 1;
    const netMarketValue = value != null ? value / (1 + taxPct / 100) : null;

    if (scrapValue == null) { // no scrap basis -> sell on whatever market we have
      reasons.push(t('mktNoScrap', { val: fmt(value), net: fmt(netMarketValue) }));
      if (avoidScrap) {
        reasons.push(t('heldCrit'));
        return decide(ACTION.HOLD, reasons, value, scrapValue);
      }
      return decide(ACTION.SELL, reasons, value, scrapValue);
    }
    if (value == null) { // no market -> scrap
      if (avoidScrap) {
        reasons.push(t('noMktHeldCrit'));
        return decide(ACTION.HOLD, reasons, value, scrapValue);
      }
      reasons.push(t('scrapNoMkt', { val: fmt(scrapValue) }));
      return decide(ACTION.SCRAP, reasons, value, scrapValue);
    }
    if (scrapValue > netMarketValue) {
      if (avoidScrap) {
        reasons.push(t('scrapOverMktHeld', { scrap: fmt(scrapValue), net: fmt(netMarketValue), val: fmt(value) }));
        return decide(ACTION.HOLD, reasons, value, scrapValue);
      }
      reasons.push(t('scrapOverMkt', { scrap: fmt(scrapValue), net: fmt(netMarketValue), val: fmt(value) }));
      return decide(ACTION.SCRAP, reasons, value, scrapValue);
    }
    if (avoidScrap) {
      reasons.push(t('mktOverScrapHeld', { net: fmt(netMarketValue), val: fmt(value), scrap: fmt(scrapValue) }));
      return decide(ACTION.HOLD, reasons, value, scrapValue);
    }
    reasons.push(t('mktOverScrap', { net: fmt(netMarketValue), val: fmt(value), scrap: fmt(scrapValue) }));
    return decide(ACTION.SELL, reasons, value, scrapValue);
  }

  function decide(action, reasons, market, scrapValue) {
    return { action, reason: reasons.join('; '), market, scrapValue };
  }
  function fmt(n) {
    if (n == null) return '?';
    const raw = Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return getLocale() === 'de' ? raw.replace('.', ',') : raw;
  }
  function fmtDamage(n) {
    if (n == null || isNaN(n)) return '?';
    let res = '';
    if (n >= 1e9) {
      res = (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'Mrd';
    } else if (n >= 1e6) {
      res = (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (n >= 1e3) {
      res = (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    } else {
      res = Math.round(n).toString();
    }
    return getLocale() === 'de' ? res.replace('.', ',') : res;
  }

  // "5 min ago" / "just now" / "never" for a stored fetchedAt timestamp.
  function ageLabel(timestamp) {
    if (!timestamp) return t('never');
    const min = Math.floor((now() - timestamp) / 60000);
    if (min <= 0) return t('justNow');
    if (min < 60) return t('minAgo', { min: min });
    return t('hMAgo', { h: Math.floor(min / 60), m: min % 60 });
  }

  function cacheStatus() {
    const pc = readCache(KEYS.priceCache);
    const tc = readCache(KEYS.transactionsCache) || {};
    const priceStale = pc ? now() - pc.fetchedAt > CONFIG.priceCacheTtlMs : true;
    return {
      scrapPrice: pc?.data?.[CONFIG.scrapItemCode] ?? null,
      scrapFetchedAt: pc?.fetchedAt ?? null,
      priceFetchedAt: pc?.fetchedAt ?? null,
      priceCount: pc?.data ? Object.keys(pc.data).length : 0,
      txCodes: Object.keys(tc).length,
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

  const WIA_HEADER_PX = 18;   // top strip height for score + bubble (tune live)
  const WIA_FOOTER_PX = 24;   // bottom strip height for the scrap/market price sub

  function reserveCardLayout(card) {
    const cell = getItemCell(card);
    cell.style.position = 'relative';
    cell.style.overflow = 'visible';
    // Reserve dedicated strips ABOVE (badge/score) and BELOW (price) the card so
    // PROST overlays sit in their own band — never overlapping native stats nor
    // bleeding into neighbouring cards. Padding on the FULL cell shifts image and
    // stats down together (alignment stays uniform across all cards). Force
    // content-box so the padding always adds height, regardless of inherited sizing.
    cell.style.boxSizing = 'content-box';
    cell.style.paddingTop = WIA_HEADER_PX + 'px';
    cell.style.paddingBottom = WIA_FOOTER_PX + 'px';
    card.dataset.wiaHeader = '1';
  }

  function getResultFingerprint(item, result) {
    const isProvisional = result.provisional ? '1' : '0';
    const scrapVal = result.scrapValue ?? 'null';
    const marketVal = result.market ?? 'null';
    const isStockKeep = item.isStockKeep ? '1' : '0';
    return `${result.action}_${isProvisional}_${scrapVal}_${marketVal}_${isStockKeep}_${item.myStat ?? 'null'}`;
  }

  function renderItem(card, item, result) {
    const cell = getItemCell(card);
    const state = getItemState(card, item.stats);

    if (!originalTitles.has(card)) {
      originalTitles.set(card, card.title || '');
    }

    // 1. Equipped suppression check
    if (state.equipped) {
      delete card.dataset.wiaFingerprint;
      suspendObserver();
      try {
        const badge = card.querySelector('.wia-badge');
        if (badge) badge.remove();
        const scoreSub = card.querySelector('.wia-score-sub');
        if (scoreSub) scoreSub.remove();
        cleanupPriceSub(cell);
        cleanupCardHeader(card);
        const topBanner = card.querySelector('.wia-top-banner');
        if (topBanner) topBanner.remove();
        card.style.boxShadow = '';
        card.dataset.wiaSuppressed = '1';
        delete card.dataset.wiaDone;
        if (originalTitles.has(card)) {
          card.title = originalTitles.get(card);
        }
      } finally {
        resumeObserver();
      }
      return;
    }

    const fingerprint = getResultFingerprint(item, result);
    if (card.dataset.wiaFingerprint === fingerprint) {
      return;
    }
    card.dataset.wiaFingerprint = fingerprint;

    card.dataset.wiaDone = '1';
    if (card.dataset.wiaHeader !== '1') {
      suspendObserver();
      try {
        reserveCardLayout(card);
      } finally {
        resumeObserver();
      }
    }

    // Clean up old classes if they exist from hot-reloads
    const oldScore = card.querySelector('.wia-score-banner');
    if (oldScore) oldScore.remove();
    const oldPrice = card.querySelector('.wia-price-banner');
    if (oldPrice) oldPrice.remove();
    const oldBottomRow = card.querySelector('.wia-bottom-row');
    if (oldBottomRow) oldBottomRow.remove();
    const oldTopBanner = card.querySelector('.wia-top-banner');
    if (oldTopBanner) oldTopBanner.remove();

    // 2. Recommendation Badge (always shown for active non-damaged items)
    let badge = cell.querySelector('.wia-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'wia-badge';
      cell.appendChild(badge);
    }
    const emojiMap = { KEEP: '💎', SELL: '💰', SCRAP: '🔨', HOLD: '✋', UNKNOWN: '❓' };
    const text = emojiMap[result.action] || '❓';
    if (result.provisional) {
      badge.classList.add('wia-provisional');
      card.dataset.wiaProvisional = '1';
    } else {
      badge.classList.remove('wia-provisional');
      delete card.dataset.wiaProvisional;
    }
    badge.textContent = text;
    badge.style.background = BADGE_COLORS[result.action] || BADGE_COLORS.UNKNOWN;
    badge.style.opacity = item.stale ? '0.55' : '1'; // dim when on cached/stale prices
    const tooltipText = buildTooltip(item, result);
    badge.title = tooltipText;
    card.title = tooltipText;

    // 3. Score Sub-badge
    let scoreSub = cell.querySelector('.wia-score-sub');
    const showScore = item.myStat != null;
    if (showScore) {
      if (!scoreSub) {
        scoreSub = document.createElement('div');
        scoreSub.className = 'wia-score-sub';
        cell.appendChild(scoreSub);
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


    // 4. Price Sub-badge (only for 100% unequipped)
    const showPrice = result.scrapValue != null || result.market != null;
    let priceSub = cell.querySelector('.wia-price-sub');

    if (showPrice) {
      suspendObserver();
      try {
        if (priceSub && priceSub.parentElement !== cell) {
          priceSub.remove();
          priceSub = null;
        }
        if (!priceSub) {
          priceSub = document.createElement('div');
          priceSub.className = 'wia-price-sub';
          cell.appendChild(priceSub);
        }
        const sVal = result.scrapValue;
        const mVal = result.market;

        const formatVal = (v) => {
          if (v == null) return '?';
          if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
          if (v >= 100) return v.toFixed(0);
          return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
        };

        priceSub.textContent = '';            // clear previous render
        const mkRow = (iconHtml, val) => {
          const row = document.createElement('div'); row.className = 'wia-price-row';
          const i = document.createElement('span'); i.className = 'wia-price-ico';
          i.innerHTML = iconHtml;             // trusted constant only (emoji string or CONFIG.marketIconSvg)
          const v = document.createElement('span'); v.className = 'wia-price-val';
          v.textContent = formatVal(val);     // numeric, never innerHTML
          row.append(i, v); return row;
        };
        priceSub.append(
          mkRow('🔨', sVal),                  // top: scrap value
          mkRow(CONFIG.marketIconSvg, mVal)   // bottom: market value (coin-stack SVG)
        );
        priceSub.title = t('priceTooltip');

        // Dynamic border color to indicate recommendation, maintaining dark theme background
        if (sVal != null && mVal != null) {
          priceSub.style.borderColor = sVal > mVal ? '#2ea043' : '#d29922';
        } else {
          priceSub.style.borderColor = 'rgba(148, 163, 184, 0.15)';
        }
        priceSub.style.display = 'flex';
      } finally {
        resumeObserver();
      }
    } else {
      suspendObserver();
      try {
        cleanupPriceSub(cell);
      } finally {
        resumeObserver();
      }
    }

    // 5. Border tint rules
    card.style.boxShadow = '';

    // 6. Sentinel management
    delete card.dataset.wiaSuppressed;
  }

  function buildTooltip(item, result) {
    const lines = [];
    const itemId = findItemUniqueId(item.card);
    if (itemId) {
      const knownLoot = readCache('wia_pnl_known_loot') || {};
      const lootInfo = knownLoot[itemId];
      if (lootInfo) {
        const typeStr = lootInfo.type === 'crafted' ? (getLocale() === 'de' ? 'HERGESTELLT' : 'CRAFTED') : (getLocale() === 'de' ? 'BEUTE' : 'LOOT');
        lines.push(`💡 ${typeStr} (Ursprünglicher Wert: ${fmt(lootInfo.value)} Gold)`);
      }
    }
    const tierLabel = item.tier != null ? (CONFIG.tiers[item.tier] || {}).label || `T${item.tier}` : '—';
    lines.push(`${item.code || item.type} · ${tierLabel}${item.tier != null ? ` (T${item.tier})` : ''}`);
    if (item.type === 'weapon') {
      lines.push(t('weaponStats', { attack: item.stats.attack ?? '?', crit: item.stats.crit ?? '?' }));
      if (item.weaponScore != null) lines.push(t('weaponScore', { score: item.weaponScore.toFixed(1) }));
    } else {
      const labelKey = 'statLabel_' + item.type;
      const label = (CONFIG.i18n.en[labelKey]) ? t(labelKey) : t('statLabel_stat');
      lines.push(`${label}: ${item.stats.primaryPercent ?? '?'}`);
    }
    if (item.stats.durability != null) lines.push(t('durability', { durability: item.stats.durability }));
    // scrap side: yield × unit-price = total (yield is a per-tier estimate)
    lines.push(t('scrapTooltip', { yield: item.scrapYield ?? '?', price: fmt(item.scrapPriceUnit), val: fmt(result.scrapValue) }));
    if (item.txRefPrice != null) {
      const diffStr = item.txClosestDiff === 0 ? t('exactMatch') : t('diffMatch', { diff: fmt(item.txClosestDiff) });
      lines.push(t('txRef', { val: fmt(result.market), count: item.txClosestCount, diff: diffStr, total: item.txCount }));
    } else {
      lines.push(t('noPriceData'));
    }
    lines.push(`→ ${result.action}: ${result.reason}`);
    if (item.stale) lines.push(t('stalePrices'));
    return lines.join('\n');
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
        let keep = index < CONFIG.stockKeepCount;

        // T1-T3 bad stats filter: exclude items from stock keep if roll is < 50%
        if (keep && item.tier != null && item.tier <= 3) {
          const type = item.type;
          const tier = item.tier;
          const myStat = item.myStat;

          let min = 0, max = 0;
          if (type === 'weapon') {
            const wRange = CONFIG.weaponRanges[tier];
            if (wRange) {
              const critWeight = CONFIG.weaponCritWeight;
              min = wRange.dmg.min + wRange.crit.min * critWeight;
              max = wRange.dmg.max + wRange.crit.max * critWeight;
            }
          } else {
            const range = CONFIG.statRangesByTier[type]?.[tier];
            if (range) {
              min = range.min;
              max = range.max;
            }
          }

          if (max > min && myStat != null) {
            const rollPct = ((myStat - min) / (max - min)) * 100;
            if (rollPct < 50) {
              keep = false;
            }
          }
        }

        item.isStockKeep = keep;
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
  let lastInventoryFingerprints = [];

  function getCardBaseText(card) {
    const cell = getItemCell(card);
    if (!cell) return '';
    let text = '';

    function walk(node) {
      const isMock = node.nodeType === undefined;
      if (!isMock && node.nodeType === 3) { // TEXT_NODE
        text += (node.nodeValue || '') + ' ';
      } else {
        const cl = node.classList;
        if (cl && (cl.contains('wia-badge') ||
                   cl.contains('wia-score-sub') ||
                   cl.contains('wia-price-sub') ||
                   cl.contains('wia-top-banner'))) {
          return;
        }

        if (isMock) {
          if (node.children && node.children.length > 0) {
            node.children.forEach(walk);
          } else {
            text += (node._textContent || '') + ' ';
          }
        } else {
          const children = node.childNodes;
          if (children && children.length > 0) {
            for (let i = 0; i < children.length; i++) {
              walk(children[i]);
            }
          }
        }
      }
    }

    walk(cell);
    return text.replace(/\s+/g, ' ').trim();
  }

  function reResolveCard(oldCard) {
    if (!oldCard) return null;
    if (oldCard.isConnected) return oldCard;
    const itemId = findItemUniqueId(oldCard);
    if (!itemId) return null;
    const cards = findItemCards(false);
    for (const card of cards.keys()) {
      if (card.isConnected && findItemUniqueId(card) === itemId) {
        return card;
      }
    }
    return null;
  }

  function getItemState(card, stats) {
    const t = getCardBaseText(card);
    const equipped = /\bEquip(\.|ped)?\b/i.test(t) || /\bausgerüstet\b/i.test(t);
    const damaged  = stats.durability != null && stats.durability < 100;
    return { equipped, damaged };
  }

  function shouldSuppressItem(card, stats) {
    const state = getItemState(card, stats);
    return state.equipped || state.damaged;
  }

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

  let lastHicReason = '';
  function hasInventoryChanged(cards) {
    if (!lastInventoryFingerprints || lastInventoryFingerprints.length !== cards.size) {
      lastHicReason = `size ${lastInventoryFingerprints ? lastInventoryFingerprints.length : 'null'}->${cards.size}`;
      return true;
    }

    let idx = 0;
    for (const [card, img] of cards.entries()) {
      const last = lastInventoryFingerprints[idx];
      if (!last) {
        lastHicReason = `index-missing @${idx}`;
        return true;
      }
      const itemId = findItemUniqueId(card);
      if (itemId !== last.itemId) {
        lastHicReason = `itemId @${idx} ${last.itemId}->${itemId}`;
        return true;
      }

      const src = img.getAttribute('src') || '';
      if (src !== last.src) {
        lastHicReason = `img-src @${idx} [${last.src}]->[${src}]`;
        return true;
      }

      const alt = img.getAttribute('alt') || '';
      if (alt !== last.alt) {
        lastHicReason = `img-alt @${idx} [${last.alt}]->[${alt}]`;
        return true;
      }

      const hasBadgeOrSuppressed = !!card.querySelector('.wia-badge') || !!card.dataset.wiaSuppressed;
      if (!hasBadgeOrSuppressed && last.hasBadgeOrSuppressed) {
        lastHicReason = `no-badge @${idx}`;
        return true;
      }

      const baseText = getCardBaseText(card);
      if (baseText !== last.baseText) {
        lastHicReason = `text @${idx}: [${last.baseText}]->[${baseText}]`;
        return true;
      }
      idx++;
    }
    return false;
  }

  function recordInventoryFingerprint(cards) {
    lastInventoryFingerprints = [];
    cards.forEach((img, card) => {
      lastInventoryFingerprints.push({
        itemId: findItemUniqueId(card),
        src: img.getAttribute('src') || '',
        alt: img.getAttribute('alt') || '',
        hasBadgeOrSuppressed: !!card.querySelector('.wia-badge') || !!card.dataset.wiaSuppressed,
        baseText: getCardBaseText(card)
      });
    });
  }

  const pendingFetches = new Set();

  function hasFreshCachedData(code, cache) {
    const tc = cache || GM_getValue(KEYS.transactionsCache, {}) || {};
    const cachedTx = tc[code];
    if (!cachedTx || now() - cachedTx.fetchedAt >= CONFIG.txCacheTtlMs) return false;
    return true;
  }

  // Decide advisor health after a bulk price load. `loaded` = codes whose fetch
  // returned usable data, `requested` = codes we tried to fetch this pass.
  function advisorLoadHealth(loaded, requested) {
    if (requested === 0 || loaded >= requested) return { status: 'ok', reason: '' };
    return { status: 'warn', reason: `market prices unavailable (${loaded}/${requested} loaded)` };
  }



async function scanInventory(force) {
    if (!CONFIG.featItemAdvisor) return;
    if (force) {
      cachedCards = null;
    }
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

    bypassNextScanDebounce = false;

    log(`scanInventory started (force=${force})`);
    scanning = true;

    try {
      const items = [];
      const suppressedCards = [];

      cards.forEach((img, card) => {
        const itemInfo = detectItem(img, card);
        const { type, alt, code, tier } = itemInfo;

        // Stats only parsed if not scrap or unknown
        const stats = (type === 'scrap' || type === 'unknown') ? null : parseStats(card, type);

        if (!originalTitles.has(card)) {
          originalTitles.set(card, card.title || '');
        }

        if (type === 'scrap' || type === 'unknown' || isConsumable(type) || isConsumable(code) || shouldSuppressItem(card, stats)) {
          suppressedCards.push(card);
        } else {
          // Synchronously reserve layout
          reserveCardLayout(card);

          const item = { card, img, type, alt, code, tier, stats };
          item.myStat = itemStat(item);
          if (type === 'weapon') item.weaponScore = item.myStat;
          items.push(item);
        }
      });

      // Synchronously cleanup suppressed cards upfront
      if (suppressedCards.length > 0) {
        suspendObserver();
        try {
          suppressedCards.forEach((card) => {
            const cell = getItemCell(card);
            const badge = card.querySelector('.wia-badge');
            if (badge) badge.remove();
            const scoreSub = card.querySelector('.wia-score-sub');
            if (scoreSub) scoreSub.remove();
            cleanupPriceSub(cell);
            cleanupCardHeader(card);
            const topBanner = card.querySelector('.wia-top-banner');
            if (topBanner) topBanner.remove();
            card.style.boxShadow = '';

            card.dataset.wiaSuppressed = '1';
            delete card.dataset.wiaDone;

            if (originalTitles.has(card)) {
              card.title = originalTitles.get(card);
            }
          });
        } finally {
          resumeObserver();
        }
      }

      if (!items.length) {
        scanning = false;
        return;
      }

      calculateInventoryRankings(items);

      // Synchronous Price Cache loading
      const pc = readCache(KEYS.priceCache);
      const currentPriceFetchedAt = pc ? pc.fetchedAt : 0;
      const prices = pc ? pc.data : {};
      const scrapPrice = prices ? prices[CONFIG.scrapItemCode] ?? null : null;

      const tc = readCache(KEYS.transactionsCache);

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

        if (tc[c]) {
          txs[c] = tc[c].data;
        }
      });

      const ctx = { prices, scrapPrice, txs, stale: cacheStatus().stale };

      // Synchronous First Paint
      suspendObserver();
      try {
        for (const item of items) {
          const itemId = findItemUniqueId(item.card);
          const statsHash = JSON.stringify(item.stats);
          const fresh = hasFreshCachedData(item.code);

          let result = getPersistedAdvice(itemId, statsHash, currentPriceFetchedAt);
          if (!result) {
            result = evaluate(item, ctx);
            if (!fresh) {
              result = { ...result };
              result.provisional = true;
            } else {
              setPersistedAdvice(itemId, result, statsHash, currentPriceFetchedAt);
            }
          }
          renderItem(item.card, item, result);
        }
      } finally {
        resumeObserver();
      }
      updateStatusIndicator();
      log(`scanned ${items.length} items (immediate render done)`);
      recordInventoryFingerprint(cards);

      // Background Async Loads
      const isGlobalPriceStale = !pc || now() - pc.fetchedAt >= CONFIG.priceCacheTtlMs;
      if (isGlobalPriceStale || codesToFetch.length > 0 || force) {
        (async () => {
          try {
            if (isGlobalPriceStale || force) {
              await (globalThis.fetchPrices || fetchPrices)(force);
            }

            if (codesToFetch.length > 0) {
              const N = codesToFetch.length;
              const startTime = now();
              let n = 0;

              const allUniqueCodes = [...new Set(items.map((i) => i.code).filter(Boolean))];
              const fromCache = allUniqueCodes.length - N;

              if (CONFIG.debug) {
                dbg('core', 'debug', `Triggering background loads for: ${codesToFetch.join(', ')}`);
              }

              const uniqueCodesToFetch = codesToFetch.filter(c => !pendingFetches.has(c));
              uniqueCodesToFetch.forEach(c => pendingFetches.add(c));

              const loadResults = await mapWithConcurrency(uniqueCodesToFetch, CONFIG.itemFetchConcurrency, async (c) => {
                try {
                  if (CONFIG.debug && CONFIG.verboseDebug) {
                    dbg('core', 'debug', `Background load started for ${c}`);
                  }
                  const data = await fetchItemTransactions(c, force);
                  if (CONFIG.debug && CONFIG.verboseDebug) {
                    dbg('core', 'debug', `Background load finished for ${c}`);
                  }
                  return Array.isArray(data) && data.length > 0;
                } catch (e) {
                  log(`Background load failed for ${c}:`, e);
                  return false;
                } finally {
                  pendingFetches.delete(c);
                }
              });
              n = loadResults.filter(Boolean).length;

              const ms = now() - startTime;
              log(`background: fetched ${n}/${N} codes in ${ms}ms (${fromCache} cached)`);

              const health = advisorLoadHealth(n, N);
              setHealth('advisor', health.status, health.reason || undefined);

              // ONE re-render pass over the items!
              const nextPc = readCache(KEYS.priceCache);
              const nextPriceFetchedAt = nextPc ? nextPc.fetchedAt : 0;
              const nextPrices = nextPc ? nextPc.data : {};
              const nextScrapPrice = nextPrices ? nextPrices[CONFIG.scrapItemCode] ?? null : null;
              const nextTc = readCache(KEYS.transactionsCache) || {};

              const nextTxs = {};
              items.forEach((item) => {
                const c = item.code;
                if (c && nextTc[c]) {
                  nextTxs[c] = nextTc[c].data;
                }
              });

              const nextCtx = {
                prices: nextPrices,
                scrapPrice: nextScrapPrice,
                txs: nextTxs,
                stale: cacheStatus().stale
              };

              suspendObserver();
              try {
                items.forEach((item) => {
                  const card = reResolveCard(item.card);
                  if (!card) return;
                  item.card = card;

                  const itemId = findItemUniqueId(card);
                  const statsHash = JSON.stringify(item.stats);
                  const fresh = hasFreshCachedData(item.code);

                  let result = getPersistedAdvice(itemId, statsHash, nextPriceFetchedAt);
                  if (!result) {
                    result = evaluate(item, nextCtx);
                    if (!fresh) {
                      result = { ...result };
                      result.provisional = true;
                    } else {
                      setPersistedAdvice(itemId, result, statsHash, nextPriceFetchedAt);
                    }
                  }
                  renderItem(card, item, result);
                });
              } finally {
                resumeObserver();
              }
              updateStatusIndicator();
            } else if (isGlobalPriceStale || force) {
              log('Re-evaluating items after global price update...');
              const nextPc = readCache(KEYS.priceCache);
              const nextPriceFetchedAt = nextPc ? nextPc.fetchedAt : 0;
              const nextPrices = nextPc ? nextPc.data : {};
              const nextScrapPrice = nextPrices ? nextPrices[CONFIG.scrapItemCode] ?? null : null;

              const nextCtx = {
                prices: nextPrices,
                scrapPrice: nextScrapPrice,
                txs: ctx.txs,
                stale: cacheStatus().stale
              };

              suspendObserver();
              try {
                items.forEach(item => {
                  const card = reResolveCard(item.card);
                  if (!card) return;
                  item.card = card;

                  const itemId = findItemUniqueId(card);
                  const statsHash = JSON.stringify(item.stats);
                  const fresh = hasFreshCachedData(item.code);

                  let result = getPersistedAdvice(itemId, statsHash, nextPriceFetchedAt);
                  if (!result) {
                    result = evaluate(item, nextCtx);
                    if (!fresh) {
                      result = { ...result };
                      result.provisional = true;
                    } else {
                      setPersistedAdvice(itemId, result, statsHash, nextPriceFetchedAt);
                    }
                  }
                  renderItem(card, item, result);
                });
              } finally {
                resumeObserver();
              }
            }

            if (CONFIG.featPillReminder) {
              highlightCocaineItems();
            }
            recordInventoryFingerprint(cards);
          } catch (err) {
            log('Background update failed:', err);
          }
        })();
      } else {
        if (CONFIG.featPillReminder) {
          highlightCocaineItems();
        }
      }

      if (CONFIG.featPnlTracker) {
        checkInventoryDeltaConsumption();
        checkInventoryDeltaWear();
      }
    } catch (e) {
      reportError('advisor', e, 'scanInventory failed');
    } finally {
      scanning = false;
    }
  }

  function teardownAdvisor() {
    document.querySelectorAll('.wia-badge, .wia-score-sub, .wia-price-sub').forEach((el) => el.remove());
    document.querySelectorAll('[data-wia-suppressed]').forEach((el) => {
      delete el.dataset.wiaSuppressed;
    });
    setHealth('advisor', 'idle', 'disabled in settings');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Settings UI
  // ───────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    GM_addStyle(`

    /* ====== EQUIP SELL CALC ====== */
    .wia-equip-sell-fab {
      position:fixed; top:58px; left:16px; width:38px; height:38px; border-radius:50%;
      background:#21262d; border:1px solid #30363d; z-index:9998; cursor:pointer;
      display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px #00000066;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .wia-equip-sell-fab:hover { border-color: #7c3aed; background: #30363d; transform: scale(1.05); }
    .wia-equip-sell-fab.wia-calc-no-sp { top:12px; }
    
    .wia-equip-sell-panel {
      position:fixed; top:58px; left:50%; transform:translateX(-50%); width:296px; background:#161b22;
      border:1px solid #30363d; border-radius:10px; padding:14px; z-index:9997;
      box-shadow:0 8px 32px #000000aa;
      animation: wia-fade-scale 0.15s ease-out forwards;
      transform-origin: top center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    
    @keyframes wia-fade-scale {
      0% { opacity: 0; transform: scale(0.95) translateY(-5px); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* ====== SCRATCHPAD ====== */

    .sp-trigger {
      position: fixed;
      top: 12px;
      left: 16px;
      width: 38px;
      height: 38px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 50%;
      box-shadow: 0 4px 14px rgba(0,0,0,.5);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.1s;
    }
    .sp-trigger:hover {
      background: #21262d;
      border-color: #58a6ff;
    }
    .sp-trigger:hover + .sp-quick-create, .sp-quick-create:hover {
      opacity: 1;
      visibility: visible;
      transition-delay: 0s;
    }
    .sp-trigger svg {
      width: 18px;
      height: 18px;
      stroke: #c9d1d9;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .sp-trigger-dot {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 10px;
      height: 10px;
      background: #58a6ff;
      border: 2px solid #161b22;
      border-radius: 50%;
    }
    .sp-quick-create {
      position: fixed;
      left: 62px;
      top: 14px;
      height: 34px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      opacity: 0;
      visibility: hidden;
      align-items: center;
      gap: 4px;
      padding: 0 10px;
      cursor: pointer;
      z-index: 9999;
      transition: opacity 0.2s, visibility 0.2s, border-color 0.1s, color 0.1s;
      transition-delay: 1.5s;
    }
    .sp-quick-create::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: -20px;
      width: 20px;
    }
    .sp-quick-create:hover {
      color: #c9d1d9;
      border-color: #58a6ff;
    }
    .sp-quick-create svg {
      width: 13px;
      height: 13px;
      stroke-width: 2;
    }
    .sp-panel {
      position: fixed;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      box-shadow: 0 8px 30px rgba(0,0,0,.6);
      z-index: 9998;
      display: flex;
      flex-direction: column;
      resize: both;
      overflow: hidden;
      min-width: 280px;
      min-height: 260px;
    }
    .sp-header {
      padding: 8px 10px;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      justify-content: space-between;
      user-select: none;
      cursor: grab;
    }
    .sp-header-title {
      font-size: 12px;
      font-weight: 600;
      color: #c9d1d9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sp-close-btn {
      width: 28px;
      height: 28px;
      background: transparent;
      border: none;
      color: #c9d1d9;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sp-close-btn:hover {
      background: #21262d;
    }
    .sp-close-btn svg {
      width: 15px;
      height: 15px;
      stroke-width: 1.8;
    }
    .sp-body {
      flex: 1;
      display: flex;
      overflow-y: auto;
      flex-direction: column;
    }
    .sp-body::-webkit-scrollbar {
      width: 6px;
    }
    .sp-body::-webkit-scrollbar-thumb {
      background: #30363d;
      border-radius: 3px;
    }
    .sp-body::-webkit-scrollbar-track {
      background: transparent;
    }
    .sp-body-empty {
      flex: 1;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      color: #6e7681;
      font-size: 12px;
    }
    .sp-body-empty svg {
      width: 36px;
      height: 36px;
      opacity: 0.5;
      stroke-width: 1.2;
      margin-bottom: 8px;
    }
    .sp-list-actions {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(148,163,184,.15);
      display: flex;
      align-items: center;
    }
    .sp-new-btn {
      height: 28px;
      background: #238636;
      border: 1px solid #2ea043;
      border-radius: 6px;
      color: white;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 10px;
      cursor: pointer;
    }
    .sp-new-btn svg {
      width: 12px;
      height: 12px;
    }
    .sp-count {
      margin-left: auto;
      color: #6e7681;
      font-size: 11px;
    }
    .sp-list-row {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(148,163,184,.15);
      display: flex;
      gap: 8px;
      cursor: pointer;
      position: relative;
    }
    .sp-list-row:hover {
      background: #21262d;
    }
    .sp-list-row:focus-visible {
      outline: 2px solid #58a6ff;
      outline-offset: -2px;
    }
    .sp-row-icon {
      width: 20px;
      display: flex;
      justify-content: center;
      margin-top: 2px;
    }
    .sp-row-icon svg {
      width: 16px;
      height: 16px;
      stroke: #6e7681;
      stroke-width: 1.6;
    }
    .sp-row-content {
      flex: 1;
      min-width: 0;
    }
    .sp-row-title {
      font-size: 12px;
      font-weight: 600;
      color: #c9d1d9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
    }
    .sp-row-preview {
      font-size: 11px;
      color: #8b949e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sp-row-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      justify-content: center;
    }
    .sp-row-date {
      font-size: 10px;
      color: #6e7681;
      font-variant-numeric: tabular-nums;
    }
    .sp-row-delete {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      border-radius: 4px;
      color: #c9d1d9;
      opacity: 0;
      transition: opacity 0.1s;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 4px;
    }
    .sp-list-row:hover .sp-row-delete {
      opacity: 1;
    }
    .sp-row-delete:hover {
      background: #6e2024;
      color: white;
    }
    .sp-row-delete svg {
      width: 13px;
      height: 13px;
    }
    .sp-delete-toast {
      position: absolute;
      bottom: 8px;
      left: 8px;
      right: 8px;
      background: #2d1214;
      border: 1px solid #b62324;
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      z-index: 9999;
      animation: toastSlideUp 0.15s ease-out;
    }
    @keyframes toastSlideUp {
      from { transform: translateY(6px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .sp-toast-msg {
      flex: 1;
      color: #f0a0a0;
      font-size: 11px;
    }
    .sp-toast-actions {
      display: flex;
      gap: 6px;
    }
    .sp-toast-btn-del, .sp-toast-btn-cancel {
      height: 24px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      padding: 0 8px;
    }
    .sp-toast-btn-del {
      background: #b62324;
      color: white;
    }
    .sp-toast-btn-cancel {
      background: #21262d;
      border: 1px solid #30363d;
      color: #8b949e;
    }
    .sp-body-editor {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .sp-editor-toolbar {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(148,163,184,.15);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sp-btn-back {
      height: 26px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #8b949e;
      border-radius: 4px;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      cursor: pointer;
    }
    .sp-btn-back:hover {
      color: #c9d1d9;
      border-color: #58a6ff;
    }
    .sp-btn-back svg {
      width: 12px;
      height: 12px;
    }
    .sp-editor-date {
      font-size: 10px;
      color: #6e7681;
      font-variant-numeric: tabular-nums;
    }
    .sp-editor-textarea {
      flex: 1;
      background: #0d1117;
      color: #c9d1d9;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.55;
      padding: 12px;
      border: none;
      outline: none;
      resize: none;
    }
    .sp-editor-textarea::placeholder {
      color: #6e7681;
    }
    .sp-autosave-bar {
      border-top: 1px solid rgba(148,163,184,.15);
      padding: 5px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sp-autosave-dot {
      width: 5px;
      height: 5px;
      background: #2ea043;
      border-radius: 50%;
    }
    .sp-autosave-text {
      font-size: 10px;
      color: #6e7681;
    }

      .wia-badge {
        position: absolute; right: 2px; top: 2px; z-index: 50;
        width: 16px; height: 16px; border-radius: 50%;
        font: 10px system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        cursor: help; box-shadow: 0 0 4px rgba(0,0,0,.6);
        user-select: none;
        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      }
      .wia-badge.wia-provisional {
        border: 1.5px dashed #fff !important;
        box-sizing: border-box;
      }
      .wia-score-sub {
        position: absolute; left: 2px; top: 2px; z-index: 60;
        font: bold 8px system-ui, sans-serif; padding: 1px 3px; border-radius: 4px;
        color: #fff; display: flex; align-items: center; justify-content: center;
        text-shadow: 0 1px 1px rgba(0,0,0,.5); box-shadow: 1px 1px 2px rgba(0,0,0,.3);
      }
      .wia-price-sub {
        position: absolute; bottom: 2px; left: 2px; right: 2px; z-index: 60;
        font: bold 9px system-ui, sans-serif; padding: 1px 3px; border-radius: 4px;
        color: #fff; display: flex; flex-direction: column; align-items: stretch; gap: 0;
        line-height: 1.1; letter-spacing: -0.3px;
        justify-content: center;
        background: rgba(22, 27, 34, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.15);
        box-shadow: 0 2px 4px rgba(0,0,0,.5);
        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      }
      .wia-price-sub .wia-price-row { display: flex; align-items: center; justify-content: space-between; gap: 2px; }
      .wia-price-sub .wia-price-ico { font-size: 9px; opacity: .9; display: inline-flex; align-items: center; }
      .wia-price-sub .wia-price-ico svg { width: 1em; height: 1em; display: block; }
      .wia-price-sub .wia-price-val { font-variant-numeric: tabular-nums; }
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
      .wia-gear-update-alert {
        animation: wia-glow 1.5s infinite alternate;
        border-color: #58a6ff !important;
      }
      @keyframes wia-glow {
        from {
          box-shadow: 0 0 4px rgba(88, 166, 255, 0.3);
          background: #21262d;
        }
        to {
          box-shadow: 0 0 14px rgba(88, 166, 255, 0.8);
          background: #1f3a60;
        }
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
        position: relative; max-height: 90vh; overflow-y: auto;
      }
      .wia-hint-toggle {
        width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%;
        background: transparent; color: #58a6ff; cursor: pointer;
        font: bold 12px system-ui, sans-serif; line-height: 1; display: inline-flex;
        align-items: center; justify-content: center;
      }
      .wia-hint-toggle:hover { background: rgba(88,166,255,.15); }
      .wia-hint {
        margin-top: 2px; margin-left: 24px; font-size: 11px; color: #8b949e;
      }
      .wia-hint[hidden] { display: none; }
      .wia-help-toggle {
        margin-top: 15px; border-top: 1px solid #30363d; padding-top: 10px;
        font-weight: 600; color: #58a6ff; cursor: pointer; user-select: none;
        background: transparent; border-left: 0; border-right: 0; border-bottom: 0;
        width: 100%; text-align: left; margin-bottom: 8px;
      }
      .wia-help-panel {
        position: absolute; top: 0; left: 100%; margin-left: 12px;
        width: 320px; max-height: 80vh; overflow-y: auto;
        background: #161b22; border: 1px solid #30363d; border-radius: 10px;
        padding: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.6); z-index: 1;
        font: 13px/1.5 system-ui, sans-serif;
      }
      .wia-help-panel[hidden] { display: none; }
      .wia-help-content {
        font-size: 11px; line-height: 1.45; color: #8b949e;
      }
      .wia-help-content ul { margin: 5px 0; padding-left: 15px; }
      .wia-help-content li { margin-bottom: 4px; }
      @media (max-width: 899px) {
        .wia-help-panel {
          position: static; left: auto; margin-left: 0; margin-top: 12px;
          width: auto; max-height: 200px; box-shadow: none; border: 0;
          border-top: 1px solid #30363d; border-radius: 0; padding: 10px 0 0;
        }
      }
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
      .wia-modal-topbar {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        margin-bottom: 12px;
      }
      .wia-modal-titlewrap { min-width: 0; flex: 1 1 auto; }
      .wia-modal-topbar h2 { margin: 0; font-size: 16px; }
      .wia-locale-wrap { position: relative; flex: 0 0 auto; }
      .wia-locale-btn {
        min-width: 40px; height: 32px; border-radius: 8px; border: 1px solid #30363d;
        background: #21262d; color: #fff; cursor: pointer; font-size: 18px; line-height: 1;
      }
      .wia-locale-btn:hover { border-color: #58a6ff; }
      .wia-locale-menu {
        position: absolute; top: 38px; right: 0; z-index: 30; min-width: 140px;
        border: 1px solid #30363d; border-radius: 8px; background: #161b22;
        box-shadow: 0 12px 30px rgba(0, 0, 0, .42); padding: 6px; display: none;
      }
      .wia-locale-menu.is-open { display: block; }
      .wia-locale-item {
        width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 8px;
        border: 0; border-radius: 6px; background: transparent; color: #c9d1d9;
        cursor: pointer; text-align: left; font: 600 13px/1.2 system-ui, sans-serif;
      }
      .wia-locale-item:hover { background: #21262d; }

      /* ── Pill Reminder module styles ── */
      /* Mimic WareEra's native top-bar chips: pill shape, dark translucent
         fill, hairline border, drop-shadowed glyph/text. Phase is carried by a
         glowing status LED + border tint, NOT a saturated block fill-so the
         badge reads as "another game indicator", not a foreign widget. */
      #wia-pill-badge {
        display: inline-flex; align-items: center; justify-content: center;
        position: relative; margin: 0 8px;
        font: 600 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        border-radius: 999px; padding: 2px 8px; cursor: pointer; user-select: none;
        z-index: 10000; min-height: 26px; box-sizing: border-box;
        color: #e8eef5;
        background: rgba(13, 17, 23, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.10);
        box-shadow: 0 1px 3px rgba(0, 0, 0, .4);
        text-shadow: 0 1px 1px rgba(0, 0, 0, .6);
      }
      .wia-badge-buff    { border-color: rgba(63, 185, 80, .55); }
      .wia-badge-knife   { border-color: rgba(88, 166, 255, .55); }
      .wia-badge-recover { border-color: rgba(210, 153, 34, .60); }
      .wia-badge-gated   { border-color: rgba(139, 148, 158, .50); }
      .wia-badge-ready   {
        border-color: rgba(63, 185, 80, .70);
        animation: wia-pulse-bg 1.5s infinite alternate;
      }
      @keyframes wia-pulse-bg {
        0%   { box-shadow: 0 1px 3px rgba(0,0,0,.4), 0 0 0 rgba(63,185,80,0); }
        100% { box-shadow: 0 1px 3px rgba(0,0,0,.4), 0 0 9px rgba(63,185,80,.6); }
      }
      .wia-pill-row { display: flex; align-items: center; gap: 5px; }
      .wia-pill-status-dot {
        width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto;
        background: #8b949e; box-shadow: 0 0 4px currentColor;
      }
      .wia-badge-buff    .wia-pill-status-dot { background: #3fb950; box-shadow: 0 0 4px rgba(63,185,80,.9); }
      .wia-badge-knife   .wia-pill-status-dot { background: #58a6ff; box-shadow: 0 0 4px rgba(88,166,255,.9); }
      .wia-badge-recover .wia-pill-status-dot { background: #e3b341; box-shadow: 0 0 4px rgba(227,179,65,.9); }
      .wia-badge-ready   .wia-pill-status-dot { background: #3fb950; box-shadow: 0 0 5px rgba(63,185,80,1); }
      .wia-badge-gated   .wia-pill-status-dot { background: #8b949e; box-shadow: 0 0 3px rgba(139,148,158,.7); }
      .wia-pill-text-col {
        display: flex; flex-direction: column; justify-content: center;
        gap: 1px; line-height: 1.1;
      }
      .wia-pill-phase-lbl { font-size: 9px; font-weight: 600; opacity: .82; letter-spacing: .2px; }
      .wia-pill-timer {
        font-size: 9px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .wia-badge-buff .wia-pill-timer    { color: #3fb950; }
      .wia-badge-knife .wia-pill-timer   { color: #58a6ff; }
      .wia-badge-recover .wia-pill-timer { color: #e3b341; }
      .wia-badge-gated .wia-pill-timer   { color: #e3b341; }
      .wia-badge-ready .wia-pill-timer   { color: #3fb950; }
      .wia-pill-hover-details {
        display: none; position: absolute; top: 100%; right: 0; margin-top: 8px;
        width: 250px; background: rgba(13, 17, 23, .96);
        border: 1px solid rgba(255, 255, 255, .12);
        border-radius: 10px; padding: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, .55);
        color: #c9d1d9; font-weight: normal; text-align: left; font-size: 11px;
        text-shadow: none; z-index: 10001; line-height: 1.4;
      }
      #wia-pill-badge:hover .wia-pill-hover-details {
        display: block;
      }
      /* Narrow-panel mode: pull the badge OUT of the inline flex flow so it
         stops widening #layoutUserMenu (which squeezes the native stat
         bubbles). Pinned bottom-right like the other floating bubbles;
         mirrors how #wia-pnl-tracker rides a positioned wrapper. Toggled by
         applyPillFloatState() via a ResizeObserver on the panel width. */
      #wia-pill-badge.wia-pill-badge--float {
        position: absolute;
        right: 8px;
        bottom: -12px;
        margin: 0;
        z-index: 10002;
      }
      /* Hover panel would otherwise open downward off the bottom edge when
         floating — flip it above the badge. */
      #wia-pill-badge.wia-pill-badge--float .wia-pill-hover-details {
        top: auto;
        bottom: 100%;
        margin-top: 0;
        margin-bottom: 8px;
      }
      .wia-pill-detail-item { margin-bottom: 6px; }
      .wia-pill-detail-item strong { color: #58a6ff; }

      /* ── H&H Budget overlays ── */
      .wia-hnh-free-overlay {
        position: absolute; top: 0; bottom: 0;
        background: rgba(255, 255, 255, 0.20); z-index: 5; pointer-events: none;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -1px 0 rgba(255, 255, 255, 0.3);
      }
      .wia-hnh-floor-marker {
        position: absolute; top: 0; bottom: 0; width: 1px;
        background: rgba(255, 255, 255, 0.6); z-index: 6; pointer-events: none;
      }
      .wia-hnh-floor-marker.wia-hnh-alert {
        background: #ff7b72;
        box-shadow: 0 0 4px #ff7b72;
      }

      /* ── Notes module styles ── */
      .warera-note-icon {
        display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; margin-left: 4px;
        border: 0; border-radius: 4px; background: transparent;
        color: #9ca3af; cursor: pointer; font-size: 14px; line-height: 1;
        vertical-align: middle;
      }
      .warera-note-icon:hover, .warera-note-icon:focus-visible {
        background: rgba(148,163,184,.18); color: #facc15; outline: none;
      }
      .warera-note-icon.has-note { color: #facc15; }
      .warera-note-icon.hover-gated { display: none; }
      .warera-note-icon.hover-gated.is-visible { display: inline-flex; }
      .warera-note-backdrop {
        position: fixed; inset: 0; z-index: 2147483646;
        display: none; align-items: center; justify-content: center;
        padding: 18px; background: rgba(15,23,42,.62);
      }
      .warera-note-backdrop.is-open { display: flex; }
      .warera-note-modal {
        width: min(520px,100%); border: 1px solid rgba(148,163,184,.36);
        border-radius: 8px; background: #111827; color: #f9fafb;
        box-shadow: 0 18px 55px rgba(0,0,0,.42);
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .warera-note-header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 14px 16px;
        border-bottom: 1px solid rgba(148,163,184,.22);
      }
      .warera-note-title {
        min-width: 0; margin: 0; overflow: hidden; color: #f9fafb;
        font-size: 16px; font-weight: 650;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .warera-note-close {
        flex: 0 0 auto; width: 34px; height: 34px; border: 0;
        border-radius: 6px; background: transparent; color: #d1d5db;
        cursor: pointer; font-size: 24px; line-height: 1;
      }
      .warera-note-close:hover, .warera-note-close:focus-visible {
        background: rgba(148,163,184,.18); outline: none;
      }
      .warera-note-body { padding: 16px; }
      .warera-note-textarea {
        box-sizing: border-box; width: 100%; min-height: 180px; resize: vertical;
        border: 1px solid rgba(148,163,184,.42); border-radius: 6px;
        background: #020617; color: #f9fafb; padding: 10px 12px;
        font: 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .warera-note-textarea:focus {
        border-color: #facc15; outline: none;
        box-shadow: 0 0 0 2px rgba(250,204,21,.18);
      }
      .warera-note-actions {
        display: flex; justify-content: flex-end; gap: 8px; padding: 0 16px 16px;
      }
      .warera-note-button {
        min-height: 36px; border: 1px solid rgba(148,163,184,.42);
        border-radius: 6px; background: #1f2937; color: #f9fafb;
        cursor: pointer; padding: 0 12px;
        font: 600 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .warera-note-button:hover, .warera-note-button:focus-visible {
        border-color: #facc15; outline: none;
      }
      .warera-note-button.primary {
        border-color: #facc15; background: #facc15; color: #111827;
      }

      /* ── Battle Advisory module styles ── */
      .wia-battle-primary {
        outline: 2px solid #3fb950 !important;
        outline-offset: 2px;
        transform: scale(1.04);
        transition: transform 0.2s, outline 0.2s;
        z-index: 1;
        position: relative;
      }
      .wia-battle-muted {
        opacity: .50;
        filter: grayscale(.75);
        transform: scale(.94);
        transition: transform 0.2s, opacity 0.2s, filter 0.2s;
      }
      .wia-mu-heal-muted {
        opacity: .50;
        filter: grayscale(.75);
        transform: scale(.94);
        transition: transform 0.2s, opacity 0.2s, filter 0.2s;
      }
      .wia-compact-orders {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-left: 8px;
        vertical-align: middle;
        pointer-events: none;
      }
      .wia-compact-order-item {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .wia-compact-order-symbol {
        width: 1.1em;
        height: 1.1em;
        display: inline-block;
        vertical-align: middle;
      }
      .wia-compact-order-symbol svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .wia-compact-order-flag {
        width: 1.1em;
        height: 1.1em;
        object-fit: cover;
        border-radius: 2px;
        display: inline-block;
        vertical-align: middle;
        flex-shrink: 0;
      }

      /* ── Resource Market Intraday Graph ── */
      .wia-mkt-toggle-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 11px;
        user-select: none;
      }
      .wia-mkt-toggle-btn {
        background: #0f172a;
        border: 1px solid rgba(148,163,184,0.2);
        border-radius: 4px;
        color: #94a3b8;
        padding: 2px 6px;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.15s ease;
      }
      .wia-mkt-toggle-btn:hover {
        border-color: rgba(148,163,184,0.4);
        color: #f8fafc;
      }
      .wia-mkt-toggle-btn.wia-active {
        background: #f97316;
        border-color: #f97316;
        color: #020617;
      }
      .wia-mkt-legend {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #94a3b8;
      }
      .wia-legend-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        display: inline-block;
      }
      .wia-legend-dot.native {
        background-color: #A19638;
      }
      .wia-legend-dot.intraday {
        background-color: #f97316;
      }
      .wia-legend-text {
        margin-right: 6px;
      }
      .wia-mkt-point {
        fill: #f97316;
        transition: r 0.15s ease, opacity 0.15s ease;
        opacity: 0.6;
        cursor: pointer;
        pointer-events: auto;
      }
      .wia-mkt-point:hover {
        r: 4px;
        opacity: 1;
      }
      .wia-mkt-axis-label {
        paint-order: stroke;
        stroke: #020617;
        stroke-width: 1px;
        stroke-linecap: butt;
        stroke-linejoin: miter;
        fill: #f97316;
        font-size: 8px;
        font-family: inherit;
        pointer-events: none;
      }
      .wia-mkt-x-label {
        fill: #94a3b8;
        font-size: 8px;
        font-family: inherit;
        pointer-events: none;
      }
      .wia-mkt-line {
        pointer-events: none;
      }
      .wia-mkt-warning {
        pointer-events: none;
      }
      .wia-mkt-tooltip {
        position: absolute;
        display: none;
        z-index: 100002;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(249, 115, 22, 0.4);
        border-radius: 6px;
        padding: 6px 10px;
        color: #f8fafc;
        font-size: 11px;
        font-weight: 600;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        transition: opacity 0.15s ease;
        font-family: system-ui, -apple-system, sans-serif;
        white-space: nowrap;
      }

      /* ── Daily P&L Tracker styles ── */
      .wia-pnl-tracker {
        display: inline-flex; flex-direction: column; align-items: center; justify-content: center;
        position: relative; margin: 0 4px; top: 20px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        border-radius: 6px; padding: 2px 8px; cursor: pointer; user-select: none;
        z-index: 10000; min-height: 26px; box-sizing: border-box;
        background: rgba(13, 17, 23, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
        line-height: 1.15;
        pointer-events: auto;
      }
      .wia-pnl-tracker.is-positive {
        border-color: rgba(63, 185, 80, .55);
      }
      .wia-pnl-tracker.is-negative {
        border-color: rgba(248, 81, 73, .55);
      }
      .wia-pnl-tracker.is-neutral {
        border-color: rgba(139, 148, 158, .50);
      }
      .wia-pnl-hover {
        display: none; position: absolute; top: 100%; left: 0; margin-top: 8px;
        width: 248px; background: rgba(9, 12, 17, .82);
        backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px);
        border: 1px solid rgba(255, 255, 255, .07);
        border-radius: 8px; padding: 8px 10px; box-shadow: 0 6px 18px rgba(0, 0, 0, .55);
        color: #c9d1d9; font-weight: normal; text-align: left; font-size: 10px;
        text-shadow: none; z-index: 10001; line-height: 1.2;
        box-sizing: border-box;
      }
      .wia-pnl-hover::-webkit-scrollbar {
        width: 4px;
      }
      .wia-pnl-hover::-webkit-scrollbar-track {
        background: transparent;
      }
      .wia-pnl-hover::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 99px;
      }
      .wia-pnl-tracker:hover .wia-pnl-hover {
        display: block;
      }
      /* ===== Tour of Beers ===== */
      @keyframes wia-tour-pulse {
        0%,100% { box-shadow: 0 0 0 3px #facc15, 0 0 14px 3px rgba(250,204,21,.5),  0 0 0 9999px rgba(1,4,9,.72); }
        50%     { box-shadow: 0 0 0 3px #facc15, 0 0 26px 8px rgba(250,204,21,.85), 0 0 0 9999px rgba(1,4,9,.72); }
      }
      @keyframes wia-tour-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
      @keyframes wia-tour-in  { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .wia-tour-hole {
        position: fixed; border-radius: 8px; pointer-events: none;
        z-index: 2147483646; transition: top .18s ease, left .18s ease, width .18s ease, height .18s ease;
        box-shadow: 0 0 0 3px #facc15, 0 0 18px 4px rgba(250,204,21,.65), 0 0 0 9999px rgba(1,4,9,.72);
        animation: wia-tour-pulse 1.8s ease-in-out infinite;
      }
      .wia-tour-beer {
        position: fixed; z-index: 2147483647; width: 88px; height: auto;
        pointer-events: none; user-select: none;
        filter: drop-shadow(0 6px 10px rgba(0,0,0,.55));
        animation: wia-tour-bob 2.6s ease-in-out infinite;
      }
      .wia-tour-card {
        position: fixed; z-index: 2147483647; box-sizing: border-box;
        width: 300px; max-width: calc(100vw - 24px);
        background: #161b22; color: #c9d1d9;
        border: 1px solid #30363d; border-top: 3px solid #facc15; border-radius: 12px;
        padding: 14px 16px 12px; font: 13px/1.5 system-ui, sans-serif;
        box-shadow: 0 14px 44px rgba(0,0,0,.7);
        animation: wia-tour-in .22s ease both;
        pointer-events: none;                 /* clicks pass through to the game… */
      }
      .wia-tour-card .wia-tour-btn { pointer-events: auto; }   /* …except the tour's own buttons */
      .wia-tour-step { font: 700 10px system-ui, sans-serif; letter-spacing: .6px;
        text-transform: uppercase; color: #facc15; margin: 0 0 4px; }
      .wia-tour-title { font: 700 15px/1.3 system-ui, sans-serif; color: #f9fafb; margin: 0 0 6px; }
      .wia-tour-body  { margin: 0 0 12px; color: #c9d1d9; }
      .wia-tour-dots  { display: flex; gap: 5px; margin: 0 0 12px; }
      .wia-tour-dot   { width: 6px; height: 6px; border-radius: 50%; background: #30363d; transition: background .2s; }
      .wia-tour-dot.done   { background: #8b949e; }
      .wia-tour-dot.active { background: #facc15; box-shadow: 0 0 6px rgba(250,204,21,.8); }
      .wia-tour-actions { display: flex; align-items: center; gap: 8px; }
      .wia-tour-actions .wia-tour-spacer { flex: 1; }
      .wia-tour-btn {
        border-radius: 8px; padding: 7px 14px; font: 600 12px system-ui, sans-serif;
        cursor: pointer; border: 1px solid transparent; line-height: 1; transition: filter .15s, background .15s;
      }
      .wia-tour-btn:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
      .wia-tour-btn-primary { background: #facc15; color: #161b22; }
      .wia-tour-btn-primary:hover { filter: brightness(1.08); }
      .wia-tour-btn-ghost { background: transparent; color: #8b949e; padding: 7px 8px; }
      .wia-tour-btn-ghost:hover { color: #c9d1d9; }
      .wia-tour-btn-secondary { background: #21262d; color: #c9d1d9; border-color: #30363d; }
      .wia-tour-btn-secondary:hover { background: #30363d; }
      .wia-tour-btn[disabled] { opacity: .4; cursor: default; pointer-events: none; }
      /* Auto-prompt (bottom-left, below an active tour) */
      .wia-tour-prompt {
        position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; box-sizing: border-box;
        width: 320px; max-width: calc(100vw - 24px);
        background: #161b22; color: #c9d1d9; border: 1px solid #30363d; border-left: 3px solid #facc15;
        border-radius: 12px; padding: 12px 14px; box-shadow: 0 12px 34px rgba(0,0,0,.6);
        display: flex; gap: 12px; align-items: flex-start; font: 13px/1.45 system-ui, sans-serif;
        animation: wia-tour-in .24s ease both;
      }
      .wia-tour-prompt img { width: 46px; height: auto; flex: none; filter: drop-shadow(0 3px 5px rgba(0,0,0,.5)); }
      .wia-tour-prompt-title { font: 700 14px system-ui, sans-serif; color: #f9fafb; margin: 0 0 3px; }
      .wia-tour-prompt-body  { margin: 0 0 10px; color: #8b949e; font-size: 12px; }
      .wia-tour-prompt-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .wia-tour-prompt-never { background: none; border: 0; color: #6e7681; font-size: 11px; cursor: pointer; padding: 4px 2px; text-decoration: underline; }
      .wia-tour-prompt-never:hover { color: #8b949e; }
      .wia-tour-paste { margin: 0 0 10px; }

      /* ── Troop Radar Responsive & Custom Baseline ── */
      .wia-troop-radar-container {
        container-type: inline-size;
        width: 100%;
      }
      .wia-tr-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-top: 10px;
      }
      .wia-tr-grid > div,
      .wia-tr-grid > button {
        background: #0d1117;
        border: 1px solid #21262d;
        border-radius: 6px;
        padding: 8px;
        text-align: center;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        box-sizing: border-box;
      }

      .wia-tr-grid .wia-tr-tile .num {
        font-size: 16px;
        font-weight: 700;
        color: #f8fafc;
        font-variant-numeric: tabular-nums;
        line-height: 1.05;
      }
      .wia-tr-grid .wia-tr-tile .lab {
        font-size: 9px;
        font-weight: 700;
        color: #8b949e;
        text-transform: uppercase;
        margin-top: 1px;
        letter-spacing: 0.02em;
      }
      .wia-tr-grid .wia-tr-tile .sub {
        font-size: 8px;
        color: #6e7681;
        margin-top: 3px;
        font-variant-numeric: tabular-nums;
        min-height: 1em;
      }

      /* H&H Tile Layouts */
      .tr-hh-wide {
        display: flex;
        gap: 8px;
        justify-content: center;
        align-items: center;
      }
      .tr-hh-row {
        display: flex;
        align-items: center;
        gap: 3px;
        font-size: 13px;
        font-weight: 700;
        color: #f8fafc;
      }
      .tr-hh-row .ico {
        font-size: 11px;
      }
      .tr-hh-narrow {
        font-size: 16px;
        font-weight: 700;
        color: #f8fafc;
        line-height: 1.05;
      }

      /* Hidden by default (wide layout) */
      .wia-tr-hh-tile .tr-hh-narrow,
      .wia-tr-hh-tile .tr-hh-lbl-narrow {
        display: none;
      }
      .wia-tr-hh-tile .tr-hh-wide {
        display: flex;
      }
      .wia-tr-hh-tile .tr-hh-lbl-wide {
        display: block;
      }
      .wia-troop-chips .lh-badge {
        display: none;
      }
      .wia-troop-chips .hp-badge,
      .wia-troop-chips .hunger-badge {
        display: inline-flex;
      }
      .wia-troop-chips .pill-txt-short {
        display: none;
      }
      .wia-troop-chips .pill-txt-long {
        display: inline;
      }
      .wia-troop-chips .build-pct {
        display: inline;
      }

      @container (max-width: 640px) {
        .wia-tr-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @container (max-width: 480px) {
        .wia-tr-hh-tile .tr-hh-wide,
        .wia-tr-hh-tile .tr-hh-lbl-wide {
          display: none;
        }
        .wia-tr-hh-tile .tr-hh-narrow {
          display: block;
        }
        .wia-tr-hh-tile .tr-hh-lbl-narrow {
          display: block;
        }

        .wia-troop-chips .hp-badge,
        .wia-troop-chips .hunger-badge {
          display: none;
        }
        .wia-troop-chips .lh-badge {
          display: inline-flex;
        }
        .wia-troop-chips .pill-txt-long {
          display: none;
        }
        .wia-troop-chips .pill-txt-short {
          display: inline;
        }
        .wia-troop-chips .build-pct {
          display: none;
        }
      }

      /* Damage potential tile */
      .wia-dmg-tile {
        all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column;
        align-items: center; justify-content: center; border-radius: 6px; padding: 6px 8px 8px;
        text-align: center; position: relative; transition: border-color .18s, background .18s, box-shadow .18s;
      }
      .wia-dmg-tile[data-mode="tag"] {
        --acc: #f0a54a;
        border: 1px solid #3a2d18;
        background: linear-gradient(180deg, #17130b, #0d1117);
      }
      .wia-dmg-tile[data-mode="live"] {
        --acc: #4fd1e0;
        border: 1px solid #123037;
        background: linear-gradient(180deg, #0a1a1e, #0d1117);
      }
      .wia-dmg-tile:hover {
        box-shadow: 0 0 0 1px var(--acc), 0 4px 14px rgba(0,0,0,.35);
      }
      .wia-dmg-tile:focus-visible {
        outline: 2px solid var(--acc); outline-offset: 2px;
      }
      .wia-dmg-tile .chip {
        display: inline-flex; align-items: center; gap: 3px; font-size: 8px; font-weight: 800;
        letter-spacing: .05em; text-transform: uppercase; color: var(--acc); margin-bottom: 2px;
      }
      .wia-dmg-tile .chip .caret { opacity: .7; font-size: 9px; }
      .wia-dmg-tile .num { font-size: 16px; font-weight: 800; color: var(--acc); font-variant-numeric: tabular-nums; line-height: 1.05; }
      .wia-dmg-tile .lab { font-size: 9px; font-weight: 700; color: var(--acc); opacity: .85; text-transform: uppercase; margin-top: 1px; letter-spacing: .02em; }
      .wia-dmg-tile .sublab { font-size: 8px; color: #8b949e; margin-top: 3px; font-variant-numeric: tabular-nums; }

      /* Badges & modal setup */
      .wia-edit-badge {
        all: unset; position: absolute; top: 3px; left: 3px; cursor: pointer; width: 19px; height: 19px; border-radius: 5px;
        display: flex; align-items: center; justify-content: center; color: var(--acc); background: rgba(240, 165, 74, .10);
        border: 1px solid rgba(240, 165, 74, .28); transition: background .15s, transform .12s;
      }
      .wia-edit-badge:hover { background: rgba(240, 165, 74, .22); transform: scale(1.08); }
      .wia-edit-badge:focus-visible { outline: 2px solid var(--acc); outline-offset: 1px; }
      .wia-edit-badge svg { width: 12px; height: 12px; display: block; }
      .wia-edit-badge .pen { position: absolute; right: -3px; bottom: -3px; font-size: 8px; line-height: 1; background: #0d1117; border-radius: 50%; padding: 1px 1px 0; color: var(--acc); }

      .wia-live-horizon-badge {
        all: unset; position: absolute; top: 3px; left: 3px; cursor: pointer; width: 19px; height: 19px; border-radius: 5px;
        display: flex; align-items: center; justify-content: center; color: var(--acc); background: rgba(79, 209, 224, 0.10);
        border: 1px solid rgba(79, 209, 224, 0.28); transition: background .15s, transform .12s;
      }
      .wia-live-horizon-badge:hover { background: rgba(79, 209, 224, 0.22); transform: scale(1.08); }
      .wia-live-horizon-badge:focus-visible { outline: 2px solid var(--acc); outline-offset: 1px; }
      .wia-live-horizon-badge .clock { font-size: 11px; }

      .wia-dmg-tile[data-mode="tag"] .wia-live-horizon-badge { display: none; }
      .wia-dmg-tile[data-mode="live"] .wia-edit-badge { display: none; }

      /* Member Chips (wia-troop-chips) */
      .wia-troop-chips {
        display: inline-flex;
        align-items: center;
        gap: 0.55em;
        margin-left: 0.7em;
        font-size: clamp(7px, 2.4cqi, 12px);
        vertical-align: middle;
        flex-wrap: wrap;
      }
      .wia-troop-chip {
        padding: 2px 8px;
        border-radius: 12px;
        font-weight: 600;
        line-height: 1.2;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        box-sizing: border-box;
      }
      .wia-troop-chip.build-war {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.4);
        color: #fca5a5;
      }
      .wia-troop-chip.build-hybrid {
        background: rgba(99, 102, 241, 0.15);
        border: 1px solid rgba(99, 102, 241, 0.4);
        color: #c7d2fe;
      }
      .wia-troop-chip.build-eco {
        background: rgba(100, 116, 139, 0.15);
        border: 1px solid rgba(100, 116, 139, 0.4);
        color: #cbd5e1;
      }
      .wia-troop-chip.hp-badge,
      .wia-troop-chip.hunger-badge,
      .wia-troop-chip.lh-badge {
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid #334155;
      }
      .hp-heart { color: #ef4444; font-size: 10px; }
      .hunger-steak { font-size: 10px; }
      .lh-lbl { color: #eab308; font-weight: 700; font-size: 10px; }
      .hp-track,
      .hunger-track,
      .lh-track {
        width: 44px;
        height: 5px;
        background: #334155;
        border-radius: 3px;
        overflow: hidden;
        display: inline-block;
      }
      .hp-fill,
      .hunger-fill,
      .lh-fill {
        display: block;
        height: 100%;
        transition: width 0.2s;
      }
      .hp-val,
      .hunger-val,
      .lh-val {
        font-size: 10px;
        font-family: monospace;
        color: #cbd5e1;
      }
      .wia-troop-chip.pill-on {
        background: rgba(34, 197, 94, 0.15);
        border: 1px solid rgba(34, 197, 94, 0.4);
        color: #86efac;
      }
      .wia-troop-chip.pill-debuff {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.4);
        color: #fca5a5;
      }
      .wia-troop-chip.pill-ready {
        background: rgba(234, 179, 8, 0.15);
        border: 1px solid rgba(234, 179, 8, 0.5);
        color: #fef08a;
      }
      .wia-troop-chip.pill-off {
        background: rgba(100, 116, 139, 0.15);
        border: 1px solid rgba(100, 116, 139, 0.3);
        color: #94a3b8;
      }
      .wia-troop-chip.dmg-chip.dmg-tag {
        background: rgba(240, 165, 74, 0.15);
        border: 1px solid rgba(240, 165, 74, 0.4);
        color: #f0a54a;
      }
      .wia-troop-chip.dmg-chip.dmg-live {
        background: rgba(79, 209, 224, 0.15);
        border: 1px solid rgba(79, 209, 224, 0.4);
        color: #4fd1e0;
      }
      .wia-troop-chip.dmg-chip.dmg-degraded {
        background: rgba(100, 116, 139, 0.15);
        border: 1px solid rgba(100, 116, 139, 0.3);
        color: #94a3b8;
      }

      .wia-mask-ov { position: fixed; inset: 0; background: rgba(1, 4, 9, 0.72); display: none; align-items: center; justify-content: center; padding: 10px; z-index: 2147483610; }
      .wia-mask-ov.wia-open { display: flex; }
      .wia-mask { width: 440px; max-width: 100%; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 13px; box-shadow: 0 12px 34px rgba(0,0,0,.5); text-align: left; }
      .wia-mask h3 { margin: 0 0 3px; font-size: 13px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 6px; }
      .wia-mask .wia-mhint { font-size: 10.5px; color: #8b949e; margin: 0 0 8px; text-align: left; }
      .wia-mask textarea { width: 100%; height: 150px; resize: vertical; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.5; padding: 8px 10px; tab-size: 2; }
      .wia-mask textarea:focus { outline: none; border-color: #7c3aed; }
      .wia-mask textarea.wia-err { border-color: #f2495c; }

      .wia-cheat { margin: 8px 0 2px; border: 1px solid #21262d; border-radius: 6px; background: #0d1117; text-align: left; }
      .wia-cheat summary { cursor: pointer; font-size: 10.5px; color: #8b949e; padding: 6px 10px; list-style: none; outline: none; }
      .wia-cheat summary::-webkit-details-marker { display: none; }
      .wia-cheat summary::before { content: "▸ "; color: #6e7681; }
      .wia-cheat[open] summary::before { content: "▾ "; }
      .wia-cheat-body { padding: 0 10px 8px; overflow-x: auto; }
      .wia-cheat-body table { border-collapse: collapse; font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #8b949e; white-space: nowrap; width: 100%; }
      .wia-cheat-body td, .wia-cheat-body th { padding: 2px 8px 2px 0; text-align: left; }
      .wia-cheat-body th { color: #6e7681; font-weight: 600; }
      .wia-cheat-body td:first-child { color: #c9d1d9; }
      .wia-cheat-body .wia-t3 { color: #4fd1e0; }

      .wia-mask-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
      .wia-mask-actions .wia-spacer { flex: 1; }

      .wia-btn { all: unset; cursor: pointer; font-size: 11.5px; font-weight: 600; padding: 6px 12px; border-radius: 6px; line-height: 1; transition: background .15s, border-color .15s; box-sizing: border-box; display: inline-block; text-align: center; }
      .wia-btn:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
      .wia-btn-save { background: #238636; color: #fff; }
      .wia-btn-save:hover { background: #2ea043; }
      .wia-btn-ghost { color: #8b949e; border: 1px solid #30363d; }
      .wia-btn-ghost:hover { color: #f8fafc; border-color: #8b949e; }
      .wia-btn-reset { color: #d29922; border: 1px solid #3a2d18; }
      .wia-btn-reset:hover { background: #17130b; }

      .wia-toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%) translateY(8px); background: #0d1117; border: 1px solid #30363d; color: #e6edf3; font-size: 11.5px; padding: 7px 12px; border-radius: 6px; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 2147483620; box-shadow: 0 6px 20px rgba(0,0,0,.5); white-space: nowrap; }
      .wia-toast.wia-show { opacity: 1; transform: translateX(-50%) translateY(0); }
      .wia-toast.wia-ok { border-color: #238636; }
      .wia-toast.wia-warn { border-color: #f2495c; color: #ffb3ba; }

      /* ── User-Profile Charakterbogen-Strip (#63) ── */
      .wia-charsheet { position: relative; padding: 12px 14px; border-bottom: 1px solid #1c2128; font-family: system-ui, -apple-system, sans-serif; background: linear-gradient(180deg, color-mix(in srgb, var(--cls, #8b949e) 7%, #0d1117), #0d1117); }
      .wia-charsheet .wia-cs-badge { position: absolute; top: 9px; right: 12px; border: 1px solid #7c3aed; color: #a78bfa; font-size: 9px; font-weight: 700; letter-spacing: .5px; padding: 1px 6px; border-radius: 4px; }
      .wia-charsheet .wia-cs-title { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 0 0 11px; }
      .wia-charsheet .wia-cs-word { font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif; font-size: 21px; font-weight: 800; letter-spacing: 3.5px; text-transform: uppercase; color: var(--cls, #d8c9a0); text-shadow: 0 1px 0 rgba(0,0,0,.6), 0 0 14px color-mix(in srgb, var(--cls, #8b949e) 45%, transparent); }
      .wia-charsheet .wia-cs-rune { color: var(--cls, #8b949e); opacity: .65; font-size: 14px; }
      .wia-charsheet .wia-cs-share { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #b6b09a; }
      .wia-charsheet .wia-cs-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .wia-charsheet .wia-cs-bar { display: flex; height: 36px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
      .wia-charsheet .wia-cs-bar .ico { width: 40px; flex: none; display: flex; align-items: center; justify-content: center; font-size: 16px; }
      .wia-charsheet .wia-cs-bar .track { position: relative; flex-grow: 1; display: flex; align-items: center; overflow: hidden; }
      .wia-charsheet .wia-cs-bar .fill { position: absolute; left: 0; top: 0; bottom: 0; transition: width .35s ease; background-image: linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,0) 60%); }
      .wia-charsheet .wia-cs-bar .lbl { position: relative; z-index: 2; font-size: 12px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; padding-left: 11px; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
      .wia-charsheet .wia-cs-bar .val { position: relative; z-index: 2; margin-left: auto; padding-right: 11px; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
      .wia-charsheet .wia-cs-bar.hp { background: #1c2a1a; }
      .wia-charsheet .wia-cs-bar.hp .ico { background: #3f5130; color: #d7f0c4; }
      .wia-charsheet .wia-cs-bar.hp .track { background: #22331d; }
      .wia-charsheet .wia-cs-bar.hp .fill { background: #5aa152; }
      .wia-charsheet .wia-cs-bar.hp .lbl, .wia-charsheet .wia-cs-bar.hp .val { color: #eafbe2; }
      .wia-charsheet .wia-cs-bar.hu { background: #2a1f12; }
      .wia-charsheet .wia-cs-bar.hu .ico { background: #5a4320; color: #f5dfae; }
      .wia-charsheet .wia-cs-bar.hu .track { background: #2f2413; }
      .wia-charsheet .wia-cs-bar.hu .fill { background: #c1842b; }
      .wia-charsheet .wia-cs-bar.hu .lbl, .wia-charsheet .wia-cs-bar.hu .val { color: #fbeeda; }
      @media (max-width: 480px) { .wia-charsheet .wia-cs-bars { grid-template-columns: 1fr; } }
    `);
  }

  function updateStatusIndicator() {
    const dot = document.querySelector('.wia-gear-dot');
    const gear = document.querySelector('.wia-gear');
    if (!dot || !gear) return;
    const s = cacheStatus();
    const color = isRateLimited() ? '#f85149' : s.stale ? '#d29922' : '#3fb950';
    dot.style.background = color;

    const icon = gear.querySelector('.wia-gear-icon');
    const remote = GM_getValue(KEYS.latestKnownVersion, '');
    const current = SCRIPT_VERSION;
    const updateAvailable = remote && isNewer(remote, current);

    if (updateAvailable) {
      if (icon) icon.textContent = '🔄';
      gear.classList.add('wia-gear-update-alert');
    } else {
      if (icon) icon.textContent = '⚙';
      gear.classList.remove('wia-gear-update-alert');
    }

    const titleLines = [
      t('gearTooltipTitle'),
      t('gearTooltipScrapPrice', { price: fmt(s.scrapPrice), age: ageLabel(s.scrapFetchedAt) }),
      t('gearTooltipItemPrices', { count: s.priceCount, age: ageLabel(s.priceFetchedAt) }),
      t('gearTooltipTxHistory', { count: s.txCodes || 0 })
    ];
    if (isRateLimited()) {
      const waitSec = Math.ceil(rateLimitRemainingMs() / 1000);
      titleLines.push(`⚠ ${t('gearTooltipRateLimited', { sec: waitSec })}`);
    }
    gear.title = titleLines.join('\n');
  }



  let warnBanner = null;
  function renderRateLimitBanner() {
    updateStatusIndicator();
    if (!warnBanner) return;
    if (isRateLimited()) {
      const sec = Math.ceil(rateLimitRemainingMs() / 1000);
      warnBanner.style.display = 'block';
      warnBanner.textContent = t('rateLimitBanner', { sec: sec });
    } else {
      const remote = GM_getValue(KEYS.latestKnownVersion, '');
      const current = SCRIPT_VERSION;
      if (remote && isNewer(remote, current)) {
        const cleanRemote = String(remote).replace(/[^\w.-]/g, '');
        warnBanner.style.display = 'block';
        warnBanner.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;">
            <div style="flex: 1; min-width: 0; text-align: left;">
              <strong>${t('updateAvailableTitle', { ver: cleanRemote })}</strong>
              <div style="font-size: 11px; font-weight: normal; margin-top: 2px; line-height: 1.3;">
                ${t('updateAvailableBodyShort')}
                <a href="https://greasyfork.org/de/scripts/583766-prost" target="_blank" style="color: #ffce91; text-decoration: underline; margin-left: 4px;">Changelog</a>
              </div>
            </div>
            <button type="button" class="wia-direct-update-btn" style="flex: 0 0 auto; font-size: 12px; padding: 6px 12px; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; height: 30px; font-weight: bold; cursor: pointer; background: #238636; border: 1px solid #2ea043; color: #fff; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,.4);">
              🔄 ${t('directUpdateLink')}
            </button>
          </div>`;
        const directBtn = warnBanner.querySelector('.wia-direct-update-btn');
        if (directBtn) {
          directBtn.onclick = () => {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('wia-update-pending', 'true');
            }
            window.open('https://update.greasyfork.org/scripts/583766/PROST.user.js', '_blank');
          };
        }
      } else {
        warnBanner.style.display = 'none';
        warnBanner.innerHTML = '';
      }
    }
  }

  function isFeatNew(featId) {
    const introVer = CONFIG[featId + 'IntroducedIn'];
    if (!introVer) return false;
    let baseline = GM_getValue(KEYS.baselineVersion, null);
    if (!baseline) {
      baseline = SCRIPT_VERSION;
      GM_setValue(KEYS.baselineVersion, baseline);
    }
    if (isNewer(introVer, baseline)) {
      const seen = GM_getValue(KEYS.seenFeatures, []);
      if (!seen.includes(featId)) return true;
    }
    return false;
  }

  function markFeatSeen(featId, element) {
    if (!isFeatNew(featId)) return;
    const seen = GM_getValue(KEYS.seenFeatures, []);
    if (!seen.includes(featId)) {
      seen.push(featId);
      GM_setValue(KEYS.seenFeatures, seen);
    }
    if (element) {
      const badge = element.closest('.wia-feat-row')?.querySelector('.wia-new-badge');
      if (badge) badge.remove();
    }
  }

  function renderFeatLabel(featId, labelText) {
    if (isFeatNew(featId)) {
      return `${labelText} <span class="wia-new-badge" style="background: #eab308; color: #422006; font-size: 9px; font-weight: bold; padding: 1px 4px; border-radius: 4px; margin-left: 6px;">${t('settingsNewBadge') || 'NEW'}</span>`;
    }
    return labelText;
  }

  function renderSettingsModal(bg) {
    if (!bg) return;
    const currentLocale = getLocale();
    const nextLocale = currentLocale === 'de' ? 'en' : 'de';
    const prevToken = bg.querySelector('.wia-token')?.value ?? getToken();
    const hasKey = !!prevToken.trim();
    const prevFeatNotes = bg.querySelector('.wia-feat-notes')?.checked ?? CONFIG.featNotes;
    const prevFeatScratchpad = bg.querySelector('.wia-feat-scratchpad')?.checked ?? CONFIG.featScratchpad;
    const prevFeatBattle = bg.querySelector('.wia-feat-battle')?.checked ?? CONFIG.featBattleAdvisor;
    const prevFeatPill = bg.querySelector('.wia-feat-pill')?.checked ?? CONFIG.featPillReminder;
    const prevFeatMuHealDim = bg.querySelector('.wia-feat-mu-heal-dim')?.checked ?? CONFIG.featMuHealDim;
    const prevFeatMarketGraph = bg.querySelector('.wia-feat-market-graph')?.checked ?? CONFIG.featMarketGraph;
    const prevFeatPnlTracker = bg.querySelector('.wia-feat-pnl-tracker')?.checked ?? CONFIG.featPnlTracker;
    const prevFeatItemAdvisor = bg.querySelector('.wia-feat-item-advisor')?.checked ?? CONFIG.featItemAdvisor;
    const prevFeatEquipSellCalc = bg.querySelector('.wia-feat-equip-sell-calc')?.checked ?? CONFIG.featEquipSellCalc;
    const prevFeatCraftingAdvisor = bg.querySelector('.wia-feat-crafting-advisor')?.checked ?? CONFIG.featCraftingAdvisor;
    const prevFeatCompanyEco = bg.querySelector('.wia-feat-company-eco')?.checked ?? CONFIG.featCompanyEco;
    const prevFeatAlertCompanyStorage = bg.querySelector('.wia-feat-alert-company-storage')?.checked ?? CONFIG.featAlertCompanyStorage;
    const prevFeatAlertCompanyBonus = bg.querySelector('.wia-feat-alert-company-bonus')?.checked ?? CONFIG.featAlertCompanyBonus;
    const prevFeatAlertCompanyTax = bg.querySelector('.wia-feat-alert-company-tax')?.checked ?? CONFIG.featAlertCompanyTax;
    const prevFeatAlertCompanyDeposit = bg.querySelector('.wia-feat-alert-company-deposit')?.checked ?? CONFIG.featAlertCompanyDeposit;
    const prevFeatBetterRegion = bg.querySelector('.wia-feat-better-region')?.checked ?? CONFIG.featBetterRegion;
    const prevFeatOrderRadar = bg.querySelector('.wia-feat-order-radar')?.checked ?? CONFIG.featOrderRadar;
    const prevFeatTroopRadar = bg.querySelector('.wia-feat-troop-radar')?.checked ?? CONFIG.featTroopRadar;
    const prevFeatProfileCharsheet = bg.querySelector('.wia-feat-profile-charsheet')?.checked ?? CONFIG.featProfileCharsheet;
    const prevPillBuff = bg.querySelector('.wia-pill-buff')?.value ?? CONFIG.pillBuffH;
    const prevPillKnife = bg.querySelector('.wia-pill-knife')?.value ?? CONFIG.pillKnifeH;
    const prevPillDebuff = bg.querySelector('.wia-pill-debuff')?.value ?? CONFIG.pillDebuffH;
    const prevPillPrefFrom = bg.querySelector('.wia-pill-pref-from')?.value ?? CONFIG.pillPrefWindowFrom;
    const prevPillPrefTo = bg.querySelector('.wia-pill-pref-to')?.value ?? CONFIG.pillPrefWindowTo;
    const prevPillNotifHnH = bg.querySelector('.wia-feat-pill-notif-hnh')?.checked ?? CONFIG.featPillNotifHnH;
    const prevPillNotifWindow = bg.querySelector('.wia-feat-pill-notif-window')?.checked ?? CONFIG.featPillNotifWindow;
    const prevPillNotifDebuff = bg.querySelector('.wia-feat-pill-notif-debuff')?.checked ?? CONFIG.featPillNotifDebuff;
    const prevStockKeepCount = bg.querySelector('.wia-stock-keep-count')?.value ?? CONFIG.stockKeepCount;
    const prevFeatBounty = bg.querySelector('.wia-feat-bounty')?.checked ?? CONFIG.featBountyNotify;
    const prevFeatBountyNotif = CONFIG.featBountyNotif;
    const prevBountyOwn = !hasKey ? '' : (bg.querySelector('.wia-bounty-own')?.value ?? CONFIG.bountyOwnCountryOverride);
    const prevBountyScope = !hasKey ? 'all' : (bg.querySelector('.wia-bounty-scope')?.value ?? CONFIG.bountyScope);
    const prevBountyMuteDebuff = bg.querySelector('.wia-bounty-mute-debuff')?.checked ?? CONFIG.bountyMuteDebuff;
    const prevFeatSystemAlerts = bg.querySelector('.wia-feat-system-alerts')?.checked ?? CONFIG.featSystemAlerts;

    const prevPersonalTopic = bg.querySelector('.wia-personal-topic')?.value ?? CONFIG.personalTopic;
    const prevPersonalSecret = bg.querySelector('.wia-personal-secret')?.value ?? CONFIG.personalTopicSecret;
    const defaultPersonalTopic = 'wia-user-' + (getCurrentUserId() || 'unknown');
    const resolvedPersonalTopic = prevPersonalTopic.trim() || defaultPersonalTopic;
    const resolvedPersonalSecret = prevPersonalSecret.trim();
    const effectivePersonalTopic = resolvedPersonalSecret ? `${resolvedPersonalTopic}-${resolvedPersonalSecret}` : resolvedPersonalTopic;
    const personalTopicUrl = `${NTFY_BASE}/${effectivePersonalTopic}`;

    bg.innerHTML = `
      <div class="wia-modal">
        <div class="wia-modal-topbar">
          <div class="wia-modal-titlewrap">
            <h2>${t('settingsTitle')} <span style="font-size: 10px; font-weight: normal; color: #8b949e; background: #21262d; padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-left: 6px;">v${SCRIPT_VERSION}</span></h2>
            <div style="font-size: 12px; color: #8b949e; margin-top: 4px; line-height: 1.4;">${t('settingsDesc')}</div>
          </div>
          <div class="wia-locale-wrap">
            <button type="button" class="wia-locale-btn" title="${localeMenuLabel(currentLocale)}" aria-label="${localeMenuLabel(currentLocale)}">${localeFlag(currentLocale)}</button>
            <div class="wia-locale-menu">
              <button type="button" class="wia-locale-item" data-locale="${nextLocale}" aria-label="${localeMenuLabel(nextLocale)}">${localeFlag(nextLocale)} <span>${localeMenuLabel(nextLocale)}</span></button>
            </div>
          </div>
        </div>
        <div class="wia-warn" style="display:none"></div>
        <label>${t('settingsApiToken')}</label>
        <input type="password" class="wia-token" placeholder="${t('settingsTokenPlaceholder')}" />
        <div class="wia-note">${t('settingsTokenNote')}</div>
        <div class="wia-token-help" style="font-size: 11px; color: #8b949e; border: 1px dashed rgba(148,163,184,0.3); border-radius: 4px; padding: 8px; margin-top: 6px; line-height: 1.4; display: none;">
          ${t('settingsTokenHelpText')}
        </div>
        <button type="button" class="wia-tour-launch wia-tour-btn wia-tour-btn-secondary" style="margin-top: 8px; width: 100%;">${t('tourSettingsBtn')}</button>
        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #8b949e; border-bottom: 1px solid rgba(148,163,184,.15); padding-bottom: 4px; margin-bottom: 8px; margin-top: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
          <span>${t('settingsHeaderFeature')}</span>
          <span style="margin-right: 4px;">${t('settingsHeaderNotif')}</span>
        </div>
        <details class="wia-category-war" style="margin-top: 10px; border-top: 1px solid rgba(148,163,184,.15); padding-top: 10px;">
          <summary style="font-size: 12px; color: #c9d1d9; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
            ${t('settingsCategoryWar')}
          </summary>
          <div class="wia-feat-row" data-feat-id="featBattle" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-battle" style="width: auto;" ${prevFeatBattle ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatBattleCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatBattleHint')}</div>
            <details class="wia-battle-settings-row" style="margin-top: 6px; margin-left: 24px;" ${prevFeatBattle ? 'open' : ''}>
              <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
                ${t('settingsBattleSettingsLabel')}
              </summary>
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <input type="checkbox" class="wia-feat-order-radar" style="width: auto;" ${prevFeatOrderRadar ? 'checked' : ''} />
                <label style="margin: 0; font-weight: normal; cursor: pointer; font-size: 11px;">${t('settingsFeatOrderRadarCheckbox')}</label>
                <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
              </div>
              <div class="wia-hint" hidden>${t('settingsFeatOrderRadarHint')}</div>
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
                <input type="checkbox" class="wia-feat-troop-radar" style="width: auto;" ${prevFeatTroopRadar ? 'checked' : ''} />
                <label style="margin: 0; font-weight: normal; cursor: pointer; font-size: 11px;">${t('settingsFeatTroopRadarCheckbox')}</label>
                <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
              </div>
              <div class="wia-hint" hidden>${t('settingsFeatTroopRadarHint')}</div>
            </details>
          </div>
          <div class="wia-feat-row" data-feat-id="featProfileCharsheet" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-profile-charsheet" style="width: auto;" ${prevFeatProfileCharsheet ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatProfileCharsheetCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatProfileCharsheetHint')}</div>
          </div>
          <div class="wia-feat-row" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="wia-feat-pill" style="width: auto;" ${prevFeatPill ? 'checked' : ''} />
                <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatPillCheckbox')}</label>
                <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
              </div>
              <input type="checkbox" class="wia-feat-pill-notif" style="width: auto; margin-right: 8px;" ${(prevPillNotifHnH || prevPillNotifWindow || prevPillNotifDebuff) ? 'checked' : ''} />
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatPillHint')}</div>
            <details class="wia-pill-settings-row" style="margin-top: 6px; margin-left: 24px;">
              <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
                ${t('settingsPillSettingsLabel')}
              </summary>
              <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 6px; margin-top: 4px;">
                <div style="flex: 1; min-width: 80px;">
                  <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsPillBuffLabel')}</label>
                  <input type="number" step="0.1" class="wia-pill-buff" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevPillBuff}" />
                </div>
                <div style="flex: 1; min-width: 80px;">
                  <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsPillKnifeLabel')}</label>
                  <input type="number" step="0.1" class="wia-pill-knife" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevPillKnife}" />
                </div>
                <div style="flex: 1; min-width: 80px;">
                  <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsPillDebuffLabel')}</label>
                  <input type="number" step="0.1" class="wia-pill-debuff" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevPillDebuff}" />
                </div>
              </div>
              <div style="display: flex; gap: 12px;">
                <div style="flex: 1;">
                  <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsPillPrefFromLabel')}</label>
                  <input type="text" class="wia-pill-pref-from" placeholder="19:00" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevPillPrefFrom}" />
                </div>
                <div style="flex: 1;">
                  <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsPillPrefToLabel')}</label>
                  <input type="text" class="wia-pill-pref-to" placeholder="20:00" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevPillPrefTo}" />
                </div>
              </div>
              <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                  <label style="margin: 0; font-weight: normal; cursor: pointer; font-size: 11px;">${t('settingsFeatPillNotifHnH')}</label>
                  <input type="checkbox" class="wia-feat-pill-notif-hnh" style="width: auto; margin-right: 8px;" ${prevPillNotifHnH ? 'checked' : ''} />
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                  <label style="margin: 0; font-weight: normal; cursor: pointer; font-size: 11px;">${t('settingsFeatPillNotifWindow')}</label>
                  <input type="checkbox" class="wia-feat-pill-notif-window" style="width: auto; margin-right: 8px;" ${prevPillNotifWindow ? 'checked' : ''} />
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                  <label style="margin: 0; font-weight: normal; cursor: pointer; font-size: 11px;">${t('settingsFeatPillNotifDebuff')}</label>
                  <input type="checkbox" class="wia-feat-pill-notif-debuff" style="width: auto; margin-right: 8px;" ${prevPillNotifDebuff ? 'checked' : ''} />
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                  <label style="margin: 0; font-weight: normal; cursor: pointer; font-size: 11px;">${t('settingsFeatMuHealDim')}</label>
                  <input type="checkbox" class="wia-feat-mu-heal-dim" style="width: auto; margin-right: 8px;" ${prevFeatMuHealDim ? 'checked' : ''} />
                </div>
              </div>
            </details>
          </div>
          <div class="wia-feat-row" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="wia-feat-bounty" style="width: auto;" ${prevFeatBounty ? 'checked' : ''} />
                <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatBounty')}</label>
              </div>
              <input type="checkbox" class="wia-feat-bounty-notif" style="width: auto; margin-right: 8px;" ${prevFeatBountyNotif ? 'checked' : ''} />
            </div>
            <details class="wia-bounty-settings-row" style="margin-top: 6px; margin-left: 24px;">
              <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
                Bounty Options
              </summary>
              <div style="margin-top: 4px;">
                <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsBountyScope')}</label>
                <select class="wia-bounty-scope" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px; outline: none; cursor: pointer;">
                  <option value="cascade" ${!hasKey ? 'disabled' : ''} ${prevBountyScope === 'cascade' ? 'selected' : ''}>${t('bountyScopeCascade')}${!hasKey ? ' (' + t('apiKeyRequiredSuffix') + ')' : ''}</option>
                  <option value="allies" ${!hasKey ? 'disabled' : ''} ${prevBountyScope === 'allies' ? 'selected' : ''}>${t('bountyScopeAllies')}${!hasKey ? ' (' + t('apiKeyRequiredSuffix') + ')' : ''}</option>
                  <option value="all" ${prevBountyScope === 'all' ? 'selected' : ''}>${t('bountyScopeAll')}</option>
                </select>
              </div>
              <div style="margin-top: 4px;">
                <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsBountyOwnCountry')}</label>
                <input type="text" class="wia-bounty-own" placeholder="name or id,id,id..." ${!hasKey ? 'disabled style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px; opacity: 0.5; cursor: not-allowed;"' : 'style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;"'} value="${prevBountyOwn}" />
                <div class="wia-bounty-detected-identity" style="font-size: 10px; color: #8b949e; margin-top: 2px;">Erkenne Identität...</div>
              </div>
              <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="wia-bounty-mute-debuff" style="width: auto;" ${prevBountyMuteDebuff ? 'checked' : ''} />
                <label style="font-size: 11px; color: #8b949e; margin: 0; font-weight: normal; cursor: pointer;">${t('settingsBountyMuteDebuff')}</label>
              </div>
            </details>
          </div>
        </details>
        <details class="wia-category-eco" style="margin-top: 10px; border-top: 1px solid rgba(148,163,184,.15); padding-top: 10px;">
          <summary style="font-size: 12px; color: #c9d1d9; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
            ${t('settingsCategoryEco')}
          </summary>
          <div class="wia-feat-row" data-feat-id="featItemAdvisor" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-item-advisor" style="width: auto;" ${prevFeatItemAdvisor ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatItemAdvisorCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatItemAdvisorHint')}</div>
            <details class="wia-advisor-settings" style="margin-top: 6px; margin-left: 24px;">
              <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
                🔧 ${t('settingsAdvisorSettingsLabel')}
              </summary>
              <div style="margin-top: 4px;">
                <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsStockKeepCountLabel')}</label>
                <input type="number" min="1" max="10" class="wia-stock-keep-count" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevStockKeepCount}" />
                <div style="font-size: 10px; color: #8b949e; margin-top: 2px;">${t('settingsStockKeepCountSub')}</div>
              </div>
            </details>
          </div>
          <div class="wia-feat-row" data-feat-id="featCraftingAdvisor" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-crafting-advisor" style="width: auto;" ${prevFeatCraftingAdvisor ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatCraftingAdvisorCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatCraftingAdvisorHint')}</div>
          </div>
          <div class="wia-feat-row" style="margin-top: 6px;" data-feat-id="featEquipSellCalc">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-equip-sell-calc" style="width: auto;" ${prevFeatEquipSellCalc ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${renderFeatLabel('featEquipSellCalc', t('equipSellCalcTitle') || 'Equipment Price Calculator')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatEquipSellCalcHint')}</div>
          </div>
          <div class="wia-feat-row" data-feat-id="featMarketGraph" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-market-graph" style="width: auto;" ${prevFeatMarketGraph ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatMarketGraphCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatMarketGraphHint')}</div>
          </div>
          <div class="wia-feat-row" data-feat-id="featPnlTracker" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-pnl-tracker" style="width: auto;" ${prevFeatPnlTracker ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatPnlTrackerCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatPnlTrackerHint')}</div>
          </div>
          <div class="wia-feat-row" data-feat-id="featCompanyEco" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-company-eco" style="width: auto;" ${prevFeatCompanyEco ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatCompanyEco')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatCompanyEcoHint')}</div>
            <details class="wia-eco-alert-settings" style="margin-top: 6px; margin-left: 24px;">
              <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
                🔔 Firmen-Alarme
              </summary>
              <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="wia-feat-alert-company-storage" style="width: auto;" ${prevFeatAlertCompanyStorage ? 'checked' : ''} />
                <label style="font-size: 11px; color: #8b949e; margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatAlertCompanyStorage')}</label>
              </div>
              <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="wia-feat-alert-company-bonus" style="width: auto;" ${prevFeatAlertCompanyBonus ? 'checked' : ''} />
                <label style="font-size: 11px; color: #8b949e; margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatAlertCompanyBonus')}</label>
              </div>
              <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="wia-feat-alert-company-tax" style="width: auto;" ${prevFeatAlertCompanyTax ? 'checked' : ''} />
                <label style="font-size: 11px; color: #8b949e; margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatAlertCompanyTax')}</label>
              </div>
              <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="wia-feat-alert-company-deposit" style="width: auto;" ${prevFeatAlertCompanyDeposit ? 'checked' : ''} />
                <label style="font-size: 11px; color: #8b949e; margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatAlertCompanyDeposit')}</label>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.05); margin-top: 6px;">
                <input type="checkbox" class="wia-feat-better-region" style="width: auto;" ${prevFeatBetterRegion ? 'checked' : ''} />
                <label style="font-size: 11px; color: #8b949e; margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatBetterRegion')}</label>
              </div>
              <div style="margin-top: 8px;">
                <button type="button" class="wia-btn wia-clear-tracking-state" style="font-size: 10px; padding: 2px 6px; border: 1px solid rgba(248,81,73,0.4); border-radius: 4px; background: transparent; color: #f85149; cursor: pointer;">Clear Tracking State</button>
              </div>
            </details>
          </div>
        </details>
        <details class="wia-category-misc" style="margin-top: 10px; border-top: 1px solid rgba(148,163,184,.15); padding-top: 10px; margin-bottom: 10px;">
          <summary style="font-size: 12px; color: #c9d1d9; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
            ${t('settingsCategoryMisc')}
          </summary>
          <div class="wia-feat-row" data-feat-id="featScratchpad" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-scratchpad" style="width: auto;" ${prevFeatScratchpad ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatScratchpadCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatScratchpadHint')}</div>
          </div>
          <div class="wia-feat-row" data-feat-id="featNotes" style="margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-feat-notes" style="width: auto;" ${prevFeatNotes ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatNotesCheckbox')}</label>
              <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
            </div>
            <div class="wia-hint" hidden>${t('settingsFeatNotesHint')}</div>
          </div>
          <details class="wia-notif-settings-row" style="margin-top: 6px;">
            <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 6px;">
              🔔 ${t('settingsNotifTitle')}
            </summary>
            <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 6px; margin-top: 4px;">
              <div style="flex: 1; min-width: 120px;">
                <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsPersonalTopic')}</label>
                <input type="text" class="wia-personal-topic" placeholder="${defaultPersonalTopic}" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevPersonalTopic}" />
              </div>
              <div style="flex: 1; min-width: 120px;">
                <label style="font-size: 11px; color: #8b949e; display: block; margin: 0 0 2px;">${t('settingsPersonalTopicSecret')}</label>
                <input type="text" class="wia-personal-secret" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${prevPersonalSecret}" />
              </div>
            </div>
            <div style="margin-top: 2px; margin-bottom: 6px;">
              <a class="wia-personal-topic-link" href="${personalTopicUrl}" target="_blank" style="font-size: 10px; color: #58a6ff; text-decoration: none; font-weight: bold; display: inline-block;">
                🔗 ${t('settingsPersonalTopicLinkText')}: ${personalTopicUrl}
              </a>
            </div>
            <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px; border-top: 1px dashed rgba(148,163,184,0.15); padding-top: 6px;">
              <input type="checkbox" class="wia-feat-system-alerts" style="width: auto;" ${prevFeatSystemAlerts ? 'checked' : ''} />
              <label style="font-size: 11px; color: #8b949e; margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatSystemAlerts')}</label>
            </div>
          </details>
          <div class="wia-feat-row" data-feat-id="debug" style="margin-top: 10px; border-top: 1px solid rgba(148,163,184,.2); padding-top: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="wia-debug" style="width: auto;" ${CONFIG.debug ? 'checked' : ''} />
              <label style="margin: 0; font-weight: normal; cursor: pointer;">🐞 Debug-Logging (Konsole + Diagnose)</label>
            </div>
            <details class="wia-health-details" style="margin-top: 6px;">
              <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none;">Feature-Health / Diagnose</summary>
              <button type="button" class="wia-health-btn" style="margin: 6px 0; font-size: 11px; padding: 3px 8px; cursor: pointer;">Aktualisieren</button>
              <button type="button" class="wia-sp-reset-btn" style="margin: 6px 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: #a78bfa; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.2); border-radius: 3px;">SP Reset</button>
              <button type="button" class="wia-debug-export-btn" style="margin: 6px 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: #10b981; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); border-radius: 3px;">📋 Debug-Log kopieren</button>
              <button type="button" class="wia-pnl-print-btn" style="margin: 6px 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: #58a6ff; background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.2); border-radius: 3px;">P&L Kassenzettel (Konsole)</button>
              <button type="button" class="wia-skins-dump-btn" style="margin: 6px 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: #ff9800; background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.2); border-radius: 3px;">Skins Dump (Konsole)</button>
              <button type="button" class="wia-dmg-print-btn" style="margin: 6px 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: #f0a54a; background: rgba(240,165,74,0.1); border: 1px solid rgba(240,165,74,0.2); border-radius: 3px;">Troop Damage (Konsole)</button>
              <div class="wia-health-panel"></div>
            </details>
            <details class="wia-test-notif-details" style="margin-top: 6px;">
              <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none;">Benachrichtigungen testen</summary>
              <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
                <button type="button" class="wia-test-notif-bounty" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #fbbf24; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); border-radius: 3px;">Kopfgeld (Bounty)</button>
                <button type="button" class="wia-test-notif-hnh" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #10b981; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); border-radius: 3px;">HP & Hunger voll</button>
                <button type="button" class="wia-test-notif-window" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #fbbf24; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); border-radius: 3px;">Pillenfenster</button>
                <button type="button" class="wia-test-notif-debuff" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #8b5cf6; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.2); border-radius: 3px;">Debuff abgelaufen</button>
                <button type="button" class="wia-test-company-alert" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #f43f5e; background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.2); border-radius: 3px;">Firmenlager voll</button>
                <button type="button" class="wia-test-company-bonus" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #38bdf8; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.2); border-radius: 3px;">Bonus gesunken</button>
                <button type="button" class="wia-test-company-tax" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #f87171; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.2); border-radius: 3px;">Steuern erhöht</button>
                <button type="button" class="wia-test-company-deposit" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #facc15; background: rgba(250,204,21,0.1); border: 1px solid rgba(250,204,21,0.2); border-radius: 3px;">Regions-Deposit</button>
                <button type="button" class="wia-test-company-better-region" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #a78bfa; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.2); border-radius: 3px;">Bessere Region</button>
              </div>
            </details>
          </div>
        </details>
        <button type="button" class="wia-help-toggle" aria-expanded="false">${t('settingsHelpSummary')}</button>
        <aside class="wia-help-panel" hidden>
          <div class="wia-help-content">${t('settingsHelpContent')}</div>
        </aside>
        <div class="wia-btns">
          <button class="wia-btn primary wia-save">${t('settingsSave')}</button>
          <button class="wia-btn wia-clear">${t('settingsClear')}</button>
          <button class="wia-btn wia-close">${t('settingsClose')}</button>
        </div>
      </div>`;

        const categories = bg.querySelectorAll('details');
    categories.forEach(cat => {
      const summary = cat.querySelector('summary');
      if (summary && cat.querySelector('.wia-new-badge')) {
        summary.innerHTML += ` <span class="wia-new-badge" style="background: #eab308; color: #422006; font-size: 9px; font-weight: bold; padding: 1px 4px; border-radius: 4px; margin-left: 6px;">${t('settingsNewBadge') || 'New!'}</span>`;
      }
    });

    const modal = bg.querySelector('.wia-modal');
    const tokenInput = bg.querySelector('.wia-token');
    const localeBtn = bg.querySelector('.wia-locale-btn');
    const localeMenu = bg.querySelector('.wia-locale-menu');
    const localeItem = bg.querySelector('.wia-locale-item');

    tokenInput.value = prevToken;
    warnBanner = bg.querySelector('.wia-warn');
    renderRateLimitBanner();

    // Check settings token help visibility
    const tokenHelp = bg.querySelector('.wia-token-help');
    const updateHelpVisibility = () => {
      if (tokenHelp) {
        tokenHelp.style.display = tokenInput.value.trim() ? 'none' : 'block';
      }
    };
    tokenInput.oninput = updateHelpVisibility;
    updateHelpVisibility();

    localeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      localeMenu.classList.toggle('is-open');
    };

    localeItem.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      localeMenu.classList.remove('is-open');
      setLocale(localeItem.dataset.locale);
    };

    bg.onclick = (e) => {
      if (e.target === bg) {
        bg.remove();
        warnBanner = null;
        settingsModalBg = null;
      } else if (!localeMenu.contains(e.target) && e.target !== localeBtn) {
        localeMenu.classList.remove('is-open');
      }
    };

    bg.querySelectorAll('.wia-feat-row[data-feat-id]').forEach(row => {
      const featId = row.dataset.featId;
      row.addEventListener('mouseover', () => markFeatSeen(featId, row), { once: true });
      row.addEventListener('change', () => markFeatSeen(featId, row), { once: true });
    });

    // alliedCodesRow removed as allied country codes are resolved automatically.

    const featPillCheckbox = modal.querySelector('.wia-feat-pill');
    const pillNotifCheckbox = modal.querySelector('.wia-feat-pill-notif');
    const pillSettingsRow = modal.querySelector('.wia-pill-settings-row');
    const pillNotifHnH = modal.querySelector('.wia-feat-pill-notif-hnh');
    const pillNotifWindow = modal.querySelector('.wia-feat-pill-notif-window');
    const pillNotifDebuff = modal.querySelector('.wia-feat-pill-notif-debuff');

    if (featPillCheckbox && pillSettingsRow) {
      featPillCheckbox.onchange = () => {
        if (featPillCheckbox.checked) {
          pillSettingsRow.setAttribute('open', '');
        } else {
          pillSettingsRow.removeAttribute('open');
          if (pillNotifCheckbox) pillNotifCheckbox.checked = false;
          if (pillNotifHnH) pillNotifHnH.checked = false;
          if (pillNotifWindow) pillNotifWindow.checked = false;
          if (pillNotifDebuff) pillNotifDebuff.checked = false;
        }
      };
    }

    const clearTrackingBtn = modal.querySelector('.wia-clear-tracking-state');
    if (clearTrackingBtn) {
      clearTrackingBtn.onclick = () => {
        GM_deleteValue(KEYS.ecoTrackingState);
        clearTrackingBtn.textContent = 'Cleared!';
        setTimeout(() => clearTrackingBtn.textContent = 'Clear Tracking State', 2000);
      };
    }

    if (pillNotifCheckbox) {
      pillNotifCheckbox.onchange = () => {
        const checked = pillNotifCheckbox.checked;
        if (checked && featPillCheckbox && !featPillCheckbox.checked) {
          featPillCheckbox.checked = true;
          if (featPillCheckbox.onchange) featPillCheckbox.onchange();
        }
        if (pillNotifHnH) pillNotifHnH.checked = checked;
        if (pillNotifWindow) pillNotifWindow.checked = checked;
        if (pillNotifDebuff) pillNotifDebuff.checked = checked;
      };
    }

    [pillNotifHnH, pillNotifWindow, pillNotifDebuff].forEach(cb => {
      if (cb) {
        cb.onchange = () => {
          if (cb.checked) {
            if (featPillCheckbox && !featPillCheckbox.checked) {
              featPillCheckbox.checked = true;
              if (featPillCheckbox.onchange) featPillCheckbox.onchange();
            }
            if (pillNotifCheckbox) pillNotifCheckbox.checked = true;
          } else {
            const anyChecked = (pillNotifHnH && pillNotifHnH.checked) ||
                               (pillNotifWindow && pillNotifWindow.checked) ||
                               (pillNotifDebuff && pillNotifDebuff.checked);
            if (!anyChecked && pillNotifCheckbox) {
              pillNotifCheckbox.checked = false;
            }
          }
        };
      }
    });

    const featBountyCheckbox = modal.querySelector('.wia-feat-bounty');
    const bountyNotifCheckbox = modal.querySelector('.wia-feat-bounty-notif');
    if (featBountyCheckbox && bountyNotifCheckbox) {
      featBountyCheckbox.onchange = () => {
        if (!featBountyCheckbox.checked) {
          bountyNotifCheckbox.checked = false;
        }
      };
      bountyNotifCheckbox.onchange = () => {
        if (bountyNotifCheckbox.checked && !featBountyCheckbox.checked) {
          featBountyCheckbox.checked = true;
          if (featBountyCheckbox.onchange) featBountyCheckbox.onchange();
        }
      };
    }

    const featBattleCheckbox = modal.querySelector('.wia-feat-battle');
    const battleSettingsRow = modal.querySelector('.wia-battle-settings-row');
    const featOrderRadarCheckbox = modal.querySelector('.wia-feat-order-radar');
    const featTroopRadarCheckbox = modal.querySelector('.wia-feat-troop-radar');

    if (featBattleCheckbox && battleSettingsRow) {
      featBattleCheckbox.onchange = () => {
        if (featBattleCheckbox.checked) {
          battleSettingsRow.setAttribute('open', '');
        } else {
          battleSettingsRow.removeAttribute('open');
          if (featOrderRadarCheckbox) featOrderRadarCheckbox.checked = false;
          if (featTroopRadarCheckbox) featTroopRadarCheckbox.checked = false;
        }
      };
    }

    const debugCheckbox = modal.querySelector('.wia-debug');
    const healthPanel = modal.querySelector('.wia-health-panel');
    const healthBtn = modal.querySelector('.wia-health-btn');
    if (debugCheckbox) {
      debugCheckbox.onchange = () => setDebug(debugCheckbox.checked);   // live toggle, persisted
    }
    if (healthBtn && healthPanel) {
      healthBtn.onclick = (e) => { e.preventDefault(); runProbes(); renderHealthPanel(healthPanel); };
    }
    const spResetBtn = modal.querySelector('.wia-sp-reset-btn');
    if (spResetBtn) {
      spResetBtn.onclick = (e) => {
        e.preventDefault();
        try { GM_deleteValue('wia.scratchpadPanel'); } catch(err){}
        const sp = document.querySelector('.sp-panel');
        if (sp) {
          sp.style.left = '70px';
          sp.style.top = '60px';
          sp.style.width = '340px';
          sp.style.height = '420px';
        }
        const originalText = spResetBtn.textContent;
        spResetBtn.textContent = '✓ Reset!';
        setTimeout(() => { spResetBtn.textContent = originalText; }, 2000);
      };
    }
    const debugExportBtn = modal.querySelector('.wia-debug-export-btn');
    if (debugExportBtn) {
      debugExportBtn.onclick = (e) => {
        e.preventDefault();
        const text = exportDebugLog();
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(text);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
        }
        const originalText = debugExportBtn.textContent;
        debugExportBtn.textContent = '✓ Kopiert!';
        setTimeout(() => { debugExportBtn.textContent = originalText; }, 2000);
      };
    }
    const printBtn = modal.querySelector('.wia-pnl-print-btn');
    if (printBtn) {
      printBtn.onclick = (e) => { e.preventDefault(); printPnlReceipt(); };
    }
    const skinsDumpBtn = modal.querySelector('.wia-skins-dump-btn');
    if (skinsDumpBtn) {
      skinsDumpBtn.onclick = (e) => { e.preventDefault(); dumpSkinsToConsole(); };
    }
    const dmgPrintBtn = modal.querySelector('.wia-dmg-print-btn');
    if (dmgPrintBtn) {
      dmgPrintBtn.onclick = (e) => {
        e.preventDefault();
        printTroopDamageBreakdown();
      };
    }

    const testBountyBtn = modal.querySelector('.wia-test-notif-bounty');
    const testHnhBtn = modal.querySelector('.wia-test-notif-hnh');
    const testWindowBtn = modal.querySelector('.wia-test-notif-window');
    const testDebuffBtn = modal.querySelector('.wia-test-notif-debuff');

    if (testBountyBtn) {
      testBountyBtn.onclick = (e) => { e.preventDefault(); testLocalBounty(); };
    }
    if (testHnhBtn) {
      testHnhBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('HnH', t('ntfyHnHFullTitle'), t('ntfyHnHFullBody'), 'poultry_leg,heart,white_check_mark'); };
    }
    if (testWindowBtn) {
      testWindowBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('Window', t('ntfyPillWindowTitle'), t('ntfyPillWindowBody', { time: CONFIG.pillPrefWindowFrom || '12:00' }), 'pill,alarm_clock'); };
    }
    if (testDebuffBtn) {
      testDebuffBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('Debuff', t('ntfyDebuffGoneTitle'), t('ntfyDebuffGoneBody'), 'pill,sparkles'); };
    }
    const testCompanyAlertBtn = modal.querySelector('.wia-test-company-alert');
    if (testCompanyAlertBtn) {
      testCompanyAlertBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('Storage', 'WareEra - Storage Full', 'Company Test is full and has stopped producing!', 'factory,warning'); };
    }
    const testCompanyBonusBtn = modal.querySelector('.wia-test-company-bonus');
    if (testCompanyBonusBtn) {
      testCompanyBonusBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('Trend Down', 'WareEra - Bonus Drop', 'Company Test production bonus dropped from 150% to 125%', 'chart_with_downwards_trend,warning'); };
    }
    const testCompanyTaxBtn = modal.querySelector('.wia-test-company-tax');
    if (testCompanyTaxBtn) {
      testCompanyTaxBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('Tax Increase', 'WareEra - Tax Up', 'Income tax for Company Test increased from 5% to 10%', 'money_with_wings,warning'); };
    }
    const testCompanyDepositBtn = modal.querySelector('.wia-test-company-deposit');
    if (testCompanyDepositBtn) {
      testCompanyDepositBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('Expiring', 'WareEra - Deposit Expiring', 'Company Test: wood bonus expires in < 1 hour!', 'hourglass_flowing_sand,warning'); };
    }
    const testCompanyBetterRegionBtn = modal.querySelector('.wia-test-company-better-region');
    if (testCompanyBetterRegionBtn) {
      testCompanyBetterRegionBtn.onclick = (e) => { e.preventDefault(); sendPersonalNtfy('Better Region', 'WareEra - Better Region Available', 'Company Test could get 200% bonus in a better region!', 'gem,warning'); };
    }
    if (healthPanel) { runProbes(); renderHealthPanel(healthPanel); }   // initial fill = live truth

    modal.addEventListener('click', (e) => {
      const hintBtn = e.target.closest('.wia-hint-toggle');
      if (hintBtn) {
        const hint = hintBtn.closest('.wia-feat-row')?.querySelector('.wia-hint');
        if (hint) {
          const open = hint.toggleAttribute('hidden') === false;
          hintBtn.setAttribute('aria-expanded', String(open));
        }
      }

      const helpBtn = e.target.closest('.wia-help-toggle');
      if (helpBtn) {
        const panel = modal.querySelector('.wia-help-panel');
        if (panel) {
          const open = panel.toggleAttribute('hidden') === false;
          helpBtn.setAttribute('aria-expanded', String(open));
        }
      }

      e.stopPropagation();
    });
    window.setTimeout(() => tokenInput.focus(), 0);

    let resolvedIdentity = null;
    function updateTopicHints() {
      const scopeSelect = bg.querySelector('.wia-bounty-scope');
      if (!scopeSelect) return;

      const currentScope = scopeSelect.value;
      let tName = '';
      if (currentScope === 'all') {
        tName = 'all';
      } else if (resolvedIdentity && resolvedIdentity.allianceName) {
        tName = resolvedIdentity.allianceName.toLowerCase().replace(/[^a-z0-9]/g, '');
      } else if (resolvedIdentity && resolvedIdentity.countryName) {
        tName = resolvedIdentity.countryName.toLowerCase().replace(/[^a-z0-9]/g, '');
      }

      let autoTopic = '';
      if (tName) {
        autoTopic = `wia-bounty-${tName}`;
        if (currentScope === 'cascade' && currentScope !== 'all') {
          autoTopic += '-casc';
        }
      }

      if (autoTopic) {
        GM_setValue(KEYS.bountyAutoTopic, autoTopic);
      }
    }

    const scopeSelect = bg.querySelector('.wia-bounty-scope');
    if (scopeSelect) scopeSelect.onchange = updateTopicHints;

    const pTopicInput = bg.querySelector('.wia-personal-topic');
    const pSecretInput = bg.querySelector('.wia-personal-secret');
    const pLink = bg.querySelector('.wia-personal-topic-link');
    if (pTopicInput && pSecretInput && pLink) {
      const updateLink = () => {
        let tVal = pTopicInput.value.trim();
        if (!tVal) tVal = 'wia-user-' + (getCurrentUserId() || 'unknown');
        const sVal = pSecretInput.value.trim();
        const eff = sVal ? `${tVal}-${sVal}` : tVal;
        const url = `${NTFY_BASE}/${eff}`;
        pLink.href = url;
        pLink.textContent = `🔗 ${t('settingsPersonalTopicLinkText')}: ${url}`;
      };
      pTopicInput.oninput = updateLink;
      pSecretInput.oninput = updateLink;
    }



    resolveOwnIdentity().then((identity) => {
      resolvedIdentity = identity;
      const infoDiv = bg.querySelector('.wia-bounty-detected-identity');
      const input = bg.querySelector('.wia-bounty-own');
      if (identity && infoDiv && input) {
        const displayStr = identity.allianceName ? `${identity.countryName} / ${identity.allianceName}` : identity.countryName;
        input.setAttribute('placeholder', `${displayStr} (leer = automatisch)`);
        infoDiv.textContent = `Erkannt: ${displayStr}`;
      } else if (infoDiv) {
        infoDiv.textContent = 'Identität konnte nicht automatisch aufgelöst werden.';
      }
      updateTopicHints();
    }).catch(() => {
      const infoDiv = bg.querySelector('.wia-bounty-detected-identity');
      if (infoDiv) infoDiv.textContent = 'Identität konnte nicht automatisch aufgelöst werden.';
      updateTopicHints();
    });

    bg.querySelector('.wia-save').onclick = () => {
      const newToken = tokenInput.value.trim();
      const tokenChanged = prevToken !== newToken;
      setToken(newToken);


      const stockKeepCount = Number.parseInt(bg.querySelector('.wia-stock-keep-count').value, 10) || 3;
      GM_setValue(KEYS.stockKeepCount, stockKeepCount);
      CONFIG.stockKeepCount = stockKeepCount;

      const featNotes = bg.querySelector('.wia-feat-notes').checked;
      GM_setValue(KEYS.featNotes, featNotes);
      CONFIG.featNotes = featNotes;
      if (featNotes) { initNotes(); } else { teardownNotes(); }

      const featScratchpad = bg.querySelector('.wia-feat-scratchpad').checked;
      GM_setValue(KEYS.featScratchpad, featScratchpad);
      CONFIG.featScratchpad = featScratchpad;
      if (featScratchpad) { guard('scratchpad', initScratchpad); } else { teardownScratchpad(); }

      const featBattle = bg.querySelector('.wia-feat-battle').checked;
      GM_setValue(KEYS.featBattleAdvisor, featBattle);
      CONFIG.featBattleAdvisor = featBattle;
      if (featBattle && isBattlePage()) { applyBattleAdvisory(); } else { teardownBattleAdvisory(); }

      const featOrderRadar = featBattle && (bg.querySelector('.wia-feat-order-radar')?.checked ?? true);
      GM_setValue(KEYS.featOrderRadar, featOrderRadar);
      CONFIG.featOrderRadar = featOrderRadar;
      if (featBattle && featOrderRadar && (isCountryPage() || isMuPage())) { applyOrderRadar(); } else { const el = document.getElementById('wia-order-radar'); if (el) el.remove(); }

      const featTroopRadar = featBattle && (bg.querySelector('.wia-feat-troop-radar')?.checked ?? true);
      GM_setValue(KEYS.featTroopRadar, featTroopRadar);
      CONFIG.featTroopRadar = featTroopRadar;
      if (featBattle && featTroopRadar && isMuPage()) { applyTroopRadar(); } else { const el = document.getElementById('wia-troop-radar-summary'); if (el) el.remove(); document.querySelectorAll('.wia-troop-chips').forEach(e => e.remove()); }

      const featProfileCharsheet = bg.querySelector('.wia-feat-profile-charsheet')?.checked ?? true;
      GM_setValue(KEYS.featProfileCharsheet, featProfileCharsheet);
      CONFIG.featProfileCharsheet = featProfileCharsheet;
      if (featProfileCharsheet && isUserProfilePage()) { applyProfileCharsheet(); } else { removeProfileCharsheet(); }

      const featPill = bg.querySelector('.wia-feat-pill').checked;
      GM_setValue(KEYS.featPillReminder, featPill);
      CONFIG.featPillReminder = featPill;

      const buffVal = Number.parseFloat(bg.querySelector('.wia-pill-buff').value) || 8;
      GM_setValue(KEYS.pillBuffH, buffVal);
      CONFIG.pillBuffH = buffVal;

      const knifeVal = Number.parseFloat(bg.querySelector('.wia-pill-knife').value) || 6;
      GM_setValue(KEYS.pillKnifeH, knifeVal);
      CONFIG.pillKnifeH = knifeVal;

      const debuffVal = Number.parseFloat(bg.querySelector('.wia-pill-debuff').value) || 15.5;
      GM_setValue(KEYS.pillDebuffH, debuffVal);
      CONFIG.pillDebuffH = debuffVal;

      const prefFrom = bg.querySelector('.wia-pill-pref-from').value.trim() || '19:00';
      GM_setValue(KEYS.pillPrefWindowFrom, prefFrom);
      CONFIG.pillPrefWindowFrom = prefFrom;

      const prefTo = bg.querySelector('.wia-pill-pref-to').value.trim() || '20:00';
      GM_setValue(KEYS.pillPrefWindowTo, prefTo);
      CONFIG.pillPrefWindowTo = prefTo;

      const featPillNotifHnH = featPill && bg.querySelector('.wia-feat-pill-notif-hnh').checked;
      const featPillNotifWindow = featPill && bg.querySelector('.wia-feat-pill-notif-window').checked;
      const featPillNotifDebuff = featPill && bg.querySelector('.wia-feat-pill-notif-debuff').checked;
      const featMuHealDim = featPill && bg.querySelector('.wia-feat-mu-heal-dim').checked;
      GM_setValue(KEYS.featPillNotifHnH, featPillNotifHnH);
      GM_setValue(KEYS.featPillNotifWindow, featPillNotifWindow);
      GM_setValue(KEYS.featPillNotifDebuff, featPillNotifDebuff);
      GM_setValue(KEYS.featMuHealDim, featMuHealDim);
      CONFIG.featPillNotifHnH = featPillNotifHnH;
      CONFIG.featPillNotifWindow = featPillNotifWindow;
      CONFIG.featPillNotifDebuff = featPillNotifDebuff;
      CONFIG.featMuHealDim = featMuHealDim;

      if (featPill) { initPillReminder(); } else { teardownPillReminder(); }

      const featMarketGraph = bg.querySelector('.wia-feat-market-graph').checked;
      GM_setValue(KEYS.featMarketGraph, featMarketGraph);
      CONFIG.featMarketGraph = featMarketGraph;
      if (featMarketGraph) { initMarketGraph(); } else { teardownMarketGraph(); }

      const featPnlTracker = bg.querySelector('.wia-feat-pnl-tracker').checked;
      GM_setValue(KEYS.featPnlTracker, featPnlTracker);
      CONFIG.featPnlTracker = featPnlTracker;
      if (featPnlTracker) { initPnlTracker(); } else { teardownPnlTracker(); }

      const featItemAdvisor = bg.querySelector('.wia-feat-item-advisor').checked;
      GM_setValue(KEYS.featItemAdvisor, featItemAdvisor);
      CONFIG.featItemAdvisor = featItemAdvisor;
      if (!featItemAdvisor) { teardownAdvisor(); } else { guard('advisor', () => scanInventory(false)); }

      const featCraftingAdvisor = bg.querySelector('.wia-feat-crafting-advisor').checked;
      GM_setValue(KEYS.featCraftingAdvisor, featCraftingAdvisor);
      CONFIG.featCraftingAdvisor = featCraftingAdvisor;
      if (!featCraftingAdvisor) { teardownCraftingAdvisor(); } else { guard('craftAdvisor', triggerCraftingAdvisorCheck); }

      const featEquipSellCalc = bg.querySelector('.wia-feat-equip-sell-calc').checked;
      GM_setValue(KEYS.featEquipSellCalc, featEquipSellCalc);
      CONFIG.featEquipSellCalc = featEquipSellCalc;
      if (featEquipSellCalc) { initEquipSellCalc(); } else { teardownEquipSellCalc(); }

      const featCompanyEco = bg.querySelector('.wia-feat-company-eco').checked;
      GM_setValue(KEYS.featCompanyEco, featCompanyEco);
      CONFIG.featCompanyEco = featCompanyEco;
      if (!featCompanyEco) { teardownCompanyEco(); } else { guard('companyEco', initCompanyEco); }

      const featAlertCompanyStorage = bg.querySelector('.wia-feat-alert-company-storage').checked;
      GM_setValue(KEYS.featAlertCompanyStorage, featAlertCompanyStorage);
      CONFIG.featAlertCompanyStorage = featAlertCompanyStorage;

      const featAlertCompanyBonus = bg.querySelector('.wia-feat-alert-company-bonus').checked;
      GM_setValue(KEYS.featAlertCompanyBonus, featAlertCompanyBonus);
      CONFIG.featAlertCompanyBonus = featAlertCompanyBonus;

      const featAlertCompanyTax = bg.querySelector('.wia-feat-alert-company-tax').checked;
      GM_setValue(KEYS.featAlertCompanyTax, featAlertCompanyTax);
      CONFIG.featAlertCompanyTax = featAlertCompanyTax;

      const featAlertCompanyDeposit = bg.querySelector('.wia-feat-alert-company-deposit').checked;
      GM_setValue(KEYS.featAlertCompanyDeposit, featAlertCompanyDeposit);
      CONFIG.featAlertCompanyDeposit = featAlertCompanyDeposit;

      if (!featAlertCompanyStorage && !featAlertCompanyBonus && !featAlertCompanyTax && !featAlertCompanyDeposit) { 
        teardownCompanyTracking(); 
      } else { 
        guard('companyTracking', initCompanyTracking); 
      }

      const featBounty = bg.querySelector('.wia-feat-bounty').checked;
      const featBountyNotif = featBounty && bg.querySelector('.wia-feat-bounty-notif').checked;
      const hasKey = !!getToken();
      const bountyOwn = !hasKey ? '' : bg.querySelector('.wia-bounty-own').value.trim();
      const bountyScope = !hasKey ? 'all' : bg.querySelector('.wia-bounty-scope').value;
      const bountyMuteDebuff = bg.querySelector('.wia-bounty-mute-debuff').checked;
      const personalTopic = bg.querySelector('.wia-personal-topic').value.trim();
      const personalSecret = bg.querySelector('.wia-personal-secret').value.trim();
      const featSystemAlerts = bg.querySelector('.wia-feat-system-alerts').checked;

      GM_setValue(KEYS.featBountyNotify, featBounty);
      GM_setValue(KEYS.featBountyNotif, featBountyNotif);
      GM_setValue(KEYS.bountyOwnCountryOverride, bountyOwn);
      GM_setValue(KEYS.bountyScope, bountyScope);
      GM_setValue(KEYS.bountyMuteDebuff, bountyMuteDebuff);
      GM_setValue(KEYS.personalTopic, personalTopic);
      GM_setValue(KEYS.personalTopicSecret, personalSecret);
      GM_setValue(KEYS.featSystemAlerts, featSystemAlerts);

      CONFIG.featBountyNotify = featBounty;
      CONFIG.featBountyNotif = featBountyNotif;
      CONFIG.bountyOwnCountryOverride = bountyOwn;
      CONFIG.bountyScope = bountyScope;
      CONFIG.bountyMuteDebuff = bountyMuteDebuff;
      CONFIG.personalTopic = personalTopic;
      CONFIG.personalTopicSecret = personalSecret;
      CONFIG.featSystemAlerts = featSystemAlerts;

      bountyResetAllyCache();
      if (featBounty) { guard('bountyNotify', initBountyNotify); } else { teardownBountyNotify(); }
      if (featSystemAlerts) { initSystemAlerts(); } else { teardownSystemAlerts(); }

      if (tokenChanged) {
        clearCache();
      }
      bg.remove();
      warnBanner = null;
      settingsModalBg = null;
      scanInventory(tokenChanged);
    };
    bg.querySelector('.wia-clear').onclick = () => { clearCache(); updateStatusIndicator(); };
    bg.querySelector('.wia-close').onclick = () => { bg.remove(); warnBanner = null; settingsModalBg = null; };

    const tourLaunchBtn = bg.querySelector('.wia-tour-launch');
    if (tourLaunchBtn) {
      tourLaunchBtn.onclick = () => {
        bg.remove();
        warnBanner = null;
        settingsModalBg = null;
        startTour();
      };
    }
  }

  function openSettings() {
    // Reuse an already-open modal instead of stacking a second one (the tour opens
    // settings on its last step; a duplicate would break token save + querying).
    const existing = document.querySelector('.wia-modal-bg');
    if (existing) { settingsModalBg = existing; renderSettingsModal(existing); return; }
    const bg = document.createElement('div');
    bg.className = 'wia-modal-bg';
    document.body.appendChild(bg);
    settingsModalBg = bg;
    renderSettingsModal(bg);
  }

  function injectGear() {
    if (document.querySelector('.wia-gear')) return;
    const gear = document.createElement('button');
    gear.className = 'wia-gear';
    const icon = document.createElement('span');
    icon.className = 'wia-gear-icon';
    icon.textContent = '⚙';
    gear.appendChild(icon);
    gear.title = t('gearTooltipTitle');
    gear.onclick = openSettings;
    const dot = document.createElement('span'); // live freshness indicator
    dot.className = 'wia-gear-dot';
    gear.appendChild(dot);
    document.body.appendChild(gear);
    updateStatusIndicator();
  }

  const TOUR_LAYOUT_OPTS = { cardW: 300, cardH: 156, beerW: 88, beerH: 110, gap: 12, margin: 12 };

  function buildTourHole() {
    const hole = document.createElement('div');
    hole.className = 'wia-tour-hole';
    return hole;
  }

  function buildTourBeer() {
    const beer = document.createElement('img');
    beer.className = 'wia-tour-beer';
    beer.alt = '';
    beer.decoding = 'async';
    return beer;
  }

  function renderTourDots(dotsEl, index, total) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('span');
      d.className = 'wia-tour-dot' + (i === index ? ' active' : (i < index ? ' done' : ''));
      dotsEl.appendChild(d);
    }
  }

  function buildTourCard() {
    const card = document.createElement('div');
    card.className = 'wia-tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `
      <p class="wia-tour-step"></p>
      <h3 class="wia-tour-title"></h3>
      <p class="wia-tour-body"></p>
      <div class="wia-tour-paste"></div>
      <div class="wia-tour-dots"></div>
      <div class="wia-tour-actions">
        <button type="button" class="wia-tour-btn wia-tour-btn-ghost wia-tour-skip"></button>
        <span class="wia-tour-spacer"></span>
        <button type="button" class="wia-tour-btn wia-tour-btn-secondary wia-tour-back"></button>
        <button type="button" class="wia-tour-btn wia-tour-btn-primary wia-tour-next"></button>
      </div>`;
    return {
      card,
      stepEl:  card.querySelector('.wia-tour-step'),
      titleEl: card.querySelector('.wia-tour-title'),
      bodyEl:  card.querySelector('.wia-tour-body'),
      pasteEl: card.querySelector('.wia-tour-paste'),
      dotsEl:  card.querySelector('.wia-tour-dots'),
      backBtn: card.querySelector('.wia-tour-back'),
      nextBtn: card.querySelector('.wia-tour-next'),
      skipBtn: card.querySelector('.wia-tour-skip'),
    };
  }

  // Apply computeTourLayout() output to the live DOM nodes.
  function positionTourUI(targetRect, ui) {
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const t = { left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height };
    const L = computeTourLayout(t, vp, TOUR_LAYOUT_OPTS);

    ui.hole.style.left   = (t.left - 6) + 'px';
    ui.hole.style.top    = (t.top - 6) + 'px';
    ui.hole.style.width  = (t.width + 12) + 'px';
    ui.hole.style.height = (t.height + 12) + 'px';

    ui.beer.src = L.beerVariant === 'left' ? TOUR_BEER_LEFT : TOUR_BEER_RIGHT;
    ui.beer.style.left = L.beer.left + 'px';
    ui.beer.style.top  = L.beer.top + 'px';

    ui.card.style.left = L.card.left + 'px';
    ui.card.style.top  = L.card.top + 'px';
  }

  function tourDemo() {
    const hole = buildTourHole();
    const beer = buildTourBeer();
    const c = buildTourCard();
    document.body.append(hole, beer, c.card);
    c.stepEl.textContent = 'Step 2 of 7';
    c.titleEl.textContent = t('tourStep2Title');
    c.bodyEl.textContent = t('tourStep2Body');
    renderTourDots(c.dotsEl, 1, 7);
    c.skipBtn.textContent = t('tourSkip');
    c.backBtn.textContent = t('tourBack');
    c.nextBtn.textContent = t('tourNext');
    const cleanup = () => { hole.remove(); beer.remove(); c.card.remove(); };
    c.skipBtn.onclick = cleanup; c.nextBtn.onclick = cleanup;
    const rect = { left: window.innerWidth / 2 - 20, top: 80, width: 40, height: 40 };
    positionTourUI(rect, { hole, beer, card: c.card });
  }

  // --- locale-proof element finders (game DOM has obfuscated classes; never rely on them) ---
  function visible(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    // reject off-screen / scrolled-out nodes (stale or duplicate menu copies)
    if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return null;
    // reject visually hidden (display/visibility/opacity), including ancestors
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return null;
    } else {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return null;
    }
    return el;
  }

  function findAvatarMenu() {
    // Player-menu trigger = the header element with aria-haspopup="dialog" that
    // holds the avatar. Prefer it over a bare #avatar: profile/region/other pages
    // render DUPLICATE id="avatar" nodes, so #avatar[0] can resolve to the wrong one.
    const triggers = [...document.querySelectorAll('[aria-haspopup="dialog"]')]
      .filter((el) => visible(el) && el.querySelector('img, #avatar'));
    triggers.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (triggers[0]) return triggers[0];                    // topmost visible = header bar
    for (const a of document.querySelectorAll('#avatar')) {
      const trig = a.closest('[aria-haspopup="dialog"]');
      if (visible(trig)) return trig;
    }
    dbg('tour', 'debug', 'findAvatarMenu: no header trigger found');
    return null;
  }

  function findSettingsLink() {
    const uid = (typeof getCurrentUserId === 'function') ? getCurrentUserId() : null;
    // Prefer the settings link inside the OPEN dropdown (HeadlessUI marks it
    // data-headlessui-state="open"). Avoids stale/duplicate menu copies still in the DOM.
    const openMenus = [...document.querySelectorAll('[data-headlessui-state="open"]')].filter(visible);
    const roots = openMenus.length ? [...openMenus, document] : [document];
    for (const root of roots) {
      if (uid) {
        const exact = [...root.querySelectorAll(`a[href$="/user/${uid}/settings"]`)].find(visible);
        if (exact) return tightestRow(exact);
      }
      const any = [...root.querySelectorAll('a[href$="/settings"]')].find(visible);
      if (any) return tightestRow(any);
    }
    return null;
  }

  // If a matched menu anchor is taller than a single row, narrow the highlight to
  // the smallest full-width descendant (the actual clickable row).
  function tightestRow(el) {
    if (!el) return el;
    const r0 = el.getBoundingClientRect();
    if (r0.height <= 60) return el;
    let best = el, bestH = r0.height;
    for (const c of el.querySelectorAll('*')) {
      const r = c.getBoundingClientRect();
      if (r.width >= r0.width * 0.6 && r.height >= 20 && r.height < bestH) { best = c; bestH = r.height; }
    }
    return best;
  }

  // The API-Tokens section is found via locale-proof markers: the header name
  // "X-API-Key" (constant across game languages) or a "wae_" token string.
  function findApiTokenSection() {
    const nodes = document.querySelectorAll('span, p, div');
    for (const n of nodes) {
      if (n.children.length > 3) continue;
      const txt = n.textContent || '';
      if (/X-API-Key/i.test(txt) || /\bwae_[a-z0-9]/i.test(txt)) {
        // climb to a reasonably sized section container
        let sec = n;
        for (let i = 0; i < 4 && sec.parentElement; i++) {
          if (sec.querySelector('button')) break;
          sec = sec.parentElement;
        }
        if (visible(sec)) return sec;
      }
    }
    return null;
  }

  function findCreateTokenButton() {
    const sec = findApiTokenSection();
    // Prefer a button whose text matches de/en, else the first button in the section.
    const scope = sec || document;
    const btns = scope.querySelectorAll('button');
    for (const b of btns) {
      if (/token erstellen|create token/i.test(b.textContent || '')) return visible(b);
    }
    if (sec) {
      for (const b of btns) { if (visible(b)) return b; }
    }
    return null;
  }

  function findCreateDialog() {
    const panels = document.querySelectorAll('[id^="headlessui-dialog-panel"]');
    for (const p of panels) {
      if (p.querySelector('input') && visible(p)) return p;
    }
    return null;
  }

  // The freshly-created token is shown IN FULL inside the settings page (not a
  // dialog): "Neuer API-Token erstellt" + wae_<64 hex chars> + a copy button.
  // Existing list entries are TRUNCATED (e.g. wae_3bd5...6636), so a long
  // unbroken token is the reliable, locale-proof marker for the new-token panel.
  // Like visible() but tolerates off-screen (scrolled-out) nodes — for detecting
  // the freshly-created token even before it is scrolled into view.
  function rendered(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    if (typeof el.checkVisibility === 'function'
        && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return null;
    return el;
  }

  // The freshly-created token is shown IN FULL (untruncated) in a monospace span;
  // list entries are truncated (e.g. wae_3bd5...6636). An exact long token string
  // is the reliable, locale-proof marker for the just-created token.
  function findFullTokenSpan() {
    for (const s of document.querySelectorAll('span, code')) {
      if (/^wae_[a-z0-9]{30,}$/i.test((s.textContent || '').trim()) && rendered(s)) return s;
    }
    return null;
  }

  function findProstTokenInput() {
    return visible(document.querySelector('.wia-token'));
  }

  // A button/element is "reached" when fully within the viewport.
  function inViewportMostly(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
  }

  // The copy button sits in the SAME row as the full-token span. Bounded climb
  // (max 4 levels) so we never reach unrelated icon buttons (e.g. top-bar search).
  //   <div row><div><span monospace>wae_…</span></div><button><svg/></button></div>
  function findCopyButton() {
    const span = findFullTokenSpan();
    if (!span) return null;
    let row = span.parentElement;
    for (let i = 0; i < 4 && row; i++) {
      const btn = [...row.querySelectorAll('button')].find(rendered);
      if (btn) return btn;
      row = row.parentElement;
    }
    return null;
  }

  const TOUR_STEPS = [
    { id: 'avatar',   titleKey: 'tourStep1Title', bodyKey: 'tourStep1Body', find: findAvatarMenu,
      done: () => !!findSettingsLink() },                       // menu opened
    { id: 'settings', titleKey: 'tourStep2Title', bodyKey: 'tourStep2Body', find: findSettingsLink,
      done: () => !!findApiTokenSection() },                    // settings page loaded
    { id: 'section',  titleKey: 'tourStep3Title', bodyKey: 'tourStep3Body', find: findApiTokenSection,
      done: () => inViewportMostly(findCreateTokenButton()) },  // scrolled the create button into view
    { id: 'create',   titleKey: 'tourStep4Title', bodyKey: 'tourStep4Body', find: findCreateTokenButton,
      done: () => !!findCreateDialog() },                       // create dialog opened
    { id: 'dialog',   titleKey: 'tourStep5Title', bodyKey: 'tourStep5Body', find: findCreateDialog,
      done: () => !!findFullTokenSpan() },                      // token created (shown inline)
    { id: 'copy',     titleKey: 'tourStep6Title', bodyKey: 'tourStep6Body', find: findCopyButton,
      onAnchor: (el) => el.addEventListener('click', () => { tourState.copyClicked = true; }, { once: true }),
      done: () => tourState.copyClicked },                      // user clicked copy
    { id: 'paste',    titleKey: 'tourStep7Title', bodyKey: 'tourStep7Body', find: findProstTokenInput,
      onEnter: () => {
        tourState.tokenAtPaste = getToken() || '';             // remember prior token so we only finish on a NEW save
        if (!findProstTokenInput()) { try { openSettings(); } catch (e) { dbg('tour', 'error', 'open settings failed', e); } }
      },
      done: () => {
        const tk = getToken() || '';
        return /^wae_[a-z0-9]+$/i.test(tk) && tk !== tourState.tokenAtPaste;   // finish only after Save persists a new token
      } },
  ];

  // Wait for a step's anchor to appear (MutationObserver + poll). Resolves null on timeout.
  function waitForAnchor(step, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const immediate = step.find();
      if (immediate) { resolve(immediate); return; }
      let done = false;
      const finish = (el) => {
        if (done) return; done = true;
        obs.disconnect(); clearInterval(poll); clearTimeout(timer);
        resolve(el);
      };
      const obs = new MutationObserver(() => { const el = step.find(); if (el) finish(el); });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      const poll = setInterval(() => { const el = step.find(); if (el) finish(el); }, 250);
      const timer = setTimeout(() => {
        dbg('tour', 'debug', `waitForAnchor timeout for step "${step.id}"`);
        finish(null);
      }, timeoutMs);
    });
  }

  // Watch for the step's completion condition and auto-advance. MutationObserver
  // + interval + scroll (step 3 depends on scrolling). Cleaned up on teardown.
  function startAdvanceWatch(index) {
    const step = TOUR_STEPS[index];
    if (!step.done) return null;
    const startedAt = performance.now();
    let stopped = false;
    const advance = () => {
      if (stopped || !tourState.active || tourState.index !== index) return;
      if (performance.now() - startedAt < 500) return;    // grace so the highlight is seen
      let ok = false;
      try { ok = !!step.done(); } catch (e) { dbg('tour', 'error', 'done() threw', e); }
      if (!ok) return;
      cleanup();
      const next = index + 1;
      if (next >= TOUR_STEPS.length) endTour({ completed: true });
      else tourGoto(next);
    };
    const obs = new MutationObserver(advance);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    const iv = setInterval(advance, 350);
    const onScroll = () => advance();
    window.addEventListener('scroll', onScroll, true);
    function cleanup() {
      stopped = true; obs.disconnect(); clearInterval(iv);
      window.removeEventListener('scroll', onScroll, true);
    }
    return cleanup;
  }

  let tourState = { active: false, index: 0, ui: null, cleanupReposition: null, cleanupAdvance: null, copyClicked: false, tokenAtPaste: '' };

  // step 7 paste UI is injected by Task 7; safe no-op default until then
  function renderStep7Paste(pasteEl, cardParts) {
    // Ensure PROST settings (with the .wia-token input) is open so the input exists.
    if (!findProstTokenInput()) {
      try { openSettings(); } catch (e) { dbg('tour', 'error', 'open settings failed', e); }
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wia-tour-btn wia-tour-btn-primary';
    btn.style.width = '100%';
    btn.textContent = t('tourPaste');
    btn.onclick = async () => {
      const input = findProstTokenInput();
      if (!input) { try { openSettings(); } catch (e) { dbg('tour', 'error', 'open settings failed', e); } return; }
      let val = input.value.trim();
      // If the field isn't already a valid token, try to fill it from the clipboard.
      if (!/^wae_[a-z0-9]+$/i.test(val)) {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = (await navigator.clipboard.readText() || '').trim();
            if (/^wae_[a-z0-9]+$/i.test(text)) {
              input.value = text;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              val = text;
            }
          }
        } catch (e) { dbg('tour', 'debug', 'clipboard read blocked'); }
      }
      if (!/^wae_[a-z0-9]+$/i.test(val)) {
        // manual fallback: let the user paste by hand, then click this button again to save
        cardParts.bodyEl.textContent = getLocale() === 'de'
          ? 'Füge den Token manuell ein (Cmd/Strg+V) und klicke dann erneut hier.'
          : 'Paste your token manually (Cmd/Ctrl+V), then click here again.';
        input.focus();
        input.scrollIntoView({ block: 'center' });
        return;
      }
      // Save via PROST's own Save button (persists token + settings). The step-7
      // `done` predicate then detects the new token and finishes the tour.
      const saveBtn = document.querySelector('.wia-modal-bg .wia-save');
      if (saveBtn) {
        saveBtn.click();
        btn.textContent = getLocale() === 'de' ? '✓ Gespeichert — Prost! 🍻' : '✓ Saved — Prost! 🍻';
        btn.disabled = true;
      } else {
        cardParts.bodyEl.textContent = getLocale() === 'de'
          ? 'Klicke auf „Speichern" in den PROST-Einstellungen.'
          : 'Click "Save" in the PROST settings.';
      }
    };
    pasteEl.appendChild(btn);
  }
  let tourPromptEl = null;

  function removeTourPrompt() {
    if (tourPromptEl) { tourPromptEl.remove(); tourPromptEl = null; }
  }

  function showTourPrompt() {
    if (tourPromptEl || tourState.active) return;
    const el = document.createElement('div');
    el.className = 'wia-tour-prompt';
    el.innerHTML = `
      <img alt="" src="${TOUR_BEER_RIGHT}">
      <div>
        <p class="wia-tour-prompt-title">${t('tourPromptTitle')}</p>
        <p class="wia-tour-prompt-body">${t('tourPromptBody')}</p>
        <div class="wia-tour-prompt-actions">
          <button type="button" class="wia-tour-btn wia-tour-btn-primary wia-tour-p-start">${t('tourPromptStart')}</button>
          <button type="button" class="wia-tour-btn wia-tour-btn-ghost wia-tour-p-later">${t('tourPromptLater')}</button>
          <button type="button" class="wia-tour-prompt-never">${t('tourPromptNever')}</button>
        </div>
      </div>`;
    el.querySelector('.wia-tour-p-start').onclick = () => startTour({ fromPrompt: true });
    el.querySelector('.wia-tour-p-later').onclick = () => removeTourPrompt();
    el.querySelector('.wia-tour-prompt-never').onclick = () => { GM_setValue(KEYS.tourDismissed, true); removeTourPrompt(); };
    document.body.appendChild(el);
    tourPromptEl = el;
  }

  function maybeShowTourPrompt() {
    const show = shouldShowTourPrompt({
      featTour: CONFIG.featTour,
      hasToken: !!getToken(),
      dismissed: !!GM_getValue(KEYS.tourDismissed, false),
      completed: !!GM_getValue(KEYS.tourCompleted, false),
    });
    if (show) showTourPrompt();
  }

  function teardownTourUI() {
    if (tourState.cleanupAdvance) { tourState.cleanupAdvance(); tourState.cleanupAdvance = null; }
    if (tourState.cleanupReposition) { tourState.cleanupReposition(); tourState.cleanupReposition = null; }
    if (tourState.ui) {
      tourState.ui.hole.remove(); tourState.ui.beer.remove(); tourState.ui.card.remove();
      tourState.ui = null;
    }
  }

  function attachReposition(getTarget, ui) {
    let frame = null;
    const reflow = () => {
      frame = null;
      const el = getTarget();
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) positionTourUI(r, ui);
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(reflow); };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    reflow();
    return () => {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
    };
  }

  async function tourGoto(index) {
    if (!tourState.active) return;
    index = Math.max(0, Math.min(TOUR_STEPS.length - 1, index));
    tourState.index = index;
    tourState.copyClicked = false;
    const step = TOUR_STEPS[index];
    if (typeof step.onEnter === 'function') { try { step.onEnter(index); } catch (e) { dbg('tour', 'error', 'onEnter threw', e); } }

    teardownTourUI();
    const hole = buildTourHole();
    const beer = buildTourBeer();
    const c = buildTourCard();
    const ui = { hole, beer, card: c.card, parts: c };
    tourState.ui = ui;
    document.body.append(hole, beer, c.card);

    // static card content
    c.stepEl.textContent = getLocale() === 'de'
      ? `Schritt ${index + 1} von ${TOUR_STEPS.length}`
      : `Step ${index + 1} of ${TOUR_STEPS.length}`;
    c.titleEl.textContent = t(step.titleKey);
    c.bodyEl.textContent = t(step.bodyKey);
    renderTourDots(c.dotsEl, index, TOUR_STEPS.length);
    c.skipBtn.textContent = t('tourSkip');
    c.backBtn.textContent = t('tourBack');
    c.backBtn.disabled = index === 0;
    c.nextBtn.textContent = index === TOUR_STEPS.length - 1 ? t('tourFinish') : t('tourNext');

    // step 7 gets the paste helper; other steps hide it
    c.pasteEl.innerHTML = '';
    if (step.id === 'paste') renderStep7Paste(c.pasteEl, c);

    // button wiring
    c.skipBtn.onclick = () => endTour({ dismissed: tourState.fromPrompt });
    c.backBtn.onclick = () => tourGoto(tourState.index - 1);
    c.nextBtn.onclick = () => {
      if (tourState.index === TOUR_STEPS.length - 1) { endTour({ completed: !!getToken() }); return; }
      tourGoto(tourState.index + 1);
    };

    // place immediately in a neutral spot while we look for the anchor
    positionTourUI({ left: window.innerWidth / 2 - 20, top: 80, width: 40, height: 40 }, ui);
    setHealth('tour', 'ok', `step ${index + 1}: ${step.id}`);

    const anchor = await waitForAnchor(step);
    if (!tourState.active || tourState.index !== index) return; // moved on while waiting
    if (anchor) {
      if (step.id === 'paste') {
        // Final step targets PROST's OWN modal — don't dim/point at the game.
        // Pin the card clear of the centered PROST modal so nothing blocks Save.
        hole.style.display = 'none';
        beer.style.display = 'none';
        c.card.style.left = '16px';
        c.card.style.top = 'auto';
        c.card.style.bottom = '16px';
      } else {
        try { anchor.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* older engines */ }
        c.bodyEl.textContent = t(step.bodyKey);
        tourState.cleanupReposition = attachReposition(step.find, ui);
      }
      if (typeof step.onAnchor === 'function') { try { step.onAnchor(anchor, index); } catch (e) { dbg('tour', 'error', 'onAnchor threw', e); } }
      tourState.cleanupAdvance = startAdvanceWatch(index);
    } else {
      // graceful: keep the card, tell the user, Next stays enabled
      hole.style.display = 'none';
      beer.style.display = 'none';
      c.bodyEl.textContent = t('tourNotFound');
      setHealth('tour', 'warn', `anchor not found: ${step.id}`);
      tourState.cleanupAdvance = startAdvanceWatch(index);
    }
  }

  function startTour(opts = {}) {
    if (tourState.active) return;
    tourState.active = true;
    tourState.fromPrompt = !!opts.fromPrompt;
    removeTourPrompt();               // hide the auto-prompt if it's showing (Task 6)
    document.addEventListener('keydown', onTourKey, true);
    guard('tour', () => tourGoto(0));
  }

  function endTour(opts = {}) {
    tourState.active = false;
    document.removeEventListener('keydown', onTourKey, true);
    teardownTourUI();
    if (opts.dismissed) GM_setValue(KEYS.tourDismissed, true);
    if (opts.completed) GM_setValue(KEYS.tourCompleted, true);
    setHealth('tour', 'idle', opts.completed ? 'completed' : 'not running');
  }

  function onTourKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); endTour({ dismissed: tourState.fromPrompt }); }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bootstrap + MutationObserver
  // ───────────────────────────────────────────────────────────────────────────
  function isInventoryPage() {
    return /\/user\/[^/]+\/inventory/.test(getPagePathname());
  }

  function isMarketPage() {
    return /\/market\/equipment/.test(getPagePathname());
  }

  // ===================== Tour of Beers (issue #50) =====================
  // Interactive, beer-guided API-token onboarding. UI pre-designed in the plan.
  const TOUR_BEER_LEFT  = "data:image/png;base64,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";
  const TOUR_BEER_RIGHT = "data:image/png;base64,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";

  function shouldShowTourPrompt({ featTour, hasToken, dismissed, completed }) {
    return !!featTour && !hasToken && !dismissed && !completed;
  }

  function clampTour(v, min, max) {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  function computeTourLayout(target, vp, opts) {
    const { cardW, cardH, beerW, beerH, gap, margin } = opts;
    const unitW = beerW + gap + cardW;          // beer + gap + card
    const spaceRight = vp.w - (target.left + target.width);
    const spaceLeft = target.left;
    const tooBig = target.width > vp.w * 0.6 || target.height > vp.h * 0.6;

    const vCenter = target.top + target.height / 2;
    const rowTop = clampTour(vCenter - cardH / 2, margin, vp.h - cardH - margin);
    const beerTop = clampTour(vCenter - beerH / 2, margin, vp.h - beerH - margin);

    if (!tooBig && spaceRight >= unitW + gap + margin) {
      // target | beer(points left) | card
      const beerLeft = target.left + target.width + gap;
      return {
        side: 'right', beerVariant: 'left',
        beer: { left: beerLeft, top: beerTop },
        card: { left: beerLeft + beerW + gap, top: rowTop },
      };
    }
    if (!tooBig && spaceLeft >= unitW + gap + margin) {
      // card | beer(points right) | target
      const beerLeft = target.left - gap - beerW;
      return {
        side: 'left', beerVariant: 'right',
        beer: { left: beerLeft, top: beerTop },
        card: { left: beerLeft - gap - cardW, top: rowTop },
      };
    }
    // Fallback: pin below the target (or above if no room), card centered, beer to its left.
    const belowTop = target.top + target.height + gap;
    const cardTop = (belowTop + cardH + margin <= vp.h)
      ? belowTop
      : clampTour(target.top - gap - cardH, margin, vp.h - cardH - margin);
    const cardLeft = clampTour(target.left + target.width / 2 - cardW / 2, margin, vp.w - cardW - margin);
    return {
      side: 'bottom', beerVariant: 'right',
      beer: { left: clampTour(cardLeft - beerW - gap, margin, vp.w - beerW - margin), top: cardTop },
      card: { left: cardLeft, top: cardTop },
    };
  }

  let bootstrapObserver = null;
  let bypassNextScanDebounce = false;
  let routePollFrame = null;

  const debouncedScan = debounce(() => {
    cachedCards = null;
    if (isInventoryPage()) {
      scanInventory(false);
    }
  }, CONFIG.rescanDebounceMs);

  function triggerScan(force = false) {
    cachedCards = null;
    if (bypassNextScanDebounce) {
      bypassNextScanDebounce = false;
      if (isInventoryPage()) {
        scanInventory(force);
      }
    } else {
      debouncedScan();
    }
  }

let currentObserverTarget = null; // Globale Variable hinzufügen, falls nicht vorhanden

function updateObserverTarget() {
    const target = document.getElementById('__next') || document.body;

    // WICHTIG: Abbrechen, wenn wir das Ziel bereits beobachten!
    if (currentObserverTarget === target) return;

    observer.disconnect();
    currentObserverTarget = target;
    log('Observing stable root for rescans: ' + (target.id || target.tagName));

    // Observer neu anhängen
    observer.observe(target, { childList: true, subtree: true });
}

  function initBootstrapObserver() {
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }

    // Check if cards exist immediately
    if (document.querySelector("[id^='item-code-selector-']") || findItemCards().size > 0) {
      return;
    }

    bootstrapObserver = new MutationObserver((mutations, obs) => {
      if (document.querySelector("[id^='item-code-selector-']") || findItemCards().size > 0) {
        log('Bootstrap observer: cards detected in DOM');
        obs.disconnect();
        bootstrapObserver = null;
        if (routePollFrame) {
          const cancelAF = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : clearTimeout;
          cancelAF(routePollFrame);
          routePollFrame = null;
        }
        scanInventory(false);
      }
    });

    bootstrapObserver.observe(document.body, { childList: true, subtree: true });
  }

  let lastPath = getPagePathname();

  function startRoutePolling() {
    if (routePollFrame) {
      const cancelAF = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : clearTimeout;
      cancelAF(routePollFrame);
      routePollFrame = null;
    }

    const cards = findItemCards();
    if (cards.size > 0 || document.querySelector("[id^='item-code-selector-']")) {
      log('Route polling: found cards immediately');
      if (isInventoryPage()) {
        scanInventory(false);
      }
      return;
    }

    const startTime = Date.now();
    const rAF = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);

    const poll = () => {
      const cardsPoll = findItemCards();
      if (cardsPoll.size > 0 || document.querySelector("[id^='item-code-selector-']")) {
        log('Route polling (rAF): found cards');
        if (bootstrapObserver) {
          bootstrapObserver.disconnect();
          bootstrapObserver = null;
        }
        routePollFrame = null;
        if (isInventoryPage()) {
          scanInventory(false);
        }
        return;
      }
      if (Date.now() - startTime < 5000) {
        routePollFrame = rAF(poll);
      } else {
        log('Route polling (rAF): 5s timeout reached');
        routePollFrame = null;
      }
    };
    routePollFrame = rAF(poll);
  }

  function handleRouteChange() {
    const pagePath = getPagePathname();
    if (pagePath === lastPath) return;
    dbg('orderRadar', 'debug', 'route changed', lastPath, '->', pagePath);
    // Log the route-detection snapshot alongside the transition itself — without
    // this, "orderRadar says idle/not-on-country-page while visibly on one" can't
    // be diagnosed after the fact, since the health panel only shows the LATEST
    // status, not what getEntityFromRoute()/isCountryPage() actually returned at
    // the moment of this specific transition.
    dbg('orderRadar', 'debug', 'route detection', {
      isCountryPage: isCountryPage(),
      isMuPage: isMuPage(),
      isInventoryPage: isInventoryPage(),
      isMarketPage: isMarketPage(),
      isBattlePage: isBattlePage(),
      isUserProfilePage: isUserProfilePage(),
      entity: getEntityFromRoute(),
      featOrderRadar: CONFIG.featOrderRadar,
      featBattleAdvisor: CONFIG.featBattleAdvisor,
    });
    lastPath = pagePath;
    cachedCards = null;
    lastInventoryCards = null; // Reset fingerprint on route change
    lastInventoryCardTexts.clear();
    lastMktState = null;
    bypassNextScanDebounce = true;

    if (routePollFrame) {
      const cancelAF = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : clearTimeout;
      cancelAF(routePollFrame);
      routePollFrame = null;
    }
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }

    if (isInventoryPage()) {
      try { ecoTrackingPollOnRoute(); } catch (e) { dbg('companyTracking', 'error', 'route-trigger failed (inventory)', e); }
      updateObserverTarget();
      if (CONFIG.featItemAdvisor) {
        if (document.querySelector("[id^='item-code-selector-']") || findItemCards().size > 0) {
          log('Route change: cards exist immediately, scanning');
          guard('advisor', () => scanInventory(false));
        } else {
          initBootstrapObserver();
          startRoutePolling();
        }
      } else {
        setHealth('advisor', 'idle', 'disabled in settings');
      }
    } else if (isMarketPage()) {
      observer.disconnect();
      if (CONFIG.featMarketGraph) {
        initSharedBodyObserver();
      } else {
        teardownSharedBodyObserver();
      }
    } else if (isBattlePage()) {
      observer.disconnect();
      if (CONFIG.featBattleAdvisor) {
        guard('battleAdvisor', applyBattleAdvisory);
        initSharedBodyObserver();
      }
    } else if (isCountryPage() || isMuPage()) {
      observer.disconnect();
      if (CONFIG.featOrderRadar) {
        // On an entity switch, drop cached orders & radar state so navigating
        // between countries/MUs immediately fetches fresh entity orders.
        orderRadarCache.clear();
        orderRadarLastOrders = [];
        orderRadarLastEntity = null;
        const old = document.getElementById('wia-order-radar');
        if (old) old.remove();
        guard('orderRadar', applyOrderRadar);
        initSharedBodyObserver();
      }
      if (CONFIG.featTroopRadar && isMuPage()) {
        guard('troopRadar', applyTroopRadar);
        initSharedBodyObserver();
      }
    } else if (isUserProfilePage() || pagePath.startsWith('/companies') || pagePath.startsWith('/company/') || /^\/user\/[0-9a-zA-Z_-]+\/companies\/?$/.test(pagePath)) {
      observer.disconnect();
      if (pagePath.startsWith('/companies') || pagePath.startsWith('/company/') || /^\/user\/[0-9a-zA-Z_-]+\/companies\/?$/.test(pagePath)) {
        try { ecoTrackingPollOnRoute(); } catch (e) { dbg('companyTracking', 'error', 'route-trigger failed (companies)', e); }
      }
      if (isUserProfilePage() && CONFIG.featProfileCharsheet) {
        guard('profileCharsheet', applyProfileCharsheet);
        initSharedBodyObserver();
      }
      if (CONFIG.featCompanyEco && (pagePath.startsWith('/companies') || pagePath.startsWith('/company/') || /^\/user\/[0-9a-zA-Z_-]+\/companies\/?$/.test(pagePath))) {
        guard('companyEco', initCompanyEco);
        initSharedBodyObserver();
      }
    } else {
      teardownBattleAdvisory();
      if (CONFIG.featCompanyEco) guard('companyEco', teardownCompanyEco);
      const orderRadarEl = document.getElementById('wia-order-radar');
      if (orderRadarEl) orderRadarEl.remove();
      const troopRadarSummary = document.getElementById('wia-troop-radar-summary');
      if (troopRadarSummary) troopRadarSummary.remove();
      cleanupStrayTroopRadarChips();
      removeProfileCharsheet();
      observer.disconnect();
      teardownSharedBodyObserver();
    }

    if (CONFIG.featPillReminder) {
      setTimeout(tickPillReminder, 50);
    }

    if (CONFIG.featMuHealDim) {
      applyMuHealDimSoon();
    }

    if (CONFIG.featPnlTracker) {
      setTimeout(updatePnlUi, 50);
    }

    // Refresh feature health after the new route settles (keeps ampel honest).
    if (CONFIG.debug && typeof runProbes === 'function') setTimeout(runProbes, 1500);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Battle Advisory module
  // Highlights the ally-side button and clones orders into it on /battle/<id>
  // ───────────────────────────────────────────────────────────────────────────
  function isBattlePage() {
    const path = getPagePathname();
    return /\/battle\/[0-9a-zA-Z]{6,}/.test(path)
      && !/\/battles/.test(path);
  }

  function battleFlagCode(btnEl) {
    return btnEl?.querySelector('img[src*="/images/flags/"]')
      ?.getAttribute('src')?.match(/\/flags\/([a-z]{2})\.svg/)?.[1] || null;
  }

  function detectAllySide() {
    const defBtn = document.querySelector('#defender-hit-button');
    const atkBtn = document.querySelector('#attacker-hit-button');
    if (!defBtn || !atkBtn) return null;

    const defCode = battleFlagCode(defBtn);
    const atkCode = battleFlagCode(atkBtn);
    const allied = new Set((CONFIG.alliedCountryCodes || []).map(c => c.toLowerCase()));

    // Primary: configurable allied country list
    if (defCode && allied.has(defCode)) return 'defender';
    if (atkCode && allied.has(atkCode)) return 'attacker';

    // Fallback: structural-check both defender and attacker parents independently for orders (country or MU)
    const defParent = defBtn.parentElement?.parentElement;
    const atkParent = atkBtn.parentElement?.parentElement;

    const defHasOrders = !!(defParent && defParent.querySelector('a[href*="/country/"], a[href*="/mu/"]'));
    const atkHasOrders = !!(atkParent && atkParent.querySelector('a[href*="/country/"], a[href*="/mu/"]'));

    // Highlight only if exactly one side has orders (never guess if both or neither do)
    if (defHasOrders && !atkHasOrders) return 'defender';
    if (atkHasOrders && !defHasOrders) return 'attacker';

    return null; // unknown-never highlight a guess
  }

  function injectCompactOrders(btnEl) {
    if (!btnEl) return;
    const column = btnEl.parentElement?.parentElement;
    if (!column) return;

    const rows = column.querySelectorAll('a[href*="/country/"], a[href*="/mu/"]');
    if (!rows.length) return;

    const strip = document.createElement('span');
    strip.className = 'wia-compact-orders';
    strip.dataset.wiaInjected = 'true';

    rows.forEach(anchor => {
      const rowContainer = anchor.closest('div._1dnmndyl3l, div[class]') || anchor.parentElement?.parentElement;
      const originalSvg = rowContainer?.querySelector('svg');
      const img = anchor.querySelector('img');

      if (!originalSvg && !img) return;

      const item = document.createElement('span');
      item.className = 'wia-compact-order-item';

      if (originalSvg) {
        const clonedSvg = originalSvg.cloneNode(true);
        clonedSvg.setAttribute('class', 'wia-compact-order-symbol');

        let color = 'currentColor';
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
          try {
            const cs = window.getComputedStyle(originalSvg);
            color = cs.color || 'currentColor';
          } catch (e) {}
        }
        clonedSvg.style.color = color;
        item.appendChild(clonedSvg);
      }

      if (img) {
        const clonedImg = document.createElement('img');
        clonedImg.src = img.src;
        clonedImg.alt = img.alt;
        clonedImg.className = 'wia-compact-order-flag';
        item.appendChild(clonedImg);
      }

      strip.appendChild(item);
    });

    if (!strip.children.length) return;

    // Find the inner label container inside the button (e.g. Defend/Attack text wrapper next to the country flag)
    const labelContainer = btnEl.querySelector('button img[src*="/flags/"]')?.closest('[aria-haspopup="dialog"]')?.parentElement
      || btnEl.querySelector('button');

    if (labelContainer) {
      labelContainer.appendChild(strip);
    }
  }

  let battleGen = 0;
  let battleRetryTimer = null;

  function applyBattleAdvisory(expectedPath) {
    if (!isBattlePage()) return;
    const currentPath = getPagePathname();
    if (expectedPath && expectedPath !== currentPath) return; // bailed due to URL change

    const defBtn = document.querySelector('#defender-hit-button');
    const atkBtn = document.querySelector('#attacker-hit-button');
    if (!defBtn || !atkBtn) {
      if (battleRetryTimer) clearTimeout(battleRetryTimer);
      const myGen = ++battleGen;
      battleRetryTimer = setTimeout(() => {
        if (myGen === battleGen) {
          applyBattleAdvisory(currentPath);
        }
      }, 400);
      return;
    }

    teardownBattleAdvisory(); // clean previous pass

    // Unconditionally inject compact orders for each side if present
    injectCompactOrders(defBtn);
    injectCompactOrders(atkBtn);

    const side = detectAllySide();
    if (!side) return; // unknown side-leave highlighting untouched

    const allyBtn  = side === 'defender' ? defBtn : atkBtn;
    const enemyBtn = side === 'defender' ? atkBtn : defBtn;

    allyBtn.classList.add('wia-battle-primary');
    enemyBtn.classList.add('wia-battle-muted');
  }

  function teardownBattleAdvisory() {
    document.querySelector('#defender-hit-button')?.classList.remove('wia-battle-primary', 'wia-battle-muted');
    document.querySelector('#attacker-hit-button')?.classList.remove('wia-battle-primary', 'wia-battle-muted');
    document.querySelectorAll('[data-wia-injected]').forEach(el => el.remove());
    setHealth('battleAdvisor', 'idle', 'disabled in settings');
    setHealth('orderRadar', 'idle', 'disabled in settings');
    setHealth('troopRadar', 'idle', 'disabled in settings');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scratchpad / Notizen-Tool
  // ───────────────────────────────────────────────────────────────────────────
const KEYS_SCRATCHPAD = {
  index: 'wia.scratchpadIndex',
  notePfx: 'wia.scratchpad.',
  panel: 'wia.scratchpadPanel',
  state: 'wia.scratchpadState'
};

function scratchpadLoadIndex() {
  return GM_getValue(KEYS_SCRATCHPAD.index, []);
}

function scratchpadSaveIndex(index) {
  GM_setValue(KEYS_SCRATCHPAD.index, index);
}

function scratchpadLoadNote(id) {
  return GM_getValue(KEYS_SCRATCHPAD.notePfx + id, '');
}

function scratchpadSaveNote(id, text) {
  GM_setValue(KEYS_SCRATCHPAD.notePfx + id, text);
  const index = scratchpadLoadIndex();
  const entry = index.find(n => n.id === id);
  if (entry) {
    entry.updatedAt = Date.now();
    index.sort((a, b) => b.updatedAt - a.updatedAt);
    scratchpadSaveIndex(index);
  }
}

function scratchpadDeleteNote(id) {
  GM_deleteValue(KEYS_SCRATCHPAD.notePfx + id);
  const index = scratchpadLoadIndex();
  scratchpadSaveIndex(index.filter(n => n.id !== id));
}

let spTrigger = null;
let spPanel = null;
let spQuickCreate = null;
let spState = { view: 'list', lastNoteId: null };
let spTypingTimeout = null;
let spCurrentNoteId = null;

function renderSpList() {
  const index = scratchpadLoadIndex();
  spPanel.querySelector('.sp-header-title').textContent = 'Scratchpad';
  const body = spPanel.querySelector('.sp-body');
  if (index.length === 0) {
    body.className = 'sp-body sp-body-empty';
    body.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
      <span style="margin-bottom: 12px;">Noch keine Notizen</span>
      <button class="sp-new-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>Neue Notiz</button>
    `;
    body.querySelector('.sp-new-btn').onclick = () => createNewNote();
    return;
  }
  body.className = 'sp-body sp-body-list';
  
  const actions = document.createElement('div');
  actions.className = 'sp-list-actions';
  
  const newBtn = document.createElement('button');
  newBtn.className = 'sp-new-btn';
  newBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>Neue Notiz`;
  if (index.length >= 50) {
    newBtn.disabled = true;
    newBtn.style.opacity = '0.5';
  }
  newBtn.onclick = () => createNewNote();
  
  const countLabel = document.createElement('span');
  countLabel.className = 'sp-count';
  countLabel.textContent = `${index.length} / 50`;
  
  actions.appendChild(newBtn);
  actions.appendChild(countLabel);
  
  const listContainer = document.createElement('div');
  listContainer.className = 'sp-list-container';
  
  index.forEach(entry => {
    const noteText = scratchpadLoadNote(entry.id);
    const lines = noteText.split('\n').filter(l => l.trim().length > 0);
    const title = lines.length > 0 ? lines[0] : 'Unbenannte Notiz';
    const preview = lines.length > 1 ? lines.slice(1).join(' ').substring(0, 60) : '';
    const date = new Date(entry.createdAt);
    const dateStr = `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getFullYear()).slice(-2)}`;
    
    const row = document.createElement('div');
    row.className = 'sp-list-row';
    row.tabIndex = 0;
    
    row.innerHTML = `
      <div class="sp-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></div>
      <div class="sp-row-content">
        <div class="sp-row-title">${escapeHtml(title)}</div>
        <div class="sp-row-preview">${escapeHtml(preview)}</div>
      </div>
      <div class="sp-row-meta">
        <div class="sp-row-date">${dateStr}</div>
        <button class="sp-row-delete" aria-label="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
      </div>
    `;
    
    row.onclick = (e) => {
      if (e.target.closest('.sp-row-delete')) {
        showDeleteConfirm(entry.id);
      } else {
        openEditor(entry.id);
      }
    };
    listContainer.appendChild(row);
  });
  
  body.innerHTML = '';
  body.appendChild(actions);
  body.appendChild(listContainer);
}

function showDeleteConfirm(id) {
  let toast = spPanel.querySelector('.sp-delete-toast');
  if (toast) toast.remove();
  
  toast = document.createElement('div');
  toast.className = 'sp-delete-toast';
  toast.innerHTML = `
    <div class="sp-toast-msg">Notiz endgültig löschen?</div>
    <div class="sp-toast-actions">
      <button class="sp-toast-btn-del">Löschen</button>
      <button class="sp-toast-btn-cancel">Abbrechen</button>
    </div>
  `;
  toast.querySelector('.sp-toast-btn-cancel').onclick = () => toast.remove();
  toast.querySelector('.sp-toast-btn-del').onclick = () => {
    scratchpadDeleteNote(id);
    toast.remove();
    renderSpList();
  };
  spPanel.appendChild(toast);
}

function createNewNote() {
  const index = scratchpadLoadIndex();
  if (index.length >= 50) return; // limit
  
  const id = Date.now().toString();
  index.unshift({ id, createdAt: Date.now(), updatedAt: Date.now() });
  scratchpadSaveIndex(index);
  scratchpadSaveNote(id, '');
  openEditor(id);
}

function autosaveCurrentNote() {
  if (spCurrentNoteId && spPanel.querySelector('.sp-editor-textarea')) {
    const text = spPanel.querySelector('.sp-editor-textarea').value;
    scratchpadSaveNote(spCurrentNoteId, text);
  }
}

function openEditor(id) {
  spCurrentNoteId = id;
  spState = { view: 'editor', lastNoteId: id };
  GM_setValue(KEYS_SCRATCHPAD.state, spState);
  
  const index = scratchpadLoadIndex();
  const entry = index.find(n => n.id === id);
  if (!entry) {
    renderSpList();
    return;
  }
  
  const noteText = scratchpadLoadNote(id);
  const date = new Date(entry.createdAt);
  const dateStr = `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getFullYear()).slice(-2)}`;
  
  const body = spPanel.querySelector('.sp-body');
  body.className = 'sp-body sp-body-editor';
  
  body.innerHTML = `
    <div class="sp-editor-toolbar">
      <button class="sp-btn-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"></path></svg> Alle Notizen
      </button>
      <div class="sp-editor-date">${dateStr}</div>
    </div>
    <textarea class="sp-editor-textarea" placeholder="Notiz schreiben..."></textarea>
    <div class="sp-autosave-bar">
      <div class="sp-autosave-dot"></div>
      <div class="sp-autosave-text">Autosave aktiv</div>
    </div>
  `;
  
  const ta = body.querySelector('.sp-editor-textarea');
  ta.value = noteText;
  
  const updateTitle = () => {
    const lines = ta.value.split('\n').filter(l => l.trim().length > 0);
    const title = lines.length > 0 ? lines[0] : 'Unbenannte Notiz';
    spPanel.querySelector('.sp-header-title').textContent = title;
  };
  updateTitle();
  
  ta.addEventListener('input', () => {
    updateTitle();
    clearTimeout(spTypingTimeout);
    spTypingTimeout = setTimeout(() => autosaveCurrentNote(), 2000);
  });
  
  body.querySelector('.sp-btn-back').onclick = () => {
    autosaveCurrentNote();
    spCurrentNoteId = null;
    spState = { view: 'list', lastNoteId: null };
    GM_setValue(KEYS_SCRATCHPAD.state, spState);
    renderSpList();
  };
  
  setTimeout(() => ta.focus(), 50);
}

function escapeHtml(unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function initScratchpadDrag() {
  const header = spPanel.querySelector('.sp-header');
  let isDragging = false;
  let startX, startY, initialX, initialY;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.sp-close-btn')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialX = spPanel.offsetLeft;
    initialY = spPanel.offsetTop;
    header.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    spPanel.style.left = `${initialX + dx}px`;
    spPanel.style.top = `${initialY + dy}px`;
  });

  const stopDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    header.style.cursor = '';
    document.body.style.userSelect = '';
    clampAndSavePosition();
  };
  window.addEventListener('mouseup', stopDrag);
}

function clampAndSavePosition() {
  if (!spPanel || spPanel.style.display === 'none' || spPanel.offsetWidth === 0) return;
  const rect = spPanel.getBoundingClientRect();
  const maxLeft = window.innerWidth - 40;
  const maxTop = window.innerHeight - 40;
  
  let newLeft = Math.max(0, Math.min(rect.left, maxLeft));
  let newTop = Math.max(0, Math.min(rect.top, maxTop));
  
  if (window.innerWidth < 320) {
    newLeft = 0;
    spPanel.style.width = '100%';
  }
  
  spPanel.style.left = newLeft + 'px';
  spPanel.style.top = newTop + 'px';
  
  GM_setValue(KEYS_SCRATCHPAD.panel, {
    x: newLeft,
    y: newTop,
    w: spPanel.offsetWidth,
    h: spPanel.offsetHeight
  });
}

let spResizeTimeout = null;
function initScratchpadResize() {
  const ro = new ResizeObserver(() => {
    clearTimeout(spResizeTimeout);
    spResizeTimeout = setTimeout(() => clampAndSavePosition(), 300);
  });
  ro.observe(spPanel);
}

function handleSpGlobalEsc(e) {
  if (e.key === 'Escape' && spPanel && spPanel.style.display !== 'none') {
    if (spState.view === 'editor') {
      autosaveCurrentNote();
      spCurrentNoteId = null;
      spState = { view: 'list', lastNoteId: null };
      GM_setValue(KEYS_SCRATCHPAD.state, spState);
      renderSpList();
    } else {
      spPanel.style.display = 'none';
    }
  }
}

function handleSpBeforeUnload() {
  if (spState.view === 'editor' && spPanel.style.display !== 'none') {
    autosaveCurrentNote();
  }
}

let handleRouteChangeRef = null;

function teardownScratchpad() {
  if (spTrigger) { spTrigger.remove(); spTrigger = null; }
  if (spQuickCreate) { spQuickCreate.remove(); spQuickCreate = null; }
  if (spPanel) { spPanel.remove(); spPanel = null; }
  window.removeEventListener('keydown', handleSpGlobalEsc);
  window.removeEventListener('beforeunload', handleSpBeforeUnload);
  handleRouteChangeRef = null;
  setHealth('scratchpad', 'idle', 'disabled in settings');
}

function initScratchpad() {
  teardownScratchpad();
  
  spTrigger = document.createElement('div');
  spTrigger.className = 'sp-trigger';
  spTrigger.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
    </svg>
  `;
  
  const index = scratchpadLoadIndex();
  if (index.length > 0) {
    const dot = document.createElement('div');
    dot.className = 'sp-trigger-dot';
    spTrigger.appendChild(dot);
  }

  spQuickCreate = document.createElement('button');
  spQuickCreate.className = 'sp-quick-create';
  spQuickCreate.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>Neue Notiz`;
  spQuickCreate.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>Neue Notiz`;
  
  spTrigger.addEventListener('click', () => {
    if (spPanel.style.display === 'none') {
      spPanel.style.display = 'flex';
      if (spState.view === 'editor' && spState.lastNoteId) {
        openEditor(spState.lastNoteId);
      } else {
        renderSpList();
      }
    } else {
      if (spState.view === 'editor') autosaveCurrentNote();
      spPanel.style.display = 'none';
    }
  });
  
  spQuickCreate.onclick = () => {
    spPanel.style.display = 'flex';
    createNewNote();
  };

  document.body.appendChild(spTrigger);
  document.body.appendChild(spQuickCreate);

  spPanel = document.createElement('div');
  spPanel.className = 'sp-panel';
  spPanel.style.display = 'none';
  spPanel.innerHTML = `
    <div class="sp-header">
      <span class="sp-header-title">Scratchpad</span>
      <button class="sp-close-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    </div>
    <div class="sp-body"></div>
  `;

  const savedPos = GM_getValue(KEYS_SCRATCHPAD.panel, { x: 70, y: 60, w: 340, h: 420 });
  spPanel.style.left = savedPos.x + 'px';
  spPanel.style.top = savedPos.y + 'px';
  spPanel.style.width = Math.max(280, savedPos.w) + 'px';
  spPanel.style.height = Math.max(260, savedPos.h) + 'px';

  spPanel.querySelector('.sp-close-btn').addEventListener('click', () => {
    if (spState.view === 'editor') autosaveCurrentNote();
    spPanel.style.display = 'none';
  });

  document.body.appendChild(spPanel);
  
  initScratchpadDrag();
  initScratchpadResize();
  
  spState = GM_getValue(KEYS_SCRATCHPAD.state, { view: 'list', lastNoteId: null });
  
  window.addEventListener('keydown', handleSpGlobalEsc);
  window.addEventListener('beforeunload', handleSpBeforeUnload);
  
  handleRouteChangeRef = () => {
    if (spState.view === 'editor' && spPanel.style.display !== 'none') {
      autosaveCurrentNote();
    }
  };
  
  setHealth('scratchpad', 'ok');
}


  // ───────────────────────────────────────────────────────────────────────────
  // Notes module (ported from warera-notes.user.js-reuses same GM keys/selectors
  // so notes saved by the standalone script remain visible here too)
  // ───────────────────────────────────────────────────────────────────────────
  const NOTES_LINK_SEL  = "a[href*='/user/']";
  const NOTES_ATTR      = 'data-warera-note-attached';
  const NOTES_KEY_PFX   = 'warera-note:';
  const NOTES_DEBOUNCE  = 150;
  const NOTES_HOVER_GRACE_MS = 1500; // how long the empty pencil icon stays visible after the mouse leaves


  // ───────────────────────────────────────────────────────────────────────────
  // Company Tracking (Issue #87 & #88 & Storage Alerts)
  // ───────────────────────────────────────────────────────────────────────────
  const ecoTrackingPollMs = 15 * 60 * 1000;
  const ecoTrackingPollMinGap = 2 * 60 * 1000;
  let ecoTrackingInterval = null;
  let ecoTrackingLastPollAt = 0;
  const ecoTopBarStockCache = { stock: {}, at: 0 };
  const ECO_STOCK_CACHE_MAX_AGE = 30 * 60 * 1000;

  async function ecoFetchAllRegions() {
    const cache = readCache(KEYS.ecoRegionData) || {};
    if (cache._lastFetch && Date.now() - cache._lastFetch < 3600000 * 6) return;
    try {
      const { payload } = await resolveApiBase('region.getAll', undefined, true);
      if (payload && Array.isArray(payload)) {
        payload.forEach(r => {
          cache[r._id] = {
            country: r.country,
            depositEndsAt: r.deposit?.endsAt || null,
            depositType: r.deposit?.type || null,
            strategicResource: r.strategicResource || null
          };
        });
        cache._lastFetch = Date.now();
        writeCache(KEYS.ecoRegionData, cache);
      }
    } catch (err) {
      console.warn('[PROST] ecoFetchAllRegions failed:', err);
    }
  }

  function ecoGetTopBarStock() {
    const stock = {};
    const coinPath = Array.from(document.querySelectorAll('svg path'))
      .find(p => p.getAttribute('d')?.startsWith('M12 5C7.031'));
    if (!coinPath) return stock;
    
    let topBar = coinPath;
    for (let i = 0; i < 4 && topBar; i++) topBar = topBar.parentElement;
    if (!topBar) return stock;

    for (const img of topBar.querySelectorAll('img[alt]')) {
      const code = img.getAttribute('alt');
      if (!code) continue;
      
      let numSpan = null, node = img;
      for (let i = 0; i < 6 && node && !numSpan; i++) {
        node = node.parentElement;
        if (!node) break;
        const spans = Array.from(node.querySelectorAll('span'));
        for (let j = spans.length - 1; j >= 0; j--) {
          const t = spans[j].textContent.trim();
          if (/^[\d.,]+[KM]?$/i.test(t)) { numSpan = spans[j]; break; }
        }
      }
      if (numSpan) {
        // inline parse logic since ecoParseNum is defined further down
        const m = /([\d.]+)\s*([KM]?)/i.exec(numSpan.textContent.replace(/[,\s/]/g, ''));
        if (m) {
          let n = parseFloat(m[1]);
          if (m[2].toUpperCase() === 'K') n *= 1e3;
          if (m[2].toUpperCase() === 'M') n *= 1e6;
          stock[code] = n;
        }
      }
    }
    if (Object.keys(stock).length > 0) {
      ecoTopBarStockCache.stock = stock;
      ecoTopBarStockCache.at = Date.now();
    }
    return stock;
  }

  function ecoGetCachedStock() {
    const fresh = ecoGetTopBarStock();
    if (Object.keys(fresh).length > 0) return fresh;
    if (ecoTopBarStockCache.at && (Date.now() - ecoTopBarStockCache.at < ECO_STOCK_CACHE_MAX_AGE)) {
      return ecoTopBarStockCache.stock;
    }
    return null;
  }

  async function ecoTrackingPoll() {
    if (!CONFIG.featAlertCompanyStorage && !CONFIG.featAlertCompanyBonus && !CONFIG.featAlertCompanyTax && !CONFIG.featAlertCompanyDeposit && !CONFIG.featBetterRegion) return;
    ecoTrackingLastPollAt = Date.now();
    dbg('companyTracking', 'Starting poll...');
    const userId = getCurrentUserId();
    if (!userId) {
      dbg('companyTracking', 'No userId found (DOM might not be ready).');
      return;
    }
    dbg('companyTracking', 'UserId ok: ' + userId);

    try {
      await ecoFetchAllRegions();
      await fetchGameConfig();
      const { payload: companiesRes } = await resolveApiBase('company.getCompanies', { userId });
      if (!companiesRes || !companiesRes.items) {
        dbg('companyTracking', 'No companies found in API response.');
        return;
      }

      const itemsList = companiesRes.items;
      dbg('companyTracking', `Found ${itemsList.length} companies to check.`);

      const state = GM_getValue(KEYS.ecoTrackingState, {});
      let changed = false;
      const nowMs = Date.now();
      const activeCompanyIds = new Set();
      const materialConsumption = {};

      for (const item of itemsList) {
        if (!item) continue;
        const compId = typeof item === 'object' ? item._id : item;
        if (!compId) continue;
        await new Promise(r => setTimeout(r, 600));

        const { payload: comp } = await resolveApiBase('company.getById', { companyId: compId });
        if (!comp || !comp.region || comp.disabledAt || comp.user !== userId) continue;

        activeCompanyIds.add(comp._id);
        if (!state[comp._id]) state[comp._id] = {};
        const st = state[comp._id];
        const compName = comp.name || 'Unknown';

        let currentTotalBonus = 0;

        // 0. Fetch production bonus early (needed for material depletion estimate)
        if (CONFIG.featAlertCompanyBonus || CONFIG.featBetterRegion || CONFIG.featAlertCompanyStorage) {
          try {
            const { payload: bonusData } = await resolveApiBase('company.getProductionBonus', { companyId: comp._id });
            if (bonusData && typeof bonusData.total === 'number') {
              currentTotalBonus = bonusData.total;
            }
          } catch (e) {
            console.warn('[PROST] eco: fetch bonus failed (early)', e);
          }
        }

        // 1. Storage Full Check
        if (CONFIG.featAlertCompanyStorage) {
          const full = comp.isFull === true;
          if (full && !st.full) {
            sendPersonalNtfy('Storage', `WareEra - Storage Full`, `Company ${compName} is full and has stopped producing!`, 'factory,warning', 4);
          }
          if (st.full !== full) {
            st.full = full;
            changed = true;
          }

          // Collect per-material consumption for aggregate check after loop
          const recipes = ecoRecipesCache.recipes || {};
          const recipe = recipes[comp.itemCode];
          if (recipe && recipe.inputs && recipe.inputs.length > 0) {
            const engineLevels = ecoRecipesCache.engineLevels;
            const lvl = comp.activeUpgradeLevels?.automatedEngine || 0;
            const engineDaily = engineLevels?.[lvl]?.stats?.dailyProd || 0;
            const bonus = currentTotalBonus || 0;
            const pointsPerDay = engineDaily * (1 + bonus / 100);
            const dayItems = recipe.productionPoints ? pointsPerDay / recipe.productionPoints : 0;

            for (const inp of recipe.inputs) {
              if (!materialConsumption[inp.code]) materialConsumption[inp.code] = { totalDaily: 0, count: 0 };
              materialConsumption[inp.code].totalDaily += dayItems * (inp.qty || 1);
              materialConsumption[inp.code].count++;
            }
          }
        }

        // 2. Production Bonus Drop Check (bonus already fetched in step 0)
        if (CONFIG.featAlertCompanyBonus) {
          const newBonus = currentTotalBonus;
          if (st.bonus !== undefined && newBonus < st.bonus) {
            sendPersonalNtfy('Trend Down', 'WareEra - Bonus Drop', `Company ${compName} production bonus dropped from ${st.bonus}% to ${newBonus}%`, 'chart_with_downwards_trend,warning', 3);
          }
          if (st.bonus !== newBonus) {
            st.bonus = newBonus;
            changed = true;
          }
        }

        await new Promise(r => setTimeout(r, 600));

        let regionPayload = null;
        if (CONFIG.featAlertCompanyTax || CONFIG.featAlertCompanyDeposit || CONFIG.featBetterRegion) {
          const regionCache = readCache(KEYS.ecoRegionData) || {};
          regionPayload = regionCache[comp.region];
          if (!regionPayload) {
            try {
              const { payload: regData } = await resolveApiBase('region.getById', { regionId: comp.region });
              regionPayload = {
                country: regData.country,
                depositEndsAt: regData.deposit?.endsAt || null,
                depositType: regData.deposit?.type || null,
                strategicResource: regData.strategicResource || null
              };
            } catch (e) {}
          }
        }

        // 3. Tax Increase Check
        if (CONFIG.featAlertCompanyTax && comp.workerCount > 0 && regionPayload && regionPayload.country) {
          try {
            await new Promise(r => setTimeout(r, 600));
            const { payload: countryData } = await resolveApiBase('country.getCountryById', { countryId: regionPayload.country });
            if (countryData && countryData.taxes && typeof countryData.taxes.income === 'number') {
              const newTax = countryData.taxes.income;
              if (st.tax !== undefined && newTax > st.tax) {
                sendPersonalNtfy('Tax Increase', 'WareEra - Tax Up', `Income tax for ${compName} increased from ${st.tax}% to ${newTax}%`, 'money_with_wings,warning', 3);
              }
              if (st.tax !== newTax) {
                st.tax = newTax;
                changed = true;
              }
            }
          } catch (e) {
            console.warn('[PROST] eco: fetch country tax failed', e);
          }
        }

        // 4. Region Deposit Expiry Check
        if (CONFIG.featAlertCompanyDeposit && regionPayload && regionPayload.depositEndsAt) {
          const endsAtMs = new Date(regionPayload.depositEndsAt).getTime();
          const msLeft = endsAtMs - nowMs;
          
          if (msLeft > 0 && msLeft < 3600000) {
            if (st.depositEndsAt !== regionPayload.depositEndsAt) {
               sendPersonalNtfy('Expiring', 'WareEra - Deposit Expiring', `Company ${compName}: ${regionPayload.depositType} bonus expires in < 1 hour!`, 'hourglass_flowing_sand,warning', 3);
               st.depositEndsAt = regionPayload.depositEndsAt;
               changed = true;
            }
          }
        }

        // 5. Better Region Check
        if (CONFIG.featBetterRegion && currentTotalBonus > 0 && comp.itemCode) {
          const itemCode = comp.itemCode;
          try {
            await new Promise(r => setTimeout(r, 600));
            const { payload: recommended } = await resolveApiBase('company.getRecommendedRegionIdsByItemCode', { itemCode, count: 1 });
            if (recommended && recommended.length > 0) {
              const topRec = recommended[0];
              if (topRec.bonus > currentTotalBonus) {
                const alerts = readCache(KEYS.ecoBetterRegionAlerts) || {};
                const prevAlert = alerts[comp._id];
                const topRecRegionId = topRec.regionId;
                
                const recRegionCache = (readCache(KEYS.ecoRegionData) || {})[topRecRegionId];
                const topRecCountry = recRegionCache ? recRegionCache.country : 'unknown';

                if (prevAlert && prevAlert.companyRegionAtTimeOfAlert !== comp.region) {
                  delete alerts[comp._id];
                } else if (!prevAlert || topRec.bonus > prevAlert.alertedBonus || (topRecCountry !== prevAlert.alertedCountry && topRec.bonus > currentTotalBonus)) {
                   sendPersonalNtfy('Better Region', 'WareEra - Better Region Available', `Company ${compName} could get ${topRec.bonus}% bonus in a better region!`, 'gem,warning', 3);
                   alerts[comp._id] = {
                     alertedCountry: topRecCountry,
                     alertedBonus: topRec.bonus,
                     companyRegionAtTimeOfAlert: comp.region
                   };
                   writeCache(KEYS.ecoBetterRegionAlerts, alerts);
                }
              }
            }
          } catch(e) {
            console.warn('[PROST] eco: fetch recommended regions failed', e);
          }
        }
      }

      // Aggregate material shortage check (batched across all companies)
      if (CONFIG.featAlertCompanyStorage && Object.keys(materialConsumption).length > 0) {
        const prevMatState = state.__materials || {};
        const matState = {};
        const cachedStock = ecoGetCachedStock();
        dbg('companyTracking', 'Material check', { hasCachedStock: !!cachedStock, materialConsumption, prevMatState: { ...prevMatState }, cacheAge: ecoTopBarStockCache.at ? ((nowMs - ecoTopBarStockCache.at) / 60000).toFixed(1) + 'min' : 'none' });
        if (cachedStock) {
          const cacheAgeHours = ecoTopBarStockCache.at ? (nowMs - ecoTopBarStockCache.at) / 3600000 : 0;
          for (const [matCode, info] of Object.entries(materialConsumption)) {
            const rawStock = cachedStock[matCode] || 0;
            const hourlyRate = info.totalDaily / 24;
            const estimatedStock = Math.max(0, rawStock - hourlyRate * cacheAgeHours);
            const hoursLeft = hourlyRate > 0 ? estimatedStock / hourlyRate : Infinity;
            const noMat = estimatedStock < 10 || hoursLeft < 2;
            matState[matCode] = noMat;
            dbg('companyTracking', `Material ${matCode}: raw=${rawStock} est=${estimatedStock.toFixed(0)} rate=${hourlyRate.toFixed(1)}/h hours=${hoursLeft.toFixed(1)} noMat=${noMat} prev=${prevMatState[matCode]}`);
            if (noMat && !prevMatState[matCode]) {
              const timeInfo = estimatedStock >= 10 ? ` (~${hoursLeft.toFixed(1)}h left)` : '';
              sendPersonalNtfy('Out of Stock', `WareEra - Material Shortage`, `Low ${matCode}${timeInfo} — ${info.count} ${info.count === 1 ? 'company' : 'companies'} affected`, 'package,warning', 4);
            }
          }
        }
        state.__materials = matState;
        changed = true;
      }

      // Prune orphaned state entries for companies no longer owned
      for (const key of Object.keys(state)) {
        if (key.startsWith('__')) continue;
        if (!activeCompanyIds.has(key)) {
          delete state[key];
          changed = true;
        }
      }

      if (changed) GM_setValue(KEYS.ecoTrackingState, state);
      setHealth('companyTracking', 'ok', 'polled ' + companiesRes.items.length + ' companies');
    } catch (e) {
      console.warn('[PROST] eco: tracking poll failed', e);
      setHealth('companyTracking', 'warn', e.message);
    }
  }

  function initCompanyTracking() {
    if (ecoTrackingInterval) clearInterval(ecoTrackingInterval);
    const state = GM_getValue(KEYS.ecoTrackingState, {});
    if (state.__materials) {
      delete state.__materials;
      GM_setValue(KEYS.ecoTrackingState, state);
    }
    ecoTrackingInterval = setInterval(ecoTrackingPoll, ecoTrackingPollMs);
    setTimeout(ecoTrackingPoll, 10000);
  }

  function ecoTrackingPollOnRoute() {
    const freshStock = ecoGetTopBarStock();
    dbg('companyTracking', 'Route-trigger stock scrape', { keys: Object.keys(freshStock), stock: freshStock, sincePoll: ((Date.now() - ecoTrackingLastPollAt) / 1000).toFixed(0) + 's' });
    if (Object.keys(freshStock).length > 0) {
      const state = GM_getValue(KEYS.ecoTrackingState, {});
      const matState = state.__materials;
      if (matState) {
        let changed = false;
        for (const [matCode, isLow] of Object.entries(matState)) {
          if (!isLow) continue;
          const stockAmt = freshStock[matCode];
          if (stockAmt !== undefined && stockAmt >= 10) {
            matState[matCode] = false;
            changed = true;
          }
        }
        if (changed) GM_setValue(KEYS.ecoTrackingState, state);
      }
    }
    if (Date.now() - ecoTrackingLastPollAt < ecoTrackingPollMinGap) return;
    dbg('companyTracking', 'Route-triggered poll');
    ecoTrackingPoll();
  }

  function teardownCompanyTracking() {
    if (ecoTrackingInterval) clearInterval(ecoTrackingInterval);
    ecoTrackingInterval = null;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // Company Economy (Wave 1)
  // ───────────────────────────────────────────────────────────────────────────
  let companyEcoModalNode = null;
  let companyEcoWageInput = null;
  let companyEcoCompanyId = null;
  let companyEcoTaxRate = null;
  let companyEcoTaxResolved = false;
  let companyEcoRafId = null;
  let companyEcoLastWage = null;
  let isEditWorkerModal = false;
  let companyEcoWorkerData = null;
  let companyEcoTeardownTimer = null;
  let companyEcoWorkerFetchPending = false;
  let companyEcoMarketWages = null;
  let editWorkerPpSection = null;

  function ecoFindWorkerByUserId(userId) {
    dbg('companyEco', `findWorker: searching for userId=${userId}, cache size=${ecoWorkersCache.size}`);
    for (const [companyId, data] of ecoWorkersCache.entries()) {
      if (!data || !data.workers) continue;
      dbg('companyEco', `findWorker: company=${companyId.substring(0,8)}, workers=${data.workers.length}, ids=[${data.workers.map(w => typeof w.userId + ':' + String(w.userId).substring(0,8)).join(',')}]`);
      const worker = data.workers.find(w => {
        const wid = typeof w.userId === 'object' ? (w.userId?._id || w.userId?.id) : w.userId;
        return wid === userId;
      });
      if (worker) return { companyId, worker };
    }
    return null;
  }

  function ecoPoll() {
    if (!companyEcoModalNode || !document.contains(companyEcoModalNode)) {
      companyEcoRafId = null;
      return;
    }
    const inp = companyEcoModalNode.querySelector('input[name="wage"], input[name="newWage"]');
    const v = inp ? inp.value : null;
    if (v !== companyEcoLastWage) {
      companyEcoLastWage = v;
      handleWageInputUpdate();
    }
    companyEcoRafId = requestAnimationFrame(ecoPoll);
  }

  function numF(n, d) { return Number(n).toFixed(d); }

  const ECO_COIN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" ' +
    'style="width:1em;height:1em;display:inline-block;vertical-align:-0.15em;margin-right:2px;' +
    'filter:drop-shadow(1px 1px 0 #000);"><path d="M12 5C7.031 5 2 6.546 2 9.5S7.031 14 12 14c4.97 0 ' +
    '10-1.546 10-4.5S16.97 5 12 5zm-5 9.938v3c1.237.299 2.605.482 4 .541v-3a21.166 21.166 0 0 1-4-.541zm6 ' +
    '.54v3a20.994 20.994 0 0 0 4-.541v-3a20.994 20.994 0 0 1-4 .541zm6-1.181v3c1.801-.755 3-1.857 3-3.297v-3c0 ' +
    '1.44-1.199 2.542-3 3.297zm-14 3v-3C3.2 13.542 2 12.439 2 11v3c0 1.439 1.2 2.542 3 3.297z"></path></svg>';

  function renderNetLine(netLine, wage, rate, resolved, marketData) {
    const label = '<span style="color:#e5e7eb;font-weight:600;">Net (tax excl.):</span> ';
    let valueHTML = '';
    if (rate == null) {
      if (resolved) {
        valueHTML = '<span style="color:#9ca3af;">(no tax data)</span>';
      } else {
        valueHTML = '<span style="color:#9ca3af;">…</span>';
      }
    } else if (isNaN(wage) || wage <= 0) {
      valueHTML = '<span style="color:#9ca3af;">–</span>';
    } else {
      const net = wage * (1 - rate / 100);
      valueHTML = '<span style="color:#f6c944;font-weight:600;">' + ECO_COIN_SVG + net.toFixed(4) + '</span>';
    }

    const badgeHTML = '<span style="border: 1px solid #7c3aed; color: #a78bfa; padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 4px; letter-spacing: 0.5px;">PROST</span>';

    let warnHTML = '';
    if (marketData) {
      if (marketData.type === 'median') {
        warnHTML = '<div style="width:100%; font-size:11px; margin-top:6px; text-align:right;">' + renderWageSparkline(marketData.stats) + '</div>';
        if (isWageUncompetitive(marketData.stats)) {
          warnHTML += '<div style="width:100%; color:#f87171; font-size:11px; font-weight:700; margin-top:2px; text-align:right;">' + t('wageUncompetitive25') + '</div>';
        }
      } else if (marketData.type === 'top3') {
        const fallbackHint = t('wageMedianFallback');
        if (marketData.top3Min !== null && !isNaN(wage) && wage > 0 && wage < marketData.top3Min) {
          warnHTML = '<div style="width:100%; color:#f87171; font-size:11px; font-weight:700; margin-top:6px; text-align:right;">⚠ Uncompetitive (Top 3 min: ' + marketData.top3Min + ') ' + fallbackHint + '</div>';
        } else {
          warnHTML = '<div style="width:100%; color:#9ca3af; font-size:11px; margin-top:6px; text-align:right;">' + fallbackHint + '</div>';
        }
      }
    }

    const newHTML = '<div style="display:flex; justify-content:space-between; align-items:center; width:100%;">' +
                      '<div>' + label + valueHTML + '</div>' + badgeHTML +
                    '</div>' + warnHTML;

    if (netLine.innerHTML !== newHTML) {
      netLine.style.flexWrap = 'wrap'; // allow warnHTML to break to next line
      netLine.innerHTML = newHTML;
    }
  }

  async function regionToCountry(regionId) {
    if (!regionId) return null;
    const cache = readCache(KEYS.ecoRegionData) || {};
    const nowMs = Date.now();
    // Cache valid via global fetch or manual fetch
    if (cache[regionId] && (cache._lastFetch || (cache[regionId].at && nowMs - cache[regionId].at < 7200000))) {
      return cache[regionId].country;
    }
    try {
      const { payload: res } = await resolveApiBase('region.getById', { regionId });
      if (res && res.country) {
        cache[regionId] = { 
          country: res.country, 
          depositEndsAt: res.deposit?.endsAt || null,
          depositType: res.deposit?.type || null,
          strategicResource: res.strategicResource || null,
          at: nowMs 
        };
        writeCache(KEYS.ecoRegionData, cache);
        return res.country;
      }
    } catch (err) {
      console.warn('[PROST] eco: region fetch failed', err);
    }
    return cache[regionId] ? cache[regionId].country : null;
  }

  async function getCountryTax(countryId) {
    if (!countryId) return null;
    const cache = readCache(KEYS.ecoCountryTax) || {};
    const now = Date.now();
    const cached = cache[countryId];
    if (cached && (now - cached.ts < CONFIG.ecoTaxTtlMs)) {
      return cached.data;
    }
    try {
      const { payload: res } = await resolveApiBase('country.getCountryById', { countryId });
      if (res && res.taxes) {
        cache[countryId] = { ts: now, data: res.taxes };
        writeCache(KEYS.ecoCountryTax, cache);
        return res.taxes;
      }
    } catch (err) {
      console.warn('[PROST] eco: getCountryTax fetch failed', err);
    }
    return null;
  }

  async function fetchMarketWages(onPage) {
    let cursor = undefined;
    let allWages = [];
    let pageCount = 0;
    try {
      while (pageCount < 4) {
        const { payload } = await resolveApiBase('workOffer.getWorkOffersPaginated', { limit: 100, cursor });
        if (!payload || !payload.items) break;
        const pageWages = payload.items.map(item => item.wage);
        allWages = allWages.concat(pageWages);
        if (onPage) onPage([...allWages]);
        if (!payload.nextCursor) break;
        cursor = payload.nextCursor;
        pageCount++;
      }
      return allWages;
    } catch (err) {
      console.warn('[PROST] fetchMarketWages error', err);
      return null;
    }
  }

  function isWageUncompetitive(stats) {
    return stats && stats.percentile !== -1 && stats.percentile < 25;
  }

  function computeWageStats(wages, userWage) {
    if (!wages || wages.length === 0) return null;
    const sorted = [...wages].sort((a, b) => a - b);
    const n = sorted.length;
    let median;
    if (n % 2 === 0) {
      median = (sorted[(n / 2) - 1] + sorted[n / 2]) / 2;
    } else {
      median = sorted[Math.floor(n / 2)];
    }

    const hasUserWage = typeof userWage === 'number' && userWage > 0 && !isNaN(userWage);
    const belowOrEqualCount = hasUserWage ? sorted.filter(w => w <= userWage).length : 0;
    const percentile = hasUserWage ? Math.floor((belowOrEqualCount / n) * 100) : -1;

    const p5 = sorted[Math.floor(n * 0.05)];
    const p95 = sorted[Math.floor(n * 0.95)];
    
    const buckets = new Array(20).fill(0);
    let userBucket = -1;
    
    if (p5 === p95) {
      buckets[0] = n;
      if (hasUserWage) userBucket = 0;
    } else {
      for (const w of sorted) {
        let b = Math.floor(((w - p5) / (p95 - p5)) * 20);
        if (b < 0) b = 0;
        if (b > 19) b = 19;
        buckets[b]++;
      }
      if (hasUserWage) {
        let ub = Math.floor(((userWage - p5) / (p95 - p5)) * 20);
        if (ub < 0) ub = 0;
        if (ub > 19) ub = 19;
        userBucket = ub;
      }
    }

    return { median, percentile, buckets, userBucket };
  }

  function renderWageSparkline(stats) {
    if (!stats) return '';
    const blocks = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    let maxCount = Math.max(...stats.buckets);
    if (maxCount === 0) maxCount = 1;

    let sparklineHtml = '';
    for (let i = 0; i < 20; i++) {
      const bCount = stats.buckets[i];
      const intensity = Math.floor((bCount / maxCount) * 8);
      const char = blocks[intensity];
      
      let colorStyle = '';
      if (i < stats.userBucket) {
        colorStyle = 'color: #6b7280;'; // gray
      } else if (i === stats.userBucket) {
        colorStyle = isWageUncompetitive(stats) ? 'color: #ef4444;' : 'color: #22c55e;';
      }
      
      if (colorStyle) {
        sparklineHtml += `<span style="${colorStyle}">${char}</span>`;
      } else {
        sparklineHtml += char;
      }
    }

    if (stats.userBucket !== -1) {
      return t('wageMedianLine', { sparkline: sparklineHtml, pctl: stats.percentile, median: stats.median.toFixed(4) });
    } else {
      return t('wageMedianOnly', { sparkline: sparklineHtml, median: stats.median.toFixed(4) });
    }
  }

  function extractTop3Minimum(modal) {
    // Clone modal and remove injected own-net value to prevent self-pollution
    const clone = modal.cloneNode(true);
    const injectedNet = clone.querySelector('#wia-eco-net-wage');
    if (injectedNet) injectedNet.remove();

    const allText = clone.textContent;
    const idx = allText.toLowerCase().indexOf('top 3');
    if (idx === -1) return null;

    // Look at text *after* "top 3"
    const afterText = allText.substring(idx);

    // Find all numbers formatted as floats (e.g. 0.1150 or DE 0,1150)
    // Note: Assuming wage-range < 1000, so thousands separators are not handled.
    // Also known-open: if each offer row renders >1 float, slice(0,3) is wrong.
    const matches = afterText.match(/\b\d+[,.]\d+\b/g);
    if (!matches || matches.length === 0) return null;

    const numbers = matches.map(s => Number(s.replace(',', '.'))).filter(n => n > 0 && n < 100); // sanity check
    if (numbers.length === 0) return null;

    // the top 3 are usually the first 1-3 numbers found after the text
    const topOffers = numbers.slice(0, 3);
    return Math.min(...topOffers);
  }

  function handleWageInputUpdate() {
    if (!companyEcoModalNode) return;
    const wageInput = companyEcoWageInput;
    const netLine = companyEcoModalNode.querySelector('#wia-eco-net-wage');
    if (!netLine) return;

    const wageStr = wageInput ? wageInput.value : '';
    const wage = parseFloat(wageStr);
    const rate = netLine.dataset.taxRate ? parseFloat(netLine.dataset.taxRate) : null;

    let marketData = null;
    let isUncompetitive = false;

    if (companyEcoMarketWages) {
      const stats = computeWageStats(companyEcoMarketWages, wage);
      if (stats) {
        marketData = { type: 'median', stats };
        isUncompetitive = isWageUncompetitive(stats);
      }
    }
    
    if (!marketData) {
      const top3Min = extractTop3Minimum(companyEcoModalNode);
      marketData = { type: 'top3', top3Min };
      isUncompetitive = top3Min !== null && !isNaN(wage) && wage > 0 && wage < top3Min;
    }

    renderNetLine(netLine, wage, rate, companyEcoTaxResolved, marketData);

    if (wageInput) {
      if (isUncompetitive) {
        wageInput.style.borderColor = '#f87171';
        wageInput.style.borderWidth = '2px';
      } else {
        wageInput.style.borderColor = '';
        wageInput.style.borderWidth = '';
      }
    }

    if (isEditWorkerModal && editWorkerPpSection && companyEcoWorkerData) {
      try {
        const w = companyEcoWorkerData.worker;
        const compId = companyEcoWorkerData.companyId;
        const bonus = ecoBonusCache.get(compId)?.bonus || 0;

        const baseProd = 2.4 * (w.hourlyRegen || 10) * w.maxProd;
        const totalProd = baseProd * (1 + bonus / 100) * (1 + w.fidelity / 100);
        const wageCostDay = baseProd * (isNaN(wage) ? 0 : wage);

        const compDetails = ecoCompanyDetailCache.get(compId)?.data;
        const priceMap = (readCache(KEYS.priceCache) || {}).data;
        let breakdownHtml = '';

        if (compDetails && compDetails.itemCode && priceMap) {
          const itemCode = compDetails.itemCode;
          const normCode = normalizeItemCode(itemCode);
          const sellPrice = priceMap[normCode] || 0;
          const grossDay = totalProd * sellPrice;

          breakdownHtml = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Base PP/day (2.4 &times; ${w.hourlyRegen || 10} &times; ${w.maxProd}):</span>
              <span title="hourlyRegen=${w.hourlyRegen || 10}, maxProd=${w.maxProd}, bonus=${bonus}%, fidelity=${w.fidelity}%">${numF(baseProd, 1)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #a78bfa;">
              <span>Bonus (+${bonus}%) &times; Fidelity (+${w.fidelity}%):</span>
              <span>&times;${numF((1 + bonus / 100) * (1 + w.fidelity / 100), 2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-weight: bold;">
              <span>Total Prod (Items/day):</span>
              <span>${numF(totalProd, 1)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Gross Revenue (sell @ ${numF(sellPrice, 2)}):</span>
              <span style="color: #3fb950;">+${numF(grossDay, 2)} G</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Wage Cost (${numF(wageCostDay / baseProd || 0, 2)}/basePP):</span>
              <span style="color: #f85149;">-${numF(wageCostDay, 2)} G</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); font-weight: bold;">
              <span>Worker Net / day:</span>
              <span style="color: ${grossDay - wageCostDay >= 0 ? '#3fb950' : '#f85149'};">${numF(grossDay - wageCostDay, 2)} G</span>
            </div>
            <div style="text-align: right; margin-top: 4px;"><span style="border: 1px solid #7c3aed; color: #a78bfa; padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 4px; letter-spacing: 0.5px;">PROST</span></div>
          `;
        } else {
          breakdownHtml = `<div style="color: #8b949e; font-style: italic;">Loading company market data...</div>`;
        }

        if (editWorkerPpSection.dataset.hash !== breakdownHtml.length.toString()) {
          editWorkerPpSection.dataset.hash = breakdownHtml.length.toString();
          editWorkerPpSection.innerHTML = breakdownHtml;
        }
      } catch (e) {
        console.warn('[PROST] eco: PP section render failed', e);
      }
    }
  }

  async function fetchCompanyTaxRate(companyId) {
    try {
      let compData = ecoCompanyDetailCache.get(companyId)?.data;
      if (!compData) {
        const res = await resolveApiBase('company.getById', { companyId });
        compData = res.payload;
      }
      if (!compData || !compData.region) return null;
      const countryId = await regionToCountry(compData.region);
      if (!countryId) return null;
      const taxes = await getCountryTax(countryId);
      if (!taxes) return null;
      const income = taxes.income ?? taxes.incomeTax ?? taxes.Income ?? null;
      if (income !== null && income !== undefined) return income;
      return 0;
    } catch (e) {
      console.warn('[PROST] eco: tax fetch failed', e);
    }
    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Company Coworker Energy (Wave 2)
  // ───────────────────────────────────────────────────────────────────────────
  const ecoUserEnergyCache = new Map(); // userId -> { at, data: {cur, total, regen} }
  const ECO_ENERGY_TTL_MS = 60_000;
  let ecoEnergyLoading = false;

  function probeCompanyEnergy() {
    return {
      cacheSize: ecoUserEnergyCache.size,
      loading: ecoEnergyLoading
    };
  }

  async function fetchEcoEnergyBatch(userIds, opts = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];

    const results = Array(userIds.length).fill(null);
    const uncachedIds = [];
    const uncachedIndices = [];

    userIds.forEach((userId, index) => {
      const cached = ecoUserEnergyCache.get(userId);
      if (cached && (now() - cached.at < ECO_ENERGY_TTL_MS)) {
        results[index] = cached.data;
      } else {
        uncachedIds.push(userId);
        uncachedIndices.push(index);
      }
    });

    if (uncachedIds.length > 0) {
      const BATCH_CHUNK_SIZE = 8;
      for (let offset = 0; offset < uncachedIds.length; offset += BATCH_CHUNK_SIZE) {
        const chunkIds = uncachedIds.slice(offset, offset + BATCH_CHUNK_SIZE);
        const chunkIndices = uncachedIndices.slice(offset, offset + BATCH_CHUNK_SIZE);

        await (async () => {
          try {
            const batchArgs = chunkIds.map(userId => ({ userId }));
            const batchResults = await resolveApiBatch('user.getUserById', batchArgs, opts);

            batchResults.forEach((res, i) => {
              const userId = chunkIds[i];
              const origIndex = chunkIndices[i];

              if (res.error) {
                const cached = ecoUserEnergyCache.get(userId);
                results[origIndex] = cached ? cached.data : null;
                return;
              }

              const energy = res.payload?.skills?.energy;
              if (energy) {
                const data = {
                  cur: energy.currentBarValue || 0,
                  total: energy.total || energy.value || 110,
                  regen: energy.hourlyBarRegen || 0
                };
                ecoUserEnergyCache.set(userId, { at: now(), data });
                results[origIndex] = data;
              } else {
                results[origIndex] = null;
              }
            });
          } catch (e) {
            chunkIds.forEach((userId, i) => {
              const origIndex = chunkIndices[i];
              const cached = ecoUserEnergyCache.get(userId);
              results[origIndex] = cached ? cached.data : null;
            });
          }
        })();
      }
    }

    return results;
  }

  function getTargetWorkerSpans(mainWin) {
    const ownId = getCurrentUserId();
    const result = [];

    const links = Array.from(mainWin.querySelectorAll('a[href^="/user/"]'));
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const match = href.match(/^\/user\/([a-f0-9]{24})\/?$/i);
      if (!match) continue;

      const id = match[1];
      if (id === ownId) continue;

      const nameSpan = a.querySelector('span.agd9b40');
      if (nameSpan && nameSpan.textContent.trim().length > 0) {
        let row = a;
        let chipSpan = null;

        while (row && row !== mainWin) {
          // Prevent climbing into the parent list container
          const usersInRow = Array.from(row.querySelectorAll('a[href^="/user/"]')).map(l => l.getAttribute('href'));
          const uniqueUsers = new Set(usersInRow);
          if (uniqueUsers.size > 1) break;

          const svgPath = row.querySelector('svg path[d="M11 15H6L13 1V9H18L11 23V15Z"]');
          if (svgPath) {
            const iconDiv = svgPath.closest('div');
            const chipContainer = iconDiv ? iconDiv.parentElement : null;
            if (chipContainer) {
              const spans = chipContainer.querySelectorAll('span.agd9b40');
              if (spans.length > 0) {
                chipSpan = spans[spans.length - 1]; // get the innermost span
                break;
              }
            }
          }
          row = row.parentElement;
        }

        if (chipSpan) {
          result.push({ id, a, span: chipSpan });
        }
      }
    }
    return result;
  }

  function applyEcoEnergyPills() {
    const mainWin = document.getElementById('main-window');
    if (!mainWin) {
      setHealth('companyEnergy', 'idle', 'no main-window');
      return;
    }

    const targets = getTargetWorkerSpans(mainWin);
    if (targets.length === 0) {
      setHealth('companyEnergy', 'ok', 'no coworkers found');
      return;
    }

    targets.forEach(({ id, span }) => {
      if (span.previousElementSibling && span.previousElementSibling.classList.contains('wia-eco-energy-cur')) {
        return; // already injected
      }

      const cached = ecoUserEnergyCache.get(id);
      if (!cached || !cached.data) return; // Wait for next tick if not loaded

      const data = cached.data;
      const pct = data.total > 0 ? (data.cur / data.total) * 100 : 0;

      let colorClass = '';
      if (pct < 20) {
        colorClass = 'color: #ef4444;'; // red
      } else if (pct <= 75) {
        colorClass = 'color: #f59e0b;'; // amber
      } else {
        colorClass = 'color: #10b981;'; // green
      }

      const curSpan = document.createElement('span');
      curSpan.className = 'wia-eco-energy-cur';
      curSpan.title = `Energy regenerates by ${data.regen}/h`;
      curSpan.dataset.wiaBound = '1';
      curSpan.innerHTML = `${data.cur}/`;
      curSpan.style.cssText = `${colorClass} font-weight: bold; margin-right: 2px;`;

      span.insertAdjacentElement('beforebegin', curSpan);
    });

    setHealth('companyEnergy', 'ok', 'pills rendered');
  }

  function ensureCompanyCoworkersInjected() {
    if (ecoEnergyLoading) return;
    const mainWin = document.getElementById('main-window');
    if (!mainWin) {
      setHealth('companyEnergy', 'idle', 'no main-window');
      return;
    }

    const targets = getTargetWorkerSpans(mainWin);
    if (targets.length === 0) {
      setHealth('companyEnergy', 'ok', 'no coworkers found');
      return;
    }

    let missingPills = false;
    const userIdsToFetch = new Set();

    targets.forEach(({ id, span }) => {
      if (!span.previousElementSibling || !span.previousElementSibling.classList.contains('wia-eco-energy-cur')) {
        const cached = ecoUserEnergyCache.get(id);
        if (!cached || now() - cached.at >= ECO_ENERGY_TTL_MS) {
          userIdsToFetch.add(id);
        }
        missingPills = true;
      }
    });

    if (userIdsToFetch.size > 0 && !ecoEnergyLoading) {
      ecoEnergyLoading = true;
      setHealth('companyEnergy', 'ok', 'fetching data');
      fetchEcoEnergyBatch(Array.from(userIdsToFetch))
        .catch(e => { setHealth('companyEnergy', 'warn', e.message); })
        .finally(() => { ecoEnergyLoading = false; })
        .then(() => guard('companyEnergy', applyEcoEnergyPills));
    } else if (missingPills) {
      guard('companyEnergy', applyEcoEnergyPills);
    } else {
      setHealth('companyEnergy', 'ok', 'pills injected');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Company Profit & Portfolio (Wave 3)
  // ───────────────────────────────────────────────────────────────────────────
  const ecoCompanyListCache = { at: 0, ids: [] };
  const ecoCompanyDetailCache = new Map();
  const ecoRecipesCache = { at: 0, recipes: null };
  let ecoProfitLoading = false;
  let ecoTaxReinjectPending = false;

  async function fetchGameConfig() {
    if (ecoRecipesCache.recipes && (now() - ecoRecipesCache.at < CONFIG.ecoRecipeTtlMs)) return ecoRecipesCache.recipes;
    try {
      const { payload } = await resolveApiBase('gameConfig.getGameConfig', {});
      if (payload && payload.items) {
        const recipes = {};
        for (const [code, item] of Object.entries(payload.items)) {
          if (item.type === 'product' && item.productionNeeds) {
            // keep ALL inputs (recipes can need more than one material)
            const inputs = Object.entries(item.productionNeeds).map(([ic, q]) => ({ code: ic, qty: q }));
            if (inputs.length > 0) {
              recipes[code] = { inputs, productionPoints: item.productionPoints };
            } else {
              recipes[code] = { inputs: [], productionPoints: item.productionPoints };
            }
          } else if (item.type === 'raw' || item.type === 'product') {
            recipes[code] = { inputs: [], productionPoints: item.productionPoints };
          }
        }
        ecoRecipesCache.recipes = recipes;
        // stash the automatedEngine level table so we can read the real dailyProd
        ecoRecipesCache.engineLevels = payload.upgradesConfig?.automatedEngine?.levels || null;
        ecoRecipesCache.at = now();
        return recipes;
      }
    } catch (e) { console.warn('[PROST] eco: fetchGameConfig failed', e); }
    return ecoRecipesCache.recipes;
  }

  // Authoritative owned-company set (excludes the "Job" company you only work at).
  const ecoOwnedCache = { at: 0, userId: null, ids: null };

  function ecoProfileUserId() {
    const m = /^\/user\/([a-f0-9]{24})\/companies/i.exec(getPagePathname());
    return m ? m[1] : getCurrentUserId();
  }

  async function fetchOwnedCompanyIds(userId) {
    if (!userId) return ecoOwnedCache.ids || new Set();
    if (ecoOwnedCache.ids && ecoOwnedCache.userId === userId && now() - ecoOwnedCache.at < CONFIG.ecoDetailTtlMs) {
      return ecoOwnedCache.ids;
    }
    try {
      const { payload } = await resolveApiBase('company.getCompanies', { userId, perPage: 100 });
      const items = (payload && payload.items) || [];
      const parsedIds = items.map(item => typeof item === 'object' ? item._id : item).filter(Boolean);
      ecoOwnedCache.ids = new Set(parsedIds);
      ecoOwnedCache.userId = userId;
      ecoOwnedCache.at = now();
    } catch (e) { console.warn('[PROST] eco: getCompanies failed', e); }
    return ecoOwnedCache.ids || new Set();
  }

  async function fetchCompanyDetailBatch(companyIds) {
    const uncachedIds = companyIds.filter(id => {
      const cached = ecoCompanyDetailCache.get(id);
      return !(cached && now() - cached.at < CONFIG.ecoDetailTtlMs);
    });

    if (uncachedIds.length > 0) {
      try {
        const batchArgs = uncachedIds.map(id => ({ companyId: id }));
        const [batchResults, bonusResults] = await Promise.all([
          resolveApiBatch('company.getById', batchArgs),
          resolveApiBatch('company.getProductionBonus', batchArgs)
        ]);
        batchResults.forEach((res, i) => {
          if (res?.payload) {
            ecoCompanyDetailCache.set(uncachedIds[i], { at: now(), data: res.payload });
          }
        });
        bonusResults.forEach((res, i) => {
          if (res?.payload) {
            ecoBonusCache.set(uncachedIds[i], { at: now(), bonus: res.payload.total || 0 });
          }
        });
      } catch (e) { console.warn('[PROST] eco: detail batch fetch failed', e); }
    }
  }

  const ecoWorkersCache = new Map();
  const ecoBonusCache = new Map();

  async function fetchCompanyWorkersBatch(companyIds) {
    if (!getToken()) return; 
    try {
       const workerArgs = companyIds.map(id => ({ companyId: id }));
       const workerResponses = await resolveApiBatch('worker.getWorkers', workerArgs);
       
       const userIds = new Set();
       const companyWorkers = {};
       const ownId = getCurrentUserId();
       
       for (let i = 0; i < companyIds.length; i++) {
         const res = workerResponses[i];
         const id = companyIds[i];
         companyWorkers[id] = [];
         if (res?.payload?.workers) {
            for (const w of res.payload.workers) {
              const wUserId = typeof w.user === 'object' ? (w.user?._id || w.user?.id || String(w.user)) : w.user;
              if (wUserId !== ownId) {
                userIds.add(wUserId);
                companyWorkers[id].push({ ...w, user: wUserId });
              }
            }
         }
       }
       
       const userArray = Array.from(userIds);
       const userProdMap = {};
       const userRegenMap = {};
       if (userArray.length > 0) {
          const userArgs = userArray.map(u => ({ userId: u }));
          const userResponses = await resolveApiBatch('user.getUserById', userArgs);
          for (let i = 0; i < userArray.length; i++) {
             const uRes = userResponses[i];
             if (uRes?.payload?.skills) {
                userProdMap[userArray[i]] = uRes.payload.skills.production?.total || 0;
                userRegenMap[userArray[i]] = uRes.payload.skills.energy?.hourlyBarRegen || 10;
             }
          }
       }
       
       const nowMs = now();
       for (const id of companyIds) {
          const finalWorkers = [];
          for (const w of companyWorkers[id]) {
             finalWorkers.push({
                userId: w.user,
                wage: w.wage || 0,
                fidelity: w.fidelity || 0,
                maxProd: userProdMap[w.user] || 0,
                hourlyRegen: userRegenMap[w.user] || 10
             });
          }
          ecoWorkersCache.set(id, { at: nowMs, workers: finalWorkers });
       }
    } catch (e) {
       console.warn('[PROST] eco: worker batch fetch failed', e);
    }
  }



  function ecoIdsOnPage(mainWin) {
    const on = [];
    const links = mainWin.querySelectorAll('a[href^="/company/"]');
    for (const l of links) {
      const m = l.getAttribute('href').match(/^\/company\/([a-f0-9]{24})$/);
      if (m && !on.includes(m[1])) on.push(m[1]);
    }
    return on;
  }

  function ensureCompanyProfitInjected() {
    if (!isCompaniesPage()) { setHealth('companyProfit', 'idle', 'not on companies list'); return; }
    if (ecoProfitLoading) return;
    const mainWin = document.getElementById('main-window');
    if (!mainWin) { setHealth('companyProfit', 'idle', 'no main-window'); return; }
    if (!mainWin.querySelector('a[href^="/company/"]')) { setHealth('companyProfit', 'idle', 'no company cards'); return; }

    const userId = ecoProfileUserId();
    const ownedReady = ecoOwnedCache.ids && ecoOwnedCache.userId === userId &&
                       now() - ecoOwnedCache.at < CONFIG.ecoDetailTtlMs;

    const pageIds = ecoIdsOnPage(mainWin);
    let needDetail = !ownedReady;
    let needWorkers = false;
    for (const id of pageIds) {
      const d = ecoCompanyDetailCache.get(id);
      if (!d || now() - d.at >= CONFIG.ecoDetailTtlMs) { needDetail = true; }
      if (getToken()) {
        const w = ecoWorkersCache.get(id);
        if (!w || now() - w.at >= CONFIG.ecoDetailTtlMs) needWorkers = true;
      }
    }

    if (needDetail || needWorkers) {
      ecoProfitLoading = true;
      setHealth('companyProfit', 'ok', 'fetching data');
      (async () => {
        await Promise.all([fetchPrices(false), fetchGameConfig(), fetchOwnedCompanyIds(userId)]);
        const detailsToFetch = pageIds.filter(id => {
          const d = ecoCompanyDetailCache.get(id);
          return !d || now() - d.at >= CONFIG.ecoDetailTtlMs;
        });
        const workersToFetch = getToken() ? pageIds.filter(id => {
          const w = ecoWorkersCache.get(id);
          return !w || now() - w.at >= CONFIG.ecoDetailTtlMs;
        }) : [];
        
        const tasks = [];
        if (detailsToFetch.length) tasks.push(fetchCompanyDetailBatch(detailsToFetch));
        if (workersToFetch.length) tasks.push(fetchCompanyWorkersBatch(workersToFetch));
        await Promise.all(tasks);
      })().finally(() => {
        ecoProfitLoading = false;
        guard('companyProfit', injectCompanyProfits);
        const mw = document.getElementById('main-window');
        if (mw) guard('netWages', () => injectNetWagesLoop(mw));
      });
    } else {
      guard('companyProfit', injectCompanyProfits);
      const mw = document.getElementById('main-window');
      if (mw) guard('netWages', () => injectNetWagesLoop(mw));
    }
  }

  // Compute the pre-wage engine estimate for one owned company. Returns null if
  // we can't price it yet (no market price / recipe / detail not loaded).
  function ecoComputeNet(id, chipEl, prices, recipes, engineLevels, regionCache, taxCache) {
    const details = ecoCompanyDetailCache.get(id)?.data;
    if (!details) return null;
    if (details.user !== ecoProfileUserId()) return { skip: true };
    if (details.disabledAt) return { disabled: true };
    const recipe = recipes[details.itemCode];
    if (!recipe) return null;

    const sellPrice = prices[normalizeItemCode(details.itemCode)] || 0;
    
    // market/sell tax (lazy: kick off region→country→tax resolution if missing)
    const regionObj = regionCache[details.region];
    const countryId = regionObj?.country;
    let endsAt = regionObj?.depositEndsAt || null;
    let depType = regionObj?.depositType || null;
    let isStrategic = false;

    if (!endsAt && regionObj?.strategicResource) {
      const now = new Date();
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
      endsAt = nextMonth.toISOString();
      depType = regionObj.strategicResource;
      isStrategic = true;
    }
    
    let marketTax = 0;
    let taxKnown = !!(regionObj && countryId && taxCache[countryId]?.data);

    // If region is completely missing, kick off a background fetch
    if (details.region && !regionObj) {
      regionToCountry(details.region);
    }

    // Pre-load country tax in background (needed for net wage calculation)
    if (countryId && !(taxCache[countryId]?.data)) {
      getCountryTax(countryId);
    }

    if (sellPrice <= 0) return { priced: false, depositEndsAt: endsAt, depositType: depType, isStrategicResource: isStrategic };

    let matCost = 0;
    for (const inp of recipe.inputs) matCost += inp.qty * (prices[normalizeItemCode(inp.code)] || 0);

    const bonus = ecoBonusCache.get(id)?.bonus || 0;
    const lvl = details.activeUpgradeLevels?.automatedEngine || 0;
    const engineDaily = engineLevels?.[lvl]?.stats?.dailyProd || 0;

    if (engineDaily === 0) return { priced: false, depositEndsAt, depositType };

    const perItemNet = sellPrice * (1 - marketTax / 100) - matCost;
    let workerPointsPerDay = 0;
    let workerWagesPerDay = 0;
    if (getToken()) {
      const cachedWorkers = ecoWorkersCache.get(id);
      if (cachedWorkers) {
        for (const w of cachedWorkers.workers) {
          if (w.maxProd > 0) {
            // Ein Click = 10 Energy, 1 Tag = 24 * hourlyRegen.
            // Die BaseProd pro Tag ist (24 * hourlyRegen / 10) * w.maxProd
            const baseProd = (2.4 * (w.hourlyRegen || 10)) * w.maxProd;
            const totalProd = baseProd * (1 + bonus / 100) * (1 + w.fidelity / 100);
            workerPointsPerDay += totalProd;
            workerWagesPerDay += baseProd * w.wage;
          }
        }
      }
    }

    const engineDailyPoints = engineDaily * (1 + bonus / 100);
    const pointsPerDay = engineDailyPoints + workerPointsPerDay;
    const dayItems = recipe.productionPoints ? pointsPerDay / recipe.productionPoints : 0;
    const net = (perItemNet * dayItems) - workerWagesPerDay;

    // storage runway: the DOM production bar shows "current / maxCap" (points).
    // once full, the Automated Engine stops → hoursToFull = (cap − current)/pointsPerDay.
    const hoursToFull = ecoStorageHoursToFull(id, pointsPerDay);

    return { 
      priced: true, net, sellPrice, marketTax, matCost, perItemNet, engineDaily, bonus, pointsPerDay, 
      engineDailyPoints, workerPointsPerDay, workerWagesPerDay,
      dayItems, taxKnown, hoursToFull, itemCode: details.itemCode, inputs: recipe.inputs,
      depositEndsAt: endsAt, depositType: depType, isStrategicResource: isStrategic
    };
  }

  // Parse a game number span like "800", "1K", "1.5K", "2M" → Number.
  function ecoParseNum(s) {
    const m = /([\d.]+)\s*([KM]?)/i.exec(String(s || '').replace(/[,\s/]/g, ''));
    if (!m) return 0;
    let n = parseFloat(m[1]);
    const u = m[2].toUpperCase();
    if (u === 'K') n *= 1e3; else if (u === 'M') n *= 1e6;
    return n;
  }

  // Hours until the Automated Engine fills the production storage. null if unknown,
  // 0 if already full, Infinity if the engine isn't producing.
  function ecoStorageHoursToFull(id, pointsPerDay) {
    const cur = document.getElementById('company-production-' + id);
    if (!cur) return null;
    const capSpan = cur.nextElementSibling;         // the "/800" (or "/1K") span
    if (!capSpan) return null;
    const current = ecoParseNum(cur.textContent);   // accumulated points now
    const cap = ecoParseNum(capSpan.textContent);   // storage capacity
    if (!(cap > 0)) return null;
    if (current >= cap) return 0;
    if (!(pointsPerDay > 0)) return Infinity;
    return ((cap - current) / pointsPerDay) * 24;
  }

  function ecoRenderBadge(chipEl, d) {
    if (d && (d.disabled || d.skip)) {
      const p = chipEl.querySelector(':scope > .wia-eco-profit-badge');
      if (p) p.remove();
      const s = chipEl.querySelector(':scope > .wia-eco-storage-badge');
      if (s) s.remove();
      const db = chipEl.querySelector(':scope > .wia-eco-deposit-badge');
      if (db) db.remove();
      return;
    }

    let profitBadge = chipEl.querySelector(':scope > .wia-eco-profit-badge');
    const pos = d && d.priced && d.net >= 0;
    const sigProfit = (d && d.priced) ? (pos ? '+' : '') + d.net.toFixed(1) : 'na';

    if (!profitBadge) {
      profitBadge = document.createElement('span');
      profitBadge.className = 'wia-eco-profit-badge';
      profitBadge.style.cssText = 'margin-left:6px; padding:0 5px; border-radius:4px; font-weight:700; font-size:0.82em; display:inline-flex; align-items:center; gap:2px; cursor:help; background:rgba(0,0,0,0.35);';
      chipEl.appendChild(profitBadge);
    }

    if (profitBadge.dataset.sig !== sigProfit) {
      profitBadge.dataset.sig = sigProfit;
      if (d && d.priced) {
        profitBadge.style.color = pos ? '#4ade80' : '#f87171';
        profitBadge.innerHTML = ECO_COIN_SVG + (pos ? '+' : '') + d.net.toFixed(1) + '/d';
        let workerStr = '';
        if (d.workerPointsPerDay > 0) {
          workerStr = `🏭 Engine: ${d.engineDailyPoints.toFixed(0)} PP/day\n` +
                      `👷 Workers: ${d.workerPointsPerDay.toFixed(0)} PP/day\n` +
                      `Total Throughput: ${d.pointsPerDay.toFixed(0)} PP/day → ${d.dayItems.toFixed(1)} items/day\n` +
                      `Gross: ${d.perItemNet.toFixed(3)} × ${d.dayItems.toFixed(1)} = ${(d.perItemNet * d.dayItems).toFixed(1)}/day\n` +
                      `💸 Wages: -${d.workerWagesPerDay.toFixed(1)}/day\n` +
                      `Net: ${(d.perItemNet * d.dayItems).toFixed(1)} − ${d.workerWagesPerDay.toFixed(1)} = ${d.net.toFixed(1)}/day`;
        } else {
          workerStr = `Throughput: ${d.engineDaily} PP ×(1+${d.bonus}%) = ${d.pointsPerDay.toFixed(0)} PP/day → ${d.dayItems.toFixed(1)} items/day\n` +
                      `Net: ${d.perItemNet.toFixed(3)} × ${d.dayItems.toFixed(1)} = ${d.net.toFixed(1)}/day`;
        }

        profitBadge.title = 'Est. net/day\n' +
          `Per item: ${d.sellPrice.toFixed(3)} sell − ${d.matCost.toFixed(3)} mat = ${d.perItemNet.toFixed(3)}\n` +
          workerStr +
          (d.taxKnown ? '' : '\n(tax still loading…)');
      } else {
        profitBadge.style.color = '#9ca3af';
        profitBadge.innerHTML = '—/d';
        profitBadge.title = 'No market price for this item — profit unknown';
      }
    }

    let storageBadge = chipEl.querySelector(':scope > .wia-eco-storage-badge');
    const h = d ? d.hoursToFull : null;
    if (h == null || h === Infinity) {
      if (storageBadge) storageBadge.remove();
      return;
    }

    const isFull = h <= 0;
    const txt = isFull ? 'FULL' : (h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);
    const warn = isFull || h < 3;
    const sigStore = txt + '|' + warn;

    if (!storageBadge) {
      storageBadge = document.createElement('span');
      storageBadge.className = 'wia-eco-storage-badge';
      storageBadge.style.cssText = 'margin-left:4px; padding:0 5px; border-radius:4px; font-weight:700; font-size:0.82em; display:inline-flex; align-items:center; gap:3px; cursor:help; background:rgba(0,0,0,0.35);';
      chipEl.appendChild(storageBadge);
    }

    if (storageBadge.dataset.sig !== sigStore) {
      storageBadge.dataset.sig = sigStore;
      storageBadge.style.color = isFull ? '#f87171' : (warn ? '#facc15' : '#9ca3af');
      const boxSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
      storageBadge.innerHTML = boxSvg + txt;
      let titleTxt = isFull ? 'Storage FULL — collect (PRODUCE) to keep producing' : `Storage full in ${txt} (engine stops until you collect)`;
      if (d && typeof d.workerPointsPerDay === 'number' && d.workerPointsPerDay > 0 && d.engineDailyPoints > 0) {
        titleTxt += `\n\nFills faster due to workers:\nEngine: +${d.engineDailyPoints.toFixed(0)} pts/day\nWorkers: +${d.workerPointsPerDay.toFixed(0)} pts/day`;
      }
      storageBadge.title = titleTxt;
    }

    let depositBadge = chipEl.querySelector(':scope > .wia-eco-deposit-badge');
    if (d && d.depositEndsAt) {
      const rem = Math.max(0, new Date(d.depositEndsAt) - Date.now());
      if (rem > 0) {
        const hrs = (rem / 3600000).toFixed(1);
        const depWarn = rem < 3600000 * 24; // yellow if < 24h
        const sigDep = hrs + '|' + (d.depositType || '');
        if (!depositBadge) {
          depositBadge = document.createElement('span');
          depositBadge.className = 'wia-eco-deposit-badge';
          depositBadge.style.cssText = 'margin-left:4px; padding:0 5px; border-radius:4px; font-weight:700; font-size:0.82em; display:inline-flex; align-items:center; gap:3px; cursor:help; background:rgba(0,0,0,0.35);';
          chipEl.appendChild(depositBadge);
        }
        if (depositBadge.dataset.sig !== sigDep) {
          depositBadge.dataset.sig = sigDep;
          depositBadge.style.color = depWarn ? '#facc15' : '#9ca3af';
          const depType = d.depositType || 'unknown';
          const iconUrl = d.isStrategicResource 
            ? `https://media.warera.io/images/strategicResources/${depType}.png` 
            : `https://assets.warera.io/assets/items/${depType}.png`;
          depositBadge.innerHTML = `<img src="${iconUrl}" style="width:12px;height:12px;object-fit:contain;filter:drop-shadow(1px 1px 0 #000);"> ${hrs}h`;
          depositBadge.title = d.isStrategicResource 
            ? `Strategic region resource (${depType}) rotates in ${hrs} hours` 
            : `Temporary region deposit (${depType}) expires in ${hrs} hours`;
        }
      } else if (depositBadge) depositBadge.remove();
    } else if (depositBadge) depositBadge.remove();
  }

  // The outermost block of the first company card = climb from the first company
  // link until going one level higher would swallow a second card. Route/text-agnostic.
  function ecoCompanyIdOf(el) {
    const m = /^\/company\/([a-f0-9]{24})/.exec(el.getAttribute('href') || '');
    return m ? m[1] : null;
  }

  function ecoFirstCardBlock(mainWin) {
    const owned = ecoOwnedCache.ids;
    const links = Array.from(mainWin.querySelectorAll('a[href^="/company/"]'));
    const profileUid = ecoProfileUserId();
    // first OWNED company link in DOM order (skips the top "Job" company)
    let first = null, firstId = null;
    for (const a of links) {
      const id = ecoCompanyIdOf(a);
      if (id && (!owned || owned.has(id))) {
        const detail = ecoCompanyDetailCache.get(id)?.data;
        if (detail && detail.user !== profileUid) continue;
        first = a; firstId = id; break;
      }
    }
    if (!first) return null;
    // climb until going higher would swallow a DIFFERENT company's card
    // (a card has several same-id /company/ links: icon, title, chip row — ignore those)
    let card = first;
    for (let i = 0; i < 15 && card.parentElement && card.parentElement !== mainWin; i++) {
      const p = card.parentElement;
      const swallowsOtherCard = Array.from(p.querySelectorAll('a[href^="/company/"]'))
        .some(l => !card.contains(l) && ecoCompanyIdOf(l) && ecoCompanyIdOf(l) !== firstId);
      if (swallowsOtherCard) break;
      card = p;
    }
    return card;
  }

  // Flat strip that blends under the "Companies" heading (no tile).
  function ecoRenderStrip(mainWin, shown, earning, losing, total, deactivated = 0) {
    let strip = document.getElementById('wia-eco-portfolio-strip');
    if (!strip) {
      const firstCard = ecoFirstCardBlock(mainWin);
      if (!firstCard || !firstCard.parentNode) return;
      strip = document.createElement('div');
      strip.id = 'wia-eco-portfolio-strip';
      strip.style.cssText = 'display:flex; align-items:center; gap:12px; width:100%; padding:4px 2px 12px; font-size:13px;';
      firstCard.parentNode.insertBefore(strip, firstCard);
    }
    const totPos = total >= 0;
    const sig = shown + '|' + earning + '|' + losing + '|' + total.toFixed(1) + '|' + deactivated;
    if (strip.dataset.wiaSig === sig) return;
    strip.dataset.wiaSig = sig;

    const deactHtml = deactivated > 0 
      ? ' · <span style="color:#9aa4b2;">' + deactivated + ' deactivated</span>'
      : '';

    strip.innerHTML =
      '<span style="color:#9aa4b2; font-weight:600;">Companies · daily net</span>' +
      '<span style="display:flex; align-items:center; gap:14px; margin-left:auto;">' +
        '<span style="font-size:12px;"><span style="color:#4ade80;">' + earning + ' profitable</span>' +
        ' · <span style="color:#f87171;">' + losing + ' losing</span>' + deactHtml + '</span>' +
        '<span style="font-weight:700; color:' + (totPos ? '#4ade80' : '#f87171') + '; display:inline-flex; align-items:center; gap:3px;">' +
          ECO_COIN_SVG + (totPos ? '+' : '') + total.toFixed(1) + '/day</span>' +
        '<span style="font-size:9px; font-weight:700; letter-spacing:.5px; color:#a78bfa; opacity:.75;">PROST</span>' +
      '</span>';
  }

  // Augment the native top-bar inventory numbers in-place with the daily net
  // balance (like the coworker energy chip): a small colored "+N/d" / "-N/d"
  // appended after each item's own count. No separate tile.
  function ecoAugmentInventory(mainWin, balances) {
    const coinPath = Array.from(mainWin.querySelectorAll('svg path'))
      .find(p => p.getAttribute('d')?.startsWith('M12 5C7.031'));
    if (!coinPath) return;
    let topBar = coinPath;
    for (let i = 0; i < 4 && topBar; i++) topBar = topBar.parentElement;
    if (!topBar) return;

    for (const img of topBar.querySelectorAll('img[alt]')) {
      const code = img.getAttribute('alt');
      if (!code) continue;
      // the native count span nearest the icon (digits/commas/dots only)
      let numSpan = null, node = img;
      for (let i = 0; i < 6 && node && !numSpan; i++) {
        node = node.parentElement;
        if (!node) break;
        const spans = Array.from(node.querySelectorAll('span'));
        for (let j = spans.length - 1; j >= 0; j--) {
          if (/^[\d.,]+$/.test(spans[j].textContent.trim())) { numSpan = spans[j]; break; }
        }
      }
      if (!numSpan) continue;
      const host = numSpan.parentElement || numSpan;

      const bal = balances[code];
      let tag = host.querySelector(':scope > .wia-eco-inv-net');
      if (bal == null || Math.abs(bal) < 0.1) { if (tag) tag.remove(); continue; }

      const pos = bal >= 0;
      const sig = (pos ? '+' : '') + bal.toFixed(1);
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'wia-eco-inv-net';
        tag.style.cssText = 'margin-left:4px; font-size:0.8em; font-weight:700; white-space:nowrap;';
        tag.title = 'PROST — est. net/day from your companies (before wages)';
        host.appendChild(tag);
      }
      if (tag.dataset.sig !== sig) {
        tag.dataset.sig = sig;
        tag.style.color = pos ? '#4ade80' : '#f87171';
        tag.textContent = (pos ? '+' : '') + bal.toFixed(1) + '/d';
      }
    }
  }

  function ecoCalcNetWage(grossWage, companyId) {
    const details = ecoCompanyDetailCache.get(companyId)?.data;
    if (!details?.region) return null;
    const regionObj = (readCache(KEYS.ecoRegionData) || {})[details.region];
    if (!regionObj?.country) return null;
    const taxData = (readCache(KEYS.ecoCountryTax) || {})[regionObj.country]?.data;
    if (!taxData) return null;
    const incomeTax = taxData.income || 0;
    return grossWage * (1 - incomeTax / 100);
  }

  const ecoPendingTaxes = new Set();
  async function ensureCompanyTaxReady(companyId) {
    let details = ecoCompanyDetailCache.get(companyId)?.data;
    if (!details) {
      await fetchCompanyDetailBatch([companyId]);
      details = ecoCompanyDetailCache.get(companyId)?.data;
    }
    if (!details?.region) return;
    let regionObj = (readCache(KEYS.ecoRegionData) || {})[details.region];
    if (!regionObj) {
      await regionToCountry(details.region);
      regionObj = (readCache(KEYS.ecoRegionData) || {})[details.region];
    }
    if (!regionObj?.country) return;
    let taxData = (readCache(KEYS.ecoCountryTax) || {})[regionObj.country]?.data;
    if (!taxData) {
      await getCountryTax(regionObj.country);
    }
  }

  function injectNetWagesLoop(mainWin) {
    if (!mainWin) return;
    const ownUserId = getCurrentUserId();
    const links = mainWin.querySelectorAll('a[href^="/company/"]');
    
    for (const link of links) {
      const compId = ecoCompanyIdOf(link);
      if (!compId) continue;

      let cardEl = link;
      for (let i = 0; i < 8 && cardEl.parentElement; i++) {
        const p = cardEl.parentElement;
        
        // Prevent climbing too high and accidentally swallowing global page wrappers (like the Inventory top-bar).
        if (p === mainWin || p.parentElement === mainWin) break;

        const swallowsOther = Array.from(p.querySelectorAll('a[href^="/company/"]'))
          .some(l => !cardEl.contains(l) && ecoCompanyIdOf(l) && ecoCompanyIdOf(l) !== compId);
        if (swallowsOther) break;
        cardEl = p;
      }

      const coinSvgs = cardEl.querySelectorAll('svg path[d^="M12 5C7.031"]');
      for (const p of coinSvgs) {
        const svg = p.closest('svg');
        if (!svg || svg.closest('.wia-eco-profit-badge') || svg.closest('.wia-worker-net-wage')) continue;

        // Ensure it's an employee row (has a user link) and skip the current user's own row.
        let row = svg.parentElement;
        let isOwnRow = false;
        let hasUserLink = false;
        let isJobOffer = false;
        for (let i = 0; i < 6 && row && row !== cardEl; i++) {
          if (row.textContent && /current offer|aktuelles angebot|slots/i.test(row.textContent)) {
            isJobOffer = true;
          }
          const userLink = row.querySelector('a[href^="/user/"]');
          if (userLink) {
            hasUserLink = true;
            if (ownUserId && userLink.getAttribute('href') === '/user/' + ownUserId) {
              isOwnRow = true;
            }
            break;
          }
          row = row.parentElement;
        }
        if (isOwnRow || isJobOffer || !hasUserLink) continue;

        let val = NaN;
        let anchorEl = null;
        let current = svg;
        while (current && current !== cardEl) {
          const parent = current.parentElement;
          if (!parent) break;
          for (const child of parent.childNodes) {
            if (child === current || (child.contains && child.contains(svg))) continue;
            const t = (child.textContent || '').replace(/[^\d.]/g, '');
            if (t) {
              const n = parseFloat(t);
              if (!isNaN(n) && n > 0 && n < 10) {
                val = n;
                anchorEl = child;
                break;
              }
            }
          }
          if (!isNaN(val)) break;
          current = parent;
        }

        if (isNaN(val) || !anchorEl) continue;
        let hasInjected = false;
        if (anchorEl.nodeType === 1) {
          hasInjected = !!anchorEl.querySelector('.wia-worker-net-wage');
        } else {
          hasInjected = anchorEl.nextSibling && anchorEl.nextSibling.classList && anchorEl.nextSibling.classList.contains('wia-worker-net-wage');
        }
        if (hasInjected) continue;
        
        
        const net = ecoCalcNetWage(val, compId);
        if (net != null) {
          const span = document.createElement('span');
          span.className = 'wia-worker-net-wage';
          span.style.cssText = 'color: #8b949e; font-size: 0.85em; margin-left: 4px; font-weight: normal;';
          span.innerHTML = `(${ECO_COIN_SVG}${numF(net, 3)})`;
          span.title = 'Net wage (after income tax)';
          if (anchorEl.nodeType === 1) {
            anchorEl.appendChild(span);
          } else if (anchorEl.parentNode) {
            anchorEl.parentNode.insertBefore(span, anchorEl.nextSibling);
          }
        } else if (!ecoPendingTaxes.has(compId)) {
          ecoPendingTaxes.add(compId);
          ensureCompanyTaxReady(compId).then(() => {
            ecoPendingTaxes.delete(compId);
            const mw = document.getElementById('main-window');
            if (mw) guard('netWages', () => injectNetWagesLoop(mw));
          }).catch(() => {
            ecoPendingTaxes.delete(compId);
          });
        }
      }
    }
  }

  function injectCompanyProfits() {
    const mainWin = document.getElementById('main-window');
    if (!mainWin) return;

    const prices = readCache(KEYS.priceCache)?.data || {};
    const recipes = ecoRecipesCache.recipes || {};
    const engineLevels = ecoRecipesCache.engineLevels || null;
    const regionCache = readCache(KEYS.ecoRegionData) || {};
    const taxCache = readCache(KEYS.ecoCountryTax) || {};

    let total = 0, earning = 0, losing = 0, shown = 0, deactivated = 0, taxPending = false;
    const balances = {};

    for (const id of ecoIdsOnPage(mainWin)) {
      const links = Array.from(mainWin.querySelectorAll('a[href="/company/' + id + '"]'));
      // the chip-row link is the one carrying the %-chips (bonus/tax); title link has none
      const chipEl = links.find(l => /\d%/.test(l.textContent)) || links[0];
      if (!chipEl) continue;

      const d = ecoComputeNet(id, chipEl, prices, recipes, engineLevels, regionCache, taxCache);
      ecoRenderBadge(chipEl, d);
      if (d && d.skip) {
        continue;
      } else if (d && d.disabled) {
        deactivated++;
      } else if (d && d.priced) {
        total += d.net; shown++;
        if (d.net >= 0) earning++; else losing++;
        if (!d.taxKnown) taxPending = true;

        balances[d.itemCode] = (balances[d.itemCode] || 0) + d.dayItems;
        for (const inp of d.inputs) {
          balances[inp.code] = (balances[inp.code] || 0) - (d.dayItems * inp.qty);
        }
      }
    }

    if (shown > 0 || deactivated > 0) ecoRenderStrip(mainWin, shown, earning, losing, total, deactivated);

    ecoAugmentInventory(mainWin, balances);

    setHealth('companyProfit', shown > 0 ? 'ok' : 'idle', shown > 0 ? 'profits injected' : 'no priced owned cards');

    // tax resolves via async region→country→tax; re-render once it lands even on a static page
    if (taxPending && !ecoTaxReinjectPending) {
      ecoTaxReinjectPending = true;
      setTimeout(() => {
        ecoTaxReinjectPending = false;
        guard('companyProfit', injectCompanyProfits);
        const mw = document.getElementById('main-window');
        if (mw) guard('netWages', () => injectNetWagesLoop(mw));
      }, 1600);
    }
  }

  function checkCompanyEcoModal() {
    const modals = document.querySelectorAll('div[id^="headlessui-dialog-panel-"]');
    let modal = null;
    let titleStr = '';
    for (const m of modals) {
      if (m.getAttribute('data-headlessui-state') !== 'open') continue;
      const titleSpan = Array.from(m.querySelectorAll('span')).find(s => {
        const t = s.textContent.trim().toLowerCase();
        return t === 'new job offer' || t.startsWith('edit worker');
      });
      if (titleSpan) {
        modal = m;
        titleStr = titleSpan.textContent.trim().toLowerCase();
        break;
      }
    }

    if (!modal) {
      if (companyEcoModalNode && !companyEcoTeardownTimer) {
        companyEcoTeardownTimer = setTimeout(() => {
          companyEcoTeardownTimer = null;
          const stillOpen = Array.from(document.querySelectorAll('div[id^="headlessui-dialog-panel-"]'))
            .some(m => m.getAttribute('data-headlessui-state') === 'open' &&
              Array.from(m.querySelectorAll('span')).some(s => {
                const t = s.textContent.trim().toLowerCase();
                return t === 'new job offer' || t.startsWith('edit worker');
              }));
          if (!stillOpen) teardownCompanyEco();
        }, 200);
      }
      return;
    }
    if (companyEcoTeardownTimer) {
      clearTimeout(companyEcoTeardownTimer);
      companyEcoTeardownTimer = null;
    }

    companyEcoModalNode = modal;
    isEditWorkerModal = titleStr.startsWith('edit worker');
    
    companyEcoWageInput = modal.querySelector('input[name="wage"], input[name="newWage"]');
    
    let companyId = null;
    if (isEditWorkerModal) {
      const profileLink = modal.querySelector('a[href^="/user/"]');
      const workerUserId = profileLink ? profileLink.getAttribute('href').split('/user/')[1] : null;
      if (workerUserId) {
        companyEcoWorkerData = ecoFindWorkerByUserId(workerUserId);
        if (companyEcoWorkerData) {
          companyId = companyEcoWorkerData.companyId;
        } else {
          const compInput = modal.querySelector('input[name="newCompanyId"], input[name="companyId"]');
          companyId = compInput?.value || null;
          if (!companyId) {
            const urlMatch = window.location.pathname.match(/\/company\/([a-f0-9]{24})/);
            if (urlMatch) companyId = urlMatch[1];
          }
          if (companyId && !companyEcoWorkerFetchPending) {
            companyEcoWorkerFetchPending = true;
            fetchCompanyWorkersBatch([companyId]).then(() => {
              companyEcoWorkerFetchPending = false;
              companyEcoWorkerData = ecoFindWorkerByUserId(workerUserId);
              handleWageInputUpdate();
            });
          }
        }
      }
    } else {
      const companyInput = modal.querySelector('input[name="companyId"]');
      if (companyInput) companyId = companyInput.value;
    }

    if (!companyId || !companyEcoWageInput) {
      setHealth('companyEco', 'warn', 'missing inputs or companyId in modal');
      return;
    }
    setHealth('companyEco', 'ok');

    if (!companyEcoRafId) {
      companyEcoRafId = requestAnimationFrame(ecoPoll);
    }

    let netLine = modal.querySelector('#wia-eco-net-wage');
    if (!netLine) {
      netLine = document.createElement('div');
      netLine.id = 'wia-eco-net-wage';
      netLine.style.fontSize = '0.875rem';
      netLine.style.marginTop = '0.15rem';
      netLine.style.display = 'flex';
      netLine.style.justifyContent = 'space-between';
      netLine.style.alignItems = 'center';
      netLine.style.width = '100%';
      
      if (isEditWorkerModal) {
        const netBenefitSpan = Array.from(modal.querySelectorAll('span')).find(s =>
          s.textContent.toLowerCase().includes('net benefit'));
        const netBenefitDiv = netBenefitSpan?.closest('div');
        if (netBenefitDiv?.parentElement) {
          netBenefitDiv.parentElement.insertBefore(netLine, netBenefitDiv.nextSibling);
        } else {
          const grandparent = companyEcoWageInput.parentElement?.parentElement;
          if (grandparent) grandparent.appendChild(netLine);
        }
      } else {
        const labelSpan = Array.from(modal.querySelectorAll('span')).find(s => s.textContent.toLowerCase().includes('estimated benefit'));
        if (!labelSpan || !labelSpan.parentElement) {
          setHealth('companyEco', 'warn', 'no benefit anchor');
          return;
        }
        labelSpan.parentElement.appendChild(netLine);
      }
      
      if (companyEcoTaxRate != null) netLine.dataset.taxRate = companyEcoTaxRate;
    }

    if (isEditWorkerModal && !editWorkerPpSection) {
      editWorkerPpSection = modal.querySelector('#wia-eco-worker-pp');
      if (!editWorkerPpSection) {
        editWorkerPpSection = document.createElement('div');
        editWorkerPpSection.id = 'wia-eco-worker-pp';
        editWorkerPpSection.style.fontSize = '0.875rem';
        editWorkerPpSection.style.marginTop = '0.5rem';
        editWorkerPpSection.style.padding = '0.5rem';
        editWorkerPpSection.style.background = 'rgba(0,0,0,0.2)';
        editWorkerPpSection.style.borderRadius = '4px';
        editWorkerPpSection.style.border = '1px solid rgba(255,255,255,0.05)';
        
        const transferSpan = Array.from(modal.querySelectorAll('span')).find(s =>
          s.textContent.toLowerCase().includes('transfer to company'));
        if (transferSpan) {
          const transferDiv = transferSpan.closest('div');
          if (transferDiv?.parentElement) {
            transferDiv.parentElement.insertBefore(editWorkerPpSection, transferDiv);
          }
        } else {
          const benefitSpan = Array.from(modal.querySelectorAll('span')).find(s =>
            s.textContent.toLowerCase().includes('net benefit'));
          const anchor = benefitSpan?.closest('div')?.parentElement;
          if (anchor) {
            anchor.appendChild(editWorkerPpSection);
          }
        }
      }
    }

    if (companyId !== companyEcoCompanyId) {
      companyEcoCompanyId = companyId;
      companyEcoTaxRate = null;
      companyEcoTaxResolved = false;
      delete netLine.dataset.taxRate;
      
      companyEcoMarketWages = null;
      guard('wageMedian', () => fetchMarketWages((wagesSoFar) => {
        if (!companyEcoModalNode) return;
        companyEcoMarketWages = wagesSoFar;
        handleWageInputUpdate();
      }).then((res) => {
        if (!companyEcoModalNode) return;
        if (res) {
          setHealth('wageMedian', 'ok', 'market API data active');
        } else {
          companyEcoMarketWages = null;
          handleWageInputUpdate();
          setHealth('wageMedian', 'warn', 'API fallback');
        }
      }).catch(() => {
        if (!companyEcoModalNode) return;
        companyEcoMarketWages = null;
        handleWageInputUpdate();
        setHealth('wageMedian', 'warn', 'API fallback');
      }));

      handleWageInputUpdate();

      fetchCompanyTaxRate(companyId).then(rate => {
        if (companyEcoCompanyId !== companyId) return; // modal switched company mid-flight
        companyEcoTaxRate = rate;
        companyEcoTaxResolved = true;
        const line = companyEcoModalNode && companyEcoModalNode.querySelector('#wia-eco-net-wage');
        if (!line) return;
        if (rate != null) line.dataset.taxRate = rate;
        handleWageInputUpdate();
      });
    } else if (companyEcoTaxRate != null && netLine.dataset.taxRate == null) {
      netLine.dataset.taxRate = companyEcoTaxRate;
      handleWageInputUpdate();
    } else {
      handleWageInputUpdate();
    }
  }

  function initCompanyEco() {
    // handled by route and sharedBodyObserver
  }

  function teardownCompanyEco() {
    if (companyEcoRafId) {
      cancelAnimationFrame(companyEcoRafId);
    }
    if (companyEcoModalNode) {
      const injected = companyEcoModalNode.querySelector('#wia-eco-net-wage');
      if (injected) injected.remove();
      const ppSection = companyEcoModalNode.querySelector('#wia-eco-worker-pp');
      if (ppSection) ppSection.remove();
    }
    const strip = (typeof document !== 'undefined' && document.getElementById)
      ? document.getElementById('wia-eco-portfolio-strip') : null;
    if (strip) strip.remove();
    // inline inventory net-tags live in the persistent top bar → clear on leave
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      document.querySelectorAll('.wia-eco-inv-net').forEach(el => el.remove());
    }
    // owned-cache resets so a route/profile switch re-fetches the right owner
    ecoOwnedCache.ids = null; ecoOwnedCache.userId = null; ecoOwnedCache.at = 0;

    companyEcoModalNode = null;
    companyEcoWageInput = null;
    companyEcoCompanyId = null;
    companyEcoTaxRate = null;
    companyEcoTaxResolved = false;
    companyEcoRafId = null;
    companyEcoLastWage = null;
    isEditWorkerModal = false;
    companyEcoWorkerData = null;
    editWorkerPpSection = null;
    if (companyEcoTeardownTimer) { clearTimeout(companyEcoTeardownTimer); companyEcoTeardownTimer = null; }
    companyEcoWorkerFetchPending = false;
    companyEcoMarketWages = null;
    setHealth('companyEco', 'idle', 'modal closed or off-route');
    setHealth('companyEnergy', 'idle', 'off-route');
    setHealth('wageMedian', 'idle', 'modal closed');
  }


  let sharedBodyObserver = null;

  function initSharedBodyObserver() {
    if (sharedBodyObserver) return;
    sharedBodyObserver = new MutationObserver((mutations) => {
      if (CONFIG.featNotes) {
        if (mutations.some(m => m.addedNodes.length > 0)) {
          scheduleNotesScan();
        }
      }
if (CONFIG.featMarketGraph && getPagePathname().startsWith('/market')) {
        const found = findMarketGraph();
        if (found) {
          setupModalObserver(found.modal);
          checkAndRenderGraph(found);
        } else {
          if (modalObserver) {
            modalObserver.disconnect();
            modalObserver = null;
          }
          lastMktState = null;
        }
      }
      if (CONFIG.featEquipSellCalc) {
        if (isMarketPage()) renderEquipSellCalc();
        else teardownEquipSellCalcUI();
      }
      if (CONFIG.featBattleAdvisor && isBattlePage()) {
        const defBtn = document.querySelector('#defender-hit-button');
        const atkBtn = document.querySelector('#attacker-hit-button');
        if (defBtn && atkBtn) {
          const hasPrimary = defBtn.classList.contains('wia-battle-primary') || atkBtn.classList.contains('wia-battle-primary');
          const hasOrders = defBtn.querySelector('[data-wia-injected]') || atkBtn.querySelector('[data-wia-injected]');
          if (!hasPrimary || !hasOrders) {
            applyBattleAdvisory();
          }
        }
      }
      if (CONFIG.featOrderRadar && (isCountryPage() || isMuPage())) {
        ensureOrderRadarInjected();
      }
      if (CONFIG.featTroopRadar && isMuPage()) {
        ensureTroopRadarInjected();
      }
      if (CONFIG.featProfileCharsheet && isUserProfilePage()) {
        ensureProfileCharsheetInjected();
      }
      if (CONFIG.featCraftingAdvisor) {
        guard('craftAdvisor', triggerCraftingAdvisorCheck);
      } else {
        setHealth('craftAdvisor', 'idle', 'disabled in settings');
      }
      if (CONFIG.featCompanyEco && (getPagePathname().startsWith('/companies') || getPagePathname().startsWith('/company/') || /^\/user\/[0-9a-zA-Z_-]+\/companies\/?$/.test(getPagePathname()))) {
        guard('companyEco', checkCompanyEcoModal);
        guard('companyEnergy', ensureCompanyCoworkersInjected);
        guard('companyProfit', ensureCompanyProfitInjected);
      }
      if (CONFIG.featCompanyEco && (getPagePathname().startsWith('/companies') || getPagePathname().startsWith('/company/') || /^\/user\/[0-9a-zA-Z_-]+\/companies\/?$/.test(getPagePathname()) || getPagePathname().startsWith('/job'))) {
        const mw = document.getElementById('main-window');
        if (mw) guard('netWages', () => injectNetWagesLoop(mw));
      }
    });
    sharedBodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function teardownSharedBodyObserver() {
    if (!CONFIG.featNotes && !CONFIG.featMarketGraph && !CONFIG.featBattleAdvisor && !CONFIG.featCompanyEco) {
      if (sharedBodyObserver) {
        sharedBodyObserver.disconnect();
        sharedBodyObserver = null;
      }
    }
  }

  let notesScanTimer   = null;
  let notesActiveId    = null;
  let notesActiveUser  = '';
  let notesModal       = null;
  let notesEscHandler  = null;

  function noteKey(userId) { return NOTES_KEY_PFX + userId; }
  function getNote(userId) { return GM_getValue(noteKey(userId), ''); }
  function hasNote(userId) { return getNote(userId).trim().length > 0; }

  function initNotes() {
    notesModal = buildNotesModal();
    document.body.appendChild(notesModal.backdrop);
    notesEscHandler = (e) => {
      if (e.key === 'Escape' && notesModal.backdrop.classList.contains('is-open')) closeNoteEditor();
    };
    document.addEventListener('keydown', notesEscHandler);
    scanNoteLinks();
    initSharedBodyObserver();
  }

  function teardownNotes() {
    if (notesEscHandler) { document.removeEventListener('keydown', notesEscHandler); notesEscHandler = null; }
    if (notesModal) { notesModal.backdrop.remove(); notesModal = null; }
    // Remove all injected icons and reset attached markers
    document.querySelectorAll('.warera-note-icon').forEach(el => el.remove());
    document.querySelectorAll('[' + NOTES_ATTR + ']').forEach(el => delete el.dataset.wareraNoteAttached);
    clearTimeout(notesScanTimer);
    notesScanTimer = null;
    teardownSharedBodyObserver();
    setHealth('notes', 'idle', 'disabled in settings');
  }

  function scheduleNotesScan() {
    clearTimeout(notesScanTimer);
    notesScanTimer = setTimeout(scanNoteLinks, NOTES_DEBOUNCE);
  }

  function scanNoteLinks() {
    document.querySelectorAll(NOTES_LINK_SEL).forEach(link => {
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.dataset.wareraNoteAttached === 'true') return; // already attached (by us or standalone script)
      const userId = extractNoteUserId(link);
      if (!userId) return;
      attachNoteIcon(link, userId);
    });
  }

  function extractNoteUserId(link) {
    const href = link.getAttribute('href');
    if (!href) return null;
    try {
      const url = new URL(href, window.location.origin);
      const m = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (_) { return null; }
  }

  function notePreview(userId) {
    const text = getNote(userId).trim();
    if (!text) return t('editNote');
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
  }

  function attachNoteIcon(link, userId) {
    const icon = document.createElement('button');
    icon.type = 'button';
    icon.className = 'warera-note-icon';
    const saved = hasNote(userId);
    icon.textContent = saved ? '📒' : '✎';
    icon.title = notePreview(userId);
    icon.setAttribute('aria-label', t('editNoteAria', { user: link.textContent.trim() || t('noteUserLabel') }));
    if (saved) {
      icon.classList.add('has-note');
    } else {
      icon.classList.add('hover-gated');
    }
    attachNoteHoverGate(link, icon);
    icon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openNoteEditor(userId, link.textContent.trim() || t('noteUserLabel'));
    });
    link.insertAdjacentElement('afterend', icon);
    link.dataset.wareraNoteAttached = 'true';
  }

  const noteHoverHideTimers = new WeakMap(); // icon -> pending hide timeout id

  function attachNoteHoverGate(link, icon) {
    const show = () => {
      const pending = noteHoverHideTimers.get(icon);
      if (pending) { clearTimeout(pending); noteHoverHideTimers.delete(icon); }
      icon.classList.add('is-visible');
    };
    const scheduleHide = () => {
      const pending = noteHoverHideTimers.get(icon);
      if (pending) clearTimeout(pending);
      noteHoverHideTimers.set(icon, setTimeout(() => {
        icon.classList.remove('is-visible');
        noteHoverHideTimers.delete(icon);
      }, NOTES_HOVER_GRACE_MS));
    };
    link.addEventListener('mouseenter', show);
    link.addEventListener('mouseleave', scheduleHide);
    icon.addEventListener('mouseenter', show);
    icon.addEventListener('mouseleave', scheduleHide);
  }

  function buildNotesModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'warera-note-backdrop';

    const dialog = document.createElement('section');
    dialog.className = 'warera-note-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'warera-note-title');

    const header = document.createElement('div');
    header.className = 'warera-note-header';
    const title = document.createElement('h2');
    title.id = 'warera-note-title';
    title.className = 'warera-note-title';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'warera-note-close';
    closeBtn.textContent = '×';
    closeBtn.title = t('noteClose');
    closeBtn.setAttribute('aria-label', t('noteCloseAria'));
    closeBtn.addEventListener('click', closeNoteEditor);
    header.append(title, closeBtn);

    const body = document.createElement('div');
    body.className = 'warera-note-body';
    const textarea = document.createElement('textarea');
    textarea.className = 'warera-note-textarea';
    textarea.placeholder = t('notePlaceholder');
    body.append(textarea);

    const actions = document.createElement('div');
    actions.className = 'warera-note-actions';
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'warera-note-button';
    delBtn.textContent = t('deleteNote');
    delBtn.addEventListener('click', () => { saveNoteValue(''); closeNoteEditor(); });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'warera-note-button';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', closeNoteEditor);
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'warera-note-button primary';
    saveBtn.textContent = t('saveNote');
    saveBtn.addEventListener('click', () => { saveNoteValue(textarea.value); closeNoteEditor(); });
    actions.append(delBtn, cancelBtn, saveBtn);

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeNoteEditor(); });
    dialog.append(header, body, actions);
    backdrop.append(dialog);
    return { backdrop, title, textarea };
  }

  function openNoteEditor(userId, userName) {
    notesActiveId   = userId;
    notesActiveUser = userName;
    notesModal.title.textContent = t('noteTitle', { user: userName });
    notesModal.textarea.value = getNote(userId);
    notesModal.backdrop.classList.add('is-open');
    notesModal.textarea.focus();
  }

  function closeNoteEditor() {
    notesActiveId   = null;
    notesActiveUser = '';
    notesModal.backdrop.classList.remove('is-open');
  }

  function saveNoteValue(note) {
    if (!notesActiveId) return;
    GM_setValue(noteKey(notesActiveId), note.trim());
    refreshNoteIcons(notesActiveId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MU Heal Deemphasis module
  // ───────────────────────────────────────────────────────────────────────────
  function isMuPage() {
    return /^\/mu(\/|$)/.test(getPagePathname());
  }

  function isUserProfilePage() {
    // Main profile page only (not /user/<id>/inventory, /skills, … subviews —
    // those lack the "Ausrüstung" anchor and a different layout).
    return /^\/user\/[0-9a-zA-Z_-]+\/?$/.test(getPagePathname());
  }

  function shouldDimMuHeal(featPill, featDim, inDebuff, hpFull) {
    if (!featPill || !featDim) return false;
    return inDebuff || hpFull;
  }

  // Debuff truth comes from the TIMER system (pillTakenAt + configured phase
  // durations) — the same source as the HUD badge the user actually sees. The
  // GM pillState icon-detection only flips when a buff/debuff icon is visible
  // next to an own-profile link, so on pages like /mu/* it routinely lags
  // (stuck on 'BUFF'/'none') — keyed on it alone, the dim never engaged.
  function isMuHealDebuffActive() {
    const info = getPillCycleInfo();
    // KNIFE = surplus HP must be burned before the next pill — an MU heal is
    // wasted by definition here, even after the game's debuff itself expired.
    if (info.phase === 'KNIFE') return true;
    if (info.pillTakenAt > 0) {
      const elapsed = Date.now() - info.pillTakenAt;
      const buffMs = CONFIG.pillBuffH * 3600000;
      const debuffMs = CONFIG.pillDebuffH * 3600000;
      if (elapsed >= buffMs && elapsed < buffMs + debuffMs) return true;
    }
    // Icon-detection fallback covers a fresh install where pillTakenAt is unknown.
    return GM_getValue(KEYS.pillState, 'none') === 'DEBUFF';
  }

  // Inclusion beats exclusion: the MU page carries SEVERAL heart-icon buttons
  // (per-member "Help" rows, "Help All", donations) — "first heart that isn't
  // Help All" grabbed a member-row "Help" button (verified via live diag).
  // Require the heart AND the "Ask for help" label together.
  function findMuHealButton() {
    const isAskLabel = (btn) => {
      const text = btn.textContent;
      return text.includes(CONFIG.muHealButtonTextFallbackEN) || text.includes(CONFIG.muHealButtonTextFallbackDE);
    };
    for (const path of document.querySelectorAll('path')) {
      if ((path.getAttribute('d') || '').startsWith(CONFIG.muHealHeartPathFingerprint)) {
        const btn = path.closest('button');
        if (btn && !btn.closest('#mu-help-all-button') && isAskLabel(btn)) return btn;
      }
    }
    // Icon changed/replaced → fall back to the label alone.
    for (const btn of document.querySelectorAll('button')) {
      if (isAskLabel(btn)) return btn;
    }
    return null;
  }

  // Console diagnostic: explains the whole dim decision chain in one call.
  // Page console: WIA_muHealDiag() — answers "why is/isn't the button dimmed".
  function muHealDiag() {
    const info = getPillCycleInfo();
    const status = parseHealthAndHunger() || {};
    const btn = findMuHealButton();
    return {
      onMuPage: isMuPage(),
      featPillReminder: CONFIG.featPillReminder,
      featMuHealDim: CONFIG.featMuHealDim,
      ownId: getCurrentUserId(),
      iconDetected: scanOwnPillState(),     // what the icon scanner sees on THIS page
      gmPillState: GM_getValue(KEYS.pillState, 'none'),
      phase: info.phase,
      pillTakenAt: info.pillTakenAt ? new Date(info.pillTakenAt).toISOString() : null,
      inDebuff: isMuHealDebuffActive(),
      hpFound: !!status.hpFound,
      hpPercent: status.hpPercent,
      buttonFound: !!btn,
      dimmed: !!(btn && btn.classList.contains('wia-mu-heal-muted')),
    };
  }

  // SPA renders the MU content well after the route event — a fixed 50ms delay
  // missed it and the next chance was the 10s pill tick (user-visible ~3-5s lag).
  // Poll per animation frame until the button exists (5s cap), then apply.
  let muHealPollFrame = null;
  function applyMuHealDimSoon() {
    const rAF = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    const cancelAF = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : clearTimeout;
    if (muHealPollFrame) { cancelAF(muHealPollFrame); muHealPollFrame = null; }
    if (!CONFIG.featMuHealDim) return;
    if (!isMuPage()) { guard('muHealDim', applyMuHealDim); return; }   // records 'idle' on the ampel
    const startTime = Date.now();
    const poll = () => {
      muHealPollFrame = null;
      if (!isMuPage()) return;   // user navigated away mid-poll
      if (findMuHealButton()) { guard('muHealDim', applyMuHealDim); return; }
      if (Date.now() - startTime < 5000) { muHealPollFrame = rAF(poll); return; }
      guard('muHealDim', applyMuHealDim);   // timeout → surfaces 'selector miss' on the ampel
    };
    poll();
  }

  function applyMuHealDim() {
    if (!isMuPage()) {
      setHealth('muHealDim', 'idle', 'not on MU page');
      return;
    }
    if (!CONFIG.featMuHealDim) {
      setHealth('muHealDim', 'idle', 'disabled in settings');
      const btn = findMuHealButton();
      if (btn && btn.classList.contains('wia-mu-heal-muted')) {
        btn.classList.remove('wia-mu-heal-muted');
        if (btn.dataset.wiaOrigTitle !== undefined) {
          const orig = btn.dataset.wiaOrigTitle;
          if (orig) btn.setAttribute('title', orig);
          else btn.removeAttribute('title');
          delete btn.dataset.wiaOrigTitle;
        }
      }
      return;
    }
    if (!CONFIG.featPillReminder) {
      setHealth('muHealDim', 'warn', 'needs Pill Reminder on');
      return;
    }

    const btn = findMuHealButton();
    if (!btn) {
      setHealth('muHealDim', 'fail', 'selector miss: heal button not found');
      return;
    }

    const inDebuff = isMuHealDebuffActive();
    // hpFound guard: parseHealthAndHunger() defaults hpPercent to 100 when the
    // top bar isn't parseable — without the guard an empty read dims at 0 HP.
    const status = parseHealthAndHunger() || {};
    const hpFull = !!(status.hpFound && status.hpPercent >= 99.9);
    const shouldDim = shouldDimMuHeal(CONFIG.featPillReminder, CONFIG.featMuHealDim, inDebuff, hpFull);

    if (shouldDim) {
      if (!btn.classList.contains('wia-mu-heal-muted')) {
        if (btn.dataset.wiaOrigTitle === undefined) {
          btn.dataset.wiaOrigTitle = btn.getAttribute('title') || '';
        }
        btn.classList.add('wia-mu-heal-muted');
      }
      let reasonKey = 'muHealDimReasonBoth';
      if (inDebuff && !hpFull) {
        reasonKey = 'muHealDimReasonDebuff';
      } else if (!inDebuff && hpFull) {
        reasonKey = 'muHealDimReasonFullHP';
      }
      btn.setAttribute('title', t(reasonKey));
    } else {
      if (btn.classList.contains('wia-mu-heal-muted')) {
        btn.classList.remove('wia-mu-heal-muted');
        if (btn.dataset.wiaOrigTitle !== undefined) {
          const orig = btn.dataset.wiaOrigTitle;
          if (orig) btn.setAttribute('title', orig);
          else btn.removeAttribute('title');
          delete btn.dataset.wiaOrigTitle;
        }
      }
    }
    // Ampel carries the decision, not just "ok" — a screenshot of the debug HUD
    // then answers "why (not) dimmed" without a console session.
    const why = shouldDim
      ? `dimmed (${[inDebuff && 'debuff', hpFull && 'hp-full'].filter(Boolean).join('+')})`
      : 'visible (no debuff, hp not full)';
    setHealth('muHealDim', 'ok', why);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Order-Radar module
  // Header-embedded strip showing active battle orders set by country or MU
  // ───────────────────────────────────────────────────────────────────────────
  function isCompaniesPage() {
    const path = getPagePathname();
    return path === '/companies' || /^\/user\/[a-f0-9]+\/companies$/.test(path);
  }

  function isCountryPage() {
    return /^\/country(\/|$)/.test(getPagePathname());
  }

  function getEntityFromRoute() {
    const path = getPagePathname();
    const mCountry = path.match(/^\/country\/([0-9a-zA-Z_-]+)/);
    if (mCountry) return { type: 'country', rawId: mCountry[1] };
    const mMu = path.match(/^\/mu\/([0-9a-zA-Z_-]+)/);
    if (mMu) return { type: 'mu', rawId: mMu[1] };
    const mUser = path.match(/^\/user\/([0-9a-zA-Z_-]+)/);
    if (mUser) return { type: 'user', rawId: mUser[1] };

    // Fallback: if we are on the MU page but the URL path doesn't contain the ID (e.g., /mu),
    // extract the MU ID from the sub-nav links in the DOM (e.g. /mu/<id>/members).
    if (/^\/mu(\/|$)/.test(path) && typeof document !== 'undefined') {
      const links = document.querySelectorAll('a[href*="/mu/"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/mu\/([a-f0-9]{24})/i);
        if (match) {
          return { type: 'mu', rawId: match[1] };
        }
      }
    }
    return null;
  }

  function resolveCanonicalCountryId(rawId, countryMap) {
    if (!rawId) return null;
    if (countryMap[rawId]) return rawId;
    const lower = rawId.toLowerCase();
    for (const [cid, info] of Object.entries(countryMap)) {
      if (info && ((info.code && info.code.toLowerCase() === lower) || (info.name && info.name.toLowerCase() === lower))) {
        return cid;
      }
    }
    return rawId;
  }

  // Sub-nav tab links that live in the row BELOW the banner image — used to detect (and
  // exclude) the banner root that also wraps those tabs, so the strip sits on the image.
  const ORDER_RADAR_TAB_SEL = 'a[href$="/laws"], a[href$="/wars"], a[href$="/regions"], a[href$="/members"], a[href$="/citizens"], a[href$="/applications"], a[href$="/donations"], a[href$="/contracts"]';

  function scoreBannerForRoute(layer, route) {
    const { type, rawId } = route;
    const text = (layer.textContent || '').trim().toLowerCase();
    const rawIdLower = String(rawId || '').toLowerCase();
    let score = 0;

    const links = Array.from(layer.querySelectorAll('a'));

    if (type === 'country') {
      const hasCountryLink = links.some(a => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        const linkText = (a.textContent || '').toLowerCase();
        return href.includes(`/country/${rawIdLower}`) || linkText.includes(rawIdLower);
      });
      if (hasCountryLink) score += 15;

      const isCountryLabel = text.includes('land') || text.includes('country');
      if (isCountryLabel) score += 20;

      const isMu = text.includes('military unit') || text.includes('militäreinheit') ||
                   text.includes('members') || text.includes('mitglieder') ||
                   text.includes('commanders') || text.includes('kommandanten');
      if (isMu) score -= 50;

    } else if (type === 'mu') {
      const hasMuLink = links.some(a => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        return href.includes(`/mu/${rawIdLower}`);
      });
      if (hasMuLink) score += 20;

      const isMuLabel = text.includes('military unit') || text.includes('militäreinheit');
      if (isMuLabel) score += 20;

      const hasMuIndicators = text.includes('members') || text.includes('mitglieder') ||
                              text.includes('commanders') || text.includes('kommandanten');
      if (hasMuIndicators) score += 10;
    }

    return score;
  }

  function findEntityBannerAnchor(route) {
    const activeRoute = route || getEntityFromRoute();
    if (!activeRoute) return null;

    const images = document.querySelectorAll('img[src*="/headerv4/"], img[src*="/headerv"], img[src*="/header/"], img[src*="/headers/"]');
    if (images.length === 0) return null;

    let bestAnchor = null;
    let bestScore = -9999;

    for (const img of images) {
      let el = img.parentElement;
      let layer = null;
      while (el && el !== document.body) {
        if (el.offsetWidth >= 300 && el.offsetHeight >= 120) {
          if (el.querySelector(ORDER_RADAR_TAB_SEL)) break;
          layer = el;
        }
        if (el.tagName === 'MAIN' || el.id === 'app') break;
        el = el.parentElement;
      }

      if (layer) {
        const score = scoreBannerForRoute(layer, activeRoute);
        if (score > bestScore) {
          bestScore = score;
          bestAnchor = layer;
        }
      }
    }

    return bestScore > 0 ? bestAnchor : null;
  }

  const orderRadarCache = new Map(); // entityKey -> { at, orders }
  const ORDER_RADAR_CACHE_TTL = 30000; // 30s cache TTL

  // Shared active-battle list — the bounty poll already fetches the exact same
  // battle.getBattles list, so we cache it here and let order-radar reuse it instead of
  // making a second identical call. Falls back to its own POST when bounty is off / stale.
  let sharedActiveBattles = { at: 0, items: null };
  const SHARED_BATTLES_TTL = 45000; // 45s
  const ORDER_PRIORITY_CACHE_TTL = 5 * 60 * 1000;
  const ORDER_RADAR_COMPACT_BREAKPOINT = 400;
  const ORDER_PRIORITY_COLORS = { red: '#ef6b6b', yellow: '#e5d264', green: '#5bd78a' };
  const orderPriorityCache = new Map(); // battleId:side -> { at, items|promise }

  function setSharedActiveBattles(items) {
    if (Array.isArray(items)) sharedActiveBattles = { at: now(), items };
  }

  async function getActiveBattles() {
    if (sharedActiveBattles.items && (now() - sharedActiveBattles.at) < SHARED_BATTLES_TTL) {
      return sharedActiveBattles.items;
    }
    const items = [];
    let cursor = null;
    let pages = 0;
    const MAX_PAGES = 5;
    do {
      const args = { isActive: true, filter: 'all', limit: 100 };
      if (cursor) { args.cursor = cursor; args.direction = 'forward'; }
      // POST (not batch-GET): batch-GET ignores `limit` → only 10 battles/page.
      // high priority: gates order-radar's visible render, cached 45s either way.
      const res = await resolveApiPost('battle.getBattles', args, { priority: 'high' });
      const payloadObj = (res && res.payload) || res || {};
      const pageItems = payloadObj.items || (payloadObj.json && payloadObj.json.items) || (Array.isArray(payloadObj) ? payloadObj : []);
      items.push(...pageItems);
      cursor = payloadObj.nextCursor || (payloadObj.json && payloadObj.json.nextCursor);
      pages++;
    } while (cursor && pages < MAX_PAGES);
    setSharedActiveBattles(items);
    return items;
  }
  function getId(val) {
    if (!val) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object') return val._id || val.id || null;
    return String(val);
  }

  function normalizeOrderPriority(value) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (!raw) return null;
    if (/red|high|critical|urgent|(?:priority|level|tier)[_-]?3$|^3$/.test(raw)) return 'red';
    if (/yellow|medium|normal|(?:priority|level|tier)[_-]?2$|^2$/.test(raw)) return 'yellow';
    if (/green|low|(?:priority|level|tier)[_-]?1$|^1$/.test(raw)) return 'green';
    return null;
  }

  function orderPriorityRank(priority) {
    return { red: 0, yellow: 1, green: 2 }[normalizeOrderPriority(priority)] ?? 3;
  }

  function sortOrdersByPriority(orders) {
    return (orders || []).map((order, index) => ({ order, index }))
      .sort((a, b) => orderPriorityRank(a.order.priority) - orderPriorityRank(b.order.priority) || a.index - b.index)
      .map(({ order }) => order);
  }

  function getMainBannerWindowWidth() {
    const banner = findEntityBannerAnchor();
    const mainWindow = document.getElementById('main-window-container')
      || document.getElementById('main-window')
      || (banner ? banner.closest('#main-window-container, #main-window, ._1dnmndyf, body') : null);

    if (mainWindow && typeof mainWindow.getBoundingClientRect === 'function') {
      const w = mainWindow.getBoundingClientRect().width;
      if (w > 0) return w;
    }
    if (banner && typeof banner.getBoundingClientRect === 'function') {
      const w = banner.getBoundingClientRect().width;
      if (w > 0) return w;
    }
    return typeof PAGE_WINDOW !== 'undefined' && PAGE_WINDOW.innerWidth ? PAGE_WINDOW.innerWidth : 800;
  }

  function getOrderRadarCompactLevel(width) {
    if (!Number.isFinite(width) || width <= 0) return 'full';
    if (width < 440) return 'icon-only';
    if (width < 580) return 'minimal';
    if (width < 750) return 'no-region';
    return 'full';
  }

  function shouldCompactOrderRadar(width) {
    return getOrderRadarCompactLevel(width) === 'icon-only';
  }

  function getOrderRadarPriorityColor(priority) {
    return ORDER_PRIORITY_COLORS[normalizeOrderPriority(priority)] || '#94a3b8';
  }

  async function getBattleSideOrderDetails(battleId, side) {
    const key = `${battleId}:${side}`;
    const cached = orderPriorityCache.get(key);
    if (cached && (now() - cached.at) < ORDER_PRIORITY_CACHE_TTL) {
      return cached.promise || cached.items || [];
    }

    const promise = (async () => {
      const res = await resolveApiBase('battleOrder.getByBattle', { battleId, side }, { priority: 'high' });
      const payload = (res && res.payload) || res || [];
      return Array.isArray(payload)
        ? payload
        : (payload.items || (payload.json && payload.json.items) || []);
    })();
    orderPriorityCache.set(key, { at: now(), promise });
    try {
      const items = await promise;
      orderPriorityCache.set(key, { at: now(), items });
      return items;
    } catch (e) {
      orderPriorityCache.delete(key);
      throw e;
    }
  }

  function orderBelongsToEntity(order, entityType, entityId, countryMap) {
    if (!order) return false;
    if (entityType === 'country') return matchesCountry(order.country, entityId, countryMap);
    return String(getId(order.mu) || '').toLowerCase() === String(getId(entityId) || '').toLowerCase();
  }

  async function addOrderPriorities(orders, entityType, entityId, countryMap) {
    // getBattleSideOrderDetails is already cached/deduped per (battleId,side) — but
    // when many local orders share the same battle+side, logging once per ORDER
    // spams the identical line dozens of times in a burst, which the loop-heuristic
    // then misreports as "possible loop". Log each (battleId,side) group once.
    const loggedGroups = new Set();
    const enriched = await Promise.all((orders || []).map(async (order) => {
      const groupKey = `${order.battleId}:${order.side}`;
      try {
        const details = await getBattleSideOrderDetails(order.battleId, order.side);
        const matching = details.find((item) => item && item.isActive !== false && orderBelongsToEntity(item, entityType, entityId, countryMap));
        const rawPriority = matching && matching.priority;
        if (!loggedGroups.has(groupKey)) {
          loggedGroups.add(groupKey);
          dbg('orderRadar', 'debug', 'priority detail', order.battleId, order.side, entityType, entityId, 'items', details.length, 'raw', rawPriority || 'no-match');
        }
        return { ...order, priority: normalizeOrderPriority(rawPriority), priorityRaw: rawPriority || null };
      } catch (e) {
        if (!loggedGroups.has(groupKey)) {
          loggedGroups.add(groupKey);
          dbg('orderRadar', 'debug', 'priority fetch failed', order.battleId, order.side, e.message);
        }
        return { ...order, priority: null };
      }
    }));
    return sortOrdersByPriority(enriched);
  }

  function matchesCountry(cid, targetCid, countryMap = {}) {
    if (!cid || !targetCid) return false;
    const cStr = getId(cid);
    const tStr = getId(targetCid);
    if (cStr === tStr) return true;

    const cObj = countryMap[cStr];
    if (cObj) {
      if (cObj.code && cObj.code.toLowerCase() === tStr.toLowerCase()) return true;
      if (cObj.name && cObj.name.toLowerCase() === tStr.toLowerCase()) return true;
    }
    const tObj = countryMap[tStr];
    if (tObj) {
      if (tObj.code && tObj.code.toLowerCase() === cStr.toLowerCase()) return true;
      if (tObj.name && tObj.name.toLowerCase() === cStr.toLowerCase()) return true;
    }
    return false;
  }

  // Build one radar row from a battle side. Ground (points) + ratio (damages) ride on the
  // expanded currentRound object that battle.getBattles already returns — no extra call.
  function buildOrderRow(b, side, sideObj, countryMap, regionMap) {
    const enemyObj = b[side === 'attacker' ? 'defender' : 'attacker'] || {};

    // Country vs country → flag code. Tournament battles mix random countries into teams
    // (no side.country, only tournamentTeam) → label "Team <id-suffix>".
    const codeFor = (so) => {
      const cc = countryMap[getId(so.country)];
      if (cc && cc.code) return cc.code;
      if (so.tournamentTeam) return 'Team ' + String(getId(so.tournamentTeam)).slice(-4);
      return '?';
    };

    const currentRound = (b.currentRound && typeof b.currentRound === 'object') ? b.currentRound : {};
    const roundAtt = currentRound.attacker || {};
    const roundDef = currentRound.defender || {};
    const sideRoundObj = side === 'attacker' ? roundAtt : roundDef;
    const enemyRoundObj = side === 'attacker' ? roundDef : roundAtt;

    const sideDamages = sideRoundObj.damages || 0;
    const enemyDamages = enemyRoundObj.damages || 0;
    const totalDamages = sideDamages + enemyDamages;
    const ratioPct = totalDamages > 0 ? Math.round((sideDamages / totalDamages) * 100) : 50;

    const regionVal = b.defender && b.defender.region;
    const regionId = getId(regionVal);
    let regionName = (regionVal && typeof regionVal === 'object' && regionVal.name)
      ? regionVal.name
      : (regionId ? (regionMap[regionId] || regionId) : '');
    if (!regionName) regionName = b.type === 'tournament' ? 'Tournament' : '?';

    return {
      battleId: b._id,
      side,
      ownCode: codeFor(sideObj),
      enemyCode: codeFor(enemyObj),
      isTournament: b.type === 'tournament' || (!getId(sideObj.country) && !!sideObj.tournamentTeam),
      region: regionName,
      ratioPct,
      ground: sideRoundObj.points || 0,
      ratePer1k: sideObj.moneyPer1kDamages || 0,
      moneyPool: sideObj.moneyPool || 0
    };
  }

  // 2-letter ISO country code -> regional-indicator flag emoji (de -> 🇩🇪). Empty for non-codes.
  function codeToFlag(code) {
    if (!code || !/^[a-zA-Z]{2}$/.test(code)) return '';
    return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
  }

  function getOrderRadarBattleUrl(battleId) {
    return `https://app.warera.io/battle/${encodeURIComponent(String(battleId))}`;
  }

  function isCurrentOrderRadarRoute(expected, actual) {
    return !!expected && !!actual && expected.type === actual.type && expected.rawId === actual.rawId;
  }

  function isCurrentOrderRadarRequest(requestId, latestRequestId, expectedRoute, actualRoute) {
    return requestId === latestRequestId && isCurrentOrderRadarRoute(expectedRoute, actualRoute);
  }

  // countryOrders lists the ids of EVERY country that set an order on this side — including
  // allies ordering in a battle they are not a belligerent in (verified against live
  // battle.getBattles: Germany appeared in countryOrders of 2 battles it was not a side of).
  // So match on membership, NOT on the side owning the country.
  function filterOrdersForCountry(items, countryId, countryMap = {}, regionMap = {}) {
    const resultOrders = [];
    const targetCid = getId(countryId);
    for (const b of (items || [])) {
      if (!b || !b.isActive) continue;
      for (const side of ['attacker', 'defender']) {
        const sideObj = b[side];
        if (!sideObj) continue;
        const hasOrder = (sideObj.countryOrders || []).some((c) => matchesCountry(c, targetCid, countryMap));
        if (hasOrder) resultOrders.push(buildOrderRow(b, side, sideObj, countryMap, regionMap));
      }
    }
    return resultOrders;
  }

  // muOrders holds the ids of every MU that set an order on this side (verified against live
  // battle.getBattles + battleOrder.getByBattle). Membership => that MU has an active order.
  function filterOrdersForMu(items, muId, countryMap = {}, regionMap = {}) {
    const resultOrders = [];
    const targetMuId = String(getId(muId) || '').toLowerCase();
    for (const b of (items || [])) {
      if (!b || !b.isActive) continue;
      for (const side of ['attacker', 'defender']) {
        const sideObj = b[side];
        if (!sideObj) continue;
        const hasMuOrder = (sideObj.muOrders || []).some(id => String(getId(id) || '').toLowerCase() === targetMuId);
        if (hasMuOrder) resultOrders.push(buildOrderRow(b, side, sideObj, countryMap, regionMap));
      }
    }
    return resultOrders;
  }

  // cacheKey -> in-progress fetchOrdersForEntity promise. Without this, two
  // overlapping applyOrderRadar triggers for the SAME entity (e.g. the route-change
  // handler firing at the same moment a mutation-observer retry lands) both see no
  // cache entry yet — orderRadarCache is only written AFTER the fetch completes,
  // not before it starts — so both independently re-fetch battles and re-run
  // addOrderPriorities, doubling API calls and log volume for one logical update.
  const orderRadarInFlight = new Map();

  async function fetchOrdersForEntity(entityType, rawEntityId) {
    const countryMap = await loadCountryMap();
    const regionMap = await loadRegionMap();

    const entityId = entityType === 'country' ? resolveCanonicalCountryId(rawEntityId, countryMap) : rawEntityId;
    const cacheKey = `${entityType}:${entityId}`;
    const cached = orderRadarCache.get(cacheKey);
    if (cached && (now() - cached.at) < ORDER_RADAR_CACHE_TTL) {
      return { orders: cached.orders, priorityPromise: cached.priorityPromise || Promise.resolve(cached.orders) };
    }

    const inFlight = orderRadarInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const fetchPromise = (async () => {
      // Reuse the shared active-battle list (the bounty poll fetches the same list). Countries
      // & MUs can set orders on ANY active battle, so we need the full list, not a filtered one.
      const items = await getActiveBattles();

      // Dedupe battles by id — pagination can return the same battle on overlapping pages,
      // which would otherwise render as duplicate rows.
      const seenBattles = new Set();
      const uniqueItems = items.filter((b) => {
        const id = b && b._id;
        if (!id || seenBattles.has(id)) return false;
        seenBattles.add(id);
        return true;
      });

      const baseOrders = entityType === 'country'
        ? filterOrdersForCountry(uniqueItems, entityId, countryMap, regionMap)
        : filterOrdersForMu(uniqueItems, entityId, countryMap, regionMap);
      const initialOrders = sortOrdersByPriority(baseOrders);
      const priorityPromise = addOrderPriorities(baseOrders, entityType, entityId, countryMap)
        .then((enriched) => {
          const current = orderRadarCache.get(cacheKey);
          if (current && current.priorityPromise === priorityPromise) {
            current.orders = enriched;
            current.at = now();
          }
          return enriched;
        });
      orderRadarCache.set(cacheKey, { at: now(), orders: initialOrders, priorityPromise });
      return { orders: initialOrders, priorityPromise };
    })();

    orderRadarInFlight.set(cacheKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      orderRadarInFlight.delete(cacheKey);
    }
  }

  let orderRadarLastOrders = [];
  let orderRadarLastEntity = null;   // `${type}:${id}` the cached orders belong to
  let orderRadarRequestId = 0;       // invalidates results from older route/fetch requests
  let orderRadarTimer = null;
  let orderRadarResizeObserver = null;
  let orderRadarObservedContainer = null;
  let orderRadarResizeRaf = 0;
  let orderRadarRetryCount = 0;
  let orderRadarActiveRouteKey = null;
  // Timestamp of the last confirmed "zero orders for this entity" result. Without
  // this, ensureOrderRadarInjected has no terminal state for that case — #wia-order-radar
  // stays absent (correctly, nothing to show), so neither of its early-returns match,
  // and it re-schedules applyOrderRadar on EVERY ambient body mutation forever (a live
  // SPA mutates constantly). This throttles rechecks to the same cadence as the order
  // fetch cache below, instead of once per mutation.
  let orderRadarLastZeroCheckAt = 0;

  function attachOrderRadarResizeObserver(container) {
    if (typeof ResizeObserver === 'undefined' || !container) return;
    const obsTarget = document.getElementById('main-window-container')
      || document.getElementById('main-window')
      || container;
    if (obsTarget === orderRadarObservedContainer) return;
    if (!orderRadarResizeObserver) {
      orderRadarResizeObserver = new ResizeObserver(() => {
        if (orderRadarResizeRaf) return;
        const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
        orderRadarResizeRaf = schedule(() => {
          orderRadarResizeRaf = 0;
          if (orderRadarLastOrders.length && getEntityFromRoute()) {
            renderOrderRadarUI(orderRadarLastOrders);
          }
        });
      });
    }
    orderRadarResizeObserver.disconnect();
    orderRadarResizeObserver.observe(obsTarget);
    orderRadarObservedContainer = obsTarget;
  }

  function detachOrderRadarResizeObserver() {
    if (orderRadarResizeObserver) orderRadarResizeObserver.disconnect();
    if (orderRadarResizeRaf) {
      const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
      cancel(orderRadarResizeRaf);
      orderRadarResizeRaf = 0;
    }
    orderRadarObservedContainer = null;
  }

  // Debounced (re)run — used by the MutationObserver when React drops our strip.
  function scheduleOrderRadar() {
    if (orderRadarTimer) clearTimeout(orderRadarTimer);
    orderRadarTimer = setTimeout(() => {
      orderRadarTimer = null;
      guard('orderRadar', applyOrderRadar);
    }, 100);
  }

  function ensureOrderRadarInjected() {
    if (!CONFIG.featBattleAdvisor || !CONFIG.featOrderRadar) return;
    const route = getEntityFromRoute();
    if (!route) {
      const existing = document.getElementById('wia-order-radar');
      if (existing) existing.remove();
      return;
    }
    const key = `${route.type}:${route.rawId}`;
    const existing = document.getElementById('wia-order-radar');
    if (existing) {
      if (existing.getAttribute('data-wia-entity') !== key) {
        existing.remove();
      } else {
        return;
      }
    }
    if (orderRadarLastEntity === key && orderRadarLastOrders.length && findEntityBannerAnchor(route)) {
      renderOrderRadarUI(orderRadarLastOrders);
      if (document.getElementById('wia-order-radar')) {
        setHealth('orderRadar', 'ok', `${orderRadarLastOrders.length} orders rendered`);
      }
      return;
    }
    if (orderRadarLastEntity === key && !orderRadarLastOrders.length
        && now() - orderRadarLastZeroCheckAt < ORDER_RADAR_CACHE_TTL) {
      return;
    }
    scheduleOrderRadar();
  }

  function renderOrderRadarUI(orders) {
    const route = getEntityFromRoute();
    const currentEntityKey = route ? `${route.type}:${route.rawId}` : null;
    const existing = document.getElementById('wia-order-radar');
    if (!orders || orders.length === 0 || !currentEntityKey) {
      if (existing) existing.remove();
      detachOrderRadarResizeObserver();
      return;
    }

    const container = findEntityBannerAnchor(route);
    if (!container) return;
    const windowWidth = getMainBannerWindowWidth();
    const level = getOrderRadarCompactLevel(windowWidth);
    const compact = level === 'icon-only';
    // Give the banner a positioning context so the strip overlays its bottom-right corner
    // (above the sub-nav tabs) instead of pushing into page flow below the header.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    let wrap = existing;
    if (!wrap || wrap.getAttribute('data-wia-entity') !== currentEntityKey) {
      if (wrap) wrap.remove();
      wrap = document.createElement('div');
      wrap.id = 'wia-order-radar';
      wrap.className = 'wia-order-radar-container';
    } else {
      wrap.innerHTML = '';
    }
    wrap.setAttribute('data-wia-entity', currentEntityKey);
    wrap.classList.toggle('wia-order-radar-compact', compact);
    // Scales with the banner: caps at 460px but shrinks with the header on narrow layouts.
    wrap.style.cssText = compact
      ? 'position:absolute; right:8px; bottom:8px; display:flex; flex-direction:column; gap:3px; align-items:center; z-index:40; width:28px; pointer-events:auto;'
      : 'position:absolute; right:10px; bottom:10px; display:flex; flex-direction:column; gap:3px; align-items:stretch; z-index:40; width:max-content; max-width:min(460px, calc(100% - 20px)); pointer-events:auto;';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'wia-order-radar-header';
    titleDiv.style.cssText = compact
      ? 'font-size:11px; font-weight:700; color:#cbd5e1; letter-spacing:0.5px; user-select:none; margin-bottom:1px; text-align:center; text-shadow:0 1px 2px rgba(0,0,0,0.85);'
      : 'font-size:11px; font-weight:700; color:#cbd5e1; letter-spacing:0.5px; user-select:none; margin-bottom:1px; text-align:right; text-shadow:0 1px 2px rgba(0,0,0,0.85);';
    titleDiv.textContent = compact ? `⚔ ${orders.length}` : `${t('orderRadarTitle')} [${orders.length}]`;
    wrap.appendChild(titleDiv);

    // API-sourced strings (region/country/team labels) are escaped — never trust them raw.
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    orders.forEach(ord => {
      const row = document.createElement('a');
      row.href = `/battle/${ord.battleId}`;
      row.className = 'wia-order-radar-row';
      // Left tick = side (Def blue / Att red). Background bar = own(blue) vs enemy(red) by ratio.
      const sideColor = ord.side === 'defender' ? '#60a5fa' : '#f87171';
      const ratioColor = ord.ratioPct >= 50 ? '#4ade80' : '#f87171';
      const priority = normalizeOrderPriority(ord.priority);
      const priorityColor = getOrderRadarPriorityColor(priority);
      const priorityLabel = priority ? t(`orderRadarPriority${priority[0].toUpperCase()}${priority.slice(1)}`) : '';
      const p = Math.max(0, Math.min(100, Number(ord.ratioPct) || 0));
      const priorityMarker = `width:${compact ? 16 : 12}px; height:${compact ? 16 : 12}px; background:radial-gradient(circle, ${priorityColor} 0 27%, transparent 30% 43%, ${priorityColor} 46% 59%, transparent 62%); filter:drop-shadow(0 0 2px ${priorityColor}); flex:0 0 auto;`;

      let gridStyle = 'display:grid; grid-template-columns:auto auto minmax(48px,1fr) 40px 46px 46px; align-items:center; gap:7px;';
      if (level === 'no-region') {
        gridStyle = 'display:grid; grid-template-columns:auto auto 40px 46px 46px; align-items:center; gap:7px;';
      } else if (level === 'minimal') {
        gridStyle = 'display:grid; grid-template-columns:auto auto 40px; align-items:center; gap:7px;';
      } else if (level === 'icon-only') {
        gridStyle = 'display:flex; justify-content:center; align-items:center; width:24px; height:24px; border-radius:50%;';
      }

      row.style.cssText = `
        ${gridStyle}
        padding:${compact ? '2px' : '3px 9px'}; border-radius:${compact ? '50%' : '5px'}; border-left:${compact ? '1px' : '3px'} solid ${sideColor};
        font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; line-height:1.35;
        color:#f8fafc; text-shadow:0 1px 2px rgba(0,0,0,0.85); text-decoration:none; cursor:pointer;
        box-sizing:border-box; width:100%;
        background: linear-gradient(90deg, rgba(37,99,235,0.42) 0%, rgba(37,99,235,0.42) ${p}%, rgba(153,27,27,0.42) ${p}%, rgba(153,27,27,0.42) 100%);
        transition: filter 0.12s;
      `;

      const matchup = ord.isTournament
        ? '🏆'
        : `${codeToFlag(ord.ownCode) || esc(ord.ownCode)} › ${codeToFlag(ord.enemyCode) || esc(ord.enemyCode)}`;

      const markerHtml = `<span aria-label="${esc(priorityLabel)}" title="${esc(priorityLabel)}" style="${priorityMarker} opacity:${priority ? '1' : '.55'};"></span>`;
      row.title = `${priorityLabel ? priorityLabel + ' · ' : ''}${matchup} · ${esc(ord.region)}`;

      if (level === 'icon-only') {
        row.innerHTML = markerHtml;
      } else if (level === 'minimal') {
        row.innerHTML = `
          ${markerHtml}
          <span style="white-space:nowrap;">${matchup}</span>
          <span style="text-align:right; font-weight:700; color:${ratioColor};">${Number(ord.ratioPct)}%</span>
        `;
      } else if (level === 'no-region') {
        row.innerHTML = `
          ${markerHtml}
          <span style="white-space:nowrap;">${matchup}</span>
          <span style="text-align:right; font-weight:700; color:${ratioColor};">${Number(ord.ratioPct)}%</span>
          <span style="text-align:right; color:#e2e8f0; white-space:nowrap;">⛰${Number(ord.ground)}</span>
          <span style="text-align:right; color:#fbbf24; white-space:nowrap;">💰${Number(ord.ratePer1k)}</span>
        `;
      } else {
        row.innerHTML = `
          ${markerHtml}
          <span style="white-space:nowrap;">${matchup}</span>
          <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(ord.region)}</span>
          <span style="text-align:right; font-weight:700; color:${ratioColor};">${Number(ord.ratioPct)}%</span>
          <span style="text-align:right; color:#e2e8f0; white-space:nowrap;">⛰${Number(ord.ground)}</span>
          <span style="text-align:right; color:#fbbf24; white-space:nowrap;">💰${Number(ord.ratePer1k)}</span>
        `;
      }

      row.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.button === 1 || e.shiftKey) return;
        e.preventDefault();
        PAGE_WINDOW.location.href = getOrderRadarBattleUrl(ord.battleId);
      });

      row.addEventListener('mouseenter', () => { row.style.filter = 'brightness(1.18)'; });
      row.addEventListener('mouseleave', () => { row.style.filter = 'none'; });

      wrap.appendChild(row);
    });

    if (!container.contains(wrap)) {
      container.appendChild(wrap);
    }
    attachOrderRadarResizeObserver(container);
  }

  async function applyOrderRadar() {
    if (!CONFIG.featBattleAdvisor || !CONFIG.featOrderRadar) {
      setHealth('orderRadar', 'idle', 'disabled in settings');
      const existing = document.getElementById('wia-order-radar');
      if (existing) existing.remove();
      return;
    }

    const route = getEntityFromRoute();
    if (!route) {
      setHealth('orderRadar', 'idle', 'not on country or MU page');
      const existing = document.getElementById('wia-order-radar');
      if (existing) existing.remove();
      return;
    }

    const entityKey = `${route.type}:${route.rawId}`;
    if (orderRadarActiveRouteKey !== entityKey) {
      orderRadarActiveRouteKey = entityKey;
      orderRadarRetryCount = 0;
    }

    const requestId = ++orderRadarRequestId;
    const requestedRoute = { type: route.type, rawId: route.rawId };
    try {
      const fetched = await fetchOrdersForEntity(route.type, route.rawId);
      const orders = fetched.orders;
      if (!isCurrentOrderRadarRequest(requestId, orderRadarRequestId, requestedRoute, getEntityFromRoute())) return;
      orderRadarLastOrders = orders;
      orderRadarLastEntity = `${route.type}:${route.rawId}`;

      if (!orders || orders.length === 0) {
        setHealth('orderRadar', 'idle', 'no active orders for this entity');
        orderRadarLastZeroCheckAt = now();
        const existing = document.getElementById('wia-order-radar');
        if (existing) existing.remove();
        return;
      }

      let container = findEntityBannerAnchor(route);
      if (!container) {
        if (orderRadarRetryCount < 10) {
          orderRadarRetryCount++;
          setHealth('orderRadar', 'warn', 'header container mounting');
          scheduleOrderRadar();
        } else {
          setHealth('orderRadar', 'fail', 'header container not found');
        }
        return;
      }

      renderOrderRadarUI(orders);

      // Priority details are intentionally background work: the base radar must
      // appear immediately even when the API throttle queues several detail reads.
      fetched.priorityPromise.then((enriched) => {
        if (!isCurrentOrderRadarRequest(requestId, orderRadarRequestId, requestedRoute, getEntityFromRoute())) return;
        orderRadarLastOrders = enriched;
        renderOrderRadarUI(enriched);
        setHealth('orderRadar', 'ok', `${enriched.length} orders rendered`);
      }).catch(() => {});

      // Re-find the anchor: React may have re-rendered the banner during the await.
      const anchor = findEntityBannerAnchor(route);
      const injected = document.getElementById('wia-order-radar');
      const isVisible = injected && (injected.offsetParent !== null || injected.getBoundingClientRect().height > 0);
      const isInsideBanner = anchor && anchor.contains(injected);

      if (injected && isVisible && isInsideBanner) {
        setHealth('orderRadar', 'ok', `${orders.length} orders rendered`);
      } else {
        // Banner not settled yet — schedule retry.
        if (orderRadarRetryCount < 10) {
          orderRadarRetryCount++;
          setHealth('orderRadar', 'warn', 'radar not injected yet');
          scheduleOrderRadar();
        } else {
          setHealth('orderRadar', 'fail', 'radar injection failed');
        }
      }
    } catch (e) {
      setHealth('orderRadar', 'fail', 'fetch failed: ' + e.message);
    }
  }

  if (CONFIG.debug || typeof process !== 'undefined') {
    globalThis.filterOrdersForCountry = filterOrdersForCountry;
    globalThis.filterOrdersForMu = filterOrdersForMu;
    globalThis.getEntityFromRoute = getEntityFromRoute;
    globalThis.findEntityBannerAnchor = findEntityBannerAnchor;
    globalThis.resolveCanonicalCountryId = resolveCanonicalCountryId;
    globalThis.getOrderRadarBattleUrl = getOrderRadarBattleUrl;
    globalThis.getPagePathname = getPagePathname;
    globalThis.isCurrentOrderRadarRoute = isCurrentOrderRadarRoute;
    globalThis.isCurrentOrderRadarRequest = isCurrentOrderRadarRequest;
    globalThis.normalizeOrderPriority = normalizeOrderPriority;
    globalThis.sortOrdersByPriority = sortOrdersByPriority;
    globalThis.shouldCompactOrderRadar = shouldCompactOrderRadar;
    globalThis.getOrderRadarCompactLevel = getOrderRadarCompactLevel;
    globalThis.applyOrderRadar = applyOrderRadar;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Troop Radar module (Issue #61) — Phase 1 Core Logic & Data Fetching
  // ───────────────────────────────────────────────────────────────────────────
  const TROOP_RADAR_TTL_MS = 4 * 60 * 1000; // 4 minutes TTL for cached member data
  const troopRadarMemberCache = new Map();  // userId -> { at, data }
  const troopRadarRosterCache = new Map();  // muId -> { at, roster }
  let troopRadarLoading = false;
  let troopRadarDamageMode = 'tag';
  let troopRadarLastSummary = null;
  let troopRadarLastMembers = [];

  function isValidBaselineShape(o) {
    if (!o || typeof o !== 'object') return false;
    const spec = {
      weapon: ['dmg', 'crit'],
      gloves: ['precision'],
      helmet: ['critDmg'],
      chest: ['armor'],
      pants: ['armor'],
      boots: ['dodge']
    };
    for (const [slot, leaves] of Object.entries(spec)) {
      if (!o[slot] || typeof o[slot] !== 'object') return false;
      for (const leaf of leaves) {
        if (!(leaf in o[slot]) || !Number.isFinite(Number(o[slot][leaf]))) return false;
      }
    }
    return true;
  }

  function loadBaselineSet() {
    const raw = GM_getValue(KEYS.customBaselineSet, null);
    if (raw === null) {
      return JSON.parse(JSON.stringify(CONFIG.CUSTOM_SET));
    }
    try {
      const o = JSON.parse(raw);
      return isValidBaselineShape(o) ? o : JSON.parse(JSON.stringify(CONFIG.CUSTOM_SET));
    } catch (e) {
      return JSON.parse(JSON.stringify(CONFIG.CUSTOM_SET));
    }
  }

  let activeBaselineSet = loadBaselineSet();

  function getActiveBaselineSet() {
    return activeBaselineSet;
  }

  function setActiveBaselineSet(val) {
    activeBaselineSet = val;
  }

  function classifyWarskiller(skills, charLevel = 0, uid = null) {
    if (!skills || typeof skills !== 'object') {
      return { isWarskiller: false, warShare: 0, ecoShare: 0, warSum: 0, ecoSum: 0, totalPoints: 0, build: 'eco', emoji: '💰', label: 'Eco', archetype: 'profileClassWorker', supporterAdjectiveIndex: -1 };
    }
    let progressionLevel = charLevel > 0 ? charLevel : 0;
    const warSum = (skills.attack?.level || 0) +
                   (skills.criticalChance?.level || 0) +
                   (skills.criticalDamages?.level || 0) +
                   (skills.precision?.level || 0) +
                   (skills.armor?.level || 0) +
                   (skills.dodge?.level || 0) +
                   (skills.health?.level || 0) +
                   (skills.hunger?.level || 0) +
                   (skills.lootChance?.level || 0);
    const ecoSum = (skills.entrepreneurship?.level || 0) +
                   (skills.energy?.level || 0) +
                   (skills.production?.level || 0) +
                   (skills.companies?.level || 0) +
                   (skills.management?.level || 0);
    const totalPoints = warSum + ecoSum;
    const warShare = totalPoints > 0 ? warSum / totalPoints : 0;
    const ecoShare = totalPoints > 0 ? ecoSum / totalPoints : 0;

    let build = 'eco';
    let isWarskiller = false;
    let emoji = '💰';
    let label = 'Eco';
    let archetype = 'profileClassWorker';

    if (warShare >= 0.75) {
      build = 'war';
      isWarskiller = true;
      emoji = '💥';
      label = 'WAR';
      const atk = skills.attack?.level || 0;
      const arm = skills.armor?.level || 0;
      const dge = skills.dodge?.level || 0;

      const crt = skills.criticalChance?.level || 0;
      const cdm = skills.criticalDamages?.level || 0;
      const prc = skills.precision?.level || 0;

      if (progressionLevel === 0) progressionLevel = atk;

      const offSum = atk + crt + cdm + prc;
      const defSum = arm + dge;

      if (defSum >= offSum * 0.5) {
        if (arm >= dge) {
          if (progressionLevel < 15) archetype = 'profileClassThug';
          else if (progressionLevel < 20) archetype = 'profileClassMercenary';
          else if (progressionLevel < 25) archetype = 'profileClassBulwark';
          else if (progressionLevel < 30) archetype = 'profileClassJuggernaut';
          else if (progressionLevel < 40) archetype = 'profileClassFortress';
          else archetype = 'profileClassTitan';
        } else {
          if (progressionLevel < 15) archetype = 'profileClassThief';
          else if (progressionLevel < 20) archetype = 'profileClassScout';
          else if (progressionLevel < 25) archetype = 'profileClassSkirmisher';
          else if (progressionLevel < 30) archetype = 'profileClassAssassin';
          else if (progressionLevel < 40) archetype = 'profileClassPhantom';
          else archetype = 'profileClassShadow';
        }
      } else {
        if (progressionLevel < 15) archetype = 'profileClassBrawler';
        else if (progressionLevel < 20) archetype = 'profileClassGunslinger';
        else if (progressionLevel < 25) archetype = 'profileClassRifleman';
        else if (progressionLevel < 30) archetype = 'profileClassSniper';
        else if (progressionLevel < 40) archetype = 'profileClassTankCommander';
        else archetype = 'profileClassFighterPilot';
      }
    } else if (ecoShare >= 0.75) {
      build = 'eco';
      isWarskiller = false;
      emoji = '💰';
      label = 'Eco';

      if (progressionLevel === 0) {
        progressionLevel = Math.max(skills.energy?.level || 0, skills.production?.level || 0, skills.companies?.level || 0);
      }

      const mgmt = skills.management?.level || 0;
      const comp = skills.companies?.level || 0;

      if (mgmt >= 1) {
        if (mgmt < 2) archetype = 'profileClassOverseer';
        else if (mgmt < 3) archetype = 'profileClassAdministrator';
        else if (mgmt < 4) archetype = 'profileClassManager';
        else if (mgmt < 5) archetype = 'profileClassDirector';
        else if (mgmt < 6) archetype = 'profileClassCEO';
        else archetype = 'profileClassChairman';
      } else if (comp / 10 > progressionLevel / 50) {
        if (comp < 3) archetype = 'profileClassTrader';
        else if (comp < 5) archetype = 'profileClassMerchant';
        else if (comp < 7) archetype = 'profileClassEntrepreneur';
        else if (comp < 9) archetype = 'profileClassInvestor';
        else if (comp < 10) archetype = 'profileClassTycoon';
        else archetype = 'profileClassMagnate';
      } else {
        if (progressionLevel < 15) archetype = 'profileClassWorker';
        else if (progressionLevel < 20) archetype = 'profileClassShiftSupervisor';
        else if (progressionLevel < 25) archetype = 'profileClassForeman';
        else if (progressionLevel < 30) archetype = 'profileClassTechnician';
        else if (progressionLevel < 40) archetype = 'profileClassMasterCraftsman';
        else archetype = 'profileClassChiefEngineer';
      }
    } else {
      build = 'hybrid';
      isWarskiller = false;
      emoji = '⚖';
      label = 'Hybrid';
      if (progressionLevel === 0) {
        progressionLevel = Math.max(skills.attack?.level || 0, skills.companies?.level || 0, skills.management?.level || 0, skills.energy?.level || 0);
      }
      const loot = skills.lootChance?.level || 0;

      if (loot / 8 >= progressionLevel / 50) {
        if (progressionLevel < 15) archetype = 'profileClassOpportunist';
        else if (progressionLevel < 20) archetype = 'profileClassFortuneHunter';
        else if (progressionLevel < 25) archetype = 'profileClassGambler';
        else if (progressionLevel < 30) archetype = 'profileClassHighRoller';
        else if (progressionLevel < 40) archetype = 'profileClassSpeculator';
        else archetype = 'profileClassCasinoBoss';
      } else {
        if (progressionLevel < 15) archetype = 'profileClassAdventurer';
        else if (progressionLevel < 20) archetype = 'profileClassFreelancer';
        else if (progressionLevel < 25) archetype = 'profileClassVeteran';
        else if (progressionLevel < 30) archetype = 'profileClassWarlord';
        else if (progressionLevel < 40) archetype = 'profileClassSyndicateBoss';
        else archetype = 'profileClassEmperor';
      }
    }

    let supporterAdjectiveIndex = -1;
    if (uid) {
      const hashUid = (str) => {
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
          hash ^= str.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      };
      const h = hashUid(uid);

      if (h === 4192061616) {
        archetype = 'profileClassCreator';
        emoji = '🍻';
        label = 'PROST';
      } else {
        const SUPPORTERS = [
          116223963,
          1464792437,
          285976846,
          3211084130,
          2740677414,
          858126142,
          1666352841,
          1150565605,
          2823877408,
          2865049335,
          2358290053
        ];
        if (SUPPORTERS.includes(h)) {
          supporterAdjectiveIndex = parseInt(uid.slice(-4), 16) % 10;
          emoji = '💖';
        }
      }
    }

    return {
      isWarskiller,
      warShare: Math.round(warShare * 100) / 100,
      ecoShare: Math.round(ecoShare * 100) / 100,
      warSum,
      ecoSum,
      totalPoints,
      build,
      emoji,
      label,
      archetype,
      supporterAdjectiveIndex
    };
  }

  function evaluatePillStatus(skills, health, hunger) {
    const buffsPercent = skills?.attack?.buffsPercent || 0;
    const debuffsPercent = skills?.attack?.debuffsPercent || 0;
    const hpCurrent = health?.currentBarValue ?? health?.current ?? 100;
    const hpMax = health?.total ?? 100;
    const hungerCurrent = hunger?.currentBarValue ?? hunger?.current ?? 100;
    const hungerMax = hunger?.total ?? 100;

    let pillState = 'pill-cd'; // default: nicht bereit / CD
    if (buffsPercent > 0) {
      pillState = 'pill-on'; // gepillt
    } else if (debuffsPercent > 0) {
      pillState = 'pill-cd'; // Debuff active -> nicht bereit
    } else if (hpCurrent >= hpMax && hungerCurrent >= hungerMax) {
      pillState = 'pill-off'; // ungepillt & bereit → Action!
    } else {
      pillState = 'pill-cd'; // nicht bereit (injured/hungry)
    }

    const label = pillState === 'pill-on' ? 'gepillt' : pillState === 'pill-off' ? 'bereit' : 'nicht bereit';
    return {
      state: pillState,
      label,
      isReadyToPill: pillState === 'pill-off',
      buffsPercent,
      debuffsPercent,
      hpCurrent,
      hpMax,
      hungerCurrent,
      hungerMax
    };
  }

  function createOptimisticMemberData(userId) {
    return {
      userId,
      hpCurrent: 100,
      hpMax: 100,
      hungerCurrent: 100,
      hungerMax: 100,
      buffsPercent: 0,
      debuffsPercent: 0,
      warShare: 0,
      isWarskiller: false,
      build: 'eco',
      archetype: 'profileClassWorker',
      supporterAdjectiveIndex: -1,
      pillState: 'pill-cd',
      pillReady: false,
      buffEndAt: null,
      debuffEndAt: null,
      isOptimistic: true,
      updatedAt: 0,
      isActive: true,
      combat: {
        attackValue: null,
        rank: null,
        precisionValue: null,
        critChanceValue: null,
        critDmgValue: null,
        armorValue: null,
        dodgeValue: null,
        healthMax: null,
        hungerMax: null,
        weaponDmgReal: null,
        precisionEquip: null,
        critChanceWeapon: null,
        critDmgEquip: null,
        armorEquip: null,
        dodgeEquip: null,
        healthRegen: null,
        hungerRegen: null,
        weeklyDamage: null,
        lastSkillsResetAt: null
      }
    };
  }

  function contribsOf(s) {
    const n = (x) => Number(x) || 0;
    return {
      weaponDmg:  n(s.weapon.dmg),
      weaponCrit: n(s.weapon.crit),
      precision:  n(s.gloves.precision),
      critDmg:    n(s.helmet.critDmg),
      armor:      n(s.chest.armor) + n(s.pants.armor),
      dodge:      n(s.boots.dodge),
    };
  }

  function baselineContribs() {
    return contribsOf(activeBaselineSet);
  }

  function computeDamagePotential(member, opts = {}) {
    if (!member || !member.combat) {
      return { dailyDmg: 0, degraded: true };
    }
    const c = member.combat;
    const required = [
      c.attackValue,
      c.rank,
      c.precisionValue,
      c.critChanceValue,
      c.critDmgValue,
      c.armorValue,
      c.dodgeValue,
      c.healthMax,
      c.hungerMax
    ];
    for (const val of required) {
      if (val === null || val === undefined || isNaN(val)) {
        return { dailyDmg: 0, degraded: true };
      }
    }

    // Custom set baseline source
    const bTag   = baselineContribs();             // active/custom set → Tag path
    const bFloor = contribsOf(CONFIG.CUSTOM_SET);  // immutable default (blue) → Live floor

    // Choose equipment contributions based on mode
    const isReal = opts.equip === 'realFloored';
    const effWeaponDmg  = isReal ? Math.max(c.weaponDmgReal ?? 0, bFloor.weaponDmg)   : bTag.weaponDmg;
    const effWeaponCrit = isReal ? Math.max(c.critChanceWeapon ?? 0, bFloor.weaponCrit) : bTag.weaponCrit;
    const effPrecision  = isReal ? Math.max(c.precisionEquip ?? 0, bFloor.precision)   : bTag.precision;
    const effCritDmg    = isReal ? Math.max(c.critDmgEquip ?? 0, bFloor.critDmg)       : bTag.critDmg;
    const effArmor      = isReal ? Math.max(c.armorEquip ?? 0, bFloor.armor)           : bTag.armor;
    const effDodge      = isReal ? Math.max(c.dodgeEquip ?? 0, bFloor.dodge)           : bTag.dodge;

    const PILL_BUFF_PCT = CONFIG.PILL_BUFF_PCT ?? 60;
    const AMMO_GREEN_PCT = CONFIG.AMMO_GREEN_PCT ?? 10;
    const FOOD_PCT_STEAK = CONFIG.FOOD_PCT_STEAK ?? 0.5;

    // Formulas using effective contributions
    const Schaden = (c.attackValue + effWeaponDmg) * (1 + AMMO_GREEN_PCT / 100) * (1 + PILL_BUFF_PCT / 100) * (1 + c.rank / 100);
    const Precision = Math.min(c.precisionValue + effPrecision, 100) / 100;
    const CritChance = Math.min(c.critChanceValue + effWeaponCrit, 100) / 100;
    const CritDmg = (c.critDmgValue + effCritDmg) / 100;
    const Armor = c.armorValue + effArmor;
    const Dodge = c.dodgeValue + effDodge;
    const HealthBar = c.healthMax;
    const HungerBar = c.hungerMax;

    const dailyDmg = 1.8 * Schaden * HealthBar * (1 + HungerBar * FOOD_PCT_STEAK)
                   * (0.5 + 0.5 * Precision + Precision * CritChance * CritDmg)
                   * (0.1 + (Armor + Dodge) / 400 + (Armor * Dodge) / 16000);

    if (isNaN(dailyDmg) || !isFinite(dailyDmg)) {
      return { dailyDmg: 0, degraded: true };
    }

    return { dailyDmg, degraded: false };
  }

  function getLiveHorizonHour() {
    const raw = GM_getValue(KEYS.troopRadarLiveHorizonHour, CONFIG.DAILY_RESET_HOUR ?? 2);
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? (CONFIG.DAILY_RESET_HOUR ?? 2) : Math.max(0, Math.min(23, parsed));
  }

  function hoursUntilDailyReset(now) {
    const nowDate = new Date(now);
    const resetToday = new Date(nowDate);
    resetToday.setHours(CONFIG.DAILY_RESET_HOUR ?? 2, 0, 0, 0);
    let nextReset = resetToday;
    if (nowDate >= resetToday) {
      nextReset = new Date(resetToday.getTime() + 24 * 60 * 60 * 1000);
    }
    return Math.max(0, (nextReset.getTime() - nowDate.getTime()) / (1000 * 60 * 60));
  }

  function computeLiveDamagePotential(member, now, horizonHour = (CONFIG.DAILY_RESET_HOUR ?? 2)) {
    const rawDmg = computeDamagePotential(member, { equip: 'realFloored' });
    if (rawDmg.degraded) {
      return { liveDmg: 0, degraded: true };
    }

    const nowDate = new Date(now);
    let effectiveStart = nowDate;
    if (member.debuffEndAt) {
      const debuffDate = new Date(member.debuffEndAt);
      if (debuffDate > effectiveStart) {
        effectiveStart = debuffDate;
      }
    }

    const resetToday = new Date(nowDate);
    resetToday.setHours(horizonHour, 0, 0, 0);
    let nextReset = resetToday;
    if (nowDate >= resetToday) {
      nextReset = new Date(resetToday.getTime() + 24 * 60 * 60 * 1000);
    }

    const usableHours = Math.max(0, (nextReset.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60));

    const c = member.combat || {};
    const healthRegen = c.healthRegen ?? 0;
    const hpCurrent = member.hpCurrent ?? 100;
    const hpMax = member.hpMax ?? 100;

    const throughput = hpCurrent + healthRegen * usableHours;
    const fracH = Math.min(Math.max(throughput / (1.8 * hpMax), 0), 1);
    const liveDmg = rawDmg.dailyDmg * fracH;

    return {
      liveDmg,
      degraded: false,
      usableHours,
      fracH
    };
  }

  function sumLiveDamage(members, now, horizonHour = (CONFIG.DAILY_RESET_HOUR ?? 2)) {
    const activeWarskillers = Array.isArray(members)
      ? members.filter(m => m.isActive !== false && m.isWarskiller)
      : [];

    let liveSum = 0;
    let computedCount = 0;
    let totalCount = activeWarskillers.length;
    let observedSum = 0;

    activeWarskillers.forEach(m => {
      const res = computeLiveDamagePotential(m, now, horizonHour);
      if (!res.degraded) {
        liveSum += res.liveDmg;
        computedCount++;
      }
      const c = m.combat || {};
      if (c.weeklyDamage !== null && c.weeklyDamage !== undefined && !isNaN(c.weeklyDamage)) {
        let denominator = 7;
        if (c.lastSkillsResetAt) {
          const resetDate = new Date(c.lastSkillsResetAt);
          if (!isNaN(resetDate.getTime())) {
            const diffMs = new Date(now).getTime() - resetDate.getTime();
            const daysSinceReset = diffMs / (1000 * 60 * 60 * 24);
            if (daysSinceReset > 0 && daysSinceReset < 7) {
              denominator = Math.max(1, daysSinceReset);
            }
          }
        }
        observedSum += (c.weeklyDamage / denominator);
      }
    });

    return {
      live: liveSum,
      computed: computedCount,
      total: totalCount,
      observed: observedSum
    };
  }

  function memberEffPoolPct(m) {
    const hpCurrent = m.hpCurrent !== undefined && m.hpCurrent !== null ? m.hpCurrent : 100;
    const hpMax = m.hpMax !== undefined && m.hpMax !== null ? m.hpMax : 100;
    const hungerCurrent = m.hungerCurrent !== undefined && m.hungerCurrent !== null ? m.hungerCurrent : 100;
    const hungerMax = m.hungerMax !== undefined && m.hungerMax !== null ? m.hungerMax : 100;

    const FOOD_PCT_STEAK = CONFIG.FOOD_PCT_STEAK ?? 0.5;
    const num = hpCurrent + hungerCurrent * FOOD_PCT_STEAK;
    const den = hpMax + hungerMax * FOOD_PCT_STEAK;
    if (den <= 0) return 100;
    return (num / den) * 100;
  }

  function barColor(pct) {
    return pct >= 80 ? '#22c55e' : pct >= 40 ? '#eab308' : '#ef4444';
  }

  function computeMemberDamage(m, mode, now, horizonHour) {
    if (m.isActive === false) {
      return { dmgVal: 0, degraded: true };
    }
    if (mode === 'tag') {
      const res = computeDamagePotential(m);
      return { dmgVal: res.dailyDmg, degraded: res.degraded };
    } else {
      const res = computeLiveDamagePotential(m, now, horizonHour);
      return { dmgVal: res.liveDmg, degraded: res.degraded };
    }
  }

  function summarizeTroops(membersArray) {
    const activeMembers = Array.isArray(membersArray)
      ? membersArray.filter(m => m.isActive !== false)
      : [];

    if (activeMembers.length === 0) {
      return {
        totalMembers: 0,
        readyCount: 0,
        warskillerCount: 0,
        pillCount: 0,
        avgHpPct: 0,
        avgHungerPct: 0,
        avgEffPoolPct: 0,
        actionableWarskillers: [],
        damagePotential: 0,
        damageComputedCount: 0,
        damageTotalCount: 0
      };
    }

    const totalMembers = activeMembers.length;
    const warskillers = activeMembers.filter((m) => m.isWarskiller);
    const warskillerCount = warskillers.length;
    const pillCount = activeMembers.filter((m) => m.pillState === 'pill-on').length;

    // Kampfbereit = Warskiller + H&H >= 80% + (gepillt ODER nicht im Debuff)
    const readyCount = activeMembers.filter((m) => {
      const hpPct = m.hpMax > 0 ? m.hpCurrent / m.hpMax : 1;
      const hungerPct = m.hungerMax > 0 ? m.hungerCurrent / m.hungerMax : 1;
      const isHnHOk = hpPct >= 0.8 && hungerPct >= 0.8;
      const isPillOk = m.pillState === 'pill-on' || (m.debuffsPercent || 0) === 0;
      return m.isWarskiller && isHnHOk && isPillOk;
    }).length;

    const hpSumPct = activeMembers.reduce((acc, m) => {
      const pct = m.hpMax > 0 ? (m.hpCurrent / m.hpMax) * 100 : 100;
      return acc + pct;
    }, 0);
    const avgHpPct = Math.round(hpSumPct / totalMembers);

    const hungerSumPct = activeMembers.reduce((acc, m) => {
      const cur = m.hungerCurrent !== undefined && m.hungerCurrent !== null ? m.hungerCurrent : (m.hungerMax !== undefined && m.hungerMax !== null ? m.hungerMax : 100);
      const max = m.hungerMax !== undefined && m.hungerMax !== null ? m.hungerMax : 100;
      const pct = max > 0 ? (cur / max) * 100 : 100;
      return acc + pct;
    }, 0);
    const avgHungerPct = Math.round(hungerSumPct / totalMembers);

    const effSumPct = activeMembers.reduce((acc, m) => {
      return acc + memberEffPoolPct(m);
    }, 0);
    const avgEffPoolPct = Math.round(effSumPct / totalMembers);

    // Warskiller bereit zu pillen (ungepillt & H&H voll)
    const actionableWarskillers = activeMembers.filter((m) => m.isWarskiller && m.pillState === 'pill-off');

    let damagePotential = 0;
    let damageComputedCount = 0;
    const damageTotalCount = warskillers.length;

    warskillers.forEach((m) => {
      const { dailyDmg, degraded } = computeDamagePotential(m);
      damagePotential += dailyDmg;
      if (!degraded) {
        damageComputedCount++;
      }
    });

    return {
      totalMembers,
      readyCount,
      warskillerCount,
      pillCount,
      avgHpPct,
      avgHungerPct,
      avgEffPoolPct,
      actionableWarskillers,
      damagePotential,
      damageComputedCount,
      damageTotalCount
    };
  }

  async function fetchMuRoster(muId) {
    if (!muId || typeof muId !== 'string') throw new Error('muId string required');
    if (/^<.*>$/.test(muId.trim())) throw new Error(`Invalid placeholder muId "${muId}". Pass a real MU ID or navigate to a /mu/<id> page.`);
    const cached = troopRadarRosterCache.get(muId);
    if (cached && (now() - cached.at < TROOP_RADAR_TTL_MS)) {
      return cached.roster;
    }
    const { payload } = await resolveApiBase('mu.getById', { muId }, { priority: 'high' });
    const members = Array.isArray(payload?.members) ? payload.members : [];
    const commanders = Array.isArray(payload?.roles?.commanders) ? payload.roles.commanders : [];
    const roster = { muId, members, commanders };
    troopRadarRosterCache.set(muId, { at: now(), roster });
    return roster;
  }

  async function fetchTroopMemberData(userId, opts = {}) {
    if (!userId) throw new Error('userId required');
    const cached = troopRadarMemberCache.get(userId);
    if (cached && (now() - cached.at < TROOP_RADAR_TTL_MS)) {
      return cached.data;
    }

    try {
      const { payload } = await resolveApiBase('user.getUserById', { userId }, opts);
      const skills = payload?.skills || {};
      const health = skills.health || {};
      const hunger = skills.hunger || {};
      const charLevel = payload?.leveling?.level || payload?.user?.leveling?.level || 0;
      const uid = payload?._id || payload?.user?._id || null;
      const warskillerInfo = classifyWarskiller(skills, charLevel, uid);
      const username = payload?.username || payload?.user?.username || payload?.name;
      const pillInfo = evaluatePillStatus(skills, health, hunger);
      const buffsObj = payload?.buffs || {};
      const combat = {
        attackValue: skills.attack?.value ?? null,
        rank: skills.attack?.militaryRankPercent ?? null,
        precisionValue: skills.precision?.value ?? null,
        critChanceValue: skills.criticalChance?.value ?? null,
        critDmgValue: skills.criticalDamages?.value ?? null,
        armorValue: skills.armor?.value ?? null,
        dodgeValue: skills.dodge?.value ?? null,
        healthMax: health.value ?? null,
        hungerMax: hunger.value ?? null,
        weaponDmgReal: skills.attack?.weapon ?? null,
        precisionEquip: skills.precision?.equipment ?? null,
        critChanceWeapon: skills.criticalChance?.weapon ?? null,
        critDmgEquip: skills.criticalDamages?.equipment ?? null,
        armorEquip: skills.armor?.equipment ?? null,
        dodgeEquip: skills.dodge?.equipment ?? null,
        healthRegen: skills.health?.hourlyBarRegen ?? null,
        hungerRegen: skills.hunger?.hourlyBarRegen ?? null,
        weeklyDamage: payload?.rankings?.weeklyUserDamages?.value ?? null,
        lastSkillsResetAt: payload?.lastSkillsResetAt || payload?.user?.lastSkillsResetAt || null
      };

      const memberData = {
        userId,
        username,
        hpCurrent: pillInfo.hpCurrent,
        hpMax: pillInfo.hpMax,
        hungerCurrent: pillInfo.hungerCurrent,
        hungerMax: pillInfo.hungerMax,
        buffsPercent: pillInfo.buffsPercent,
        debuffsPercent: pillInfo.debuffsPercent,
        warShare: warskillerInfo.warShare,
        ecoShare: warskillerInfo.ecoShare,
        isWarskiller: warskillerInfo.isWarskiller,
        build: warskillerInfo.build,
        archetype: warskillerInfo.archetype,
        supporterAdjectiveIndex: warskillerInfo.supporterAdjectiveIndex,
        buildEmoji: warskillerInfo.emoji,
        buildLabel: warskillerInfo.label,
        pillState: pillInfo.state,
        pillReady: pillInfo.isReadyToPill,
        buffEndAt: buffsObj.buffEndAt || null,
        debuffEndAt: buffsObj.debuffEndAt || null,
        isOptimistic: false,
        updatedAt: now(),
        isActive: payload?.isActive !== false,
        combat
      };
      troopRadarMemberCache.set(userId, { at: now(), data: memberData });
      return memberData;
    } catch (e) {
      if (cached && cached.data) {
        return cached.data;
      }
      return createOptimisticMemberData(userId);
    }
  }

  async function fetchTroopMemberDataBatch(userIds, opts = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];

    const results = Array(userIds.length).fill(null);
    const uncachedIds = [];
    const uncachedIndices = [];

    userIds.forEach((userId, index) => {
      const cached = troopRadarMemberCache.get(userId);
      if (cached && (now() - cached.at < TROOP_RADAR_TTL_MS)) {
        results[index] = cached.data;
      } else {
        uncachedIds.push(userId);
        uncachedIndices.push(index);
      }
    });

    if (uncachedIds.length > 0) {
      const BATCH_CHUNK_SIZE = 8;
      for (let offset = 0; offset < uncachedIds.length; offset += BATCH_CHUNK_SIZE) {
        const chunkIds = uncachedIds.slice(offset, offset + BATCH_CHUNK_SIZE);
        const chunkIndices = uncachedIndices.slice(offset, offset + BATCH_CHUNK_SIZE);

        await (async () => {
          try {
            const batchArgs = chunkIds.map((userId) => ({ userId }));
            const batchResults = await resolveApiBatch('user.getUserById', batchArgs, opts);

            batchResults.forEach((res, i) => {
              const userId = chunkIds[i];
              const origIndex = chunkIndices[i];

              if (res.error) {
                const cached = troopRadarMemberCache.get(userId);
                results[origIndex] = (cached && cached.data) ? cached.data : createOptimisticMemberData(userId);
                return;
              }

              const payload = res.payload;
              const skills = payload?.skills || {};
              const health = skills.health || {};
              const hunger = skills.hunger || {};
              const charLevel = payload?.leveling?.level || payload?.user?.leveling?.level || 0;
              const uid = payload?._id || payload?.user?._id || null;
              const warskillerInfo = classifyWarskiller(skills, charLevel, uid);
              const username = payload?.username || payload?.user?.username || payload?.name;
              const pillInfo = evaluatePillStatus(skills, health, hunger);
              const buffsObj = payload?.buffs || {};
              const combat = {
                attackValue: skills.attack?.value ?? null,
                rank: skills.attack?.militaryRankPercent ?? null,
                precisionValue: skills.precision?.value ?? null,
                critChanceValue: skills.criticalChance?.value ?? null,
                critDmgValue: skills.criticalDamages?.value ?? null,
                armorValue: skills.armor?.value ?? null,
                dodgeValue: skills.dodge?.value ?? null,
                healthMax: health.value ?? null,
                hungerMax: hunger.value ?? null,
                weaponDmgReal: skills.attack?.weapon ?? null,
                precisionEquip: skills.precision?.equipment ?? null,
                critChanceWeapon: skills.criticalChance?.weapon ?? null,
                critDmgEquip: skills.criticalDamages?.equipment ?? null,
                armorEquip: skills.armor?.equipment ?? null,
                dodgeEquip: skills.dodge?.equipment ?? null,
                healthRegen: skills.health?.hourlyBarRegen ?? null,
                hungerRegen: skills.hunger?.hourlyBarRegen ?? null,
                weeklyDamage: payload?.rankings?.weeklyUserDamages?.value ?? null,
                lastSkillsResetAt: payload?.lastSkillsResetAt || payload?.user?.lastSkillsResetAt || null
              };

              const memberData = {
                userId,
                username,
                hpCurrent: pillInfo.hpCurrent,
                hpMax: pillInfo.hpMax,
                hungerCurrent: pillInfo.hungerCurrent,
                hungerMax: pillInfo.hungerMax,
                buffsPercent: pillInfo.buffsPercent,
                debuffsPercent: pillInfo.debuffsPercent,
                warShare: warskillerInfo.warShare,
                ecoShare: warskillerInfo.ecoShare,
                isWarskiller: warskillerInfo.isWarskiller,
                build: warskillerInfo.build,
                archetype: warskillerInfo.archetype,
                supporterAdjectiveIndex: warskillerInfo.supporterAdjectiveIndex,
                buildEmoji: warskillerInfo.emoji,
                buildLabel: warskillerInfo.label,
                pillState: pillInfo.state,
                pillReady: pillInfo.isReadyToPill,
                buffEndAt: buffsObj.buffEndAt || null,
                debuffEndAt: buffsObj.debuffEndAt || null,
                isOptimistic: false,
                updatedAt: now(),
                isActive: payload?.isActive !== false,
                combat
              };

              troopRadarMemberCache.set(userId, { at: now(), data: memberData });
              results[origIndex] = memberData;
            });
          } catch (e) {
            dbg('troopRadar', 'warn', `batch chunk fetch failed: ${e.message}`);
            chunkIds.forEach((userId, i) => {
              const origIndex = chunkIndices[i];
              if (results[origIndex] === null) {
                const cached = troopRadarMemberCache.get(userId);
                results[origIndex] = (cached && cached.data) ? cached.data : createOptimisticMemberData(userId);
              }
            });
          }
        })();
      }
    }

    return results;
  }

  async function fetchFullTroopRadar(muId) {
    const roster = await fetchMuRoster(muId);
    const userIds = roster.members || [];

    const membersData = userIds.map((id) => {
      const cached = troopRadarMemberCache.get(id);
      return cached ? cached.data : createOptimisticMemberData(id);
    });

    const summary = summarizeTroops(membersData);

    const detailsPromise = (async () => {
      // 'high' priority (not skipThrottle): route through the shared bucket so
      // it's paced against real rate limits, but jump ahead of background pollers
      // instead of bypassing throttling outright — bypassing entirely just meant
      // this competed with everyone else for the browser's own connection pool
      // instead of being coordinated by us at all.
      const results = await fetchTroopMemberDataBatch(userIds, { priority: 'high' });
      return {
        roster,
        membersData: results,
        summary: summarizeTroops(results)
      };
    })();

    return {
      roster,
      membersData,
      summary,
      detailsPromise
    };
  }

  function findTroopRadarHeaderAnchor() {
    if (typeof document === 'undefined') return null;
    const mainWin = document.getElementById('main-window') || document.body;
    const spans = mainWin.querySelectorAll('span');
    for (const span of spans) {
      const txt = (span.textContent || '').trim();
      if (txt === 'Members' || txt === 'Mitglieder') {
        const box = span.closest('._1dnmndyaov') || span.closest('._1dnmndy8m') || span.parentElement?.parentElement;
        if (box) return box;
      }
    }
    return null;
  }

  async function printTroopDamageBreakdown(explicitId) {
    if (typeof fetchFullTroopRadar !== 'function') return 'troopRadar not loaded';
    let muId = explicitId;
    if (!muId || muId === '<muId>' || (typeof muId === 'string' && muId.includes('<'))) {
      const route = typeof getEntityFromRoute === 'function' ? getEntityFromRoute() : null;
      if (route && route.type === 'mu') {
        muId = route.rawId;
      } else {
        console.warn('[PROST:troopRadar] No MU ID provided or auto-detected.');
        return 'Missing MU ID';
      }
    }
    try {
      const res = await fetchFullTroopRadar(muId);
      const full = await res.detailsPromise;
      const warskillers = full.membersData.filter(m => m.isWarskiller);

      const tDate = new Date();
      const liveSummary = sumLiveDamage(full.membersData, tDate);

      const tableRows = warskillers.map(m => {
        const tagRes = computeDamagePotential(m, { equip: 'blue' });
        const realRes = computeDamagePotential(m, { equip: 'realFloored' });
        const liveRes = computeLiveDamagePotential(m, tDate);
        const c = m.combat || {};

        let denominator = 7;
        if (c.lastSkillsResetAt) {
          const resetDate = new Date(c.lastSkillsResetAt);
          if (!isNaN(resetDate.getTime())) {
            const diffMs = tDate.getTime() - resetDate.getTime();
            const daysSinceReset = diffMs / (1000 * 60 * 60 * 24);
            if (daysSinceReset > 0 && daysSinceReset < 7) {
              denominator = Math.max(1, daysSinceReset);
            }
          }
        }
        const obsAvg = c.weeklyDamage !== null && c.weeklyDamage !== undefined ? (c.weeklyDamage / denominator) : null;

        const formatDmg = (val) => val !== null && val !== undefined ? (val / 1000000).toFixed(2) + 'M' : 'N/A';

        const b = contribsOf(CONFIG.CUSTOM_SET);

        const getGearSource = (realVal, baseline) => {
          if (realVal === null || realVal === undefined) return 'blue';
          return realVal > baseline ? 'real' : 'blue';
        };

        return {
          'Spieler': m.username || m.userId,
          'Degraded': liveRes.degraded,
          'Tag (Blue)': formatDmg(tagRes.dailyDmg),
          'Real floored': formatDmg(realRes.dailyDmg),
          'Live (Rest)': formatDmg(liveRes.liveDmg),
          'Observed Avg': formatDmg(obsAvg),
          'Reset At': c.lastSkillsResetAt || 'null',
          'Hours Left': liveRes.usableHours !== undefined ? liveRes.usableHours.toFixed(2) : 'N/A',
          'fracH': liveRes.fracH !== undefined ? (liveRes.fracH * 100).toFixed(1) + '%' : 'N/A',
          'Wpn': getGearSource(c.weaponDmgReal, b.weaponDmg),
          'Prec': getGearSource(c.precisionEquip, b.precision),
          'Crit': getGearSource(c.critChanceWeapon, b.weaponCrit),
          'Helm': getGearSource(c.critDmgEquip, b.critDmg),
          'Chest/Pants': getGearSource(c.armorEquip, b.armor),
          'Boots': getGearSource(c.dodgeEquip, b.dodge)
        };
      });

      console.log(`=== Troop Radar Damage Potential Breakdown for MU: ${muId} ===`);
      console.log(`Total active Warskillers: ${warskillers.length}`);
      console.table(tableRows);

      console.log(`=== Summary Aggregates ===`);
      console.log(`Tag Aggregate potential:  ${(full.summary.damagePotential / 1000000).toFixed(2)}M`);
      console.log(`Live Aggregate potential: ${(liveSummary.live / 1000000).toFixed(2)}M`);
      console.log(`Observed Daily average:  ${(liveSummary.observed / 1000000).toFixed(2)}M`);

      return {
        tagSummary: full.summary,
        liveSummary,
        tableRows
      };
    } catch (err) {
      console.error('[PROST:troopRadar] damage breakdown failed:', err);
      return { error: err.message };
    }
  }

  function renderTroopRadarHeaderSummary(summary, muId, members) {
    if (!summary || typeof document === 'undefined') return;
    troopRadarLastSummary = summary;
    if (Array.isArray(members)) {
      troopRadarLastMembers = members;
    }

    const anchor = findTroopRadarHeaderAnchor();
    if (!anchor) return;

    let el = document.getElementById('wia-troop-radar-summary');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wia-troop-radar-summary';
      el.className = 'wia-troop-radar-container';
      anchor.parentNode.insertBefore(el, anchor);
    }
    el.setAttribute('data-wia-mu', muId);

    const actionableCount = summary.actionableWarskillers ? summary.actionableWarskillers.length : 0;

    const mode = troopRadarDamageMode;
    const isTag = mode === 'tag';
    const alertBg = isTag ? 'rgba(234, 179, 8, 0.12)' : 'rgba(79, 209, 224, 0.10)';
    const alertBorder = isTag ? '1px solid rgba(234, 179, 8, 0.3)' : '1px solid rgba(79, 209, 224, 0.28)';
    const alertColor = isTag ? '#fef08a' : '#a8ecf4';

    let alertHtml = '';
    if (actionableCount > 0) {
      const formattedLinks = summary.actionableWarskillers.slice(0, 3).map((u) => {
        const name = u.username || u.name || u.userId;
        return `<a href="/user/${u.userId}" style="color: inherit; text-decoration: underline; font-weight: 600;">${name}</a>`;
      }).join(', ');
      const moreStr = actionableCount > 3 ? ` (+${actionableCount - 3} weitere)` : '';
      alertHtml = `
        <div style="background: ${alertBg}; border: ${alertBorder}; color: ${alertColor}; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-top: 10px; display: flex; align-items: center; gap: 8px;">
          <span>⚠️ <strong>${actionableCount} Warskiller ungepillt</strong> — ${formattedLinks}${moreStr} (Leben & Hunger voll)</span>
        </div>`;
    }

    const chipIcon = isTag ? '⚡' : '🔴';
    const chipText = isTag ? t('troopRadarModeTag') : t('troopRadarModeLive');
    const labelText = t('troopRadarDamagePotential');

    let displayNum = '';
    let sublabelText = '';

    const horizonHour = getLiveHorizonHour();

    if (isTag) {
      displayNum = fmtDamage(summary.damagePotential);
      if (summary.damageComputedCount < summary.damageTotalCount) {
        sublabelText = t('troopRadarDmgComputed', { done: summary.damageComputedCount, total: summary.damageTotalCount });
      } else {
        sublabelText = 'Blau · Pille';
      }
    } else {
      const liveRes = sumLiveDamage(troopRadarLastMembers, new Date(), horizonHour);
      displayNum = fmtDamage(liveRes.live);
      sublabelText = t('troopRadarLiveUntil', { time: String(horizonHour).padStart(2, '0') + ':00' }) + ' · ' + t('troopRadarLiveObserved', { val: fmtDamage(liveRes.observed) });
    }

    el.innerHTML = `
      <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 14px; margin: 10px 0; font-family: system-ui, -apple-system, sans-serif;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <div style="font-weight: 700; color: #f8fafc; font-size: 13px; display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #eab308;"></span>
            <span>Truppen-Radar</span>
          </div>
          <span style="border: 1px solid #7c3aed; color: #a78bfa; padding: 2px 6px; font-size: 10px; font-weight: 700; border-radius: 4px; letter-spacing: 0.5px;">PROST</span>
        </div>
        <div class="wia-tr-grid">
          <div class="wia-tr-tile">
            <div class="num">${summary.readyCount}/${summary.warskillerCount}</div>
            <div class="lab">KAMPFBEREIT</div>
            <div class="sub">${t('troopRadarSubWarskiller')}</div>
          </div>

          <button class="wia-dmg-tile" id="wia-troop-dmg-tile" data-mode="${mode}" aria-label="Schadenspotential — Modus umschalten">
            <span class="wia-edit-badge" id="wia-troop-edit-btn" title="${t('customBaselineTitle')}" aria-label="${t('customBaselineTitle')}">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 2.5 4 5.5l1.8 3L8 7.2V21h8V7.2l2.2 1.3L20 5.5l-4.5-3c-.5 1.3-1.7 2.2-3.5 2.2s-3-.9-3.5-2.2Z"/></svg>
              <span class="pen">✎</span>
            </span>
            <span class="wia-live-horizon-badge" id="wia-troop-live-horizon-btn" title="${t('troopRadarLiveHorizonTitle')}" aria-label="${t('troopRadarLiveHorizonTitle')}">
              <span class="clock">⏰</span>
            </span>
            <span class="chip"><span class="ico">${chipIcon}</span><span class="mname">${chipText}</span><span class="caret">⇄</span></span>
            <span class="num">${displayNum}</span>
            <span class="lab">${labelText}</span>
            <span class="sublab">${sublabelText}</span>
          </button>

          <div class="wia-tr-tile">
            <div class="num">${summary.pillCount}/${summary.totalMembers}</div>
            <div class="lab">GEPILLT</div>
            <div class="sub">${t('troopRadarSubActive')}</div>
          </div>
          <div class="wia-tr-tile wia-tr-hh-tile">
            <div class="tr-hh-wide">
              <div class="tr-hh-row">
                <span class="ico">❤</span> <span class="val">${summary.avgHpPct}%</span>
              </div>
              <div class="tr-hh-row">
                <span class="ico">🍖</span> <span class="val">${summary.avgHungerPct}%</span>
              </div>
            </div>
            <div class="tr-hh-narrow">
              <span class="val">${summary.avgEffPoolPct}%</span>
            </div>
            <div class="tr-hh-lbl-wide lab">Ø HP / Hunger</div>
            <div class="tr-hh-lbl-narrow lab">${t('troopRadarHpHunger')}</div>
            <div class="sub">${t('troopRadarSubActive')}</div>
          </div>
        </div>
        ${alertHtml}
      </div>`;

    const tile = pick('troopRadar', '#wia-troop-dmg-tile', el)[0];
    if (tile) {
      tile.addEventListener('click', () => {
        guard('troopRadar', () => {
          troopRadarDamageMode = troopRadarDamageMode === 'tag' ? 'live' : 'tag';
          renderTroopRadarHeaderSummary(troopRadarLastSummary, muId, troopRadarLastMembers);
          renderTroopRadarMemberRows(troopRadarLastMembers);
        });
      });
      const editBtn = pick('troopRadar', '#wia-troop-edit-btn', tile)[0];
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          guard('troopRadar', () => openBaselineMask(muId));
        });
      }
      const liveBtn = pick('troopRadar', '#wia-troop-live-horizon-btn', tile)[0];
      if (liveBtn) {
        liveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          guard('troopRadar', () => openLiveHorizonMask(muId));
        });
      }
    }
  }

  function showBaselineToast(msg, kind) {
    let toast = document.getElementById('wia-custom-baseline-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'wia-custom-baseline-toast';
      toast.className = 'wia-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'wia-toast wia-show ' + (kind === 'ok' ? 'wia-ok' : 'wia-warn');
    if (toast.tHide) clearTimeout(toast.tHide);
    toast.tHide = setTimeout(() => {
      toast.className = 'wia-toast';
    }, 2600);
  }

  function openBaselineMask(muId) {
    let ov = document.getElementById('wia-custom-baseline-mask-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wia-custom-baseline-mask-ov';
      ov.className = 'wia-mask-ov';
      document.body.appendChild(ov);
    }

    ov.innerHTML = `
      <div class="wia-mask" role="dialog" aria-label="Baseline-Set bearbeiten">
        <h3>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="#f0a54a" aria-hidden="true"><path d="M8.5 2.5 4 5.5l1.8 3L8 7.2V21h8V7.2l2.2 1.3L20 5.5l-4.5-3c-.5 1.3-1.7 2.2-3.5 2.2s-3-.9-3.5-2.2Z"/></svg>
          ${t('customBaselineTitle')}
        </h3>
        <p class="wia-mhint">${t('customBaselineHint')}</p>
        <textarea id="wia-custom-baseline-ta" spellcheck="false"></textarea>
        <details class="wia-cheat">
          <summary>${t('customBaselineCheatTitle')}</summary>
          <div class="wia-cheat-body">
            <table>
              <thead>
                <tr><th>Slot (Einheit)</th><th>T1</th><th>T2</th><th class="wia-t3">T3 Blau</th><th>T4</th><th>T5</th><th>T6</th></tr>
              </thead>
              <tbody>
                <tr><td>weapon.dmg (Pkt)</td><td>21-40</td><td>51-60</td><td class="wia-t3">71-90</td><td>101-130</td><td>141-170</td><td>221-300</td></tr>
                <tr><td>weapon.crit (%)</td><td>1-5</td><td>6-10</td><td class="wia-t3">11-15</td><td>16-20</td><td>26-35</td><td>41-50</td></tr>
                <tr><td>gloves.precision (Pkt)</td><td>1-5</td><td>6-10</td><td class="wia-t3">11-15</td><td>21-25</td><td>31-40</td><td>51-60</td></tr>
                <tr><td>helmet.critDmg (%)</td><td>1-15</td><td>16-30</td><td class="wia-t3">31-50</td><td>71-90</td><td>91-110</td><td>121-150</td></tr>
                <tr><td>chest.armor (Pkt)</td><td>1-5</td><td>6-10</td><td class="wia-t3">11-15</td><td>21-30</td><td>35-50</td><td>56-70</td></tr>
                <tr><td>pants.armor (Pkt)</td><td>1-5</td><td>6-10</td><td class="wia-t3">11-15</td><td>21-30</td><td>35-50</td><td>56-70</td></tr>
                <tr><td>boots.dodge (Pkt)</td><td>1-5</td><td>6-10</td><td class="wia-t3">11-15</td><td>21-25</td><td>31-40</td><td>51-60</td></tr>
              </tbody>
            </table>
          </div>
        </details>
        <div class="wia-mask-actions">
          <button class="wia-btn wia-btn-reset" id="wia-custom-baseline-reset">${t('customBaselineBtnReset')}</button>
          <span class="wia-spacer"></span>
          <button class="wia-btn wia-btn-ghost" id="wia-custom-baseline-cancel">${t('customBaselineBtnCancel')}</button>
          <button class="wia-btn wia-btn-save" id="wia-custom-baseline-save">${t('customBaselineBtnSave')}</button>
        </div>
      </div>
    `;

    const ta = ov.querySelector('#wia-custom-baseline-ta');
    ta.value = JSON.stringify(activeBaselineSet, null, 2);
    ta.classList.remove('wia-err');

    const closeMask = () => {
      ov.classList.remove('wia-open');
    };

    ov.classList.add('wia-open');
    ta.focus();

    // Event listeners
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeMask();
    });

    const escHandler = (e) => {
      if (e.key === 'Escape' && ov.classList.contains('wia-open')) {
        closeMask();
      }
    };
    document.addEventListener('keydown', escHandler);

    ov.querySelector('#wia-custom-baseline-cancel').addEventListener('click', closeMask);

    ov.querySelector('#wia-custom-baseline-reset').addEventListener('click', () => {
      activeBaselineSet = JSON.parse(JSON.stringify(CONFIG.CUSTOM_SET));
      GM_setValue(KEYS.customBaselineSet, '');
      ta.value = JSON.stringify(activeBaselineSet, null, 2);
      ta.classList.remove('wia-err');
      if (troopRadarLastSummary) {
        const membersData = troopRadarLastMembers;
        const processed = membersData.map((m) => {
          const tagRes = computeDamagePotential(m, { equip: 'blue' });
          const realRes = computeDamagePotential(m, { equip: 'realFloored' });
          return {
            ...m,
            tagDmg: tagRes.dailyDmg,
            realDmg: realRes.dailyDmg,
            degraded: tagRes.degraded
          };
        });
        const summary = summarizeTroops(processed);
        troopRadarLastSummary = summary;
        renderTroopRadarHeaderSummary(summary, muId, membersData);
      }
      showBaselineToast(t('customBaselineToastReset'), 'ok');
    });

    ov.querySelector('#wia-custom-baseline-save').addEventListener('click', () => {
      let parsed;
      try {
        parsed = JSON.parse(ta.value);
      } catch (e) {
        parsed = null;
      }

      if (parsed && isValidBaselineShape(parsed)) {
        activeBaselineSet = parsed;
        GM_setValue(KEYS.customBaselineSet, JSON.stringify(parsed));
        closeMask();
        if (troopRadarLastSummary) {
          const membersData = troopRadarLastMembers;
          const processed = membersData.map((m) => {
            const tagRes = computeDamagePotential(m, { equip: 'blue' });
            const realRes = computeDamagePotential(m, { equip: 'realFloored' });
            return {
              ...m,
              tagDmg: tagRes.dailyDmg,
              realDmg: realRes.dailyDmg,
              degraded: tagRes.degraded
            };
          });
          const summary = summarizeTroops(processed);
          troopRadarLastSummary = summary;
          renderTroopRadarHeaderSummary(summary, muId, membersData);
        }
        showBaselineToast(t('customBaselineToastSaved'), 'ok');
      } else {
        activeBaselineSet = JSON.parse(JSON.stringify(CONFIG.CUSTOM_SET));
        GM_setValue(KEYS.customBaselineSet, '');
        ta.value = JSON.stringify(activeBaselineSet, null, 2);
        ta.classList.add('wia-err');
        if (troopRadarLastSummary) {
          const membersData = troopRadarLastMembers;
          const processed = membersData.map((m) => {
            const tagRes = computeDamagePotential(m, { equip: 'blue' });
            const realRes = computeDamagePotential(m, { equip: 'realFloored' });
            return {
              ...m,
              tagDmg: tagRes.dailyDmg,
              realDmg: realRes.dailyDmg,
              degraded: tagRes.degraded
            };
          });
          const summary = summarizeTroops(processed);
          troopRadarLastSummary = summary;
          renderTroopRadarHeaderSummary(summary, muId, membersData);
        }
        showBaselineToast(t('customBaselineToastInvalid'), 'warn');
      }
    });
  }

  function openLiveHorizonMask(muId) {
    let ov = document.getElementById('wia-live-horizon-mask-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wia-live-horizon-mask-ov';
      ov.className = 'wia-mask-ov';
      document.body.appendChild(ov);
    }

    const currentHorizon = getLiveHorizonHour();
    let optionsHtml = '';
    for (let h = 0; h < 24; h++) {
      const selected = h === currentHorizon ? 'selected' : '';
      const displayHour = String(h).padStart(2, '0') + ':00';
      optionsHtml += `<option value="${h}" ${selected}>${displayHour}</option>`;
    }

    ov.innerHTML = `
      <div class="wia-mask" role="dialog" aria-label="Live-Horizont bearbeiten" style="width: 320px;">
        <h3 style="display: flex; align-items: center; gap: 6px; margin: 0 0 10px;">
          ⏰ ${t('troopRadarLiveHorizonTitle')}
        </h3>
        <p class="wia-mhint" style="font-size: 11px; color: #8b949e; margin: 0 0 12px;">${t('troopRadarLiveHorizonHint')}</p>
        <div style="margin: 15px 0; display: flex; justify-content: center;">
          <select id="wia-live-horizon-select" style="background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 6px 12px; color: #f8fafc; font-size: 14px; font-weight: 600; width: 100%; box-sizing: border-box;">
            ${optionsHtml}
          </select>
        </div>
        <div class="wia-mask-actions" style="display: flex; gap: 8px; margin-top: 15px;">
          <button class="wia-btn wia-btn-reset" id="wia-live-horizon-reset" style="background: #21262d; border: 1px solid #30363d; border-radius: 6px; padding: 6px 12px; color: #c9d1d9; font-size: 12px; cursor: pointer;">${t('customBaselineBtnReset')}</button>
          <span class="wia-spacer" style="flex-grow: 1;"></span>
          <button class="wia-btn wia-btn-ghost" id="wia-live-horizon-cancel" style="background: transparent; border: 0; color: #8b949e; font-size: 12px; cursor: pointer;">${t('customBaselineBtnCancel')}</button>
          <button class="wia-btn wia-btn-save" id="wia-live-horizon-save" style="background: #238636; border: 1px solid #30363d; border-radius: 6px; padding: 6px 12px; color: #ffffff; font-size: 12px; cursor: pointer; font-weight: 600;">${t('customBaselineBtnSave')}</button>
        </div>
      </div>
    `;

    function closeMask() {
      ov.classList.remove('wia-open');
      document.removeEventListener('keydown', escHandler);
    }

    function escHandler(e) {
      if (e.key === 'Escape' && ov.classList.contains('wia-open')) {
        closeMask();
      }
    }

    ov.classList.add('wia-open');

    // Event listeners
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeMask();
    });

    document.addEventListener('keydown', escHandler);

    const cancelBtn = pick('troopRadar', '#wia-live-horizon-cancel', ov)[0];
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeMask);
    }

    const reRenderAll = () => {
      if (troopRadarLastSummary && troopRadarLastMembers) {
        renderTroopRadarHeaderSummary(troopRadarLastSummary, muId, troopRadarLastMembers);
        renderTroopRadarMemberRows(troopRadarLastMembers);
      }
    };

    const resetBtn = pick('troopRadar', '#wia-live-horizon-reset', ov)[0];
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        guard('troopRadar', () => {
          GM_setValue(KEYS.troopRadarLiveHorizonHour, CONFIG.DAILY_RESET_HOUR ?? 2);
          closeMask();
          reRenderAll();
          showBaselineToast(t('customBaselineToastReset'), 'ok');
        });
      });
    }

    const saveBtn = pick('troopRadar', '#wia-live-horizon-save', ov)[0];
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        guard('troopRadar', () => {
          const select = pick('troopRadar', '#wia-live-horizon-select', ov)[0];
          if (select) {
            const val = parseInt(select.value, 10);
            if (!isNaN(val) && val >= 0 && val <= 23) {
              GM_setValue(KEYS.troopRadarLiveHorizonHour, val);
              closeMask();
              reRenderAll();
              showBaselineToast(t('customBaselineToastSaved'), 'ok');
            } else {
              closeMask();
            }
          } else {
            closeMask();
          }
        });
      });
    }
  }

  function formatTroopRadarTime(isoString) {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    } catch (e) {
      return '';
    }
  }

  function renderTroopRadarMemberRows(membersData) {
    if (typeof document === 'undefined') return;
    const mainWin = document.getElementById('main-window');
    if (!mainWin) return;

    const dataMap = new Map();
    if (Array.isArray(membersData)) {
      for (const m of membersData) {
        if (m && m.userId) dataMap.set(m.userId, m);
      }
    }

    const now = new Date();
    const horizon = getLiveHorizonHour();
    const mode = troopRadarDamageMode;

    const allRows = mainWin.querySelectorAll('div._1dnmndynm, li._1txpadm0');
    for (const row of allRows) {
      const spans = Array.from(row.querySelectorAll('span'));
      const rankSpan = spans.find((s) => /^#\d+/.test((s.textContent || '').trim()));
      if (!rankSpan) continue;

      const hasStats = row.querySelector('._1dnmndy1x1') !== null;
      if (!hasStats) continue;

      // A1 Fix: Establish container-type context programmatically on the native row
      row.style.containerType = 'inline-size';

      const userLink = Array.from(row.querySelectorAll('a[href*="/user/"]')).find((a) => {
        const href = a.getAttribute('href') || '';
        return /^\/user\/[a-f0-9]+(?:\/)?$/i.test(href);
      });
      if (!userLink) continue;

      const href = userLink.getAttribute('href') || '';
      const match = href.match(/\/user\/([a-f0-9]+)/i);
      if (!match) continue;
      const userId = match[1];

      const linkText = userLink.textContent.trim();
      const memberData = dataMap.get(userId) || createOptimisticMemberData(userId);
      if (linkText && !memberData.username) {
        memberData.username = linkText;
      }

      const parent = userLink.parentElement;
      if (!parent) continue;

      let chipContainer = parent.querySelector(`.wia-troop-chips[data-wia-user="${userId}"]`);
      if (memberData.isActive === false) {
        if (chipContainer) chipContainer.remove();
        continue;
      }

      if (!chipContainer) {
        chipContainer = document.createElement('div');
        chipContainer.className = 'wia-troop-chips';
        chipContainer.setAttribute('data-wia-user', userId);
        parent.appendChild(chipContainer);
      }

      let buildBadge = '';
      if (memberData.build === 'war') {
        const pct = Math.round((memberData.warShare || 0) * 100);
        buildBadge = `<span class="wia-troop-chip build-war"><span>💥 WAR</span><span class="build-pct"> (${pct}%)</span></span>`;
      } else if (memberData.build === 'hybrid') {
        const pct = Math.round((memberData.warShare || 0) * 100);
        buildBadge = `<span class="wia-troop-chip build-hybrid"><span>⚖ Hybrid</span><span class="build-pct"> (${pct}%)</span></span>`;
      } else {
        buildBadge = `<span class="wia-troop-chip build-eco">💰 Eco</span>`;
      }

      const hpPct = memberData.hpMax > 0 ? Math.round((memberData.hpCurrent / memberData.hpMax) * 100) : 100;
      const hpColor = barColor(hpPct);
      const hpBadge = `
        <span class="wia-troop-chip hp-badge">
          <span class="hp-heart">❤</span>
          <span class="hp-track">
            <span class="hp-fill" style="width: ${hpPct}%; background: ${hpColor};"></span>
          </span>
          <span class="hp-val">${Math.round(memberData.hpCurrent)}/${memberData.hpMax}</span>
        </span>`;

      const hungerPct = memberData.hungerMax > 0 ? Math.round((memberData.hungerCurrent / memberData.hungerMax) * 100) : 100;
      const hungerColor = barColor(hungerPct);
      const hungerBadge = `
        <span class="wia-troop-chip hunger-badge">
          <span class="hunger-steak">🍖</span>
          <span class="hunger-track">
            <span class="hunger-fill" style="width: ${hungerPct}%; background: ${hungerColor};"></span>
          </span>
          <span class="hunger-val">${Math.round(memberData.hungerCurrent)}/${memberData.hungerMax}</span>
        </span>`;

      const effPct = memberEffPoolPct(memberData);
      const effColor = barColor(effPct);
      const lhBadge = `
        <span class="wia-troop-chip lh-badge">
          <span class="lh-lbl">L/H</span>
          <span class="lh-track">
            <span class="lh-fill" style="width: ${Math.round(effPct)}%; background: ${effColor};"></span>
          </span>
          <span class="lh-val">${Math.round(effPct)}%</span>
        </span>`;

      let pillBadge = '';
      if (memberData.pillState === 'pill-on') {
        const timeStr = formatTroopRadarTime(memberData.buffEndAt);
        const labelLong = t('troopRadarPillOn') + (timeStr ? `: ${timeStr}` : '');
        const labelShort = timeStr || '';
        pillBadge = `
          <span class="wia-troop-chip pill-on">
            <span class="pill-txt-long">💊 ${labelLong}</span>
            <span class="pill-txt-short">💊 ${labelShort}</span>
          </span>`;
      } else if (memberData.debuffsPercent > 0) {
        const timeStr = formatTroopRadarTime(memberData.debuffEndAt);
        const labelLong = t('troopRadarPillCd') + (timeStr ? ` ab: ${timeStr}` : '');
        const labelShort = timeStr || t('troopRadarPillCdShort');
        pillBadge = `
          <span class="wia-troop-chip pill-debuff">
            <span class="pill-txt-long">💊 ${labelLong}</span>
            <span class="pill-txt-short">💊 ${labelShort}</span>
          </span>`;
      } else if (memberData.pillReady) {
        pillBadge = `
          <span class="wia-troop-chip pill-ready">
            <span class="pill-txt-long">💊 ${t('troopRadarPillOff')} · ${t('troopRadarPillReadyShort')}</span>
            <span class="pill-txt-short">💊 ${t('troopRadarPillReadyShort')}</span>
          </span>`;
      } else {
        pillBadge = `
          <span class="wia-troop-chip pill-off">
            <span class="pill-txt-long">💊 ${t('troopRadarPillOff')}</span>
            <span class="pill-txt-short">💊 ${t('troopRadarPillOffShort')}</span>
          </span>`;
      }

      let dmgBadge = '';
      if (memberData.isActive !== false) {
        const { dmgVal, degraded } = computeMemberDamage(memberData, mode, now, horizon);
        const dmgText = degraded ? '—' : fmtDamage(dmgVal);
        const chipClass = degraded ? 'dmg-degraded' : (mode === 'tag' ? 'dmg-tag' : 'dmg-live');
        dmgBadge = `<span class="wia-troop-chip dmg-chip ${chipClass}">💥 ${dmgText}</span>`;
      }

      chipContainer.innerHTML = `${buildBadge}${hpBadge}${hungerBadge}${lhBadge}${pillBadge}${dmgBadge}`;
    }
  }

  function cleanupStrayTroopRadarChips() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.wia-troop-chips').forEach((el) => {
      const mainWin = document.getElementById('main-window');
      if (!mainWin || !mainWin.contains(el)) {
        el.remove();
        return;
      }
      const row = el.closest('div._1dnmndynm, li._1txpadm0, li');
      if (!row) {
        el.remove();
        return;
      }
      const hasRank = Array.from(row.querySelectorAll('span')).some((s) => /^#\d+/.test((s.textContent || '').trim()));
      const hasStats = row.querySelector('._1dnmndy1x1') !== null;
      if (!hasRank || !hasStats) {
        el.remove();
      }
    });
  }

  let troopRadarActiveRequestId = 0;
  let troopRadarActiveMuId = null;

  async function applyTroopRadar() {
    cleanupStrayTroopRadarChips();

    if (!CONFIG.featTroopRadar) {
      setHealth('troopRadar', 'idle', 'disabled in settings');
      const existingSummary = document.getElementById('wia-troop-radar-summary');
      if (existingSummary) existingSummary.remove();
      troopRadarActiveMuId = null;
      return;
    }

    const route = getEntityFromRoute();
    if (!route || route.type !== 'mu' || !route.rawId) {
      setHealth('troopRadar', 'idle', 'not on MU page');
      const existingSummary = document.getElementById('wia-troop-radar-summary');
      if (existingSummary) existingSummary.remove();
      troopRadarActiveMuId = null;
      return;
    }

    const muId = route.rawId;
    if (troopRadarLoading && troopRadarActiveMuId === muId) return;

    troopRadarLoading = true;
    troopRadarActiveMuId = muId;
    const reqId = ++troopRadarActiveRequestId;

    const evaluateHealth = (summary, membersData) => {
      if (!summary || !Array.isArray(membersData)) {
        return { status: 'warn', reason: 'no data' };
      }

      if (summary.avgHungerPct === undefined || isNaN(summary.avgHungerPct) ||
          summary.avgEffPoolPct === undefined || isNaN(summary.avgEffPoolPct)) {
        return { status: 'warn', reason: 'avgHungerPct/avgEffPoolPct not calculable' };
      }

      const activeMembers = membersData.filter(m => m && m.isActive !== false);
      if (activeMembers.length > 0) {
        const now = new Date();
        const horizon = getLiveHorizonHour();
        const mode = troopRadarDamageMode;
        let degradedCount = 0;
        activeMembers.forEach(m => {
          const { degraded } = computeMemberDamage(m, mode, now, horizon);
          if (degraded) degradedCount++;
        });

        if ((degradedCount / activeMembers.length) > 0.5) {
          return {
            status: 'warn',
            reason: `degraded damage for >50% active members (${degradedCount}/${activeMembers.length})`
          };
        }
      }

      return { status: 'ok', reason: `${activeMembers.length} members rendered` };
    };

    try {
      const fullData = await fetchFullTroopRadar(muId);
      if (reqId !== troopRadarActiveRequestId) {
        return;
      }

      renderTroopRadarHeaderSummary(fullData.summary, muId, fullData.membersData);
      renderTroopRadarMemberRows(fullData.membersData);

      const health = evaluateHealth(fullData.summary, fullData.membersData);
      setHealth('troopRadar', health.status, health.reason);

      fullData.detailsPromise.then((liveFull) => {
        if (reqId !== troopRadarActiveRequestId) return;
        renderTroopRadarHeaderSummary(liveFull.summary, muId, liveFull.membersData);
        renderTroopRadarMemberRows(liveFull.membersData);

        const health = evaluateHealth(liveFull.summary, liveFull.membersData);
        setHealth('troopRadar', health.status, health.reason);
        troopRadarLoading = false;
      }).catch((e) => {
        dbg('troopRadar', 'warn', 'detailsPromise error: ' + e.message);
        if (reqId === troopRadarActiveRequestId) {
          troopRadarLoading = false;
        }
      });

    } catch (e) {
      dbg('troopRadar', 'error', 'applyTroopRadar failed: ' + e.message);
      setHealth('troopRadar', 'fail', e.message);
      if (reqId === troopRadarActiveRequestId) {
        troopRadarLoading = false;
      }
    }
  }

  // ── User-Profile Charakterbogen-Strip (#63) ─────────────────────────────────
  let profileCharsheetLoading = false;
  let profileCharsheetActiveUserId = null;
  let profileCharsheetReqId = 0;

  function profileClassMeta(build, archetype) {
    if (build === 'war')    return { titleKey: archetype || 'profileClassWar',    color: '#e05a45' };
    if (build === 'hybrid') return { titleKey: archetype || 'profileClassHybrid', color: '#8a6fc0' };
    return { titleKey: archetype || 'profileClassWorker', color: '#b8912b' };
  }

  // Anchor: the "Ausrüstung"/"Equipment" section is the first card in the profile
  // content column. Insert our strip in-flow before it (pushes everything down —
  // never an overlay). Text-based so it survives the hashed atomic class churn.
  function findProfileCharsheetAnchor() {
    if (typeof document === 'undefined') return null;
    const win = document.getElementById('main-window') || document.body;
    if (!win) return null;
    const eq = Array.from(win.querySelectorAll('span'))
      .find((s) => /^(Ausrüstung|Equipment)$/.test((s.textContent || '').trim()));
    if (!eq) return null;
    let section = eq;
    let depth = 0;
    while (section.parentElement && depth < 25 &&
           !/Ranglisten|Rankings|Reichtum|Wealth/i.test(section.parentElement.textContent || '')) {
      section = section.parentElement;
      depth++;
    }
    const column = section.parentElement;
    if (!column) return null;
    return { column, before: section };
  }

  function removeProfileCharsheet() {
    if (typeof document !== 'undefined') {
      const el = document.getElementById('wia-profile-charsheet');
      if (el) el.remove();
    }
    profileCharsheetActiveUserId = null;
  }

  function renderProfileCharsheet(member) {
    if (typeof document === 'undefined' || !member) return;
    const anchor = findProfileCharsheetAnchor();
    if (!anchor) return;
    let el = document.getElementById('wia-profile-charsheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wia-profile-charsheet';
      el.className = 'wia-charsheet';
      anchor.column.insertBefore(el, anchor.before);
    }
    const build = member.build || 'eco';
    const archetype = member.archetype || null;
    const meta = profileClassMeta(build, archetype);
    el.style.setProperty('--cls', meta.color);
    const share = build === 'eco' ? (member.ecoShare || 0) : (member.warShare || 0);
    const pct = Math.round((Number.isFinite(share) ? share : 0) * 100);
    const buildLabel = build === 'eco' ? t('troopRadarEco') : (build === 'hybrid' ? t('troopRadarHybrid') : t('troopRadarWar'));
    const hpMax = member.hpMax > 0 ? member.hpMax : 0;
    const huMax = member.hungerMax > 0 ? member.hungerMax : 0;
    const hpCur = Number.isFinite(member.hpCurrent) ? member.hpCurrent : 0;
    const huCur = Number.isFinite(member.hungerCurrent) ? member.hungerCurrent : 0;
    const hpPct = hpMax > 0 ? Math.max(0, Math.min(100, hpCur / hpMax * 100)) : 0;
    const huPct = huMax > 0 ? Math.max(0, Math.min(100, huCur / huMax * 100)) : 0;
    const nfmt = (v) => { const r = Math.round((Number.isFinite(v) ? v : 0) * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
    el.innerHTML = `
      <span class="wia-cs-badge">PROST</span>
      <div class="wia-cs-title">
        <span class="wia-cs-rune">✦</span>
        <span class="wia-cs-word">${member.supporterAdjectiveIndex >= 0 ? t('supporterAdj' + member.supporterAdjectiveIndex) + ' ' : ''}${t(meta.titleKey)}${member.supporterAdjectiveIndex >= 0 ? '<img src="data:image/png;base64,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" style="height:1.1em;vertical-align:-10%;margin-left:6px;filter:drop-shadow(0 0 2px rgba(236,72,153,0.8));" title="PROST Supporter" alt="💖">' : ''}</span>
        <span class="wia-cs-rune">✦</span>
    <span class="wia-cs-share">${buildLabel} · ${pct}%</span>
      </div>
      <div class="wia-cs-bars">
        <div class="wia-cs-bar hp">
          <span class="ico">❤</span>
          <span class="track"><span class="fill" style="width:${hpPct}%"></span>
            <span class="lbl">${t('profileHp')}</span><span class="val">${nfmt(hpCur)} / ${nfmt(hpMax)} HP</span></span>
        </div>
        <div class="wia-cs-bar hu">
          <span class="ico">🍖</span>
          <span class="track"><span class="fill" style="width:${huPct}%"></span>
            <span class="lbl">${t('profileHunger')}</span><span class="val">${nfmt(huCur)} / ${nfmt(huMax)}</span></span>
        </div>
      </div>`;
  }

  async function applyProfileCharsheet() {
    if (!CONFIG.featProfileCharsheet) {
      removeProfileCharsheet();
      setHealth('profileCharsheet', 'idle', 'disabled in settings');
      return;
    }
    const route = getEntityFromRoute();
    if (!route || route.type !== 'user' || !route.rawId || !isUserProfilePage()) {
      removeProfileCharsheet();
      setHealth('profileCharsheet', 'idle', 'not on profile page');
      return;
    }
    const userId = route.rawId;
    if (profileCharsheetLoading && profileCharsheetActiveUserId === userId && document.getElementById('wia-profile-charsheet')) return;
    profileCharsheetActiveUserId = userId;
    profileCharsheetLoading = true;
    const reqId = ++profileCharsheetReqId;
    try {
      const member = await fetchTroopMemberData(userId);
      if (reqId !== profileCharsheetReqId) return;
      renderProfileCharsheet(member);
      setHealth('profileCharsheet', 'ok', member && member.isOptimistic ? 'optimistic' : 'rendered');
    } catch (e) {
      dbg('profileCharsheet', 'error', 'applyProfileCharsheet failed: ' + e.message);
      setHealth('profileCharsheet', 'fail', e.message);
    } finally {
      if (reqId === profileCharsheetReqId) profileCharsheetLoading = false;
    }
  }

  function ensureProfileCharsheetInjected() {
    if (!CONFIG.featProfileCharsheet || typeof document === 'undefined') return;
    if (!isUserProfilePage()) return;
    const route = getEntityFromRoute();
    if (!route || route.type !== 'user') return;
    if (document.getElementById('wia-profile-charsheet')) return;
    if (!findProfileCharsheetAnchor()) return;
    const cached = troopRadarMemberCache.get(route.rawId);
    if (cached && cached.data) renderProfileCharsheet(cached.data);
    else applyProfileCharsheet();
  }

  function ensureTroopRadarInjected() {
    if (!CONFIG.featTroopRadar || !isMuPage() || typeof document === 'undefined') return;
    const route = getEntityFromRoute();
    const routeMuId = route?.rawId;
    if (troopRadarLoading && troopRadarActiveMuId === routeMuId) return;

    const anchor = findTroopRadarHeaderAnchor();
    if (!anchor) return;

    const summaryExists = document.getElementById('wia-troop-radar-summary') !== null;
    const mainWin = document.getElementById('main-window') || document.body;
    const allRows = mainWin.querySelectorAll('div._1dnmndynm, li._1txpadm0');

    let missingChips = false;
    let hasValidRows = false;

    for (const row of allRows) {
      const spans = Array.from(row.querySelectorAll('span'));
      const hasRank = spans.some((s) => /^#\d+/.test((s.textContent || '').trim()));
      const hasStats = row.querySelector('._1dnmndy1x1') !== null;
      if (!hasRank || !hasStats) continue;

      const userLink = Array.from(row.querySelectorAll('a[href*="/user/"]')).find((a) => {
        const href = a.getAttribute('href') || '';
        return /^\/user\/[a-f0-9]+(?:\/)?$/i.test(href);
      });
      if (!userLink) continue;

      hasValidRows = true;

      const parent = userLink.parentElement;
      if (parent && !parent.querySelector('.wia-troop-chips')) {
        const href = userLink.getAttribute('href') || '';
        const match = href.match(/\/user\/([a-f0-9]+)/i);
        if (match) {
          const userId = match[1];
          const cached = troopRadarMemberCache.get(userId);
          if (cached && cached.data && cached.data.isActive === false) {
            continue;
          }
        }
        missingChips = true;
        break;
      }
    }

    if (!summaryExists || (hasValidRows && missingChips)) {
      guard('troopRadar', applyTroopRadar);
    }
  }

  if (CONFIG.debug || typeof process !== 'undefined') {
    globalThis.classifyWarskiller = classifyWarskiller;
    globalThis.baselineContribs = baselineContribs;
    globalThis.isValidBaselineShape = isValidBaselineShape;
    globalThis.loadBaselineSet = loadBaselineSet;
    globalThis.getActiveBaselineSet = getActiveBaselineSet;
    globalThis.setActiveBaselineSet = setActiveBaselineSet;
    globalThis.evaluatePillStatus = evaluatePillStatus;
    globalThis.createOptimisticMemberData = createOptimisticMemberData;
    globalThis.computeDamagePotential = computeDamagePotential;
    globalThis.hoursUntilDailyReset = hoursUntilDailyReset;
    globalThis.computeLiveDamagePotential = computeLiveDamagePotential;
    globalThis.sumLiveDamage = sumLiveDamage;
    globalThis.summarizeTroops = summarizeTroops;
    globalThis.fetchMuRoster = fetchMuRoster;
    globalThis.fetchTroopMemberData = fetchTroopMemberData;
    globalThis.fetchTroopMemberDataBatch = fetchTroopMemberDataBatch;
    globalThis.fetchFullTroopRadar = fetchFullTroopRadar;
    globalThis.renderTroopRadarHeaderSummary = renderTroopRadarHeaderSummary;
    globalThis.renderTroopRadarMemberRows = renderTroopRadarMemberRows;
    globalThis.applyTroopRadar = applyTroopRadar;
    globalThis.ensureTroopRadarInjected = ensureTroopRadarInjected;
    globalThis.formatTroopRadarTime = formatTroopRadarTime;
    globalThis.fmtDamage = fmtDamage;
    globalThis.troopRadarMemberCache = troopRadarMemberCache;
    globalThis.troopRadarRosterCache = troopRadarRosterCache;
    globalThis.isUserProfilePage = isUserProfilePage;
    globalThis.profileClassMeta = profileClassMeta;
    globalThis.renderProfileCharsheet = renderProfileCharsheet;
    globalThis.findProfileCharsheetAnchor = findProfileCharsheetAnchor;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Pill Reminder module
  // ───────────────────────────────────────────────────────────────────────────
  let pillInterval = null;
  let pillObserved = false;
  let pillBarObserver = null;
  let pillUpdateTimer = null;
  const PILL_OBS_OPTS = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] };
  let noneReadCount = 0;
  let pillColdStartDone = false;
  // Panel width (px) below which the pill badge floats out of the inline
  // flow. Measured against #layoutUserMenu's own box (ResizeObserver), NOT
  // the viewport — the game panel is user-resizable independent of the window.
  const PILL_FLOAT_BREAKPOINT = 570;
  // Panel width (px) below which the "... frei" labels are hidden to avoid overlap
  const PILL_LABEL_HIDE_BREAKPOINT = 400;
  let pillFloatObserver = null;
  let pillFloatObservedNode = null;
  let pillIsFloating = false;
  let pillResizeRaf = 0;

  function initPillReminder() {
    if (pillInterval) clearInterval(pillInterval);
    pillInterval = setInterval(tickPillReminder, 10000);
    tickPillReminder();

    if (!pillObserved) {
      document.addEventListener('click', handlePillDocumentClick);
      pillObserved = true;
    }
    observePillBars();
    attachPillFloatObserver();
  }

  // Live-update the badge + budget when H&H changes (eat/attack), instead of
  // waiting for the 10s tick or a page change. Watches the top-bar bars; our own
  // writes are excluded by disconnecting around the render (+ takeRecords).
  function observePillBars() {
    const menu = document.getElementById('layoutUserMenu');
    if (!menu) return;
    if (!pillBarObserver) {
      pillBarObserver = new MutationObserver(() => {
        if (pillUpdateTimer) return;
        pillUpdateTimer = setTimeout(() => {
          pillUpdateTimer = null;
          if (!CONFIG.featPillReminder) return;
          pillBarObserver.disconnect();
          try {
            injectPillBadge();
            renderHnHBudget();
          } finally {
            pillBarObserver.takeRecords();
            const m = document.getElementById('layoutUserMenu');
            if (m) pillBarObserver.observe(m, PILL_OBS_OPTS);
          }
        }, 250);
      });
    }
    pillBarObserver.observe(menu, PILL_OBS_OPTS);
  }

  function teardownPillReminder() {
    if (pillInterval) {
      clearInterval(pillInterval);
      pillInterval = null;
    }
    document.removeEventListener('click', handlePillDocumentClick);
    pillObserved = false;
    if (pillBarObserver) { pillBarObserver.disconnect(); }
    detachPillFloatObserver();
    if (pillUpdateTimer) { clearTimeout(pillUpdateTimer); pillUpdateTimer = null; }
    noneReadCount = 0;
    pillColdStartDone = false;
    removePillBadge();
    removeCocaineHighlights();
    setHealth('pillReminder', 'idle', 'disabled in settings');
    removeHnHBudget();
  }

  function handlePillDocumentClick() {
    setTimeout(highlightCocaineItems, 50);
  }

  function tickPillReminder() {
    if (!CONFIG.featPillReminder) return;
    updatePillState();
    injectPillBadge();
    highlightCocaineItems();
    renderHnHBudget();
    checkPersonalNotifications();
    if (CONFIG.featMuHealDim) {
      guard('muHealDim', applyMuHealDim);
    }
  }

  function getEffectivePersonalTopic() {
    let t = (CONFIG.personalTopic || '').trim();
    if (!t) {
      const uid = getCurrentUserId();
      if (!uid) return '';
      t = `wia-user-${uid}`;
    }
    const s = (CONFIG.personalTopicSecret || '').trim();
    return s ? `${t}-${s}` : t;
  }

  function showLocalPersonalPopup(type, title, body, icon = '🔔', sticky = false) {
    try {
      ensureBountyPopupStyle();
      const doc = document;
      let box = doc.getElementById(POPUP_CONTAINER_ID);
      if (!box) {
        box = doc.createElement('div');
        box.id = POPUP_CONTAINER_ID;
        doc.body.appendChild(box);
      }

      const chip = type.toUpperCase();
      const closeBtn = `<button class="wia-bt-close" aria-label="${bountyEsc(t('bountyPopupClose'))}">×</button>`;
      const compact = (PAGE_WINDOW.innerWidth || 9999) < BOUNTY_POPUP_COMPACT_PX;

      const toast = doc.createElement('div');
      let borderLeftColor = '#3b82f6';
      if (type === 'HnH') borderLeftColor = '#10b981';
      else if (type === 'Window') borderLeftColor = '#fbbf24';
      else if (type === 'Debuff') borderLeftColor = '#8b5cf6';
      else if (type === 'system') borderLeftColor = '#ef4444';

      toast.className = compact ? 'wia-bounty-toast compact' : 'wia-bounty-toast';
      toast.style.borderLeftColor = borderLeftColor;
      toast.setAttribute('role', 'alert');
      toast.tabIndex = 0;

      if (compact) {
        toast.innerHTML = closeBtn +
          `<span class="wia-bt-dot" style="background: ${borderLeftColor}; box-shadow: 0 0 8px ${borderLeftColor};" aria-hidden="true"></span>` +
          `<span class="wia-bt-col">` +
            `<span class="wia-bt-action">${bountyEsc(title)}</span>` +
            `<span class="wia-bt-ctx">${bountyEsc(body)}</span>` +
          `</span>`;
      } else {
        toast.innerHTML = closeBtn +
          `<div class="wia-bt-head"><span class="wia-bt-chip" style="color: ${borderLeftColor}; background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.2);">${bountyEsc(chip)}</span><span class="wia-bt-swords" aria-hidden="true">${icon}</span></div>` +
          `<div class="wia-bt-action">${bountyEsc(title)}</div>` +
          `<div class="wia-bt-ctx" style="margin-top: 6px; line-height: 1.4; color: #e5e7eb;">${bountyEsc(body)}</div>`;
      }

      const dismiss = () => {
        if (toast.parentNode) {
          toast.style.animation = 'none';
          toast.style.transition = 'opacity 0.25s';
          toast.style.opacity = '0';
          setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
        }
      };

      toast.querySelector('.wia-bt-close').onclick = (e) => { e.stopPropagation(); dismiss(); };
      toast.onclick = () => { dismiss(); };

      box.appendChild(toast);
      if (!sticky) {
        setTimeout(dismiss, BOUNTY_POPUP_MS);
      }
      dbg('pillReminder', 'debug', 'local personal popup shown', type);
    } catch (e) {
      dbg('pillReminder', 'error', 'local personal popup failed', e.message);
    }
  }

  async function sendPersonalNtfy(type, title, body, tags, priority = 'default') {
    let icon = '🔔';
    if (tags.includes('poultry_leg')) icon = '🍗';
    else if (tags.includes('alarm_clock')) icon = '⏰';
    else if (tags.includes('sparkles')) icon = '✨';
    else if (tags.includes('pill')) icon = '💊';

    showLocalPersonalPopup(type, title, body, icon);

    (async () => {
      try {
        const N = PAGE_WINDOW.Notification;
        if (N && (await ensureNotifPermission()) === 'granted') {
          new N(title, { body });
        }
      } catch (e) {
        dbg('pillReminder', 'error', 'local browser notification failed', e.message);
      }
    })();

    const topic = getEffectivePersonalTopic();
    if (!topic) return false;

    const safeTitle = cleanHeaderValue(title);
    const headers = {
      Title: safeTitle,
      Priority: priority,
      Tags: `${tags},v${SCRIPT_VERSION},cid_${bountyClientId()}`,
      'Content-Type': 'text/plain; charset=utf-8'
    };

    try {
      const res = await ntfyRequest('pillReminder', {
        method: 'POST',
        url: `${NTFY_BASE}/${topic}`,
        data: body,
        headers
      });
      if (!res) return false;   // 429 / backoff active — logged inside ntfyRequest
      const ok = res.status >= 200 && res.status < 300;
      dbg('pillReminder', ok ? 'debug' : 'error', `ntfy personal send ${type}`, res.status, topic);
      return ok;
    } catch (e) {
      dbg('pillReminder', 'error', `ntfy personal send ${type} failed`, e.message);
      return false;
    }
  }

  function testPersonalPush() {
    return sendPersonalNtfy('Test', 'Test Benachrichtigung', 'Dies ist ein Test der persönlichen PROST Benachrichtigung!', 'pill,sparkles');
  }

  function checkPersonalNotifications() {
    if (!CONFIG.featPillNotifHnH && !CONFIG.featPillNotifWindow && !CONFIG.featPillNotifDebuff) {
      return;
    }

    const nowVal = Date.now();
    const status = parseHealthAndHunger();
    const info = getPillCycleInfo();
    const totalMs = (CONFIG.pillBuffH + CONFIG.pillDebuffH) * 3600000;
    const isDebuffExpired = info.pillTakenAt > 0 ? (nowVal >= info.pillTakenAt + totalMs) : false;
    const inWindow = CONFIG.pillPrefWindowFrom ? isInsidePreferredWindow(nowVal) : false;

    // Cold Start Seeding
    if (!pillColdStartDone) {
      if (status.both100) {
        GM_setValue(KEYS.lastNotifiedHnH, true);
      } else {
        GM_setValue(KEYS.lastNotifiedHnH, false);
      }

      if (inWindow) {
        GM_setValue(KEYS.lastNotifiedPillWindowDate, String(getCurrentWindowStart(nowVal)));
      } else {
        GM_setValue(KEYS.lastNotifiedPillWindowDate, '');
      }

      if (isDebuffExpired && info.pillTakenAt > 0) {
        GM_setValue(KEYS.lastNotifiedDebuffEnd, info.pillTakenAt);
      } else {
        GM_setValue(KEYS.lastNotifiedDebuffEnd, 0);
      }

      pillColdStartDone = true;
      dbg('pillReminder', 'debug', 'cold start seeded', {
        both100: status.both100,
        inWindow,
        isDebuffExpired,
        pillTakenAt: info.pillTakenAt
      });
      return;
    }

    // 1. Health & Hunger full — edge-triggered, plus a cooldown so a brief
    //    both100 flicker or a second tab racing the flag can't re-fire (#80).
    if (CONFIG.featPillNotifHnH) {
      if (status.both100) {
        const alreadyNotified = GM_getValue(KEYS.lastNotifiedHnH, false);
        const cooldownUntil = GM_getValue(KEYS.hnhNotifyCooldownUntil, 0);
        if (!alreadyNotified && nowVal >= cooldownUntil) {
          // Claim the cooldown BEFORE the await so a concurrent tick/tab sees it.
          GM_setValue(KEYS.lastNotifiedHnH, true);
          GM_setValue(KEYS.hnhNotifyCooldownUntil, nowVal + CONFIG.hnhNotifyCooldownMs);
          sendPersonalNtfy('HnH', t('ntfyHnHFullTitle'), t('ntfyHnHFullBody'), 'poultry_leg,heart,white_check_mark');
        } else if (!alreadyNotified) {
          // In cooldown from a very recent fire — mark as notified silently so we
          // don't fire the moment the cooldown lapses while still at 100%.
          GM_setValue(KEYS.lastNotifiedHnH, true);
        }
      } else {
        if (GM_getValue(KEYS.lastNotifiedHnH, false) !== false) {
          GM_setValue(KEYS.lastNotifiedHnH, false);
        }
      }
    }

    // 2. Preferred window
    if (CONFIG.featPillNotifWindow && CONFIG.pillPrefWindowFrom) {
      if (inWindow) {
        const winStart = getCurrentWindowStart(nowVal);
        const lastWinStart = GM_getValue(KEYS.lastNotifiedPillWindowDate, '');
        if (String(lastWinStart) !== String(winStart)) {
          GM_setValue(KEYS.lastNotifiedPillWindowDate, String(winStart));
          sendPersonalNtfy('Window', t('ntfyPillWindowTitle'), t('ntfyPillWindowBody', { time: CONFIG.pillPrefWindowFrom }), 'pill,alarm_clock');
        }
      }
    }

    // 3. Debuff expired
    if (CONFIG.featPillNotifDebuff && info.pillTakenAt > 0) {
      if (isDebuffExpired) {
        const lastDebuffPillTakenAt = GM_getValue(KEYS.lastNotifiedDebuffEnd, 0);
        if (lastDebuffPillTakenAt !== info.pillTakenAt) {
          GM_setValue(KEYS.lastNotifiedDebuffEnd, info.pillTakenAt);
          sendPersonalNtfy('Debuff', t('ntfyDebuffGoneTitle'), t('ntfyDebuffGoneBody'), 'pill,sparkles');
        }
      }
    }
  }

  function isInsidePreferredWindow(now) {
    if (!CONFIG.pillPrefWindowFrom) return true;
    const partsFrom = CONFIG.pillPrefWindowFrom.split(':');
    if (partsFrom.length !== 2) return true;
    const fromHrs = Number.parseInt(partsFrom[0], 10);
    const fromMins = Number.parseInt(partsFrom[1], 10);

    let dFrom = new Date(now);
    dFrom.setHours(fromHrs, fromMins, 0, 0);

    let dTo = null;
    if (CONFIG.pillPrefWindowTo) {
      const partsTo = CONFIG.pillPrefWindowTo.split(':');
      if (partsTo.length === 2) {
        const toHrs = Number.parseInt(partsTo[0], 10);
        const toMins = Number.parseInt(partsTo[1], 10);
        dTo = new Date(now);
        dTo.setHours(toHrs, toMins, 0, 0);
        if (dTo.getTime() < dFrom.getTime()) {
          if (now < dTo.getTime()) {
            dFrom.setDate(dFrom.getDate() - 1);
            dFrom.setHours(fromHrs, fromMins, 0, 0);
          } else {
            dTo.setDate(dTo.getDate() + 1);
            dTo.setHours(toHrs, toMins, 0, 0);
          }
        }
      }
    }

    if (dTo) {
      return now >= dFrom.getTime() && now <= dTo.getTime();
    } else {
      return now >= dFrom.getTime() && now < dFrom.getTime() + 7200000;
    }
  }

  function getCurrentWindowStart(nowVal) {
    if (!CONFIG.pillPrefWindowFrom) return 0;
    const partsFrom = CONFIG.pillPrefWindowFrom.split(':');
    if (partsFrom.length !== 2) return 0;
    const fromHrs = Number.parseInt(partsFrom[0], 10);
    const fromMins = Number.parseInt(partsFrom[1], 10);

    let dFrom = new Date(nowVal);
    dFrom.setHours(fromHrs, fromMins, 0, 0);

    if (CONFIG.pillPrefWindowTo) {
      const partsTo = CONFIG.pillPrefWindowTo.split(':');
      if (partsTo.length === 2) {
        const toHrs = Number.parseInt(partsTo[0], 10);
        const toMins = Number.parseInt(partsTo[1], 10);
        let dTo = new Date(nowVal);
        dTo.setHours(toHrs, toMins, 0, 0);
        if (dTo.getTime() < dFrom.getTime()) {
          if (nowVal < dTo.getTime()) {
            dFrom.setDate(dFrom.getDate() - 1);
            dFrom.setHours(fromHrs, fromMins, 0, 0);
          }
        }
      }
    }
    return dFrom.getTime();
  }

  function nextWindowStart(now) {
    if (!CONFIG.pillPrefWindowFrom) return 0;
    if (isInsidePreferredWindow(now)) return now;

    const parts = CONFIG.pillPrefWindowFrom.split(':');
    if (parts.length !== 2) return now;
    const hrs = Number.parseInt(parts[0], 10);
    const mins = Number.parseInt(parts[1], 10);

    let d = new Date(now);
    d.setHours(hrs, mins, 0, 0);
    if (d.getTime() < now) {
      d.setDate(d.getDate() + 1);
      d.setHours(hrs, mins, 0, 0);
    }
    return d.getTime();
  }



  function getBarElements(el) {
    if (!el) return null;
    let currentEl = el;
    let commonParent = null;
    for (let i = 0; i < 5 && currentEl; i++) {
      if (currentEl.tagName === 'BODY' || currentEl.tagName === 'HTML') break;
      const fill = currentEl.querySelector('div[style*="scaleX("]');
      if (fill) {
        commonParent = currentEl;
        return { commonParent, fill, track: fill.parentElement };
      }
      currentEl = currentEl.parentElement;
    }
    return null;
  }

  function applyBarBudget(bar, readoutEl, current, max, floorVal, spendable, isBuff) {
    const { track, fill } = bar;
    if (!track) return;

    // The native track is already position:absolute + overflow:hidden (a proper
    // containing block)-only add positioning if it's somehow static. Never
    // override its absolute layout: forcing relative pops it into normal flow
    // and doubles the bar row's height.
    if (getComputedStyle(track).position === 'static') track.style.position = 'relative';

    removeBarOverlays(track);

    const floorPct = (floorVal / max) * 100;
    const currentPct = (current / max) * 100;

    // Align overlays to the native fill's box (not the taller track) so they
    // sit exactly on the colored bar instead of riding high / getting clipped.
    const barTop = fill ? `${fill.offsetTop}px` : '0';
    const barH = fill ? `${fill.offsetHeight}px` : '';

    if (!isBuff) {
      // 1. Free Overlay
      if (currentPct > floorPct) {
        const free = document.createElement('div');
        free.className = 'wia-hnh-free-overlay';
        free.style.left = `${floorPct}%`;
        free.style.width = `${currentPct - floorPct}%`;
        if (fill) { free.style.top = barTop; free.style.bottom = 'auto'; free.style.height = barH; }
        track.appendChild(free);
      }

      // 2. Floor Marker Line
      const marker = document.createElement('div');
      marker.className = 'wia-hnh-floor-marker';
      if (floorVal >= current) {
        marker.classList.add('wia-hnh-alert');
      }
      marker.style.left = `${Math.min(99.5, currentPct, floorPct)}%`;
      if (fill) { marker.style.top = barTop; marker.style.bottom = 'auto'; marker.style.height = barH; }
      track.appendChild(marker);
    }

    // 3. Text Readout Label
    let label = readoutEl.parentElement.querySelector('.wia-hnh-budget-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'wia-hnh-budget-label';
      readoutEl.parentElement.appendChild(label);
    }

    label.style.marginLeft = '6px';
    label.style.fontSize = '80%';
    label.style.fontWeight = 'bold';
    label.style.verticalAlign = 'middle';
    label.style.opacity = '0.8';

    const pct = Math.round((current / max) * 100);

    if (isBuff) {
      label.textContent = `${pct}%`;
      label.style.color = '';
    } else {
      const menu = document.getElementById('layoutUserMenu');
      const panelWidth = menu
        ? (typeof menu.getBoundingClientRect === 'function' ? menu.getBoundingClientRect().width : (menu.offsetWidth || 0))
        : 0;
      const hideSpendable = panelWidth > 0 && panelWidth < PILL_LABEL_HIDE_BREAKPOINT;

      if (hideSpendable) {
        label.textContent = `${pct}%`;
        label.style.color = spendable === 0 ? '#ff7b72' : '#3fb950';
      } else {
        if (spendable === 0) {
          label.textContent = `${pct}% · ${t('pillSpendableNone')}`;
          label.style.color = '#ff7b72';
        } else {
          const valText = spendable % 1 === 0 ? spendable : spendable.toFixed(1);
          label.textContent = `${pct}% · ${t('pillSpendableFree', { val: valText })}`;
          label.style.color = '#3fb950';
        }
      }
    }
  }

  function removeBarOverlays(track) {
    if (!track) return;
    track.querySelectorAll('.wia-hnh-reserve-overlay, .wia-hnh-free-overlay, .wia-hnh-floor-marker').forEach(el => el.remove());
  }

  function removeHnHBudget() {
    document.querySelectorAll('.wia-hnh-reserve-overlay, .wia-hnh-free-overlay, .wia-hnh-floor-marker, .wia-hnh-budget-label').forEach(el => el.remove());
  }

  function renderHnHBudget() {
    if (!CONFIG.featPillReminder) {
      removeHnHBudget();
      return;
    }

    const now = Date.now();
    const tWindow = nextWindowStart(now);
    if (!tWindow) {
      removeHnHBudget();
      return;
    }

    const msToWindow = Math.max(0, tWindow - now);
    const status = parseHealthAndHunger();
    if (!status.hpFound && !status.hungerFound) return;

    let ticks = 0;
    if (status.nextTickMs <= msToWindow) {
      ticks = 1 + Math.floor((msToWindow - status.nextTickMs) / 3600000);
    }

    const isBuff = getPillCycleInfo().phase === 'BUFF';

    if (status.hpFound && status.hpEl) {
      const bar = getBarElements(status.hpEl);
      if (bar) {
        const regenAvail = ticks * status.hpRegen;
        const floorVal = Math.max(0, Math.min(status.hpMax, status.hpMax - regenAvail));
        const spendable = Math.max(0, status.hpCurrent - floorVal);
        applyBarBudget(bar, status.hpEl, status.hpCurrent, status.hpMax, floorVal, spendable, isBuff);
      }
    }

    if (status.hungerFound && status.hungerEl) {
      const bar = getBarElements(status.hungerEl);
      if (bar) {
        const regenAvail = ticks * status.hungerRegen;
        const floorVal = Math.max(0, Math.min(status.hungerMax, status.hungerMax - regenAvail));
        const spendable = Math.max(0, status.hungerCurrent - floorVal);
        applyBarBudget(bar, status.hungerEl, status.hungerCurrent, status.hungerMax, floorVal, spendable, isBuff);
      }
    }
  }

  function extractUserIdFromHref(href) {
    if (!href) return null;
    const m = href.match(/\/user\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getCurrentUserId() {
    const userMenu = document.getElementById('layoutUserMenu');
    if (userMenu) {
      const link = userMenu.querySelector("a[href*='/user/']");
      if (link) {
        const id = extractUserIdFromHref(link.getAttribute('href'));
        if (id) return id;
      }
    }
    const strictContainers = document.querySelectorAll('[class*="user-menu"], [class*="profile-menu"], [class*="navbar-user"], [class*="user-profile"]');
    for (const container of strictContainers) {
      const link = container.querySelector("a[href*='/user/']");
      if (link) {
        const id = extractUserIdFromHref(link.getAttribute('href'));
        if (id) return id;
      }
    }
    return null;
  }

  function matchPath(d, targetPath) {
    if (!d || !targetPath) return false;
    const cleanD = d.replace(/[\s,]+/g, '');
    const cleanTarget = targetPath.replace(/[\s,]+/g, '');
    return cleanD.includes(cleanTarget);
  }

  function scanOwnPillState() {
    const ownId = getCurrentUserId();
    if (!ownId) return null;

    const ownLinks = Array.from(document.querySelectorAll("a[href*='/user/']"))
      .filter(link => extractUserIdFromHref(link.getAttribute('href')) === ownId);

    let foundState = null;

    for (const link of ownLinks) {
      let el = link;
      for (let i = 0; i < 3 && el; i++) {
        const svgs = el.querySelectorAll('svg');
        for (const svg of svgs) {
          const path = svg.querySelector('path');
          if (path) {
            const d = path.getAttribute('d') || '';
            if (matchPath(d, CONFIG.pillBuffIconPath)) {
              foundState = 'BUFF';
              return foundState;
            } else if (matchPath(d, CONFIG.pillDebuffIconPath)) {
              foundState = 'DEBUFF';
            }
          }
        }
        el = el.parentElement;
      }
    }

    if (foundState === null) {
      const path = getPagePathname();
      const isProfile = path === `/user/${ownId}` || path === `/user/${encodeURIComponent(ownId)}`;
      if (isProfile && ownLinks.length > 0) {
        foundState = 'none';
      }
    }

    return foundState;
  }

  function parseHealthAndHunger() {
    let hpPercent = 100;
    let hungerPercent = 100;
    let hpFound = false;
    let hungerFound = false;

    let hpCurrent = 100;
    let hpMax = 100;
    let hpRegen = 10;
    let hungerCurrent = 4;
    let hungerMax = 4;
    let hungerRegen = 0.4;
    let hpEl = null;
    let hungerEl = null;

    const elements = document.querySelectorAll('span, div, p');
    for (const el of elements) {
      const text = el.textContent.trim();
      let current = null;
      let max = null;

      // Format A: "130/130"
      const mSingle = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)$/);
      if (mSingle) {
        current = Number.parseFloat(mSingle[1]);
        max = Number.parseFloat(mSingle[2]);
      } else {
        // Format B: "/130" (split spans)
        const mSplit = text.match(/^\/\s*(\d+)$/);
        if (mSplit) {
          max = Number.parseFloat(mSplit[1]);
          const prev = el.previousElementSibling;
          if (prev) {
            const prevText = prev.textContent.trim();
            const mPrev = prevText.match(/^(\d+(?:\.\d+)?)$/);
            if (mPrev) {
              current = Number.parseFloat(mPrev[1]);
            }
          }
        }
      }

      if (current !== null && max !== null && max > 0) {
        const pct = (current / max) * 100;
        let currentEl = el;
        let isHp = false;
        let isHunger = false;
        let isHpIconDetected = false;
        let isHungerIconDetected = false;
        let detectedRegen = null;

        for (let i = 0; i < 3 && currentEl; i++) {
          if (currentEl.tagName === 'BODY' || currentEl.tagName === 'HTML') {
            break;
          }
          const slashCount = (currentEl.textContent.match(/\//g) || []).length;
          if (slashCount > 1) {
            break; // Stop climbing past the individual stat row container
          }
          const svgs = currentEl.querySelectorAll('svg');
          for (const svg of svgs) {
            const path = svg.querySelector('path');
            if (path) {
              const d = path.getAttribute('d') || '';
              if (matchPath(d, CONFIG.hpIconPath)) {
                isHp = true;
                isHpIconDetected = true;
              } else if (matchPath(d, CONFIG.hungerIconPath)) {
                isHunger = true;
                isHungerIconDetected = true;
              } else if (matchPath(d, CONFIG.doubleChevronPath)) {
                const parentSpan = svg.closest('span');
                if (parentSpan) {
                  const regenText = parentSpan.textContent.trim();
                  const mRegen = regenText.match(/(\d+(?:\.\d+)?)/);
                  if (mRegen) {
                    detectedRegen = Number.parseFloat(mRegen[1]);
                  }
                }
              }
            }
          }
          const imgs = currentEl.querySelectorAll('img');
          for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            if (src.includes('heart') || src.includes('hp')) {
              isHp = true;
              isHpIconDetected = true;
            }
            if (src.includes('hunger') || src.includes('food') || src.includes('fork')) {
              isHunger = true;
              isHungerIconDetected = true;
            }
          }
          if (isHp || isHunger) break;
          currentEl = currentEl.parentElement;
        }

        if (isHp) {
          if (isHpIconDetected || !hpFound) {
            hpPercent = pct;
            hpFound = true;
            hpCurrent = current;
            hpMax = max;
            hpEl = el;
            if (detectedRegen !== null) hpRegen = detectedRegen;
            else hpRegen = Math.max(1, max * 0.1);
          }
        } else if (isHunger) {
          if (isHungerIconDetected || !hungerFound) {
            hungerPercent = pct;
            hungerFound = true;
            hungerCurrent = current;
            hungerMax = max;
            hungerEl = el;
            if (detectedRegen !== null) hungerRegen = detectedRegen;
            else hungerRegen = Math.max(0.1, max * 0.1);
          }
        }
      }
    }

    let nextTickMs = 3600000;
    const searchContainers = [];
    if (hpEl) {
      let curr = hpEl;
      for (let i = 0; i < 4 && curr; i++) {
        if (curr.tagName === 'HEADER' || curr.tagName === 'NAV' || curr.id === 'layoutUserMenu') {
          searchContainers.push(curr);
          break;
        }
        searchContainers.push(curr);
        curr = curr.parentElement;
      }
    }
    if (hungerEl) {
      let curr = hungerEl;
      for (let i = 0; i < 4 && curr; i++) {
        if (curr.tagName === 'HEADER' || curr.tagName === 'NAV' || curr.id === 'layoutUserMenu') {
          searchContainers.push(curr);
          break;
        }
        searchContainers.push(curr);
        curr = curr.parentElement;
      }
    }
    if (searchContainers.length === 0) {
      const fallbackHeaders = [
        document.getElementById('layoutUserMenu'),
        document.getElementById('avatar'),
        document.querySelector('header nav'),
        document.querySelector('header')
      ].filter(Boolean);
      searchContainers.push(...fallbackHeaders);
    }

    let svgs = [];
    if (searchContainers.length > 0) {
      const seen = new Set();
      searchContainers.forEach(container => {
        container.querySelectorAll('svg').forEach(svg => {
          if (!seen.has(svg)) {
            seen.add(svg);
            svgs.push(svg);
          }
        });
      });
    } else {
      svgs = Array.from(document.querySelectorAll('svg'));
    }
    for (const svg of svgs) {
      const path = svg.querySelector('path');
      if (path) {
        const d = path.getAttribute('d') || '';
        if (matchPath(d, CONFIG.doubleChevronPath)) {
          let parent = svg.parentElement;
          let matched = false;
          let depth = 0;
          while (parent && parent.tagName !== 'BODY' && parent.tagName !== 'HTML' && depth < 3) {
            let text = parent.textContent.trim();
            // Exclude the pill badge text to prevent feedback loops
            const badgeEl = parent.querySelector('#wia-pill-badge');
            if (badgeEl) {
              const badgeText = badgeEl.textContent.trim();
              if (badgeText && text.includes(badgeText)) {
                text = text.replace(badgeText, '').trim();
              }
            }
            let m = text.match(/\b(?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s\b/i);
            let hrs = 0, mins = 0, secs = 0;
            let matchedUnit = false;

            if (m) {
              hrs = Number.parseInt(m[1] || '0', 10);
              mins = Number.parseInt(m[2] || '0', 10);
              secs = Number.parseInt(m[3] || '0', 10);
              matchedUnit = true;
            } else {
              m = text.match(/\b(?:(\d+)h\s*)?(\d+)m\b/i);
              if (m) {
                hrs = Number.parseInt(m[1] || '0', 10);
                mins = Number.parseInt(m[2] || '0', 10);
                matchedUnit = true;
              } else {
                m = text.match(/\b(\d+)h\b/i);
                if (m) {
                  hrs = Number.parseInt(m[1] || '0', 10);
                  matchedUnit = true;
                }
              }
            }

            if (matchedUnit) {
              nextTickMs = (hrs * 3600 + mins * 60 + secs) * 1000;
              matched = true;
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
          if (matched) break;
        }
      }
    }

    return {
      hpPercent,
      hungerPercent,
      hpFound,
      hungerFound,
      both100: hpPercent >= 99.9 && hungerPercent >= 99.9,
      hpCurrent,
      hpMax,
      hpRegen,
      hungerCurrent,
      hungerMax,
      hungerRegen,
      nextTickMs,
      hpEl,
      hungerEl
    };
  }

  function updatePillState() {
    const detectedState = scanOwnPillState();
    if (!detectedState) return;

    const savedState = GM_getValue(KEYS.pillState, 'none');
    const now = Date.now();
    let pillTakenAt = GM_getValue(KEYS.pillTakenAt, 0);

    const buffMs = CONFIG.pillBuffH * 3600000;
    const debuffMs = CONFIG.pillDebuffH * 3600000;

    if (detectedState === 'BUFF') {
      noneReadCount = 0;
      if (savedState !== 'BUFF') {
        pillTakenAt = now;
        GM_setValue(KEYS.pillTakenAt, pillTakenAt);
        GM_setValue(KEYS.pillState, 'BUFF');
      }
    } else if (detectedState === 'DEBUFF') {
      noneReadCount = 0;
      if (savedState === 'BUFF') {
        pillTakenAt = now - buffMs;
        GM_setValue(KEYS.pillTakenAt, pillTakenAt);
        GM_setValue(KEYS.pillState, 'DEBUFF');
      } else if (savedState === 'none') {
        const elapsed = now - pillTakenAt;
        if (elapsed < buffMs || elapsed >= buffMs + debuffMs) {
          pillTakenAt = now - buffMs;
          GM_setValue(KEYS.pillTakenAt, pillTakenAt);
        }
        GM_setValue(KEYS.pillState, 'DEBUFF');
      }
    } else if (detectedState === 'none') {
      if (savedState === 'DEBUFF' || savedState === 'BUFF') {
        noneReadCount++;
        if (noneReadCount >= 3) {
          pillTakenAt = now - (buffMs + debuffMs);
          GM_setValue(KEYS.pillTakenAt, pillTakenAt);
          GM_setValue(KEYS.pillState, 'none');
          noneReadCount = 0;
        }
      } else {
        noneReadCount = 0;
      }
    }
  }

  function formatAbsoluteTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dDate - nowDate) / 86400000);

    if (diffDays === 0) {
      return `${t('today')}, ${timeStr}`;
    } else if (diffDays === 1) {
      return `${t('tomorrow')}, ${timeStr}`;
    } else if (diffDays === -1) {
      return `${t('yesterday')}, ${timeStr}`;
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${timeStr}`;
  }

  function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m ${secs}s`;
  }

  function getBuffDebuffTimerStr(now) {
    if (CONFIG.pillPrefWindowFrom) {
      const windowStart = nextWindowStart(now);
      const durationStr = formatDuration(windowStart - now);
      return t('pillHeadlineWindowTimer', { duration: durationStr });
    }

    const status = parseHealthAndHunger();
    if (!status.hpFound && !status.hungerFound) return '';

    const hpNeeded = status.hpMax - status.hpCurrent;
    const hungerNeeded = status.hungerMax - status.hungerCurrent;
    let hpTicks = 0;
    let hungerTicks = 0;
    if (hpNeeded > 0 && status.hpRegen > 0) hpTicks = Math.ceil(hpNeeded / status.hpRegen);
    if (hungerNeeded > 0 && status.hungerRegen > 0) hungerTicks = Math.ceil(hungerNeeded / status.hungerRegen);
    const totalTicks = Math.max(hpTicks, hungerTicks);

    if (totalTicks > 0) {
      const hAndHFullETA = now + status.nextTickMs + (totalTicks - 1) * 3600000;
      const durationStr = formatDuration(hAndHFullETA - now);
      return t('pillHnHFullIn', { duration: durationStr });
    } else {
      const durationStr = formatDuration(status.nextTickMs);
      return t('pillNextTickIn', { duration: durationStr });
    }
  }

  function getPillCycleInfo() {
    const now = Date.now();
    const pillTakenAt = GM_getValue(KEYS.pillTakenAt, 0);
    const elapsed = now - pillTakenAt;

    const buffMs = CONFIG.pillBuffH * 3600000;
    const debuffMs = CONFIG.pillDebuffH * 3600000;
    const totalMs = buffMs + debuffMs;

    let phase = 'none';
    let phaseLabel = '';
    let timerStr = '';
    let nextTransitionLabel = '';
    let nextTransitionTime = '';
    let badgeClass = '';

    if (pillTakenAt > 0 && elapsed < buffMs) {
      phase = 'BUFF';
      phaseLabel = t('pillPhaseBuff');
      timerStr = getBuffDebuffTimerStr(now);
      nextTransitionLabel = t('pillPhaseKnife');
      nextTransitionTime = formatAbsoluteTime(pillTakenAt + buffMs);
      badgeClass = 'wia-badge-buff';
    } else {
      const status = parseHealthAndHunger();
      const hpNeeded = status.hpMax - status.hpCurrent;
      const hungerNeeded = status.hungerMax - status.hungerCurrent;
      let hpTicks = 0;
      let hungerTicks = 0;
      if (hpNeeded > 0 && status.hpRegen > 0) hpTicks = Math.ceil(hpNeeded / status.hpRegen);
      if (hungerNeeded > 0 && status.hungerRegen > 0) hungerTicks = Math.ceil(hungerNeeded / status.hungerRegen);
      const totalTicks = Math.max(hpTicks, hungerTicks);

      const debuffEnd = pillTakenAt > 0 ? (pillTakenAt + totalMs) : 0;
      const hAndHFullETA = totalTicks > 0
        ? now + status.nextTickMs + (totalTicks - 1) * 3600000
        : now;
      const windowStart = nextWindowStart(now);

      const nextPill = Math.max(debuffEnd, hAndHFullETA, windowStart);

      if (nextPill <= now) {
        phase = 'READY';
        phaseLabel = t('pillPhaseReady');
        badgeClass = 'wia-badge-ready';
        timerStr = '';
        nextTransitionLabel = '';
        nextTransitionTime = '';
      } else {
        const targetTime = Math.max(debuffEnd, windowStart);
        const msRemaining = Math.max(0, targetTime - now);
        let ticks = 0;
        if (msRemaining >= status.nextTickMs) {
          ticks = 1 + Math.floor((msRemaining - status.nextTickMs) / 3600000);
        }
        const maxHpRecoverable = ticks * status.hpRegen;
        const maxHungerRecoverable = ticks * status.hungerRegen;

        const hpMinRequired = status.hpMax - maxHpRecoverable + (status.hpMax * 0.05);
        const hungerMinRequired = status.hungerMax - maxHungerRecoverable + (status.hungerMax * 0.05);

        const hasSurplus = status.hpCurrent > hpMinRequired && status.hungerCurrent > hungerMinRequired;

        if (hasSurplus) {
          phase = 'KNIFE';
          phaseLabel = t('pillPhaseKnife');
          badgeClass = 'wia-badge-knife';
        } else {
          phase = 'RECOVER';
          phaseLabel = t('pillPhaseRecover');
          badgeClass = 'wia-badge-recover';
        }

        if (windowStart === nextPill && CONFIG.pillPrefWindowFrom) {
          timerStr = t('pillHeadlineWindowTimer', { duration: formatDuration(windowStart - now) });
        } else if (hAndHFullETA === nextPill && totalTicks > 0) {
          timerStr = t('pillHeadlineHnHTimer', { duration: formatDuration(hAndHFullETA - now) });
        } else {
          const lowestPct = Math.round(Math.min(status.hpPercent, status.hungerPercent));
          timerStr = `${formatDuration(nextPill - now)} (${lowestPct}%)`;
        }

        nextTransitionLabel = t('pillPhaseReady');
        nextTransitionTime = formatAbsoluteTime(nextPill);
      }
    }

    return {
      phase,
      phaseLabel,
      timerStr,
      nextTransitionLabel,
      nextTransitionTime,
      badgeClass,
      elapsed,
      totalMs,
      pillTakenAt
    };
  }

  function injectPillBadge() {
    if (!CONFIG.featPillReminder) {
      removePillBadge();
      return;
    }

    const anchor = document.getElementById('layoutUserMenu') ||
                   document.getElementById('avatar') ||
                   document.querySelector('header nav') ||
                   document.querySelector('header');
    if (!anchor) return;

    // Establish a containing block so the float variant (position:absolute)
    // anchors to the panel, not some far ancestor. Additive + idempotent:
    // 'relative' doesn't move a statically-positioned element.
    if (anchor.id === 'layoutUserMenu' && getComputedStyle(anchor).position === 'static') {
      anchor.style.position = 'relative';
    }

    let badge = document.getElementById('wia-pill-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'wia-pill-badge';
      anchor.appendChild(badge);
    }

    renderPillBadge(badge);
    applyPillFloatState(badge);
    attachPillFloatObserver(); // ensure observer matches the active menu node (idempotent)
  }

  function renderPillBadge(badge) {
    const info = getPillCycleInfo();
    const status = parseHealthAndHunger();
    const now = Date.now();

    const isFloating = badge.classList.contains('wia-pill-badge--float');
    badge.className = '';
    badge.classList.add(info.badgeClass);
    if (isFloating) {
      badge.classList.add('wia-pill-badge--float');
    }

    const lowestPct = Math.round(Math.min(status.hpPercent, status.hungerPercent));
    const hpNeeded = status.hpMax - status.hpCurrent;
    const hungerNeeded = status.hungerMax - status.hungerCurrent;
    let hpTicks = 0;
    let hungerTicks = 0;
    if (hpNeeded > 0 && status.hpRegen > 0) hpTicks = Math.ceil(hpNeeded / status.hpRegen);
    if (hungerNeeded > 0 && status.hungerRegen > 0) hungerTicks = Math.ceil(hungerNeeded / status.hungerRegen);
    const totalTicks = Math.max(hpTicks, hungerTicks);

    // 1. H&H Gate
    let hnhGatingStr = '';
    if (totalTicks > 0) {
      const hAndHFullETA = now + status.nextTickMs + (totalTicks - 1) * 3600000;
      const hhDurationStr = formatDuration(hAndHFullETA - now);
      hnhGatingStr = t('pillGateHnHWait', { time: hhDurationStr, pct: lowestPct });
    } else {
      hnhGatingStr = t('pillGateHnHReady');
    }

    // 2. Debuff Gate
    let debuffGatingStr = '';
    const totalMs = (CONFIG.pillBuffH + CONFIG.pillDebuffH) * 3600000;
    if (info.pillTakenAt > 0) {
      const debuffEnd = info.pillTakenAt + totalMs;
      if (now < debuffEnd) {
        const debuffDurationStr = formatDuration(debuffEnd - now);
        debuffGatingStr = t('pillGateDebuffWait', { time: debuffDurationStr });
      } else {
        debuffGatingStr = t('pillGateDebuffReady');
      }
    } else {
      debuffGatingStr = t('pillGateNoAnchor');
    }

    // 3. Window Gate
    let windowGatingStr = '';
    if (CONFIG.pillPrefWindowFrom) {
      if (isInsidePreferredWindow(now)) {
        windowGatingStr = t('pillGateWindowReady', { time: CONFIG.pillPrefWindowFrom });
      } else {
        const windowStart = nextWindowStart(now);
        const durationStr = formatDuration(windowStart - now);
        windowGatingStr = t('pillGateWindowWait', { time: CONFIG.pillPrefWindowFrom, duration: durationStr });
      }
    }

    const nextStr = info.nextTransitionLabel
      ? `<div class="wia-pill-detail-item"><strong>${t('pillDetailNext')}:</strong> ${info.nextTransitionLabel} (${info.nextTransitionTime})</div>`
      : '';

    const prefWindowStr = t('pillPreferredWindow', { from: CONFIG.pillPrefWindowFrom, to: CONFIG.pillPrefWindowTo });
    const gatingHeaderStr = t('pillGatingHeader');

    const isHnHReady = totalTicks === 0;
    const isDebuffReady = info.pillTakenAt > 0 ? (now >= info.pillTakenAt + totalMs) : false;
    const isWindowReady = CONFIG.pillPrefWindowFrom ? isInsidePreferredWindow(now) : true;

    badge.innerHTML = `
      <div class="wia-pill-badge-content">
        <div class="wia-pill-row">
          <img src="/images/items/cocain.png?v=33" alt="💊" style="width: 14px; height: 14px; border-radius: 2px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.5));" />
          <span class="wia-pill-status-dot"></span>
          <div class="wia-pill-text-col">
            <span class="wia-pill-phase-lbl">${info.phaseLabel}</span>
            ${info.timerStr ? `<span class="wia-pill-timer">${info.timerStr}</span>` : ''}
          </div>
        </div>
        <div class="wia-pill-hover-details">
          ${nextStr}
          <div class="wia-pill-detail-item"><strong>${t('pillDetailPreferred')}:</strong> ${prefWindowStr}</div>
          <div class="wia-pill-detail-item" style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 6px; padding-top: 6px;">
            <div style="font-weight: bold; margin-bottom: 4px; color: #8b949e;">${gatingHeaderStr}:</div>
            <div style="font-size: 90%; color: ${isHnHReady ? '#58a6ff' : '#ff7b72'};">${hnhGatingStr}</div>
            <div style="font-size: 90%; color: ${isDebuffReady || info.pillTakenAt === 0 ? '#58a6ff' : '#ff7b72'};">${debuffGatingStr}</div>
            ${windowGatingStr ? `<div style="font-size: 90%; color: ${isWindowReady ? '#58a6ff' : '#ff7b72'};">${windowGatingStr}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function removePillBadge() {
    const badge = document.getElementById('wia-pill-badge');
    if (badge) badge.remove();
  }

  // Pure: should the badge float, given a measured panel width? Fail-open to
  // in-flow (false) for unmeasured/degenerate widths.
  function shouldPillFloat(width) {
    return Number.isFinite(width) && width > 0 && width < PILL_FLOAT_BREAKPOINT;
  }

  // Toggle float mode from the panel's measured width. Idempotent: no DOM
  // write unless the float decision actually changed.
  function applyPillFloatState(badge) {
    if (!badge) return;
    const menu = document.getElementById('layoutUserMenu');
    // getBoundingClientRect().width is the rendered content box after layout.
    // Fall back to offsetWidth if getBoundingClientRect is not defined (e.g. in test environments).
    const width = menu
      ? (typeof menu.getBoundingClientRect === 'function' ? menu.getBoundingClientRect().width : (menu.offsetWidth || 0))
      : 0;
    const wantFloat = shouldPillFloat(width);
    if (wantFloat === pillIsFloating && badge.classList.contains('wia-pill-badge--float') === wantFloat) {
      return; // already in the desired state
    }
    pillIsFloating = wantFloat;
    if (wantFloat) {
      badge.classList.add('wia-pill-badge--float');
    } else {
      badge.classList.remove('wia-pill-badge--float');
    }
    dbg('pillReminder', 'debug', 'float', wantFloat, 'panelWidth', Math.round(width));
  }

  // Watch the PANEL's own width (not the viewport) — the game user-menu is a
  // user-resizable in-app panel, so window resize / matchMedia never fire on a
  // drag. ResizeObserver on #layoutUserMenu is the only correct trigger.
  function attachPillFloatObserver() {
    if (typeof ResizeObserver === 'undefined') {
      dbg('pillReminder', 'debug', 'ResizeObserver unavailable — float disabled');
      return;
    }
    const menu = document.getElementById('layoutUserMenu');
    if (!menu) {
      pillFloatObservedNode = null;
      return;
    }
    if (menu === pillFloatObservedNode) {
      return; // Already observing this active node
    }
    if (!pillFloatObserver) {
      pillFloatObserver = new ResizeObserver(() => {
        // Coalesce burst of resize notifications during a drag into one frame.
        if (pillResizeRaf) return;
        pillResizeRaf = requestAnimationFrame(() => {
          pillResizeRaf = 0;
          const badge = document.getElementById('wia-pill-badge');
          if (badge) applyPillFloatState(badge);
          // Budget label ("· ⬇ N frei") is width-dependent too — refresh on
          // resize so it hides under PILL_LABEL_HIDE_BREAKPOINT immediately,
          // not on the next 10s tick / H&H change.
          renderHnHBudget();
        });
      });
    }
    pillFloatObserver.disconnect();   // re-attach cleanly
    pillFloatObserver.observe(menu);
    pillFloatObservedNode = menu;
  }

  function detachPillFloatObserver() {
    if (pillFloatObserver) pillFloatObserver.disconnect();
    if (pillResizeRaf) {
      cancelAnimationFrame(pillResizeRaf);
      pillResizeRaf = 0;
    }
    pillFloatObservedNode = null;
    pillIsFloating = false;
  }

  function highlightCocaineItems() {
    removeCocaineHighlights();
  }

  function removeCocaineHighlights() {
    suspendObserver();
    try {
      const cocainImgs = document.querySelectorAll("img[alt='cocain']");
      cocainImgs.forEach(img => {
        const card = climbToCard(img) || img.parentElement;
        if (card) {
          card.classList.remove('wia-cocain-highlight', 'wia-cocain-gated-highlight');
          card.removeAttribute('data-label');
        }
      });
    } finally {
      resumeObserver();
    }
  }

  function refreshNoteIcons(userId) {
    document.querySelectorAll(NOTES_LINK_SEL).forEach(link => {
      if (!(link instanceof HTMLAnchorElement) || extractNoteUserId(link) !== userId) return;
      const icon = link.nextElementSibling;
      if (!icon || !icon.classList.contains('warera-note-icon')) return;
      const saved = hasNote(userId);
      icon.classList.toggle('has-note', saved);
      icon.textContent = saved ? '📒' : '✎';
      icon.title = notePreview(userId);
      icon.setAttribute('aria-label', t('editNoteAria', { user: notesActiveUser || link.textContent.trim() || t('noteUserLabel') }));
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Resource Market Intraday Graph module
  // ───────────────────────────────────────────────────────────────────────────
  let modalObserver = null;
  let lastMktState = null;
  let renderGen = 0;
  const EXCLUDED_ALTS = new Set(['gold', 'money', 'coins', 'xp', 'avatar', 'logo']);
  const resourceTxsInFlight = {}; // code -> promise
  let samplerInterval = null;

  function getOrCreateTooltip() {
    let el = document.querySelector('.wia-mkt-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'wia-mkt-tooltip';
      document.body.appendChild(el);
    }
    return el;
  }

  async function tickPriceSampler() {
    if (!CONFIG.featMarketGraph) return;
    const nowMs = now();
    const lastSample = GM_getValue(NS + 'lastSampleTime', 0);
    const intervalMs = CONFIG.priceSampleIntervalMs || 15 * 60 * 1000;
    if (nowMs - lastSample < intervalMs) return;

    try {
      const prices = await fetchPrices(false);
      if (prices && Object.keys(prices).length > 0) {
        const store = GM_getValue(KEYS.priceSeries, {}) || {};
        const maxWindow = CONFIG.priceSeriesWindowMs || 3 * 24 * 60 * 60 * 1000;
        const cutoff = nowMs - maxWindow;

        let updated = false;
        for (const [itemCode, price] of Object.entries(prices)) {
          if (price == null || Number.isNaN(price)) continue;
          if (!store[itemCode]) store[itemCode] = [];

          store[itemCode].push({ t: nowMs, price: price });
          store[itemCode] = store[itemCode].filter(pt => pt.t >= cutoff);
          updated = true;
        }

        if (updated) {
          GM_setValue(KEYS.priceSeries, store);
          GM_setValue(NS + 'lastSampleTime', nowMs);
          log('Price series sampler successfully updated.');

          const found = findMarketGraph();
          if (found) {
            const code = getModalResourceCode(found.modal);
            if (code && prices[code] != null) {
              lastMktState = null;
              checkAndRenderGraph(found);
            }
          }
        }
      }
    } catch (e) {
      log('Price series sampler tick failed:', e.message);
    }
  }

  async function fetchResourceTransactions(code, force, cursor) {
    if (!code) return null;
    const cacheKey = code + (cursor ? `_${cursor}` : '');
    if (resourceTxsInFlight[cacheKey]) return resourceTxsInFlight[cacheKey];
    if (isRateLimited()) return null;

    resourceTxsInFlight[cacheKey] = (async () => {
      try {
        const { payload } = await resolveApiBase('transaction.getPaginatedTransactions', {
          limit: 100,
          itemCode: code,
          transactionType: 'trading',
          cursor: cursor || undefined
        });
        return {
          items: payload?.items || [],
          nextCursor: payload?.nextCursor || null
        };
      } catch (e) {
        reportError('marketGraph', e, 'fetchResourceTransactions failed for ' + code);
        return null;
      } finally {
        renderRateLimitBanner();
        delete resourceTxsInFlight[cacheKey];
      }
    })();
    return resourceTxsInFlight[cacheKey];
  }

  async function seedResourceTransactions(code, maxSpanMs, range) {
    const nowMs = now();
    const cacheKey = KEYS.resourceTransactionsCache;
    const cache = GM_getValue(cacheKey, {}) || {};
    const entryKey = `${code}_${range}`;
    const entry = cache[entryKey];
    const ttl = 15 * 60 * 1000; // 15 minutes TTL

    if (entry && (nowMs - entry.fetchedAt < ttl) && Array.isArray(entry.points)) {
      return entry.points;
    }

    const pageCap = range === '24h' ? 2 : 6;
    const startTime = nowMs - maxSpanMs;
    let cursor = null;
    let allPoints = [];
    const seenTimes = new Set();
    let pagesFetched = 0;

    while (pagesFetched < pageCap) {
      const res = await fetchResourceTransactions(code, false, cursor);
      if (!res || !res.items || res.items.length === 0) break;

      let oldestTime = nowMs;
      for (const item of res.items) {
        const itemTime = new Date(item.createdAt).getTime();
        if (itemTime < oldestTime) {
          oldestTime = itemTime;
        }

        const price = Number(item.money) / Number(item.quantity);
        if (!Number.isNaN(price) && !seenTimes.has(itemTime)) {
          seenTimes.add(itemTime);
          allPoints.push({ t: itemTime, price: price });
        }
      }

      pagesFetched++;
      cursor = res.nextCursor;

      if (!cursor) break;
      if (oldestTime <= startTime) break;
    }

    // Sort ascending by time
    allPoints.sort((a, b) => a.t - b.t);

    // Keep only elements in the requested span
    const cutoff = nowMs - maxSpanMs;
    allPoints = allPoints.filter(pt => pt.t >= cutoff);

    // Update cache
    cache[entryKey] = {
      points: allPoints,
      fetchedAt: nowMs
    };
    GM_setValue(cacheKey, cache);

    return allPoints;
  }

  function getNativeSvgFingerprint(svg) {
    const nativePath = svg.querySelector('path[stroke="#A19638"]');
    return nativePath ? nativePath.getAttribute('d') || '' : '';
  }

  function formatHoverTime(timestamp, rangeType) {
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());

    if (rangeType === '24h') {
      return `${hh}:${mm}`;
    } else {
      const month = pad(d.getMonth() + 1);
      const date = pad(d.getDate());
      if (getLocale() === 'de') {
        return `${date}.${month}. ${hh}:${mm}`;
      } else {
        return `${month}-${date} ${hh}:${mm}`;
      }
    }
  }

  let modalObserverDepth = 0;

  function suspendModalObserver() {
    if (modalObserver) {
      if (modalObserverDepth === 0) {
        modalObserver.disconnect();
      }
      modalObserverDepth++;
    }
  }

  function resumeModalObserver(modal) {
    if (modalObserver && modal) {
      modalObserverDepth = Math.max(0, modalObserverDepth - 1);
      if (modalObserverDepth === 0) {
        modalObserver.takeRecords();
        modalObserver.observe(modal, { childList: true, subtree: true });
      }
    }
  }

  function drawIntradayGraph(found, points, range, code, myGen) {
    if (myGen !== renderGen) return;
    const { modal: freshModal, svg: freshSvg } = found;
    if (!freshSvg.isConnected) return;

    const maxSpanMs = range === '24h' ? 24 * 60 * 60 * 1000 : 72 * 60 * 60 * 1000;

    suspendModalObserver();
    let overlaySvg, overlayG;
    try {
      if (myGen !== renderGen) return;
      const parent = freshSvg.parentElement;
      if (!parent) return;

      overlaySvg = parent.querySelector('.wia-mkt-overlay-svg');
      if (!overlaySvg) {
        overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlaySvg.setAttribute('class', 'wia-mkt-overlay-svg');
        parent.insertBefore(overlaySvg, freshSvg.nextSibling);
      }

      const svgRect = freshSvg.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const topOffset = svgRect.top - parentRect.top;
      const leftOffset = svgRect.left - parentRect.left;

      overlaySvg.style.position = 'absolute';
      overlaySvg.style.top = `${topOffset}px`;
      overlaySvg.style.left = `${leftOffset}px`;
      overlaySvg.style.width = `${svgRect.width}px`;
      overlaySvg.style.height = `${svgRect.height}px`;
      overlaySvg.setAttribute('width', svgRect.width.toString());
      overlaySvg.setAttribute('height', svgRect.height.toString());
      overlaySvg.style.pointerEvents = 'none';
      overlaySvg.style.overflow = 'visible';

      overlaySvg.innerHTML = '';

      overlayG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      overlayG.setAttribute('transform', 'translate(4,6)');
      overlaySvg.appendChild(overlayG);

      if (points.length === 0) {
        log(`No intraday price points found for ${code}`);
        const warnText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        warnText.setAttribute('x', '210');
        warnText.setAttribute('y', '30');
        warnText.setAttribute('fill', '#94a3b8');
        warnText.setAttribute('text-anchor', 'middle');
        warnText.setAttribute('font-size', '10px');
        warnText.setAttribute('class', 'wia-mkt-warning');
        warnText.textContent = getLocale() === 'de' ? 'Intraday-Daten spärlich (lade...)' : 'Intraday data sparse (loading...)';

        overlayG.appendChild(warnText);
        // Mark this state as rendered (overlay IS injected above) so checkAndRenderGraph's
        // guard stops re-rendering on every modal mutation — otherwise an item with no
        // intraday data re-runs on each mutation and spams the log. Legitimate updates
        // still redraw: the async seedResourceTransactions call below redraws directly,
        // the sampler resets lastMktState on new data, and a range toggle resets it too.
        lastMktState = `${code}-${range}-${getNativeSvgFingerprint(freshSvg)}`;
        return;
      }
    } finally {
      resumeModalObserver(freshModal);
    }

    const sortedPoints = [...points].sort((a, b) => a.t - b.t);

    const tMax = now();
    const tMin = tMax - maxSpanMs;
    const buckets = [];
    let cur = tMax;

    if (range === '24h') {
      const transitionTime = tMax - (3 * 60 * 60 * 1000);
      while (cur > transitionTime) {
        const next = cur - (15 * 60 * 1000);
        buckets.push({ start: next, end: cur, sum: 0, count: 0 });
        cur = next;
      }
      const minTime = tMax - (24 * 60 * 60 * 1000);
      while (cur > minTime) {
        const next = cur - (60 * 60 * 1000);
        buckets.push({ start: next, end: cur, sum: 0, count: 0 });
        cur = next;
      }
    } else {
      const transitionTime = tMax - (12 * 60 * 60 * 1000);
      while (cur > transitionTime) {
        const next = cur - (60 * 60 * 1000);
        buckets.push({ start: next, end: cur, sum: 0, count: 0 });
        cur = next;
      }
      const minTime = tMax - (72 * 60 * 60 * 1000);
      while (cur > minTime) {
        const next = cur - (3 * 60 * 60 * 1000);
        buckets.push({ start: next, end: cur, sum: 0, count: 0 });
        cur = next;
      }
    }
    buckets.reverse();

    sortedPoints.forEach(pt => {
      if (pt.t >= tMin && pt.t <= tMax) {
        const bucket = buckets.find(b => pt.t >= b.start && pt.t <= b.end);
        if (bucket) {
          bucket.sum += pt.price;
          bucket.count += 1;
        }
      }
    });

    const plottedPoints = buckets
      .map((b) => {
        if (b.count > 0) {
          return {
            t: (b.start + b.end) / 2,
            price: b.sum / b.count
          };
        }
        return null;
      })
      .filter(Boolean);

    if (plottedPoints.length === 0) {
      lastMktState = null;
      return;
    }

    const W = 420;
    const H = 48;

    const prices = plottedPoints.map(p => p.price);
    const realMin = Math.min(...prices);
    const realMax = Math.max(...prices);
    let yMin = realMin;
    let yMax = realMax;
    if (yMax === yMin) {
      yMin = yMin * 0.9;
      yMax = yMax * 1.1;
    } else {
      const pad = (yMax - yMin) * 0.1;
      yMin -= pad;
      yMax += pad;
    }

    const getX = (pt) => {
      const pctX = (pt.t - tMin) / maxSpanMs;
      return pctX * W;
    };

    const getY = (price) => {
      const pctY = (price - yMin) / (yMax - yMin);
      return H - pctY * H;
    };

    suspendModalObserver();
    try {
      if (myGen !== renderGen) return;

      const threshold = range === '24h' ? 3 * 60 * 60 * 1000 : 10 * 60 * 60 * 1000;

      const drawPath = (pathD, isGap) => {
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', pathD);
        pathEl.setAttribute('fill', 'none');
        pathEl.setAttribute('stroke', '#f97316');
        pathEl.setAttribute('class', 'wia-mkt-line');
        if (isGap) {
          pathEl.setAttribute('stroke-dasharray', '4 4');
          pathEl.setAttribute('opacity', '0.4');
        } else {
          pathEl.setAttribute('opacity', '1');
        }

        const nativePath = freshSvg.querySelector('g[transform="translate(4,6)"] path[stroke="#A19638"]');
        if (nativePath) {
          const strokeWidth = nativePath.getAttribute('stroke-width') || '2';
          const strokeLinecap = nativePath.getAttribute('stroke-linecap') || 'round';
          const strokeLinejoin = nativePath.getAttribute('stroke-linejoin') || 'round';
          const filterVal = nativePath.getAttribute('filter');

          pathEl.setAttribute('stroke-width', strokeWidth);
          pathEl.setAttribute('stroke-linecap', strokeLinecap);
          pathEl.setAttribute('stroke-linejoin', strokeLinejoin);
          if (filterVal) pathEl.setAttribute('filter', filterVal);
        } else {
          pathEl.setAttribute('stroke-width', '2');
          pathEl.setAttribute('stroke-linecap', 'round');
          pathEl.setAttribute('stroke-linejoin', 'round');
        }
        overlayG.appendChild(pathEl);
      };

      const groups = [];
      let currentGroup = [];

      plottedPoints.forEach((pt, index) => {
        if (index === 0) {
          currentGroup.push(pt);
        } else {
          const prevPt = plottedPoints[index - 1];
          if (pt.t - prevPt.t <= threshold) {
            currentGroup.push(pt);
          } else {
            groups.push(currentGroup);
            currentGroup = [pt];
          }
        }
      });
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }

      groups.forEach(g => {
        if (g.length < 2) return;

        let pathD = `M ${getX(g[0]).toFixed(2)} ${getY(g[0].price).toFixed(2)}`;
        if (g.length === 2) {
          const pt0 = g[0], pt1 = g[1];
          const x0 = getX(pt0), y0 = getY(pt0.price);
          const x1 = getX(pt1), y1 = getY(pt1.price);
          const cpX1 = x0 + (x1 - x0) * 0.3;
          const cpY1 = y0;
          const cpX2 = x1 - (x1 - x0) * 0.3;
          const cpY2 = y1;
          pathD += ` C ${cpX1.toFixed(2)} ${cpY1.toFixed(2)}, ${cpX2.toFixed(2)} ${cpY2.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`;
        } else {
          for (let i = 0; i < g.length - 1; i++) {
            const ptPrev = g[i - 1] || g[i];
            const ptA = g[i];
            const ptB = g[i + 1];
            const ptNext = g[i + 2] || ptB;

            const xA = getX(ptA), yA = getY(ptA.price);
            const xB = getX(ptB), yB = getY(ptB.price);
            const xPrev = getX(ptPrev), yPrev = getY(ptPrev.price);
            const xNext = getX(ptNext), yNext = getY(ptNext.price);

            const tension = 0.15;
            const cpX1 = xA + (xB - xPrev) * tension;
            const cpY1 = yA + (yB - yPrev) * tension;
            const cpX2 = xB - (xNext - xA) * tension;
            const cpY2 = yB - (yNext - yPrev) * tension;

            pathD += ` C ${cpX1.toFixed(2)} ${cpY1.toFixed(2)}, ${cpX2.toFixed(2)} ${cpY2.toFixed(2)}, ${xB.toFixed(2)} ${yB.toFixed(2)}`;
          }
        }
        drawPath(pathD, false);
      });

      for (let k = 0; k < groups.length - 1; k++) {
        const ptA = groups[k][groups[k].length - 1];
        const ptB = groups[k+1][0];
        const xA = getX(ptA), yA = getY(ptA.price);
        const xB = getX(ptB), yB = getY(ptB.price);
        const pathD = `M ${xA.toFixed(2)} ${yA.toFixed(2)} L ${xB.toFixed(2)} ${yB.toFixed(2)}`;
        drawPath(pathD, true);
      }

      plottedPoints.forEach(pt => {
        const cx = getX(pt);
        const cy = getY(pt.price);

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx.toFixed(2));
        circle.setAttribute('cy', cy.toFixed(2));
        circle.setAttribute('r', '2');
        circle.setAttribute('class', 'wia-mkt-point');

        circle.onmouseenter = (e) => {
          const tooltip = getOrCreateTooltip();
          tooltip.innerHTML = `${formatHoverTime(pt.t, range)} · <span style="color: #f97316;">${t('marketGraphHoverPrice', { price: fmt(pt.price) })}</span>`;
          tooltip.style.display = 'block';
        };
        circle.onmousemove = (e) => {
          const tooltip = getOrCreateTooltip();
          tooltip.style.left = `${e.pageX + 10}px`;
          tooltip.style.top = `${e.pageY - 28}px`;
        };
        circle.onmouseleave = () => {
          const tooltip = getOrCreateTooltip();
          tooltip.style.display = 'none';
        };

        overlayG.appendChild(circle);
      });

      const maxText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      maxText.setAttribute('x', '418');
      maxText.setAttribute('y', '-4');
      maxText.setAttribute('class', 'wia-mkt-axis-label');
      maxText.setAttribute('text-anchor', 'end');
      maxText.textContent = fmt(realMax);

      overlayG.appendChild(maxText);

      const formatXLabel = (timestamp) => {
        const d = new Date(timestamp);
        const pad = (n) => String(n).padStart(2, '0');
        if (range === '24h') {
          const hh = pad(d.getHours());
          const mm = pad(d.getMinutes());
          return `${hh}:${mm}`;
        } else {
          const month = pad(d.getMonth() + 1);
          const date = pad(d.getDate());
          if (getLocale() === 'de') {
            return `${date}.${month}.`;
          } else {
            return `${month}-${date}`;
          }
        }
      };

      const oldestText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      oldestText.setAttribute('x', '0');
      oldestText.setAttribute('y', '52');
      oldestText.setAttribute('class', 'wia-mkt-x-label');
      oldestText.setAttribute('text-anchor', 'start');
      oldestText.textContent = formatXLabel(tMin);
      overlayG.appendChild(oldestText);

      const midText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      midText.setAttribute('x', '210');
      midText.setAttribute('y', '52');
      midText.setAttribute('class', 'wia-mkt-x-label');
      midText.setAttribute('text-anchor', 'middle');
      midText.textContent = formatXLabel(tMin + maxSpanMs / 2);
      overlayG.appendChild(midText);

      const nowText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nowText.setAttribute('x', '418');
      nowText.setAttribute('y', '52');
      nowText.setAttribute('class', 'wia-mkt-x-label');
      nowText.setAttribute('text-anchor', 'end');

      const timeSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      timeSpan.textContent = formatXLabel(tMax) + " ";
      nowText.appendChild(timeSpan);

      const latestPoint = plottedPoints[plottedPoints.length - 1];
      const latestPrice = latestPoint ? latestPoint.price : realMin;
      const priceSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      priceSpan.setAttribute('fill', '#f97316');
      priceSpan.setAttribute('font-weight', 'bold');
      priceSpan.textContent = `(${fmt(latestPrice)})`;
      nowText.appendChild(priceSpan);

      overlayG.appendChild(nowText);
    } finally {
      resumeModalObserver(freshModal);
    }

    const fingerprint = getNativeSvgFingerprint(freshSvg);
    lastMktState = `${code}-${range}-${fingerprint}`;
  }

  async function renderIntradayLine(code, range) {
    const myGen = ++renderGen;

    try {
      const foundStart = findMarketGraph();
      if (!foundStart || getModalResourceCode(foundStart.modal) !== code) return;
      const { modal, svg } = foundStart;

      suspendModalObserver();
      try {
        const oldToggle = modal.querySelector('.wia-mkt-toggle-row');
        if (oldToggle) oldToggle.remove();

        const innerG = svg.querySelector('g[transform="translate(4,6)"]');
        if (innerG) {
          const ourSvgEls = innerG.querySelectorAll('[class^="wia-mkt-"], [class*=" wia-mkt-"]');
          ourSvgEls.forEach(el => el.remove());
        }
      } finally {
        resumeModalObserver(modal);
      }

      const innerG = svg.querySelector('g[transform="translate(4,6)"]');
      if (!innerG) return;

      suspendModalObserver();
      try {
        const toggleRow = document.createElement('div');
        toggleRow.className = 'wia-mkt-toggle-row';
        toggleRow.innerHTML = `
          <button type="button" class="wia-mkt-toggle-btn ${range === '24h' ? 'wia-active' : ''}" data-range="24h">${t('marketGraph24h')}</button>
          <button type="button" class="wia-mkt-toggle-btn ${range === '3d' ? 'wia-active' : ''}" data-range="3d">${t('marketGraph3d')}</button>
          <span class="wia-mkt-legend">
            <span class="wia-legend-dot native"></span> <span class="wia-legend-text">${t('marketGraphLegendNative')}</span>
            <span class="wia-legend-dot intraday"></span> <span class="wia-legend-text">${t('marketGraphLegendIntraday')}</span>
          </span>
        `;

        const btns = toggleRow.querySelectorAll('.wia-mkt-toggle-btn');
        btns.forEach(btn => {
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const newRange = btn.dataset.range;
            GM_setValue(KEYS.marketGraphRange, newRange);
            renderGen++;
            lastMktState = null;
            const clickFound = findMarketGraph();
            if (clickFound) {
              checkAndRenderGraph(clickFound);
            }
          };
        });

        const parent = svg.parentElement;
        if (parent) {
          if (parent.style.position !== 'relative') {
            parent.style.position = 'relative';
          }
          parent.insertBefore(toggleRow, svg);
        }
      } finally {
        resumeModalObserver(modal);
      }

      const pollerStore = GM_getValue(KEYS.priceSeries, {}) || {};
      const samples = pollerStore[code] || [];

      const cache = GM_getValue(KEYS.resourceTransactionsCache, {}) || {};
      const cachedEntry = cache[`${code}_${range}`];
      const cachedTxs = (cachedEntry && Array.isArray(cachedEntry.points)) ? cachedEntry.points : [];

      const instantPoints = [];
      const seenTimes = new Set();

      cachedTxs.forEach(tx => {
        if (!seenTimes.has(tx.t)) {
          seenTimes.add(tx.t);
          instantPoints.push({ t: tx.t, price: tx.price });
        }
      });

      samples.forEach(pt => {
        if (!seenTimes.has(pt.t)) {
          seenTimes.add(pt.t);
          instantPoints.push({ t: pt.t, price: pt.price });
        }
      });

      // Draw immediately using whatever cached/poller data we have
      drawIntradayGraph(foundStart, instantPoints, range, code, myGen);

      // Async fetch fresh transaction points in background
      const maxSpanMs = range === '24h' ? 24 * 60 * 60 * 1000 : 72 * 60 * 60 * 1000;
      seedResourceTransactions(code, maxSpanMs, range).then(freshTxs => {
        if (myGen !== renderGen) return;

        const foundAfter = findMarketGraph();
        if (!foundAfter || !foundAfter.svg.isConnected || getModalResourceCode(foundAfter.modal) !== code) return;

        const finalPoints = [];
        const finalSeen = new Set();

        freshTxs.forEach(tx => {
          if (!finalSeen.has(tx.t)) {
            finalSeen.add(tx.t);
            finalPoints.push({ t: tx.t, price: tx.price });
          }
        });

        samples.forEach(pt => {
          if (!finalSeen.has(pt.t)) {
            finalSeen.add(pt.t);
            finalPoints.push({ t: pt.t, price: pt.price });
          }
        });

        drawIntradayGraph(foundAfter, finalPoints, range, code, myGen);
      }).catch(err => {
        reportError('marketGraph', err, 'seedResourceTransactions failed');
      });

    } catch (e) {
      reportError('marketGraph', e, 'renderIntradayLine failed');
    }
  }

  const debouncedRenderIntraday = debounce(renderIntradayLine, 100);

  function findMarketGraph() {
    const modal = document.querySelector('div[id^="headlessui-dialog-panel-"]');
    if (!modal) return null;

    const titleEl = modal.querySelector('h2[id^="headlessui-dialog-title-"], div[id^="headlessui-dialog-title-"]');
    if (!titleEl) return null;

    const titleText = titleEl.textContent.trim();
    const isBuySell = titleText.includes('Buy order') || titleText.includes('Buy Order') ||
                      titleText.includes('Kaufauftrag') || titleText.includes('Verkaufsangebot') ||
                      titleText.includes('Sell order') || titleText.includes('Sell Order');
    if (!isBuySell) return null;

    // Suchen wir das native SVG über die Farbe der Graphen-Linie statt über starre Pixel-Maße
    const allSvgs = modal.querySelectorAll('svg:not(.wia-mkt-overlay-svg)');
    let targetSvg = null;

    for (const s of allSvgs) {
      if (s.querySelector('path[stroke="#A19638"]')) {
        targetSvg = s;
        break;
      }
    }

    // Lockeres Matching-Fallback: Sucht nach einem größeren SVG mit Pfaden (typisch für den Graphen)
    if (!targetSvg) {
      for (const s of allSvgs) {
        const box = typeof s.getBoundingClientRect === 'function' ? s.getBoundingClientRect() : { width: 0, height: 0 };
        const wAttr = Number.parseInt(s.getAttribute('width') || '0', 10);
        const hAttr = Number.parseInt(s.getAttribute('height') || '0', 10);
        const hasSize = box.width > 100 || box.height > 50 || wAttr > 100 || hAttr > 50;
        if (hasSize && s.querySelector('path')) {
          targetSvg = s;
          setHealth('marketGraph', 'warn', 'Graph per Fallback-Selector gefunden (Farb-Match missglückt)');
          break;
        }
      }
    }

    if (!targetSvg) {
      setHealth('marketGraph', 'warn', 'Markt-Graph SVG nicht gefunden');
      return null;
    }

    return { modal, titleEl, svg: targetSvg };
  }

  function getModalResourceCode(modal) {
    const img = modal.querySelector("img[src*='/images/items/']");
    if (!img) return null;

    const src = img.getAttribute('src');
    if (src) {
      const match = src.match(/\/items\/([a-zA-Z0-9_-]+)\.(png|webp|gif|jpg)/i);
      if (match && match[1]) {
        // Keep the canonical casing from the image filename — the price/transaction API
        // keys on the exact itemCode (e.g. "lightAmmo"/"heavyAmmo"). Lowercasing turned
        // those into "lightammo"/"heavyammo" → API returned nothing → empty-graph loop.
        const code = match[1];
        if (!EXCLUDED_ALTS.has(code.toLowerCase())) return code;
      }
    }

    const alt = img.getAttribute('alt');
    if (alt) {
      const code = alt.trim();
      if (!EXCLUDED_ALTS.has(code.toLowerCase())) return code;
    }

    return null;
  }

  function initMarketGraph() {
    teardownMarketGraph();

    if (!samplerInterval) {
      tickPriceSampler();
      samplerInterval = setInterval(tickPriceSampler, 60000);
    }

    initSharedBodyObserver();

    const found = findMarketGraph();
    if (found) {
      setupModalObserver(found.modal);
      checkAndRenderGraph(found);
    }
  }

  function setupModalObserver(modal) {
    if (modalObserver) return;

    modalObserver = new MutationObserver((mutations) => {
      if (!CONFIG.featMarketGraph) return;

      const onlyOurs = mutations.every(m => {
        const isOurTarget = m.target instanceof Element && m.target.closest('.wia-mkt-overlay-svg, .wia-mkt-toggle-row, .wia-mkt-tooltip');
        if (isOurTarget) return true;

        if (m.type === 'childList') {
          const onlyOurNodesAdded = Array.from(m.addedNodes).every(node =>
            node instanceof Element && (node.classList.contains('wia-mkt-overlay-svg') || node.classList.contains('wia-mkt-toggle-row'))
          );
          const onlyOurNodesRemoved = Array.from(m.removedNodes).every(node =>
            node instanceof Element && (node.classList.contains('wia-mkt-overlay-svg') || node.classList.contains('wia-mkt-toggle-row'))
          );
          return (m.addedNodes.length === 0 || onlyOurNodesAdded) && (m.removedNodes.length === 0 || onlyOurNodesRemoved);
        }
        return false;
      });

      if (onlyOurs) return;

      const found = findMarketGraph();
      if (found) {
        checkAndRenderGraph(found);
      }
    });

    modalObserver.observe(modal, { childList: true, subtree: true });
  }

  function checkAndRenderGraph(found) {
    const { modal, svg } = found;
    const code = getModalResourceCode(modal);
    if (!code) {
      lastMktState = null;
      return;
    }
    if (loopGuard('mkt-render:' + code)) return;

    const range = GM_getValue(KEYS.marketGraphRange, '24h');
    const fingerprint = getNativeSvgFingerprint(svg);
    const stateKey = `${code}-${range}-${fingerprint}`;

    const overlayMissing = !svg.parentElement || !svg.parentElement.querySelector('.wia-mkt-overlay-svg');
    if (stateKey === lastMktState && !overlayMissing) return;

    debouncedRenderIntraday(code, range);
  }

  function teardownMarketGraph() {
    if (modalObserver) {
      modalObserver.disconnect();
      modalObserver = null;
    }
    lastMktState = null;
    modalObserverDepth = 0;
    if (samplerInterval) {
      clearInterval(samplerInterval);
      samplerInterval = null;
    }
    const tooltip = document.querySelector('.wia-mkt-tooltip');
    if (tooltip) tooltip.remove();
    const overlays = document.querySelectorAll('.wia-mkt-overlay-svg');
    overlays.forEach(el => el.remove());
    const toggles = document.querySelectorAll('.wia-mkt-toggle-row');
    toggles.forEach(el => el.remove());
    teardownSharedBodyObserver();
    setHealth('marketGraph', 'idle', 'disabled in settings');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Crafting Advisor module
  // ───────────────────────────────────────────────────────────────────────────
  let lastCraftState = null;

  const tierWeapons = {
    1: 'knife',
    2: 'gun',
    3: 'rifle',
    4: 'sniper',
    5: 'tank',
    6: 'jet'
  };

  function getTierItemCodes(tier) {
    const weapon = tierWeapons[tier];
    return [
      weapon,
      `helmet${tier}`,
      `chest${tier}`,
      `boots${tier}`,
      `gloves${tier}`,
      `pants${tier}`
    ];
  }

  // The crafting advisor otherwise only ever sees prices the general inventory
  // scan happened to cache — i.e. items the player already owns. That's the
  // opposite of what's needed here: you're crafting a tier precisely because
  // you *don't* own one yet. Proactively fetch all 6 of the tier's codes so a
  // rare/expensive tier (T5/T6) isn't permanently blank. Returns null if
  // everything's already fresh, otherwise a Promise the caller can await to
  // know when to re-render. Retry backoff for codes that keep failing lives
  // in fetchItemTransactions itself (transactionsLastAttempt), shared by
  // every caller — not duplicated here.
  function ensureCraftingPricesFetched(tier, codes = getTierItemCodes(tier).filter(Boolean)) {
    const tc = readCache(KEYS.transactionsCache) || {};
    const stale = codes.filter((c) => !hasFreshCachedData(c, tc));
    if (!stale.length) return null;

    const toFetch = stale.filter((c) => {
      if (transactionsInFlight[c]) return false;
      const lastAttempt = transactionsLastAttempt[c];
      if (lastAttempt && now() - lastAttempt < CONFIG.rateLimitBackoffMs) return false;
      return true;
    });

    if (!toFetch.length) {
      const inFlightPromises = stale.map((c) => transactionsInFlight[c]).filter(Boolean);
      if (inFlightPromises.length > 0) {
        return Promise.all(inFlightPromises);
      }
      return null;
    }

    dbg('advisor', 'debug', 'craftAdvisor: fetching prices for tier ' + tier, { codes: toFetch });
    return Promise.all(toFetch.map((c) => fetchItemTransactions(c)));
  }

  function getCachedPrice(itemCode) {
    const normCode = normalizeItemCode(itemCode);
    const pc = readCache(KEYS.priceCache);
    if (pc && pc.data && pc.data[normCode] != null) {
      return pc.data[normCode];
    }
    return null;
  }

  function getItemPriceRange(itemCode) {
    let minPrice = null;
    let maxPrice = null;
    let medianPrice = null;

    // Check transaction history cache
    const tc = readCache(KEYS.transactionsCache) || {};
    const itemTxs = tc[itemCode];
    if (itemTxs && Array.isArray(itemTxs.data) && itemTxs.data.length > 0) {
      const lookbackMs = txRefLookbackMs();
      const recentTxs = itemTxs.data.filter((tx) => isRecentMarketTx(tx, lookbackMs));
      const kept = rejectPriceOutliers(recentTxs, getTxPrice);
      if (kept.length < recentTxs.length) {
        dbg('advisor', 'debug', 'craftAdvisor: rejected price outliers for ' + itemCode, {
          rejected: recentTxs.length - kept.length,
          kept: kept.length
        });
      }
      const prices = kept.map(t => getTxPrice(t)).filter(p => p != null && !Number.isNaN(p));
      if (prices.length > 0) {
        minPrice = Math.min(...prices);
        maxPrice = Math.max(...prices);
        medianPrice = median(prices);
      }
    }

    // Fallback to cached price
    if (minPrice == null) {
      const floor = getCachedPrice(itemCode);
      if (floor != null) {
        minPrice = floor;
        maxPrice = floor;
        medianPrice = floor;
      }
    }

    return { minPrice, maxPrice, medianPrice };
  }

  function formatItemCode(code) {
    if (!code) return '';
    const weapons = {
      knife: { en: 'Knife', de: 'Messer' },
      gun: { en: 'Pistol', de: 'Pistole' },
      rifle: { en: 'Rifle', de: 'Gewehr' },
      sniper: { en: 'Sniper', de: 'Scharfschützengewehr' },
      tank: { en: 'Tank', de: 'Panzer' },
      jet: { en: 'Jet', de: 'Kampfjet' }
    };
    if (weapons[code]) {
      return weapons[code][CONFIG.locale] || weapons[code]['en'];
    }

    const match = code.match(/^([a-z]+)(\d)$/);
    if (match) {
      const slot = match[1];
      const tier = match[2];
      const slots = {
        helmet: { en: 'Helmet', de: 'Helm' },
        chest: { en: 'Chestplate', de: 'Brustplatte' },
        boots: { en: 'Boots', de: 'Stiefel' },
        gloves: { en: 'Gloves', de: 'Handschuhe' },
        pants: { en: 'Pants', de: 'Hose' }
      };
      const slotName = slots[slot] ? (slots[slot][CONFIG.locale] || slots[slot]['en']) : slot;
      return `T${tier} ${slotName}`;
    }
    return code;
  }

  function parseCraftingState(modal) {
    // 1. Rarity
    let selectedRarity = null;
    const rarities = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
    const rarityToTier = {
      'Common': 1,
      'Uncommon': 2,
      'Rare': 3,
      'Epic': 4,
      'Legendary': 5,
      'Mythic': 6
    };

    for (const rarity of rarities) {
      const spans = Array.from(modal.querySelectorAll('span'));
      const raritySpan = spans.find(span => span.textContent.trim() === rarity);
      if (raritySpan) {
        const cardContainer = raritySpan.closest('.ahvacn2');
        if (cardContainer && cardContainer.querySelector('._1dnmndy85w')) {
          selectedRarity = rarity;
          break;
        }
      }
    }
    const tier = rarityToTier[selectedRarity] || 1;

    // 2. Selected Item
    const activeElements = Array.from(modal.querySelectorAll('._1dnmndy85w'));
    const activeItemHighlight = activeElements.find(el => {
      const parentCard = el.closest('.ahvacn2');
      if (parentCard) {
        const text = parentCard.textContent.trim();
        if (rarities.some(r => text.includes(r))) {
          return false;
        }
      }
      return true;
    });

    let selectedItem = 'random';
    if (activeItemHighlight) {
      const itemCell = activeItemHighlight.parentElement;
      if (itemCell) {
        const questionMarkSpan = Array.from(itemCell.querySelectorAll('span')).find(span => span.textContent.trim() === '?');
        if (questionMarkSpan) {
          selectedItem = 'random';
        } else {
          const img = itemCell.querySelector('img[alt]');
          if (img) {
            // A skinned item's alt text is the skin's display name (e.g.
            // "gsg9Jet"), not the base market code ("jet") the price cache
            // and transaction API are keyed on — resolve it back via the
            // same skin->slot table detectType() uses for inventory items.
            const skinName = skinNameFromSrc(img.getAttribute('src') || '');
            const slot = skinName ? slotForSkin(skinName) : null;
            if (slot) {
              selectedItem = slotType(slot) === 'weapon' ? slot : `${slot}${tier}`;
            } else {
              selectedItem = img.getAttribute('alt');
            }
          }
        }
      }
    }

    // 3. Resource Requirements
    let scrapsRequired = 0;
    let steelRequired = 0;

    const slashSpans = Array.from(modal.querySelectorAll('span')).filter(span => span.textContent.trim().startsWith('/'));
    for (const slashSpan of slashSpans) {
      const text = slashSpan.textContent.replace(/^\//, '').trim();
      const val = parseNum(text) || 0;
      const parent = slashSpan.parentElement;
      if (parent) {
        if (parent.querySelector('img[src*="scrap"], img[src*="scraps"], img[alt="scraps"], img[alt="scrap"]')) {
          scrapsRequired = val;
        } else if (parent.querySelector('img[src*="steel"], img[alt="steel"]')) {
          steelRequired = val;
        }
      }
    }

    return {
      tier,
      selectedItem,
      scrapsRequired,
      steelRequired
    };
  }

  let craftingAdvisorInterval = null;

  function checkAndRenderCraftingAdvisor() {
    const modal = document.querySelector('div[id^="headlessui-dialog-panel-"]');
    if (!modal) {
      lastCraftState = null;
      if (craftingAdvisorInterval) {
        clearInterval(craftingAdvisorInterval);
        craftingAdvisorInterval = null;
      }
      return;
    }
    const titleEl = modal.querySelector('div[id^="headlessui-dialog-title-"]');
    if (!titleEl || titleEl.textContent.trim() !== 'Craft Items') {
      lastCraftState = null;
      return;
    }

    const state = parseCraftingState(modal);
    if (!state) return;

    const stateKey = `${state.tier}-${state.selectedItem}-${state.scrapsRequired}-${state.steelRequired}`;
    if (stateKey === lastCraftState) return;
    lastCraftState = stateKey;

    renderCraftingAdvisor(modal, state);
  }

  function triggerCraftingAdvisorCheck() {
    const modal = document.querySelector('div[id^="headlessui-dialog-panel-"]');
    if (modal) {
      if (!craftingAdvisorInterval) {
        craftingAdvisorInterval = setInterval(checkAndRenderCraftingAdvisor, 300);
      }
      checkAndRenderCraftingAdvisor();
    }
  }

  function teardownCraftingAdvisor() {
    if (craftingAdvisorInterval) {
      clearInterval(craftingAdvisorInterval);
      craftingAdvisorInterval = null;
    }
    const panel = document.querySelector('.wia-craft-advisor-panel');
    if (panel) panel.remove();
    lastCraftState = null;
    setHealth('craftAdvisor', 'idle', 'disabled in settings');
  }

  function renderCraftingAdvisor(modal, state) {
    const closeBtn = Array.from(modal.querySelectorAll('button')).find(btn => btn.textContent.trim() === 'Close' || btn.textContent.trim() === 'Schließen');
    if (!closeBtn) return;
    const buttonRow = closeBtn.closest('div[class*="_1dnmndy1q8"]') || closeBtn.parentElement;
    if (!buttonRow) return;

    let panel = modal.querySelector('.wia-craft-advisor-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'wia-craft-advisor-panel';
      panel.style.margin = '10px 16px';
      panel.style.padding = '10px';
      panel.style.borderRadius = '6px';
      panel.style.border = '1px solid rgba(255,255,255,0.08)';
      panel.style.backgroundColor = 'rgba(255,255,255,0.02)';
      panel.style.fontSize = '12px';
      panel.style.lineHeight = '1.5';
      buttonRow.parentElement.insertBefore(panel, buttonRow);
    }

    const tierItemCodes = getTierItemCodes(state.tier);
    const pricesFetch = ensureCraftingPricesFetched(state.tier, tierItemCodes.filter(Boolean));
    if (pricesFetch !== null) {
      pricesFetch.then(() => {
        lastCraftState = null; // force a re-render once the fetched prices land
        checkAndRenderCraftingAdvisor();
      });
    }

    const scrapsPrice = getCachedPrice('scraps');
    const steelPrice = getCachedPrice('steel');

    if (scrapsPrice == null || steelPrice == null) {
      panel.innerHTML = `<div style="color: #ff7b72; font-weight: bold;">${t('craftMissingPrices')}</div>`;
      return;
    }

    // Steel cost is doubled for specific item crafts
    const isSpecific = state.selectedItem !== 'random';
    const actualSteelReq = isSpecific ? (2 * state.steelRequired) : state.steelRequired;
    const resourceCost = (actualSteelReq * steelPrice) + (state.scrapsRequired * scrapsPrice);

    let html = `
      <div style="font-weight: bold; color: #58a6ff; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
        🔨 ${t('craftTitle')}
      </div>
      <div style="color: #c9d1d9; margin-bottom: 6px;">
        ${t('craftResourceCost', {
          val: fmt(resourceCost),
          steelPrice: fmt(steelPrice),
          scrapsPrice: fmt(scrapsPrice)
        })}
      </div>
    `;

    if (!isSpecific) {
      // Random mode: rank items by MEDIAN price, not floor. Floor-ranking picks
      // whichever item happens to have the highest worst-case sale — with 6
      // equally-likely outcomes, the item most worth hoping for is the one with
      // the best TYPICAL price, and floor-only profit made genuinely profitable
      // items (e.g. boots5 median ~153 vs its own floor ~130, tied with gloves5's
      // floor) read as a guaranteed loss across the board.
      const itemsInfo = tierItemCodes.map(code => {
        const range = getItemPriceRange(code);
        return { code, range };
      }).filter(item => item.range.medianPrice != null);

      if (itemsInfo.length > 0) {
        itemsInfo.sort((a, b) => a.range.medianPrice - b.range.medianPrice);
        const worst = itemsInfo[0];
        const best = itemsInfo[itemsInfo.length - 1];

        const worstProfit = worst.range.medianPrice - resourceCost;
        const bestProfit = best.range.medianPrice - resourceCost;

        const worstColor = worstProfit >= 0 ? '#3fb950' : '#ff7b72';
        const bestColor = bestProfit >= 0 ? '#3fb950' : '#ff7b72';

        html += `
          <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.06);">
            <div style="color: #8b949e; margin-bottom: 2px;">${t('craftProfitRange')}:</div>
            <div style="margin-bottom: 2px;">
              • ${t('craftWorstItem', { item: formatItemCode(worst.code), profit: `<span style="color: ${worstColor}; font-weight: bold;">${worstProfit >= 0 ? '+' : ''}${fmt(worstProfit)} Gold</span>` })}
              <span style="color: #6e7681; font-size: 90%;">(${t('craftItemRange', { min: fmt(worst.range.minPrice), max: fmt(worst.range.maxPrice) })})</span>
            </div>
            <div>
              • ${t('craftBestItem', { item: formatItemCode(best.code), profit: `<span style="color: ${bestColor}; font-weight: bold;">${bestProfit >= 0 ? '+' : ''}${fmt(bestProfit)} Gold</span>` })}
              <span style="color: #6e7681; font-size: 90%;">(${t('craftItemRange', { min: fmt(best.range.minPrice), max: fmt(best.range.maxPrice) })})</span>
            </div>
          </div>
        `;
      } else {
        html += `<div style="color: #8b949e; font-style: italic;">No market prices found for Tier ${state.tier} items.</div>`;
      }
    } else {
      // Specific mode
      const range = getItemPriceRange(state.selectedItem);
      if (range.minPrice != null && range.maxPrice != null) {
        const minProfit = range.minPrice - resourceCost;
        const maxProfit = range.maxPrice - resourceCost;
        const medianProfit = range.medianPrice - resourceCost;
        const minColor = minProfit >= 0 ? '#3fb950' : '#ff7b72';
        const maxColor = maxProfit >= 0 ? '#3fb950' : '#ff7b72';
        const medianColor = medianProfit >= 0 ? '#3fb950' : '#ff7b72';

        html += `
          <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.06);">
            <div style="margin-bottom: 2px;">
              • ${t('craftMarketRange', { min: fmt(range.minPrice), max: fmt(range.maxPrice) })}
            </div>
            <div style="margin-bottom: 2px;">
              • ${t('craftProfitMedian', {
                profit: `<span style="color: ${medianColor}; font-weight: bold;">${medianProfit >= 0 ? '+' : ''}${fmt(medianProfit)} Gold</span>`
              })}
            </div>
            <div>
              • ${t('craftProfitSpecific', {
                min: `<span style="color: ${minColor}; font-weight: bold;">${minProfit >= 0 ? '+' : ''}${fmt(minProfit)}</span>`,
                max: `<span style="color: ${maxColor}; font-weight: bold;">${maxProfit >= 0 ? '+' : ''}${fmt(maxProfit)}</span>`
              })} Gold
            </div>
          </div>
        `;
      } else {
        html += `<div style="color: #8b949e; font-style: italic;">No market price range found for <span class="wia-craft-missing-item"></span>.</div>`;
      }
    }

    panel.innerHTML = html;

    // formatItemCode(state.selectedItem) can be an unrecognized skinned
    // item's raw DOM alt text - set via textContent, never string-interpolated
    // into the innerHTML template above, so it can never be reinterpreted as
    // markup (CodeQL js/xss-through-dom).
    const missingItemEl = panel.querySelector('.wia-craft-missing-item');
    if (missingItemEl) missingItemEl.textContent = formatItemCode(state.selectedItem);
  }

  // ───────────────────────────────────────────────────────────────────────────

  // ===================== Equipment Sell Price Calculator =====================
  let equipSellCalcInterval = null;
  let equipSellCalcFab = null;
  let equipSellCalcPanel = null;

  function initEquipSellCalc() {
    if (!CONFIG.featEquipSellCalc) {
      teardownEquipSellCalcUI();
      return;
    }
    if (isMarketPage()) renderEquipSellCalc();
  }



  function teardownEquipSellCalcUI() {
    if (equipSellCalcFab) {
      equipSellCalcFab.remove();
      equipSellCalcFab = null;
    }
    if (equipSellCalcPanel) {
      if (equipSellCalcPanel._wiaKeydown) document.removeEventListener('keydown', equipSellCalcPanel._wiaKeydown);
      if (equipSellCalcPanel._wiaClick) document.removeEventListener('click', equipSellCalcPanel._wiaClick);
      equipSellCalcPanel.remove();
      equipSellCalcPanel = null;
    }
  }

  function calcEquipSellPrice(targetBuyerPays, taxPct) {
    const mult = 1 + taxPct / 100;
    const exactEntered = targetBuyerPays / mult;
    const baseTick = Math.floor(exactEntered * 1000) / 1000;
    const rawTicks = [
      Math.max(0, baseTick - 0.001),
      baseTick,
      baseTick + 0.001,
      baseTick + 0.002
    ];

    const ticks = rawTicks.map(figure => {
      const roundedBp = Math.round(figure * mult * 100) / 100;
      return {
        figure: Number(figure.toFixed(3)),
        buyerPays: roundedBp,
        delta: Number((roundedBp - targetBuyerPays).toFixed(4)),
        tax: Number((roundedBp - figure).toFixed(4))
      };
    });

    const deduped = [];
    const seen = new Set();
    for (const t of ticks) {
      if (!seen.has(t.figure)) {
        seen.add(t.figure);
        deduped.push(t);
      }
    }

    let closest = deduped[0];
    let minAbs = Math.abs(closest.delta);
    for (const t of deduped) {
      const a = Math.abs(t.delta);
      if (a < minAbs) {
        minAbs = a;
        closest = t;
      } else if (a === minAbs && t.delta <= 0) {
        closest = t;
      }
    }

    return {
      figure: closest.figure,
      buyerPays: closest.buyerPays,
      delta: closest.delta,
      tax: closest.tax,
      ticks: deduped
    };
  }

  function renderEquipSellCalc() {
    if (equipSellCalcFab && document.body.contains(equipSellCalcFab)) return;
    
    equipSellCalcFab = document.createElement('div');
    equipSellCalcFab.className = 'wia-equip-sell-fab' + (CONFIG.featScratchpad ? '' : ' wia-calc-no-sp');
    equipSellCalcFab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e6edf3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><circle cx="9" cy="11" r="0.5" fill="#e6edf3"/><circle cx="15" cy="11" r="0.5" fill="#e6edf3"/><circle cx="9" cy="15" r="0.5" fill="#e6edf3"/><circle cx="15" cy="15" r="0.5" fill="#e6edf3"/><line x1="9" y1="19" x2="15" y2="19"/></svg>`;
    
    equipSellCalcFab.onclick = (e) => {
      e.stopPropagation();
      if (equipSellCalcPanel) {
        teardownEquipSellCalcUI();
      } else {
        showEquipSellCalcPanel();
      }
    };
    
    document.body.appendChild(equipSellCalcFab);
  }

  function showEquipSellCalcPanel() {
    const taxPct = typeof _resolvedMarketTaxPct === 'number' ? _resolvedMarketTaxPct : 1;
    const lastPrice = GM_getValue(KEYS.equipSellCalcLastPrice, 100);

    equipSellCalcPanel = document.createElement('div');
    equipSellCalcPanel.className = 'wia-equip-sell-panel' + (CONFIG.featScratchpad ? '' : ' wia-calc-no-sp');

    const calcHtml = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(148,163,184,0.15); padding-bottom: 8px;">
        <div style="font-weight: bold; font-size: 14px; color: #f0f6fc;">
          ${t('equipSellCalcTitle')}
          <span style="border: 1px solid #7c3aed; color: #a78bfa; padding: 2px 4px; font-size: 8px; font-weight: 700; border-radius: 4px; letter-spacing: 0.5px; vertical-align: middle; margin-left: 4px;">PROST</span>
        </div>
        <button class="wia-calc-close" style="background: transparent; border: none; color: #8b949e; cursor: pointer; font-size: 16px;">&times;</button>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 4px;">${t('equipSellCalcTargetLabel')}:</label>
        <input type="number" class="wia-calc-target" min="0" step="0.01" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 6px 8px; font-size: 14px;" value="${lastPrice}" />
      </div>
      <div style="margin-bottom: 12px;">
        <label style="font-size: 11px; color: #8b949e; display: block; margin-bottom: 4px;">${t('equipSellCalcTaxLabel')}:</label>
        <input type="number" class="wia-calc-tax" min="0" step="0.1" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px;" value="${taxPct}" />
      </div>
      <div style="margin-bottom: 12px; background: rgba(124, 58, 237, 0.1); border: 1px solid rgba(124, 58, 237, 0.2); padding: 8px; border-radius: 4px; text-align: center;">
        <div style="font-size: 11px; color: #a78bfa; margin-bottom: 2px;">${t('equipSellCalcResultLabel')}:</div>
        <div class="wia-calc-result" style="font-size: 18px; font-weight: bold; color: #f0f6fc; cursor: pointer;" title="${t('equipSellCalcCopyHint')}">0.000</div>
      </div>
      <div class="wia-calc-ticks"></div>
      <div style="font-size: 9px; color: #8b949e; text-align: right; margin-top: 8px;">
        Inspired by Lebly
      </div>
    `;

    equipSellCalcPanel.innerHTML = calcHtml;
    document.body.appendChild(equipSellCalcPanel);

    const targetInput = equipSellCalcPanel.querySelector('.wia-calc-target');
    const taxInput = equipSellCalcPanel.querySelector('.wia-calc-tax');
    const resultDiv = equipSellCalcPanel.querySelector('.wia-calc-result');
    const closeBtn = equipSellCalcPanel.querySelector('.wia-calc-close');
    const ticksContainer = equipSellCalcPanel.querySelector('.wia-calc-ticks');

    closeBtn.onclick = () => {
      if (equipSellCalcPanel) equipSellCalcPanel.remove();
      equipSellCalcPanel = null;
    };

    const updateCalc = () => {
      const target = parseFloat(targetInput.value) || 0;
      const tax = parseFloat(taxInput.value) || 0;
      GM_setValue(KEYS.equipSellCalcLastPrice, target);
      
      const res = calcEquipSellPrice(target, tax);
      resultDiv.textContent = res.figure.toFixed(3);
      
      let ticksHtml = '<div style="font-size: 10px; color: #8b949e; margin-top: 8px; text-align: left;">';
      res.ticks.forEach(t => {
        const isClosest = t.figure === res.figure;
        const color = isClosest ? '#7c3aed' : '#8b949e';
        const sign = t.delta > 0 ? '+' : '';
        ticksHtml += `<div class="wia-calc-tick-row" data-val="${t.figure.toFixed(3)}" style="display: flex; justify-content: space-between; color: ${color}; cursor: pointer; padding: 2px 4px; border-radius: 4px;" title="${t('equipSellCalcCopyHint')}" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
          <span>Enter: ${t.figure.toFixed(3)}</span>
          <span>-> ${t.buyerPays.toFixed(2)} (diff ${sign}${t.delta.toFixed(2)})</span>
        </div>`;
      });
      ticksHtml += '</div>';
      ticksContainer.innerHTML = ticksHtml;
      Array.from(ticksContainer.querySelectorAll('.wia-calc-tick-row')).forEach(row => {
        row.onclick = () => {
          navigator.clipboard.writeText(row.getAttribute('data-val')).then(() => {
            const orig = row.children[0].textContent;
            row.children[0].textContent = 'Copied!';
            row.style.color = '#3fb950';
            setTimeout(() => {
              row.children[0].textContent = orig;
              row.style.color = '';
            }, 1000);
          });
        };
      });
    };

    targetInput.addEventListener('input', updateCalc);
    taxInput.addEventListener('input', updateCalc);
    
    resultDiv.onclick = () => {
      const text = resultDiv.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const orig = resultDiv.textContent;
        resultDiv.textContent = 'Copied!';
        resultDiv.style.color = '#3fb950';
        setTimeout(() => {
          resultDiv.textContent = orig;
          resultDiv.style.color = '#f0f6fc';
        }, 1000);
      });
    };

    updateCalc();
    
    const onKeydown = (e) => { if (e.key === 'Escape') { teardownEquipSellCalcUI(); } };
    const onClick = (e) => {
      if (equipSellCalcPanel && !equipSellCalcPanel.contains(e.target) && e.target !== equipSellCalcFab && !equipSellCalcFab.contains(e.target)) {
        teardownEquipSellCalcUI();
      }
    };
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onClick);
    equipSellCalcPanel._wiaKeydown = onKeydown;
    equipSellCalcPanel._wiaClick = onClick;
  }

  // Daily P&L Tracker module
  // ───────────────────────────────────────────────────────────────────────────
  let pnlInterval = null;
  let pnlGoldObserver = null;
  let pnlGoldObserverTarget = null;

  function normalizeItemCode(code) {
    if (!code) return '';
    const clean = code.toLowerCase().trim();
    if (clean === 'bread' || clean === 'food_bread') return 'food_bread';
    if (clean === 'steak' || clean === 'food_steak') return 'food_steak';
    if (clean === 'cookedfish' || clean === 'food_cookedfish') return 'food_cookedfish';
    return clean;
  }

  function isConsumable(code) {
    if (!code) return false;
    const clean = normalizeItemCode(code).toLowerCase();
    const whitelisted = new Set([
      'heavyammo', 'ammo', 'lightammo',
      'cocain', 'cookedfish', 'steak', 'bread',
      'food_bread', 'food_steak', 'food_cookedfish'
    ]);
    if (whitelisted.has(clean)) return true;
    if (clean.startsWith('food_') || clean.startsWith('pill_')) return true;
    return false;
  }

  function getPnlDayKey(time = Date.now()) {
    const adjustedTime = time - (2 * 60 * 60 * 1000); // 02:00 local time offset
    const d = new Date(adjustedTime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addPnlLog(ledger, type, category, label, qty, amount, desc) {
    if (!ledger.pnlLogs) ledger.pnlLogs = [];
    ledger.pnlLogs.push({
      type,       // 'income', 'expense', 'consumption', 'repair'
      category,   // 'Sales', 'Wages', 'Loot', 'Consumption', 'Repairs', etc.
      label,      // e.g. 'food_bread', 'Pistole', etc.
      qty,
      amount,
      desc,       // 'Einkaufswert', 'Marktpreis-Fallback', 'Lohn', etc.
      timestamp: Date.now()
    });
  }

  function createEmptyLedger(dayKey) {
    return {
      dayKey,
      startedAt: Date.now(),
      income: {},
      expense: {},
      capitalized: 0,
      total: 0,
      processedTxs: [],
      pnlLogs: []
    };
  }

  // Money formatter for the P&L UI: 2 decimals, locale-aware decimal separator.
  // Avoids the German "7.265 looks like 7 thousand" confusion ('.' reads as thousands sep).
  function fmtPnl(n) {
    const a = Math.abs(Number(n) || 0);
    let s;
    if (a >= 1000000) s = (a / 1000000).toFixed(2) + 'M';   // compact so huge values never overflow the chip
    else if (a >= 1000) s = (a / 1000).toFixed(2) + 'k';
    else s = a.toFixed(2);
    return getLocale() === 'de' ? s.replace('.', ',') : s;
  }

  function getGoldBalance() {
    let moneyEl = document.getElementById('money') || (document.getElementById('layoutUserMenu') && document.getElementById('layoutUserMenu').querySelector('#money'));
    if (!moneyEl && typeof document !== 'undefined') {
      const svgs = document.querySelectorAll('svg');
      for (const svg of svgs) {
        const path = svg.querySelector('path');
        if (path && (path.getAttribute('d') || '').startsWith('M12 5C7.031')) {
          const parent = svg.parentElement;
          if (parent) {
            moneyEl = parent;
            break;
          }
        }
      }
    }
    if (!moneyEl) {
      setHealth('pnl', 'warn', 'Gold-Balance-Element nicht gefunden');
      return null;
    }
    const txt = moneyEl.textContent.trim();
    if (!txt) return null;
    const match = /\d+(?:\.\d+)?/.exec(txt.replaceAll(',', '.'));
    return match ? Number.parseFloat(match[0]) : null;
  }

  function todayResetTime() {
    const d = new Date();
    d.setHours(2, 0, 0, 0);
    if (Date.now() < d.getTime()) {
      d.setDate(d.getDate() - 1);
    }
    return d.getTime();
  }

  function normalizeDbId(val) {
    if (!val) return null;
    if (typeof val === 'object' && val.$oid) return String(val.$oid);
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

function processTransactionsList(items, userId) {
    const todayStart = (globalThis.todayResetTime || todayResetTime)();
    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());

    let costBasis = readCache(KEYS.pnlCostBasis) || {};
    // NEU: Unser persistenter Speicher für Loot-IDs
    const LOOT_CACHE_KEY = 'wia_pnl_known_loot';
    let knownLoot = readCache(LOOT_CACHE_KEY) || {};

    function resolveTierFromCode(code) {
      if (!code) return null;
      const match = code.match(/(\d+)\s*$/);
      if (match) return Number.parseInt(match[1], 10);
      const clean = code.replace(/\d+$/, '').trim().toLowerCase();
      return CONFIG.weaponCodeToTier[clean] || null;
    }

    function getScrapUnitPrice() {
      let price = null;
      if (typeof getCachedPrice === 'function') {
        price = getCachedPrice('scraps');
      }
      if (price == null) {
        const pc = readCache(KEYS.priceCache);
        if (pc && pc.data && pc.data['scraps'] != null) price = pc.data['scraps'];
      }
      return price || 0;
    }

    // Persistent, history-spanning dedup: each transaction _id is processed EXACTLY
    // once, ever (survives day-reset). Without this, cost-basis qtyKnown re-accumulates
    // on every fetch (the 6→7→8 inflation bug) and breakage re-subtracts repeatedly.
    let seenArr = readCache(KEYS.pnlProcessedTxs) || [];
    const seen = new Set(seenArr);
    let seenChanged = false;
    let badTx = readCache(KEYS.pnlBadTx) || {};
    let badTxChanged = false;
    dbg('pnl', 'debug', `[seen-start] size: ${seen.size}, raw GM: ${typeof GM_getValue(KEYS.pnlProcessedTxs, null)}`);

    let ledgerChanged = false;
    let costBasisChanged = false;
    let knownLootChanged = false;

    if (!ledger.income) ledger.income = {};
    if (!ledger.expense) ledger.expense = {};
    if (!ledger.todaySales) ledger.todaySales = {};

    const sorted = [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const tx of sorted) {
      const txId = normalizeDbId(tx._id || tx.id);
      if (txId && seen.has(txId)) continue;

      try {
        const txTime = new Date(tx.createdAt).getTime();
        const isToday = txTime >= todayStart;

        const money = tx.money != null ? Number.parseFloat(tx.money) : 0;
        const quantity = tx.quantity != null ? Number.parseInt(tx.quantity, 10) : 1;
        const type = tx.transactionType;

        const isSellerMe = normalizeDbId(tx.sellerId) === normalizeDbId(userId);
        const isBuyerMe = normalizeDbId(tx.buyerId) === normalizeDbId(userId);

        const itemCode = tx.itemCode || tx.item?.code || tx.item?.itemCode || tx.item?.id;
        const itemId = normalizeDbId(tx.item?._id); // Die eindeutige Datenbank-ID des Items

      // --- Loot & Kisten registrieren ---
      if (['battleLoot', 'openCase', 'craftItem'].includes(type) && itemId) {
        if (!knownLoot[itemId]) {
          const lootCode = tx.item?.code || itemCode;
          const lootTier = resolveTierFromCode(lootCode);
          let estValue = 0;

          if (type === 'craftItem') {
            const scrapsQty = tx.itemCode === 'scraps' ? (tx.quantity || 0) : (CONFIG.scrapYieldByTier[lootTier] || 0);
            const steelQty = lootTier != null ? Math.pow(2, lootTier - 1) : 0;
            const scrapsPrice = getScrapUnitPrice();
            let steelPrice = null;
            if (typeof getCachedPrice === 'function') {
              steelPrice = getCachedPrice('steel');
            } else {
              const pc = readCache(KEYS.priceCache);
              if (pc && pc.data && pc.data['steel'] != null) steelPrice = pc.data['steel'];
            }
            if (steelPrice == null) steelPrice = 0;
            estValue = (scrapsQty * scrapsPrice) + (steelQty * steelPrice);

            knownLoot[itemId] = { value: estValue, code: lootCode, timestamp: txTime, type: 'crafted' };
            knownLootChanged = true;
          } else {
            const scrapsPrice = getScrapUnitPrice();
            const scrapYield = lootTier != null ? CONFIG.scrapYieldByTier[lootTier] ?? 0 : 0;
            const scrapVal = scrapYield * scrapsPrice;
            let marketVal = 0;
            const pc = readCache(KEYS.priceCache);
            if (pc && pc.data && pc.data[lootCode] != null) marketVal = pc.data[lootCode];
            estValue = Math.max(scrapVal, marketVal);

            knownLoot[itemId] = { value: estValue, code: lootCode, timestamp: txTime, type: 'loot' };
            knownLootChanged = true;

            if (isToday && estValue > 0) {
              ledger.income.Loot = (ledger.income.Loot || 0) + estValue;
              addPnlLog(ledger, 'income', 'Loot', lootCode, 1, estValue, 'Beute erhalten');
              ledgerChanged = true;
              dbg('pnl', 'debug', `Loot erhalten [${lootCode}]: +${estValue.toFixed(2)} Gold (Loot-Erhalt).`);
            }
          }
        }
      }

      // --- PHASE 1: Cost-Basis ---
      if (isBuyerMe && itemCode && money > 0 && quantity > 0 && type !== 'dismantleItem') {
        const normCode = normalizeItemCode(itemCode);
        const newUnitPaid = money / quantity;
        const existing = costBasis[normCode];

        if (existing && existing.qtyKnown > 0 && existing.unitPaid != null) {
          const oldTotal = existing.qtyKnown * existing.unitPaid;
          const newTotal = quantity * newUnitPaid;
          const newQty = existing.qtyKnown + quantity;
          const avgPrice = (oldTotal + newTotal) / newQty;

          costBasis[normCode] = { unitPaid: avgPrice, qtyKnown: newQty, updatedAt: txTime };
          dbg('pnl', 'debug', `Cost-Basis Update [${normCode}]: Bisher ${existing.qtyKnown}x à ${existing.unitPaid.toFixed(2)} | Neu: ${quantity}x à ${newUnitPaid.toFixed(2)} => Ø: ${avgPrice.toFixed(2)}`);
        } else {
          costBasis[normCode] = { unitPaid: newUnitPaid, qtyKnown: quantity, updatedAt: txTime };
          dbg('pnl', 'debug', `Cost-Basis Initial [${normCode}]: ${quantity}x à ${newUnitPaid.toFixed(2)}`);
        }
        costBasisChanged = true;
      }

      if (isToday) {
        let booked = false;

        // --- PHASE 2: Income & Expense ---
        if (type === 'trading' || type === 'itemMarket') {
          if (isSellerMe && money > 0) {
            const normCode = normalizeItemCode(itemCode);
            let saleIncome = money;
            let logMsg = `Verkauf [${normCode || 'Unbekannt'}]: +${money.toFixed(2)} (Sales). Menge: ${quantity}`;

            if (itemId && knownLoot[itemId]) {
              const originalVal = knownLoot[itemId].value || 0;
              saleIncome = Math.max(0, money - originalVal);
              logMsg = `Verkauf Loot [${normCode || 'Unbekannt'}]: +${saleIncome.toFixed(2)} (Sales - positive Differenz zu Loot-Wert ${originalVal.toFixed(2)}).`;
            }

            if (isToday) {
              if (saleIncome > 0) {
                ledger.income.Sales = (ledger.income.Sales || 0) + saleIncome;
                addPnlLog(ledger, 'income', 'Sales', normCode, quantity, saleIncome, 'Verkauf');
              }
              if (normCode && quantity > 0) {
                ledger.todaySales[normCode] = (ledger.todaySales[normCode] || 0) + quantity;
              }
              dbg('pnl', 'debug', logMsg);
              booked = true;
            }
          } else if (isBuyerMe && money > 0) {
            if (isToday) {
              ledger.capitalized = (ledger.capitalized || 0) + money;
              const normCode = normalizeItemCode(itemCode);
              addPnlLog(ledger, 'expense', 'Capitalized', normCode || itemCode, quantity, money, 'Kauf');
              booked = true;

              // SOFORTKAUF KORREKTUR: Wenn dies ein Konsumgut ist und wir ausstehende Klick-Verbraucher haben
              if (itemCode && isConsumable(itemCode)) {
                if (ledger.bookedConsumptionEvents && ledger.bookedConsumptionEvents.length > 0) {
                  let matchedQty = 0;
                  let matchedCostBooked = 0;
                  const remainingEvents = [];
                  let needed = quantity;
                  for (const evt of ledger.bookedConsumptionEvents) {
                    if (evt.code === normCode && needed > 0) {
                      const match = Math.min(evt.qty, needed);
                      const pct = match / evt.qty;
                      matchedQty += match;
                      matchedCostBooked += (evt.costBooked || 0) * pct;

                      evt.qty -= match;
                      evt.costBooked = (evt.costBooked || 0) - (evt.costBooked || 0) * pct;
                      needed -= match;

                      if (evt.qty > 0) {
                        remainingEvents.push(evt);
                      }
                    } else {
                      remainingEvents.push(evt);
                    }
                  }
                  ledger.bookedConsumptionEvents = remainingEvents;

                  if (matchedQty > 0) {
                    const unitPrice = quantity > 0 ? (money / quantity) : money;
                    const actualCost = matchedQty * unitPrice;
                    const diff = actualCost - matchedCostBooked;
                    if (Math.abs(diff) > 0.001) {
                      ledger.expense.Consumption = (ledger.expense.Consumption || 0) + diff;
                      addPnlLog(ledger, 'consumption', 'Consumption', normCode, matchedQty, diff, 'Sofortkauf Korrektur');
                      dbg('pnl', 'debug', `Klick-Verbrauch korrigiert [${normCode}]: ${matchedQty}x angepasst um ${diff.toFixed(2)} Gold (Vorher: ${matchedCostBooked.toFixed(2)}, Real: ${actualCost.toFixed(2)}).`);
                    }
                  }
                }
              }
            }
          }
        }
        else if (type === 'dismantleItem') {
          const realItemCode = tx.item?.code || itemCode;
          const scrapCount = tx.quantity != null ? Number.parseInt(tx.quantity, 10) : 0;

          // 1. Schrott-Wert in Gold umrechnen
          const scrapUnitPrice = getScrapUnitPrice();
          const scrapValueInGold = scrapCount * scrapUnitPrice;

          // 2. Cost-Basis aufräumen (ABER KEINEN VERLUST BUCHEN!)
          if (realItemCode && realItemCode !== 'scraps') {
            const normCode = normalizeItemCode(realItemCode);
            const basis = costBasis[normCode];
            if (basis && basis.qtyKnown > 0) {
              basis.qtyKnown -= 1;
              costBasisChanged = true;
              dbg('pnl', 'debug', `Breakage [${normCode}]: Item zerstört. Cost-Basis Menge um 1 reduziert. (Kosten-Abzug ignoriert -> Live-Scanner regelt Verschleiß).`);
            }
          }

          // 3. Einnahme durch den Schrott (Income) verbuchen
          if (isToday && scrapValueInGold > 0) {
            ledger.income.Other = (ledger.income.Other || 0) + scrapValueInGold;
            addPnlLog(ledger, 'income', 'Other', 'Schrott (Brechen)', scrapCount, scrapValueInGold, 'Schrott erhalten');
            dbg('pnl', 'debug', `Breakage Scraps: +${scrapValueInGold.toFixed(2)} Gold (aus ${scrapCount}x Schrott) als Einnahme (Other) verbucht.`);
            booked = true;
          }
        }
        else if (type === 'wage') {
          if (isToday) {
            if (isSellerMe && money > 0) {
              ledger.income.Wages = (ledger.income.Wages || 0) + money;
              addPnlLog(ledger, 'income', 'Wages', 'Arbeit', 1, money, 'Lohn erhalten');
              dbg('pnl', 'debug', `Lohn erhalten: +${money.toFixed(2)} (Wages).`);
              booked = true;
            } else if (isBuyerMe && money > 0) {
              ledger.expense['Employee Wages'] = (ledger.expense['Employee Wages'] || 0) + money;
              addPnlLog(ledger, 'expense', 'Employee Wages', 'Mitarbeiter', 1, money, 'Lohn gezahlt');
              dbg('pnl', 'debug', `Lohn gezahlt: -${money.toFixed(2)} (Employee Wages).`);
              booked = true;
            }
          }
        } else if (type === 'donation') {
          if (isToday) {
            if (isBuyerMe && money > 0) {
              ledger.expense.Other = (ledger.expense.Other || 0) + money;
              const recipient = tx.sellerId || tx.sellerMuId || tx.sellerCountryId || tx.sellerRegionId || 'Land/MU';
              addPnlLog(ledger, 'expense', 'Other', recipient, 1, money, 'Spende gesendet');
              dbg('pnl', 'debug', `Spende gesendet: -${money.toFixed(2)} (Other).`);
              booked = true;
            } else if (isSellerMe && money > 0) {
              ledger.income.Other = (ledger.income.Other || 0) + money;
              const sender = tx.buyerId || 'Spieler';
              addPnlLog(ledger, 'income', 'Other', sender, 1, money, 'Spende erhalten');
              dbg('pnl', 'debug', `Spende erhalten: +${money.toFixed(2)} (Other).`);
              booked = true;
            }
          }
        } else if (type === 'repair') {
          if (isToday && isBuyerMe && money > 0) {
            ledger.expense.Repairs = (ledger.expense.Repairs || 0) + money;
            addPnlLog(ledger, 'expense', 'Repairs', 'Ausrüstung repariert', 1, money, 'Reparatur bezahlt');
            dbg('pnl', 'debug', `Reparatur bezahlt: -${money.toFixed(2)} (Repairs).`);
            booked = true;
          }
        } else if (type === 'openCase') {
          if (isToday) {
            let caseVal = 0;
            let normCode = '';
            if (tx.itemCode) {
              normCode = normalizeItemCode(tx.itemCode);
              const pc = readCache(KEYS.priceCache);
              if (pc && pc.data && pc.data[normCode] != null) {
                caseVal = pc.data[normCode];
              }
            }
            if (caseVal > 0) {
              ledger.expense.Cases = (ledger.expense.Cases || 0) + caseVal;
              addPnlLog(ledger, 'expense', 'Cases', normCode || tx.itemCode, 1, caseVal, 'Kiste geöffnet');
              booked = true;
              dbg('pnl', 'debug', `Kiste geöffnet [${normCode || tx.itemCode}]: -${caseVal.toFixed(2)} Gold (Kisten-Kosten).`);
            }
            const lootVal = knownLoot[itemId] ? knownLoot[itemId].value : 0;
            ledger.casesOpened = (ledger.casesOpened || 0) + 1;
            ledger.casesProfit = (ledger.casesProfit || 0) + (lootVal - caseVal);
            booked = true;
          }
        } else {
          if (isToday && money > 0) {
            const label = type === 'articleTip' ? 'Artikel Trinkgeld' : type;
            if (isSellerMe) {
              ledger.income.Other = (ledger.income.Other || 0) + money;
              addPnlLog(ledger, 'income', 'Other', label, 1, money, 'Unbekannte Einnahme');
              dbg('pnl', 'debug', `Unbekannte Einnahme (${type}): +${money.toFixed(2)} (Other).`);
              booked = true;
            } else if (isBuyerMe) {
              ledger.expense.Other = (ledger.expense.Other || 0) + money;
              addPnlLog(ledger, 'expense', 'Other', label, 1, money, 'Unbekannte Ausgabe');
              dbg('pnl', 'debug', `Unbekannte Ausgabe (${type}): -${money.toFixed(2)} (Other).`);
              booked = true;
            }
          }
        }

        if (booked) ledgerChanged = true;
      }

      // Mark processed exactly once (history-spanning), regardless of booked/today.
      if (txId) { seen.add(txId); seenChanged = true; }
    } catch (e) {
      reportError('pnl', e, 'tx ' + txId);
      const n = (badTx[txId] = (badTx[txId] || 0) + 1);
      badTxChanged = true;
      if (n >= 3) {
        if (txId) { seen.add(txId); seenChanged = true; } /* Quarantine: give up */
        setHealth('pnl', 'warn', `tx ${txId} quarantäniert nach ${n} Fehlversuchen`);
      } else {
        setHealth('pnl', 'warn', `tx ${txId} übersprungen (Versuch ${n})`);
      }
    }
  }
  dbg('pnl', 'debug', `[seen-end] seenChanged: ${seenChanged}, new size: ${seen.size}`);

  if (costBasisChanged) writeCache(KEYS.pnlCostBasis, costBasis);
  if (knownLootChanged) writeCache(LOOT_CACHE_KEY, knownLoot);
  if (badTxChanged) writeCache(KEYS.pnlBadTx, badTx);
    if (seenChanged) {
      let arr = [...seen];
      if (arr.length > 3000) arr = arr.slice(-3000); // keep newest; feed only returns latest 100
      dbg('pnl', 'debug', `[seen-write] saving array of length ${arr.length} to key ${KEYS.pnlProcessedTxs}`);
      writeCache(KEYS.pnlProcessedTxs, arr);
    }

    if (ledgerChanged) {
      let sumIncome = 0;
      for (const val of Object.values(ledger.income)) sumIncome += val;
      let sumExpense = 0;
      for (const val of Object.values(ledger.expense)) sumExpense += val;
      ledger.total = sumIncome - sumExpense;
      writeCache(KEYS.pnlLedger, ledger);

      dbg('pnl', 'debug', `Tagesabschluss-Ein: ${sumIncome.toFixed(2)} | Aus: ${sumExpense.toFixed(2)} | Profit: ${ledger.total.toFixed(2)}`);
    }
  }

  let isFetchingPnlTransactions = false;

  async function fetchAndProcessTransactions() {
    if (isFetchingPnlTransactions) return;
    isFetchingPnlTransactions = true;
    const userId = getCurrentUserId();
    if (!userId) {
      setHealth('pnl', 'warn', 'user id not found');
      isFetchingPnlTransactions = false;
      return;
    }
    try {
      await guard('pnl', async () => {
        // The feed returns only the newest 100 per page. Between 30s polls a player +
        // their employees can produce >100 tx (wages spam), so paginate until we reach
        // already-processed territory (or a page cap). Dedup makes overlap harmless.
        const seenSet = new Set(readCache(KEYS.pnlProcessedTxs) || []);
        const MAX_PAGES = 10; // safety cap = up to 1000 tx/poll; first run pulls full history
        let cursor = null;
        let prevFirstId = null;
        const all = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const args = cursor ? { limit: 100, userId, cursor } : { limit: 100, userId };
          const { payload } = await resolveApiBase('transaction.getPaginatedTransactions', args);
          const items = payload?.items || [];
          if (!items.length) break;
          const firstId = normalizeDbId(items[0]._id || items[0].id);
          if (firstId && firstId === prevFirstId) break; // cursor didn't advance → stop
          prevFirstId = firstId;
          all.push(...items);
          // Reached txs we've already processed → fully caught up, stop paginating.
          if (items.some(it => seenSet.has(normalizeDbId(it._id || it.id)))) break;
          cursor = payload?.nextCursor;
          if (!cursor || items.length < 100) break;
        }
        if (all.length) processTransactionsList(all, userId);

        updatePnlUi();
        setHealth('pnl', 'ok');
      });
    } catch (e) {
      reportError('pnl', e, 'fetchAndProcessTransactions failed');
    } finally {
      isFetchingPnlTransactions = false;
    }
  }

  function parseCardQuantity(card) {
    let qty = 1;
    function walk(node) {
      const isLeaf = node.nodeType === 3 || !node.childNodes || node.childNodes.length === 0;
      if (isLeaf) {
        const val = String(node.nodeValue || node.textContent || '').trim();
        const m = val.match(/^x\s*(\d+)$/i) || val.match(/^(\d+)$/);
        if (m) {
          qty = Number.parseInt(m[1], 10);
        }
      } else {
        const cl = node.classList;
        if (cl && (cl.contains('wia-badge') || cl.contains('wia-price-sub'))) return;
        const text = String(node.textContent || '').trim();
        const m = text.match(/^x\s*(\d+)$/i);
        if (m) {
          qty = Number.parseInt(m[1], 10);
          return;
        }
        if (node.childNodes && node.childNodes.length > 0) {
          for (let i = 0; i < node.childNodes.length; i++) {
            walk(node.childNodes[i]);
          }
        }
      }
    }
    walk(card);
    return qty;
  }

  function getActiveInventoryTab() {
    if (typeof document === 'undefined') return { tab: null, found: false };
    const elements = Array.from(document.querySelectorAll('button, a, [role="tab"]'));
    const tabMap = {
      'all': 'all',
      'alle': 'all',
      'equipment': 'equipment',
      'ausrüstung': 'equipment',
      'weapons': 'weapons',
      'waffen': 'weapons',
      'armor': 'armor',
      'rüstung': 'armor',
      'consumables': 'consumables',
      'verbrauchbares': 'consumables',
      'food': 'consumables',
      'essen': 'consumables',
      'drugs': 'consumables',
      'drogen': 'consumables',
      'pillen': 'consumables',
      'pills': 'consumables',
      'other': 'other',
      'sonstiges': 'other'
    };

    let foundAnyTab = false;
    for (const el of elements) {
      const txt = (el.textContent || '').trim().toLowerCase();
      const tabKey = tabMap[txt];
      if (!tabKey) continue;

      foundAnyTab = true;

      const isActive = el.getAttribute('aria-selected') === 'true' ||
                       el.dataset.state === 'active' ||
                       el.classList.contains('active') ||
                       el.classList.contains('selected') ||
                       el.classList.contains('_1dnmndy85w') ||
                       el.getAttribute('aria-current') === 'page';

      if (isActive) {
        return { tab: tabKey, found: true };
      }
    }
    return { tab: null, found: foundAnyTab };
  }

  function isConsumablesVisible() {
    const { tab, found } = getActiveInventoryTab();
    if (!found) return true; // fallback if no tabs detected
    if (tab === null) {
      setHealth('pnl', 'warn', 'tab-detection failed → fail-open');
      return true;
    }
    return tab === 'all' || tab === 'consumables';
  }

  // Ref: https://app.warera.io/user/69fa68b7b1c4942142eb2942/inventory
  function isEquipmentVisible() {
    const { tab, found } = getActiveInventoryTab();
    if (!found) return true; // fallback if no tabs detected
    if (tab === null) {
      setHealth('pnl', 'warn', 'tab-detection failed → fail-open');
      return true;
    }
    return tab === 'all' || tab === 'equipment' || tab === 'weapons' || tab === 'armor';
  }

function getInventoryQuantities() {
    const cards = (globalThis.findItemCards || findItemCards)(false);
    const qtyMap = {};
    const equipTypes = new Set(['weapon', 'helmet', 'chest', 'gloves', 'pants', 'boots']);

    cards.forEach((img, card) => {
      const { code, type } = detectType(img, card);
      // Ignoriere Equipment komplett (es stackt nicht und nutzt Haltbarkeit statt Menge)
      if (code && !equipTypes.has(type) && isConsumable(code)) {
        const normCode = normalizeItemCode(code);
        const qty = parseCardQuantity(getItemCell(card));
        qtyMap[normCode] = (qtyMap[normCode] || 0) + qty;
      }
    });
    return qtyMap;
  }

  function bookClickConsumption(code, qty = 1) {
    if (!code || !isConsumable(code)) return;
    const normCode = normalizeItemCode(code);
    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());
    if (!ledger.expense) ledger.expense = {};

    const { unitPaid, isEstimated } = resolveUnitBasis(normCode);
    const cost = unitPaid * qty;

    if (!ledger.bookedConsumptionEvents) {
      ledger.bookedConsumptionEvents = [];
    }
    ledger.bookedConsumptionEvents.push({
      code: normCode,
      qty,
      costBooked: cost,
      timestamp: Date.now()
    });

    if (cost > 0) {
      ledger.expense.Consumption = (ledger.expense.Consumption || 0) + cost;
      if (isEstimated) {
        ledger.hasEstimatedConsumption = true;
      }
      addPnlLog(ledger, 'consumption', 'Consumption', normCode, qty, cost, isEstimated ? 'Marktpreis-Fallback' : 'Einkaufswert');
      dbg('pnl', 'debug', `Klick-Verbrauch [${normCode}]: ${qty}x konsumiert. Verlust: -${cost.toFixed(2)} Gold${isEstimated ? ' (Schätzwert)' : ''}.`);
    } else {
      addPnlLog(ledger, 'consumption', 'Consumption', normCode, qty, 0, 'Unbekannter Preis');
      dbg('pnl', 'debug', `Klick-Verbrauch [${normCode}]: ${qty}x konsumiert, aber Kosten = 0 (Unbekannter Preis).`);
    }

    let sumIncome = 0;
    for (const val of Object.values(ledger.income)) {
      sumIncome += val;
    }
    let sumExpense = 0;
    for (const val of Object.values(ledger.expense)) {
      sumExpense += val;
    }
    ledger.total = sumIncome - sumExpense;
    writeCache(KEYS.pnlLedger, ledger);
    updatePnlUi();
  }

function checkInventoryDeltaConsumption() {
    if (!isInventoryPage()) return;
    if (!isConsumablesVisible()) {
      dbg('pnl', 'debug', 'checkInventoryDeltaConsumption: skipped (consumables hidden by active tab)');
      return;
    }

    // Safeguard 1: Skip if search/filter input has text (active filter)
    const searchInputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
    for (const input of searchInputs) {
      if (input.value && input.value.trim() !== '') {
        dbg('pnl', 'debug', `checkInventoryDeltaConsumption: skipped (search input is active: "${input.value}")`);
        return;
      }
    }

    let snapshots = readCache(KEYS.pnlSnapshots);
    if (!snapshots) return;

    const currentQts = getInventoryQuantities();

    // Safeguard 2: Prevent false consumption bookings during loading/tab switches
    if (Object.keys(currentQts).length === 0 && Object.keys(snapshots.invQty_start).length > 0) {
      const startKeys = Object.keys(snapshots.invQty_start);
      if (startKeys.length > 1) {
        dbg('pnl', 'debug', 'checkInventoryDeltaConsumption: skipped (all consumable types disappeared, likely loading/tab-switch/filter)');
        return;
      }
      const soleKey = startKeys[0];
      if (snapshots.invQty_start[soleKey] > 5) {
        dbg('pnl', 'debug', `checkInventoryDeltaConsumption: skipped (sole consumable ${soleKey} went from ${snapshots.invQty_start[soleKey]} to 0, likely loading/tab-switch/filter)`);
        return;
      }
    }

    if (!snapshots.invQty_start || Object.keys(snapshots.invQty_start).length === 0) {
      snapshots.invQty_start = currentQts;
      writeCache(KEYS.pnlSnapshots, snapshots);
      return;
    }

    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());
    if (!ledger.expense) ledger.expense = {};
    if (!ledger.bookedConsumptionEvents) ledger.bookedConsumptionEvents = [];

    let ledgerChanged = false;
    let snapshotsChanged = false;

    for (const [code, startQty] of Object.entries(snapshots.invQty_start)) {
      if (!isConsumable(code)) continue;
      const curQty = currentQts[code] || 0;

      // Safeguard 3: If a single item drops to 0, verify the drop is not suspicously large (transient/loading/filter)
      if (curQty === 0 && startQty > 0) {
        const isAmmo = code.includes('ammo');
        const limit = isAmmo ? 50 : 2;
        if (startQty > limit) {
          dbg('pnl', 'debug', `checkInventoryDeltaConsumption: skipped item ${code} (went from ${startQty} to 0, likely transient/loading/filter)`);
          continue;
        }
      }

      if (curQty < startQty) {
        let remainingDelta = startQty - curQty;

        if (ledger.bookedConsumptionEvents.length > 0) {
          const nextEvents = [];
          for (const evt of ledger.bookedConsumptionEvents) {
            if (evt.code === code && remainingDelta > 0) {
              const matched = Math.min(evt.qty, remainingDelta);
              evt.qty -= matched;
              remainingDelta -= matched;
              if (evt.qty > 0) nextEvents.push(evt);
            } else {
              nextEvents.push(evt);
            }
          }
          ledger.bookedConsumptionEvents = nextEvents;
          ledgerChanged = true;
        }

        if (remainingDelta > 0 && ledger.todaySales && ledger.todaySales[code] > 0) {
          const matchedSales = Math.min(ledger.todaySales[code], remainingDelta);
          ledger.todaySales[code] -= matchedSales;
          remainingDelta -= matchedSales;
          ledgerChanged = true;
        }

        if (remainingDelta > 0) {
          const costBasis = readCache(KEYS.pnlCostBasis) || {};
          const itemBasis = costBasis[code];
          let unitPaid = 0;
          let isEstimated = false;
          let logReason = '';

          if (itemBasis && itemBasis.unitPaid != null) {
            unitPaid = itemBasis.unitPaid;
            logReason = 'Ø-Kaufpreis';
          } else {
            // --- VERBESSERTER FALLBACK ---
            let price = null;
            if (typeof getCachedPrice === 'function') price = getCachedPrice(code);
            if (price == null) {
              const pc = readCache(KEYS.priceCache);
              if (pc && pc.data && pc.data[code] != null) price = pc.data[code];
            }

            if (price != null) {
              unitPaid = price;
              isEstimated = true;
              logReason = 'Marktpreis-Fallback';
            } else {
              logReason = 'Unbekannter Preis';
            }
          }

          if (!isFinite(unitPaid) || unitPaid > 10000) {
              unitPaid = 0; // Guard gegen korrupte Daten (kein Verbrauch über 10k pro Stück)
              logReason = 'Preis-Guard (Wert > 10k ignoriert)';
          }

          const cost = unitPaid * remainingDelta;
          if (cost > 0) {
            ledger.expense.Consumption = (ledger.expense.Consumption || 0) + cost;
            if (isEstimated) ledger.hasEstimatedConsumption = true;
            addPnlLog(ledger, 'consumption', 'Consumption', code, remainingDelta, cost, isEstimated ? 'Marktpreis-Fallback' : 'Einkaufswert');
            ledgerChanged = true;
            dbg('pnl', 'debug', `Verbrauch [${code}]: ${remainingDelta}x konsumiert. Verlust: -${cost.toFixed(2)} Gold (${logReason}).`);
          } else {
            addPnlLog(ledger, 'consumption', 'Consumption', code, remainingDelta, 0, logReason);
            dbg('pnl', 'debug', `Verbrauch [${code}]: ${remainingDelta}x konsumiert, aber Kosten = 0 (${logReason}).`);
          }
        }

        snapshots.invQty_start[code] = curQty;
        snapshotsChanged = true;
      } else if (curQty > startQty) {
        snapshots.invQty_start[code] = curQty;
        snapshotsChanged = true;
      }
    }

    for (const [code, curQty] of Object.entries(currentQts)) {
      if (snapshots.invQty_start[code] === undefined) {
        snapshots.invQty_start[code] = curQty;
        snapshotsChanged = true;
      }
    }

    if (snapshotsChanged) writeCache(KEYS.pnlSnapshots, snapshots);

    if (ledgerChanged) {
      let sumIncome = 0;
      for (const val of Object.values(ledger.income)) sumIncome += val;
      let sumExpense = 0;
      for (const val of Object.values(ledger.expense)) sumExpense += val;
      ledger.total = sumIncome - sumExpense;
      writeCache(KEYS.pnlLedger, ledger);
      updatePnlUi();
    }
  }

  // Resolve unit cost basis for an item code (paid price, else estimated market price).
  // Mirrors the guard logic used by consumption booking. Returns { unitPaid, isEstimated }.
  function resolveUnitBasis(code) {
    const normCode = normalizeItemCode(code);
    const costBasis = readCache(KEYS.pnlCostBasis) || {};
    const itemBasis = costBasis[normCode];
    let unitPaid = 0;
    let isEstimated = false;
    if (itemBasis && itemBasis.unitPaid != null) {
      unitPaid = itemBasis.unitPaid;
    } else {
      // Purchase not tracked → fall back to market value (we usually already have it).
      let price = getCachedPrice(normCode);
      if (price == null) {
        const pc = readCache(KEYS.priceCache);
        if (pc && pc.data && pc.data[normCode] != null) price = pc.data[normCode];
      }
      if (price != null) {
        unitPaid = price;
        isEstimated = true;
      }
    }
    if (!isFinite(unitPaid)) {
      unitPaid = 0;
    } else if (unitPaid > 10000) {
      reportError('pnl', new Error(`unitPaid > 10k (${unitPaid}) verworfen für ${normCode}`), 'resolveUnitBasis');
      unitPaid = 0;
    }
    if (unitPaid === 0) {
      setHealth('pnl', 'warn', 'kein Preis für ' + normCode);
    }
    return { unitPaid, isEstimated };
  }

  // Durability wear from inventory scan. Equipment is non-stacking-each instance
  // carries its own durability. We snapshot a per-code multiset of durability values
  // on every inventory visit and diff against the previous visit:
  //   - same code, durability dropped  → wear; book (drop/100)*unitPaid to Repairs.
  //   - new instance with HIGHER durability than any prior → freshly acquired (buy/craft/
  //     chest already costed elsewhere) → no wear.
  //   - prior instance vanished (no current match) → it broke; book its remaining
  //     durability as full wear. (Gear is rarely sold/unequipped per usage pattern.)
  // Single wear source-the equipment-API path is intentionally NOT booked, to avoid
  // double-counting into Repairs.
function checkInventoryDeltaWear() {
    if (!isInventoryPage()) return;
    if (!isEquipmentVisible()) {
      dbg('pnl', 'debug', 'checkInventoryDeltaWear: skipped (equipment hidden by active tab)');
      return;
    }

    // HIER: Wir holen uns roh ALLE Ausrüstungen (auch getragene/beschädigte!)
    // über die neue Hilfsfunktion, die wir in Schritt 1 angelegt haben.
    const curByCode = scanEquipmentDurability();

    let snapshots = readCache(KEYS.pnlSnapshots);
    if (!snapshots) return;

    // First visit: seed baseline, book nothing.
    if (!snapshots.equipDur_start || Object.keys(snapshots.equipDur_start).length === 0) {
      snapshots.equipDur_start = curByCode;
      writeCache(KEYS.pnlSnapshots, snapshots);
      return;
    }

    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());
    if (!ledger.expense) ledger.expense = {};

    let ledgerChanged = false;
    const prevByCode = snapshots.equipDur_start;
    const codes = new Set([...Object.keys(prevByCode), ...Object.keys(curByCode)]);

    for (const code of codes) {
      const prev = (prevByCode[code] || []).slice();
      const cur = (curByCode[code] || []).slice();
      if (!prev.length) continue; // only new acquisitions for this code → nothing wore

      // Cancel unchanged instances (exact durability match), one-for-one.
      const curRemaining = cur.slice().sort((a, b) => b - a);
      const prevRemaining = [];
      for (const p of prev.sort((a, b) => b - a)) {
        const idx = curRemaining.indexOf(p);
        if (idx !== -1) curRemaining.splice(idx, 1);
        else prevRemaining.push(p);
      }
      // prevRemaining: instances that changed or vanished (desc).
      // curRemaining: instances with new durability or newly acquired (desc).

      let totalDurLost = 0;
      // Match each remaining cur to the closest prior instance ABOVE it (wear lowered it).
      const curNew = curRemaining.sort((a, b) => a - b); // asc: match smallest cur first
      for (const c of curNew) {
        // smallest prevRemaining that is > c
        let bestIdx = -1;
        for (let i = prevRemaining.length - 1; i >= 0; i--) { // prevRemaining is desc
          if (prevRemaining[i] > c) { bestIdx = i; break; }
        }
        if (bestIdx !== -1) {
          totalDurLost += prevRemaining[bestIdx] - c;
          prevRemaining.splice(bestIdx, 1);
        }
        // else: cur instance higher than any prior → newly acquired, no wear.
      }
      // Vanished instances (prevRemaining) are NOT booked here: disposal is the
      // transaction API's job (sell = income; dismantle = removed from cost basis).
      // Their gradual wear was already booked while still present. Booking the
      // residual here would double-count sells/dismantles.

      if (totalDurLost > 0) {
        const { unitPaid, isEstimated } = resolveUnitBasis(code);
        const cost = unitPaid * (totalDurLost / 100);
        if (cost > 0) {
          log(`[PROST:pnl] Verschleiß [${code}]: -${totalDurLost.toFixed(1)}%. Verlust: -${cost.toFixed(2)} Gold${isEstimated ? ' (Schätzwert)' : ''}.`);
          ledger.expense.Repairs = (ledger.expense.Repairs || 0) + cost;
          if (isEstimated) ledger.hasEstimatedRepairs = true;
          addPnlLog(ledger, 'repair', 'Repairs', code, totalDurLost, cost, isEstimated ? 'Schätzwert' : 'Einkaufswert');
          ledgerChanged = true;
        }
      }
    }

    // Advance baseline to current state (carries across days; only the ledger resets daily).
    snapshots.equipDur_start = curByCode;
    writeCache(KEYS.pnlSnapshots, snapshots);

    if (ledgerChanged) {
      let sumIncome = 0;
      for (const val of Object.values(ledger.income)) sumIncome += val;
      let sumExpense = 0;
      for (const val of Object.values(ledger.expense)) sumExpense += val;
      ledger.total = sumIncome - sumExpense;
      writeCache(KEYS.pnlLedger, ledger);
      updatePnlUi();
    }
  }

  if (typeof document !== 'undefined') {
    // Consume-items popover: each tile is a clickable item (img[alt]=bread/steak/
    // cookedFish/cocain/…). A click consumes 1 of that item. We book it immediately
    // (the transaction API never reports consumption). The inventory-delta backstop
    // reconciles against these booked events so nothing double-counts.
    document.addEventListener('click', (e) => {
      if (!CONFIG.featPnlTracker) return;
      const pop = document.getElementById('consume-food-popover');
      if (!pop || !pop.contains(e.target)) return;
      // Find the clicked tile = the LARGEST ancestor (within the popover) whose
      // subtree contains exactly ONE img[alt]. Robust against dynamic class names.
      let node = e.target;
      let tileImg = null;
      while (node && node !== pop) {
        const imgs = node.querySelectorAll ? node.querySelectorAll('img[alt]') : [];
        if (imgs.length === 1) tileImg = imgs[0];   // keep climbing-tile = biggest single-img ancestor
        else if (imgs.length > 1) break;            // climbed into the multi-tile container → stop
        node = node.parentElement;
      }
      if (tileImg) {
        const code = tileImg.getAttribute('alt');
        if (code) { dbg('pnl', 'debug', `Consume click: ${code}`); bookClickConsumption(code, 1); }
      }
    });
  }

  function checkPnlDayReset() {
    const currentDayKey = getPnlDayKey();
    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger || ledger.dayKey !== currentDayKey) {
      log(`PnL: Day reset detected (old day=${ledger ? ledger.dayKey : 'none'}, new day=${currentDayKey})`);
      if (ledger) {
        writeCache(KEYS.pnlYesterday, ledger);
      }
      ledger = createEmptyLedger(currentDayKey);
      writeCache(KEYS.pnlLedger, ledger);

      const goldVal = getGoldBalance();
      const snapshots = {
        // null (not 0!) when gold isn't readable yet-else gold_start=0 makes the
        // gold delta equal the entire balance. Backfilled lazily in updatePnlUi.
        gold_start: goldVal !== null ? goldVal : null,
        invQty_start: isInventoryPage() ? getInventoryQuantities() : {}
      };
      writeCache(KEYS.pnlSnapshots, snapshots);
    }
    return ledger;
  }

  function safeWritePnlUi(fn) {
    if (pillBarObserver) {
      pillBarObserver.disconnect();
    }
    try {
      fn();
    } finally {
      if (pillBarObserver) {
        const m = document.getElementById('layoutUserMenu');
        if (m) {
          pillBarObserver.takeRecords();
          pillBarObserver.observe(m, PILL_OBS_OPTS);
        }
      }
      attachPillFloatObserver(); // #layoutUserMenu may be a fresh node
    }
  }

  const pnlTx = {
    de: {
      title: '📊 Tages-P&L Tracker',
      resetMsg: 'Reset 02:00',
      income: 'Einnahmen',
      expense: 'Ausgaben',
      sales: 'Verkäufe',
      wages: 'Löhne',
      empWages: 'Mitarbeiterlöhne',
      consumption: 'Verbrauch',
      repairs: 'Verschleiß/Rep.',
      other: 'Sonstiges',
      otherExp: 'Spenden/Sonstiges',
      capitalized: 'In Käufe gebunden',
      untracked: 'Unerfasst',
      totalPnl: 'Gesamt P&L',
      goldDelta: 'Gold Delta',
      today: 'Heute',
      yesterday: 'Gestern',
      category: 'Kategorie',
        caseLuck: 'Kisten-Glück',
      casesOpened: '{qty}x geöffnet',
      footer: 'P&L = Einnahmen − Ausgaben (Käufe zählen erst beim Verbrauch). Gold Delta = Live-Gold − Start. * Kisten-Glück zeigt die Differenz zwischen Loot-Wert und Kisten-Wert beim Öffnen. Der Gewinn/Verlust fließt erst beim tatsächlichen Verkauf der gezogenen Items auf dem Markt in die Gesamtrechnung ein.'
    },
    en: {
      title: '📊 Daily P&L Tracker',
      resetMsg: 'Reset 02:00',
      income: 'Income',
      expense: 'Expense',
      sales: 'Sales',
      wages: 'Wages',
      empWages: 'Employee Wages',
      consumption: 'Consumption',
      repairs: 'Wear/Repairs',
      other: 'Other',
      otherExp: 'Donations/Other',
      capitalized: 'Tied up in purchases',
      untracked: 'Untracked',
      totalPnl: 'Total P&L',
      goldDelta: 'Gold Delta',
      today: 'Today',
      yesterday: 'Yesterday',
      category: 'Category',
      caseLuck: 'Case Luck',
      casesOpened: '{qty}x opened',
      footer: 'P&L = Income − Expense (purchases count only when consumed). Gold Delta = Live Gold − Start. * Case Luck shows the difference between loot value and case value at the time of opening. The profit/loss is only factored into the main total P&L once the items are sold on the market.'
    }
  };

  function findOrCreatePnlContainer() {
    const menu = document.getElementById('layoutUserMenu');
    if (!menu) return null;

    let container = menu.querySelector('div[style*="bottom: -12px"]') ||
                    menu.querySelector('div[style*="bottom:-12px"]') ||
                    menu.querySelector('div._1dnmndyb36') ||
                    menu.querySelector('.wia-pnl-secondary-row');

    if (!container) {
      container = document.createElement('div');
      container.className = 'wia-pnl-secondary-row _1dnmndyb0j _1dnmndyayl _1dnmndyb36 _1dnmndyl3l _1dnmndylqi';
      container.setAttribute('style', 'bottom: -12px; left: 8px; right: 8px; display: flex; gap: 8px; position: absolute; pointer-events: none;');
      menu.appendChild(container);
    }
    return container;
  }

  function updatePnlUi() {
    if (!CONFIG.featPnlTracker) {
      teardownPnlUi();
      return;
    }

    const container = findOrCreatePnlContainer();
    if (!container) return;

    let pnlBadge = document.getElementById('wia-pnl-tracker') || container.querySelector('#wia-pnl-tracker');
    if (!pnlBadge) {
      pnlBadge = document.createElement('div');
      pnlBadge.id = 'wia-pnl-tracker';

      const hoverEl = document.createElement('div');
      hoverEl.className = 'wia-pnl-hover';
      pnlBadge.appendChild(hoverEl);

      safeWritePnlUi(() => {
        container.insertBefore(pnlBadge, container.firstChild);
      });
    } else if (pnlBadge.parentElement !== container) {
      safeWritePnlUi(() => {
        container.insertBefore(pnlBadge, container.firstChild);
      });
    }

    checkPnlDayReset();
    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());
    if (!ledger.income) ledger.income = {};
    if (!ledger.expense) ledger.expense = {};

    const yesterday = readCache(KEYS.pnlYesterday);
    const snapshots = readCache(KEYS.pnlSnapshots);

    const currentGold = getGoldBalance();
    let totalGoldDelta = 0;
    if (currentGold !== null && snapshots) {
      if (snapshots.gold_start === null || snapshots.gold_start === undefined) {
        // Backfill a missed start snapshot once gold becomes readable (delta = 0 today).
        snapshots.gold_start = currentGold;
        writeCache(KEYS.pnlSnapshots, snapshots);
      }
      totalGoldDelta = currentGold - snapshots.gold_start;
    }

    let sumIncome = 0;
    for (const val of Object.values(ledger.income || {})) {
      sumIncome += val;
    }
    let sumExpense = 0;
    for (const val of Object.values(ledger.expense || {})) {
      sumExpense += val;
    }
    const capitalized = ledger.capitalized || 0;
    const accrualNonCash = (ledger.expense.Consumption || 0) + (ledger.expense.Repairs || 0);
    ledger.goldDelta = totalGoldDelta;
    ledger.total = sumIncome - sumExpense;
    // Reconciliation: gold = total + non-cash accrual − capitalized purchases + residual.
    // So a clean ledger has residual ≈ 0; capitalized spend is NOT "untracked".
    ledger.untracked = totalGoldDelta - ledger.total - accrualNonCash + capitalized;
    writeCache(KEYS.pnlLedger, ledger);

    const todaySign = ledger.total > 0.0001 ? '▲ +' : ledger.total < -0.0001 ? '▼ -' : '• ';
    const todayValStr = fmtPnl(ledger.total);
    const todayColor = ledger.total > 0.0001 ? '#3fb950' : ledger.total < -0.0001 ? '#f85149' : '#8b949e';

    const yesterdayTotal = yesterday ? yesterday.total : 0;
    const yesterdaySign = yesterdayTotal > 0.0001 ? '▲ +' : yesterdayTotal < -0.0001 ? '▼ -' : '• ';
    const yesterdayValStr = fmtPnl(yesterdayTotal);

    // Apply status tint styling classes
    pnlBadge.className = 'wia-pnl-tracker';
    if (ledger.total > 0.0001) {
      pnlBadge.classList.add('is-positive');
    } else if (ledger.total < -0.0001) {
      pnlBadge.classList.add('is-negative');
    } else {
      pnlBadge.classList.add('is-neutral');
    }

    safeWritePnlUi(() => {
      // Rebuild topbar badge text while keeping hoverEl
      const hoverEl = pnlBadge.querySelector('.wia-pnl-hover');
      pnlBadge.innerHTML = '';
      if (hoverEl) {
        pnlBadge.appendChild(hoverEl);
      }

      const loc = pnlTx[getLocale()];

      const yesterdayDiv = document.createElement('div');
      yesterdayDiv.style.fontSize = '8.5px';
      yesterdayDiv.style.color = '#8b949e';
      yesterdayDiv.style.opacity = '0.7';
      yesterdayDiv.style.whiteSpace = 'nowrap';
      yesterdayDiv.textContent = `${loc.yesterday.toLowerCase()}: ${yesterdaySign}${yesterdayValStr}`;
      pnlBadge.appendChild(yesterdayDiv);

      const todayDiv = document.createElement('div');
      todayDiv.style.fontSize = '11px';
      todayDiv.style.fontWeight = 'bold';
      todayDiv.style.color = todayColor;
      todayDiv.style.whiteSpace = 'nowrap';
      todayDiv.textContent = `${loc.today.toLowerCase()}: ${todaySign}${todayValStr}`;
      pnlBadge.appendChild(todayDiv);

      if (hoverEl) {
        // Income categories
        const todaySales = ledger.income.Sales || 0;
        const yesterdaySales = yesterday ? (yesterday.income.Sales || 0) : 0;
        const todayWages = ledger.income.Wages || 0;
        const yesterdayWages = yesterday ? (yesterday.income.Wages || 0) : 0;
        const todayLoot = ledger.income.Loot || 0;
        const yesterdayLoot = yesterday ? (yesterday.income.Loot || 0) : 0;
        const todayIncOther = ledger.income.Other || 0;
        const yesterdayIncOther = yesterday ? (yesterday.income.Other || 0) : 0;

        // Expenses (pass as negative to renderPnlRow)
        const todayCons = -(ledger.expense.Consumption || 0);
        const yesterdayCons = yesterday ? -(yesterday.expense.Consumption || 0) : 0;
        const todayRep = -(ledger.expense.Repairs || 0);
        const yesterdayRep = yesterday ? -(yesterday.expense.Repairs || 0) : 0;
        const todayCases = -(ledger.expense.Cases || 0);
        const yesterdayCases = yesterday ? -(yesterday.expense.Cases || 0) : 0;
        const todayEmpWages = -(ledger.expense['Employee Wages'] || 0);
        const yesterdayEmpWages = yesterday ? -(yesterday.expense['Employee Wages'] || 0) : 0;
        const todayExpOther = -(ledger.expense.Other || 0);
        const yesterdayExpOther = yesterday ? -(yesterday.expense.Other || 0) : 0;

        const todayTotalVal = ledger.total || 0;
        const yesterdayTotalVal = yesterday ? (yesterday.total || 0) : 0;

        const todayGoldDeltaVal = ledger.goldDelta || 0;
        const yesterdayGoldDeltaVal = yesterday ? (yesterday.goldDelta || 0) : 0;

        const todayUntrackedVal = ledger.untracked || 0;
        const yesterdayUntrackedVal = yesterday ? (yesterday.untracked || 0) : 0;

        const todayCapital = -(ledger.capitalized || 0);
        const yesterdayCapital = yesterday ? -(yesterday.capitalized || 0) : 0;

        const formatRowVal = (val, est) => {
          const absVal = Math.abs(val);
          if (absVal <= 0.0001) return `<span style="color: #8b949e;">${fmtPnl(0)}</span>`;
          const sign = val > 0 ? '+' : '-';
          const color = val > 0 ? '#3fb950' : '#f85149';
          const estChar = est ? '≈' : '';
          return `<span style="color: ${color};">${estChar}${sign}${fmtPnl(val)}</span>`;
        };

        const renderPnlRow = (label, todayVal, yesterdayVal, estToday, estYesterday) => {
          return `<tr style="border-bottom: 1px dashed rgba(255, 255, 255, 0.05); text-align: right;">
            <td style="text-align: left; padding: 2px 0; color: #c9d1d9;">${label}</td>
            <td style="padding: 2px 0;">${formatRowVal(todayVal, estToday)}</td>
            <td style="padding: 2px 0; padding-left: 8px;">${formatRowVal(yesterdayVal, estYesterday)}</td>
          </tr>`;
        };

        let html = `<div style="font-weight: bold; font-size: 12px; margin-bottom: 10px; color: #58a6ff; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">`;
        html += `<span>${loc.title}</span>`;
        html += `<span style="font-size: 10px; color: #8b949e; font-weight: normal; margin-top: 2px;">${loc.resetMsg}</span>`;
        html += `</div>`;

        html += `<table style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 10px; margin-bottom: 6px;">`;
        html += `<thead>`;
        html += `<tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.15); color: #8b949e; text-align: right;">`;
        html += `<th style="text-align: left; padding-bottom: 4px; font-weight: 500; color: #8b949e;">${loc.category}</th>`;
        html += `<th style="padding-bottom: 4px; font-weight: 500; color: #8b949e;">${loc.today}</th>`;
        html += `<th style="padding-bottom: 4px; padding-left: 8px; font-weight: 500; color: #8b949e;">${loc.yesterday}</th>`;
        html += `</tr>`;
        html += `</thead>`;
        html += `<tbody>`;

        // Income Header
        html += `<tr style="color: #3fb950; font-weight: bold; font-size: 10px;"><td colspan="3" style="padding: 6px 0 2px 0; text-transform: uppercase;">${loc.income}</td></tr>`;
        html += renderPnlRow(loc.sales, todaySales, yesterdaySales, false, false);
        html += renderPnlRow(loc.wages, todayWages, yesterdayWages, false, false);
        if (todayLoot > 0 || yesterdayLoot > 0) {
          html += renderPnlRow(getLocale() === 'de' ? 'Beute-Wert' : 'Loot Value', todayLoot, yesterdayLoot, false, false);
        }
        html += renderPnlRow(loc.other, todayIncOther, yesterdayIncOther, false, false);

        // Expense Header
        html += `<tr style="color: #f85149; font-weight: bold; font-size: 10px;"><td colspan="3" style="padding: 8px 0 2px 0; text-transform: uppercase;">${loc.expense}</td></tr>`;
        html += renderPnlRow(loc.consumption, todayCons, yesterdayCons, ledger.hasEstimatedConsumption, yesterday ? yesterday.hasEstimatedConsumption : false);
        html += renderPnlRow(loc.repairs, todayRep, yesterdayRep, ledger.hasEstimatedRepairs, yesterday ? yesterday.hasEstimatedRepairs : false);
        if (todayCases < 0 || yesterdayCases < 0) {
          html += renderPnlRow(getLocale() === 'de' ? 'Kisten-Kosten' : 'Case Costs', todayCases, yesterdayCases, false, false);
        }
        html += renderPnlRow(loc.empWages, todayEmpWages, yesterdayEmpWages, false, false);
        html += renderPnlRow(loc.otherExp || loc.other, todayExpOther, yesterdayExpOther, false, false);

        const formatBold = (val) => {
          const absVal = Math.abs(val);
          if (absVal <= 0.0001) return `<span style="color: #8b949e;">${fmtPnl(0)}</span>`;
          const sign = val > 0 ? '+' : '-';
          const color = val > 0 ? '#3fb950' : '#f85149';
          return `<span style="color: ${color};">${sign}${fmtPnl(val)}</span>`;
        };

        // Separator line
        html += `<tr style="border-top: 1px solid rgba(255, 255, 255, 0.15);"><td colspan="3" style="padding: 4px 0 0 0;"></td></tr>`;

        // Capitalized purchases (gold spent on assets-not a loss)
        html += renderPnlRow(loc.capitalized, todayCapital, yesterdayCapital, false, false);

        // Untracked/Sonstiges (true residual; should be ~0 when tracking is complete)
        html += renderPnlRow(loc.untracked, todayUntrackedVal, yesterdayUntrackedVal, false, false);

        // Case Luck Row (Kisten-Glück)
        if (ledger.casesOpened) {
          const profitSign = ledger.casesProfit > 0.0001 ? '+' : '';
          const profitColor = ledger.casesProfit > 0.0001 ? '#3fb950' : ledger.casesProfit < -0.0001 ? '#f85149' : '#8b949e';
          html += `<tr style="border-top: 1px dashed rgba(255, 255, 255, 0.1); text-align: right; color: #8b949e; font-size: 9.5px;">`;
          html += `<td style="text-align: left; padding: 4px 0;">${loc.caseLuck}</td>`;
          html += `<td colspan="2" style="padding: 4px 0; color: ${profitColor};">`;
          html += `${loc.casesOpened.replace('{qty}', ledger.casesOpened)} (Gewinn/Verlust: ${profitSign}${fmtPnl(ledger.casesProfit)} Gold*)`;
          html += `</td>`;
          html += `</tr>`;
        }

        // Total P&L (Highlight)
        html += `<tr style="border-top: 1px dashed rgba(255, 255, 255, 0.15); font-weight: bold; text-align: right;">`;
        html += `<td style="text-align: left; padding: 4px 0; color: #e8eef5;">${loc.totalPnl}</td>`;
        html += `<td style="padding: 4px 0;">${formatBold(todayTotalVal)}</td>`;
        html += `<td style="padding: 4px 0; padding-left: 8px;">${formatBold(yesterdayTotalVal)}</td>`;
        html += `</tr>`;

        // Gold Delta (Highlight)
        html += `<tr style="border-top: 1px solid rgba(255, 255, 255, 0.15); font-weight: bold; text-align: right;">`;
        html += `<td style="text-align: left; padding: 4px 0; color: #58a6ff;">${loc.goldDelta}</td>`;
        html += `<td style="padding: 4px 0;">${formatBold(todayGoldDeltaVal)}</td>`;
        html += `<td style="padding: 4px 0; padding-left: 8px;">${formatBold(yesterdayGoldDeltaVal)}</td>`;
        html += `</tr>`;

        html += `</tbody>`;
        html += `</table>`;

        html += `<div style="font-size: 9px; color: #8b949e; white-space: normal; line-height: 1.3; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; font-style: italic;">`;
        html += loc.footer;
        html += `</div>`;

        hoverEl.innerHTML = html;
      }
    });
  }

  function printPnlReceipt() {
    const ledger = readCache(KEYS.pnlLedger);
    if (!ledger) {
      console.log('%c--- KEINE TAGES-P&L DATEN VORHANDEN ---', 'color: #ff7b72; font-weight: bold;');
      return;
    }

    const logs = ledger.pnlLogs || [];

    // Group logs
    const repairs = [];
    const consumptions = {};
    const wages = { count: 0, total: 0 };
    const empWages = { count: 0, total: 0 };
    const donations = [];
    const sales = [];
    const cases = [];
    const loot = [];
    const other = [];
    const capitalized = [];

    logs.forEach(log => {
      if (log.category === 'Repairs') {
        repairs.push(log);
      } else if (log.category === 'Consumption') {
        const key = log.label;
        if (!consumptions[key]) consumptions[key] = { qty: 0, cost: 0, desc: log.desc };
        consumptions[key].qty += log.qty;
        consumptions[key].cost += log.amount;
      } else if (log.category === 'Wages') {
        wages.count += log.qty || 1;
        wages.total += log.amount;
      } else if (log.category === 'Employee Wages') {
        empWages.count += log.qty || 1;
        empWages.total += log.amount;
      } else if (log.category === 'Cases') {
        cases.push(log);
      } else if (log.category === 'Loot') {
        loot.push(log);
      } else if (log.category === 'Sales') {
        sales.push(log);
      } else if (log.category === 'Capitalized') {
        capitalized.push(log);
      } else if (log.category === 'Other') {
        if (log.type === 'expense') donations.push(log);
        else other.push(log);
      }
    });

    const formatItemLabel = (lbl) => {
      if (!lbl) return 'Unbekannt';
      return lbl.replace(/^food_/, '').replace(/^pill_/, '');
    };

    const formatPayerLabel = (lbl) => {
      if (!lbl) return 'Unbekannt';
      if (/^[0-9a-fA-F]{24}$/.test(lbl)) {
        return 'Spieler/MU (' + lbl.substring(0, 6) + '...)';
      }
      return lbl;
    };

    let s = `\n%c========================================\n`;
    s += `      🧾 WAREERA P&L BELEG (HEUTE)       \n`;
    s += `========================================\n\n`;

    // 1. Einnahmen
    s += `--- EINNAHMEN ---\n`;
    let hasInc = false;
    if (sales.length > 0) {
      hasInc = true;
      const salesSum = sales.reduce((a, b) => a + b.amount, 0);
      s += `  Verkäufe: insg. +${salesSum.toFixed(2)}g\n`;
      const salesGroup = {};
      sales.forEach(sl => {
        if (!salesGroup[sl.label]) salesGroup[sl.label] = { qty: 0, amount: 0, desc: sl.desc };
        salesGroup[sl.label].qty += sl.qty || 1;
        salesGroup[sl.label].amount += sl.amount;
      });
      for (const [code, sl] of Object.entries(salesGroup)) {
        s += `    • ${formatItemLabel(code)}: ${sl.qty}x = +${sl.amount.toFixed(2)}g (${sl.desc})\n`;
      }
    }
    if (wages.total > 0) {
      hasInc = true;
      s += `  Arbeit: ${wages.count}x gearbeitet, insg. +${wages.total.toFixed(2)}g Lohn\n`;
    }
    if (loot.length > 0) {
      hasInc = true;
      const lootSum = loot.reduce((a, b) => a + b.amount, 0);
      s += `  Beute: ${loot.length}x Beute, insg. +${lootSum.toFixed(2)}g\n`;
    }
    if (other.length > 0) {
      hasInc = true;
      const otherSum = other.reduce((a, b) => a + b.amount, 0);
      s += `  Sonstiges Einnahmen: insg. +${otherSum.toFixed(2)}g\n`;
      const otherGroup = {};
      other.forEach(ot => {
        const key = ot.label + '|' + (ot.desc || '');
        if (!otherGroup[key]) {
          otherGroup[key] = { label: ot.label, qty: 0, amount: 0, desc: ot.desc };
        }
        otherGroup[key].qty += ot.qty || 1;
        otherGroup[key].amount += ot.amount;
      });
      for (const ot of Object.values(otherGroup)) {
        s += `    • ${formatPayerLabel(ot.label)}: ${ot.qty}x = +${ot.amount.toFixed(2)}g (${ot.desc})\n`;
      }
    }
    if (!hasInc) s += `  Keine Einnahmen verzeichnet\n`;

    // 2. Ausgaben
    s += `\n--- AUSGABEN ---\n`;
    let hasExp = false;
    // 2a. Verschleiß
    if (repairs.length > 0) {
      hasExp = true;
      s += `  Verschleiß:\n`;
      const repGroup = {};
      repairs.forEach(r => {
        if (!repGroup[r.label]) repGroup[r.label] = { dur: 0, cost: 0, desc: r.desc };
        repGroup[r.label].dur += r.qty;
        repGroup[r.label].cost += r.amount;
      });
      for (const [code, r] of Object.entries(repGroup)) {
        s += `    • ${formatItemLabel(code)}: -${r.dur.toFixed(1)}% Durability = -${r.cost.toFixed(2)}g (${r.desc})\n`;
      }
    }
    // 2b. Verbrauch
    if (Object.keys(consumptions).length > 0) {
      hasExp = true;
      s += `  Verbrauch:\n`;
      for (const [code, c] of Object.entries(consumptions)) {
        s += `    • ${formatItemLabel(code)}: ${c.qty}x = -${c.cost.toFixed(2)}g (${c.desc})\n`;
      }
    }
    // 2c. Mitarbeiter
    if (empWages.total > 0) {
      hasExp = true;
      s += `  Mitarbeiter-Lohn: ${empWages.count}x gezahlt, insg. -${empWages.total.toFixed(2)}g\n`;
    }
    // 2d. Kisten
    if (cases.length > 0) {
      hasExp = true;
      const casesSum = cases.reduce((a, b) => a + b.amount, 0);
      s += `  Kisten-Kosten: ${cases.length}x geöffnet, insg. -${casesSum.toFixed(2)}g\n`;
    }
    if (donations.length > 0) {
      hasExp = true;
      s += `  Spenden / Sonstige Ausgaben:\n`;
      const donationsGroup = {};
      donations.forEach(d => {
        const key = d.label + '|' + (d.desc || 'Spende');
        if (!donationsGroup[key]) {
          donationsGroup[key] = { label: d.label, qty: 0, amount: 0, desc: d.desc || 'Spende' };
        }
        donationsGroup[key].qty += d.qty || 1;
        donationsGroup[key].amount += d.amount;
      });
      for (const d of Object.values(donationsGroup)) {
        const qtyStr = d.qty > 1 ? `${d.qty}x ` : '';
        s += `    • an ${formatPayerLabel(d.label)}: ${qtyStr}-${d.amount.toFixed(2)}g (${d.desc})\n`;
      }
    }
    if (!hasExp) s += `  Keine Ausgaben verzeichnet\n`;

    // 3. Käufe (In Käufe gebunden)
    if (capitalized.length > 0) {
      const capSum = capitalized.reduce((a, b) => a + b.amount, 0);
      s += `\n--- KÄUFE (In Käufe gebunden) ---\n`;
      s += `  Einkäufe: insg. -${capSum.toFixed(2)}g\n`;
      const capGroup = {};
      capitalized.forEach(c => {
        const key = c.label;
        if (!capGroup[key]) capGroup[key] = { qty: 0, cost: 0, desc: c.desc };
        capGroup[key].qty += c.qty || 1;
        capGroup[key].cost += c.amount;
      });
      for (const [code, c] of Object.entries(capGroup)) {
        s += `    • ${formatItemLabel(code)}: ${c.qty}x = -${c.cost.toFixed(2)}g (${c.desc})\n`;
      }
    }

    // 4. Bilanz
    s += `\n========================================\n`;
    s += `  GESAMT-BILANZ (P&L): ${ledger.total > 0 ? '+' : ''}${ledger.total.toFixed(2)}g\n`;
    s += `========================================\n`;

    // 5. Abstimmung (Reconciliation) zum Gold Delta
    s += `\n--- ABSTIMMUNG ZUM GOLD DELTA ---\n`;
    s += `  Gesamt-P&L:       ${ledger.total >= 0 ? '+' : ''}${ledger.total.toFixed(2)}g\n`;
    s += `  + Verschleiß:      +${(ledger.expense.Repairs || 0).toFixed(2)}g (zahlungsunwirksam)\n`;
    s += `  + Verbrauch:       +${(ledger.expense.Consumption || 0).toFixed(2)}g (zahlungsunwirksam)\n`;
    s += `  - Käufe:          -${(ledger.capitalized || 0).toFixed(2)}g (in Käufe gebunden)\n`;
    s += `  + Unerfasst:      ${(ledger.untracked || 0) >= 0 ? '+' : ''}${(ledger.untracked || 0).toFixed(2)}g (Lücke)\n`;
    s += `  ----------------------------------------\n`;
    s += `  = Gold Delta:     ${(ledger.goldDelta || 0) >= 0 ? '+' : ''}${(ledger.goldDelta || 0).toFixed(2)}g`;

    const color = ledger.total > 0 ? '#3fb950' : ledger.total < 0 ? '#f85149' : '#8b949e';
    console.log(s, `color: ${color}; font-weight: bold; font-family: monospace; line-height: 1.4;`);
  }
  globalThis.printPnlReceipt = printPnlReceipt;

  function dumpSkinsToConsole() {
    const imgs = document.querySelectorAll('img[src*="/images/skins/"]');
    if (!imgs.length) {
      console.log('WIA SKINS DUMP: Keine Skins auf der aktuellen Seite gefunden.');
      alert('WIA SKINS DUMP: Keine Skins auf der aktuellen Seite gefunden.');
      return;
    }

    const seen = new Set();
    const rows = [];

    rows.push(
      'SKIN'.padEnd(16) +
      'SRC'.padEnd(45) +
      'AUTO-SLOT'.padEnd(12) +
      'STATUS'
    );

    imgs.forEach((img) => {
      const src = img.getAttribute('src') || '';
      const skinName = skinNameFromSrc(src);
      if (!skinName || seen.has(skinName)) return;
      seen.add(skinName);

      const slot = slotForSkin(skinName);
      const autoSlot = slot || '—';
      const status = slot ? '✓ auto' : '⚠ Tabelle';

      rows.push(
        skinName.padEnd(16) +
        src.padEnd(45) +
        autoSlot.padEnd(12) +
        status
      );
    });

    const output = rows.join('\n');
    console.log('%cWIA SKINS DUMP:\n' + output, 'font-family: monospace; font-weight: bold;');
    alert('WIA SKINS DUMP gedruckt! Bitte öffne die Browser-Konsole (F12) zum Kopieren.');
  }
  globalThis.dumpSkinsToConsole = dumpSkinsToConsole;

  function teardownPnlUi() {
    const badge = document.getElementById('wia-pnl-tracker');
    if (badge) {
      safeWritePnlUi(() => {
        badge.remove();
      });
    }
    const customRow = document.querySelector('.wia-pnl-secondary-row');
    if (customRow && customRow.childNodes.length === 0) {
      safeWritePnlUi(() => {
        customRow.remove();
      });
    }
  }

  // Bump when the ledger math/shape changes incompatibly. v2: fixed _id dedup double-count
  // + capitalized tracking. v3: fixed gold_start=0 bogus delta + cost-basis sanity guard.
  // v8: standardized case-insensitive consumable keys to fix missing prices.
  const PNL_SCHEMA_VERSION = 8;

  function migratePnlSchema() {
    const stored = Number.parseInt(GM_getValue(KEYS.pnlSchemaVersion, 0), 10) || 0;
    if (stored === PNL_SCHEMA_VERSION) return;
    // v7: cost-basis qtyKnown was inflated by the missing-dedup bug → wipe everything
    // and let the persistent-dedup + paginated fetch rebuild it clean from history.
    writeCache(KEYS.pnlLedger, null);
    writeCache(KEYS.pnlYesterday, null);
    writeCache(KEYS.pnlSnapshots, null);
    writeCache(KEYS.pnlCostBasis, null);
    writeCache(KEYS.pnlProcessedTxs, null);   // reset dedup → full re-pull rebuilds cost basis
    writeCache(KEYS.pnlBadTx, null);
    writeCache('wia_pnl_known_loot', null);   // loot-id cache
    GM_setValue(KEYS.pnlSchemaVersion, PNL_SCHEMA_VERSION);
    log('PnL: schema migrated to v' + PNL_SCHEMA_VERSION + ' (stale caches cleared)');
  }

  function initPnlTracker() {
    if (!CONFIG.featPnlTracker) {
      teardownPnlTracker();
      return;
    }
    migratePnlSchema();
    checkPnlDayReset();
    updatePnlUi();

    fetchAndProcessTransactions().then(() => {
      updatePnlUi();
    });

    if (pnlInterval) clearInterval(pnlInterval);
    pnlInterval = setInterval(() => {
      if (CONFIG.featPnlTracker) {
        checkPnlDayReset();
        attachPnlGoldObserver(); // re-attach if SPA replaced the #money node
        fetchAndProcessTransactions().then(() => {
          updatePnlUi();
        });
      }
    }, 30000);

    attachPnlGoldObserver();
  }

  // Live update: watch the gold balance (#money) for changes. ANY gold movement —
  // Work, market buy/sell, consume-mutates this text. On change we refresh the chip
  // instantly (cheap, goldDelta-only) and debounce a transaction fetch (~2.5s, to let the
  // server register the new tx) to categorize the income/expense. One observer covers all
  // money-moving actions, so we don't need a hook per button.
  const debouncedPnlTxRefresh = debounce(() => {
    if (!CONFIG.featPnlTracker) return;
    checkPnlDayReset();
    fetchAndProcessTransactions().then(() => updatePnlUi());
  }, 2500);

  function attachPnlGoldObserver() {
    const target = document.getElementById('money') ||
                   (document.getElementById('layoutUserMenu') && document.getElementById('layoutUserMenu').querySelector('#money'));
    if (!target) return; // retried on next interval tick / route change
    if (pnlGoldObserver && pnlGoldObserverTarget === target) return;
    if (pnlGoldObserver) pnlGoldObserver.disconnect();
    pnlGoldObserverTarget = target;
    pnlGoldObserver = new MutationObserver(() => {
      if (!CONFIG.featPnlTracker) return;
      updatePnlUi();              // instant: chip + live gold delta
      debouncedPnlTxRefresh();    // then categorize once the tx lands
    });
    pnlGoldObserver.observe(target, { childList: true, subtree: true, characterData: true });
  }

  function teardownPnlTracker() {
    if (pnlInterval) {
      clearInterval(pnlInterval);
      pnlInterval = null;
    }
    if (pnlGoldObserver) {
      pnlGoldObserver.disconnect();
      pnlGoldObserver = null;
      pnlGoldObserverTarget = null;
    }
    teardownPnlUi();
    setHealth('pnl', 'idle', 'disabled in settings');
  }
    function scanEquipmentDurability() {
  const cards = (globalThis.findItemCards || findItemCards)(false);
  const curByCode = {};

  cards.forEach((img, card) => {
    const { type, code } = detectItem(img, card);
    // Nur Ausrüstung (Waffen & Rüstung) erfassen
    if (['weapon', 'helmet', 'chest', 'gloves', 'pants', 'boots'].includes(type) && code) {
      const stats = parseStats(card, type);
      if (stats && stats.durability != null) {
        if (!curByCode[code]) curByCode[code] = [];
        curByCode[code].push(stats.durability);
      }
    }
  });

  // Sortieren (absteigend), damit die Zuordnung alt/neu beim Diffen stabil bleibt
  for (const c in curByCode) {
    curByCode[c].sort((a, b) => b - a);
  }

  return curByCode;
}



  // ── Bounty-Notify module ──
  function getEffectiveTopic() {
    return GM_getValue(KEYS.bountyAutoTopic, '') || 'wia-bounty-all';
  }

  const NTFY_BASE = 'https://ntfy.sh';

  function bountyKey(battleId, side, effectiveAt) {
    return `bkey_${battleId}_${side}_${Date.parse(effectiveAt)}`;
  }

  // Whole-world country map from ONE call (country.getAllCountries): id → { name,
  // code, allies, defensivePacts, allianceId }. Cached ~24h (GM + in-memory). Powers
  // both cascading ally resolution and human-readable names — no per-country fetches.
  const BOUNTY_MAP_TTL_MS = 86400000;   // 24h
  let countryMapMem = null;
  // In-flight dedup: 6+ independent call sites (order-radar, bounty identity
  // resolve, ally-code refresh, per-bounty notify) can all need the country map
  // at once before countryMapMem is warm — without this, each one races the
  // empty cache and fires its own country.getAllCountries (observed: ~70
  // concurrent calls in one burst).
  let countryMapInFlight = null;
  async function loadCountryMap() {
    if (countryMapMem) return countryMapMem;
    const cached = GM_getValue(KEYS.bountyCountryMap, null);
    if (cached && (now() - cached.at) < BOUNTY_MAP_TTL_MS && cached.map) { countryMapMem = cached.map; return countryMapMem; }
    if (countryMapInFlight) return countryMapInFlight;
    countryMapInFlight = (async () => {
      const res = await resolveApiBase('country.getAllCountries', {});
      const list = (res && res.payload) || res || [];
      const map = {};
      for (const c of list) {
        if (c && c._id) map[c._id] = {
          name: c.name || c.code || c._id, code: c.code,
          allies: c.allies || [], defensivePacts: c.defensivePacts || [], allianceId: c.allianceId || null,
        };
      }
      countryMapMem = map;
      GM_setValue(KEYS.bountyCountryMap, { at: now(), map });
      dbg('bountyNotify', 'debug', 'country map loaded', Object.keys(map).length);
      return map;
    })();
    try {
      return await countryMapInFlight;
    } finally {
      countryMapInFlight = null;
    }
  }

  async function resolveCountryName(id) {
    if (!id) return '?';
    try { const m = await loadCountryMap(); if (m[id]) return m[id].name; } catch (e) { /* fall through */ }
    return id;
  }

  const REGION_MAP_TTL_MS = 86400000;   // 24h
  let regionMapMem = null;
  async function loadRegionMap() {
    if (regionMapMem) return regionMapMem;
    const cached = GM_getValue(KEYS.regionMap, null);
    if (cached && (now() - cached.at) < REGION_MAP_TTL_MS && cached.map) { regionMapMem = cached.map; return regionMapMem; }
    try {
      const res = await resolveApiBase('region.getRegionsObject', {});
      const rawMap = (res && res.payload) || res || {};
      const map = {};
      for (const [id, r] of Object.entries(rawMap)) {
        if (r && typeof r === 'object') {
          map[id] = r.name || r.code || id;
        } else if (typeof r === 'string') {
          map[id] = r;
        }
      }
      regionMapMem = map;
      GM_setValue(KEYS.regionMap, { at: now(), map });
      return map;
    } catch (e) {
      dbg('orderRadar', 'warn', 'region map load failed', e.message);
      return {};
    }
  }

  async function resolveRegionName(id) {
    if (!id) return '?';
    try { const m = await loadRegionMap(); if (m[id]) return m[id]; } catch (e) { /* fall through */ }
    return id;
  }

  const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '0.9.3';

  function cleanHeaderValue(str) {
    if (!str) return '';
    return str
      .replaceAll('Ä', 'Ae').replaceAll('ä', 'ae')
      .replaceAll('Ö', 'Oe').replaceAll('ö', 'oe')
      .replaceAll('Ü', 'Ue').replaceAll('ü', 'ue')
      .replaceAll('ß', 'ss')
      .replace(/[^\x20-\x7E]/g, '') // Keep only printable US-ASCII characters
      .trim();
  }

  // POST to ntfy; resolves true on 2xx. Text via t()/fmt() (no hardcoded strings).
  async function sendNtfy(bounty, customTopic, labelScope) {
    const topic = customTopic || getEffectiveTopic();
    if (!topic) return false;
    const sideLabel = t(bounty.side === 'attacker' ? 'bountyAttackerSide' : 'bountyDefenderSide');
    const [attacker, defender, allyCountry] = await Promise.all([
      resolveCountryName(bounty.attackerCountry),
      resolveCountryName(bounty.defenderCountry),
      resolveCountryName(bounty.country)
    ]);
    const scope = labelScope || (customTopic ? 'all' : (CONFIG.bountyScope || 'cascade'));
    let typeLabel = '';
    if (scope === 'all') typeLabel = t('bountyLabelAll');
    else if (scope === 'allies') typeLabel = t('bountyLabelAllies');
    else typeLabel = t('bountyLabelCascade');

    const title = t('ntfyBountyTitle', { type: typeLabel, defender, attacker });
    const body = t('ntfyBountyBody', {
      allyCountry,
      side: sideLabel,
      moneyPool: fmt(bounty.moneyPool || 0),
      ratePer1k: fmt(bounty.ratePer1k || 0)
    });

    // HTTP header values must be US-ASCII (≤0x7F) in HTTP/2 / strict XHR.
    // Replace German umlauts and strip non-ASCII/Emoji to prevent network/protocol errors.
    const safeTitle = cleanHeaderValue(title);
    const headers = {
      Title: safeTitle,
      Priority: 'default',
      Tags: `crossed_swords,${bountyKey(bounty.battleId, bounty.side, bounty.effectiveAt)},v${SCRIPT_VERSION},cid_${bountyClientId()}`,
      Click: `https://app.warera.io/battle/${bounty.battleId}`
    };

    const res = await ntfyRequest('bountyNotify', {
      method: 'POST',
      url: `${NTFY_BASE}/${topic}`,
      data: body,
      headers
    });
    if (!res) return false;   // 429 / backoff active — logged inside ntfyRequest
    const ok = res.status >= 200 && res.status < 300;
    dbg('bountyNotify', ok ? 'debug' : 'error', 'ntfy send', res.status, bounty.battleId, topic);
    return ok;
  }

  // Function declaration (hoisted) so the early exposure block (~line 1996) can
  // reference it at load time without a ReferenceError.
  function testBountyPush() {
    return sendNtfy({
      battleId: '6a46743c4afd8ef24e3d2569',
      side: 'attacker',
      country: '6813b6d446e731854c7ac79c',
      attackerCountry: '6813b6d446e731854c7ac79c',
      defenderCountry: '6813b6d446e731854c7ac802',
      effectiveAt: new Date().toISOString(),
      moneyPool: 62.15,
      ratePer1k: 0.05,
    });
  }

  async function emitLocalBounty(bounty) {
    addPopupTrigger(bounty);
    await showBrowserNotif(bounty);
  }

  function testLocalBounty() {
    return emitLocalBounty({
      battleId: '6a46743c4afd8ef24e3d2569',
      side: 'attacker',
      country: '6813b6d446e731854c7ac79c',
      attackerCountry: '6813b6d446e731854c7ac79c',
      defenderCountry: '6813b6d446e731854c7ac802',
      effectiveAt: new Date().toISOString(),
      moneyPool: 62.15,
      ratePer1k: 0.05,
      regionId: 'TEST'
    });
  }

  globalThis.testBountyPush = testBountyPush;
  globalThis.testLocalBounty = testLocalBounty;
  globalThis.testPersonalPush = testPersonalPush;
  globalThis.sendNtfy = sendNtfy;
  globalThis.bountyKey = bountyKey;

  const BOUNTY_ALLY_TTL_MS = 86400000;   // 24h — allies change slowly; resolve ~once a day

  function parseSearchCountryAndAlliance(p) {
    const d = (p && p.result && p.result.data) ? p.result.data : p;
    return { countryIds: d.countryIds || [], allianceIds: d.allianceIds || [] };
  }

  // alliance.getById → memberCountries: [{ country: <id>, coreDevelopment, suspended, ... }].
  // Extract the countryId from item.country; tolerate plain-string / _id shapes too.
  function parseAllianceCountryIds(alliancePayload) {
    const p = alliancePayload || {};
    const arr = p.memberCountries || p.countries || p.countryIds || [];
    return arr.map((x) => (typeof x === 'string' ? x : (x && (x.country || x._id)))).filter(Boolean);
  }

  async function resolveAllyCountryIds(cascade = true) {
    const ckey = KEYS.bountyAllyCache + (cascade ? '_casc' : '_allies');
    const cached = GM_getValue(ckey, null);
    if (cached && (now() - cached.at) < BOUNTY_ALLY_TTL_MS && Array.isArray(cached.ids) && cached.ids.length) {
      return new Set(cached.ids);
    }
    const ids = new Set();
    try {
      const ov = (CONFIG.bountyOwnCountryOverride || '').trim();
      if (ov) {
        if (/^[a-f0-9]{24}(\s*,\s*[a-f0-9]{24})*$/i.test(ov)) {
          ov.split(',').forEach((x) => ids.add(x.trim()));
        } else {
          const s = await resolveApiBase('search.searchAnything', { searchText: ov });
          const { countryIds, allianceIds } = parseSearchCountryAndAlliance(s.payload);
          countryIds.forEach((c) => ids.add(c));
          for (const aid of allianceIds) {
            const a = await resolveApiPost('alliance.getById', { allianceId: aid });
            parseAllianceCountryIds(a.payload).forEach((c) => ids.add(c));
          }
        }
      }
      if (!ids.size) {
        const uid = getCurrentUserId();
        if (uid) {
          // Whole-world map (1 call, cached 24h) → cascading is free:
          // own country + its allies/pacts + every alliance member + each member's
          // allies/pacts. Alliance = countries sharing the same allianceId.
          const u = await resolveApiPost('user.getUserById', { userId: uid });
          const ownCountry = u.payload?.country;
          if (ownCountry) {
            const map = await loadCountryMap();
            const addCountry = (cid, addRelations = true) => {
              if (!cid) return;
              ids.add(cid);
              const c = map[cid];
              if (c && addRelations) {
                (c.defensivePacts || []).forEach((x) => ids.add(x));
              }
            };
            addCountry(ownCountry, true);
            const aid = (map[ownCountry] && map[ownCountry].allianceId) || u.payload?.alliance || u.payload?.allianceId;
            if (aid) {
              for (const cid of Object.keys(map)) {
                if (map[cid].allianceId === aid) addCountry(cid, cascade);   // member + cascade its allies/pacts
              }
            }
          }
        }
      }
    } catch (e) {
      dbg('bountyNotify', 'error', 'ally resolve failed', e.message);
      if (String(e.message).includes('apiKeyRequired')) {
        setHealth('bountyNotify', 'warn', t('apiKeyRequiredMsg'));
      }
    }
    if (ids.size) GM_setValue(ckey, { at: now(), ids: [...ids] });
    dbg('bountyNotify', 'debug', 'ally set', ids.size, [...ids]);
    return ids;
  }


  globalThis.bountyAllies = () => resolveAllyCountryIds(CONFIG.bountyScope === 'cascade').then((s) => [...s]);
  // Clears the cached ally set + country map so the next resolve re-fetches (TTL 24h).
  function bountyResetAllyCache() {
    GM_setValue(KEYS.bountyAllyCache + '_casc', null);
    GM_setValue(KEYS.bountyAllyCache + '_allies', null);
    GM_setValue(KEYS.bountyAllyCache + '_own', null);
    GM_setValue(KEYS.bountyAllyCache, null);
    GM_setValue(KEYS.bountyCountryMap, null);
    countryMapMem = null;
    return 'ally + country-map cache cleared';
  }
  globalThis.bountyResetAllyCache = bountyResetAllyCache;
  if (typeof unsafeWindow !== 'undefined' && CONFIG.debug) unsafeWindow.bountyResetAllyCache = bountyResetAllyCache;

  const BOUNTY_POLL_MS = 30000;
  const BOUNTY_PAGE_CAP = 10;
  const BOUNTY_LOCK_TTL_MS = 30000;   // must exceed a single poll step; the lock is RENEWED per step (renewPollLock)
  const BOUNTY_JITTER_MS = 10000;   // cross-device dedup: random 0–10s stagger before the topic re-check

  // Per-page-load nonce (in-memory, NOT persisted). The jitter seed is otherwise
  // (clientId + key) → identical across every TAB of the same browser, so concurrent
  // tabs of one client compute the SAME stagger, wake together, read the topic together
  // (all empty), and all send → intra-client duplicate spam. tabNonce breaks that tie:
  // each tab/page-load staggers by a different offset, so the first publish suppresses the rest.
  const tabNonce = Math.random().toString(36).slice(2, 8);

  // djb2 hash → deterministischer, stabiler Offset (kein Math.random pro Poll)
  function bhash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
  function bountyJitter(seed) { return bhash(String(seed)) % BOUNTY_JITTER_MS; }
  // stabile, zufällige Client-ID (einmalig persistiert)
  function bountyClientId() {
    let id = GM_getValue(KEYS.bountyClientId, '');
    if (!id) {
      id = ((typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
            (self.crypto && self.crypto.randomUUID && self.crypto.randomUUID()) ||
            (now().toString(36) + bhash(navigator.userAgent).toString(36)))
           .replace(/[^a-z0-9]/gi, '')
           .slice(0, 8);
      GM_setValue(KEYS.bountyClientId, id);
    }
    return id;
  }
  const POPUP_CONTAINER_ID = 'wia-bounty-popup-container';
  const BOUNTY_POPUP_COMPACT_PX = 430;   // below this viewport width → compact (variant C) layout

  function extractAllyBounties(items, allySet, ownCountry = null) {
    const out = [];
    for (const b of (items || [])) {
      const attackerCountry = b.attacker && b.attacker.country;
      const defenderCountry = b.defender && b.defender.country;
      const isUserSideInvolved = ownCountry && (attackerCountry === ownCountry || defenderCountry === ownCountry);

      for (const side of ['attacker', 'defender']) {
        const s = b[side];
        if (!s || !s.bountyEffectiveAt) continue;

        // If the user's country is involved in the battle, they can only claim bounties on their own side.
        if (isUserSideInvolved && s.country !== ownCountry) {
          continue;
        }

        if (allySet && !allySet.has(s.country)) continue;
        out.push({
          battleId: b._id,
          side,
          country: s.country,
          attackerCountry,
          defenderCountry,
          effectiveAt: s.bountyEffectiveAt,
          effectiveAtEpoch: Date.parse(s.bountyEffectiveAt),
          moneyPool: s.moneyPool,
          ratePer1k: s.moneyPer1kDamages,
          regionId: (b.defender && b.defender.region) || null,
          warId: b.war
        });
      }
    }
    return out;
  }

  function parseNtfyNdjson(text) {
    const out = [];
    for (const line of (text || '').split('\n')) {
      const s = line.trim(); if (!s) continue;
      try { out.push(JSON.parse(s)); } catch (_) { /* skip partial/blank */ }
    }
    return out;
  }

  // true/false = topic history read OK. null = UNKNOWN (429/backoff/network/non-200):
  // the caller must NOT fall back to sending — a 429 body parsed as "empty topic"
  // previously defeated dedup and re-published everything while rate-limited.
  async function topicHasBounty(key, customTopic) {
    const topic = customTopic || getEffectiveTopic();
    if (!topic) return false;
    try {
      const res = await ntfyRequest('bountyNotify', { method: 'GET', url: `${NTFY_BASE}/${topic}/json?poll=1&since=12h` });
      if (!res) return null;
      if (res.status !== 200) { dbg('bountyNotify', 'error', 'topic read failed', res.status, topic); return null; }
      return parseNtfyNdjson(res.text).some((m) => (m.tags || []).includes(key));
    } catch (e) {
      dbg('bountyNotify', 'error', 'topic read failed', e.message, topic);
      return null;
    }
  }

  function bountyEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  const POPUP_TRIGGER_KEY = 'wia-bounty-popups';
  const POPUP_MAX_AGE_MS = 600000; // 10 minutes — upper bound the persisted queue is kept
  // On (re)focus the whole queued list is replayed. Only pop bounties detected within
  // ~1 poll cycle (incl. background-throttle slack); older triggers — piled up while the
  // tab was hidden, or left over from a prior load — are stale, so consume without showing.
  const POPUP_FRESH_MS = 90000; // ~90s
  const shownPopups = new Set();

  function getPopupTriggers() {
    try {
      const list = JSON.parse(localStorage.getItem(POPUP_TRIGGER_KEY)) || [];
      const nowMs = now();
      return list.filter(item => nowMs - item.time < POPUP_MAX_AGE_MS);
    } catch (_) {
      return [];
    }
  }

  function addPopupTrigger(bounty) {
    try {
      const key = bountyKey(bounty.battleId, bounty.side, bounty.effectiveAt);
      const list = getPopupTriggers();
      if (!list.some(item => item.key === key)) {
        list.push({ key, bounty, time: now() });
        localStorage.setItem(POPUP_TRIGGER_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('wia-bounty-trigger'));
      }
    } catch (_) {}
  }

  function checkAndShowPendingPopups() {
    if (!CONFIG.featBountyNotify) return;
    if (document.visibilityState !== 'visible') return;
    const nowMs = now();
    const triggers = getPopupTriggers();
    let changed = false;
    for (const item of triggers) {
      if (shownPopups.has(item.key)) continue;
      // Stale backlog (queued while hidden / leftover from a prior load): mark it
      // consumed so it never replays, but don't pop it — the bounty is no longer live.
      if (nowMs - item.time >= POPUP_FRESH_MS) { shownPopups.add(item.key); continue; }
      shownPopups.add(item.key);
      showBountyPopup(item.bounty);
      changed = true;
    }
    if (changed) {
      try {
        localStorage.setItem(POPUP_TRIGGER_KEY, JSON.stringify(getPopupTriggers()));
      } catch (_) {}
    }
  }

  let bountyStyleInjected = false;
  function ensureBountyPopupStyle() {
    if (bountyStyleInjected) return;
    bountyStyleInjected = true;
    GM_addStyle(`
      #${POPUP_CONTAINER_ID} {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        z-index: 2147483600; display: flex; flex-direction: column-reverse;
        gap: 8px; align-items: center; pointer-events: none;
        max-width: calc(100vw - 24px);
      }
      .wia-bounty-toast {
        pointer-events: auto; cursor: pointer; position: relative;
        width: 400px; max-width: calc(100vw - 24px);
        color: #f9fafb;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: linear-gradient(180deg, #111a2e 0%, #0d1526 100%);
        border: 1px solid rgba(148,163,184,.42); border-left: 4px solid #f59e0b;
        border-radius: 10px; box-shadow: 0 10px 34px rgba(0,0,0,.5);
        padding: 12px 34px 13px 15px; animation: wia-bt-rise .22s ease-out;
      }
      .wia-bounty-toast:focus-visible { outline: 2px solid #fbbf24; outline-offset: 3px; }
      .wia-bt-close {
        position: absolute; top: 8px; right: 10px; border: 0; background: none;
        color: #6b7688; font-size: 17px; line-height: 1; cursor: pointer; padding: 2px;
      }
      .wia-bt-close:hover { color: #f9fafb; }
      .wia-bt-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .wia-bt-chip {
        font-size: 10px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
        color: #fbbf24; background: rgba(245,158,11,.14);
        border: 1px solid rgba(245,158,11,.35); padding: 2px 7px; border-radius: 4px;
      }
      .wia-bt-swords { margin-left: auto; font-size: 13px; opacity: .8; }
      .wia-bt-action { font-size: 16px; font-weight: 800; letter-spacing: -.01em; line-height: 1.2; }
      .wia-bt-ally { color: #fbbf24; }
      .wia-bt-ctx { color: #8b949e; font-size: 12.5px; margin-top: 4px; }
      .wia-bt-side { color: #f9fafb; font-weight: 600; }
      .wia-bt-stats { display: flex; gap: 20px; margin-top: 11px; padding-top: 10px; border-top: 1px solid rgba(148,163,184,.18); }
      .wia-bt-lbl { font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: #6b7688; display: block; margin-bottom: 2px; }
      .wia-bt-val { font-size: 15px; font-weight: 700; color: #f9fafb; font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, Consolas, monospace; }
      .wia-bt-val.money { color: #fbbf24; }
      .wia-bt-dot, .wia-bt-amt { display: none; }
      /* ── compact fallback (variant C) — JS adds .compact when innerWidth < 430 ── */
      .wia-bounty-toast.compact { display: flex; align-items: center; gap: 12px; width: auto; padding: 11px 34px 11px 14px; }
      .wia-bounty-toast.compact .wia-bt-head, .wia-bounty-toast.compact .wia-bt-stats { display: none; }
      .wia-bounty-toast.compact .wia-bt-dot { display: block; width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; flex: none; box-shadow: 0 0 8px #f59e0b; }
      .wia-bounty-toast.compact .wia-bt-col { min-width: 0; flex: 1; display: flex; flex-direction: column; }
      .wia-bounty-toast.compact .wia-bt-action { font-size: 14px; }
      .wia-bounty-toast.compact .wia-bt-ctx { margin-top: 2px; font-size: 12px; }
      .wia-bounty-toast.compact .wia-bt-amt { display: block; font-size: 15px; font-weight: 800; color: #fbbf24; flex: none; font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, Consolas, monospace; }
      @keyframes wia-bt-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .wia-bounty-toast { animation: none; } }
    `);
  }

  async function showBountyPopup(bounty) {
    try {
      ensureBountyPopupStyle();
      const doc = document;
      let box = doc.getElementById(POPUP_CONTAINER_ID);
      if (!box) { box = doc.createElement('div'); box.id = POPUP_CONTAINER_ID; doc.body.appendChild(box); }

      const [attacker, defender, allyCountry] = await Promise.all([
        resolveCountryName(bounty.attackerCountry),
        resolveCountryName(bounty.defenderCountry),
        resolveCountryName(bounty.country)
      ]);
      const scope = CONFIG.bountyScope || 'cascade';
      const chip = scope === 'all' ? t('bountyLabelAll') : scope === 'allies' ? t('bountyLabelAllies') : t('bountyLabelCascade');
      const sideLabel = t(bounty.side === 'attacker' ? 'bountyAttackerSide' : 'bountyDefenderSide');
      const opponent = bounty.side === 'attacker' ? defender : attacker;
      const pool = fmt(bounty.moneyPool || 0);
      const rate = fmt(bounty.ratePer1k || 0);
      const actionHtml = `${bountyEsc(t('bountyPopupAction'))} <span class="wia-bt-ally">${bountyEsc(allyCountry)}</span>`;
      const ctxText = t('bountyPopupContext', { side: sideLabel, opponent });
      const closeBtn = `<button class="wia-bt-close" aria-label="${bountyEsc(t('bountyPopupClose'))}">×</button>`;
      const compact = (PAGE_WINDOW.innerWidth || 9999) < BOUNTY_POPUP_COMPACT_PX;

      const toast = doc.createElement('div');
      toast.className = compact ? 'wia-bounty-toast compact' : 'wia-bounty-toast';
      toast.setAttribute('role', 'alert');
      toast.tabIndex = 0;
      if (compact) {
        toast.innerHTML = closeBtn +
          `<span class="wia-bt-dot" aria-hidden="true"></span>` +
          `<span class="wia-bt-col">` +
            `<span class="wia-bt-action">${actionHtml}</span>` +
            `<span class="wia-bt-ctx">${bountyEsc(ctxText)} · ${bountyEsc(rate)}/1k</span>` +
          `</span>` +
          `<span class="wia-bt-amt">${bountyEsc(pool)}</span>`;
      } else {
        toast.innerHTML = closeBtn +
          `<div class="wia-bt-head"><span class="wia-bt-chip">${bountyEsc(chip)}</span><span class="wia-bt-swords" aria-hidden="true">⚔</span></div>` +
          `<div class="wia-bt-action">${actionHtml}</div>` +
          `<div class="wia-bt-ctx">${bountyEsc(ctxText)}</div>` +
          `<div class="wia-bt-stats">` +
            `<div class="wia-bt-stat"><span class="wia-bt-lbl">${bountyEsc(t('bountyStatPool'))}</span><span class="wia-bt-val money">${bountyEsc(pool)}</span></div>` +
            `<div class="wia-bt-stat"><span class="wia-bt-lbl">${bountyEsc(t('bountyStatRate'))}</span><span class="wia-bt-val">${bountyEsc(rate)}</span></div>` +
          `</div>`;
      }

      const url = `https://app.warera.io/battle/${bounty.battleId}`;
      const dismiss = () => { if (toast.parentNode) toast.parentNode.removeChild(toast); };
      toast.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('wia-bt-close')) { dismiss(); return; }
        if (e.ctrlKey || e.metaKey || e.button === 1) {
          try { PAGE_WINDOW.open(url, '_blank'); } catch (_) {}
        } else {
          try {
            PAGE_WINDOW.location.href = url;
            dismiss();
          } catch (_) {}
        }
      });
      box.appendChild(toast);
      setTimeout(dismiss, BOUNTY_POPUP_MS);
      dbg('bountyNotify', 'debug', 'popup shown', compact ? 'compact' : 'full', bounty.battleId);
    } catch (e) { dbg('bountyNotify', 'error', 'popup failed', e.message); }
  }

  async function ensureNotifPermission() {
    try {
      const N = PAGE_WINDOW.Notification;
      if (!N) return 'unsupported';
      if (N.permission === 'default') {
        try { return await N.requestPermission(); } catch (_) { return N.permission; }
      }
      return N.permission;
    } catch (e) { dbg('bountyNotify', 'error', 'permission check failed', e.message); return 'error'; }
  }

  async function showBrowserNotif(bounty) {
    try {
      const N = PAGE_WINDOW.Notification;
      if (!N) return;
      const perm = await ensureNotifPermission();
      if (perm !== 'granted') { dbg('bountyNotify', 'debug', 'browser notif skipped', perm); return; }
      const [attacker, defender, allyCountry] = await Promise.all([
        resolveCountryName(bounty.attackerCountry),
        resolveCountryName(bounty.defenderCountry),
        resolveCountryName(bounty.country)
      ]);
      const scope = CONFIG.bountyScope || 'cascade';
      const typeLabel = scope === 'all' ? t('bountyLabelAll') : scope === 'allies' ? t('bountyLabelAllies') : t('bountyLabelCascade');
      const sideLabel = t(bounty.side === 'attacker' ? 'bountyAttackerSide' : 'bountyDefenderSide');
      const title = t('ntfyBountyTitle', { type: typeLabel, defender, attacker });
      const body = t('ntfyBountyBody', {
        allyCountry, side: sideLabel,
        moneyPool: fmt(bounty.moneyPool || 0), ratePer1k: fmt(bounty.ratePer1k || 0)
      });
      const n = new N(title, { body, tag: bountyKey(bounty.battleId, bounty.side, bounty.effectiveAt) });
      n.onclick = () => { try { PAGE_WINDOW.focus(); PAGE_WINDOW.open(`https://app.warera.io/battle/${bounty.battleId}`, '_blank'); n.close(); } catch (_) {} };
      dbg('bountyNotify', 'debug', 'browser notif shown', bounty.battleId);
    } catch (e) { dbg('bountyNotify', 'error', 'browser notif failed', e.message); }
  }

  // ── SeenStore (local dedup) ──
  const BOUNTY_SEEN_TTL_MS = 86400000;   // 24h; pure time-based prune (pagination-safe)
  const BOUNTY_POPUP_MS = 8000;   // in-game toast auto-dismiss
  let bountyColdStartDone = false;
  function loadSeen() { return GM_getValue(KEYS.bountySeen, {}) || {}; }
  function saveSeen(store) { GM_setValue(KEYS.bountySeen, store); }
  function loadLocalSeen() { return GM_getValue(KEYS.bountyLocalSeen, {}) || {}; }
  function saveLocalSeen(store) { GM_setValue(KEYS.bountyLocalSeen, store); }
  function loadMirrorSeen() { return GM_getValue(KEYS.bountyMirrorSeen, {}) || {}; }
  function saveMirrorSeen(store) { GM_setValue(KEYS.bountyMirrorSeen, store); }
  function pruneSeen(store, nowMs) {
    const out = {};
    for (const k of Object.keys(store)) if (nowMs - store[k] <= BOUNTY_SEEN_TTL_MS) out[k] = store[k];
    return out;
  }

  // The value WE wrote into bountyPollLock when we won a slot. Used so a slow tab only
  // releases/renews a lock it still owns (never clobbers a newer tab's lock).
  let activeLockVal = null;

  async function acquirePollSlot() {
    const nowMs = now();
    if (nowMs - GM_getValue(KEYS.bountyLastPollAt, 0) < BOUNTY_POLL_MS) return false;
    const lock = GM_getValue(KEYS.bountyPollLock, 0);
    if (lock && (nowMs - lock < BOUNTY_LOCK_TTL_MS)) return false;   // another tab holds a fresh lock

    // Optimistic acquisition: GM get→check→set is NOT atomic across tabs, so two tabs
    // firing at the same instant can both pass the check above. Write a value unique to
    // this tab, wait a short randomized backoff (long enough for a racing tab's own
    // synchronous write to land), then re-read: whoever's write survives owns the slot.
    const myLockVal = nowMs + Math.random();
    GM_setValue(KEYS.bountyPollLock, myLockVal);
    await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 100)));
    if (GM_getValue(KEYS.bountyPollLock, 0) !== myLockVal) {
      dbg('bountyNotify', 'debug', 'lock acquisition conflict, backing off');
      return false;
    }

    activeLockVal = myLockVal;
    // Claim the poll window UP-FRONT so the next 30s interval / another tab backs off.
    GM_setValue(KEYS.bountyLastPollAt, nowMs);
    return true;
  }

  // A poll outlives BOUNTY_LOCK_TTL_MS (10 pages × 3s throttle + feeds), so renew the lock
  // each step to keep it fresh — but only while we still own it (a stolen lock stays stolen).
  function renewPollLock() {
    if (activeLockVal != null && GM_getValue(KEYS.bountyPollLock, 0) === activeLockVal) {
      activeLockVal = now() + Math.random();
      GM_setValue(KEYS.bountyPollLock, activeLockVal);
    }
  }

  async function topicPresentKeys(topic) {
    try {
      const res = await ntfyRequest('bountyNotify', { method: 'GET', url: `${NTFY_BASE}/${topic}/json?poll=1&since=12h` });
      if (!res) return null;   // 429/backoff — null keeps the mirror loop from sending blind
      if (res.status !== 200) { dbg('bountyNotify', 'error', 'mirror readback failed', res.status, topic); return null; }
      const msgs = parseNtfyNdjson(res.text);
      const keys = new Set();
      let legacy = 0;
      for (const m of msgs) {
        const tags = m.tags || [];
        const bkey = tags.find(t => t.startsWith('bkey_'));
        if (bkey) {
          keys.add(bkey);
          const hasVersion = tags.some(t => t.startsWith('v'));
          if (!hasVersion) legacy++;
        }
      }
      return { keys, legacy };
    } catch (e) {
      dbg('bountyNotify', 'error', 'mirror readback failed', topic, e.message);
      return null;
    }
  }

  async function pollBounties() {
    if (!CONFIG.featBountyNotify || !getEffectiveTopic()) return;
    if (!(await acquirePollSlot())) return;
    try {
      const alliesSet = await resolveAllyCountryIds(false);
      const cascadeSet = await resolveAllyCountryIds(true);
      const ownCountry = await resolveOwnCountry();
      const base = GM_getValue(KEYS.bountyTopicBase, '');

      const allySet = CONFIG.bountyScope === 'all' ? null : (CONFIG.bountyScope === 'cascade' ? cascadeSet : alliesSet);
      if (allySet && !allySet.size) { setHealth('bountyNotify', 'warn', 'ally set unresolved'); return; }

      let cursor, pages = 0; const all = [];
      do {
        const args = { isActive: true, filter: 'all', limit: 100 };
        if (cursor) { args.cursor = cursor; args.direction = 'forward'; }
        // POST honours `limit` (GET/tRPC-batch ignores it → only 10/page). 100/page
        // → 10-page cap covers up to 1000 battles AND fewer round-trips = faster poll.
        const res = await resolveApiPost('battle.getBattles', args);
        const items = res.payload.items || [];
        all.push(...items);
        cursor = res.payload.nextCursor;
        pages++;
        renewPollLock();   // pagination can span ~30s; keep our lock fresh so no tab overlaps
        if (pages >= BOUNTY_PAGE_CAP && cursor) { dbg('bountyNotify', 'debug', 'page cap hit', pages); break; }
      } while (cursor);

      // Share this list so the Order-Radar can reuse it instead of making its own identical call.
      setSharedActiveBattles(all);

      const bounties = extractAllyBounties(all, allySet, ownCountry);
      const allBounties = extractAllyBounties(all, null, ownCountry);
      dbg('bountyNotify', 'debug', 'poll ok', 'battles', all.length, 'allyBounties', bounties.length);

      let seen = pruneSeen(loadSeen(), now());
      let mirrorSeen = pruneSeen(loadMirrorSeen(), now());

      if (!bountyColdStartDone) {
        // Seed existing bounties WITHOUT notifying (avoid flood on tab open).
        let localSeen = pruneSeen(loadLocalSeen(), now());
        for (const b of bounties) {
          const k = bountyKey(b.battleId, b.side, b.effectiveAt);
          seen[k] = now();
          localSeen[k] = now();
          shownPopups.add(k);
        }
        const feeds = [
          { topic: 'wia-bounty-all', set: allBounties }
        ];
        if (base) {
          feeds.push({ topic: `wia-bounty-${base}`, set: extractAllyBounties(all, alliesSet, ownCountry) });
          feeds.push({ topic: `wia-bounty-${base}-casc`, set: extractAllyBounties(all, cascadeSet, ownCountry) });
        }
        for (const feed of feeds) {
          for (const b of feed.set) {
            const mk = `${feed.topic}|${bountyKey(b.battleId, b.side, b.effectiveAt)}`;
            mirrorSeen[mk] = now();
          }
        }
        bountyColdStartDone = true;
        saveSeen(seen); saveLocalSeen(localSeen); saveMirrorSeen(mirrorSeen);
        dbg('bountyNotify', 'debug', 'cold-start seeded', bounties.length);
        setHealth('bountyNotify', 'ok', ''); return;
      }

      // Dedup within this poll too: pagination can return the same battle on
      // overlapping pages → same bounty key twice → duplicate notification.
      const seenInPoll = new Set();
      const fresh = bounties.filter((b) => {
        const k = bountyKey(b.battleId, b.side, b.effectiveAt);
        if (seen[k] || seenInPoll.has(k)) return false;
        seenInPoll.add(k);
        return true;
      });

      // Local channels (popup + browser notif) fire independently of ntfy
      // cross-device dedup and send success — own dedup store, fired up-front.
      let localSeen = pruneSeen(loadLocalSeen(), now());
      for (const b of fresh) {
        const k = bountyKey(b.battleId, b.side, b.effectiveAt);
        if (localSeen[k]) continue;
        localSeen[k] = now();
        await emitLocalBounty(b);
      }
      saveLocalSeen(localSeen);

      // Primary user push loop (only if own topic is not a feed topic)
      const isFeedTopic = (t) => t === 'wia-bounty-all' || (base && (t === `wia-bounty-${base}` || t === `wia-bounty-${base}-casc`));
      const primaryTopic = getEffectiveTopic();
      const skipPrimaryPush = isFeedTopic(primaryTopic);

      if (!skipPrimaryPush) {
        for (const b of fresh) {
          // ntfy backoff active → stop the whole push pass; unsent bounties stay
          // un-seen and go out on the first poll after the backoff expires.
          if (isNtfyLimited()) { dbg('bountyNotify', 'debug', 'primary push paused — ntfy backoff'); break; }
          const key = bountyKey(b.battleId, b.side, b.effectiveAt);
          // Cross-device dedup: GM storage is per-browser, so independent devices poll
          // in parallel and would all send. A stable, determinist jitter staggers them
          // per client; the first publish then shows up in the others' topic re-check → they skip.
          const jit = bountyJitter(bountyClientId() + '|' + tabNonce + '|' + key);
          dbg('bountyNotify', 'debug', 'jitter', jit, 'primary');
          await new Promise((r) => setTimeout(r, jit));
          renewPollLock();
          const present = await topicHasBounty(key);   // cross-client dedup
          if (present === null) break;                 // read failed/limited — never send blind
          if (present) { seen[key] = now(); continue; }
          if (await sendNtfy(b)) {
            seen[key] = now();                          // mark seen only on 2xx
          }
        }
        saveSeen(seen);
      }

      // ── Feed Mirror Loop ──
      const feeds = [
        { topic: 'wia-bounty-all', label: 'all', set: allBounties }
      ];
      if (base) {
        feeds.push({ topic: `wia-bounty-${base}`, label: 'allies', set: extractAllyBounties(all, alliesSet, ownCountry) });
        feeds.push({ topic: `wia-bounty-${base}-casc`, label: 'cascade', set: extractAllyBounties(all, cascadeSet, ownCountry) });
      }

      let mirrorChanged = false;
      for (const feed of feeds) {
        if (isNtfyLimited()) { dbg('bountyNotify', 'debug', 'mirror paused — ntfy backoff'); break; }
        const toSend = feed.set.filter(b =>
          !mirrorSeen[`${feed.topic}|${bountyKey(b.battleId, b.side, b.effectiveAt)}`]);
        if (toSend.length === 0) continue;

        // 1) ZUERST staggern, damit ein früherer Client sichtbar wird
        const seed = bountyClientId() + '|' + tabNonce + '|' + feed.topic + '|' + bountyKey(toSend[0].battleId, toSend[0].side, toSend[0].effectiveAt);
        const jit = bountyJitter(seed);
        dbg('bountyNotify', 'debug', 'jitter', jit, feed.topic);
        await new Promise((r) => setTimeout(r, jit));
        renewPollLock();

        // 2) DANN History lesen (1 GET/Feed — NICHT auf per-Item-topicHasBounty zurückbauen -> 429!)
        const present = await topicPresentKeys(feed.topic);
        if (!present) {
          setHealth('bountyNotify', 'warn', 'mirror readback failed');
          continue;
        }
        dbg('bountyNotify', 'debug', 'legacy publishers', feed.topic, present.legacy);

        for (const b of toSend) {
          if (isNtfyLimited()) break;   // a send in this batch tripped the backoff — stop, retry next poll
          const k = bountyKey(b.battleId, b.side, b.effectiveAt);
          const mk = `${feed.topic}|${k}`;
          if (mirrorSeen[mk]) continue;

          if (present.keys.has(k)) {
            mirrorSeen[mk] = now();
            mirrorChanged = true;
            dbg('bountyNotify', 'debug', 'dedup hit', feed.topic, k);
            continue;
          }

          if (await sendNtfy(b, feed.topic, feed.label)) {
            mirrorSeen[mk] = now();
            mirrorChanged = true;
            dbg('bountyNotify', 'debug', 'mirror sent', feed.topic, k);
          }
        }
      }
      if (mirrorChanged) {
        saveMirrorSeen(mirrorSeen);
      }

      setHealth('bountyNotify', 'ok', '');
    } catch (e) {
      if (String(e.message).includes('429')) { setHealth('bountyNotify', 'warn', 'rate-limited'); }
      else { setHealth('bountyNotify', 'warn', 'poll failed: ' + e.message); }
      dbg('bountyNotify', 'error', 'poll failed', e.message);
    } finally {
      GM_setValue(KEYS.bountyLastPollAt, now());
      // Release only if we still own it — a poll that overran the TTL and had its lock
      // taken over by a newer tab must NOT stomp that newer lock back to 0.
      if (activeLockVal != null && GM_getValue(KEYS.bountyPollLock, 0) === activeLockVal) {
        GM_setValue(KEYS.bountyPollLock, 0);
      }
      activeLockVal = null;
    }
  }

  globalThis.extractAllyBounties = extractAllyBounties;
  globalThis.parseNtfyNdjson = parseNtfyNdjson;

  async function resolveOwnIdentity() {
    // Last-good identity survives transient failures (429 / API hiccup / user-menu not
    // yet in the DOM). Without this, ONE failed resolve collapses the settings UI and the
    // feed base to the global "wia-bounty-all", ignoring the alliance/country the user set.
    const cachedIdentity = () => GM_getValue(KEYS.bountyIdentityCache, null);
    const uid = getCurrentUserId();
    if (!uid) return cachedIdentity();
    try {
      const u = await resolveApiPost('user.getUserById', { userId: uid });
      const ownCountry = u.payload?.country;
      if (!ownCountry) return cachedIdentity();
      const map = await loadCountryMap();
      const countryName = map[ownCountry]?.name || ownCountry;
      let allianceName = '';
      const aid = (map[ownCountry] && map[ownCountry].allianceId) || u.payload?.alliance || u.payload?.allianceId;
      if (aid) {
        const cacheKey = KEYS.bountyAllianceNameCache;
        const cache = GM_getValue(cacheKey, null);
        if (cache && cache.id === aid && (now() - cache.at) < 86400000) {
          allianceName = cache.name;
        } else {
          const a = await resolveApiPost('alliance.getById', { allianceId: aid });
          allianceName = a.payload?.name || a.payload?.code || aid;
          GM_setValue(cacheKey, { id: aid, at: now(), name: allianceName });
        }
      }

      const base = allianceName ? allianceName.toLowerCase().replace(/[^a-z0-9]/g, '')
                 : countryName ? countryName.toLowerCase().replace(/[^a-z0-9]/g, '')
                 : '';
      GM_setValue(KEYS.bountyTopicBase, base);

      // Generate dynamic auto-topic
      const scope = CONFIG.bountyScope || 'cascade';
      let tName = '';
      if (scope === 'all') {
        tName = 'all';
      } else {
        tName = base;
      }
      let autoTopic = `wia-bounty-${tName}`;
      if (scope === 'cascade' && scope !== 'all') {
        autoTopic += '-casc';
      }
      GM_setValue(KEYS.bountyAutoTopic, autoTopic);

      const identity = { countryName, allianceName, autoTopic, base };
      GM_setValue(KEYS.bountyIdentityCache, identity);
      return identity;
    } catch (e) {
      dbg('bountyNotify', 'error', 'identity resolve failed', e.message);
      if (String(e.message).includes('apiKeyRequired')) {
        setHealth('bountyNotify', 'warn', t('apiKeyRequiredMsg'));
      }
      return cachedIdentity();   // reuse last-known rather than falling back to the global feed
    }
  }

  async function refreshAlliedCodes() {
    try {
      const allyIds = await resolveAllyCountryIds(true);
      if (!allyIds || !allyIds.size) return;
      const map = await loadCountryMap();
      const codes = [];
      for (const id of allyIds) {
        if (map[id] && map[id].code) codes.push(map[id].code.toLowerCase());
      }
      if (codes.length) {
        CONFIG.alliedCountryCodes = codes;
        GM_setValue(KEYS.alliedCountryCodes, codes);
        dbg('battleAdvisor', 'debug', 'allied codes updated from bountyNotify', codes);
      }
    } catch (e) {
      dbg('battleAdvisor', 'error', 'failed to refresh allied codes', e.message);
    }
  }

  async function registerBountyTopic() {
    if (!CONFIG.featBountyNotify) return;
    const baseTopic = GM_getValue(KEYS.bountyAutoTopic, '') || 'wia-bounty-all';
    if (!baseTopic) return;
    try {
      const res = await ntfyRequest('bountyNotify', { method: 'GET', url: `${NTFY_BASE}/wia-bounty-topics/json?poll=1&since=12h` });
      // Read failed/limited → skip entirely. Posting without the readback would
      // re-register on every init while rate-limited.
      if (!res || res.status !== 200) return;
      const tagToCheck = baseTopic.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const alreadyRegistered = parseNtfyNdjson(res.text).some((m) => (m.tags || []).includes(tagToCheck));
      if (alreadyRegistered) {
        dbg('bountyNotify', 'debug', 'topic already registered on wia-bounty-topics', baseTopic);
        return;
      }
      const identity = await resolveOwnIdentity();
      if (!identity) return;
      const displayStr = identity.allianceName ? `${identity.countryName} / ${identity.allianceName}` : identity.countryName;
      const body = `Topic: ${baseTopic}\nRegistriert von: ${displayStr}\nZeit: ${new Date().toISOString()}`;

      const postRes = await ntfyRequest('bountyNotify', {
        method: 'POST',
        url: `${NTFY_BASE}/wia-bounty-topics`,
        data: body,
        headers: {
          Title: 'Bounty Topic Aktivierung',
          Priority: 'min',
          Tags: `crossed_swords,${tagToCheck}`
        }
      });
      if (postRes) dbg('bountyNotify', 'debug', 'registered topic on wia-bounty-topics', baseTopic);
    } catch (e) {
      dbg('bountyNotify', 'error', 'failed to register topic on wia-bounty-topics', e.message);
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === POPUP_TRIGGER_KEY) {
        checkAndShowPendingPopups();
      }
    });
    window.addEventListener('wia-bounty-trigger', () => {
      checkAndShowPendingPopups();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkAndShowPendingPopups();
      }
    });
  }

  // Simple DJB2 string hashing function
  function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  let activeMirrorLockVal = null;
  let hasLoggedMuteDebuffWarning = false;
  // ntfy.sh free-tier budget: ~60-request burst, then ~1 request per 5s refill
  // per IP (plus 250 published msgs/day). A 3s GET poll alone (20/min) outruns
  // the refill (12/min) → guaranteed 429s within minutes → IP ban when ignored.
  // 10s (6/min) leaves headroom for the 30s scanner reads and the publishes.
  const BOUNTY_MIRROR_POLL_MS = 10000;
  const BOUNTY_MIRROR_LOCK_TTL_MS = 1500;

  async function acquireMirrorPollSlot() {
    const nowMs = now();
    if (nowMs - GM_getValue(KEYS.bountyMirrorLastPollAt, 0) < BOUNTY_MIRROR_POLL_MS) return false;
    const lock = GM_getValue(KEYS.bountyMirrorPollLock, 0);
    if (lock && (nowMs - lock < BOUNTY_MIRROR_LOCK_TTL_MS)) return false;

    const myLockVal = nowMs + Math.random();
    GM_setValue(KEYS.bountyMirrorPollLock, myLockVal);
    await new Promise((r) => setTimeout(r, 30 + Math.floor(Math.random() * 50)));
    if (GM_getValue(KEYS.bountyMirrorPollLock, 0) !== myLockVal) {
      return false;
    }

    activeMirrorLockVal = myLockVal;
    GM_setValue(KEYS.bountyMirrorLastPollAt, nowMs);
    return true;
  }

  async function pollBountyTopic() {
    if (!CONFIG.featBountyNotify || !CONFIG.featBountyNotif) return;
    // Mute the personal-topic mirror while in pill-debuff (opt-in). pillState is
    // only refreshed by the Pill Reminder tick, so mute cannot engage without it —
    // surface that misconfig on the ampel instead of failing silently.
    if (CONFIG.bountyMuteDebuff) {
      if (!CONFIG.featPillReminder) {
        if (!hasLoggedMuteDebuffWarning) {
          dbg('bountyNotify', 'warn', 'mute-in-debuff on but Pill Reminder off — pill state undetectable, mute inactive');
          hasLoggedMuteDebuffWarning = true;
        }
        setHealth('bountyNotify', 'warn', 'mute needs Pill Reminder on');
      } else {
        hasLoggedMuteDebuffWarning = false;
        if (GM_getValue(KEYS.pillState, 'none') === 'DEBUFF') {
          dbg('bountyNotify', 'debug', 'mirror muted — debuff active');
          setHealth('bountyNotify', 'ok', 'mirror muted (debuff)');
          return;
        }
      }
    }
    const bountyTopic = getEffectiveTopic();
    if (!bountyTopic) return;
    const personalTopic = getEffectivePersonalTopic();
    if (!personalTopic || bountyTopic === personalTopic) return;

    // Skip before lock churn: during an ntfy backoff this tick fires every 3s
    // and must stay completely silent (no GM writes, no requests).
    if (isNtfyLimited()) return;

    if (!(await acquireMirrorPollSlot())) return;

    try {
      const res = await ntfyRequest('bountyNotify', {
        method: 'GET',
        url: `${NTFY_BASE}/${bountyTopic}/json?poll=1&since=60s`
      });
      if (!res) return;   // 429/backoff — logged inside ntfyRequest
      if (res.status !== 200) { dbg('bountyNotify', 'error', 'mirror source read failed', res.status); return; }
      const msgs = parseNtfyNdjson(res.text);
      if (!msgs.length) return;

      const alliesSet = await resolveAllyCountryIds(false);
      const cascadeSet = await resolveAllyCountryIds(true);
      const targetSet = CONFIG.bountyScope === 'all' ? null : (CONFIG.bountyScope === 'cascade' ? cascadeSet : alliesSet);

      // Dedup keyed by bkey (unique per bounty), time-pruned like the scanner's seen
      // store. A fixed cap-N array thrashed on busy feeds: a bkey's slot was evicted
      // by newer distinct bounties before its own duplicates (re-published every ~3s
      // poll within the since=30s window) stopped arriving → same bounty re-forwarded.
      let mirrorSeen = GM_getValue(KEYS.bountyMirrorProcessedHashes, {});
      if (!mirrorSeen || typeof mirrorSeen !== 'object' || Array.isArray(mirrorSeen)) mirrorSeen = {};
      mirrorSeen = pruneSeen(mirrorSeen, now());

      for (const m of msgs) {
        if (m.event !== 'message') continue;
        const title = m.title || '';
        const body = m.message || '';
        const tags = m.tags || [];

        if (!tags.includes('crossed_swords')) continue;
        const bkey = tags.find(t => t.startsWith('bkey_'));
        if (!bkey) continue;
        if (!title.includes(': ') || !title.includes(' vs ')) continue;
        const hasTopfOrPool = body.includes('Topf') || body.includes('Pool');
        const hasRateSuffix = /[\d.,]+\/1k/.test(body);
        const hasAction = body.includes('Kämpfe für') || body.includes('Fight for');
        if (!hasTopfOrPool || !hasRateSuffix || !hasAction) continue;

        if (mirrorSeen[bkey]) continue;

        if (targetSet) {
          let allyCountryName = '';
          const deMatch = body.match(/(?:Kämpfe für)\s+([^(]+)\s+\(/i);
          const enMatch = body.match(/(?:Fight for)\s+([^(]+)\s+\(/i);
          const match = deMatch || enMatch;
          if (match) {
            allyCountryName = match[1].trim();
          }

          if (allyCountryName) {
            const map = await loadCountryMap();
            let countryMatched = false;
            for (const cid of targetSet) {
              const cName = map[cid]?.name;
              const cCode = map[cid]?.code;
              if (
                (cName && cName.toLowerCase() === allyCountryName.toLowerCase()) ||
                (cCode && cCode.toLowerCase() === allyCountryName.toLowerCase())
              ) {
                countryMatched = true;
                break;
              }
            }
            if (!countryMatched) {
              dbg('bountyNotify', 'debug', `mirrored bounty filtered out (country not in scope: ${allyCountryName})`);
              continue;
            }
          } else {
            dbg('bountyNotify', 'debug', 'failed to parse country name from bounty body', body);
            continue;
          }
        }

        const safeTitle = cleanHeaderValue(title);
        const headers = {
          Title: safeTitle,
          Priority: m.priority || 'default',
          Tags: tags.filter(t => !t.startsWith('cid_')).join(','),
        };
        if (m.click) headers.Click = m.click;

        const mirrorRes = await ntfyRequest('bountyNotify', {
          method: 'POST',
          url: `${NTFY_BASE}/${personalTopic}`,
          data: body,
          headers
        });

        // 429/backoff: bkey stays unmarked → re-forwarded after the backoff (if
        // still inside the poll window). Stop the batch — more sends now = ban risk.
        if (!mirrorRes) break;
        if (mirrorRes.status >= 200 && mirrorRes.status < 300) {
          dbg('bountyNotify', 'debug', `mirrored bounty to personal topic: ${bkey}`);
          mirrorSeen[bkey] = now();
          GM_setValue(KEYS.bountyMirrorProcessedHashes, mirrorSeen);
        } else {
          dbg('bountyNotify', 'error', `failed to mirror bounty: ${mirrorRes.status}`);
        }
      }
    } catch (e) {
      dbg('bountyNotify', 'error', 'mirror poll/push failed', e.message);
    }
  }

  let bountyInterval = null;
  let bountyMirrorInterval = null;
  function initBountyNotify() {
    regFeature('bountyNotify', 'Bounty-Push');
    if (bountyInterval) clearInterval(bountyInterval);
    bountyInterval = setInterval(() => { guard('bountyNotify', pollBounties); }, BOUNTY_POLL_MS);
    guard('bountyNotify', pollBounties);
    guard('bountyNotify', registerBountyTopic);

    if (bountyMirrorInterval) clearInterval(bountyMirrorInterval);
    if (CONFIG.featBountyNotif) {
      bountyMirrorInterval = setInterval(() => { guard('bountyNotify', pollBountyTopic); }, 3000);
      guard('bountyNotify', pollBountyTopic);
    }
  }
  function teardownBountyNotify() {
    if (bountyInterval) { clearInterval(bountyInterval); bountyInterval = null; }
    if (bountyMirrorInterval) { clearInterval(bountyMirrorInterval); bountyMirrorInterval = null; }
    bountyColdStartDone = false;
    setHealth('bountyNotify', 'idle', 'disabled in settings');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // System Alert Channel (Phase 8)
  // ───────────────────────────────────────────────────────────────────────────
  const SYSTEM_ALERT_PUBKEYS = [
    { kid: 'beertierchen', raw: Uint8Array.from([130, 239, 19, 17, 133, 184, 47, 43, 163, 116, 51, 240, 240, 97, 231, 240, 172, 141, 119, 233, 233, 75, 7, 110, 65, 42, 222, 213, 13, 98, 254, 126]) }
  ];

  function base64ToBytes(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  let isCryptoWarnLogged = false;

  async function verifySystemAlertMsg(env) {
    if (!env || typeof env.payload !== 'string' || !env.sig) return false;
    // Check freshness (<48h) and clock skew/future bounds (>60s)
    if (typeof env.ts !== 'number' || Date.now() - env.ts > 48 * 3600 * 1000 || Date.now() - env.ts < -60000) return false;

    // Per-kid monotonic sequence verification and migration
    let seenDict = GM_getValue(KEYS.systemAlertSeenSeq, {});
    if (typeof seenDict === 'number') {
      seenDict = { beertierchen: seenDict };
      GM_setValue(KEYS.systemAlertSeenSeq, seenDict);
    } else if (typeof seenDict !== 'object' || seenDict === null) {
      seenDict = {};
    }

    const kid = env.kid || 'beertierchen';
    const seen = seenDict[kid] || 0;
    if (typeof env.seq !== 'number' || env.seq <= seen) return false;

    if (typeof crypto === 'undefined' || !crypto.subtle) {
      if (!isCryptoWarnLogged) {
        dbg('api', 'warn', 'Ed25519 signatures not supported (subtle crypto missing)');
        isCryptoWarnLogged = true;
      }
      return false;
    }

    try {
      const data = new TextEncoder().encode(`${env.payload}|${env.ts}|${env.seq}|${kid}`);
      const sigBytes = base64ToBytes(env.sig);
      const candidates = env.kid ? SYSTEM_ALERT_PUBKEYS.filter(k => k.kid === env.kid).concat(SYSTEM_ALERT_PUBKEYS) : SYSTEM_ALERT_PUBKEYS;
      for (const k of candidates) {
        try {
          const key = await crypto.subtle.importKey(
            'raw',
            k.raw,
            { name: 'Ed25519' },
            false,
            ['verify']
          );
          const valid = await crypto.subtle.verify('Ed25519', key, sigBytes, data);
          if (valid) {
            seenDict[kid] = env.seq;
            GM_setValue(KEYS.systemAlertSeenSeq, seenDict);
            return true;
          }
        } catch (e) {
          if (!isCryptoWarnLogged) {
            dbg('api', 'warn', 'Ed25519 signature verification not supported in this browser: ' + e.message);
            isCryptoWarnLogged = true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  let activeSystemAlertLockVal = null;
  const SYSTEM_ALERT_POLL_MS = 60000;
  const SYSTEM_ALERT_LOCK_TTL_MS = 1500;

  async function acquireSystemAlertPollSlot() {
    const nowMs = now();
    const isBackground = typeof document !== 'undefined' && document.hidden === true;
    const pollInterval = isBackground ? 10 * 60 * 1000 : SYSTEM_ALERT_POLL_MS;
    if (nowMs - GM_getValue(KEYS.systemAlertLastPollAt, 0) < pollInterval) return false;
    const lock = GM_getValue(KEYS.systemAlertPollLock, 0);
    if (lock && (nowMs - lock < SYSTEM_ALERT_LOCK_TTL_MS)) return false;

    const myLockVal = nowMs + Math.random();
    GM_setValue(KEYS.systemAlertPollLock, myLockVal);
    await new Promise((r) => setTimeout(r, 30 + Math.floor(Math.random() * 50)));
    if (GM_getValue(KEYS.systemAlertPollLock, 0) !== myLockVal) {
      return false;
    }

    activeSystemAlertLockVal = myLockVal;
    GM_setValue(KEYS.systemAlertLastPollAt, nowMs);
    return true;
  }

  async function pollSystemAlertTopic() {
    if (!CONFIG.featSystemAlerts) return;
    if (isNtfyLimited()) return;
    if (!(await acquireSystemAlertPollSlot())) return;
    try {
      const res = await ntfyRequest('api', {
        method: 'GET',
        url: `${NTFY_BASE}/bumblebee-goodboy/json?poll=1&since=48h`
      });
      if (!res) return;
      if (res.status !== 200) { dbg('api', 'error', 'system alert topic read failed', res.status); return; }
      const msgs = parseNtfyNdjson(res.text);
      if (!msgs.length) return;
      for (const msg of msgs) {
        if (!msg.message) continue;
        try {
          const env = JSON.parse(msg.message);
          const valid = await verifySystemAlertMsg(env);
          if (valid) {
            showLocalPersonalPopup('system', 'SYSTEM ALERT', env.payload, '⚠️', true);
            if (CONFIG.featBountyNotify && CONFIG.featBountyNotif) {
              const personalTopic = getEffectivePersonalTopic();
              if (personalTopic) {
                await ntfyRequest('bountyNotify', {
                  method: 'POST',
                  url: `${NTFY_BASE}/${personalTopic}`,
                  data: env.payload,
                  headers: {
                    Title: 'PROST System Alert',
                    Priority: 'high',
                    Tags: 'warning,exclamation'
                  }
                });
              }
            }
          }
        } catch (e) {
          // Ignore invalid signature / parse errors
        }
      }
    } catch (e) {
      dbg('api', 'error', 'system alert poll failed', e.message);
    }
  }

  let systemAlertsInterval = null;
  function initSystemAlerts() {
    if (systemAlertsInterval) clearInterval(systemAlertsInterval);
    if (CONFIG.featSystemAlerts) {
      systemAlertsInterval = setInterval(() => { guard('api', pollSystemAlertTopic); }, 5000); // Check lock/timestamp every 5s
      guard('api', pollSystemAlertTopic);
    }
  }
  function teardownSystemAlerts() {
    if (systemAlertsInterval) { clearInterval(systemAlertsInterval); systemAlertsInterval = null; }
  }

  function start() {
    log('initializing PROST v' + SCRIPT_VERSION);
    console.log('[PROST:core] initializing PROST v' + SCRIPT_VERSION);
    if (typeof sessionStorage !== 'undefined') {
      if (sessionStorage.getItem('wia-update-pending') === 'true') {
        sessionStorage.removeItem('wia-update-pending');
      }
    }
    if (typeof window !== 'undefined') {
      const handleReloadOnFocus = () => {
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('wia-update-pending') === 'true') {
          sessionStorage.removeItem('wia-update-pending');
          window.location.reload();
        }
      };
      window.addEventListener('focus', handleReloadOnFocus);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            handleReloadOnFocus();
          }
        });
      }
    }

    migrateTransactionsCache();
    // One-time migration to clear stale gated procedures from keyless bug
    if (!GM_getValue(KEYS.gatedResetV090, false)) {
      GM_setValue(KEYS.gatedProcedures, []);
      GM_setValue(KEYS.gatedResetV090, true);
    }
    if (!GM_getValue(KEYS.apiBaseGatewayMigrated, false)) {
      GM_setValue(KEYS.apiBase, null);
      GM_setValue(KEYS.apiBaseGatewayMigrated, true);
    }
    CONFIG.debug = GM_getValue(KEYS.debug, false);
    if (typeof location !== 'undefined' && /(?:^|[#&])wia-debug/.test(location.hash)) CONFIG.debug = true;
    // Register all features so the registry/HUD knows about them up front.
    regFeature('scratchpad', 'Scratchpad');
    regFeature('advisor', 'Item Advisor');
    regFeature('craftAdvisor', 'Crafting Advisor');
    regFeature('pnl', 'P&L Tracker');
    regFeature('marketGraph', 'Market Graph');
    regFeature('battleAdvisor', 'Battle Advisor');
    regFeature('orderRadar', 'Order-Radar');
    regFeature('pillReminder', 'Pill Reminder');
    regFeature('muHealDim', 'MU Heal Dim');
    regFeature('notes', 'User Notes');
    regFeature('api', 'API Layer');
    // bountyNotify is registered earlier in init
    regFeature('tour', 'Tour of Beers');
    regFeature('companyEco', 'Company Economy');
    regFeature('companyAlerts', 'Company Alerts');
    regFeature('companyProfit', 'Company Profit');
    regFeature('companyEnergy', 'Company Energy');
    regFeature('wageMedian', 'Wage Median Sparkline');
    regFeature('troopRadar', 'Troop Radar');
    regFeature('profileCharsheet', 'Profile Charsheet');
    regFeature('equipSellCalc', 'Equip. Sell Calc.');
    // one-shot onboarding prompt, once the game shell (avatar) is present
    (function scheduleTourPrompt() {
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (document.querySelector('#avatar')) { clearInterval(iv); maybeShowTourPrompt(); }
        else if (tries > 40) { clearInterval(iv); }   // ~10s give-up
      }, 250);
    })();
    CONFIG.locale = GM_getValue(KEYS.locale, CONFIG.locale || 'de') || 'de';
    if (typeof window !== 'undefined') {
      window.__WIA_LOCALE__ = CONFIG.locale;
    }
    CONFIG.stockKeepCount = Number.parseInt(GM_getValue(KEYS.stockKeepCount, 3), 10) || 3;
    CONFIG.featPnlTracker = GM_getValue(KEYS.featPnlTracker, false);
    CONFIG.featScratchpad = GM_getValue(KEYS.featScratchpad, false);
    CONFIG.featNotes = GM_getValue(KEYS.featNotes, false);
    CONFIG.featBattleAdvisor = GM_getValue(KEYS.featBattleAdvisor, false);
    CONFIG.featOrderRadar = GM_getValue(KEYS.featOrderRadar, true);
    CONFIG.featTroopRadar = GM_getValue(KEYS.featTroopRadar, true);
    CONFIG.featProfileCharsheet = GM_getValue(KEYS.featProfileCharsheet, true);
    CONFIG.alliedCountryCodes = GM_getValue(KEYS.alliedCountryCodes, CONFIG.alliedCountryCodes);
    CONFIG.featPillReminder = GM_getValue(KEYS.featPillReminder, false);
    CONFIG.featPillNotifHnH = GM_getValue(KEYS.featPillNotifHnH, false);
    CONFIG.featPillNotifWindow = GM_getValue(KEYS.featPillNotifWindow, false);
    CONFIG.featPillNotifDebuff = GM_getValue(KEYS.featPillNotifDebuff, false);
    CONFIG.featMuHealDim = GM_getValue(KEYS.featMuHealDim, false);
    CONFIG.featBountyNotify = GM_getValue(KEYS.featBountyNotify, CONFIG.featBountyNotify);
    CONFIG.featBountyNotif = GM_getValue(KEYS.featBountyNotif, false);
    CONFIG.bountyMuteDebuff = GM_getValue(KEYS.bountyMuteDebuff, false);
    CONFIG.ntfyTopic = GM_getValue(KEYS.ntfyTopic, CONFIG.ntfyTopic);
    CONFIG.ntfyTopicSecret = GM_getValue(KEYS.ntfyTopicSecret, CONFIG.ntfyTopicSecret);
    CONFIG.personalTopic = GM_getValue(KEYS.personalTopic, '');
    CONFIG.personalTopicSecret = GM_getValue(KEYS.personalTopicSecret, '');
    CONFIG.bountyOwnCountryOverride = GM_getValue(KEYS.bountyOwnCountryOverride, CONFIG.bountyOwnCountryOverride);
    CONFIG.bountyScope = GM_getValue(KEYS.bountyScope, CONFIG.bountyScope || 'cascade') || 'cascade';
    CONFIG.featMarketGraph = GM_getValue(KEYS.featMarketGraph, false);
    CONFIG.featPnlTracker = GM_getValue(KEYS.featPnlTracker, false);
    CONFIG.featItemAdvisor = GM_getValue(KEYS.featItemAdvisor, true);
    CONFIG.featCraftingAdvisor = GM_getValue(KEYS.featCraftingAdvisor, true);
    CONFIG.featEquipSellCalc = GM_getValue(KEYS.featEquipSellCalc, false);
    CONFIG.featCompanyEco = GM_getValue(KEYS.featCompanyEco, true);
    CONFIG.featAlertCompanyStorage = GM_getValue(KEYS.featAlertCompanyStorage, true);
    CONFIG.featAlertCompanyBonus = GM_getValue(KEYS.featAlertCompanyBonus, true);
    CONFIG.featAlertCompanyTax = GM_getValue(KEYS.featAlertCompanyTax, true);
    CONFIG.featAlertCompanyDeposit = GM_getValue(KEYS.featAlertCompanyDeposit, true);
    CONFIG.featBetterRegion = GM_getValue(KEYS.featBetterRegion, true);
    CONFIG.featSystemAlerts = GM_getValue(KEYS.featSystemAlerts, true);
    CONFIG.pillBuffH = GM_getValue(KEYS.pillBuffH, CONFIG.pillBuffH);
    CONFIG.pillKnifeH = GM_getValue(KEYS.pillKnifeH, CONFIG.pillKnifeH);
    CONFIG.pillDebuffH = GM_getValue(KEYS.pillDebuffH, CONFIG.pillDebuffH);
    CONFIG.pillPrefWindowFrom = GM_getValue(KEYS.pillPrefWindowFrom, CONFIG.pillPrefWindowFrom);
    CONFIG.pillPrefWindowTo = GM_getValue(KEYS.pillPrefWindowTo, CONFIG.pillPrefWindowTo);
    injectStyles();
    // Each entrypoint guarded → a crash in one feature can't abort the rest of start().
    if (CONFIG.featScratchpad) guard('scratchpad', initScratchpad); else setHealth('scratchpad', 'idle', 'disabled in settings');
    if (CONFIG.featNotes) guard('notes', initNotes); else setHealth('notes', 'idle', 'disabled in settings');
    if (CONFIG.featBattleAdvisor) {
      guard('battleAdvisor', refreshAlliedCodes);
      if (isBattlePage()) {
        guard('battleAdvisor', applyBattleAdvisory);
        initSharedBodyObserver();
      }
      else setHealth('battleAdvisor', 'idle', 'not on battle page');
    } else setHealth('battleAdvisor', 'idle', 'disabled in settings');
    if (CONFIG.featBattleAdvisor && CONFIG.featOrderRadar) {
      if (isCountryPage() || isMuPage()) {
        guard('orderRadar', applyOrderRadar);
        initSharedBodyObserver();
      } else setHealth('orderRadar', 'idle', 'not on country or MU page');
    } else setHealth('orderRadar', 'idle', 'disabled in settings');
    if (CONFIG.featTroopRadar) {
      if (isMuPage()) {
        guard('troopRadar', applyTroopRadar);
        initSharedBodyObserver();
      } else setHealth('troopRadar', 'idle', 'not on MU page');
    } else setHealth('troopRadar', 'idle', 'disabled in settings');
    if (CONFIG.featProfileCharsheet) {
      if (isUserProfilePage()) {
        guard('profileCharsheet', applyProfileCharsheet);
        initSharedBodyObserver();
      } else setHealth('profileCharsheet', 'idle', 'not on profile page');
    } else setHealth('profileCharsheet', 'idle', 'disabled in settings');
    if (CONFIG.featPillReminder) guard('pillReminder', initPillReminder); else setHealth('pillReminder', 'idle', 'disabled in settings');
    if (CONFIG.featMuHealDim) applyMuHealDimSoon(); else setHealth('muHealDim', 'idle', 'disabled in settings');
    if (CONFIG.featMarketGraph) guard('marketGraph', initMarketGraph); else setHealth('marketGraph', 'idle', 'disabled in settings');
    if (CONFIG.featPnlTracker) guard('pnl', initPnlTracker); else setHealth('pnl', 'idle', 'disabled in settings');
    if (CONFIG.featEquipSellCalc) guard('equipSellCalc', initEquipSellCalc); else setHealth('equipSellCalc', 'idle', 'disabled in settings');
    if (CONFIG.featBountyNotify) guard('bountyNotify', initBountyNotify); else setHealth('bountyNotify', 'idle', 'disabled in settings');
    if (CONFIG.featAlertCompanyStorage || CONFIG.featAlertCompanyBonus || CONFIG.featAlertCompanyTax || CONFIG.featAlertCompanyDeposit || CONFIG.featBetterRegion) guard('companyTracking', initCompanyTracking); else setHealth('companyTracking', 'idle', 'disabled in settings');
    if (CONFIG.featSystemAlerts) initSystemAlerts();
    injectGear();
    refreshMenuCommands();
    checkForUpdates(false);
    initMarketTax();
    if (CONFIG.debug) { setTimeout(() => { runProbes(); updateDebugHud(); }, 1500); }

    observer = new MutationObserver(() => triggerScan(false));
    if (isInventoryPage()) {
      updateObserverTarget();
      if (CONFIG.featItemAdvisor) {
        guard('advisor', () => scanInventory(false));
        startRoutePolling();
      } else {
        setHealth('advisor', 'idle', 'disabled in settings');
      }
    }

    // Intercept pushState / replaceState for instant route detection in Next.js SPA
    const fireRoute = debounce(handleRouteChange, 15);

    for (const m of ['pushState', 'replaceState']) {
      const pageHistory = PAGE_WINDOW && PAGE_WINDOW.history;
      const orig = pageHistory && pageHistory[m];
      if (orig) {
        pageHistory[m] = function (...a) {
          const r = orig.apply(this, a);
          fireRoute();
          return r;
        };
      }
    }
    (PAGE_WINDOW || window).addEventListener('popstate', fireRoute);

    // Fallback interval check
    setInterval(handleRouteChange, 2000);

    // Advisor self-heal heartbeat: if the grid re-rendered (new nodes / stripped badges)
    // and nothing re-triggered a scan, re-attach the observer and rescan. hasInventoryChanged
    // returns true after an in-place re-render (node identity differs, or a card lacks both
    // a badge and the suppressed marker-see 2884) and false when everything is already
    // badged/suppressed, so this is a no-op cost when the grid is stable.
    setInterval(() => {
      if (scanning) return;
      if (!isInventoryPage()) return;
      if (loopGuard('advisor-heartbeat', 25, 15000)) return;
      const cards = findItemCards();
      if (cards.size > 0 && hasInventoryChanged(cards)) {
        log('Advisor heartbeat: grid changed without rescan → re-attach + rescan [reason: ' + lastHicReason + ']');
        updateObserverTarget();      // revive observer in case its root went stale
        guard('advisor', () => triggerScan(false));
      }
    }, 4000);

    // Trigger crafting advisor check once on startup if the modal is open
    if (CONFIG.featCraftingAdvisor) {
      guard('craftAdvisor', triggerCraftingAdvisorCheck);
    } else {
      setHealth('craftAdvisor', 'idle', 'disabled in settings');
    }
    if (CONFIG.featCompanyEco) {
      if (getPagePathname().startsWith('/companies') || /^\/user\/[0-9a-zA-Z_-]+\/companies\/?$/.test(getPagePathname())) {
         guard('companyEco', initCompanyEco);
         initSharedBodyObserver();
      } else {
         guard('companyEco', teardownCompanyEco);
         setHealth('companyEco', 'idle', 'not on companies or user page');
      }
    } else {
      setHealth('companyEco', 'idle', 'disabled in settings');
    }
  }

  start();
})();
