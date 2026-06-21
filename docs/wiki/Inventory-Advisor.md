# Inventory Advisor

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Inventory-Advisor.de)

The core feature. On your **inventory** page, every item card gets a colored
recommendation badge plus overlays that rank the item and compare its scrap
value against the market.

![Inventory Advisor overlays on weapon, armor, glove, pants and boot cards](images/inventory-advisor.png)

## Recommendations (color + symbol)

| Badge | Meaning | When |
| --- | --- | --- |
| 💎 **KEEP** (blue) | Keep the item. | One of your top 3 in stock (by type/tier), **or** in the top 33% ("Top Roll") of live offers / your inventory. |
| ✋ **HOLD** (orange) | Reserve it. | In the best 10% of the theoretically possible stat range ("Top Itemscore"). Only assigned when it is *not* 💎 KEEP. |
| 💰 **SELL** (green) | Sell on the market. | Net market price (minus 1% tax) **exceeds** salvage value. |
| 🔨 **SCRAP** (red) | Salvage it. | Salvage value **exceeds** net market price. |

## Card overlays

- **Top-left — stat value:** the armor stat or weapon score.
  - *Blue background* = top 3 in stock (Stock Keep).
  - *Gray* = normal.
- **Bottom — prices** (format `🔨 [scrap value] / 💰 [market price]`):
  - *Green background* = scrapping is the better deal.
  - *Orange background* = selling is the better deal.

## What it skips

- **Equipped items** (`Equip.` label) and items below 100% durability are not
  given sell/scrap advice — their value isn't comparable to a fresh listing.
- Items shown on **character profile** equipment slots are excluded so the
  advisor doesn't annotate other players' gear.

## Price freshness

Prices come from cached market data and (optionally) the live API. The dot on
the ⚙ gear shows freshness; open [Settings](Settings) to refresh or to add an
[API token](Settings#api-token) for live values.

> All scores are computed locally from item stats and market floors. PROST never
> sells, scraps, or moves anything — it only advises.
