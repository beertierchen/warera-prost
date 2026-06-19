# CHANGELOG

## 2026-06-20 00:20 | WareEra Inventory Advisor v0.6.4

**Changed files:**
- `warera-inventory-advisor.user.js`

**Change:**
- Added a clean top header strip above the item image, so score and recommendation badges no longer cover the item.
- Redesigned price overlays into a stacked two-row layout with clear icons (🔨 for scrap value and coins for market floor).
- Positioned the price overlay directly over the durability bar at the bottom, expanding the bar downward slightly to fit the values cleanly.
- Hidden prices on equipped items and damaged gear to reduce visual clutter.
- Enabled score badges on helmets and armor.
- Fixed a bug causing double/triple badges to display on nested elements.

**Reason:**
- Improves readability, cleans up visual overlap on damaged/equipped gear, and ensures all item types display relevant stats clearly.

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
