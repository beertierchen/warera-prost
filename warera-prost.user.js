// ==UserScript==
// @name         TEST PROST
// @namespace    https://github.com/beertierchen/warera-prost
// @version      0.7.8-unstable
// @description  PROST — Personal Recommendation Overlay & Support Tool for WareEra. KEEP/SELL/SCRAP advice from local stats + market floors, plus scrap-flip market indicators. Optional official game API via your own key. No automation.
// @author       beertierchen
// @homepageURL  https://github.com/beertierchen/warera-prost
// @supportURL   https://github.com/beertierchen/warera-prost/issues
// @match        https://app.warera.io/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api2.warera.io
// @connect      gateway.warerastats.io
// @license MIT
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
    // Equipment market data (falls back to api2).
    // One request per itemCode (e.g. "gloves6") returns live sell offers w/ skills.
    offersApiBase: 'https://api2.warera.io/trpc',
    itemOffersEndpoint: 'itemOffer.getItemOffers',
    offersLimit: 20,                    // how many offers to pull per itemCode
    useLiveOffersApi: false,            // disabled to avoid 401, using scraped market floors instead
    featNotes: false,                    // experimental: user notes on /user/ links (off by default)
    featBattleAdvisor: false,            // experimental: highlight ally button on /battle/<id> pages
    alliedCountryCodes: ['de','pt','es','gm','ir','na','sr','th','at','fi','ie','no','se','uk','va','bf','cd','ye','ne','au','br','id'],
    featMarketGraph: false,
    featPnlTracker: true,

    // --- caching / rate-limit ---
    priceCacheTtlMs: 20 * 60 * 1000,    // 20 min (spec: 15-30 min)
    scrapedPriceTtlMs: 6 * 60 * 60 * 1000, // 6 hours for scraped market prices
    txCacheTtlMs: 60 * 60 * 1000,       // 1 hour for transaction history
    priceSampleIntervalMs: 15 * 60 * 1000, // sample every 15 mins
    priceSeriesWindowMs: 3 * 24 * 60 * 60 * 1000, // 3 days history
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
    critItemMinPercent: 0,
    // market-value icon (inline SVG, coin stack). Scrap uses the 🔨 emoji.
    marketIconSvg: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" style="filter:drop-shadow(1px 1px 0 #000)"><path d="M12 5C7.031 5 2 6.546 2 9.5S7.031 14 12 14c4.97 0 10-1.546 10-4.5S16.97 5 12 5zm-5 9.938v3c1.237.299 2.605.482 4 .541v-3a21.166 21.166 0 0 1-4-.541zm6 .54v3a20.994 20.994 0 0 0 4-.541v-3a20.994 20.994 0 0 1-4 .541zm6-1.181v3c1.801-.755 3-1.857 3-3.297v-3c0 1.44-1.199 2.542-3 3.297zm-14 3v-3C3.2 13.542 2 12.439 2 11v3c0 1.439 1.2 2.542 3 3.297z"/></svg>',

    // Market tax rate when selling items
    sellTaxRate: 0.01,

    // Scrap-flip safety margin for the OVERVIEW GRID only. The grid shows a
    // scraped FLOOR price, which can sit below the cheapest *real* offer (e.g.
    // floor 3.9 vs. real cheapest 4.1) and produce false-positive flips. We
    // inflate the grid buy price by this fraction so only clearly profitable
    // tiles flip. Detail-page offers use the real offer price and skip this.
    scrapFlipGridMargin: 0.05,

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

    showScrapFlip: false,
    featPillReminder: false,
    pillBuffH: 8,
    pillKnifeH: 6,
    pillDebuffH: 15.5,
    pillPrefWindowFrom: '19:00',
    pillPrefWindowTo: '20:00',
    hpIconPath: 'M12,21.35L10.55,20.03',
    hungerIconPath: 'M11,9H9V2H7V9',
    doubleChevronPath: 'M7.41,18.41',
    pillBuffIconPath: 'M4.22,11.29L11.29,4.22',
    pillDebuffIconPath: 'M22.11 21.46L2.39 1.73',

    debug: false,

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
        estNoOffers: 'Market value (est., no offers): {val}',
        scrapedFloor: 'Market value (scraped floor): {val}',
        marketRoll: 'Market value @ roll: {val} (floor {floor}, {offers} offers)',
        stalePrices: '⚠ cached/stale prices — refresh in settings',
        scrapeSuccess: '✓ {count} equipment prices scraped successfully!',
        notEquipment: 'not equipment',
        rangeLabelWeapon: 'score {score} >= {threshold} [90% of range {min} - {max}]',
        rangeLabelArmor: 'stat {stat}{pct} >= {threshold}{pct} [90% of range {min}{pct} - {max}{pct}]',
        topItemscore: 'Top Itemscore',
        settingsGearTitle: 'Inventory Advisor Settings',
        stockKeepReason: 'Stock: top 3 roll (#{rank} of {size} {label})',
        highRollT3: 'high roll basestat {stat} >= 11 (T3 blue)',
        critCondition: 'Critical Condition: {tierLabel} weapon crit {crit}% >= {min}% (range {range})',
        topRollOffers: 'stat {stat} in top {pct}% of {offers} live offers',
        notTopRollOffers: 'stat {stat} not top-roll ({offers} offers)',
        topRollInv: 'stat {stat} in top {pct}% of {items} inventory items',
        notTopRollInv: 'stat {stat} not top-roll in inventory ({items} items)',
        unknownRollRank: 'roll rank unknown (no offers/inventory comparison)',
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
        settingsFeatBattleHint: 'Highlights the button for your side on battle pages. Enter your allied country codes below.',
        settingsAlliedCodesLabel: 'Allied country codes (comma-separated, e.g. de,pt)',
        settingsAlliedCodesPlaceholder: 'de,pt,...',
        settingsTitle: 'WareEra Inventory Advisor',
        gearTitle: 'WareEra Inventory Advisor — Settings',
        settingsDesc: 'The Inventory Advisor gives a quick overview of whether items should be kept (KEEP/HOLD), sold (SELL), or salvaged (SCRAP).',
        settingsApiToken: 'API Token (api2.warera.io)',
        settingsTokenPlaceholder: 'Bearer token',
        settingsTokenNote: 'Saved locally (GM_setValue, lightly obfuscated — not real encryption).',
        settingsLiveOffersCheckbox: 'Fetch live offers via API (requires API Token)',
        settingsLiveOffersHint: 'Fetches live market listings from the official API to rank item stats against currently active listings.',
        settingsScrapFlipCheckbox: 'Scrap-Flip indicator (experimental)',
        settingsScrapFlipHint: 'Highlights profitable salvage items on the market (buying and dismantling them for profit).',
        scrapFlipTooltip: 'Buy {buy} → scrap {yield}×{unit} net {net} = +{profit} profit',
        hintToggleLabel: 'Explanation',
        settingsFeatPillCheckbox: 'Pill Reminder (configurable pill-timing overlay) 💊',
        settingsFeatPillHint: 'Shows a top-bar status and countdown timer for the pill cycle, highlights ready pills, and checks health/hunger levels.',
        settingsPillSettingsLabel: 'Pill timing options',
        settingsPillBuffLabel: 'Buff Duration (hours)',
        settingsPillKnifeLabel: 'Knife Duration (hours)',
        settingsPillDebuffLabel: 'Total Debuff (hours)',
        settingsPillPrefFromLabel: 'Preferred Time From',
        settingsPillPrefToLabel: 'Preferred Time To',
        pillTakeNowOverlay: 'TAKE NOW',
        pillTopUpOverlay: 'TOP UP FIRST',
        pillPreferredWindow: '{from} - {to}',
        pillPhaseBuff: 'Active ·',
        pillPhaseKnife: 'Knife ·',
        pillPhaseRecover: 'Recover ·',
        pillPhaseReady: 'READY',
        pillPhaseGated: 'Pill in',
        pillGatingHeader: 'Pill gates',
        pillHeadlineWindow: 'from {time}',
        pillHeadlineWindowTimer: '(in {duration})',
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
              <li>💎 <strong>KEEP (Blue)</strong>: Keep the item. Applies to your top 3 stock (by type/tier) or if the item is in the top 33% (Top Roll) of live offers or inventory.</li>
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
              <li>Counts down to your next pill — the latest of: <em>H&amp;H full</em>, <em>debuff ended</em>, and your <em>preferred window</em> start.</li>
              <li>Buff/debuff is detected from the pill icon on your own profile. "no pill anchor" just means none has been detected yet.</li>
            </ul>
            <strong>H&amp;H budget bars:</strong>
            <ul>
              <li>The notch on your Health &amp; Hunger bar is the <em>floor</em>: spend down to it and natural regen still refills you to 100% by pill time.</li>
              <li>The bright segment above the floor is <em>free to spend</em> (attack / get eaten). <em>✕ 0 free</em> = don't spend, you need it all to refill in time.</li>
            </ul>`,
        settingsPriceFormat: 'Price format: [Scrap Value]/[Market Price]',
        menuSettings: 'Inventory Advisor — Settings',
        menuClearRescan: 'Clear Cache + Rescan',
        gearTooltipTitle: 'Inventory Advisor — Settings',
        gearTooltipScrapPrice: 'Scrap price: {price}/u ({age})',
        gearTooltipItemPrices: 'Item prices: {count} cached ({age})',
        gearTooltipTxHistory: 'Tx history: {count} items cached',
        gearTooltipRateLimited: 'API limit — waiting {sec}s',
        dataStrip_scrapPrice: 'Scrap price:  {price} / unit   (fetched {age})\n',
        dataStrip_itemPrices: 'Item prices:  {count} cached         (fetched {age})\n',
        dataStrip_scrapedMkt: 'Scraped mkt:  {count} items stored    (visit Market -> Equipments to update)\n',
        dataStrip_txHistory: 'Tx history:   {count} items cached\n',
        dataStrip_status: 'Status:       {status}',
        status_rateLimited: 'RATE-LIMITED',
        status_stale: 'stale (past cache TTL)',
        status_fresh: 'fresh',
        rateLimitBanner: '⚠ API limit reached! Backoff active ({sec}s) — displaying cached prices.',
        marketGraph24h: '24h',
        marketGraph3d: '3d',
        marketGraphLegendNative: 'Daily avg',
        marketGraphLegendIntraday: 'Intraday',
        marketGraphHoverPrice: '☉ {price}',
        settingsFeatMarketGraphCheckbox: 'Resource Market Intraday Graph 💹',
        settingsFeatMarketGraphHint: 'Overlay an intraday (24h/3d) price graph on resource market buy/sell modals.',
        settingsFeatPnlTrackerCheckbox: 'Daily P&L Tracker 📊',
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
        estNoOffers: 'Marktwert (geschätzt, keine Angebote): {val}',
        scrapedFloor: 'Marktwert (gescraptes Minimum): {val}',
        marketRoll: 'Marktwert für Roll: {val} (Minimum {floor}, {offers} Angebote)',
        stalePrices: '⚠ Veraltete Preise — in den Einstellungen aktualisieren',
        scrapeSuccess: '✓ {count} Equipment-Preise erfolgreich gescannt!',
        notEquipment: 'keine Ausrüstung',
        rangeLabelWeapon: 'Score {score} >= {threshold} [90% des Bereichs {min} - {max}]',
        rangeLabelArmor: 'Stat {stat}{pct} >= {threshold}{pct} [90% des Bereichs {min}{pct} - {max}{pct}]',
        topItemscore: 'Top-Itemscore',
        settingsGearTitle: 'Inventory Advisor Einstellungen',
        stockKeepReason: 'Lagerbestand: Top 3 Roll (#{rank} von {size} {label})',
        highRollT3: 'Hoher Roll: Basiswert {stat} >= 11 (T3 Blau)',
        critCondition: 'Kritischer Zustand: {tierLabel} Waffenkrit {crit}% >= {min}% (Bereich {range})',
        topRollOffers: 'Wert {stat} in den Top {pct}% von {offers} Live-Angeboten',
        notTopRollOffers: 'Wert {stat} nicht im Top-Roll ({offers} Angebote)',
        topRollInv: 'Wert {stat} in den Top {pct}% von {items} Inventar-Gegenständen',
        notTopRollInv: 'Wert {stat} nicht im Top-Roll im Inventar ({items} Gegenstände)',
        unknownRollRank: 'Roll-Rang unbekannt (keine Angebote/Inventarvergleich)',
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
        settingsFeatBattleHint: 'Hebt den richtigen Angriffs-/Verteidigungsbutton auf Kampfseiten hervor. Verbündete Ländercodes unten eingeben.',
        settingsAlliedCodesLabel: 'Verbündete Ländercodes (Komma-getrennt, z.B. de,pt)',
        settingsAlliedCodesPlaceholder: 'de,pt,...',
        settingsTitle: 'WareEra Inventory Advisor',
        gearTitle: 'WareEra Inventory Advisor — Einstellungen',
        settingsDesc: 'Der Inventory Advisor soll eine schnelle Übersicht geben, ob Items behalten (KEEP/HOLD), gewinnbringend verkauft (SELL) oder zerschreddert (SCRAP) werden sollten.',
        settingsApiToken: 'API-Token (api2.warera.io)',
        settingsTokenPlaceholder: 'Bearer-Token',
        settingsTokenNote: 'Lokal gespeichert (GM_setValue, leicht verschleiert — keine echte Verschlüsselung).',
        settingsLiveOffersCheckbox: 'Live-Angebote über API abrufen (benötigt API-Token)',
        settingsLiveOffersHint: 'Ruft aktuelle Angebote über die offizielle API ab, um Gegenstandswerte mit derzeit aktiven Angeboten zu vergleichen.',
        settingsScrapFlipCheckbox: 'Scrap-Flip-Indikator (experimentell)',
        settingsScrapFlipHint: 'Markiert profitable Gegenstände auf dem Markt, die für Gewinn gekauft und in Schrott zerlegt werden können.',
        scrapFlipTooltip: 'Kauf {buy} → Scrap {yield}×{unit} netto {net} = +{profit} Gewinn',
        hintToggleLabel: 'Erklärung',
        settingsFeatPillCheckbox: 'Pill-Reminder (konfigurierbares Pillen-Timing Overlay) 💊',
        settingsFeatPillHint: 'Zeigt einen Status und Countdown in der Menüleiste, markiert nimmbereite Pillen und prüft HP/Hunger-Werte.',
        settingsPillSettingsLabel: 'Optionen für Pillen-Timing',
        settingsPillBuffLabel: 'Buff-Dauer (Stunden)',
        settingsPillKnifeLabel: 'Messer-Dauer (Stunden)',
        settingsPillDebuffLabel: 'Debuff gesamt (Stunden)',
        settingsPillPrefFromLabel: 'Bevorzugtes Fenster ab',
        settingsPillPrefToLabel: 'Bevorzugtes Fenster bis',
        pillTakeNowOverlay: 'NEHMEN',
        pillTopUpOverlay: 'ERST FÜLLEN',
        pillPreferredWindow: '{from} - {to}',
        pillPhaseBuff: 'Aktiv ·',
        pillPhaseKnife: 'Messer ·',
        pillPhaseRecover: 'Regen ·',
        pillPhaseReady: 'BEREIT',
        pillPhaseGated: 'Pille in',
        pillGatingHeader: 'Pillen-Bedingungen',
        pillHeadlineWindow: 'ab {time}',
        pillHeadlineWindowTimer: '(in {duration})',
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
              <li>💎 <strong>KEEP (Blau)</strong>: Item behalten. Gilt für die Top 3 deines Bestands (pro Typ/Tier) oder falls das Item unter den besten 33% (Top-Roll) der Live-Angebote oder deines Inventars liegt.</li>
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
              <li>Zählt zur nächsten Pille runter — das Späteste aus: <em>H&amp;H voll</em>, <em>Debuff vorbei</em> und Beginn deines <em>Wunschfensters</em>.</li>
              <li>Buff/Debuff wird am Pillen-Icon auf deinem eigenen Profil erkannt. „kein Pillen-Anker" heißt nur: noch keiner erkannt.</li>
            </ul>
            <strong>H&amp;H-Budget-Balken:</strong>
            <ul>
              <li>Die Kerbe im Leben-/Hunger-Balken ist der <em>Floor</em>: bis dahin runterspielen, dann füllt dich die Regeneration bis zur Pillenzeit wieder auf 100%.</li>
              <li>Der helle Abschnitt über dem Floor ist <em>frei verspielbar</em> (attacken / gegessen werden). <em>✕ 0 frei</em> = nicht anfassen, du brauchst alles zum Auffüllen.</li>
            </ul>`,
        settingsPriceFormat: 'Preisformat: [Schrottwert]/[Marktpreis]',
        menuSettings: 'Inventory Advisor — Einstellungen',
        menuClearRescan: 'Cache leeren + neu scannen',
        gearTooltipTitle: 'Inventory Advisor — Einstellungen',
        gearTooltipScrapPrice: 'Schrottpreis: {price}/Einh. ({age})',
        gearTooltipItemPrices: 'Item-Preise: {count} im Cache ({age})',
        gearTooltipTxHistory: 'Transaktions-Verlauf: {count} Items im Cache',
        gearTooltipRateLimited: 'API-Limit — Wartezeit {sec}s',
        dataStrip_scrapPrice: 'Schrottpreis:  {price} / Einh.   (geladen {age})\n',
        dataStrip_itemPrices: 'Item-Preise:  {count} im Cache   (geladen {age})\n',
        dataStrip_scrapedMkt: 'Gescrapter Markt: {count} Items   (besuche Markt -> Ausrüstung zum Updaten)\n',
        dataStrip_txHistory: 'Transaktions-Verlauf: {count} Items im Cache\n',
        dataStrip_status: 'Status:       {status}',
        status_rateLimited: 'API-LIMITERREICHT',
        status_stale: 'veraltet (Cache TTL abgelaufen)',
        status_fresh: 'aktuell',
        rateLimitBanner: '⚠ API-Limit erreicht! Wartezeit aktiv ({sec}s) — zeige zwischengespeicherte Preise.',
        marketGraph24h: '24h',
        marketGraph3d: '3d',
        marketGraphLegendNative: 'Tagesschnitt',
        marketGraphLegendIntraday: 'Intraday',
        marketGraphHoverPrice: '☉ {price}',
        settingsFeatMarketGraphCheckbox: 'Ressourcen-Markt Intraday-Grafik 💹',
        settingsFeatMarketGraphHint: 'Blendet einen Intraday-Preisverlauf (24h/3d) im Kauf-/Verkaufs-Modal von Ressourcen ein.',
        settingsFeatPnlTrackerCheckbox: 'Täglicher P&L Tracker 📊',
        settingsFeatPnlTrackerHint: 'Zeigt deinen täglichen Gewinn/Verlust Tracker in der Topbar neben deinem Goldstand an.'
      }
    },

  };

  const originalTitles = new WeakMap();

  // ───────────────────────────────────────────────────────────────────────────
  // Storage (namespaced GM_* with light token obfuscation)
  // ───────────────────────────────────────────────────────────────────────────
  const NS = 'wia.';
  const KEYS = {
    token: NS + 'token',
    locale: NS + 'locale',
    priceCache: NS + 'priceCache',     // { data, fetchedAt } — materials map
    scrapCache: NS + 'scrapCache',     // { price, fetchedAt } — legacy, unused
    offersCache: NS + 'offersCache',   // { [itemCode]: { data, fetchedAt } } — equipment offers
    transactionsCache: NS + 'transactionsCache', // { [itemCode]: { data, fetchedAt } } — equipment transactions
    apiBase: NS + 'apiBase',
    rateLimitedUntil: NS + 'rlUntil',
    scrapedPrices: NS + 'scrapedPrices',
    useLiveOffersApi: NS + 'useLiveOffers',
    showScrapFlip: NS + 'scrapFlip',
    featNotes: NS + 'featNotes',
    featBattleAdvisor: NS + 'featBattle',
    alliedCountryCodes: NS + 'alliedCodes',
    featPillReminder: NS + 'featPill',
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
  };

  const memoryCache = {};

  function readCache(key) {
    if (memoryCache[key] !== undefined) {
      return memoryCache[key];
    }
    const val = GM_getValue(key, null);
    let defaultVal = {};
    if (key === KEYS.priceCache || key === KEYS.pnlLedger || key === KEYS.pnlYesterday || key === KEYS.pnlCostBasis || key === KEYS.pnlSnapshots) {
      defaultVal = null;
    }
    const valWithDefault = (val === undefined || val === null) ? defaultVal : val;
    memoryCache[key] = valWithDefault;
    return valWithDefault;
  }

  function writeCache(key, value) {
    memoryCache[key] = value;
    GM_setValue(key, value);
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
    writeCache(KEYS.priceCache, null);
    writeCache(KEYS.offersCache, {});
    writeCache(KEYS.transactionsCache, {});
    writeCache(KEYS.scrapedPrices, {});
    writeCache(KEYS.persistedAdvice, {});
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
    }
    menuSettingsId = GM_registerMenuCommand(t('menuSettings'), openSettings);
    menuClearId = GM_registerMenuCommand(t('menuClearRescan'), () => {
      clearCache();
      if (isInventoryPage()) scanInventory(true);
    });
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
    const cache = readCache(KEYS.priceCache);
    const scrapedStore = readCache(KEYS.scrapedPrices) || {};
    const scrapedScrap = scrapedStore[CONFIG.scrapItemCode];

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
          log('fetchPrices failed, using fallback:', e.message);
          renderRateLimitBanner();
          return cache ? cache.data : {}; // graceful fallback to stale/empty
        } finally {
          inFlightPrices = null;
        }
      })();
      baseData = await inFlightPrices;
    }

    // Inject/override scraped scrap price ONLY as fallback (if not already present from API)
    if (baseData[CONFIG.scrapItemCode] == null && scrapedScrap && now() - scrapedScrap.fetchedAt < CONFIG.scrapedPriceTtlMs) {
      baseData = { ...baseData, [CONFIG.scrapItemCode]: scrapedScrap.price };
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
      const store = readCache(KEYS.scrapedPrices) || {};
      const cached = store[code];
      if (cached && now() - cached.fetchedAt < CONFIG.scrapedPriceTtlMs) {
        return { offers: [], floor: cached.price, fetchedAt: cached.fetchedAt };
      }
      return null;
    }
    const store = readCache(KEYS.offersCache);
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
        const next = { ...readCache(KEYS.offersCache) };
        next[code] = { data, fetchedAt: now() };
        writeCache(KEYS.offersCache, next);
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
      const isProfile = isMarketPage() ? false : isInsideProfileEquipment(img);
      const card = climbToCard(img);
      if (verbose) {
        log(`  [Image #${idx}] alt="${img.getAttribute('alt')}" src="${img.getAttribute('src')}"`);
        log(`    isInsideModalOrSidebar: ${isModal}`);
        log(`    isInsideProfileEquipment: ${isProfile}`);
        log(`    climbToCard resolved element:`, card ? `${card.tagName}.${card.className}` : 'null');
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
    return cards;
  }

  // Returns the element that contains the image AND the stat/durability/equip siblings
  function getItemCell(card) {
    return card.closest('[aria-haspopup="dialog"]') || card.parentElement || card;
  }

  // The durability bar = the SMALLEST div that contains the scaleX fill (the bar strip),
  // not the outermost container (which spans the stat row). Fallback sorts by div depth.
  function findDurabilityBar(cell) {
    const matches = Array.from(cell.querySelectorAll('div')).filter(d => d.querySelector('[style*="scaleX"]'));
    if (!matches.length) return null;
    return matches.sort((a, b) => {
      const ha = a.offsetHeight || 0;
      const hb = b.offsetHeight || 0;
      if (ha !== hb) return ha - hb;
      return a.querySelectorAll('div').length - b.querySelectorAll('div').length;
    })[0];
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

  // Removes grown card minHeight and restores shifted image wrapper styles
  function cleanupCardHeader(card) {
    card.style.minHeight = '';
    delete card.dataset.wiaHeader;
    const imgWrap = card.querySelector('img')?.parentElement;
    if (imgWrap) {
      imgWrap.style.top = '';
      imgWrap.style.height = '';
      imgWrap.style.bottom = '';
      delete imgWrap.dataset.wiaShifted;
    }
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
    const numMatch = s.match(/-?\d+(?:[.,\s]\d+)*/);
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

    const parsed = parseFloat(numStr);
    return isNaN(parsed) ? null : parsed * multiplier;
  }

  function tierForCode(itemCode) {
    if (!itemCode) return null;
    const code = String(itemCode).trim().toLowerCase();
    const digitMatch = code.match(/(\d+)$/);
    if (digitMatch) return parseInt(digitMatch[1], 10);
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

  function computeScrapFlip(buyPrice, tier, scrapUnitPrice, sellTaxRate, yieldByTier) {
    if (buyPrice == null || tier == null || scrapUnitPrice == null) return null;
    const y = yieldByTier?.[tier];
    if (!y) return null;
    const scrapValue = y * scrapUnitPrice;
    const net = scrapValue * (1 - sellTaxRate);
    const profit = net - buyPrice;
    return { scrapValue, net, profit, flip: profit > 0, yield: y };
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.computeScrapFlip = computeScrapFlip;
    globalThis.tierForCode = tierForCode;
    globalThis.itemCodeFromUrl = itemCodeFromUrl;
    globalThis.isMarketGridPage = isMarketGridPage;
    globalThis.isMarketDetailPage = isMarketDetailPage;
    globalThis.CONFIG = CONFIG;
    // Export internal functions for unit tests
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
    globalThis.parseHealthAndHunger = parseHealthAndHunger;
    globalThis.updatePillState = updatePillState;
    globalThis.injectPillBadge = injectPillBadge;
    globalThis.highlightCocaineItems = highlightCocaineItems;
    globalThis.teardownPillReminder = teardownPillReminder;
    globalThis.renderHnHBudget = renderHnHBudget;
    globalThis.removeHnHBudget = removeHnHBudget;
    globalThis.nextWindowStart = nextWindowStart;
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
    globalThis.findItemCards = findItemCards;
    globalThis.writeCache = writeCache;
    globalThis.readCache = readCache;
    globalThis.fetchCurrentEquipmentDurability = fetchCurrentEquipmentDurability;
    globalThis.checkDurabilityWear = checkDurabilityWear;
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
    const cell = getItemCell(card);
    const cleanCard = cell.cloneNode(true);
    cleanCard.querySelectorAll('[class^="wia-"]').forEach((badge) => {
      badge.remove();
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

    // Remove stat icon containers from cleanCard so their values (like crit %)
    // do not leak into durability text parsing.
    cleanIcons.forEach((cleanIcon) => {
      const parentDiv = cleanIcon.closest('div');
      if (parentDiv && parentDiv !== cleanCard) {
        const container = parentDiv.className.includes('a6izou0') ? parentDiv.parentElement : parentDiv;
        if (container && container !== cleanCard) {
          container.remove();
        } else {
          parentDiv.remove();
        }
      } else {
        cleanIcon.remove();
      }
    });

    cleanCard.querySelectorAll('.wia-badge, .wia-score-sub, .wia-price-sub, .wia-top-banner, .a6izou0').forEach(child => {
      child.insertAdjacentText('afterend', ' ');
    });

    // durability = the trailing % in the card (the progress bar).
    const text = (cleanCard.textContent || '').replace(/\s+/g, ' ').trim();
    const percents = (text.match(/(\d+(?:[.,\s]\d+)?)\s*%/g) || [])
      .map(p => parseNum(p));
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
      const nums = text.match(/\d+(?:[.,\s]\d+)*/g) || [];
      if (nums.length === 1) {
        return parseNum(nums[0]);
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
    const m = (text || '').match(/(\d+(?:[.,\s]\d+)*)\s*(?:scraps?|schrott)/i);
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

    // market value from live offers (roll-aware)
    const offerData = item.code ? ctx.offers[item.code] : null;
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
      const label = type === 'weapon' ? (getLocale() === 'de' ? `Waffe (T${tier})` : `weapon (T${tier})`) : item.code;
      reasons.push(t('stockKeepReason', { rank: item.stockRank, size: item.stockSize, label: label }));
      return decide(ACTION.KEEP, reasons, market, scrapValue);
    }

    // 2) Rule: Blue (T3) shoes/gloves/vest/pants basestat >= 11
    if (tier === 3 && type !== 'weapon' && (type === 'boots' || type === 'gloves' || type === 'chest' || type === 'pants')) {
      if (myStat >= 11) {
        reasons.push(t('highRollT3', { stat: fmt(myStat) }));
        return decide(ACTION.KEEP, reasons, market, scrapValue);
      }
    }

    // 3) Rule: Weapon Crit checks to avoid scrap for T1/T2
    let avoidScrap = false;
    if (type === 'weapon') {
      const crit = stats.crit ?? 0;
      if (tier === 1 && crit >= 4) {
        avoidScrap = true;
        reasons.push(t('critCondition', { tierLabel: 'T1', crit: fmt(crit), min: '4.00', range: '1% - 5%' }));
      } else if (tier === 2 && crit >= 8) {
        avoidScrap = true;
        reasons.push(t('critCondition', { tierLabel: 'T2', crit: fmt(crit), min: '8.00', range: '6% - 10%' }));
      }
    }

    // 4) top roll -> KEEP (data-driven against live offers)
    const top = isTopRoll(offerData, type, myStat);
    if (top === true) {
      reasons.push(t('topRollOffers', { stat: fmt(myStat), pct: Math.round(CONFIG.goodRollTopFraction * 100), offers: item.offerCount }));
      return decide(ACTION.KEEP, reasons, market, scrapValue);
    }
    if (top === false) {
      reasons.push(t('notTopRollOffers', { stat: fmt(myStat), offers: item.offerCount }));
    } else {
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
    const oc = readCache(KEYS.offersCache) || {};
    const tc = readCache(KEYS.transactionsCache) || {};
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

  const WIA_HEADER_PX = 18;   // top strip height for score + bubble (tune live)

  function reserveCardLayout(card) {
    if (card.dataset.wiaHeader === '1') return;
    card.style.position = 'relative';
    card.style.minHeight = (48 + WIA_HEADER_PX) + 'px';
    card.dataset.wiaHeader = '1';
    const imgWrap = card.querySelector('img')?.parentElement;
    if (imgWrap) {
      imgWrap.style.top = WIA_HEADER_PX + 'px';
      imgWrap.style.height = 'auto';
      imgWrap.style.bottom = '0';
      imgWrap.dataset.wiaShifted = '1';
    }
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
    let badge = card.querySelector('.wia-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'wia-badge';
      card.appendChild(badge);
    }
    const emojiMap = { KEEP: '💎', SELL: '💰', SCRAP: '🔨', HOLD: '✋', UNKNOWN: '❓' };
    let text = emojiMap[result.action] || '❓';
    if (result.provisional) {
      text = '~' + text;
      card.dataset.wiaProvisional = '1';
    } else {
      delete card.dataset.wiaProvisional;
    }
    badge.textContent = text;
    badge.style.background = BADGE_COLORS[result.action] || BADGE_COLORS.UNKNOWN;
    badge.style.opacity = item.stale ? '0.55' : '1'; // dim when on cached/stale prices
    badge.style.top = Math.round(WIA_HEADER_PX / 2) + 'px';
    const tooltipText = buildTooltip(item, result);
    badge.title = tooltipText;
    card.title = tooltipText;

    // 3. Score Sub-badge
    let scoreSub = card.querySelector('.wia-score-sub');
    const showScore = item.myStat != null;
    if (showScore) {
      if (!scoreSub) {
        scoreSub = document.createElement('div');
        scoreSub.className = 'wia-score-sub';
        card.appendChild(scoreSub);
      }
      const scoreVal = item.myStat;
      scoreSub.textContent = item.type === 'weapon' ? scoreVal.toFixed(0) : scoreVal;
      // Blue if top 3 stock keep, otherwise gray
      const isGood = item.isStockKeep === true;
      scoreSub.style.background = isGood ? '#388bfd' : '#8b949e';
      scoreSub.style.top = Math.round(WIA_HEADER_PX / 2) + 'px';
      scoreSub.style.display = 'flex';
    } else if (scoreSub) {
      scoreSub.remove();
    }


    // 4. Price Sub-badge (only for 100% unequipped)
    const showPrice = result.scrapValue != null || result.market != null;
    let priceSub = cell.querySelector('.wia-price-sub');

    // Locate the durability progress-bar container inside the cell (contains scaleX style attribute)
    const durBar = findDurabilityBar(cell);

    if (showPrice && durBar) {
      suspendObserver();
      try {
        if (getComputedStyle(durBar).position === 'static') {
          durBar.style.position = 'relative';
        }
        durBar.dataset.wiaGrown = '1';
        durBar.style.minHeight = '26px';
        // Ensure priceSub is parented to durBar
        if (priceSub && priceSub.parentElement !== durBar) {
          priceSub.remove();
          priceSub = null;
        }
        if (!priceSub) {
          priceSub = document.createElement('div');
          priceSub.className = 'wia-price-sub';
          durBar.appendChild(priceSub);
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

        // Color: green if scrap > market, orange if scrap <= market, gray if either is null
        if (sVal != null && mVal != null) {
          priceSub.style.background = sVal > mVal ? '#3fb950' : '#d29922';
        } else {
          priceSub.style.background = '#8b949e';
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
    // market side: transactions reference, live offers (floor + count) or per-tier estimate
    if (item.marketSource === 'transactions') {
      const diffStr = item.txClosestDiff === 0 ? t('exactMatch') : t('diffMatch', { diff: fmt(item.txClosestDiff) });
      lines.push(t('txRef', { val: fmt(result.market), count: item.txClosestCount, diff: diffStr, total: item.txCount }));
    } else if (item.marketIsFallback) {
      lines.push(t('estNoOffers', { val: fmt(result.market) }));
    } else if (item.offerCount === 0 && item.marketFloor != null) {
      lines.push(t('scrapedFloor', { val: fmt(item.marketFloor) }));
    } else {
      lines.push(t('marketRoll', { val: fmt(result.market), floor: fmt(item.marketFloor), offers: item.offerCount }));
    }
    lines.push(`→ ${result.action}: ${result.reason}`);
    if (item.stale) lines.push(t('stalePrices'));
    return lines.join('\n');
  }

  function cleanupFlipBadge(el) {
    if (!el) return;
    const badge = el.querySelector('.wia-flip-badge');
    if (badge) badge.remove();
    if (el.classList && el.classList.contains('wia-flip-tile')) {
      el.classList.remove('wia-flip-tile');
    }
    if (el.dataset) {
      delete el.dataset.wiaFlip;
      delete el.dataset.wiaFlipPinned;
    }
    if (el.style && el.style.position === 'relative') {
      el.style.position = '';
    }
  }

  function renderFlipBadge(el, text, title, isPositive) {
    let badge = el.querySelector('.wia-flip-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'wia-flip-badge';
      el.appendChild(badge);
    }
    badge.textContent = text;
    badge.title = title;
    badge.classList.toggle('is-negative', !isPositive);
    el.classList.add('wia-flip-tile');
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
      el.dataset.wiaFlipPinned = '1';
    }
    el.dataset.wiaFlip = text;
  }

  function getFlipTitle(buyPrice, result, tier) {
    const buy = fmt(buyPrice);
    const unit = fmt(result.yield ? (result.scrapValue / result.yield) : null);
    return t('scrapFlipTooltip', {
      buy,
      yield: result.yield,
      unit,
      net: fmt(result.net),
      profit: fmt(result.profit),
      tier: tier != null ? tier : '?'
    });
  }

  function getScrapUnitPrice(prices) {
    return prices ? prices[CONFIG.scrapItemCode] ?? null : null;
  }

  function getMarketBuyPriceFromTile(tile) {
    if (!tile) return null;
    const icon = tile.querySelector('.a6izou0') || tile.querySelector('svg') || null;
    if (icon) {
      const n = numberNearClean(icon);
      if (n != null) return n;
    }
    const text = (tile.textContent || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/(\d+(?:[.,\s]\d+)*)/);
    return match ? parseNum(match[1]) : null;
  }

  async function renderScrapFlipIndicators() {
    if (!CONFIG.showScrapFlip || !isMarketGridPage()) return;
    const tiles = document.querySelectorAll("[id^='item-code-selector-']");
    if (!tiles.length) return;

    const prices = await fetchPrices(false);
    const scrapUnitPrice = getScrapUnitPrice(prices);
    if (scrapUnitPrice == null) return;

    const scrapedStore = readCache(KEYS.scrapedPrices) || {};
    suspendObserver();
    try {
      tiles.forEach((tile) => {
        const code = tile.id.replace('item-code-selector-', '').trim();
        if (!code || code === CONFIG.scrapItemCode) {
          cleanupFlipBadge(tile);
          return;
        }
        const tier = tierForCode(code);
        const rawBuyPrice = scrapedStore[code]?.price ?? getMarketBuyPriceFromTile(tile);
        // Grid floor can undercut the real cheapest offer -> inflate by a safety
        // margin so only clearly profitable tiles flip (avoids false positives).
        const buyPrice = rawBuyPrice != null
          ? rawBuyPrice * (1 + (CONFIG.scrapFlipGridMargin || 0))
          : null;
        const result = computeScrapFlip(buyPrice, tier, scrapUnitPrice, CONFIG.sellTaxRate, CONFIG.scrapYieldByTier);
        if (!result || !result.flip) {
          cleanupFlipBadge(tile);
          return;
        }
        const nextKey = `${result.profit.toFixed(3)}:${tier}`;
        if (tile.dataset.wiaFlip === nextKey) return;
        renderFlipBadge(
          tile,
          `🔨↑ +${fmt(result.profit)}`,
          getFlipTitle(rawBuyPrice, result, tier),
          true
        );
        tile.dataset.wiaFlip = nextKey;
      });
    } finally {
      resumeObserver();
    }
  }

  // Detail offer cards carry several .a6izou0 icons (attack, crit, AND price).
  // The price sits on the coin-stack icon; match it by its unique path signature
  // so we never mistake the attack value for the buy price.
  function getOfferBuyPrice(card) {
    if (!card) return null;
    const COIN_SIG = 'M12 5C7.031 5'; // coin-stack svg path prefix
    const icons = card.querySelectorAll('.a6izou0');
    for (const icon of icons) {
      const path = icon.querySelector('path');
      if (path && (path.getAttribute('d') || '').startsWith(COIN_SIG)) {
        const n = numberNearClean(icon);
        if (n != null) return n;
      }
    }
    return null;
  }

  async function renderScrapFlipOffers() {
    if (!CONFIG.showScrapFlip || !isMarketDetailPage()) return;

    const itemCode = itemCodeFromUrl();
    const tier = tierForCode(itemCode);
    if (itemCode == null || tier == null) return;

    const prices = await fetchPrices(false);
    const scrapUnitPrice = getScrapUnitPrice(prices);
    if (scrapUnitPrice == null) return;

    let cards = findItemCards(false);
    if (!cards.size) {
      // Fallback: collect ONLY offer cards holding this item's image.
      // Never query the generic .a6izou0 icon class — it exists site-wide
      // (chat, HUD, nav) and would stamp badges across the whole page.
      const root = document.querySelector('main') || document.body;
      const fallbackCards = new Map();
      root.querySelectorAll(CONFIG.itemImageSelector).forEach((img) => {
        if ((img.getAttribute('alt') || '').trim() !== itemCode) return;
        const card = climbToCard(img);
        if (card && !fallbackCards.has(card)) {
          fallbackCards.set(card, img);
        }
      });
      cards = fallbackCards;
    }

    suspendObserver();
    try {
      cards.forEach((img, card) => {
        const buyPrice = getOfferBuyPrice(card) ?? getMarketBuyPriceFromTile(card);
        const result = computeScrapFlip(buyPrice, tier, scrapUnitPrice, CONFIG.sellTaxRate, CONFIG.scrapYieldByTier);
        if (!result || !result.flip) {
          cleanupFlipBadge(card);
          return;
        }
        const nextKey = `${result.profit.toFixed(3)}:${tier}`;
        if (card.dataset.wiaFlip === nextKey) return;
        renderFlipBadge(
          card,
          `🔨↑ +${fmt(result.profit)}`,
          getFlipTitle(buyPrice, result, tier),
          true
        );
        card.dataset.wiaFlip = nextKey;
      });
    } finally {
      resumeObserver();
    }
  }

  async function renderScrapFlip() {
    if (!CONFIG.showScrapFlip || !isMarketPage()) {
      document.querySelectorAll('.wia-flip-badge').forEach((badge) => badge.remove());
      document.querySelectorAll('.wia-flip-tile').forEach((tile) => cleanupFlipBadge(tile));
      return;
    }
    if (isMarketDetailPage()) {
      await renderScrapFlipOffers();
    } else if (isMarketGridPage()) {
      await renderScrapFlipIndicators();
    }
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
    toast.textContent = t('scrapeSuccess', { count: count });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 500);
    }, 2500);
  }

  function scrapeMarketPrices() {
    const selectorElements = document.querySelectorAll("[id^='item-code-selector-']");
    if (!selectorElements.length) return;

    const store = { ...readCache(KEYS.scrapedPrices) };
    let updatedCount = 0;

    selectorElements.forEach(el => {
      const itemCode = el.id.replace('item-code-selector-', '').trim();
      if (!itemCode) return;

      const icon = el.querySelector('.a6izou0');
      let price = null;
      if (icon) {
        price = numberNearClean(icon);
      } else {
        const text = el.textContent || '';
        const match = text.match(/(\d+(?:[.,\s]\d+)*)/);
        if (match) {
          price = parseNum(match[1]);
        }
      }

      if (price != null && !isNaN(price)) {
        const old = store[itemCode];
        if (!old || old.price !== price || now() - old.fetchedAt > 10 * 60 * 1000) {
          store[itemCode] = { price, fetchedAt: now() };
          updatedCount++;
        }
      }
    });

    if (updatedCount > 0) {
      writeCache(KEYS.scrapedPrices, store);
      log(`Scraped ${updatedCount} updated prices`);
      showScrapeNotification(updatedCount);
    }
    if (isMarketPage()) {
      renderScrapFlip().catch((e) => log('renderScrapFlip error:', e));
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
  const lastInventoryCardTexts = new Map();

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

  function hasInventoryChanged(cards) {
    if (!lastInventoryCards || lastInventoryCards.size !== cards.size) return true;

    const lastKeys = lastInventoryCards.keys();
    for (const [card, img] of cards.entries()) {
      const lastCard = lastKeys.next().value;
      if (card !== lastCard) return true;

      const lastImg = lastInventoryCards.get(card);
      if (img !== lastImg) return true;
      if (img.getAttribute('src') !== lastImg.getAttribute('src')) return true;
      if (img.getAttribute('alt') !== lastImg.getAttribute('alt')) return true;

      const itemId = findItemUniqueId(card);
      const lastItemId = findItemUniqueId(lastCard);
      if (itemId !== lastItemId) return true;

      if (!card.querySelector('.wia-badge') && !card.dataset.wiaSuppressed) return true;

      const currentText = getCardBaseText(card);
      const lastText = lastInventoryCardTexts.get(card);
      if (currentText !== lastText) return true;
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
        if (shouldSuppressItem(card, stats)) return;
        const resolvedTier = tier != null ? tier : detectTierByColor(card);
        const item = { card, img, type, alt, code: cCode, tier: resolvedTier, stats };
        item.myStat = itemStat(item);
        if (type === 'weapon') item.weaponScore = item.myStat;
        allItems.push(item);
      });

      if (!allItems.length) return;

      calculateInventoryRankings(allItems);

      const pc = readCache(KEYS.priceCache);
      const currentPriceFetchedAt = pc ? pc.fetchedAt : 0;
      const prices = pc ? pc.data : {};
      const scrapPrice = prices ? prices[CONFIG.scrapItemCode] ?? null : null;

      const oc = readCache(KEYS.offersCache);
      const tc = readCache(KEYS.transactionsCache);
      const scraped = readCache(KEYS.scrapedPrices);

      const offers = {};
      const txs = {};
      const uniqueCodes = [...new Set(allItems.map((i) => i.code).filter(Boolean))];

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
            const card = reResolveCard(item.card);
            if (!card) return;
            item.card = card;

            const itemId = findItemUniqueId(card);
            const statsHash = JSON.stringify(item.stats);
            const fresh = hasFreshCachedData(item.code);

            let result = evaluate(item, ctx);
            if (!fresh) {
              result = { ...result };
              result.provisional = true;
            } else {
              setPersistedAdvice(itemId, result, statsHash, currentPriceFetchedAt);
            }
            renderItem(card, item, result);
          }
        });
      } finally {
        resumeObserver();
      }
      updateStatusIndicator();
      if (isMarketPage()) {
        await renderScrapFlip();
      }
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

    bypassNextScanDebounce = false;

    log(`scanInventory started (force=${force})`);
    scanning = true;
    lastInventoryCards = cards;
    lastInventoryCardTexts.clear();
    cards.forEach((img, card) => {
      lastInventoryCardTexts.set(card, getCardBaseText(card));
    });

    try {
      // Synchronously reserve layout for all valid cards upfront
      suspendObserver();
      try {
        cards.forEach((img, card) => {
          const { type } = detectType(img, card);
          if (type === 'scrap' || type === 'unknown') return;
          const stats = parseStats(card, type);
          if (shouldSuppressItem(card, stats)) return;
          reserveCardLayout(card);
        });
      } finally {
        resumeObserver();
      }

      const items = [];
      cards.forEach((img, card) => {
        const { type, alt, code, tier } = detectType(img, card);
        if (type === 'scrap' || type === 'unknown') return;
        const stats = parseStats(card, type);
        
        if (!originalTitles.has(card)) {
          originalTitles.set(card, card.title || '');
        }

        if (shouldSuppressItem(card, stats)) {
          suspendObserver();
          try {
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
          } finally {
            resumeObserver();
          }
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

      // Synchronous Price Cache loading
      const pc = readCache(KEYS.priceCache);
      const currentPriceFetchedAt = pc ? pc.fetchedAt : 0;
      const prices = pc ? pc.data : {};
      const scrapPrice = prices ? prices[CONFIG.scrapItemCode] ?? null : null;

      const oc = readCache(KEYS.offersCache);
      const tc = readCache(KEYS.transactionsCache);
      const scraped = readCache(KEYS.scrapedPrices);

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
      if (isMarketPage()) {
        await renderScrapFlip();
      }

      // Background Async Loads
      const isGlobalPriceStale = !pc || now() - pc.fetchedAt >= CONFIG.priceCacheTtlMs;
      if (isGlobalPriceStale || codesToFetch.length > 0 || force) {
        (async () => {
          try {
            if (isGlobalPriceStale || force) {
              await (globalThis.fetchPrices || fetchPrices)(force);
            }

            if (codesToFetch.length > 0) {
              log(`Triggering background loads for: ${codesToFetch.join(', ')}`);
              await Promise.all(codesToFetch.map((c) => fetchAndRenderItemCodeInBackground(c, force)));
            } else if (isGlobalPriceStale || force) {
              log('Re-evaluating items after global price update...');
              const nextPc = readCache(KEYS.priceCache);
              const nextPriceFetchedAt = nextPc ? nextPc.fetchedAt : 0;
              const nextPrices = nextPc ? nextPc.data : {};
              const nextScrapPrice = nextPrices ? nextPrices[CONFIG.scrapItemCode] ?? null : null;

              const nextCtx = {
                prices: nextPrices,
                scrapPrice: nextScrapPrice,
                offers: ctx.offers,
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
        position: absolute; right: 2px; transform: translateY(-50%); z-index: 50;
        width: 16px; height: 16px; border-radius: 50%;
        font: 10px system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        cursor: help; box-shadow: 0 0 4px rgba(0,0,0,.6);
        user-select: none;
        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      }
      .wia-score-sub {
        position: absolute; left: 2px; transform: translateY(-50%); z-index: 60;
        font: bold 8px system-ui, sans-serif; padding: 1px 3px; border-radius: 4px;
        color: #fff; display: flex; align-items: center; justify-content: center;
        text-shadow: 0 1px 1px rgba(0,0,0,.5); box-shadow: 1px 1px 2px rgba(0,0,0,.3);
      }
      .wia-price-sub {
        position: absolute; bottom: 0; left: 0; right: 0; z-index: 60;
        font: bold 10px system-ui, sans-serif; padding: 0 2px; border-radius: 0 0 4px 4px;
        color: #fff; display: flex; flex-direction: column; align-items: stretch; gap: 0;
        line-height: 1.1; letter-spacing: -0.3px;
        justify-content: center;
        /* 4-way black outline for contrast over any bar color (same trick as .wia-badge) */
        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
        box-shadow: 0 -1px 2px rgba(0,0,0,.3);
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
        position: relative;
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
      .wia-flip-badge {
        /* Bottom ribbon pinned INSIDE the tile (where the inventory-quantity
           banner — always "-" on the equipment market — normally sits), so the
           indicator never overflows the tile bounds. left+right constrain the
           width to the tile; overflow clips gracefully on tiny tiles. */
        position: absolute; left: 2px; right: 2px; bottom: 2px; z-index: 70;
        display: flex; align-items: center; justify-content: center; gap: 2px;
        padding: 1px 3px; border-radius: 4px;
        font: 700 9px/1.1 system-ui, sans-serif;
        color: #06210f; background: #3fb950;
        box-shadow: 0 1px 4px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.25);
        pointer-events: none; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .wia-flip-badge.is-negative {
        color: #fff; background: #8b949e;
      }
      .wia-flip-tile {
        box-shadow: inset 0 0 0 2px #3fb950 !important;
      }
      
      /* ── Pill Reminder module styles ── */
      /* Mimic WareEra's native top-bar chips: pill shape, dark translucent
         fill, hairline border, drop-shadowed glyph/text. Phase is carried by a
         glowing status LED + border tint, NOT a saturated block fill — so the
         badge reads as "another game indicator", not a foreign widget. */
      #wia-pill-badge {
        display: inline-flex; align-items: center; justify-content: center;
        position: relative; margin: 0 8px;
        font: 600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        border-radius: 999px; padding: 5px 12px; cursor: pointer; user-select: none;
        z-index: 10000; min-height: 28px; box-sizing: border-box;
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
      .wia-pill-row { display: flex; align-items: center; gap: 6px; }
      .wia-pill-status-dot {
        width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto;
        background: #8b949e; box-shadow: 0 0 5px currentColor;
      }
      .wia-badge-buff    .wia-pill-status-dot { background: #3fb950; box-shadow: 0 0 5px rgba(63,185,80,.9); }
      .wia-badge-knife   .wia-pill-status-dot { background: #58a6ff; box-shadow: 0 0 5px rgba(88,166,255,.9); }
      .wia-badge-recover .wia-pill-status-dot { background: #e3b341; box-shadow: 0 0 5px rgba(227,179,65,.9); }
      .wia-badge-ready   .wia-pill-status-dot { background: #3fb950; box-shadow: 0 0 6px rgba(63,185,80,1); }
      .wia-badge-gated   .wia-pill-status-dot { background: #8b949e; box-shadow: 0 0 4px rgba(139,148,158,.7); }
      .wia-pill-phase-lbl { font-size: 11px; font-weight: 600; opacity: .82; letter-spacing: .2px; }
      .wia-pill-timer { color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }
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
      .wia-pill-detail-item { margin-bottom: 6px; }
      .wia-pill-detail-item strong { color: #58a6ff; }

      .wia-cocain-highlight {
        outline: 2px solid #238636 !important; outline-offset: -2px;
        animation: wia-pulse-border 1.5s infinite alternate; position: relative;
      }
      .wia-cocain-gated-highlight {
        outline: 2px solid #d29922 !important; outline-offset: -2px;
        position: relative;
      }
      @keyframes wia-pulse-border {
        0% { outline-color: #238636; }
        100% { outline-color: #2ea043; }
      }
      .wia-cocain-highlight::after {
        content: attr(data-label); position: absolute; top: 2px; right: 2px;
        background: #238636; color: #fff; font-size: 8px; font-weight: bold;
        padding: 1px 3px; border-radius: 2px; pointer-events: none; z-index: 10;
      }
      .wia-cocain-gated-highlight::after {
        content: attr(data-label); position: absolute; top: 2px; right: 2px;
        background: #d29922; color: #fff; font-size: 8px; font-weight: bold;
        padding: 1px 3px; border-radius: 2px; pointer-events: none; z-index: 10;
      }

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
        max-width: 200px; overflow: hidden;
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

  // Live data strip inside the settings modal. Built with textContent (never
  // innerHTML) so cached values can't become an injection vector.
  function renderDataStrip(el) {
    if (!el) return;
    const s = cacheStatus();
    const scraped = readCache(KEYS.scrapedPrices);
    const scrapedCount = Object.keys(scraped).length;
    const statusText = isRateLimited()
      ? t('status_rateLimited')
      : s.stale
        ? t('status_stale')
        : t('status_fresh');

    el.textContent =
      t('dataStrip_scrapPrice', { price: fmt(s.scrapPrice), age: ageLabel(s.scrapFetchedAt) }) +
      t('dataStrip_itemPrices', { count: s.priceCount, age: ageLabel(s.priceFetchedAt) }) +
      t('dataStrip_scrapedMkt', { count: scrapedCount }) +
      t('dataStrip_txHistory', { count: s.txCodes || 0 }) +
      t('dataStrip_status', { status: statusText });
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
      warnBanner.style.display = 'none';
    }
  }

  function renderSettingsModal(bg) {
    if (!bg) return;
    const currentLocale = getLocale();
    const nextLocale = currentLocale === 'de' ? 'en' : 'de';
    const prevToken = bg.querySelector('.wia-token')?.value ?? getToken();
    const prevLiveOffers = bg.querySelector('.wia-live-offers')?.checked ?? CONFIG.useLiveOffersApi;
    const prevScrapFlip = bg.querySelector('.wia-scrap-flip')?.checked ?? CONFIG.showScrapFlip;
    const prevFeatNotes = bg.querySelector('.wia-feat-notes')?.checked ?? CONFIG.featNotes;
    const prevFeatBattle = bg.querySelector('.wia-feat-battle')?.checked ?? CONFIG.featBattleAdvisor;
    const prevAlliedCodes = bg.querySelector('.wia-allied-codes')?.value ?? CONFIG.alliedCountryCodes.join(',');
    const prevFeatPill = bg.querySelector('.wia-feat-pill')?.checked ?? CONFIG.featPillReminder;
    const prevFeatMarketGraph = bg.querySelector('.wia-feat-market-graph')?.checked ?? CONFIG.featMarketGraph;
    const prevFeatPnlTracker = bg.querySelector('.wia-feat-pnl-tracker')?.checked ?? CONFIG.featPnlTracker;
    const prevPillBuff = bg.querySelector('.wia-pill-buff')?.value ?? CONFIG.pillBuffH;
    const prevPillKnife = bg.querySelector('.wia-pill-knife')?.value ?? CONFIG.pillKnifeH;
    const prevPillDebuff = bg.querySelector('.wia-pill-debuff')?.value ?? CONFIG.pillDebuffH;
    const prevPillPrefFrom = bg.querySelector('.wia-pill-pref-from')?.value ?? CONFIG.pillPrefWindowFrom;
    const prevPillPrefTo = bg.querySelector('.wia-pill-pref-to')?.value ?? CONFIG.pillPrefWindowTo;

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
        <div class="wia-data"></div>
        <label>${t('settingsApiToken')}</label>
        <input type="password" class="wia-token" placeholder="${t('settingsTokenPlaceholder')}" />
        <div class="wia-note">${t('settingsTokenNote')}</div>
        <div class="wia-feat-row" style="margin-top: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-live-offers" style="width: auto;" ${prevLiveOffers ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsLiveOffersCheckbox')}</label>
            <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
          </div>
          <div class="wia-hint" hidden>${t('settingsLiveOffersHint')}</div>
        </div>
        <div class="wia-feat-row" style="margin-top: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-scrap-flip" style="width: auto;" ${prevScrapFlip ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsScrapFlipCheckbox')}</label>
            <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
          </div>
          <div class="wia-hint" hidden>${t('settingsScrapFlipHint')}</div>
        </div>
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
          <details class="wia-allied-codes-row" style="margin-top: 4px; margin-left: 24px;" ${prevFeatBattle ? 'open' : ''}>
            <summary style="font-size: 11px; color: #8b949e; cursor: pointer; user-select: none; font-weight: bold; outline: none; margin-bottom: 4px;">
              ${t('settingsAlliedCodesLabel')}
            </summary>
            <input type="text" class="wia-allied-codes" placeholder="${t('settingsAlliedCodesPlaceholder')}" style="width: 100%; box-sizing: border-box; background: #020617; border: 1px solid rgba(148,163,184,.42); border-radius: 4px; color: #f9fafb; padding: 4px 8px; font-size: 12px; margin-top: 2px;" value="${prevAlliedCodes}" />
          </details>
        </div>
        <div class="wia-feat-row" style="margin-top: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="wia-feat-pill" style="width: auto;" ${prevFeatPill ? 'checked' : ''} />
            <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsFeatPillCheckbox')}</label>
            <button type="button" class="wia-hint-toggle" aria-expanded="false" aria-label="${t('hintToggleLabel')}" title="${t('hintToggleLabel')}">ℹ</button>
          </div>
          <div class="wia-hint" hidden>${t('settingsFeatPillHint')}</div>
          <details class="wia-pill-settings-row" style="margin-top: 6px; margin-left: 24px;" ${prevFeatPill ? 'open' : ''}>
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

    const modal = bg.querySelector('.wia-modal');
    const dataStrip = bg.querySelector('.wia-data');
    const tokenInput = bg.querySelector('.wia-token');
    const localeBtn = bg.querySelector('.wia-locale-btn');
    const localeMenu = bg.querySelector('.wia-locale-menu');
    const localeItem = bg.querySelector('.wia-locale-item');

    tokenInput.value = prevToken;
    warnBanner = bg.querySelector('.wia-warn');
    renderDataStrip(dataStrip);
    renderRateLimitBanner();

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

    const featBattleCheckbox = modal.querySelector('.wia-feat-battle');
    const alliedCodesRow = modal.querySelector('.wia-allied-codes-row');
    if (featBattleCheckbox && alliedCodesRow) {
      featBattleCheckbox.onchange = () => {
        if (featBattleCheckbox.checked) {
          alliedCodesRow.setAttribute('open', '');
        } else {
          alliedCodesRow.removeAttribute('open');
        }
      };
    }

    const featPillCheckbox = modal.querySelector('.wia-feat-pill');
    const pillSettingsRow = modal.querySelector('.wia-pill-settings-row');
    if (featPillCheckbox && pillSettingsRow) {
      featPillCheckbox.onchange = () => {
        if (featPillCheckbox.checked) {
          pillSettingsRow.setAttribute('open', '');
        } else {
          pillSettingsRow.removeAttribute('open');
        }
      };
    }

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

    bg.querySelector('.wia-save').onclick = () => {
      const newToken = tokenInput.value.trim();
      const tokenChanged = prevToken !== newToken;
      setToken(newToken);

      const useLiveOffers = bg.querySelector('.wia-live-offers').checked;
      GM_setValue(KEYS.useLiveOffersApi, useLiveOffers);
      CONFIG.useLiveOffersApi = useLiveOffers;

      const showScrapFlip = bg.querySelector('.wia-scrap-flip').checked;
      GM_setValue(KEYS.showScrapFlip, showScrapFlip);
      CONFIG.showScrapFlip = showScrapFlip;

      const featNotes = bg.querySelector('.wia-feat-notes').checked;
      GM_setValue(KEYS.featNotes, featNotes);
      CONFIG.featNotes = featNotes;
      if (featNotes) { initNotes(); } else { teardownNotes(); }

      const featBattle = bg.querySelector('.wia-feat-battle').checked;
      const rawCodes = bg.querySelector('.wia-allied-codes').value;
      const alliedCodes = rawCodes.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
      GM_setValue(KEYS.featBattleAdvisor, featBattle);
      GM_setValue(KEYS.alliedCountryCodes, alliedCodes);
      CONFIG.featBattleAdvisor = featBattle;
      CONFIG.alliedCountryCodes = alliedCodes;
      if (featBattle && isBattlePage()) { applyBattleAdvisory(); } else { teardownBattleAdvisory(); }

      const featPill = bg.querySelector('.wia-feat-pill').checked;
      GM_setValue(KEYS.featPillReminder, featPill);
      CONFIG.featPillReminder = featPill;

      const buffVal = parseFloat(bg.querySelector('.wia-pill-buff').value) || 8;
      GM_setValue(KEYS.pillBuffH, buffVal);
      CONFIG.pillBuffH = buffVal;

      const knifeVal = parseFloat(bg.querySelector('.wia-pill-knife').value) || 6;
      GM_setValue(KEYS.pillKnifeH, knifeVal);
      CONFIG.pillKnifeH = knifeVal;

      const debuffVal = parseFloat(bg.querySelector('.wia-pill-debuff').value) || 15.5;
      GM_setValue(KEYS.pillDebuffH, debuffVal);
      CONFIG.pillDebuffH = debuffVal;

      const prefFrom = bg.querySelector('.wia-pill-pref-from').value.trim() || '19:00';
      GM_setValue(KEYS.pillPrefWindowFrom, prefFrom);
      CONFIG.pillPrefWindowFrom = prefFrom;

      const prefTo = bg.querySelector('.wia-pill-pref-to').value.trim() || '20:00';
      GM_setValue(KEYS.pillPrefWindowTo, prefTo);
      CONFIG.pillPrefWindowTo = prefTo;

      if (featPill) { initPillReminder(); } else { teardownPillReminder(); }

      const featMarketGraph = bg.querySelector('.wia-feat-market-graph').checked;
      GM_setValue(KEYS.featMarketGraph, featMarketGraph);
      CONFIG.featMarketGraph = featMarketGraph;
      if (featMarketGraph) { initMarketGraph(); } else { teardownMarketGraph(); }

      const featPnlTracker = bg.querySelector('.wia-feat-pnl-tracker').checked;
      GM_setValue(KEYS.featPnlTracker, featPnlTracker);
      CONFIG.featPnlTracker = featPnlTracker;
      if (featPnlTracker) { initPnlTracker(); } else { teardownPnlTracker(); }

      if (tokenChanged) {
        clearCache();
      }
      bg.remove();
      warnBanner = null;
      settingsModalBg = null;
      if (isMarketPage()) {
        renderScrapFlip().catch((e) => log('renderScrapFlip error:', e));
      }
      scanInventory(tokenChanged);
    };
    bg.querySelector('.wia-clear').onclick = () => { clearCache(); renderDataStrip(dataStrip); updateStatusIndicator(); };
    bg.querySelector('.wia-close').onclick = () => { bg.remove(); warnBanner = null; settingsModalBg = null; };
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

  // ───────────────────────────────────────────────────────────────────────────
  // Bootstrap + MutationObserver
  // ───────────────────────────────────────────────────────────────────────────
  function isInventoryPage() {
    return /\/user\/[^/]+\/inventory/.test(location.pathname);
  }

  function isMarketPage() {
    return /\/market\/equipments/.test(location.pathname);
  }

  let bootstrapObserver = null;
  let bypassNextScanDebounce = false;
  let routePollFrame = null;

  const debouncedScan = debounce(() => {
    if (isInventoryPage()) {
      scanInventory(false);
    } else if (isMarketPage()) {
      scrapeMarketPrices();
      scanInventory(false);
    }
  }, CONFIG.rescanDebounceMs);

  function triggerScan(force = false) {
    if (bypassNextScanDebounce) {
      bypassNextScanDebounce = false;
      if (isInventoryPage()) {
        scanInventory(force);
      } else if (isMarketPage()) {
        scrapeMarketPrices();
        scanInventory(force);
      }
    } else {
      debouncedScan();
    }
  }

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
    } else if (isMarketPage()) {
      const sellContainer = findMarketSellContainer();
      if (sellContainer) {
        log(`Observing market sell container:`, sellContainer);
        observer.observe(sellContainer, { childList: true, subtree: true });
        return;
      }
    }
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
      } else if (isMarketPage()) {
        scrapeMarketPrices();
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
        } else if (isMarketPage()) {
          scrapeMarketPrices();
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
    
    if (isInventoryPage() || isMarketPage()) {
      updateObserverTarget();
      if (document.querySelector("[id^='item-code-selector-']") || findItemCards().size > 0) {
        log('Route change: cards exist immediately, scanning');
        if (isInventoryPage()) {
          scanInventory(false);
        } else if (isMarketPage()) {
          scrapeMarketPrices();
          scanInventory(false);
        }
      } else {
        initBootstrapObserver();
        startRoutePolling();
      }
    } else if (isBattlePage()) {
      observer.disconnect();
      if (CONFIG.featBattleAdvisor) applyBattleAdvisory();
    } else {
      teardownBattleAdvisory();
      observer.disconnect();
    }
    
    if (CONFIG.featPillReminder) {
      setTimeout(tickPillReminder, 50);
    }

    if (CONFIG.featPnlTracker) {
      setTimeout(updatePnlUi, 50);
    }
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

    // Fallback: structural — check both defender and attacker parents independently for orders (country or MU)
    const defParent = defBtn.parentElement?.parentElement;
    const atkParent = atkBtn.parentElement?.parentElement;

    const defHasOrders = !!(defParent && defParent.querySelector('a[href*="/country/"], a[href*="/mu/"]'));
    const atkHasOrders = !!(atkParent && atkParent.querySelector('a[href*="/country/"], a[href*="/mu/"]'));

    // Highlight only if exactly one side has orders (never guess if both or neither do)
    if (defHasOrders && !atkHasOrders) return 'defender';
    if (atkHasOrders && !defHasOrders) return 'attacker';

    return null; // unknown — never highlight a guess
  }

  function injectCompactOrders(btnEl) {
    if (!btnEl) return;
    const column = btnEl.parentElement?.parentElement;
    if (!column) return;

    const rows = column.querySelectorAll('a[href*="/country/"], a[href*="/mu/"]');
    if (!rows.length) return;

    const strip = document.createElement('span');
    strip.className = 'wia-compact-orders';
    strip.setAttribute('data-wia-injected', 'true');

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

  function applyBattleAdvisory() {
    const defBtn = document.querySelector('#defender-hit-button');
    const atkBtn = document.querySelector('#attacker-hit-button');
    if (!defBtn || !atkBtn) {
      // Buttons not yet in DOM — retry shortly (SPA lazy-load)
      setTimeout(applyBattleAdvisory, 400);
      return;
    }

    teardownBattleAdvisory(); // clean previous pass

    // Unconditionally inject compact orders for each side if present
    injectCompactOrders(defBtn);
    injectCompactOrders(atkBtn);

    const side = detectAllySide();
    if (!side) return; // unknown side — leave highlighting untouched

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
  // Notes module (ported from warera-notes.user.js — reuses same GM keys/selectors
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
      if (CONFIG.featMarketGraph && isMarketPage()) {
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
      triggerCraftingAdvisorCheck();
    });
    sharedBodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function teardownSharedBodyObserver() {
    if (!CONFIG.featNotes && !CONFIG.featMarketGraph) {
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
    document.querySelectorAll('[' + NOTES_ATTR + ']').forEach(el => el.removeAttribute(NOTES_ATTR));
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
      if (link.getAttribute(NOTES_ATTR) === 'true') return; // already attached (by us or standalone script)
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
      const m = url.pathname.match(/^\/user\/([^/]+)\/?$/);
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
    link.setAttribute(NOTES_ATTR, 'true');
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
  // Pill Reminder module
  // ───────────────────────────────────────────────────────────────────────────
  let pillInterval = null;
  let pillObserved = false;
  let pillBarObserver = null;
  let pillUpdateTimer = null;
  const PILL_OBS_OPTS = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] };
  let noneReadCount = 0;

  function initPillReminder() {
    if (pillInterval) clearInterval(pillInterval);
    pillInterval = setInterval(tickPillReminder, 10000);
    tickPillReminder();

    if (!pillObserved) {
      document.addEventListener('click', handlePillDocumentClick);
      pillObserved = true;
    }
    observePillBars();
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
    if (pillUpdateTimer) { clearTimeout(pillUpdateTimer); pillUpdateTimer = null; }
    noneReadCount = 0;
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
  }

  function isInsidePreferredWindow(now) {
    if (!CONFIG.pillPrefWindowFrom) return true;
    const partsFrom = CONFIG.pillPrefWindowFrom.split(':');
    if (partsFrom.length !== 2) return true;
    const fromHrs = parseInt(partsFrom[0], 10);
    const fromMins = parseInt(partsFrom[1], 10);

    let dFrom = new Date(now);
    dFrom.setHours(fromHrs, fromMins, 0, 0);

    let dTo = null;
    if (CONFIG.pillPrefWindowTo) {
      const partsTo = CONFIG.pillPrefWindowTo.split(':');
      if (partsTo.length === 2) {
        const toHrs = parseInt(partsTo[0], 10);
        const toMins = parseInt(partsTo[1], 10);
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

  function nextWindowStart(now) {
    if (!CONFIG.pillPrefWindowFrom) return 0;
    if (isInsidePreferredWindow(now)) return now;

    const parts = CONFIG.pillPrefWindowFrom.split(':');
    if (parts.length !== 2) return now;
    const hrs = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    
    let d = new Date(now);
    d.setHours(hrs, mins, 0, 0);
    if (d.getTime() < now) {
      d.setDate(d.getDate() + 1);
      d.setHours(hrs, mins, 0, 0);
    }
    return d.getTime();
  }

  function getNextPillMoment() {
    const pillTakenAt = GM_getValue(KEYS.pillTakenAt, 0);
    if (!pillTakenAt) return 0;
    const totalMs = (CONFIG.pillBuffH + CONFIG.pillDebuffH) * 3600000;
    const rawTarget = pillTakenAt + totalMs;

    const now = Date.now();
    let target = Math.max(now, rawTarget);

    if (CONFIG.pillPrefWindowFrom) {
      const parts = CONFIG.pillPrefWindowFrom.split(':');
      if (parts.length === 2) {
        const hrs = parseInt(parts[0], 10);
        const mins = parseInt(parts[1], 10);
        
        let d = new Date(target);
        d.setHours(hrs, mins, 0, 0);
        if (d.getTime() < target) {
          d.setDate(d.getDate() + 1);
          d.setHours(hrs, mins, 0, 0);
        }
        target = d.getTime();
      }
    }
    return target;
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
    // containing block) — only add positioning if it's somehow static. Never
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
        current = parseFloat(mSingle[1]);
        max = parseFloat(mSingle[2]);
      } else {
        // Format B: "/130" (split spans)
        const mSplit = text.match(/^\/\s*(\d+)$/);
        if (mSplit) {
          max = parseFloat(mSplit[1]);
          const prev = el.previousElementSibling;
          if (prev) {
            const prevText = prev.textContent.trim();
            const mPrev = prevText.match(/^(\d+(?:\.\d+)?)$/);
            if (mPrev) {
              current = parseFloat(mPrev[1]);
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
                    detectedRegen = parseFloat(mRegen[1]);
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
              hrs = parseInt(m[1] || '0', 10);
              mins = parseInt(m[2] || '0', 10);
              secs = parseInt(m[3] || '0', 10);
              matchedUnit = true;
            } else {
              m = text.match(/\b(?:(\d+)h\s*)?(\d+)m\b/i);
              if (m) {
                hrs = parseInt(m[1] || '0', 10);
                mins = parseInt(m[2] || '0', 10);
                matchedUnit = true;
              } else {
                m = text.match(/\b(\d+)h\b/i);
                if (m) {
                  hrs = parseInt(m[1] || '0', 10);
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
      return t('pillGateWindowWait', { time: CONFIG.pillPrefWindowFrom, duration: durationStr });
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
    const knifeMs = CONFIG.pillKnifeH * 3600000;
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
    } else if (pillTakenAt > 0 && elapsed < buffMs + knifeMs) {
      phase = 'KNIFE';
      phaseLabel = t('pillPhaseKnife');
      timerStr = getBuffDebuffTimerStr(now);
      nextTransitionLabel = t('pillPhaseRecover');
      nextTransitionTime = formatAbsoluteTime(pillTakenAt + buffMs + knifeMs);
      badgeClass = 'wia-badge-knife';
    } else if (pillTakenAt > 0 && elapsed < totalMs) {
      phase = 'RECOVER';
      phaseLabel = t('pillPhaseRecover');
      timerStr = getBuffDebuffTimerStr(now);
      nextTransitionLabel = t('pillPhaseReady');
      nextTransitionTime = formatAbsoluteTime(pillTakenAt + totalMs);
      badgeClass = 'wia-badge-recover';
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
      } else {
        phase = 'GATED';
        badgeClass = 'wia-badge-gated';
        const lowestPct = Math.round(Math.min(status.hpPercent, status.hungerPercent));

        if (windowStart === nextPill && CONFIG.pillPrefWindowFrom) {
          phaseLabel = t('pillHeadlineWindow', { time: CONFIG.pillPrefWindowFrom });
          timerStr = t('pillHeadlineWindowTimer', { duration: formatDuration(windowStart - now) });
        } else if (hAndHFullETA === nextPill && totalTicks > 0) {
          phaseLabel = t('pillHeadlineHnH');
          timerStr = t('pillHeadlineHnHTimer', { duration: formatDuration(hAndHFullETA - now) });
        } else {
          phaseLabel = t('pillPhaseGated');
          timerStr = `${formatDuration(nextPill - now)} (${lowestPct}%)`;
        }
      }
      nextTransitionLabel = '';
      nextTransitionTime = '';
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

    let badge = document.getElementById('wia-pill-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'wia-pill-badge';
      anchor.appendChild(badge);
    }

    renderPillBadge(badge);
  }

  function renderPillBadge(badge) {
    const info = getPillCycleInfo();
    const status = parseHealthAndHunger();
    const now = Date.now();

    badge.className = '';
    badge.classList.add(info.badgeClass);

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
          <span class="wia-pill-phase-lbl">${info.phaseLabel}</span>
          ${info.timerStr ? `<span class="wia-pill-timer">${info.timerStr}</span>` : ''}
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

  function highlightCocaineItems() {
    suspendObserver();
    try {
      if (!CONFIG.featPillReminder) {
        removeCocaineHighlights();
        return;
      }

      const info = getPillCycleInfo();
      const status = parseHealthAndHunger();
      const now = Date.now();

      const isHnHReady = status.both100;
      const isWindowReady = CONFIG.pillPrefWindowFrom ? isInsidePreferredWindow(now) : true;
      const isReady = info.phase === 'READY';
      const isGated = info.phase === 'GATED';

      const cocainImgs = document.querySelectorAll("img[alt='cocain']");
      cocainImgs.forEach(img => {
        const card = climbToCard(img) || img.parentElement;
        if (!card) return;

        card.classList.remove('wia-cocain-highlight', 'wia-cocain-gated-highlight');
        card.removeAttribute('data-label');

        if (isReady) {
          card.classList.add('wia-cocain-highlight');
          card.setAttribute('data-label', t('pillOverlayReady'));
        } else if (isGated) {
          card.classList.add('wia-cocain-gated-highlight');
          
          let labelText = '';
          if (!isHnHReady) {
            const lowestPct = Math.round(Math.min(status.hpPercent, status.hungerPercent));
            labelText = `H&H ${lowestPct}%`;
          } else if (!isWindowReady) {
            labelText = CONFIG.pillPrefWindowFrom;
          }
          card.setAttribute('data-label', labelText);
        }
      });
    } finally {
      resumeObserver();
    }
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
  let marketTooltip = null;
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
          if (price == null || isNaN(price)) continue;
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
            'X-API-Key': 'wia-userscript'
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
        log('fetchResourceTransactions failed:', code, e.message);
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
        if (!isNaN(price) && !seenTimes.has(itemTime)) {
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
        lastMktState = null;
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
            const newRange = btn.getAttribute('data-range');
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
        log('Background seedResourceTransactions error:', err);
      });
      
    } catch (e) {
      log('renderIntradayLine error:', e);
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

    const svg = modal.querySelector('svg[width="428"][height="60"]:not(.wia-mkt-overlay-svg)');
    if (!svg) return null;
    
    return { modal, titleEl, svg };
  }

  function getModalResourceCode(modal) {
    const img = modal.querySelector("img[src*='/images/items/']");
    if (!img) return null;
    
    const src = img.getAttribute('src');
    if (src) {
      const match = src.match(/\/items\/([a-z0-9_-]+)\.(png|webp|gif|jpg)/i);
      if (match && match[1]) {
        const code = match[1].toLowerCase();
        if (!EXCLUDED_ALTS.has(code)) return code;
      }
    }
    
    const alt = img.getAttribute('alt');
    if (alt) {
      const code = alt.trim().toLowerCase();
      if (!EXCLUDED_ALTS.has(code)) return code;
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
    const pc = readCache(KEYS.priceCache);
    if (pc && pc.data && pc.data[itemCode] != null) {
      return pc.data[itemCode];
    }
    const scrapedStore = readCache(KEYS.scrapedPrices) || {};
    if (scrapedStore[itemCode] != null) {
      return scrapedStore[itemCode].price;
    }
    return null;
  }

  function getItemPriceRange(itemCode) {
    let minPrice = null;
    let maxPrice = null;

    // 1. Check live offers cache
    const oc = readCache(KEYS.offersCache) || {};
    const itemOffers = oc[itemCode];
    if (itemOffers && Array.isArray(itemOffers.data) && itemOffers.data.length > 0) {
      const prices = itemOffers.data.map(o => o.price).filter(p => p != null && !isNaN(p));
      if (prices.length > 0) {
        minPrice = Math.min(...prices);
        maxPrice = Math.max(...prices);
      }
    }

    // 2. Check transaction history cache
    const tc = readCache(KEYS.transactionsCache) || {};
    const itemTxs = tc[itemCode];
    if (itemTxs && Array.isArray(itemTxs.data) && itemTxs.data.length > 0) {
      const prices = itemTxs.data.map(t => getTxPrice(t)).filter(p => p != null && !isNaN(p));
      if (prices.length > 0) {
        const txMin = Math.min(...prices);
        const txMax = Math.max(...prices);
        if (minPrice == null || txMin < minPrice) minPrice = txMin;
        if (maxPrice == null || txMax > maxPrice) maxPrice = txMax;
      }
    }

    // 3. Fallback to scraped floor price
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
      const val = parseInt(slashSpan.textContent.replace(/[^0-9]/g, ''), 10) || 0;
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

  function getPnlDayKey(time = Date.now()) {
    const adjustedTime = time - (2 * 60 * 60 * 1000); // 02:00 local time offset
    const d = new Date(adjustedTime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function createEmptyLedger(dayKey) {
    return {
      dayKey,
      startedAt: Date.now(),
      income: {},
      expense: {},
      capitalized: 0,
      total: 0,
      processedTxs: []
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
    const moneyEl = document.getElementById('money') || (document.getElementById('layoutUserMenu') && document.getElementById('layoutUserMenu').querySelector('#money'));
    if (!moneyEl) return null;
    const txt = moneyEl.textContent.trim();
    if (!txt) return null;
    const match = txt.replace(/,/g, '.').match(/\d+(?:\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  function todayResetTime() {
    const d = new Date();
    d.setHours(2, 0, 0, 0);
    if (Date.now() < d.getTime()) {
      d.setDate(d.getDate() - 1);
    }
    return d.getTime();
  }

  function processTransactionsList(items, userId) {
    const todayStart = todayResetTime();
    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());
    
    let costBasis = readCache(KEYS.pnlCostBasis) || {};
    let ledgerChanged = false;
    let costBasisChanged = false;
    
    if (!ledger.income) ledger.income = {};
    if (!ledger.expense) ledger.expense = {};
    
    const sorted = [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    for (const tx of sorted) {
      const txTime = new Date(tx.createdAt).getTime();
      const isToday = txTime >= todayStart;
      
      const money = tx.money != null ? parseFloat(tx.money) : 0;
      const quantity = tx.quantity != null ? parseInt(tx.quantity, 10) : 1;
      const type = tx.transactionType;
      
      const isSellerMe = tx.sellerId === userId;
      const isBuyerMe = tx.buyerId === userId;
      
      const itemCode = tx.itemCode || tx.item?.code || tx.item?.itemCode || tx.item?.id;
      
      if (isBuyerMe && itemCode && money > 0 && quantity > 0) {
        const unitPaid = money / quantity;
        costBasis[itemCode] = {
          unitPaid,
          qtyKnown: quantity,
          updatedAt: txTime
        };
        costBasisChanged = true;
      }
      
      if (isToday) {
        if (!ledger.processedTxs) {
          ledger.processedTxs = [];
        }
        
        const txId = tx._id || tx.id;
        if (txId && ledger.processedTxs.includes(txId)) {
          continue;
        }
        
        let booked = false;
        
        if (type === 'trading' || type === 'itemMarket') {
          if (isSellerMe && money > 0) {
            ledger.income.Sales = (ledger.income.Sales || 0) + money;
            booked = true;
          } else if (isBuyerMe && money > 0) {
            // Capitalized: gold left the wallet but it's not a loss (asset acquired).
            // Tracked so the reconciliation can explain the gold-delta gap.
            ledger.capitalized = (ledger.capitalized || 0) + money;
            booked = true;
          }
        } else if (type === 'wage') {
          if (isSellerMe && money > 0) {
            ledger.income.Wages = (ledger.income.Wages || 0) + money;
            booked = true;
          } else if (isBuyerMe && money > 0) {
            ledger.expense['Employee Wages'] = (ledger.expense['Employee Wages'] || 0) + money;
            booked = true;
          }
        } else if (type === 'donation') {
          if (isBuyerMe && money > 0) {
            ledger.expense.Other = (ledger.expense.Other || 0) + money;
            booked = true;
          }
        } else if (type === 'repair') {
          if (isBuyerMe && money > 0) {
            ledger.expense.Repairs = (ledger.expense.Repairs || 0) + money;
            booked = true;
          }
        } else {
          if (money > 0) {
            if (isSellerMe) {
              ledger.income.Other = (ledger.income.Other || 0) + money;
              booked = true;
            } else if (isBuyerMe) {
              ledger.expense.Other = (ledger.expense.Other || 0) + money;
              booked = true;
            }
          }
        }
        
        if (booked && txId) {
          ledger.processedTxs.push(txId);
          if (ledger.processedTxs.length > 500) {
            ledger.processedTxs.shift();
          }
          ledgerChanged = true;
        }
      }
    }
    
    if (costBasisChanged) {
      writeCache(KEYS.pnlCostBasis, costBasis);
    }
    
    if (ledgerChanged) {
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
    }
  }

  async function fetchAndProcessTransactions() {
    const userId = getCurrentUserId();
    if (!userId) return;
    try {
      const url = 'https://gateway.warerastats.io/trpc/transaction.getPaginatedTransactions';
      const body = JSON.stringify({
        limit: 100,
        userId: userId
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
      if (res.status < 200 || res.status >= 300) return;
      
      const json = JSON.parse(res.text);
      const items = json?.result?.data?.items || [];
      processTransactionsList(items, userId);
    } catch (e) {
      log('fetchAndProcessTransactions failed:', e.message);
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
          qty = parseInt(m[1], 10);
        }
      } else {
        const cl = node.classList;
        if (cl && (cl.contains('wia-badge') || cl.contains('wia-price-sub'))) return;
        const text = String(node.textContent || '').trim();
        const m = text.match(/^x\s*(\d+)$/i);
        if (m) {
          qty = parseInt(m[1], 10);
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

  function getInventoryQuantities() {
    const cards = (globalThis.findItemCards || findItemCards)(false);
    const qtyMap = {};
    cards.forEach((img, card) => {
      const { code } = detectType(img, card);
      if (code) {
        const qty = parseCardQuantity(card);
        qtyMap[code] = (qtyMap[code] || 0) + qty;
      }
    });
    return qtyMap;
  }

  function bookClickConsumption(code, qty = 1) {
    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());
    if (!ledger.expense) ledger.expense = {};
    
    const costBasis = readCache(KEYS.pnlCostBasis) || {};
    const itemBasis = costBasis[code];
    let unitPaid = 0;
    let isEstimated = false;
    
    if (itemBasis && itemBasis.unitPaid != null) {
      unitPaid = itemBasis.unitPaid;
    } else {
      const price = getCachedPrice(code);
      if (price != null) {
        unitPaid = price;
        isEstimated = true;
      }
    }
    
    if (!isFinite(unitPaid) || unitPaid > 10000) unitPaid = 0; // guard: no item costs >10k; reject corrupted basis
    const cost = unitPaid * qty;
    if (cost > 0) {
      ledger.expense.Consumption = (ledger.expense.Consumption || 0) + cost;
      if (isEstimated) {
        ledger.hasEstimatedConsumption = true;
      }
      
      if (!ledger.bookedConsumptionEvents) {
        ledger.bookedConsumptionEvents = [];
      }
      ledger.bookedConsumptionEvents.push({
        code,
        qty,
        timestamp: Date.now()
      });
      
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
  }

  function checkInventoryDeltaConsumption() {
    if (!isInventoryPage()) return;
    
    let snapshots = readCache(KEYS.pnlSnapshots);
    if (!snapshots) return;
    
    const currentQts = getInventoryQuantities();
    
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
      const curQty = currentQts[code] || 0;
      if (curQty < startQty) {
        let remainingDelta = startQty - curQty;
        
        if (ledger.bookedConsumptionEvents.length > 0) {
          const nextEvents = [];
          for (const evt of ledger.bookedConsumptionEvents) {
            if (evt.code === code && remainingDelta > 0) {
              const matched = Math.min(evt.qty, remainingDelta);
              evt.qty -= matched;
              remainingDelta -= matched;
              if (evt.qty > 0) {
                nextEvents.push(evt);
              }
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
          
          if (itemBasis && itemBasis.unitPaid != null) {
            unitPaid = itemBasis.unitPaid;
          } else {
            const price = getCachedPrice(code);
            if (price != null) {
              unitPaid = price;
              isEstimated = true;
            }
          }
          
          if (!isFinite(unitPaid) || unitPaid > 10000) unitPaid = 0; // guard against corrupted cost basis
          const cost = unitPaid * remainingDelta;
          if (cost > 0) {
            ledger.expense.Consumption = (ledger.expense.Consumption || 0) + cost;
            if (isEstimated) {
              ledger.hasEstimatedConsumption = true;
            }
            ledgerChanged = true;
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
    
    if (snapshotsChanged) {
      writeCache(KEYS.pnlSnapshots, snapshots);
    }
    
    if (ledgerChanged) {
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
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      if (!CONFIG.featPnlTracker) return;
      const btn = e.target.closest('#eat-button');
      if (btn) {
        const popover = document.getElementById('consume-food-popover');
        if (popover) {
          const img = popover.querySelector('img[alt]');
          if (img) {
            const code = img.getAttribute('alt');
            bookClickConsumption(code, 1);
          }
        }
      }
    });
  }

  async function fetchCurrentEquipmentDurability() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await resolveApiBase('inventory.fetchCurrentEquipment', {});
      if (!res || !res.payload) return null;
      
      const payload = res.payload;
      const equipMap = {};
      if (Array.isArray(payload)) {
        for (const entry of payload) {
          const slot = entry.slot || entry.type;
          const item = entry.item || entry;
          if (slot && item) {
            const code = item.itemCode || item.code || item.item || item.id;
            const dur = item.durability ?? (item.maxDurability ? (item.maxDurability - (item.damage || 0)) : null);
            if (code && dur != null) {
              equipMap[slot] = { code, durability: Number(dur) };
            }
          }
        }
      } else if (payload && typeof payload === 'object') {
        for (const [slot, item] of Object.entries(payload)) {
          if (item && typeof item === 'object') {
            const code = item.itemCode || item.code || item.item || item.id;
            const dur = item.durability ?? (item.maxDurability ? (item.maxDurability - (item.damage || 0)) : null);
            if (code && dur != null) {
              equipMap[slot] = { code, durability: Number(dur) };
            }
          }
        }
      }
      return equipMap;
    } catch (e) {
      log('fetchCurrentEquipmentDurability failed:', e.message);
      return null;
    }
  }

  async function fetchStartingEquipmentSnapshot() {
    const equip = await fetchCurrentEquipmentDurability();
    if (equip) {
      let snapshots = readCache(KEYS.pnlSnapshots);
      if (snapshots) {
        snapshots.durability_start = equip;
        writeCache(KEYS.pnlSnapshots, snapshots);
        log('PnL: Captured starting durability snapshot for slots:', Object.keys(equip).join(', '));
      }
    }
  }

  async function checkDurabilityWear() {
    const token = getToken();
    if (!token) return;
    
    let snapshots = readCache(KEYS.pnlSnapshots);
    if (!snapshots) return;
    
    const currentEquip = await fetchCurrentEquipmentDurability();
    if (!currentEquip) return;
    
    if (!snapshots.durability_start || Object.keys(snapshots.durability_start).length === 0) {
      snapshots.durability_start = currentEquip;
      writeCache(KEYS.pnlSnapshots, snapshots);
      return;
    }
    
    let ledger = readCache(KEYS.pnlLedger);
    if (!ledger) ledger = createEmptyLedger(getPnlDayKey());
    if (!ledger.expense) ledger.expense = {};
    
    let ledgerChanged = false;
    let snapshotsChanged = false;
    
    for (const [slot, startItem] of Object.entries(snapshots.durability_start)) {
      const curItem = currentEquip[slot];
      if (!curItem) continue;
      
      if (curItem.code !== startItem.code) {
        snapshots.durability_start[slot] = curItem;
        snapshotsChanged = true;
        continue;
      }
      
      const startDur = startItem.durability;
      const curDur = curItem.durability;
      
      if (curDur < startDur) {
        const wearPercent = (startDur - curDur) / 100;
        
        const costBasis = readCache(KEYS.pnlCostBasis) || {};
        const itemBasis = costBasis[curItem.code];
        let unitPaid = 0;
        let isEstimated = false;
        
        if (itemBasis && itemBasis.unitPaid != null) {
          unitPaid = itemBasis.unitPaid;
        } else {
          const price = getCachedPrice(curItem.code);
          if (price != null) {
            unitPaid = price;
            isEstimated = true;
          }
        }
        
        if (!isFinite(unitPaid) || unitPaid > 10000) unitPaid = 0; // guard against corrupted cost basis
        const cost = unitPaid * wearPercent;
        if (cost > 0) {
          ledger.expense.Repairs = (ledger.expense.Repairs || 0) + cost;
          if (isEstimated) {
            ledger.hasEstimatedRepairs = true;
          }
          ledgerChanged = true;
        }
        
        snapshots.durability_start[slot].durability = curDur;
        snapshotsChanged = true;
      } else if (curDur > startDur) {
        snapshots.durability_start[slot].durability = curDur;
        snapshotsChanged = true;
      }
    }
    
    for (const [slot, curItem] of Object.entries(currentEquip)) {
      if (!snapshots.durability_start[slot]) {
        snapshots.durability_start[slot] = curItem;
        snapshotsChanged = true;
      }
    }
    
    if (snapshotsChanged) {
      writeCache(KEYS.pnlSnapshots, snapshots);
    }
    
    if (ledgerChanged) {
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
        // null (not 0!) when gold isn't readable yet — else gold_start=0 makes the
        // gold delta equal the entire balance. Backfilled lazily in updatePnlUi.
        gold_start: goldVal !== null ? goldVal : null,
        durability_start: {},
        invQty_start: isInventoryPage() ? getInventoryQuantities() : {}
      };
      writeCache(KEYS.pnlSnapshots, snapshots);
      
      fetchStartingEquipmentSnapshot();
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
      capitalized: 'In Käufe gebunden',
      untracked: 'Unerfasst',
      totalPnl: 'Gesamt P&L',
      goldDelta: 'Gold Delta',
      today: 'Heute',
      yesterday: 'Gestern',
      category: 'Kategorie',
      footer: 'P&L = Einnahmen − Ausgaben (Käufe zählen erst beim Verbrauch). Gold Delta = Live-Gold − Start.'
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
      capitalized: 'Tied up in purchases',
      untracked: 'Untracked',
      totalPnl: 'Total P&L',
      goldDelta: 'Gold Delta',
      today: 'Today',
      yesterday: 'Yesterday',
      category: 'Category',
      footer: 'P&L = Income − Expense (purchases count only when consumed). Gold Delta = Live Gold − Start.'
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
        const todayIncOther = ledger.income.Other || 0;
        const yesterdayIncOther = yesterday ? (yesterday.income.Other || 0) : 0;
        
        // Expenses (pass as negative to renderPnlRow)
        const todayCons = -(ledger.expense.Consumption || 0);
        const yesterdayCons = yesterday ? -(yesterday.expense.Consumption || 0) : 0;
        const todayRep = -(ledger.expense.Repairs || 0);
        const yesterdayRep = yesterday ? -(yesterday.expense.Repairs || 0) : 0;
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
        html += renderPnlRow(loc.other, todayIncOther, yesterdayIncOther, false, false);
        
        // Expense Header
        html += `<tr style="color: #f85149; font-weight: bold; font-size: 10px;"><td colspan="3" style="padding: 8px 0 2px 0; text-transform: uppercase;">${loc.expense}</td></tr>`;
        html += renderPnlRow(loc.consumption, todayCons, yesterdayCons, ledger.hasEstimatedConsumption, yesterday ? yesterday.hasEstimatedConsumption : false);
        html += renderPnlRow(loc.repairs, todayRep, yesterdayRep, ledger.hasEstimatedRepairs, yesterday ? yesterday.hasEstimatedRepairs : false);
        html += renderPnlRow(loc.empWages, todayEmpWages, yesterdayEmpWages, false, false);
        html += renderPnlRow(loc.other, todayExpOther, yesterdayExpOther, false, false);
        
        const formatBold = (val) => {
          const absVal = Math.abs(val);
          if (absVal <= 0.0001) return `<span style="color: #8b949e;">${fmtPnl(0)}</span>`;
          const sign = val > 0 ? '+' : '-';
          const color = val > 0 ? '#3fb950' : '#f85149';
          return `<span style="color: ${color};">${sign}${fmtPnl(val)}</span>`;
        };

        // Separator line
        html += `<tr style="border-top: 1px solid rgba(255, 255, 255, 0.15);"><td colspan="3" style="padding: 4px 0 0 0;"></td></tr>`;

        // Capitalized purchases (gold spent on assets — not a loss)
        html += renderPnlRow(loc.capitalized, todayCapital, yesterdayCapital, false, false);

        // Untracked/Sonstiges (true residual; should be ~0 when tracking is complete)
        html += renderPnlRow(loc.untracked, todayUntrackedVal, yesterdayUntrackedVal, false, false);
        
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
  // + capitalized tracking. v3: fixed gold_start=0 bogus delta + cost-basis sanity guard
  // (corrupted ~gold-balance unitPaid had inflated wear/consumption into huge negatives).
  const PNL_SCHEMA_VERSION = 3;

  function migratePnlSchema() {
    const stored = GM_getValue(KEYS.pnlSchemaVersion, 0);
    if (stored === PNL_SCHEMA_VERSION) return;
    // Pre-v2 caches were polluted by the 30s re-booking bug → wipe and recompute clean.
    writeCache(KEYS.pnlLedger, null);
    writeCache(KEYS.pnlYesterday, null);
    writeCache(KEYS.pnlSnapshots, null);
    writeCache(KEYS.pnlCostBasis, null);
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
  // Work, market buy/sell, consume — mutates this text. On change we refresh the chip
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

  function start() {
    migrateTransactionsCache();
    CONFIG.locale = GM_getValue(KEYS.locale, CONFIG.locale || 'de') || 'de';
    if (typeof window !== 'undefined') {
      window.__WIA_LOCALE__ = CONFIG.locale;
    }
    CONFIG.useLiveOffersApi = GM_getValue(KEYS.useLiveOffersApi, false);
    CONFIG.showScrapFlip = GM_getValue(KEYS.showScrapFlip, false);
    CONFIG.featNotes = GM_getValue(KEYS.featNotes, false);
    CONFIG.featBattleAdvisor = GM_getValue(KEYS.featBattleAdvisor, false);
    CONFIG.alliedCountryCodes = GM_getValue(KEYS.alliedCountryCodes, CONFIG.alliedCountryCodes);
    CONFIG.featPillReminder = GM_getValue(KEYS.featPillReminder, false);
    CONFIG.featMarketGraph = GM_getValue(KEYS.featMarketGraph, false);
    CONFIG.featPnlTracker = GM_getValue(KEYS.featPnlTracker, true);
    CONFIG.pillBuffH = GM_getValue(KEYS.pillBuffH, CONFIG.pillBuffH);
    CONFIG.pillKnifeH = GM_getValue(KEYS.pillKnifeH, CONFIG.pillKnifeH);
    CONFIG.pillDebuffH = GM_getValue(KEYS.pillDebuffH, CONFIG.pillDebuffH);
    CONFIG.pillPrefWindowFrom = GM_getValue(KEYS.pillPrefWindowFrom, CONFIG.pillPrefWindowFrom);
    CONFIG.pillPrefWindowTo = GM_getValue(KEYS.pillPrefWindowTo, CONFIG.pillPrefWindowTo);
    injectStyles();
    if (CONFIG.featNotes) initNotes();
    if (CONFIG.featBattleAdvisor && isBattlePage()) applyBattleAdvisory();
    if (CONFIG.featPillReminder) initPillReminder();
    if (CONFIG.featMarketGraph) initMarketGraph();
    if (CONFIG.featPnlTracker) initPnlTracker();
    injectGear();
    refreshMenuCommands();

    observer = new MutationObserver(() => triggerScan(false));
    if (isInventoryPage() || isMarketPage()) {
      updateObserverTarget();
      if (isInventoryPage()) {
        scanInventory(false);
      } else {
        scrapeMarketPrices();
        scanInventory(false);
        renderScrapFlip().catch((e) => log('renderScrapFlip error:', e));
      }
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

    // Trigger crafting advisor check once on startup if the modal is open
    triggerCraftingAdvisorCheck();
  }

  start();
})();
