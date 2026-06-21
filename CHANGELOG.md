# CHANGELOG

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
