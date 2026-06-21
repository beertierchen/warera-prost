// ==UserScript==
// @name         PROST
// @namespace    https://github.com/beertierchen/warera-prost
// @version      0.6.5
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
    showScrapFlip: false,

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
        deleteNote: 'Delete Note',
        saveNote: 'Save',
        notePlaceholder: 'Enter note...',
        settingsTitle: 'WareEra Inventory Advisor',
        gearTitle: 'WareEra Inventory Advisor — Settings',
        settingsDesc: 'The Inventory Advisor gives a quick overview of whether items should be kept (KEEP/HOLD), sold (SELL), or salvaged (SCRAP).',
        settingsApiToken: 'API Token (api2.warera.io)',
        settingsTokenPlaceholder: 'Bearer token',
        settingsTokenNote: 'Saved locally (GM_setValue, lightly obfuscated — not real encryption).',
        settingsHighCritCheckbox: 'Use high crit weight for HOLD evaluation (6.00 instead of 4.15)',
        settingsLiveOffersCheckbox: 'Fetch live offers via API (requires API Token)',
        settingsScrapFlipCheckbox: 'Scrap-Flip indicator (experimental)',
        scrapFlipTooltip: 'Buy {buy} → scrap {yield}×{unit} net {net} = +{profit} profit',
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
              <li><strong>High Crit Weight</strong>: Increases crit weight from 4.15 to 6.00 for the HOLD evaluation.</li>
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
        rateLimitBanner: '⚠ API limit reached! Backoff active ({sec}s) — displaying cached prices.'
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
        deleteNote: 'Notiz löschen',
        saveNote: 'Speichern',
        notePlaceholder: 'Notiz eingeben...',
        settingsTitle: 'WareEra Inventory Advisor',
        gearTitle: 'WareEra Inventory Advisor — Einstellungen',
        settingsDesc: 'Der Inventory Advisor soll eine schnelle Übersicht geben, ob Items behalten (KEEP/HOLD), gewinnbringend verkauft (SELL) oder zerschreddert (SCRAP) werden sollten.',
        settingsApiToken: 'API-Token (api2.warera.io)',
        settingsTokenPlaceholder: 'Bearer-Token',
        settingsTokenNote: 'Lokal gespeichert (GM_setValue, leicht verschleiert — keine echte Verschlüsselung).',
        settingsHighCritCheckbox: 'Erhöhte Crit-Gewichtung für HOLD-Bewertung verwenden (6.00 statt 4.15)',
        settingsLiveOffersCheckbox: 'Live-Angebote über API abrufen (benötigt API-Token)',
        settingsScrapFlipCheckbox: 'Scrap-Flip-Indikator (experimentell)',
        scrapFlipTooltip: 'Kauf {buy} → Scrap {yield}×{unit} netto {net} = +{profit} Gewinn',
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
              <li><strong>Erhöhte Crit-Gewichtung</strong>: Erhöht den Crit-Gewichtungsfaktor bei Waffen von 4.15 auf 6.00 für die HOLD-Prüfung.</li>
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
        rateLimitBanner: '⚠ API-Limit erreicht! Wartezeit aktiv ({sec}s) — zeige zwischengespeicherte Preise.'
      }
    },

  };

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
    highCritWeightForHold: NS + 'highCritHold',
    useLiveOffersApi: NS + 'useLiveOffers',
    showScrapFlip: NS + 'scrapFlip',
  };
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
    GM_setValue(KEYS.priceCache, null);
    GM_setValue(KEYS.scrapCache, null);
    GM_setValue(KEYS.offersCache, {});
    GM_setValue(KEYS.transactionsCache, {});
    GM_setValue(KEYS.scrapedPrices, {});
    GM_setValue(KEYS.apiBase, '');
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
    const cache = GM_getValue(KEYS.priceCache, null);
    const scrapedStore = GM_getValue(KEYS.scrapedPrices, {}) || {};
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
          GM_setValue(KEYS.priceCache, { data: map, fetchedAt: now() });
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
        parentDiv.remove();
      } else {
        cleanIcon.remove();
      }
    });

    cleanCard.querySelectorAll('*').forEach(child => {
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
      return { action: ACTION.UNKNOWN, reason: t('notEquipment'), market: null, scrapValue: null };
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
      return decide(ACTION.UNKNOWN, [...reasons, t('noPriceData')], value, scrapValue);
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

  const WIA_HEADER_PX = 18;   // top strip height for score + bubble (tune live)

  function renderItem(card, item, result) {
    const cell = getItemCell(card);
    const state = getItemState(card, item.stats);

    // 1. Equipped suppression check
    if (state.equipped) {
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
      } finally {
        resumeObserver();
      }
      return;
    }

    card.dataset.wiaDone = '1';
    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
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

    const isTop3 = item.isStockKeep === true;
    const isCrit = item.stats.crit != null && item.stats.crit >= CONFIG.critItemMinPercent;
    
    // Reco badge rules:
    // Damaged (<100%): only if isTop3 || isCrit
    // 100%: always shown
    const showBadge = !state.damaged || (isTop3 || isCrit);

    // 2. Existing Badge (action recommendation)
    let badge = card.querySelector('.wia-badge');
    if (showBadge) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'wia-badge';
        card.appendChild(badge);
      }
      const emojiMap = { KEEP: '💎', SELL: '💰', SCRAP: '🔨', HOLD: '✋', UNKNOWN: '❓' };
      badge.textContent = emojiMap[result.action] || '❓';
      badge.style.background = BADGE_COLORS[result.action] || BADGE_COLORS.UNKNOWN;
      badge.style.opacity = item.stale ? '0.55' : '1'; // dim when on cached/stale prices
      badge.style.top = Math.round(WIA_HEADER_PX / 2) + 'px';
      const tooltipText = buildTooltip(item, result);
      badge.title = tooltipText;
      card.title = tooltipText;
    } else {
      if (badge) badge.remove();
      badge = null;
      card.title = '';
    }

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

    // 3.5. Grow card header if top overlays are active, otherwise reset it
    const showHeader = showScore || showBadge;
    suspendObserver();
    try {
      if (showHeader) {
        card.style.minHeight = (48 + WIA_HEADER_PX) + 'px';
        card.dataset.wiaHeader = '1';
        const imgWrap = card.querySelector('img')?.parentElement;
        if (imgWrap) {
          imgWrap.style.top = WIA_HEADER_PX + 'px';
          imgWrap.style.height = 'auto';
          imgWrap.style.bottom = '0';
          imgWrap.dataset.wiaShifted = '1';
        }
      } else {
        cleanupCardHeader(card);
      }
    } finally {
      resumeObserver();
    }

    // 4. Price Sub-badge (only for 100% unequipped)
    const showPrice = !state.damaged && (result.scrapValue != null || result.market != null);
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
    if (showBadge) {
      delete card.dataset.wiaSuppressed;
    } else {
      card.dataset.wiaSuppressed = '1';
    }
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

    const scrapedStore = GM_getValue(KEYS.scrapedPrices, {}) || {};
    suspendObserver();
    try {
      tiles.forEach((tile) => {
        const code = tile.id.replace('item-code-selector-', '').trim();
        if (!code || code === CONFIG.scrapItemCode) {
          cleanupFlipBadge(tile);
          return;
        }
        const tier = tierForCode(code);
        const buyPrice = scrapedStore[code]?.price ?? getMarketBuyPriceFromTile(tile);
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
          getFlipTitle(buyPrice, result, tier),
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

    const store = GM_getValue(KEYS.scrapedPrices, {}) || {};
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
      GM_setValue(KEYS.scrapedPrices, store);
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
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.wia-badge, .wia-score-sub, .wia-price-sub, .wia-top-banner').forEach(el => el.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function getItemState(card, stats) {
    const t = getCardBaseText(card);
    const equipped = /\bEquip(\.|ped)?\b/i.test(t) || /\bausgerüstet\b/i.test(t);
    const damaged  = stats.durability != null && stats.durability < 100;
    return { equipped, damaged };
  }

  function shouldSuppressItem(card, stats) {
    return getItemState(card, stats).equipped;
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

    log(`scanInventory started (force=${force})`);
    scanning = true;
    lastInventoryCards = cards;
    lastInventoryCardTexts.clear();
    cards.forEach((img, card) => {
      lastInventoryCardTexts.set(card, getCardBaseText(card));
    });

    try {
      const items = [];
      cards.forEach((img, card) => {
        const { type, alt, code, tier } = detectType(img, card);
        if (type === 'scrap' || type === 'unknown') return;
        const stats = parseStats(card, type);
        
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
      if (isMarketPage()) {
        await renderScrapFlip();
      }

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
        position: absolute; top: 4px; right: 4px; z-index: 70;
        display: inline-flex; align-items: center; gap: 3px;
        padding: 2px 5px; border-radius: 999px;
        font: 700 11px/1 system-ui, sans-serif;
        color: #06210f; background: #3fb950;
        box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.25);
        pointer-events: none; white-space: nowrap;
      }
      .wia-flip-badge.is-negative {
        color: #fff; background: #8b949e;
      }
      .wia-flip-tile {
        box-shadow: inset 0 0 0 2px #3fb950 !important;
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
    const scraped = GM_getValue(KEYS.scrapedPrices, {});
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
    const prevHighCrit = bg.querySelector('.wia-high-crit')?.checked ?? CONFIG.useHighCritWeightForHold;
    const prevLiveOffers = bg.querySelector('.wia-live-offers')?.checked ?? CONFIG.useLiveOffersApi;
    const prevScrapFlip = bg.querySelector('.wia-scrap-flip')?.checked ?? CONFIG.showScrapFlip;

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
        <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" class="wia-high-crit" style="width: auto;" ${prevHighCrit ? 'checked' : ''} />
          <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsHighCritCheckbox')}</label>
        </div>
        <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" class="wia-live-offers" style="width: auto;" ${prevLiveOffers ? 'checked' : ''} />
          <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsLiveOffersCheckbox')}</label>
        </div>
        <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" class="wia-scrap-flip" style="width: auto;" ${prevScrapFlip ? 'checked' : ''} />
          <label style="margin: 0; font-weight: normal; cursor: pointer;">${t('settingsScrapFlipCheckbox')}</label>
        </div>
        <details class="wia-help-details">
          <summary class="wia-help-summary">${t('settingsHelpSummary')}</summary>
          <div class="wia-help-content">${t('settingsHelpContent')}</div>
        </details>
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

    modal.addEventListener('click', (e) => e.stopPropagation());
    window.setTimeout(() => tokenInput.focus(), 0);

    bg.querySelector('.wia-save').onclick = () => {
      const newToken = tokenInput.value.trim();
      const tokenChanged = prevToken !== newToken;
      setToken(newToken);

      const useHighCrit = bg.querySelector('.wia-high-crit').checked;
      GM_setValue(KEYS.highCritWeightForHold, useHighCrit);
      CONFIG.useHighCritWeightForHold = useHighCrit;

      const useLiveOffers = bg.querySelector('.wia-live-offers').checked;
      GM_setValue(KEYS.useLiveOffersApi, useLiveOffers);
      CONFIG.useLiveOffersApi = useLiveOffers;

      const showScrapFlip = bg.querySelector('.wia-scrap-flip').checked;
      GM_setValue(KEYS.showScrapFlip, showScrapFlip);
      CONFIG.showScrapFlip = showScrapFlip;

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
    lastInventoryCardTexts.clear();
    
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
    CONFIG.locale = GM_getValue(KEYS.locale, CONFIG.locale || 'de') || 'de';
    if (typeof window !== 'undefined') {
      window.__WIA_LOCALE__ = CONFIG.locale;
    }
    CONFIG.useHighCritWeightForHold = GM_getValue(KEYS.highCritWeightForHold, false);
    CONFIG.useLiveOffersApi = GM_getValue(KEYS.useLiveOffersApi, false);
    CONFIG.showScrapFlip = GM_getValue(KEYS.showScrapFlip, false);
    injectStyles();
    injectGear();
    refreshMenuCommands();

    observer = new MutationObserver(debouncedScan);
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
    setInterval(handleRouteChange, 2000);
  }

  start();
})();
