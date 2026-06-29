# Inventory Advisor

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Inventory-Advisor.de)

The core feature. On your **inventory** page, every item card gets a colored
recommendation badge plus overlays that rank the item and compare its scrap
value against the market. Read-only — it never sells, scraps, or moves anything.

![Inventory Advisor overlays on weapon and armor cards](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/itemadvisor.gif)

## Recommendations (color + symbol)

| Badge | Meaning | When |
| --- | --- | --- |
| 💎 **KEEP** (blue) | Keep the item. | One of your top 3 in stock (by type/tier), **or** in the top 33% ("Top Roll") of live offers / your inventory. |
| ✋ **HOLD** (orange) | Reserve it. | In the best 10% of the theoretically possible stat range ("Top Itemscore"). Only assigned when it is *not* 💎 KEEP. |
| 💰 **SELL** (green) | Sell on the market. | Net market price (minus 1% tax) **exceeds** salvage value. |
| 🔨 **SCRAP** (red) | Salvage it. | Salvage value **exceeds** net market price. |

A **dashed white border** around the badge means the recommendation is
**provisional** — prices/market data are still loading and may change.

## Card overlays

PROST reserves a small strip **above and below** each card, so its overlays sit
in their own band and no longer cover the game's native stats.

- **Top-left — score pill:** the armor stat or weapon score.
  - *Blue background* = top 3 in stock (Stock Keep).
  - *Gray* = normal.
- **Top-right — recommendation badge:** the 💎 / ✋ / 💰 / 🔨 symbol from above.
- **Bottom — price strip** (`🔨 [scrap value] / 💰 [market price]`):
  - *Green background* = scrapping is the better deal.
  - *Orange background* = selling is the better deal.

## Skins & durability

- **Skinned gear is recognized** and evaluated like its base item — a custom
  weapon/armor skin no longer hides the advice.
- **Durability** is read straight from the item's progress bar.

## What it skips

- **Equipped items** (`Equip.` label) and items below 100% durability get no
  sell/scrap advice — their value isn't comparable to a fresh listing.
- Items on **character profile** equipment slots are excluded, and the whole
  **shop** (`/shop/…`) is skipped, so the advisor only annotates your tradable
  inventory.

## Price freshness

Prices come from cached market data and (optionally) the live API. The dot on
the ⚙ gear shows freshness; open [Settings](Settings) to refresh or to add an
[API token](Settings#api-token) for live values.

> All scores are computed locally from item stats and market floors. PROST only
> advises — you stay in control.
