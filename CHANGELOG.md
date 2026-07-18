# CHANGELOG

## 2026-07-18 | Feature: Version-Selfcheck & Signierter Admin-Sicherheitskanal (v0.9.3)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/test-advisor-load.js`, `.gitignore`, `README.md`, `tools/admin-sign/sign.js`

**Änderungen (Deutsch):**
- **Automatischer Versions-Selfcheck**: Prüft einmal täglich beim Start oder manuell über das Tampermonkey-Menü auf neuere Versionen auf GreasyFork und zeigt einen auffälligen, sicheren Update-Hinweis in den Einstellungen an.
- **Verschlüsselter Admin-Sicherheitskanal**: Empfängt kritische Update- und Sicherheitswarnungen über einen öffentlichen Kanal. Alle Meldungen sind kryptografisch mit Ed25519 signiert und gegen Replay-Angriffe geschützt.
- **Hintergrund-Optimierungen**: Alle automatischen Netzwerkprüfungen werden gedrosselt oder pausiert, wenn der Browser-Tab im Hintergrund liegt.

**Changes (English):**
- **Automatic Version Selfcheck**: Checks once a day on startup or manually via the Tampermonkey menu for newer versions on GreasyFork, displaying a prominent, secure update banner in the settings.
- **Cryptographic Admin Safety Channel**: Receives critical update and safety alerts via a public feed. All announcements are cryptographically verified using Ed25519 and protected against replay attacks.
- **Background Optimizations**: Automatically throttles or pauses network checks when the browser tab is hidden.

## 2026-07-18 | Bugfix: Rescan-Schleife, Log-Spam & Code-Bereinigung (v0.9.2)

**Geänderte Dateien:** `warera-prost.user.js`, `package.json`, `CHANGELOG.md`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Rescan-Schleife im Inventar behoben**: Ein Fehler, bei dem das Inventar unter bestimmten Bedingungen kontinuierlich neu geladen wurde (Endlosschleife), wurde durch den Wechsel auf stabile Element-Fingerprints behoben.
- **Konsolen-Log-Spam reduziert**: Unnötiger Log-Spam bei Hintergrund-Preisanfragen und wiederholte Mute-in-Debuff Warnungen bei ausgeschaltetem Pill-Reminder wurden unterbunden.
- **Leistungsoptimierung**: Hintergrundtransaktionen werden nun gebündelt und ratenbegrenzt geladen.
- **Code-Bereinigung (SonarLint)**: Unbenutzter Code, veraltete Variablen und riskante reguläre Ausdrücke wurden entfernt oder modernisiert.

**Changes (English):**
- **Fixed Inventory Rescan Loop**: Resolved a bug causing continuous reloading of the inventory view by adopting stable DOM element fingerprinting.
- **Reduced Console Log Spam**: Suppressed verbose console noise during background price fetches and deduplicated repeated mute-in-debuff warnings.
- **Performance Optimizations**: Background transaction fetches are now bundled and rate-limited.
- **Code Cleanup (SonarLint)**: Removed dead code/variables and modernized regular expressions to ensure maximum compliance and runtime safety.

## 2026-07-18 | Bugfix: Preise im keylosen Modus reaktiviert (v0.9.1)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Preisanzeige korrigiert**: Ein Fehler, bei dem die Materialpreise im keylosen Modus nicht geladen wurden (Anzeige "?"), wurde behoben. Der Gateway-Zugriff sendet nun wieder die korrekte App-Identifikation.
- **Einmaliges Zurücksetzen**: Fehlerhafte oder veraltete Blockierungen von API-Prozeduren werden beim Update automatisch zurückgesetzt, damit die Preisanzeige sofort wieder funktioniert.
- **Konsolen-Logs und Benennungen**: Interne Log-Ausgaben wurden einheitlich von `[WIA]` auf `[PROST]` umbenannt. Zudem werden zukünftige API-Fehler deutlicher in der Konsole und im in-game Diagnose-Panel (Ampel) angezeigt.

**Changes (English):**
- **Fixed Price Display**: Resolved an issue where material prices did not load in keyless mode (showing "?"). The gateway request now correctly transmits the required app identifier.
- **One-time Reset**: Any stale blocked/gated API procedures are automatically cleared upon upgrading to ensure immediate restoration of price data.
- **Console Log & Prefix Cleanup**: Internal console log prefixes have been standardized from `[WIA]` to `[PROST]`. Gating failures are now logged clearly in the console and the in-game diagnosis panel.

## 2026-07-17 | API-Härtung: session-lose Requests, nur x-api-key (v0.9.0)

**Geänderte Dateien:** `warera-prost.user.js`, `package.json`, `README.md`, `CHANGELOG.md`, `tests/test-advisor-load.js`, `docs/wiki/Settings.md`, `docs/wiki/Settings.de.md`

**Änderungen (Deutsch):**
- **Session-lose Anfragen**: Die Anfragen an die offizielle API (`api2.warera.io`) und das Gateway erfolgen nun ausschließlich session-los. Zur Absicherung wurde eine strikte Header-Allowlist etabliert, die die Übertragung von Cookie- oder Authorization-Headern systemseitig ausschließt.
- **Erforderlicher API-Key**: Für den Zugriff auf die offizielle API (`api2.warera.io`) ist nun ein API-Key zwingend erforderlich. Ohne API-Key nutzt das Skript ausschließlich das Community-Gateway (Preise, Transaktionen, Schlachten) und kontaktiert die offizielle API niemals. Allianz- und suchbasierte Funktionen sind ohne Key deaktiviert.
- **Klartext-Speicherung**: Der API-Key wird zur einfachen Nachvollziehbarkeit im lokalen Speicher im Klartext abgelegt.
- **API-Key Hilfestellung**: In den Einstellungen wird ein Hilfebereich eingeblendet, wenn kein Key hinterlegt ist, und abhängige Optionen werden ausgegraut.
- **Sicherheits-Compliance-Tests**: Die Testsuite wurde um automatisierte Prüfungen erweitert, die die Einhaltung des session-losen Designs statisch und zur Laufzeit sicherstellen.

**Changes (English):**
- **Session-less Requests**: Network requests to the official API (`api2.warera.io`) and gateway are now strictly session-less. A strict header allowlist has been introduced to programmatically prevent sending cookie or authorization headers.
- **Required API Key**: An official API key is now required for all official-API access. Without a key, the script only uses the community gateway (prices, transactions, battles) and never contacts `api2.warera.io`. Alliance- and search-based features stay off.
- **Plaintext Storage**: The API key is stored locally in plain text to allow easy auditability.
- **Onboarding Help**: An inline help section is displayed in Settings when the API key field is blank, and key-dependent options are disabled.
- **Compliance Tests**: Automated tests have been added to verify compliance with the session-less design statically and at runtime.

## 2026-07-16 | Deaktivierung des Item Advisors im Markt & Entfernung von DOM-Scraping (v0.8.18)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Deaktivierung des Advisors im Markt**: Der Item Advisor (inklusive aller Overlays, Bewertungen und Preisvorschläge) wurde auf den Markt-Seiten komplett deaktiviert, um den Spielrichtlinien voll zu entsprechen.
- **Entfernung von DOM-Preisscraping**: Das Auslesen von aktuellen Marktangeboten aus dem HTML (DOM-Scraping) wurde vollständig aus dem Skript entfernt. Die Bewertung der Ausrüstung im Inventar erfolgt stattdessen sicher über die offizielle API für historische Transaktionsdaten.
- **Entfernung der API-Vorschau für Angebote**: Der nicht mehr genutzte Code-Pfad für den blockierten API-Endpunkt der Marktangebote wurde gelöscht.
- **Entfernung des Scrap-Flips**: Der Scrap-Flip-Rechner und die zugehörige Option in den Einstellungen wurden entfernt.

**Changes (English):**
- **Disabled Advisor on Market Pages**: The Item Advisor (including overlays, evaluations, and price recommendations) has been completely disabled on market pages to fully comply with game policies.
- **Removed DOM Price Scraping**: Scraping live equipment listing prices from the market HTML has been completely removed. Inventory equipment evaluation now safely relies on the official API for historical transaction logs.
- **Removed Dead Offers API Path**: The unused code path for the blocked offers API endpoint has been deleted.
- **Removed Scrap-Flip**: The Scrap-Flip calculator and its settings option have been removed.

## 2026-07-12 | ntfy-Schutz vor Sperren, MU-Heilungs-Button-Dimmen & Debuff-Stummschaltung (v0.8.17)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/test-advisor-load.js`, `tests/bounty-notify.test.js`

**Änderungen (Deutsch):**
- **ntfy-Sperrschutz**: Alle Anfragen an ntfy.sh laufen jetzt über einen zentralen Rate-Limit-Wächter. Meldet ntfy „zu viele Anfragen" (429), pausieren sämtliche Push-Sendungen automatisch (5 Minuten, bei Wiederholung bis zu 60 Minuten) statt weiterzufeuern — das verhinderte bisherige IP-Sperren durch ntfy.sh. Jede Drosselung ist im Debug-Log und auf der Ampel sichtbar.
- **Sparsamere Kopfgeld-Weiterleitung**: Das Abfrage-Intervall des persönlichen Kopfgeld-Mirrors wurde von 3 auf 10 Sekunden erhöht, um innerhalb des ntfy-Budgets zu bleiben; das Lesefenster wurde auf 60 Sekunden vergrößert, damit nichts verloren geht.
- **MU-Heilung ausgrauen (neu, optional)**: Auf der MU-Seite wird der „Ask for help"-Button klein und grau dargestellt, solange der Pillen-Debuff läuft oder das Leben voll ist — kein versehentliches Verbrennen des gemeinsamen Heil-Cooldowns mehr. Aktivierbar im Pillen-Bereich der Einstellungen (Standard: aus). Der Button bleibt immer klickbar.
- **Kopfgeld-Stummschaltung im Debuff (neu, optional)**: Auf Wunsch werden während des Pillen-Debuffs keine Kopfgeld-Pushs an das persönliche Topic weitergeleitet.
- **Popup-Fix**: Kopfgeld-Popups, die sich in einem inaktiven Tab angestaut haben, werden beim Zurückwechseln nicht mehr nachträglich angezeigt.

**Changes (English):**
- **ntfy ban protection**: All ntfy.sh requests now pass through a central rate-limit guard. When ntfy answers "too many requests" (429), every push send pauses automatically (5 minutes, escalating up to 60 minutes on repeats) instead of hammering on — this is what previously caused ntfy.sh IP bans. Every throttle is visible in the debug log and on the health lights.
- **Leaner bounty forwarding**: The personal bounty mirror's poll interval was raised from 3 to 10 seconds to stay inside the ntfy budget; the read window grew to 60 seconds so nothing is missed.
- **Dim MU heal (new, optional)**: On the MU page the "Ask for help" button is rendered small and gray while your pill debuff is running or your HP is full — no more accidentally burning the shared heal cooldown. Enable it in the pill section of the settings (default: off). The button always stays clickable.
- **Mute bounties during debuff (new, optional)**: Optionally, no bounty pushes are forwarded to your personal topic while the pill debuff is active.
- **Popup fix**: Bounty popups that piled up in an inactive tab no longer replay when you switch back.

## 2026-07-09 | Persönliche Push-Benachrichtigungen, In-Game Toasts & Einstellungs-Optimierung (v0.8.16)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Zentrale Benachrichtigungs-Optionen**: Ein neuer Bereich in den Einstellungen fasst das persönliche ntfy-Topic und den Geheimschlüssel zusammen. Zudem wird direkt ein ntfy-Link zur einfachen Einrichtung auf dem Smartphone bereitgestellt.
- **Master-Checkbox für Pillen-Erinnerungen**: Eine Master-Checkbox steuert jetzt alle Benachrichtigungen für den Pill Reminder (H&H voll, Pillenfenster, Debuff abgelaufen) und synchronisiert deren Zustände automatisch.
- **In-Game Toasts für Events**: Wenn eine persönliche Benachrichtigung (wie das Pillenfenster) ausgelöst wird, erscheint nun ein optisch ansprechendes Toast-Fenster direkt im Spiel – analog zu den Kopfgeld-Meldungen.
- **Kopfgeld-Weiterleitung repariert**: Fehler in der Validierung und Filterung von geteilten Kopfgeldern wurden behoben, sodass diese nun zuverlässig an das persönliche ntfy-Topic weitergeleitet werden.
- **Cleanere Einstellungen**: Der alte Cache-Status-Text wurde entfernt, um das Einstellungsmenü übersichtlicher zu gestalten. Unter *Diagnose* gibt es zudem nun Buttons, um alle Benachrichtigungen zu Testzwecken live auszulösen.

**Changes (English):**
- **Centralized Notification Options**: A new general notification details block houses the personal ntfy topic and secret key, providing a direct ntfy link for easy subscription on your phone.
- **Pill Reminder Master Checkbox**: A master checkbox now controls all Pill Reminder notifications (H&H full, preferred window, debuff expired) and keeps sub-states synchronized automatically.
- **In-Game Event Toasts**: When a personal notification fires, a beautiful visual toast popup is shown directly inside the game UI—similar to the bounty toasts.
- **Fixed Bounty Forwarding**: Resolved formatting and validation filter issues so that shared bounties are now successfully mirrored to your personal ntfy topic.
- **Cleaner Settings**: Removed the old cache status strip for a cleaner settings menu. Added notification test buttons under *Diagnose* to trigger each popup and push event on demand.

## 2026-07-08 | Detaillierter Kassenzettel & Gold-Delta-Abstimmung (v0.8.15)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`

**Änderungen (Deutsch):**
- **Detaillierterer Kassenzettel**: Der Beleg in der Browser-Konsole schlüsselt nun Verkäufe, Einkäufe, sonstige Einnahmen (Schrott, Spenden, etc.) und sonstige Ausgaben (Spenden) detailliert auf, statt sie nur aufzusummieren.
- **Einkäufe tracken**: Käufe werden jetzt über P&L-Logs erfasst und im Beleg unter der neuen Sektion `--- KÄUFE (In Käufe gebunden) ---` aufgeführt.
- **Gruppierung gleicher Einträge**: Doppelte oder identische Einträge (wie z. B. mehrfaches Schrott-Zerschreddern oder wiederholte Spenden an denselben Empfänger) werden im Beleg zusammengefasst, um die Ausgabe übersichtlich zu halten.
- **Konsistente Benennung und Abstimmung**: Das UI-Label für sonstige Ausgaben wurde zu "Spenden/Sonstiges" geändert. Am Ende des Belegs wird nun eine detaillierte Abstimmungsrechnung angezeigt, die den Übergang von Gesamt-P&L zu Gold Delta nachvollziehbar macht.

**Changes (English):**
- **Detailed Receipt Layout**: The browser console receipt now breaks down sales, purchases, other income (scraps, incoming donations, etc.), and other expenses (outgoing donations) into detailed lists instead of just showing totals.
- **Track Capitalized Purchases**: Item purchases are now logged and displayed in a dedicated `--- KÄUFE (In Käufe gebunden) ---` section inside the receipt.
- **Group Duplicate Entries**: Identical entries (such as multiple scrap salvage operations or multiple donations to the same recipient) are aggregated to keep the receipt clean and readable.
- **Reconciliation & Label Consistency**: The UI label for other expenses was changed to "Spenden/Sonstiges" (Donations/Other). A reconciliation table was added at the bottom of the receipt to clearly explain the difference between Total P&L and Gold Delta.

## 2026-07-08 | Pille-Overlays deaktiviert & Eingeklappte Einstellungen (v0.8.14)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Deaktivierung der Overlays auf der Pille**: Alle farbigen Rahmen und Overlays (sowohl das grüne READY- als auch das gelbe H&H-Overlay) auf der Cocain-Itemkarte im Inventar wurden entfernt, da diese die Sicht auf die Itemkarte gestört haben.
- **Eingeklappte Einstellungen als Standard**: Beim Öffnen der Einstellungen sind die verschiedenen Optionengruppen (wie z. B. Pillen-Optionen, Bounty-Optionen oder Advisor-Einstellungen) standardmäßig eingeklappt, was für ein saubereres Layout sorgt.

**Changes (English):**
- **Disabled Cocaine Item Overlays**: Removed all colored borders and overlays (both the green READY and yellow H&H overlays) from the Cocaine item card in the inventory, resolving visual clutter on the card itself.
- **Collapsed Settings by Default**: Option categories (such as Pill options, Bounty options, or Advisor settings) inside the settings modal are now collapsed by default when opening, providing a cleaner layout.

## 2026-07-07 | Kopfgeld-Mehrfachmeldungs-Schutz & Einstellungs-Fallback (v0.8.13)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`

**Geänderte Einstellungen / Configs (Workspace-lokal):** `.agents/AGENTS.md` (Workflow-Ergänzung für Board-Kanban-Spalten)

**Änderungen (Deutsch):**
- **Kopfgeld-Mehrfachmeldungsschutz (Intra-Client)**: Behebt das Problem, bei dem Tabs desselben Browsers (gleicher Client) Kopfgeld-Meldungen bis zu 5-mal zeitgleich auslösten. Ein neuer, tab-spezifischer Jitter sorgt dafür, dass die verschiedenen Tabs leicht zeitlich versetzt arbeiten. Der erste erfolgreiche Versand unterdrückt dadurch automatisch Duplikate in den restlichen Tabs.
- **Optimistische Slot-Sperre & Lock-Verlängerung**: Tabs prüfen und beanspruchen das Abruf-Zeitfenster nun optimistisch mit einer kurzen, zufälligen Wartezeit und einem Double-Check (Check-after-Write), was zeitgleiche Konflikte verhindert. Zudem wird die Sperre während langer Abruf-Zyklen (z. B. Paginierung und Spiegelungs-Stagger) fortlaufend verlängert, so dass nachfolgende Abruf-Intervalle sich nicht überschneiden.
- **Einstellungs-Identitäts-Fallback**: Die eigene Identität (Allianz- und Länderzugehörigkeit) wird nach erfolgreicher Erkennung lokal gecached. Bei temporären API-Störungen (wie z. B. einem 429-Fehler) fällt die Einstellungs-Ansicht nicht mehr auf das globale Standard-Topic (`wia-bounty-all`) zurück, sondern behält die korrekte Konfiguration bei.

**Changes (English):**
- **Intra-Client Bounty Duplication Protection**: Fixes an issue where multiple open tabs of the same browser/profile fired identical bounty notifications up to 5 times simultaneously. A new per-tab unique jitter staggers concurrent tabs so the first tab's publish successfully suppresses duplicates in other tabs.
- **Optimistic Locking & Lock Renewal**: Implemented a check-after-write strategy with a randomized backoff to prevent race conditions during slot acquisition. Additionally, the poll lock is now renewed periodically during long polling cycles (e.g. pagination and feed staggers), ensuring subsequent intervals do not overlap.
- **Settings Identity Cache Fallback**: Successfully resolved player identities are now cached locally. During transient API failures (such as 429 rate-limiting), the settings UI and auto-generated topic will fall back to the cached identity instead of reverting to the global `wia-bounty-all` default.

## 2026-07-05 | Kopfgeld-Kaskaden-Bereinigung & Gegner-Ausschluss (v0.8.12)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`

**Änderungen (Deutsch):**
- **Veraltete Allianz-Verbindungen entfernt**: Die veraltete `allies`-Länderliste aus der API wird nicht mehr für die Kaskadierung verwendet. Dies verhindert, dass fälschlicherweise gegnerische Länder (wie Marokko oder Frankreich) über veraltete Beziehungen in deiner Kopfgeld-Kaskade landen. Es werden nur noch aktive Verteidigungspakte und die echte Allianz (Coalition) herangezogen.
- **Ausschluss von Gegner-Kopfgeldern**: Wenn das eigene Land direkt an einer Schlacht beteiligt ist (als Angreifer oder Verteidiger), werden Kopfgeld-Benachrichtigungen für die gegnerische Seite automatisch gefiltert. Dies verhindert unerwünschte Meldungen für Schlachten, in denen du systembedingt nicht auf der Gegnerseite kämpfen kannst.

**Changes (English):**
- **Removed Stale Allies Cascade**: Stale `allies` list from the country API is no longer used for cascade feeds. This prevents enemy countries (like Morocco or France) from ending up in your bounty feed due to outdated database relations. Only active defensive pacts and the real coalition alliance are used now.
- **Excluded Enemy Side Bounties**: When your own country is actively participating in a battle (as attacker or defender), bounties placed on the enemy side of the battle are automatically filtered out. This prevents spam notifications for battles where you cannot claim the enemy bounty due to side locking.

## 2026-07-05 | Gleicher Tab Navigations- und Skin-Erkennungs-Fixes (v0.8.11)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Navigation im selben Tab**: Klicks auf in-game Bounty-Popups navigieren nun direkt im selben Tab zur Schlacht (via location.href), statt einen neuen Tab zu öffnen. Ein Klick mit gedrückter Strg-/Cmd-Taste oder mittlerer Maustaste öffnet die Schlacht weiterhin in einem neuen Tab.
- **Sammelkarten-Skins ignorieren**: Im Inventar befindliche Skin-Sammelkarten (wie die Ammo-Skin-Karte für den brennenden Fußball `wc2026` oder andere Munitions-Skins) werden nun korrekt von echten ausgerüsteten/stapelbaren Munitions- und Ausrüstungsgegenständen unterschieden. Dies geschieht anhand des Vorhandenseins von Stats bei gleichzeitigem Fehlen eines Haltbarkeitsbalkens. Sie erhalten kein störendes Advisor-Badge mehr und verfälschen nicht mehr die Tagesgewinn-Kalkulationen (P&L).

**Changes (English):**
- **Same-Tab Notification Navigation**: Clicking on local in-game notifications now redirects to the battle in the same tab instead of opening a new tab. Ctrl/Cmd+click or middle-click still opens the battle in a new tab.
- **Ignore Skin Collectible Cards**: Skin collectible cards in the inventory (such as the burning football `wc2026` skin or other ammo skins) are now correctly distinguished from actual equipment or ammunition stacks. They are identified by having stat icons but lacking a durability bar. This prevents incorrect advisor badges and stops false consumable bookings in the Daily P&L Tracker.

## 2026-07-05 | Kopfgeld-Multi-Feed Zuverlässigkeit & Telemetrie (v0.8.10)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`

**Änderungen (Deutsch):**
- **Footer-Link entfernt**: Der Link zum public Feed und das Actions-Menü wurden aus der Push-Nachricht entfernt, um Veröffentlichungs-Leaks zu unterbinden.
- **Deterministischer Client-Stagger (Jitter)**: Anstelle von zufälligem Jitter wird nun ein stabiler Client-Jitter anhand einer eindeutigen Client-ID (`bountyClientId`) verwendet, wodurch Race Conditions bei zeitgleichen API-Abfragen konkurrierender Geräte minimiert werden.
- **Versionen- & Client-Tags**: Push-Nachrichten enthalten nun Versions- (`v*`) und Client-ID-Tags (`cid_*`) in der Tag-Liste zur besseren Nachvollziehbarkeit und Diagnose von Mehrfach-Meldungen.
- **Verbesserte HUD-Diagnose**: Die in-game Status-Anzeige (Health-Probe) zeigt nun detaillierte Infos (Topic, Anzahl aufgelöster Allies/Cascade, Alter des letzten Polls und Client-ID) an. Zudem wird die Anzahl der Legacy-Nachrichten (von Geräten ohne Update) im Konsole-Log erfasst.

**Changes (English):**
- **Removed Footer Mirror Leak**: The public mirror links and actions are removed from the push message body to prevent accidental privacy leaks.
- **Deterministic Client Jitter**: Replaced random delay loops with a stable client-specific jitter based on a persistent `bountyClientId` to safely stagger concurrent active devices and eliminate duplicate spams.
- **Version & Client Telemetry**: Notifications now append version (`v*`) and client ID (`cid_*`) tags to headers, allowing detailed diagnostic checks in topic histories.
- **Enriched Health Diagnostics**: The in-game Health Probe reports the active topic, resolved cache counts, last poll age, and unique client ID. Legacy publishers (older active versions) are counted and reported in console debug logs.

## 2026-07-05 | Kopfgeld-Multi-Feed Fehlerbehebungen (v0.8.9)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`

**Änderungen (Deutsch):**
- **Reihenfolge-Fix im Feed-Loop**: Der Jitter-Stagger zur Staffelung konkurrierender Clients läuft nun vor dem Abruf des History-Snapshots (`topicPresentKeys`). Dies stellt sicher, dass spätere Clients die Pushes früherer Clients sehen und überspringen, wodurch Duplikate auf `wia-bounty-all` verhindert werden.
- **Cache-Key-Aufteilung (Cascade/Allies)**: Die Caching-Funktion `resolveAllyCountryIds` nutzt jetzt getrennte Keys für Allies (`_allies`) und Cascade (`_casc`). Dies behebt das Problem, dass sich beide Listen gegenseitig überschrieben und verfälschten. Die Fehlerbehebung heilt sich nach dem Upgrade von selbst.
- **Fehler-Diagnose**: Die in-game Status-Anzeige (Health) meldet nun eine Warnung (`mirror readback failed`), falls der Verlauf eines ntfy-Feeds nicht ausgelesen werden kann, statt stumm abzubrechen. Es wurde zudem ein Log-Eintrag für erfolgreich gespiegelte Feeds hinzugefügt.

**Changes (English):**
- **Feed Loop Order Fix**: The jitter stagger is now executed before retrieving the history snapshot (`topicPresentKeys`). This ensures later clients detect pushes from earlier clients and skip them, eliminating duplicate spams on `wia-bounty-all`.
- **Cache Key Split (Cascade/Allies)**: `resolveAllyCountryIds` now uses separate cache keys (`_allies` and `_casc`) to prevent them from overwriting and corrupting each other. The fix self-heals immediately upon script load.
- **Error Diagnostics**: The status HUD now displays a warning (`mirror readback failed`) if the history of an ntfy feed cannot be fetched. A debug log entry has been added for successful feed mirrors.

## 2026-07-05 | Kopfgeld-Multi-Feed (entkoppelte Tier-Spiegelung) (v0.8.8)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`

**Änderungen (Deutsch):**
- **Multi-Feed-Spiegelung**: Bountys werden jetzt unabhängig vom eigenen `bountyScope`-Filter des Users direkt in drei genestete ntfy-Topics gespiegelt: globales Topic `wia-bounty-all`, sowie das Allies-Topic (`wia-bounty-<base>`) und Cascade-Topic (`wia-bounty-<base>-casc`) der eigenen Allianz (bzw. Land-Fallback).
- **Vollständige Entkopplung**: Der Mirror-Prozess besitzt nun einen eigenen tab- und geräteübergreifenden Dedup-Store (`mirrorSeen` mit Composite-Keys) und läuft vollkommen eigenständig. Er ist unabhängig vom lokalen Popup-Verlauf und dem Erfolg des primären Pushs.
- **Performance & Stabilität**: Zur Schonung von Rate-Limits wird die Topic-History pro Poll-Zyklus nur noch einmal abgerufen (1 GET statt N GETs) und in-memory abgeglichen. Ein einzelner Jitter pro Feed entlastet den Server und verhindert Timing-Probleme.
- **Label-Muss-Fix**: Mirrored-Pushes erhalten das jeweils korrekte Label (`all`, `allies` oder `cascade`) passend zum Topic, statt wie bisher erzwungen das Label "Alle".

**Changes (English):**
- **Multi-Feed Mirroring**: Bounties are now mirrored directly into three nested ntfy feeds, regardless of the user's local `bountyScope` setting: global feed `wia-bounty-all`, user's Alliance allies feed (`wia-bounty-<base>`), and cascade allies feed (`wia-bounty-<base>-casc`).
- **Complete Decoupling**: The mirroring logic has its own cross-tab/cross-device storage (`mirrorSeen` using composite keys) and runs fully independently of user popup history and primary push success.
- **Performance & Stability**: To prevent 429 rate limits, feed history is fetched exactly once per poll cycle (1 GET instead of N GETs) and evaluated in-memory. A single jitter stagger is applied per feed to optimize poll durations.
- **Label Fix**: Mirrored pushes use their respective correct label (`all`, `allies`, or `cascade`) matching the destination feed, rather than forcing the label "all".

## 2026-07-05 | Kopfgeld-Benachrichtigungen ASCII-Header Fix (v0.8.7)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`

**Änderungen (Deutsch):**
- **Sichere HTTP-Header**: Alle ntfy-Header (`Title` und `Actions`) werden nun vor dem Senden über eine Bereinigungsfunktion bereinigt. Deutsche Umlaute werden in ASCII-Entsprechungen umschrieben (z.B. `ä -> ae`, `ö -> oe`) und verbleibende Emojis/Sonderzeichen entfernt. Dies verhindert Übertragungsfehler und Netzwerk-Abbrüche auf HTTP/2 / HTTP/3-Verbindungen, wodurch die globale Spiegelung nach `wia-bounty-all` nun stabil funktioniert.

**Changes (English):**
- **ASCII Header Sanitisation**: All custom ntfy HTTP headers (`Title` and `Actions`) are now sanitised before transmission. German umlauts are replaced with ASCII equivalents (e.g. `ä -> ae`, `ö -> oe`) and any remaining emojis/special characters are stripped. This prevents protocol and network errors on HTTP/2 / HTTP/3 streams, fixing the `wia-bounty-all` mirroring issue.

## 2026-07-04 | Kopfgeld-Popup Sichtbarkeits-Synchronisierung & globaler Spiegel-Fix (v0.8.6)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`

**Änderungen (Deutsch):**
- **Sichtbarkeits-Synchronisierung**: In-Game-Popup-Benachrichtigungen werden nun über den `localStorage` tabübergreifend koordiniert. Sie erscheinen nur auf dem gerade aktiven (sichtbaren) Tab. Wenn kein Tab aktiv war, werden verpasste Popups beim nächsten Aktivieren des Tabs nachgeholt (bis zu 10 Minuten rückwirkend).
- **Robuste wia-bounty-all Spiegelung**: Auch wenn ein anderer (z.B. veralteter) Client ein Kopfgeld vor uns an das Primär-Topic gesendet hat (Deduplizierung greift), prüft der aktuelle Client nun `wia-bounty-all` und spiegelt das Kopfgeld dort hin, falls es im globalen Verlauf noch fehlt.

**Changes (English):**
- **Popup Tab Visibility Sync**: In-game popup alerts are now synchronized across tabs via `localStorage`. The toast only displays on the currently focused/visible tab. Inactive tabs store pending popups and display them upon focus (with a 10-minute maximum age limit).
- **Robust Mirroring Fallback**: Even if another client (running an older version) pushed the bounty to the primary topic first (triggering cross-client deduplication), the current client now checks `wia-bounty-all` and mirrors the event if it is missing from the global feed history.

## 2026-07-04 | Lokaler Kopfgeld-Popup Position-Fix (v0.8.5)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`

**Änderungen (Deutsch):**
- **Kopfgeld-Popup-Position**: Die zentrierte Position der In-Game-Popup-Benachrichtigung wurde von der Bildschirmmitte ganz nach oben in die Mitte verschoben (16px Abstand vom oberen Rand), damit sie den Spielverlauf weniger überdeckt.

**Changes (English):**
- **Bounty Popup Repositioning**: Moved the centered in-game popup alert from the center of the screen to the top-center (16px spacing from the top margin) to prevent blocking game content.

## 2026-07-04 | Lokale Kopfgeld-Anzeige & wia-bounty-all Topic-Verlinkung (v0.8.4)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`, `docs/wiki/Bounty-Notify.md`, `docs/wiki/Bounty-Notify.de.md`

**Änderungen (Deutsch):**
- **Lokale Kopfgeld-Anzeige (Browser & In-Game-Popup)**: Bei erkannten Kopfgeldern wird zusätzlich zum Push-Versand eine lokale Browser-Benachrichtigung und ein zentriertes, 8 Sekunden sichtbares In-Game-Popup auf dem abfragenden Tab eingeblendet.
- **Entkoppeltes Deduplizieren**: Die lokale Benachrichtigung läuft unabhängig von ntfy-Sendefehlern oder der Staggering-Verzögerung über einen eigenen Deduplizierungs-Speicher.
- **Automatische Verlinkung im wia-bounty-all Mirror**: Die gespiegelten Benachrichtigungen auf `wia-bounty-all` erhalten nun ein "Topic öffnen"-Aktions-Button sowie einen Link-Hinweis, der direkt zum Quell-Feed führt. Wenn ein Topic-Secret gesetzt ist, entfällt dieser Link (Datenschutz).
- **Text-Verbesserung**: Alle Benachrichtigungs-Texte verwenden nun eine klarere Formulierung ("Kämpfe für [Land]" statt "Bounty auf [Land]"), um Missverständnisse über das Ziel des Kopfgeldes zu vermeiden.

**Changes (English):**
- **Local Bounty Alerts (Browser & In-Game Popup)**: Detected bounties now trigger a native browser notification and a centered in-game popup toast (8-second duration) on the active polling tab.
- **Decoupled Local Deduplication**: Local alerts run on their own seen store, completely independent of ntfy stagger delays or transmission failures.
- **Origin Topic Links in wia-bounty-all Mirror**: Mirrored alerts on `wia-bounty-all` now carry an "Open topic" action and a link pointing back to the source feed. If a Topic Secret is configured, no link is sent to protect the feed's privacy.
- **Clarified Alert Wording**: Updated all alert texts to read "Fight for [Country]" instead of "Bounty on [Country]" to clearly convey which side has the bounty pool.

## 2026-07-04 | Automatische Spiegelung auf wia-bounty-all (v0.8.3)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`

**Änderungen (Deutsch):**
- **Automatische Spiegelung auf wia-bounty-all**: Jede gesendete Kopfgeld-Benachrichtigung wird nun zusätzlich im globalen, öffentlichen Topic `wia-bounty-all` veröffentlicht.
- **Deduplizierung**: Um doppelten Spam zu vermeiden, prüft der Client vor dem Spiegeln den 12-Stunden-Verlauf von `wia-bounty-all`. Das Feature greift nur, wenn das eigene aktive Topic nicht bereits auf `wia-bounty-all` steht.

**Changes (English):**
- **Automatic Mirroring to wia-bounty-all**: Every sent bounty notification is now additionally published to the global public topic `wia-bounty-all`.
- **Deduplication Safeguard**: To prevent duplicate spam, the client checks the 12-hour history of `wia-bounty-all` before mirroring. This mirroring step is bypassed if the user's active topic is already configured to be `wia-bounty-all`.

## 2026-07-04 | ntfy-Topic Platzhalter-Standardwert (v0.8.2)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`

**Änderungen (Deutsch):**
- **Platzhalter für ntfy-Topic**: Das Eingabefeld für das ntfy-Topic ist standardmäßig leer und zeigt das dynamisch generierte Topic (z.B. `wia-bounty-beer-casc`) als grauen Platzhalter (Placeholder) im Hintergrund an.
- **Fehlerfreie Abo-Hinweise**: Der Abo-Hinweis und das effektive Topic fallen bei leerem Eingabefeld nun korrekt auf das automatisch generierte Topic zurück.

**Changes (English):**
- **Placeholder Default for ntfyTopic Input**: The ntfy topic text field is now empty by default, displaying the dynamically resolved topic name (e.g. `wia-bounty-beer-casc`) as a placeholder in the background.
- **Fixed Subscription Guidance Fallback**: The dynamic subscription hint now properly falls back to the placeholder topic when the text input is left empty.

## 2026-07-04 | Bounty-Benachrichtigungen UI-Fixes & Topic-Registrierung (v0.8.1)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`

**Änderungen (Deutsch):**
- **Reihenfolge Verteiler vs. Angreifer korrigiert**: In den Push-Benachrichtigungen wird nun die gewohnte Anordnung aus dem Spiel (Verteidiger links, Angreifer rechts) angezeigt.
- **Dynamischer Titel-Präfix**: Der Titel-Präfix der Push-Benachrichtigungen passt sich nun automatisch an den gewählten Scope an (`Kopfgeld` bei *Alle*, `Ally-Bounty` bei *Verbündete* und `Ally-Casc-Bounty` bei *Kaskade*).
- **Automatisierte ntfy-Topic-Abonnement-Hinweise**: Im Einstellungsfenster wird nun live das automatisch generierte Standard-Topic angezeigt. Ein dynamischer Abo-Hinweis zeigt direkt die passende Adresse (inkl. Topic-Secret) an.
- **Zentrales Verzeichnis-Topic `wia-bounty-topics`**: Um genutzte Topics zu koordinieren, kündigt der Client sein genutztes Topic (anonymisiert ohne Secret), seine Allianz/Heimatland und den Aktivierungs-Zeitstempel einmalig im Verzeichnis-Topic `wia-bounty-topics` an. Doppelte Registrierungen werden durch Abgleich des 12h-Verlaufs verhindert.

**Changes (English):**
- **Corrected Attacker/Defender Display Order**: Swapped the positions in notifications to match the in-game UI layout (Defender on the left, Attacker on the right).
- **Scope-Dependent Title Prefixes**: The notification title prefix now changes dynamically according to the active scope (`Bounty` for *All*, `Ally-Bounty` for *Allies*, and `Ally-Casc-Bounty` for *Cascade*).
- **Dynamic Settings Subscription Guidance**: The settings dialog now renders the auto-generated topic name. A dynamic helper message displays the exact subscription address (including topic secrets) in real-time.
- **Central Topic Registry `wia-bounty-topics`**: When initialized, the client registers the base topic name (without the secret to preserve privacy), resolved country/alliance, and timestamp to a public directory topic `wia-bounty-topics`. Duplicate registrations are prevented by reading the 12-hour history first.

## 2026-07-04 | Ally-Bounty ntfy-Push-Benachrichtigungen (v0.8.0)

**Geänderte Dateien:** `warera-prost.user.js`, `CHANGELOG.md`, `tests/bounty-notify.test.js`, `tests/test-advisor-load.js`

**Änderungen (Deutsch):**
- **Ally-Bounty Push-Benachrichtigungen (ntfy.sh)**: Neues Hintergrund-Feature sendet Benachrichtigungen aufs Handy, sobald ein verbündetes Kopfgeld aktiv wird. Konfigurierbar über das Einstellungsmenü (Checkbox, ntfy-Topic und optionaler Secret-Zusatz).
- **Konfigurierbarer Benachrichtigungs-Umfang**: Drei Stufen einstellbar: `all` (alle Schlachten ohne Filter), `allies` (nur eigenes Land, Allianz-Mitglieder und eigene Verbündete/Pakte) und `cascade` (Allianzen plus Allies/Pakte aller Mitgliedsländer).
- **Automatische Identitätserkennung**: Ermittelt Heimatland und Allianzname des Spielers im Hintergrund und zeigt diese im Einstellungsmenü als Placeholder für Overrides an.
- **Automatische Allianz-Ländercodes im Battle-Advisor**: Das manuelle Textfeld zur Eingabe verbündeter Ländercodes im Einstellungsmenü wurde entfernt. Der Battle-Advisor bezieht die Ländercodes nun vollautomatisch und tagesaktuell aus dem Ländersuchdienst des Pollers.
- **Robustes Staggering gegen Mehrfach-Pushes**: Ein breiterer Jitter (10s) und ein zweifacher Read-back-Check auf ntfy.sh vor jedem POST verhindern doppelte Benachrichtigungen über mehrere offene Browserfenster hinweg.
- **Gateway-Priorisierung**: Der API-Layer nutzt standardmäßig das Gateway `gateway.warerastats.io` als primären Endpunkt und schaltet bei Verbindungsproblemen automatisch auf `api2.warera.io` um.

**Changes (English):**
- **Ally-Bounty Push Notifications (ntfy.sh)**: New background poller triggers mobile pushes via ntfy.sh when a new allied bounty is active. Configure via the settings menu (toggle, ntfy topic, and optional topic secret suffix).
- **Configurable Notification Scope**: Three selectable scopes: `all` (all battles, no filter), `allies` (own country, alliance members, and own allies/pacts), and `cascade` (all allies plus the allies/pacts of all alliance member countries).
- **Automatic Identity Detection**: Asynchronously resolves own country and alliance name, displaying them as placeholders and status labels in settings.
- **Automatic Allied Codes in Battle Advisor**: Removed the manual allied country codes text field from settings. The Battle Advisor now resolves and updates allied country codes dynamically using the poller's country database.
- **Timing-Race Deduplication**: A 10-second jitter stagger and double read-back check on ntfy.sh history prevent duplicate pushes across multiple open browser profiles.
- **Gateway Prioritization**: Prioritizes `gateway.warerastats.io` as the primary API endpoint with automatic fallback to `api2.warera.io`.

## 2026-07-02 | Topbar Layout & Bar Label Optimizations (v0.7.20)

**Geänderte Dateien:** `warera-prost.user.js`

**Änderungen (Deutsch):**
- **Behebung von Layout-Verzerrungen in der Topbar**: Wenn die in-game Statusleiste (Nutzer-Menü) schmaler als 570px gezogen wird, löst sich das Pillen-Erinnerungs-Badge aus dem normalen Textfluss und verhält sich als schwebende Blase. Das verhindert ein Überlappen der nativen Spielanzeigen.
- **Kompakte Statusanzeigen bei schmalem Fenster**: Unterschreitet die Breite der Menüleiste 400px, wird der Text "... frei" ausgeblendet und es wird nur noch die Prozentzahl (z.B. `62%`) angezeigt. Die Farbhervorhebung (grün für ausreichend Puffer, rot für leer/Grenzbereich) bleibt erhalten. Dies verhindert das Überlappen mit der nativen Regenerationsanzeige.

**Changes (English):**
- **Fixed Top-bar Layout Distortions**: When the in-game user-menu panel is resized narrower than 570px, the pill reminder badge detaches from the normal inline layout flow and behaves as a floating bubble. This prevents native game stats from overlapping.
- **Compact Stat Labels on Narrow Screens**: When the panel width falls below 400px, the "... free" text suffix is hidden, rendering only the percentage (e.g. `62%`). The status colors (green for free budget, red for empty/exhausted) are preserved. This prevents overlap with the native regeneration counter.

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
