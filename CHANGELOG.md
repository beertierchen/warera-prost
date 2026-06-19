# CHANGELOG

## 2026-06-19 19:05 | WareEra Inventory Advisor Fixes v0.6.2

**Changed files:**
- `warera-inventory-advisor.user.js`

**Change:**
- Updated script metadata author to `beertierchen`, namespace to `TBD`, stripped the version number from `@name` to allow version-agnostic URLs on Greasy Fork, and refined `@description` to clearly state functionality and use of the optional API.
- Reintroduced the live data toggle (`useLiveOffersApi`) in the settings UI.
- Integrated fallback scraps price scraping directly from the market page selector (`item-code-selector-scraps`) to allow accurate scrap value calculations even without an API key.
- Added robust tRPC error detection and missing data handling.
- Introduced a 6-hour TTL (`scrapedPriceTtlMs`) for scraped market prices and ensured `clearCache` resets them.
- Implemented `Number.isFinite` date checks for transactions to prevent NaN dates.
- Protected normalizePrices from prototype pollution during array operations.
- Corrected the top fraction cutoff calculation in `isTopRoll`.
- Consolidated ranking logic in `calculateInventoryRankings` to prevent rank collisions by using sorted indices.
- Implemented dynamic weapon tier detection using `weaponRanges` on parsed stats, equipping weapons with automatic scrap yields and HOLD evaluations.
- Added MutationObserver pause (`suspendObserver` / `resumeObserver`) during renders and asynchronous background batches to resolve re-entrancy issues.
- Optimized performance by cloning and cleaning the DOM card exactly once per card parsing.
- Limited DOM search scope in `findMarketSellContainer` to the `main` layout element.
- Replaced invasive card inline style overrides with a clean `.wia-card-override` CSS class, and increased fallback route polling from 800ms to 2000ms.
- Bumped version to `0.6.0`.

**Reason:**
- Addresses critical inventory advisor findings, improving data integrity, decision accuracy, concurrency behavior, layout impact, and performance.
