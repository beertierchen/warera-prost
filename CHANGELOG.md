# CHANGELOG

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
