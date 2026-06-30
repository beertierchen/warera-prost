# CHANGELOG

## 2026-06-30 | Advisor Heartbeat Fix (v0.7.19)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Fehlalarm im Advisor-Heartbeat behoben**: Der LoopGuard-Grenzwert für den Advisor-Heartbeat wurde erhöht. Dadurch wird verhindert, dass das Script fälschlicherweise als "abgestürzt" (`fail`) markiert wird, wenn man sich länger als 15 Sekunden im Inventar oder Markt aufhält.

**Changes (English):**
- **Fixed Advisor Heartbeat False Alarms**: Increased the LoopGuard limit for the advisor heartbeat to prevent the script from falsely showing a "failed" (`fail`) state when staying on the inventory or market page for longer than 15 seconds.

## 2026-06-30 | Item-Advisor: Konfigurierbarer Bestand, T1-T3 Filter & Waffenkrit-Fix (v0.7.18)

**Geänderte Dateien:** `warera-prost.user.js`, `tests/test-advisor-load.js`, `docs/wiki/`

**Änderungen (Deutsch):**
- **Einstellbare Bestandsgröße (Stock Keep)**: Die Anzahl der zu behaltenden Gegenstände im Bestand pro Typ/Tier kann nun im Einstellungsmenü konfiguriert werden (Standard: 3). Gegenstände außerhalb dieser Grenze erhalten keinen Diamanten (`💎 KEEP`).
- **Aussortierung schlechter T1-T3 Gegenstände**: Gegenstände der Stufen T1 bis T3 werden vom Diamanten ausgeschlossen, wenn ihr Wert in der unteren Hälfte (< 50 %) des möglichen Wertebereichs liegt.
- **T1/T2 Waffenkrit-Anpassung**: Die Mindest-Kritwerte für den „kritischen Zustand“ (`avoidScrap`) wurden für T1 auf $\ge$ 5 % und für T2 auf $\ge$ 10 % (also die jeweiligen Maximalwerte) angehoben.

**Changes (English):**
- **Configurable Stock Keep Count**: The number of items to keep in stock per type/tier is now configurable in the settings menu (default: 3). Items beyond this limit will not receive a `💎 KEEP` badge.
- **Exclusion of Low-Roll T1-T3 Items**: Items in tiers T1 to T3 are excluded from the `💎 KEEP` advice if their stat roll is in the lower half (< 50%) of the possible range.
- **T1/T2 Weapon Crit Adjustments**: The minimum crit thresholds for "avoidScrap" (Critical Condition) have been increased to $\ge$ 5% for T1 and $\ge$ 10% for T2 (the maximum possible rolls).

## 2026-06-30 | Crafting-Advisor: Korrektur der Ressourcenkosten bei T6 (v0.7.17)

**Geänderte Dateien:** `warera-prost.user.js`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Fehlerfreie Ressourcenberechnung bei T6**: Behebt einen Fehler, bei dem die benötigte Schrottmenge für Tier-6-Gegenstände (z. B. `1.46k` Schrott) fälschlicherweise als `146` statt `1460` gelesen wurde, was zu einer viel zu geringen Anzeige der Ressourcenkosten führte.

**Changes (English):**
- **Correct T6 Resource Calculations**: Fixes an issue where large scrap amounts for Tier 6 crafting (e.g. `1.46k` scraps) were parsed as `146` instead of `1460`, which displayed incorrect resource costs.

## 2026-06-29 | Fehlerbehebung bei der Skin-Rüstungs-Erkennung (v0.7.16)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Priorisierte Werterang-Erkennung**: Das Tier von Ausrüstung (Waffen & Rüstung) wird nun primär über dessen Wertebereich ermittelt. Dies behebt den Fehler, bei dem geskinnte Rüstungsteile (die keine Tier-Ziffer im Namen tragen und deren Randfarbe von Skin-Grafiken verdeckt wird) als tierlos erkannt wurden.
- **Fehlertolerante Erkennungskette**: Schlägt die Werterang-Erkennung fehl (z. B. bei Werten in Werte-Lücken), wird nacheinander auf die Waffenklasse, die Ziffer im Bild-Alt-Namen und als letzte Option auf die Randfarbe zurückgegriffen.
- **Konsistente Marktcodes**: Nach der Erkennung wird die interne Kennung für Rüstungen wieder zusammengesetzt (z. B. `pants4`), damit nachgelagerte Preis- und Schrottberechnungen korrekt aufgelöst werden.
- **Stat-Bereiche korrigiert**: Mindestwerte für T5-Hosen und T5-Brustplatten wurden von 36 auf 35 angepasst.

**Changes (English):**
- **Priority Stat-Range Detection**: Equipment tier (weapons & armor) is now primarily resolved by matching its stat ranges. This fixes the issue where cosmetic skin armor (which has no tier suffix digit and has its border color obscured by skin art) failed to resolve a tier.
- **Robust Fallback Prioritization**: If stat range matching fails (e.g. on values landing in between-tier gaps), detection falls back sequentially to weapon class tier, alt-suffix digit, and finally border color.
- **Consistent Market Codes**: Reconstructs armor codes after tier resolution (e.g., `pants4`) so downstream scrap and price lookups work correctly.
- **Stat Range Correction**: Adjusted Tier 5 minimum stats for pants and chest from 36 to 35.

## 2026-06-28 | Item-Advisor: saubereres Layout, schnelleres Rendern & genauere Haltbarkeit (v0.7.15)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Saubereres Overlay-Layout**: Empfehlungs-Bubble, Score und Schrott-/Marktwert liegen jetzt in eigenen Streifen ober- und unterhalb der Karte — sie überdecken keine Item-Stats mehr und ragen nicht in Nachbarkarten.
- **Schnelleres Rendern**: Stats werden ohne DOM-Klonen ausgelesen, je Karte nur noch ein Durchlauf, und die Haltbarkeitsbalken-Suche ist schneller.
- **Genauere Haltbarkeit**: wird direkt aus dem Fortschrittsbalken gelesen.
- **Vorläufige Empfehlungen** werden durch einen gestrichelten Rand markiert (statt eines vorangestellten „~").

**Changes (English):**
- **Cleaner overlay layout**: the recommendation bubble, score and scrap/market value now sit in dedicated strips above and below the card — no longer covering native item stats or bleeding into neighbouring cards.
- **Faster rendering**: stats are parsed without DOM cloning, with a single pass per card and a faster durability-bar lookup.
- **More accurate durability**: read straight from the progress bar.
- **Provisional recommendations** are marked with a dashed border (instead of a leading "~").

## 2026-06-28 | Inventar-Ladeperformance verbessert & Diagnose-Erweiterungen (v0.7.14)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Schnelleres Inventar-Laden**: Die extrem langsame Seiten-Struktur-Prüfung (`isInsideSkinShop`) wurde durch eine ultraschnelle URL-Prüfung (`isShopPage`) ersetzt. Beim Laden des Inventars gibt es keine spürbaren Verzögerungen oder 10s-Hänger mehr.
- **Cache-Optimierung**: Die Bildersuche wird nun innerhalb eines Frames (50ms) zwischengespeichert, um unnötige Mehrfachscans bei schnellen Seitenaktualisierungen zu vermeiden.
- **Leistungs-Probes & Ampel**: Im Diagnose-Panel der Einstellungen wird jetzt die genaue Scandauer (in ms) und ein detailliertes Bilder-Statistik-Protokoll angezeigt. Eine eigene Ampel signalisiert die Performance (Grün: <50ms, Gelb: <150ms, Rot: ≥150ms).
- **First Card Scoping Debugger**: Entwickler/Debugger können über das Tampermonkey-Menü per Klick (`🐞 Debug: Scan First Card Scoping`) das detaillierte Scoping des ersten Bildes auf der Seite in der Konsole protokollieren.

**Changes (English):**
- **Faster Inventory Loading**: Replaces the expensive DOM scoping check (`isInsideSkinShop`) with a near-instant URL test (`isShopPage`), completely resolving inventory page-load lag and 10s hangs.
- **Scoping Cache**: Caches scanned images for 50ms per frame to prevent redundant DOM traversals during high-frequency mutation events.
- **Performance Probes & Status Ampel**: Displays the exact image scanning duration (in ms) along with detailed image metrics directly within the Feature-Health / Diagnostics panel. Performance is color-coded (Green: <50ms, Yellow: <150ms, Red: ≥150ms).
- **First Card Scoping Debugger**: Adds a Tampermonkey menu command (`🐞 Debug: Scan First Card Scoping`) when debug mode is enabled to inspect and print the exact scoping path of the first matching image on the page.

## 2026-06-28 | Kompakteres Pillen-Interface, dynamische Messer- & Regen-Phasen (v0.7.13)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Kompakteres Pillen-Interface**: Das Pillen-Element im Menü wurde verkleinert und übersichtlicher gestaltet. Die aktuelle Phase steht nun über dem Countdown. Der Timer wurde farblich an den jeweiligen Status angepasst.
- **Dynamische Messer- & Regen-Phasen**: Die Phasen „Messer“ und „Regen“ werden nun dynamisch anhand eurer H&H-Regeneration (inkl. 5% Puffer) berechnet. Ist genug H&H vorhanden, um bis zum nächsten Fenster natürlich auf 100% zu heilen, seid ihr in der Messer-Phase, andernfalls in der Regen-Phase.

**Changes (English):**
- **Compact Pill Interface**: Shrinks the pill badge inside the header menu and stacks the phase name vertically above the countdown timer. Colors the timer text based on the active state.
- **Dynamic Knife & Recovery Phases**: Replaces fixed-hour phases with dynamic calculation based on your H&H regeneration and a 5% safety buffer. If you have enough H&H to naturally recover to 100% by the time of the preferred window or debuff end, you enter the Knife phase; otherwise, you enter the Recovery phase.

## 2026-06-27 | Skin- & Ausrüstungserkennung, Munitions-Skins-Support und Diagnose-Dump (v0.7.12)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Skin-Erkennung für den Advisor**: Geskinnte Gegenstände (Waffen und Rüstungsteile unter `/images/skins/`) werden nun im Inventar und auf dem Markt vollständig erkannt und normal bewertet.
- **Support für Munitions-Skins**: Skins auf Munition (z. B. `wc2026`, `ctLightAmmo`, `ctHeavyAmmo`, `ctAmmo`) werden über eine interne Zuordnung (`CONFIG.skinToSlot`) korrekt auf ihre Basis-Munitionstypen zurückgemappt. Dies stellt sicher, dass der P&L-Mengen-Tracker den Munitionsverbrauch auch mit Skins fehlerfrei aufzeichnet.
- **Skins-Ausschluss im Shop**: Auf der Skin-Shop-Seite wird die Bewertung automatisch deaktiviert, um Premium-Währungspreise nicht mit normalen Markt-Coins zu vermischen.
- **Skins-Dump für Fehlerdiagnose**: In den Einstellungen (unter Feature-Health / Diagnose) gibt es einen neuen Button "Skins Dump (Konsole)". Dieser gibt eine copy-paste-fertige Tabelle aller auf der Seite gefundenen Skins, deren Auto-Slot und ihren Erkennungs-Status aus, um das Hinzufügen nicht-standardisierter Skins zu vereinfachen.

**Changes (English):**
- **Skin & Equipment Recognition**: Cosmetic skin items (weapons and armor under `/images/skins/`) are now fully detected and evaluated in your inventory and on the market pages.
- **Ammo Skin Support**: Cosmetic ammo skins (e.g., `wc2026`, `ctLightAmmo`, `ctHeavyAmmo`, `ctAmmo`) are correctly mapped back to their base ammo types via `CONFIG.skinToSlot`. This guarantees that the P&L consumption tracker accurately captures ammo usage when skins are equipped.
- **Shop Exclusion Page-Scoping**: Automatically disables advice overlays on the skin shop page to prevent mixing premium currency with regular market coins.
- **Skins Dump for Debugging**: Adds a "Skins Dump (Konsole)" button in settings under Feature-Health/Diagnose. It outputs a copy-pasteable table of all page skins, their auto-slot mappings, and status to simplify adding new custom skins.

## 2026-06-27 | Zuverlässigeres P&L-Tracking, Fehlerbereinigungen für Mengen & Preise (v0.7.11)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Fehlerfreie Mengen beim P&L-Verbrauch**:
  - **Mengen-Schutz**: Verhindert, dass beim Neuladen der Seite, Tab-Wechseln, Filtern oder Suchen im Inventar versehentlich riesige Mengen (z. B. 769x Munition) als verbraucht gebucht werden (durch intelligente DOM-Ladesperren und Plausibilitäts-Prüfungen).
- **Fehlerfreie Preise beim P&L-Verbrauch**:
  - **Groß-/Kleinschreibung & Präfix-Bereinigung**: Standardisiert alle Gegenstands-Codes intern einheitlich auf Kleinschreibung. Zuvor wurden z. B. `lightAmmo` (Transaktionen) und `lightammo` (Inventar) oder `cookedFish` und `food_cookedfish` getrennt behandelt, wodurch Preise oft als "Unbekannter Preis" (0.00g) endeten.
- **Robustere Transaktionsverarbeitung**:
  - **Keine doppelten Buchungen**: Fehler bei der Verarbeitung von Lohnzahlungen und Einkäufen durch MongoDB-ID-Normalisierung behoben.
  - **Stabilität bei Fehlern**: Fehlerhafte Transaktionen blockieren nicht mehr das gesamte Skript, sondern werden isoliert und protokolliert.
  - **Fehlerbehebung bei Ladezeiten**: Race Conditions beim Abfragen der Transaktionsdaten wurden behoben.

**Changes (English):**
- **Accurate P&L Consumption Quantities**:
  - **Quantity Safeguards**: Prevents massive false consumption events (e.g., 769x Ammo) from being recorded when reloading, switching tabs, or filtering the inventory (using smart DOM loading checks and sanity limits).
- **Accurate P&L Consumption Prices**:
  - **Standardized Item Codes**: Unifies case-sensitive and prefixed item codes internally (e.g., standardizing `lightAmmo`/`lightammo` and `cookedFish`/`food_cookedfish`). This resolves the "Unknown Price" (-0.00g) issue for food, steak, and ammo.
- **Robust Transaction Processing**:
  - **No Duplicate Bookings**: Fixed Mongo DB ID normalization issues that previously caused duplicate wage or purchase entries.
  - **Error Isolation**: Corrupt or buggy transactions are quarantined and logged instead of blocking the entire script initialization.
  - **Race Condition Resolution**: Fixed timing issues when requesting transaction logs.

## 2026-06-27 | Beute- & Herstellungs-Kennzeichnungen im Tooltip, genauerer P&L-Klick-Verbrauch und detaillierter Beleg (v0.7.10)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Tooltip-Kennzeichnungen**: Gegenstände im Inventar zeigen nun im Tooltip an, ob es sich um Beute (`💡 BEUTE`) oder selbst hergestellte Gegenstände (`💡 HERSTELLT`) handelt, inklusive des ursprünglichen Wertes.
- **Präziseres P&L-Tracking**:
  - **Beute- & Herstellungsverkäufe**: Beim Verkauf von Beute oder hergestellten Gegenständen wird nur noch der positive Gewinnüberschuss (Verkaufserlös abzüglich des ursprünglichen Werts) verbucht.
  - **Klick-Verbrauch verbessert**: Der Verbrauch von Gegenständen durch Klicks (z. B. Essen von Brot) wird nun auch dann erfasst, wenn diese nicht im Inventar liegen (Sofortkauf im Kampf). Der Preis wird automatisch im Nachgang korrigiert, sobald die Transaktion vom Server geladen wird.
  - **Keine Fehlbuchungen**: Nicht-Konsumgüter (wie Stahl, Schrott, concrete etc.) werden im Delta-Scanner und bei Klick-Aktionen nicht mehr fälschlicherweise als Verbrauch verbucht.
- **P&L-Kassenzettel (Konsole)**: In den Einstellungen (unter Feature-Health / Diagnose) gibt es nun einen Button "P&L Kassenzettel (Konsole)". Klickt man darauf, wird ein detaillierter "Einkaufszettel" über alle heutigen Einnahmen, Ausgaben (Verbrauch & Verschleiß nach Gegenstand), Lohnzahlungen und Spenden in die Entwickler-Konsole gedruckt.

**Changes (English):**
- **Tooltip Indicators**: Inventory items now display in their hover tooltips whether they were obtained as loot (`💡 LOOT`) or crafted (`💡 CRAFTED`), including their original acquisition value.
- **More Precise P&L Tracking**:
  - **Loot & Crafted Sales**: Selling loot or crafted items now only books the net profit surplus (sales price minus the original acquisition value) to the ledger.
  - **Improved Click Consumption**: Consuming items via clicks (e.g. eating bread) is now tracked even when they are not in your inventory (on-the-fly battle purchase). The cost is retrospectively corrected once the transaction is loaded.
  - **No False Consumption**: Non-consumables (such as steel, scraps, concrete, etc.) are no longer falsely booked as consumption.
- **P&L Receipt Printer (Console)**: Added a "P&L Kassenzettel (Konsole)" button in Settings (under Feature-Health / Diagnostics). Clicking it prints a detailed receipt of all today's income, detailed wear and consumption per item, wages, and donations to the developer console.

## 2026-06-27 | Diagnose-Modus, zuverlässigere Anzeige & genaueres P&L-Tracking (v0.7.9)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Diagnose-Modus (Debug)**: In den Einstellungen lässt sich ein Debug-Modus einschalten. Er zeigt pro Funktion eine Ampel (grün/gelb/rot) mit Begründung an — so ist sofort sichtbar, ob z. B. der Item-Ratgeber oder das P&L-Tracking gerade arbeitet und, falls nicht, warum. Optional erscheint zusätzlich eine kleine Anzeige direkt im Spiel.
- **Zuverlässigere Ratgeber-Anzeige**: Die Empfehlungs-Badges auf den Gegenständen blieben bisher oft aus, weil das Spiel das Inventar im Hintergrund neu aufbaut. Die Erkennung wurde so umgebaut, dass die Badges nach jedem Neuaufbau (Aus-/Anlegen von Ausrüstung, Verbrauchen, Tab-Wechsel) sofort wieder erscheinen.
- **Genaueres P&L (Gewinn & Verlust)**:
  - **Verbrauch wird erfasst**: Gegessenes (Steak/Brot/Fisch), Pillen und verschossene Munition werden nun als Ausgabe verbucht — auch für Dinge ohne hinterlegten Kaufpreis, dann über den Marktwert.
  - **Korrekte Durchschnittskosten**: Kaufpreise werden als gleitender Durchschnitt geführt; eine Transaktion wird nur noch genau einmal gezählt (vorher wurden Werte bei jedem Abgleich fälschlich aufaddiert).
  - **Nichts geht verloren**: Bei viel Aktivität (eigene Käufe/Verkäufe oder arbeitende Mitarbeiter) werden ältere Einträge nun nachgeladen, statt nur die letzten 100 zu sehen.

**Changes (English):**
- **Diagnostics (Debug) Mode**: A debug mode can be toggled in Settings. It shows a per-feature traffic light (green/yellow/red) with a reason, so you can instantly see whether the item advisor, P&L tracker, etc. are working — and if not, why. An optional small on-screen panel is available too.
- **More Reliable Advisor Display**: Recommendation badges on items frequently went missing because the game re-renders the inventory in the background. Detection was reworked so badges reappear immediately after every re-render (equipping/unequipping, consuming, switching tabs).
- **More Accurate P&L (Profit & Loss)**:
  - **Consumption is tracked**: Food (steak/bread/fish), pills, and fired ammo are now booked as expenses — including items with no recorded purchase price, which fall back to market value.
  - **Correct Average Cost**: Purchase prices use a weighted moving average, and each transaction is counted exactly once (previously values were wrongly re-accumulated on every refresh).
  - **Nothing Slips Through**: During heavy activity (your own trades or working employees), older entries are now paged in instead of only seeing the latest 100.

## 2026-06-24 | Fehlerbehebung bei Latenzzeiten und Layout-Verschiebungen (v0.7.7)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Sofortige Navigation**: Der Seitenwechsel im Spiel wird nun über Ereignisse (pushState/replaceState/popstate) überwacht, wodurch der Ratgeber ohne Verzögerung sofort anspringt (vorher bis zu 2 Sekunden Wartezeit).
- **Sofortige Badge-Anzeige**: Ein intelligenter, kurzlebiger Beobachter platziert Badges in dem Moment, in dem die Spiel-Gegenstände gerendert werden, anstatt auf ein Zeitintervall zu warten.
- **Keine Layout-Ruckler**: Das Layout und die benötigte Höhe der Gegenstandskarten werden nun synchron im ersten Frame reserviert. Dadurch erscheinen die vorläufigen Symbole (`~`) direkt an der richtigen Stelle, überlappen keine Statistiken mehr und die Bilder verschieben sich nicht nachträglich.

**Changes (English):**
- **Instant Route Transitions**: Intercepted page history events (`pushState`/`replaceState`/`popstate`) to trigger route updates immediately, removing the previous 2-second detection delay.
- **Zero-Delay Badges**: Utilized a short-lived bootstrap MutationObserver to paint recommendations the exact microtask item cards appear in the DOM, instead of waiting on a polling timer.
- **Upfront Layout Reservation**: Synchronously reserved the card height and image offset upfront. This prevents provisional symbols (`~`) from overlapping stats and avoids any subsequent card shifting or layout jitter when final prices resolve.

## 2026-06-23 | Ressourcen-Markt Intraday-Grafik & Performance-Optimierung (v0.7.6)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Sofortige Grafikanzeige**: Die Intraday-Grafik (24h/3d) wird nun sofort aus dem Zwischenspeicher und dem lokalen Sampler gerendert, wenn das Modal geöffnet wird. Die frischen Daten werden geräuschlos im Hintergrund nachgeladen und aktualisiert.
- **Schnellere Ladezeiten**: Die Abfrage wurde für die 24h-Ansicht optimiert und fragt maximal 2 statt 6 Daten-Seiten ab. Daten werden nun getrennt nach Ansichtszeitraum (24h und 3d) gecached, um unnötige Ladeverzögerungen beim Wechseln zu vermeiden.
- **Bereinigte Speicherlecks**: Ein Fehler wurde behoben, bei dem die Hintergrund-Sampler-Intervalle beim Deaktivieren des Features nicht gestoppt und bei Reaktivierung mehrfach registriert wurden.
- **Detailverbesserungen**: Der Y-Achsen-Wert für die aktuelle Zeit ("now") zeigt nun den tatsächlichen letzten Preis statt des globalen Minimums an. Modale Erkennung wurde verfeinert, um Leistungseinbußen auf nicht-ressourcenbezogenen Modalen zu verhindern.

**Changes (English):**
- **Instant Graph Painting**: The intraday price graph (24h/3d) now renders immediately using cached transactions and locally sampled series. Fresh network data is fetched asynchronously in the background and redraws seamlessly once loaded.
- **Optimized Network Load**: Reduced default pagination to 2 pages (instead of 6) for 24h views. Queries and caches are now range-specific (24h and 3d views cached separately) to avoid network latency when swapping views.
- **Resolved Timer & Observer Leaks**: Fixed a bug where disabling the market graph left active sampler timers running and toggling it back on registered duplicate intervals. Reentrancy depth tracking has been hardened.
- **UI & Detection Cleanups**: The "now" X-axis price label highlights the most recent bucket's price instead of the global minimum. Refined title matching to avoid running queries on unrelated non-market dialogs.

## 2026-06-22 | Crafting-Profitabilitäts-Rechner (v0.7.5)

**Geänderte Dateien:** `warera-prost.user.js`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Crafting-Profitabilitäts-Rechner (Crafting Advisor)**: Ein neuer Info-Bereich wurde in das "Gegenstände herstellen" (Craft Items) Modal integriert, der direkt die Profitabilität anzeigt.
- **Ressourcenkosten-Berechnung**: Berechnet automatisch die Gesamtkosten an benötigtem Stahl und Schrott auf Basis der aktuellen Marktpreise.
- **Zufallscrafting-Modus (Random)**: Zeigt die mögliche Profit-Spanne (Gewinn/Verlust) im Vergleich zum schlechtesten und besten grünen Item des ausgewählten Tiers auf dem Markt an.
- **Gezieltes Crafting (Specific)**: Berücksichtigt den doppelten Stahlbedarf und vergleicht die Herstellungskosten direkt mit den minimalen/maximalen Angebotspreisen des spezifisch gewählten Items auf dem Markt.
- **Nahtloses Design**: Der Advisor-Bereich fügt sich farblich und stilistisch perfekt als dezente Box über den Schaltflächen des Original-Spielmenüs ein und aktualisiert sich dynamisch bei jeder Auswahländerung.

**Changes (English):**
- **Crafting Profitability Calculator (Crafting Advisor)**: Injected a new status panel directly into the "Craft Items" modal to display instant profitability feedback.
- **Resource Cost Calculation**: Automatically calculates the total cost of required steel and scraps based on current market floors.
- **Random Crafting Mode (Random)**: Compares resource inputs against the worst and best green items of the selected tier on the market to display the profit/loss range.
- **Specific Crafting Mode (Specific)**: Factors in the double steel requirement and compares costs directly against the min/max active market listings of the chosen item.
- **Seamless Integration**: Styled as a matching native dark overlay placed just above the close/craft buttons, dynamically updating whenever the selected tier or target item changes.

## 2026-06-22 | Sinnvollerer Pill-Timer während Buff/Debuff-Phase (v0.7.4)

**Geänderte Dateien:** `warera-prost.user.js`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Kein Pillen-Countdown mitten im Zyklus**: Während der aktiven Buff- oder Debuff-Phase (wenn eine neue Pille ohnehin noch Stunden entfernt ist) wird der reguläre Pillen-Countdown ausgeblendet, da dieser dort nicht hilfreich ist.
- **Kontextabhängige Statusanzeigen**: Statt des Pillen-Timers wird nun während dieser Phasen angezeigt:
  - Wenn ein Wunschzeitfenster eingestellt ist: Ein Countdown bis zum nächsten bevorzugten Pillenfenster (z. B. `Fenster ab 15:00 (in 3h)`).
  - Wenn kein Wunschzeitfenster eingestellt ist: Ein Countdown bis zur vollständigen H&H-Regeneration (z. B. `H&H voll in 2h`) bzw. die verbleibende Zeit bis zum nächsten Regenerationsticker (z. B. `Tick in 10m`), falls H&H bereits bei 100% liegt.
- **Unverändertes Gating**: Nähert man sich dem eigentlichen Bereit-Status (außerhalb von Buff/Debuff), verhält sich der Pillen-Countdown wie gewohnt.

**Changes (English):**
- **No pill countdown mid-cycle**: The regular pill countdown is hidden during active buff or debuff phases when the next pill is still far away and the timer is not actionable.
- **Contextual Status Displays**: During active buff/debuff phases, the countdown display changes dynamically:
  - With a preferred window set: Counts down to the next preferred window start (e.g. `Window from 15:00 (in 3h)`).
  - Without a preferred window: Counts down to 100% Health & Hunger recovery (e.g. `H&H full in 2h`) or shows the next regeneration tick countdown (e.g. `Tick in 10m`) if H&H is already full.
- **Unchanged Gating**: The countdown returns to the standard behavior (time to next pill) once you leave the buff/debuff phases and approach the ready/gated state.

## 2026-06-22 | Pill-Reminder Gating & H&H-Budget-Verbesserungen (v0.7.3)

**Geänderte Dateien:** `warera-prost.user.js`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Präzises Gating & Tooltip**: Der Pill-Timer zählt jetzt zuverlässig auf den spätesten Zeitpunkt der drei Bedingungen herunter (H&H voll, Debuff-Ende, Wunschfenster-Start). Ein neuer Tooltip schlüsselt die einzelnen Gates detailliert auf.
- **Entkoppeltes H&H-Budget**: Das H&H-Budget läuft nun unabhängig vom Pill-Status rein über das konfigurierte Wunschfenster. So wird das Budget auch ohne Pillen-Anker berechnet und gerendert.
- **Native Kokain-Badges**: Blockierende Overlays auf Kokain-Items im Inventar und im Konsum-Popup wurden durch ein kleines, dezentes Badge im nativen In-Game-Design ersetzt, das den genauen H&H-Wert oder die Freigabe nennt.
- **Bessere Balken-Integration & Kerbe**: Die H&H-Budget-Balken overlayen keine separaten Blöcke mehr, sondern zeichnen den freien Bereich als helle In-Hue-Farbfläche direkt über die Standardbalken und markieren das Limit mit einer dünnen Grenzkerbe.
- **Live-Updates**: Durch einen Observer werden Änderungen der H&H-Werte (z. B. nach Angriffen oder Konsum) sofort in Echtzeit im Budget widergespiegelt.
- **Prozent-Präfix & Buff-Filter**: Der Budget-Text zeigt nun stets den aktuellen Füllstand des Balkens als Prozent-Präfix an (z. B. `90% · ⬇ 12 frei`). Während der aktiven Buff-Phase werden alle Budget-Overlays ausgeblendet und es wird nur noch der aktuelle Prozentwert angezeigt.

**Changes (English):**
- **Precise Gating & Tooltip**: The pill timer now counts down to the latest of the three conditions (H&H full, debuff ends, preferred window start). A detailed tooltip breakdown lists the status of each gate.
- **Decoupled H&H Budget**: The Health & Hunger budget is decoupled from the active pill state and operates purely on the preferred window, ensuring it is drawn even without a pill anchor.
- **Native Cocaine Badges**: Replaced bulky blockers on cocaine items with small, native-styled badges in both inventory cards and consume popovers, clearly stating the blocker or readiness (e.g. `H&H 80%` or `Pille OK`).
- **Better Bar Integration & Notch**: The budget overlays are now styled as subtle in-hue highlights on the native bar fills with a clean 1-2px floor marker line (notch), removing generic dark block overlays.
- **Live Updates**: A debounced mutation observer updates the H&H budget in real time immediately after any changes to health or hunger.
- **Percentage Prefix & Buff Filtering**: Budget labels are now prefixed with the current fill percentage (e.g., `90% · ⬇ 12 free`). During the active `BUFF` phase, all budget overlays/notches are hidden and only the clean percentage is shown.

## 2026-06-22 | Korrekturen Pill-Reminder & Neue UX (v0.7.2)

**Geänderte Dateien:** `warera-prost.user.js`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Nativer Look & Kokain-Icon**: Die Pill-Anzeige in der Menüleiste führt nun das echte In-Game-Pillensymbol. Das Styling wurde an die anderen System-Chips der Menüleiste angepasst.
- **Klarere Bezeichnungen**: Cryptische Anzeigen wie "WARTEN (H&H)" wurden durch eindeutige Statusbezeichnungen ersetzt ("Aktiv", "Messer", "Regen", "BEREIT" und "Nächste ~ [Zeit]"). Die aktuelle H&H-Menge wird direkt im Timer-Chip angezeigt (z. B. `(77%)`).
- **Fehler mit kontinuierlich steigendem Update-Timer behoben**: Die Suche nach dem Countdown-Timer wurde auf die Header-Elemente beschränkt und die Suchtiefe limitiert. Zudem wird der Text des Badges selbst ignoriert, um Feedback-Schleifen zu verhindern.
- **Sicherer User-ID-Scrape**: Die Erkennung der eigenen Benutzer-ID scannt nicht mehr global die Seite nach Avataren, sondern beschränkt sich auf das Kopfzeilen-Menü. Dies verhindert, dass auf Ranglisten- oder Mitgliederseiten fremde Spieler fälschlicherweise als "ich" erkannt werden.
- **Robuster Pill-Status-Reset**: Um Fehlmessungen beim Seitenwechsel zu vermeiden, wird der Pill-Status erst nach 3 aufeinanderfolgenden fehlenden Anzeigen (ca. 30 Sekunden) auf "Bereit" (none) zurückgesetzt.

**Changes (English):**
- **Native Look & Cocaine Icon**: The topbar pill badge now displays the actual in-game cocaine image icon. The overall chip styling is adapted to match native topbar items.
- **Clearer Labels**: Replaced cryptic tags like "WAITING (H&H)" with clear, pill-focused statuses ("Active", "Knife", "Recover", "READY", and "Next ~ [time]"). The lowest H&H recovery percentage is shown directly inside the timer chip (e.g. `(77%)`).
- **Fixed continuously increasing update timer**: Restricted the countdown timer search to header/user menu elements and limited the traversal depth. The Pill Reminder badge text is also excluded from search to prevent circular feedback loops.
- **Safer own User ID scraping**: Own user ID detection no longer globally scans the page for avatar links, preventing other players in ranking lists or member tables from being misidentified as "self".
- **Robust Pill status reset**: To avoid resetting the status on transient page transitions, the pill reminder now requires 3 consecutive empty readings (approx. 30 seconds) before resetting back to "Ready" (none).

## 2026-06-21 | Aufgeräumte Einstellungen & Rechtes Cheatsheet-Flyout (v0.7.1)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Schlankeres Einstellungs-Menü**: Feature-Beschreibungen wurden hinter einklappbare Info-Symbole (`ℹ`) verlegt, um das Einstellungsfenster kompakter und übersichtlicher zu halten.
- **Cheatsheet als rechtes Flyout**: Das Hilfe-Cheatsheet klappt nun auf größeren Bildschirmen (> 900px Breite) rechts neben dem Einstellungsfenster auf. Auf kleineren Bildschirmen wird es wie bisher platzsparend darunter gestapelt.
- **Bessere Benutzeroberfläche**:
  - Der Eingabebereich für Ländercodes wird nur noch eingeblendet, wenn der Battle-Advisor aktiv ist (progressive Offenlegung).
  - Info-Toggles wurden auch für den Scrap-Flip-Indikator und die Live API integriert.
  - Die ungenutzte Option für erhöhte Crit-Gewichtung wurde entfernt.

**Changes (English):**
- **Cleaner Settings Menu**: Feature descriptions are now collapsed behind toggleable info icons (`ℹ`), making the settings window much more compact and organized.
- **Cheatsheet as a Right-Flyout**: The help cheatsheet now opens to the right of the settings window on desktop viewports (> 900px width). On smaller screens, it automatically stacks below the settings.
- **Improved UI Experience**:
  - The allied country codes text box is dynamically hidden until the Battle Advisor option is enabled (progressive disclosure).
  - Inline explanations (`ℹ` info toggles) were added to the Scrap-Flip indicator and the Live API fields.
  - Removed the unused high crit weighting option.

## 2026-06-21 | Kompakte Inline Battle-Orders (v0.7.0)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Kompakte Orders im Angriffs-/Verteidigungsbutton**: Anstelle eines klobigen Blocks unter dem Button werden die aktiven Angriffs-/Verteidigungsbefehle jetzt inline und kompakt direkt in den Buttons angezeigt (neben dem Text und der Landesflagge).
- **Anzeige von Symbol & Flagge**: Es wird ausschließlich das Prioritäts-Fadenkreuz (in der originalen Farbe: grün, gelb oder rot) und die Landes- oder Militäreinheit-Flagge (MU) dargestellt (kein Text).
- **Unabhängige Anzeige**: Beide Buttons zeigen ihre jeweiligen Orders an, wenn welche vorliegen, unabhängig von der Bündnis-Hervorhebung.

**Changes (English):**
- **Compact Orders inside attack/defend buttons**: Instead of a bulky block below the button, active attack/defend orders are now displayed inline and compactly inside the buttons (next to the label and base flag).
- **Icons & Flags only**: Only displays the priority crosshair (preserving the original green/yellow/red color) and the country or military unit (MU) flag (no text description).
- **Independent Display**: Both buttons show their respective orders if present, independent of alliance highlight styling.

## 2026-06-21 | Haltbarkeit & Profil-Layout Fixes (v0.6.9)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Haltbarkeit < 100% komplett ignoriert**: Items mit weniger als 100% Haltbarkeit (beschädigt) werden vom Advisor nun komplett ignoriert. Es wird kein Badge platziert und das originale Spiel-Tooltip bleibt vollständig erhalten (gilt auch für ausgerüstete Items).
- **Fehlerhaftes Parsen korrigiert**: Ein Fehler im Parser wurde behoben, bei dem der Rüstungswert in die Haltbarkeits-Erkennung leckte (z. B. Rüstung 5 und Haltbarkeit 29% führten zu einem falschen Wert von 529% im Tooltip).
- **Keine Overlays auf Charakterseite**: Der Ausrüstungs-Block auf der Charakter-Profilseite wird nun zuverlässig gefiltert. Es werden dort keine Advisor-Overlays oder Badges platziert.

**Changes (English):**
- **Durability < 100% fully ignored**: Items with less than 100% durability (damaged) are now completely ignored by the advisor. No badge is shown and the original game tooltip is fully preserved (also applies to equipped items).
- **Durability parsing leak fixed**: Fixed a parser bug where the armor stat leaked into the durability regex parser (e.g., armor 5 and durability 29% showing as 529% in tooltip).
- **No overlays on character page**: The equipment block on the character profile page is now filtered out. No advisor overlays or badges will be rendered there.

## 2026-06-21 | Battle-Advisor (v0.6.8)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- Neu: **Battle-Advisor** — auf Kampfseiten (`/battle/<id>`) wird der richtige Button automatisch hervorgehoben und der gegnerische Button verkleinert und ausgegraut (bleibt klickbar).
- Der verbündete Button erhält einen grünen Rahmen und ist leicht vergrößert. Die eigenen Länder- und MU-Orders werden kompakt direkt im Button angezeigt.
- Ally-Erkennung: primär über eine konfigurierbare Länderliste (⚙️ Einstellungen → „Verbündete Ländercodes"), Fallback strukturell über den Orders-Block.
- Voreingestellt sind alle aktuellen deutschen Verbündeten (`de,pt,es,gm,ir,na,sr,th,at,fi,ie,no,se,uk,va,bf,cd,ye,ne,au,br,id`).
- Feature ist **experimentell** und muss in den Einstellungen aktiviert werden.

**Changes (English):**
- New: **Battle Advisor** — on battle pages (`/battle/<id>`) the correct button is highlighted and the enemy button is shrunk and greyed out (still clickable).
- The ally button gets a green outline and is slightly scaled up. Country and MU orders are shown compactly inside the button.
- Ally detection: primary via a configurable country code list (⚙️ settings → "Allied country codes"), structural fallback via the orders block.
- Pre-configured with all current German allies (`de,pt,es,gm,ir,na,sr,th,at,fi,ie,no,se,uk,va,bf,cd,ye,ne,au,br,id`).
- Feature is **experimental** and must be enabled in settings.

## 2026-06-21 | Spieler-Notizen integriert (v0.6.7)

**Geänderte Dateien:** `warera-prost.user.js`, `README.md`

**Änderungen (Deutsch):**
- Neu: **Spieler-Notizen** direkt in PROST integriert. In den Einstellungen (⚙️) unter „Spieler-Notizen bei Spieler-Links 📒 (experimentell)" aktivierbar.
- Nach dem Aktivieren erscheint neben jedem Spieler-Link ein kleines `✎`-Icon. Wurde bereits eine Notiz gespeichert, wechselt das Icon auf 📒.
- **Hover-Tooltip:** Beim Überfahren des Icons mit der Maus wird eine Vorschau der Notiz angezeigt (max. 120 Zeichen, danach gekürzt mit …).
- Notizen werden lokal gespeichert und bleiben nach einem Reload erhalten.
- Die Notizen-Daten sind kompatibel mit dem separaten „Warera User Notes"-Script — bitte nur eines von beiden aktivieren, nicht beide gleichzeitig.

**Changes (English):**
- New: **Player notes** built directly into PROST. Enable in settings (⚙️) under "User notes on player links 📒 (experimental)".
- A small `✎` icon appears next to every player link; changes to 📒 once a note has been saved.
- **Hover tooltip:** Hovering the icon shows a preview of the note (up to 120 characters, truncated with … if longer).
- Notes are stored locally and persist across reloads.
- Storage is compatible with the standalone "Warera User Notes" script — enable only one at a time.

## 2026-06-21 | Scrap-Flip-Indikator stabilisiert (v0.6.6)

**Geänderte Dateien:** `warera-prost.user.js`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- Scrap-Flip-Indikator von „experimentell/unstable" auf **stabil** gehoben — die beiden offenen Bekannten Probleme sind behoben.
- **Falsch-Positive im Übersichts-Grid behoben:** Der Grid-Kaufpreis ist nur ein gescrapter Floor, der unter dem günstigsten echten Angebot liegen kann (z. B. 3,9 statt real 4,1). Neu: `CONFIG.scrapFlipGridMargin` (5 %) bläht den Grid-Preis vorsichtig auf, sodass nur klar profitable Tiles markiert werden. Detailseiten nutzen den echten Offer-Preis und bleiben unverändert.
- **Badge-Overflow behoben:** Der Flip-Hinweis lief aus der Item-Kachel heraus. Neu sitzt er als kompaktes Ribbon **innerhalb** der Kachel (an der Stelle des Mengen-Banners, das auf dem Equipment-Markt immer „-" zeigt) und überläuft die Kachelgrenzen nicht mehr.
- Tests erweitert: Marge-Verhalten von `computeScrapFlip` abgesichert (marginaler Floor flippt roh, nach 5 % Marge nicht mehr).

**Changes (English):**
- Promoted the scrap-flip indicator from experimental/unstable to **stable**; both open known issues are resolved.
- Fixed grid false-positives via a 5 % `scrapFlipGridMargin` safety buffer on the scraped floor price (detail-page offers use the real price, untouched).
- Fixed the badge overflow: the hint now renders as a compact ribbon inside the tile (reusing the quantity-banner slot) instead of overflowing the tile bounds.
- Extended tests to cover the grid margin behavior.

## 2026-06-20 | Scrap-Flip Indicator (experimentell)

- Started the experimental scrap-flip indicator for the market page.
- Added the core profit calculation helper `computeScrapFlip(...)` and exposed it for smoke-test use.
- Added the first settings plumbing for a `showScrapFlip` toggle, plus the new i18n string for the checkbox.
- Added the market-side helper scaffolding for grid/detail rendering and the green flip badge styles.
- Fixed the test harness to use float-safe assertions (no more IEEE-754 rounding failures) and added no-flip / unknown-tier / missing-input cases.
- Fixed a bug where the detail-page offer reader grabbed the attack stat instead of the price; it now targets the coin-stack price icon.
- Fixed a serious leak where the flip badge was stamped across the whole page (chat, HUD, map, nav). The detail fallback now only scopes to offer cards holding the matching item image, never the generic icon class.

## 2026-06-20 01:05 | WareEra Inventory Advisor v0.6.5

**Geänderte Dateien / Changed files:**
- `warera-inventory-advisor.user.js`
- `warera-notes.user.js`

**Änderungen (Deutsch):**
- **Sprachauswahl per Flagge:** Die Sprache wird jetzt bewusst über eine Flaggen-Auswahl im Einstellungsfenster gewählt. Standard ist Deutsch, Englisch kann per Dropdown umgeschaltet werden.
- **Keine automatische Spracherkennung mehr:** Die Umschaltung folgt nur noch der gespeicherten Auswahl und bleibt stabil, auch wenn die Spieloberfläche ihre Sprache wechselt.
- **Hinweise synchronisiert:** Das Notiz-Script übernimmt die gemeinsame Sprache des Advisors, falls beide zusammen laufen.
- **Technische Aufräumarbeiten:** Preisformatierung und Zahlenparser wurden robuster gemacht, und die temporären `TEST`-Namen wurden wieder entfernt.

**Changes (English):**
- Added an explicit flag-based language selector in settings, with German as the default and English available from the dropdown.
- Removed automatic language detection so the chosen locale stays stable even when the game UI changes language.
- Notes now follow the advisor’s shared locale when both scripts are present.
- Hardened price formatting and number parsing, and removed the temporary `TEST` labels.

## 2026-06-20 00:20 | WareEra Inventory Advisor v0.6.4

**Geänderte Dateien / Changed files:**
- `warera-inventory-advisor.user.js`

**Änderungen (Deutsch):**
- **Mehr Platz für Anzeigen:** Punkteanzeige und Status-Icon wurden in eine neue Kopfzeile über dem Item-Bild verschoben, damit sie das Bild nicht mehr verdecken.
- **Bessere Preisanzeige:** Schrott- und Marktpreise stehen nun übersichtlich untereinander (🔨 für Schrottwert, 💰 für Marktpreis).
- **Weniger Chaos:** Für ausgerüstete und beschädigte Gegenstände werden keine Preise mehr angezeigt.
- **Rüstungs-Werte:** Helme und Rüstungen zeigen nun ebenfalls ihre Werte an.
- **Fehlerbehebungen:** Doppelte oder dreifache Symbole auf Gegenständen wurden behoben.

**Changes (English):**
- Moved score and status icons to a new header above the item image.
- Redesigned prices into a stacked layout (🔨 for scrap, 💰 for market).
- Hidden prices on equipped or damaged gear to clean up the view.
- Added score badges to helmets and armor.
- Fixed duplicated status badges.

## 2026-06-19 22:05 | WareEra Inventory Advisor v0.6.3

**Changed files:**
- `warera-inventory-advisor.user.js`

**Change:**
- Reintroduced the live data toggle (`useLiveOffersApi`) in the settings UI.
- Integrated fallback scraps price scraping directly from the market page selector (`item-code-selector-scraps`).
- Prioritized precise API scrap price over rounded scraped market price.
- Supported formatting prices with up to 4 decimal places dynamically (`fmt` and `fmtBadge`).
- Fixed market selector price extraction bug using `numberNearClean` to avoid number merging with stock count.

**Reason:**
- Restores optional API access, enables scrap value calculation without an API key, and fixes price precision and extraction bugs.

## 2026-06-19 21:56 | WareEra Inventory Advisor v0.6.2

**Changed files:**
- `warera-inventory-advisor.user.js`

**Change:**
- Refined script `@description` in the header block to clearly state local functionality, optional API key integration, and absence of gameplay automation.

**Reason:**
- Safety and transparency compliance with Greasy Fork description rules.

## 2026-06-19 21:40 | WareEra Inventory Advisor v0.6.1

**Changed files:**
- `warera-inventory-advisor.user.js`

**Change:**
- Stripped version suffix from `@name` in the header block to allow clean version-agnostic URLs on Greasy Fork.
- Updated `@author` to `beertierchen` and `@namespace` to `TBD`.

**Reason:**
- Preparation for public listing on Greasy Fork.

## 2026-06-19 19:05 | WareEra Inventory Advisor v0.6.0

**Changed files:**
- `warera-inventory-advisor.user.js`

**Change:**
- Added robust tRPC error detection and missing data handling.
- Introduced a 6-hour TTL (`scrapedPriceTtlMs`) for scraped market prices and cache clearing.
- Implemented `Number.isFinite` date checks for transactions (NaN-Datum-Guard).
- Protected `normalizePrices` from prototype pollution.
- Corrected the top fraction cutoff calculation in `isTopRoll`.
- Consolidated ranking logic in `calculateInventoryRankings` to prevent rank collisions using sorted indices.
- Implemented dynamic weapon tier detection using `weaponRanges` on parsed stats.
- Added MutationObserver pause (`suspendObserver` / `resumeObserver`) to resolve re-entrancy.
- Optimized performance by cloning card DOM exactly once.
- Limited DOM search scope in `findMarketSellContainer` to the `main` layout element.
- Replaced invasive card inline style overrides with a clean `.wia-card-override` CSS class.
- Increased fallback route polling interval from 800ms to 2000ms.

**Reason:**
- Major code review improvements for data integrity, decision accuracy, concurrency, layout, and performance.
