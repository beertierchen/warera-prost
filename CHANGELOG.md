# CHANGELOG

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
