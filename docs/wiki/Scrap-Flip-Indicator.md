# Scrap-Flip Indicator

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Scrap-Flip-Indicator.de)

*Experimental.* On the **equipment market**, this flags listings that are
profitable to **buy and immediately dismantle** for scrap — a quick arbitrage
signal.

## How it works

For each listing PROST estimates:

```
buy price  →  scrap yield (quantity × scrap unit price)  →  net after 1% tax
profit = net scrap value − buy price
```

Listings with a positive result get a green flip badge pinned inside the tile,
and the tile is outlined. The badge tooltip spells out the math:

> `Buy 3.98 → scrap 5×1.33 net 6.59 = +2.61 profit`

A negative/break-even result is shown muted (gray) so you can still see the
comparison without it standing out.

## Why a margin is applied

Grid prices on the market are rounded/imprecise. To avoid **false-positive**
flips from tiny rounding gaps, PROST inflates the assumed buy price by a small
margin (`scrapFlipGridMargin`) before comparing. A flip only shows when it
survives that margin — fewer signals, but the ones you see are real.

## Enabling

Off by default (experimental). Turn it on in [Settings](Settings) →
*Scrap-Flip indicator*. Fresh scrap prices need an [API token](Settings#api-token).

> This is a market-reading aid only. PROST never buys or scraps for you.
