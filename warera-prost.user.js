// ==UserScript==
// @name         PROST
// @namespace    https://github.com/beertierchen/warera-prost
// @version      0.9.3
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
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
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
    featNotes: false,                    // experimental: user notes on /user/ links (off by default)
    featBattleAdvisor: false,            // experimental: highlight ally button on /battle/<id> pages
    featSystemAlerts: true,               // receive signed system alerts
    alliedCountryCodes: ['de','pt','es','gm','ir','na','sr','th','at','fi','ie','no','se','uk','va','bf','cd','ye','ne','au','br','id'],
    featMarketGraph: false,
    featTour: true,                      // interactive API-token onboarding overlay (issue #50)
    featPnlTracker: false,
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
    // market-value icon (inline SVG, coin stack). Scrap uses the 🔨 emoji.
    marketIconSvg: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" style="filter:drop-shadow(1px 1px 0 #000)"><path d="M12 5C7.031 5 2 6.546 2 9.5S7.031 14 12 14c4.97 0 10-1.546 10-4.5S16.97 5 12 5zm-5 9.938v3c1.237.299 2.605.482 4 .541v-3a21.166 21.166 0 0 1-4-.541zm6 .54v3a20.994 20.994 0 0 0 4-.541v-3a20.994 20.994 0 0 1-4 .541zm6-1.181v3c1.801-.755 3-1.857 3-3.297v-3c0 1.44-1.199 2.542-3 3.297zm-14 3v-3C3.2 13.542 2 12.439 2 11v3c0 1.439 1.2 2.542 3 3.297z"/></svg>',

    // Market tax rate when selling items
    sellTaxRate: 0.01,

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
        settingsFeatNotesCheckbox: 'User notes on player links 📒 (experimental)',
        settingsFeatNotesHint: 'Adds a note icon next to player links. Disable if the standalone Warera User Notes script is also active.',
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
        tourPaste: 'Paste from clipboard',
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
        tourStep7Body: 'Paste your token here and click Save. That’s it — Prost! 🍻',
        tokenStorageUpgraded: 'API key storage was upgraded — please re-enter your API key in Settings. API features stay off until you re-enter it.',
        tokenStorageUpgradedTitle: 'API key upgraded',
        apiKeyRequiredMsg: 'This feature needs your API key (Settings).',
        apiKeyRequiredSuffix: 'needs key',
        hintToggleLabel: 'Explanation',
        settingsFeatPillCheckbox: 'Pill Reminder (configurable pill-timing overlay) 💊',
        settingsFeatPillHint: 'Shows a top-bar status and countdown timer for the pill cycle, highlights ready pills, and checks health/hunger levels.',
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
        craftProfitRange: 'Profit range:',
        craftProfitSpecific: 'Profit: {min} to {max}',
        craftWorstItem: 'Worst option ({item}): {profit}',
        craftBestItem: 'Best option ({item}): {profit}',
        craftMarketRange: 'Market range: {min} to {max} Gold',
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
        settingsFeatPnlTrackerHint: 'Display your daily profit/loss tracker in the topbar next to your gold balance.'
      },
      de: {
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
        settingsFeatNotesCheckbox: 'Spieler-Notizen bei Spieler-Links 📒 (experimentell)',
        settingsFeatNotesHint: 'Fügt ein Notiz-Icon neben Spieler-Links hinzu. Deaktivieren, wenn das separate Warera User Notes-Script ebenfalls aktiv ist.',
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
        tourPaste: 'Aus Zwischenablage einfügen',
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
        tourStep7Body: 'Füge deinen Token hier ein und klicke Speichern. Fertig — Prost! 🍻',
        tokenStorageUpgraded: 'Der Speicherort für den API-Key wurde aktualisiert — bitte trage deinen API-Key in den Einstellungen neu ein. API-Funktionen bleiben deaktiviert, bis du ihn neu einträgst.',
        tokenStorageUpgradedTitle: 'API-Key aktualisiert',
        apiKeyRequiredMsg: 'Diese Funktion benötigt deinen API-Key (Einstellungen).',
        apiKeyRequiredSuffix: 'benötigt Key',
        hintToggleLabel: 'Erklärung',
        settingsFeatPillCheckbox: 'Pill-Reminder (konfigurierbares Pillen-Timing Overlay)',
        settingsFeatPillHint: 'Zeigt einen Status und Countdown in der Menüleiste, markiert nimmbereite Pillen und prüft HP/Hunger-Werte.',
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
        craftProfitRange: 'Profit-Spanne:',
        craftProfitSpecific: 'Profit: {min} bis {max}',
        craftWorstItem: 'Schlechteste Option ({item}): {profit}',
        craftBestItem: 'Beste Option ({item}): {profit}',
        craftMarketRange: 'Marktspanne: {min} bis {max} Gold',
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
        updateAvailableBody: 'Eine neuere PROST-Version (v{ver}) is verfügbar. Aktualisiere jetzt — veraltete Versionen können Code enthalten, der gegen Spielregeln verstößt.',
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
        settingsFeatPnlTrackerHint: 'Zeigt deinen täglichen Gewinn/Verlust Tracker in der Topbar neben deinem Goldstand an.'
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
    locale: NS + 'locale',
    priceCache: NS + 'priceCache',     // { data, fetchedAt }-materials map
    scrapCache: NS + 'scrapCache',     // { price, fetchedAt }-legacy, unused
    transactionsCache: NS + 'transactionsCache', // { [itemCode]: { data, fetchedAt } }-equipment transactions
    apiBase: NS + 'apiBase',
    rateLimitedUntil: NS + 'rlUntil',
    ntfyRateLimitedUntil: NS + 'ntfyRlUntil',
    ntfy429Streak: NS + 'ntfy429Streak',
    stockKeepCount: NS + 'stockKeepCount',
    featNotes: NS + 'featNotes',
    featBattleAdvisor: NS + 'featBattle',
    alliedCountryCodes: NS + 'alliedCodes',
    featPillReminder: NS + 'featPill',
    featPillNotifHnH: NS + 'featPillNotifHnH',
    featPillNotifWindow: NS + 'featPillNotifWindow',
    featPillNotifDebuff: NS + 'featPillNotifDebuff',
    lastNotifiedHnH: NS + 'lastNotifiedHnH',
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
    pnlLedger: NS + 'pnl.ledger',
    pnlYesterday: NS + 'pnl.yesterday',
    pnlCostBasis: NS + 'pnl.costBasis',
    pnlSnapshots: NS + 'pnl.snapshots',
    pnlSchemaVersion: NS + 'pnl.schemaVersion',
    debug: NS + 'debug',
    pnlProcessedTxs: NS + 'pnl.processedTxs',  // persistent (history-spanning) tx-id dedup for cost-basis + booking
    pnlBadTx: NS + 'pnl.badTx',                // quarantine retry attempts mapping for bad transactions
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
    if (!manual && nowMs - lastCheck < 24 * 60 * 60 * 1000) {
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
            alert(`A newer version of PROST (v${data.version}) is available!\n\nCurrent version: v${current}\n\nPlease update from GreasyFork.`);
          } else {
            alert(`PROST is up to date (v${current}).`);
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
        setHealth(feat, 'warn', `possible loop: "${String(msg).slice(0,60)}" ×${r.count} in ${W}ms`);
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
      (level === 'error' ? console.error : console.log)(`[PROST:${feat}]`, ...msg);
    }
  }

  function reportError(feat, e, ctx, status = 'fail') {
    const msg = (e && e.message) || String(e);
    const fullMsg = ctx ? `${ctx}: ${msg}` : msg;
    const isRepeated = _trackRepeat(feat, 'error', fullMsg);

    Debug.buf.push({ t: Date.now(), feat, level: 'error', msg: [ctx, msg].filter(Boolean) });
    if (Debug.buf.length > Debug.max) Debug.buf.shift();

    setHealth(feat, status, fullMsg);

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
  function setHealth(id, status, reason = '') {
    const h = regFeature(id);
    h.status = status;
    h.reason = reason;
    h._touched = true;                 // tells guard() not to overwrite with 'ok'
    if (status === 'fail') h.lastError = reason;
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
  if (PAGE_WINDOW) {
    PAGE_WINDOW.PROST = PAGE_WINDOW.WIA = {
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
  // Render the feature ampel list into a container element (in-game Diagnose panel).
  function renderHealthPanel(el) {
    if (!el) return;
    const ids = Object.keys(Health);
    if (!ids.length) { el.innerHTML = '<div style="color:#8b949e; font-size:12px;">keine Features registriert</div>'; return; }
    const rows = ids.map((id) => {
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

    el.innerHTML = `<div style="background:#0d1117; border:1px solid rgba(148,163,184,.25); border-radius:6px; padding:8px;">${rows}${perfRow}</div>`;
  }

  // ── Phase 2: route-aware probes ──────────────────────────────────────────
  // Each probe inspects the CURRENT page + injected DOM and returns the real
  // status. This is the source of truth (the start()-time guard status goes
  // stale on SPA navigation). Run on "Aktualisieren" and on every route change.
  const PROBES = {
    advisor() {
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
    battleAdvisor() {
      if (!CONFIG.featBattleAdvisor) return ['idle', 'disabled in settings'];
      if (!isBattlePage()) return ['idle', 'not on battle page'];
      const present = document.querySelector('.wia-battle-primary, .wia-battle-muted');
      return present ? ['ok', ''] : ['fail', 'advisory not injected on battle page'];
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
          <button type="button" class="wia-hud-refresh" style="font-size:11px; padding:2px 8px; cursor:pointer; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:5px;">↻</button>
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

  function gmRequest({ method, url, headers, data }) {
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
        timeout: 15000,
        onload: (res) => resolve({ status: res.status, text: res.responseText, responseHeaders: res.responseHeaders || '' }),
        onerror: () => reject(new Error('network error: ' + url)),
        ontimeout: () => reject(new Error('timeout: ' + url)),
      });
    });
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

  function isProcedureGated(procedure) {
    const gated = GM_getValue(KEYS.gatedProcedures, []);
    return Array.isArray(gated) && gated.includes(procedure);
  }
  function gateProcedure(procedure) {
    let gated = GM_getValue(KEYS.gatedProcedures, []);
    if (!Array.isArray(gated)) gated = [];
    if (!gated.includes(procedure)) {
      gated.push(procedure);
      GM_setValue(KEYS.gatedProcedures, gated);
      console.warn(`[PROST:api] procedure gated: ${procedure} (auth/permission failure)`);
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
    if (isProcedureGated(procedure)) throw new Error('gated: ' + procedure);
    const cached = GM_getValue(KEYS.apiBase, '');
    const hasKey = !!getToken();
    let allowedBases = CONFIG.apiBases;
    if (!hasKey) {
      allowedBases = gatewayBases;
    }
    const bases = cached && allowedBases.includes(cached)
      ? [cached, ...allowedBases.filter((b) => b !== cached)]
      : allowedBases;

    let lastErr;
    for (const base of bases) {
      try {
        await throttle();
        const res = await gmRequest({ method: 'GET', url: trpcUrl(base, procedure, args), headers: headersForBase(base) });
        if (res.status === 429) { tripRateLimit(); throw new Error('429'); }
        if (res.status === 401 || res.status === 403) {
          gateProcedure(procedure);
          throw new Error(String(res.status));
        }
        if (res.status >= 200 && res.status < 300) {
          GM_setValue(KEYS.apiBase, base);
          return { base, payload: unwrapTrpc(res.text) };
        }
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
        if (String(e.message).includes('429')) break;
        if (String(e.message).includes('401') || String(e.message).includes('403')) break;
      }
    }
    if (!hasKey && api2Bases.length > 0) {
      throw new Error('apiKeyRequired: ' + procedure);
    }
    throw lastErr || new Error('all API bases failed');
  }

  async function resolveApiPost(procedure, args) {
    if (isRateLimited()) throw new Error('429');
    if (isProcedureGated(procedure)) throw new Error('gated: ' + procedure);
    const cached = GM_getValue(KEYS.apiBase, '');
    const hasKey = !!getToken();
    let allowedBases = CONFIG.apiBases;
    if (!hasKey) {
      allowedBases = gatewayBases;
    }
    const bases = cached && allowedBases.includes(cached)
      ? [cached, ...allowedBases.filter((b) => b !== cached)]
      : allowedBases;

    let lastErr;
    for (const base of bases) {
      try {
        await throttle();
        const url = `${base}/${encodeURIComponent(procedure)}`;
        const res = await gmRequest({
          method: 'POST',
          url,
          headers: {
            ...headersForBase(base),
            'Content-Type': 'application/json',
            'accept': '*/*'
          },
          data: JSON.stringify(args)
        });
        if (res.status === 429) { tripRateLimit(); throw new Error('429'); }
        if (res.status === 401 || res.status === 403) {
          gateProcedure(procedure);
          throw new Error(String(res.status));
        }
        if (res.status >= 200 && res.status < 300) {
          GM_setValue(KEYS.apiBase, base);
          return { base, payload: unwrapTrpc(res.text) };
        }
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
        if (String(e.message).includes('429')) break;
        if (String(e.message).includes('401') || String(e.message).includes('403')) break;
      }
    }
    if (!hasKey && api2Bases.length > 0) {
      throw new Error('apiKeyRequired: ' + procedure);
    }
    throw lastErr || new Error('all API bases failed');
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

  async function fetchItemTransactions(code, force) {
    if (!code) return null;
    const store = readCache(KEYS.transactionsCache) || {};
    const cached = store[code];
    if (!force && cached && now() - cached.fetchedAt < CONFIG.txCacheTtlMs) return cached.data;
    if (isRateLimited()) return cached ? cached.data : null;
    if (transactionsInFlight[code]) return transactionsInFlight[code];

    transactionsInFlight[code] = (async () => {
      try {
        await throttle();
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
            'X-API-Key': 'prost-userscript'
          },
          data: body
        });
        if (res.status === 429) { tripRateLimit(); return cached ? cached.data : null; }
        if (res.status < 200 || res.status >= 300) return cached ? cached.data : null;

        const data = JSON.parse(res.text);
        const items = data?.result?.data?.items || [];

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
    return /\/shop(\/|$)/.test(location.pathname);
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
    globalThis.Health = Health;
    globalThis.parseStats = parseStats;
    globalThis.getItemState = getItemState;
    globalThis.isInsideProfileEquipment = isInsideProfileEquipment;
    globalThis.shouldSuppressItem = shouldSuppressItem;
    globalThis.originalTitles = originalTitles;
    globalThis.detectAllySide = detectAllySide;
    globalThis.battleFlagCode = battleFlagCode;
    globalThis.injectCompactOrders = injectCompactOrders;
    globalThis.renderSettingsModal = renderSettingsModal;
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

  function slotForSkin(skinName) {
    if (!skinName) return null;

    // 1. Wissensbibliothek CONFIG.skinToSlot
    if (CONFIG.skinToSlot) {
      if (CONFIG.skinToSlot[skinName]) {
        return CONFIG.skinToSlot[skinName];
      }
      const lowerName = skinName.toLowerCase();
      for (const [key, slot] of Object.entries(CONFIG.skinToSlot)) {
        if (key.toLowerCase() === lowerName) {
          return slot;
        }
      }
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
      const type = CONFIG.typeByAltKeyword[slot] || slot;
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

    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;

    const validTxs = txs.map(tx => {
      const t = getTxTimestamp(tx);
      if (!t || t < sixDaysAgo) return null;
      if (tx.transactionType !== undefined && tx.transactionType !== 'itemMarket') return null;

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
    const taxRate = CONFIG.sellTaxRate ?? 0.01;
    const netMarketValue = value != null ? value * (1 - taxRate) : null;

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

  function hasFreshCachedData(code) {
    const tc = GM_getValue(KEYS.transactionsCache, {}) || {};
    const cachedTx = tc[code];
    if (!cachedTx || now() - cachedTx.fetchedAt >= CONFIG.txCacheTtlMs) return false;
    return true;
  }



async function scanInventory(force) {
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

              await Promise.all(codesToFetch.map(async (c) => {
                if (pendingFetches.has(c)) return;
                pendingFetches.add(c);
                try {
                  if (CONFIG.debug && CONFIG.verboseDebug) {
                    dbg('core', 'debug', `Background load started for ${c}`);
                  }
                  await fetchItemTransactions(c, force);
                  n++;
                  if (CONFIG.debug && CONFIG.verboseDebug) {
                    dbg('core', 'debug', `Background load finished for ${c}`);
                  }
                } catch (e) {
                  log(`Background load failed for ${c}:`, e);
                } finally {
                  pendingFetches.delete(c);
                }
              }));

              const ms = now() - startTime;
              log(`background: fetched ${n}/${N} codes in ${ms}ms (${fromCache} cached)`);

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

  // ───────────────────────────────────────────────────────────────────────────
  // Settings UI
  // ───────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    GM_addStyle(`
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
        margin: 8px 0 4px; width: 100%; box-sizing: border-box;
        background: #0d1117; border: 1px solid #30363d; border-radius: 8px;
        padding: 12px; font: 13px/1.5 system-ui, sans-serif;
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
      }
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
    `);
  }

  function updateStatusIndicator() {
    const dot = document.querySelector('.wia-gear-dot');
    const gear = document.querySelector('.wia-gear');
    if (!dot || !gear) return;
    const s = cacheStatus();
    const color = isRateLimited() ? '#f85149' : s.stale ? '#d29922' : '#3fb950';
    dot.style.background = color;
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
        warnBanner.innerHTML = `<strong>${t('updateAvailableTitle', { ver: cleanRemote })}</strong><br/><span style="font-size: 11px;">${t('updateAvailableBody', { ver: cleanRemote })} <a href="https://greasyfork.org/de/scripts/583766-prost" target="_blank" style="color: #58a6ff; text-decoration: underline; font-weight: bold;">GreasyFork</a></span>`;
      } else {
        warnBanner.style.display = 'none';
        warnBanner.innerHTML = '';
      }
    }
  }

  function renderSettingsModal(bg) {
    if (!bg) return;
    const currentLocale = getLocale();
    const nextLocale = currentLocale === 'de' ? 'en' : 'de';
    const prevToken = bg.querySelector('.wia-token')?.value ?? getToken();
    const hasKey = !!prevToken.trim();
    const prevFeatNotes = bg.querySelector('.wia-feat-notes')?.checked ?? CONFIG.featNotes;
    const prevFeatBattle = bg.querySelector('.wia-feat-battle')?.checked ?? CONFIG.featBattleAdvisor;
    const prevFeatPill = bg.querySelector('.wia-feat-pill')?.checked ?? CONFIG.featPillReminder;
    const prevFeatMuHealDim = bg.querySelector('.wia-feat-mu-heal-dim')?.checked ?? CONFIG.featMuHealDim;
    const prevFeatMarketGraph = bg.querySelector('.wia-feat-market-graph')?.checked ?? CONFIG.featMarketGraph;
    const prevFeatPnlTracker = bg.querySelector('.wia-feat-pnl-tracker')?.checked ?? CONFIG.featPnlTracker;
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
            <h2>${t('settingsTitle')}</h2>
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
        <div class="wia-feat-row" style="margin-top: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-feat-notes" style="width: auto;" ${prevFeatNotes ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatNotesCheckbox')}</label>
            <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
          </div>
          <div class="wia-hint" hidden>${t('settingsFeatNotesHint')}</div>
        </div>
        <div class="wia-feat-row" style="margin-top: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-feat-battle" style="width: auto;" ${prevFeatBattle ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatBattleCheckbox')}</label>
            <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
          </div>
          <div class="wia-hint" hidden>${t('settingsFeatBattleHint')}</div>
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
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-feat-market-graph" style="width: auto;" ${prevFeatMarketGraph ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatMarketGraphCheckbox')}</label>
            <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
          </div>
          <div class="wia-hint" hidden>${t('settingsFeatMarketGraphHint')}</div>
        </div>
        <div class="wia-feat-row" style="margin-top: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-feat-pnl-tracker" style="width: auto;" ${prevFeatPnlTracker ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatPnlTrackerCheckbox')}</label>
            <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
          </div>
          <div class="wia-hint" hidden>${t('settingsFeatPnlTrackerHint')}</div>
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
        <details class="wia-notif-settings-row" style="margin-top: 10px; border-top: 1px solid rgba(148,163,184,.15); padding-top: 10px;">
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
        <button type="button" class="wia-help-toggle" aria-expanded="false">${t('settingsHelpSummary')}</button>
        <aside class="wia-help-panel" hidden>
          <div class="wia-help-content">${t('settingsHelpContent')}</div>
        </aside>
        <div class="wia-feat-row" style="margin-top: 10px; border-top: 1px solid rgba(148,163,184,.2); padding-top: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-debug" style="width: auto;" ${CONFIG.debug ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">🐞 Debug-Logging (Konsole + Diagnose)</label>
          </div>
          <details class="wia-health-details" style="margin-top: 6px;">
            <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none;">Feature-Health / Diagnose</summary>
            <button type="button" class="wia-health-btn" style="margin: 6px 0; font-size: 11px; padding: 3px 8px; cursor: pointer;">Aktualisieren</button>
            <button type="button" class="wia-pnl-print-btn" style="margin: 6px 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: #58a6ff; background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.2); border-radius: 3px;">P&L Kassenzettel (Konsole)</button>
            <button type="button" class="wia-skins-dump-btn" style="margin: 6px 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: #ff9800; background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.2); border-radius: 3px;">Skins Dump (Konsole)</button>
            <div class="wia-health-panel"></div>
          </details>
          <details class="wia-test-notif-details" style="margin-top: 6px;">
            <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none;">Benachrichtigungen testen</summary>
            <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
              <button type="button" class="wia-test-notif-bounty" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #fbbf24; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); border-radius: 3px;">Kopfgeld (Bounty)</button>
              <button type="button" class="wia-test-notif-hnh" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #10b981; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); border-radius: 3px;">HP & Hunger voll</button>
              <button type="button" class="wia-test-notif-window" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #fbbf24; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); border-radius: 3px;">Pillenfenster</button>
              <button type="button" class="wia-test-notif-debuff" style="font-size: 11px; padding: 3px 8px; cursor: pointer; color: #8b5cf6; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.2); border-radius: 3px;">Debuff abgelaufen</button>
            </div>
          </details>
        </div>
        <div class="wia-btns">
          <button class="wia-btn primary wia-save">${t('settingsSave')}</button>
          <button class="wia-btn wia-clear">${t('settingsClear')}</button>
          <button class="wia-btn wia-close">${t('settingsClose')}</button>
        </div>
      </div>`;

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

    const debugCheckbox = modal.querySelector('.wia-debug');
    const healthPanel = modal.querySelector('.wia-health-panel');
    const healthBtn = modal.querySelector('.wia-health-btn');
    if (debugCheckbox) {
      debugCheckbox.onchange = () => setDebug(debugCheckbox.checked);   // live toggle, persisted
    }
    if (healthBtn && healthPanel) {
      healthBtn.onclick = (e) => { e.preventDefault(); runProbes(); renderHealthPanel(healthPanel); };
    }
    const printBtn = modal.querySelector('.wia-pnl-print-btn');
    if (printBtn) {
      printBtn.onclick = (e) => { e.preventDefault(); printPnlReceipt(); };
    }
    const skinsDumpBtn = modal.querySelector('.wia-skins-dump-btn');
    if (skinsDumpBtn) {
      skinsDumpBtn.onclick = (e) => { e.preventDefault(); dumpSkinsToConsole(); };
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

      const featBattle = bg.querySelector('.wia-feat-battle').checked;
      GM_setValue(KEYS.featBattleAdvisor, featBattle);
      CONFIG.featBattleAdvisor = featBattle;
      if (featBattle && isBattlePage()) { applyBattleAdvisory(); } else { teardownBattleAdvisory(); }

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
    gear.textContent = '⚙';
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
    return (r.width > 0 && r.height > 0) ? el : null;
  }

  function findAvatarMenu() {
    const el = pick('tour', '#avatar')[0]
      || pick('tour', '[aria-haspopup="dialog"] #avatar')[0]
      || pick('tour', '[aria-haspopup="dialog"]')[0];
    // climb to the clickable button/menu trigger if we matched the inner avatar
    return visible(el && (el.closest('[aria-haspopup="dialog"]') || el));
  }

  function findSettingsLink() {
    const uid = (typeof getCurrentUserId === 'function') ? getCurrentUserId() : null;
    if (uid) {
      const exact = pick('tour', `a[href$="/user/${uid}/settings"]`)[0];
      if (visible(exact)) return exact;
    }
    // fallback: any settings link inside an open HeadlessUI menu
    const links = document.querySelectorAll('a[href$="/settings"]');
    for (const a of links) if (visible(a)) return a;
    return null;
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

  // After confirming, the dialog shows the full (long) token + a copy button.
  function findNewTokenDialog() {
    const panels = document.querySelectorAll('[id^="headlessui-dialog-panel"]');
    for (const p of panels) {
      if (/wae_[a-z0-9]{20,}/i.test(p.textContent || '') && visible(p)) return p;
    }
    return null;
  }

  function findProstTokenInput() {
    return visible(document.querySelector('.wia-token'));
  }

  const TOUR_STEPS = [
    { id: 'avatar',   titleKey: 'tourStep1Title', bodyKey: 'tourStep1Body', find: findAvatarMenu },
    { id: 'settings', titleKey: 'tourStep2Title', bodyKey: 'tourStep2Body', find: findSettingsLink },
    { id: 'section',  titleKey: 'tourStep3Title', bodyKey: 'tourStep3Body', find: findApiTokenSection },
    { id: 'create',   titleKey: 'tourStep4Title', bodyKey: 'tourStep4Body', find: findCreateTokenButton },
    { id: 'dialog',   titleKey: 'tourStep5Title', bodyKey: 'tourStep5Body', find: findCreateDialog },
    { id: 'copy',     titleKey: 'tourStep6Title', bodyKey: 'tourStep6Body', find: findNewTokenDialog },
    { id: 'paste',    titleKey: 'tourStep7Title', bodyKey: 'tourStep7Body', find: findProstTokenInput },
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

  let tourState = { active: false, index: 0, ui: null, cleanupReposition: null };

  // step 7 paste UI is injected by Task 7; safe no-op default until then
  function renderStep7Paste(pasteEl, cardParts) {
    // Ensure PROST settings (with the .wia-token input) is open so the input exists.
    if (!findProstTokenInput()) {
      try { openSettings(); } catch (e) { dbg('tour', 'error', 'open settings failed', e); }
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wia-tour-btn wia-tour-btn-secondary';
    btn.style.width = '100%';
    btn.textContent = t('tourPaste');
    btn.onclick = async () => {
      const input = findProstTokenInput();
      let pasted = false;
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = (await navigator.clipboard.readText() || '').trim();
          if (/^wae_[a-z0-9]+$/i.test(text) && input) {
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            pasted = true;
          }
        }
      } catch (e) { dbg('tour', 'debug', 'clipboard read blocked'); }
      if (pasted) {
        btn.textContent = getLocale() === 'de' ? '✓ Eingefügt — jetzt Speichern' : '✓ Pasted — now Save';
        btn.disabled = true;
        if (input) { input.focus(); input.scrollIntoView({ block: 'center' }); }
      } else {
        // manual fallback
        cardParts.bodyEl.textContent = getLocale() === 'de'
          ? 'Automatisches Einfügen blockiert — füge den Token manuell ein (Cmd/Strg+V) und klicke Speichern.'
          : 'Auto-paste blocked — paste your token manually (Cmd/Ctrl+V) and click Save.';
        if (input) { input.focus(); input.scrollIntoView({ block: 'center' }); }
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
    const step = TOUR_STEPS[index];

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
      c.bodyEl.textContent = t(step.bodyKey);
      tourState.cleanupReposition = attachReposition(step.find, ui);
    } else {
      // graceful: keep the card, tell the user, Next stays enabled
      hole.style.display = 'none';
      beer.style.display = 'none';
      c.bodyEl.textContent = t('tourNotFound');
      setHealth('tour', 'warn', `anchor not found: ${step.id}`);
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
    return /\/user\/[^/]+\/inventory/.test(location.pathname);
  }

  function isMarketPage() {
    return /\/market\/equipments/.test(location.pathname);
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

  let lastPath = location.pathname;

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
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
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
      updateObserverTarget();
      if (document.querySelector("[id^='item-code-selector-']") || findItemCards().size > 0) {
        log('Route change: cards exist immediately, scanning');
        guard('advisor', () => scanInventory(false));
      } else {
        initBootstrapObserver();
        startRoutePolling();
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
    } else {
      teardownBattleAdvisory();
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
    return /\/battle\/[0-9a-zA-Z]{6,}/.test(location.pathname)
      && !/\/battles/.test(location.pathname);
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
    const currentPath = location.pathname;
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
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Notes module (ported from warera-notes.user.js-reuses same GM keys/selectors
  // so notes saved by the standalone script remain visible here too)
  // ───────────────────────────────────────────────────────────────────────────
  const NOTES_LINK_SEL  = "a[href*='/user/']";
  const NOTES_ATTR      = 'data-warera-note-attached';
  const NOTES_KEY_PFX   = 'warera-note:';
  const NOTES_DEBOUNCE  = 150;

  let sharedBodyObserver = null;

  function initSharedBodyObserver() {
    if (sharedBodyObserver) return;
    sharedBodyObserver = new MutationObserver((mutations) => {
      if (CONFIG.featNotes) {
        if (mutations.some(m => m.addedNodes.length > 0)) {
          scheduleNotesScan();
        }
      }
if (CONFIG.featMarketGraph && location.pathname.startsWith('/market')) {
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
      triggerCraftingAdvisorCheck();
    });
    sharedBodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function teardownSharedBodyObserver() {
    if (!CONFIG.featNotes && !CONFIG.featMarketGraph && !CONFIG.featBattleAdvisor) {
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
    icon.textContent = hasNote(userId) ? '📒' : '✎';
    icon.title = notePreview(userId);
    icon.setAttribute('aria-label', t('editNoteAria', { user: link.textContent.trim() || t('noteUserLabel') }));
    if (hasNote(userId)) icon.classList.add('has-note');
    icon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openNoteEditor(userId, link.textContent.trim() || t('noteUserLabel'));
    });
    link.insertAdjacentElement('afterend', icon);
    link.dataset.wareraNoteAttached = 'true';
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
    return /^\/mu(\/|$)/.test(location.pathname);
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

    // 1. Health & Hunger full
    if (CONFIG.featPillNotifHnH) {
      if (status.both100) {
        const alreadyNotified = GM_getValue(KEYS.lastNotifiedHnH, false);
        if (!alreadyNotified) {
          GM_setValue(KEYS.lastNotifiedHnH, true);
          sendPersonalNtfy('HnH', t('ntfyHnHFullTitle'), t('ntfyHnHFullBody'), 'poultry_leg,heart,white_check_mark');
        }
      } else {
        GM_setValue(KEYS.lastNotifiedHnH, false);
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
      const path = location.pathname;
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
        const url = 'https://gateway.warerastats.io/trpc/transaction.getPaginatedTransactions';
        const body = JSON.stringify({
          limit: 100,
          itemCode: code,
          transactionType: 'trading',
          cursor: cursor || undefined
        });
        const res = await gmRequest({
          method: 'POST',
          url,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'prost-userscript'
          },
          data: body
        });
        if (res.status === 429) { tripRateLimit(); return null; }
        if (res.status < 200 || res.status >= 300) return null;

        const json = JSON.parse(res.text);
        const data = json?.result?.data || {};
        return {
          items: data.items || [],
          nextCursor: data.nextCursor || null
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

    // Check transaction history cache
    const tc = readCache(KEYS.transactionsCache) || {};
    const itemTxs = tc[itemCode];
    if (itemTxs && Array.isArray(itemTxs.data) && itemTxs.data.length > 0) {
      const prices = itemTxs.data.map(t => getTxPrice(t)).filter(p => p != null && !Number.isNaN(p));
      if (prices.length > 0) {
        minPrice = Math.min(...prices);
        maxPrice = Math.max(...prices);
      }
    }

    // Fallback to cached price
    if (minPrice == null) {
      const floor = getCachedPrice(itemCode);
      if (floor != null) {
        minPrice = floor;
        maxPrice = floor;
      }
    }

    return { minPrice, maxPrice };
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
            selectedItem = img.getAttribute('alt');
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
      // Random mode: find min/max profit range among green equipment items of this tier
      const itemCodes = getTierItemCodes(state.tier);
      const itemsInfo = itemCodes.map(code => {
        const range = getItemPriceRange(code);
        return { code, range };
      }).filter(item => item.range.minPrice != null);

      if (itemsInfo.length > 0) {
        // Sort items by floor price to find best and worst
        itemsInfo.sort((a, b) => a.range.minPrice - b.range.minPrice);
        const worst = itemsInfo[0];
        const best = itemsInfo[itemsInfo.length - 1];

        const worstProfit = worst.range.minPrice - resourceCost;
        const bestProfit = best.range.minPrice - resourceCost;

        const worstColor = worstProfit >= 0 ? '#3fb950' : '#ff7b72';
        const bestColor = bestProfit >= 0 ? '#3fb950' : '#ff7b72';

        html += `
          <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.06);">
            <div style="color: #8b949e; margin-bottom: 2px;">${t('craftProfitRange')}:</div>
            <div style="margin-bottom: 2px;">
              • ${t('craftWorstItem', { item: formatItemCode(worst.code), profit: `<span style="color: ${worstColor}; font-weight: bold;">${worstProfit >= 0 ? '+' : ''}${fmt(worstProfit)} Gold</span>` })}
            </div>
            <div>
              • ${t('craftBestItem', { item: formatItemCode(best.code), profit: `<span style="color: ${bestColor}; font-weight: bold;">${bestProfit >= 0 ? '+' : ''}${fmt(bestProfit)} Gold</span>` })}
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
        const minColor = minProfit >= 0 ? '#3fb950' : '#ff7b72';
        const maxColor = maxProfit >= 0 ? '#3fb950' : '#ff7b72';

        html += `
          <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.06);">
            <div style="margin-bottom: 2px;">
              • ${t('craftMarketRange', { min: fmt(range.minPrice), max: fmt(range.maxPrice) })}
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
        html += `<div style="color: #8b949e; font-style: italic;">No market price range found for ${formatItemCode(state.selectedItem)}.</div>`;
      }
    }

    panel.innerHTML = html;
  }

  // ───────────────────────────────────────────────────────────────────────────
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
        const url = 'https://gateway.warerastats.io/trpc/transaction.getPaginatedTransactions';
        // The feed returns only the newest 100 per page. Between 30s polls a player +
        // their employees can produce >100 tx (wages spam), so paginate until we reach
        // already-processed territory (or a page cap). Dedup makes overlap harmless.
        const seenSet = new Set(readCache(KEYS.pnlProcessedTxs) || []);
        const MAX_PAGES = 10; // safety cap = up to 1000 tx/poll; first run pulls full history
        let cursor = null;
        let prevFirstId = null;
        const all = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const body = JSON.stringify(cursor ? { limit: 100, userId, cursor } : { limit: 100, userId });
          const res = await gmRequest({
            method: 'POST', url,
            headers: { 'Content-Type': 'application/json', 'X-API-Key': 'prost-userscript' },
            data: body
          });
          if (res.status < 200 || res.status >= 300) break;
          const data = JSON.parse(res.text)?.result?.data;
          const items = data?.items || [];
          if (!items.length) break;
          const firstId = normalizeDbId(items[0]._id || items[0].id);
          if (firstId && firstId === prevFirstId) break; // cursor didn't advance → stop
          prevFirstId = firstId;
          all.push(...items);
          // Reached txs we've already processed → fully caught up, stop paginating.
          if (items.some(it => seenSet.has(normalizeDbId(it._id || it.id)))) break;
          cursor = data?.nextCursor;
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
  async function loadCountryMap() {
    if (countryMapMem) return countryMapMem;
    const cached = GM_getValue(KEYS.bountyCountryMap, null);
    if (cached && (now() - cached.at) < BOUNTY_MAP_TTL_MS && cached.map) { countryMapMem = cached.map; return countryMapMem; }
    const list = (await resolveApiPost('country.getAllCountries', {})).payload || [];
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
  }

  async function resolveCountryName(id) {
    if (!id) return '?';
    try { const m = await loadCountryMap(); if (m[id]) return m[id].name; } catch (e) { /* fall through */ }
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

  async function resolveOwnCountry() {
    const ov = (CONFIG.bountyOwnCountryOverride || '').trim();
    if (ov) {
      const match = ov.match(/[a-f0-9]{24}/i);
      if (match) return match[0];
    }
    const ckey = KEYS.bountyAllyCache + '_own';
    const cached = GM_getValue(ckey, null);
    if (cached && (now() - cached.at) < BOUNTY_ALLY_TTL_MS) {
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
      dbg('bountyNotify', 'error', 'own country resolve failed', e.message);
      return null;
    }
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
    regFeature('advisor', 'Item Advisor');
    regFeature('pnl', 'P&L Tracker');
    regFeature('marketGraph', 'Market Graph');
    regFeature('battleAdvisor', 'Battle Advisor');
    regFeature('pillReminder', 'Pill Reminder');
    regFeature('muHealDim', 'MU Heal Dim');
    regFeature('notes', 'User Notes');
    regFeature('api', 'API Layer');
    regFeature('bountyNotify', 'Bounty-Push');
    regFeature('tour', 'Tour of Beers');
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
    CONFIG.featNotes = GM_getValue(KEYS.featNotes, false);
    CONFIG.featBattleAdvisor = GM_getValue(KEYS.featBattleAdvisor, false);
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
    CONFIG.featSystemAlerts = GM_getValue(KEYS.featSystemAlerts, true);
    CONFIG.pillBuffH = GM_getValue(KEYS.pillBuffH, CONFIG.pillBuffH);
    CONFIG.pillKnifeH = GM_getValue(KEYS.pillKnifeH, CONFIG.pillKnifeH);
    CONFIG.pillDebuffH = GM_getValue(KEYS.pillDebuffH, CONFIG.pillDebuffH);
    CONFIG.pillPrefWindowFrom = GM_getValue(KEYS.pillPrefWindowFrom, CONFIG.pillPrefWindowFrom);
    CONFIG.pillPrefWindowTo = GM_getValue(KEYS.pillPrefWindowTo, CONFIG.pillPrefWindowTo);
    injectStyles();
    // Each entrypoint guarded → a crash in one feature can't abort the rest of start().
    if (CONFIG.featNotes) guard('notes', initNotes); else setHealth('notes', 'idle', 'disabled in settings');
    if (CONFIG.featBattleAdvisor) {
      guard('battleAdvisor', refreshAlliedCodes);
      if (isBattlePage()) {
        guard('battleAdvisor', applyBattleAdvisory);
        initSharedBodyObserver();
      }
      else setHealth('battleAdvisor', 'idle', 'not on battle page');
    } else setHealth('battleAdvisor', 'idle', 'disabled in settings');
    if (CONFIG.featPillReminder) guard('pillReminder', initPillReminder); else setHealth('pillReminder', 'idle', 'disabled in settings');
    if (CONFIG.featMuHealDim) applyMuHealDimSoon(); else setHealth('muHealDim', 'idle', 'disabled in settings');
    if (CONFIG.featMarketGraph) guard('marketGraph', initMarketGraph); else setHealth('marketGraph', 'idle', 'disabled in settings');
    if (CONFIG.featPnlTracker) guard('pnl', initPnlTracker); else setHealth('pnl', 'idle', 'disabled in settings');
    if (CONFIG.featBountyNotify) guard('bountyNotify', initBountyNotify); else setHealth('bountyNotify', 'idle', 'disabled in settings');
    if (CONFIG.featSystemAlerts) initSystemAlerts();
    injectGear();
    refreshMenuCommands();
    checkForUpdates(false);
    if (CONFIG.debug) { setTimeout(() => { runProbes(); updateDebugHud(); }, 1500); }

    observer = new MutationObserver(() => triggerScan(false));
    if (isInventoryPage()) {
      updateObserverTarget();
      guard('advisor', () => scanInventory(false));
      startRoutePolling();
    }

    // Intercept pushState / replaceState for instant route detection in Next.js SPA
    const fireRoute = debounce(handleRouteChange, 15);

    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      if (orig) {
        history[m] = function (...a) {
          const r = orig.apply(this, a);
          fireRoute();
          return r;
        };
      }
    }
    window.addEventListener('popstate', fireRoute);

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
    triggerCraftingAdvisorCheck();
  }

  start();
})();
