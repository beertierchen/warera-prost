# 🍻 PROST Wiki

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Home.de)

**P**ersonal **R**ecommendation **O**verlay & **S**upport **T**ool — a suite of
client-side [userscripts](https://en.wikipedia.org/wiki/Userscript) for the
browser game [**WareEra**](https://app.warera.io).

> **Prost! 🍺 It just helps you play, it doesn't play for you.** No automation —
> every overlay is read-only decision support.

> ⚠️ **Open beta.** PROST is in active development — it can be slow, imprecise, or
> occasionally buggy, and its advice is decision support, **not a guarantee**.
> Because it attaches entirely to **WareEra's interface**, a game update can break
> detection until PROST is updated to match. Hit a problem?
> [Open an issue](https://github.com/beertierchen/warera-prost/issues).

## Features

| Feature | What it does |
| --- | --- |
| [Inventory Advisor](Inventory-Advisor) | KEEP / HOLD / SELL / SCRAP advice on every inventory card, with stat ranking, scrap-vs-market price bars, skin/equipment recognition and durability. |
| [Scrap-Flip Indicator](Scrap-Flip-Indicator) | *Experimental.* Flags equipment-market listings that are profitable to buy and dismantle for scrap. |
| [Daily P&L Tracker](Daily-PnL-Tracker) | Daily profit/loss in the topbar next to your gold, including auto-booked gear-wear (repair) costs. On by default. |
| [Resource Market Graph](Market-Graph) | *Experimental.* Intraday (24h/3d) price graph on resource-market buy/sell modals. |
| [Crafting Calculator](Crafting-Calculator) | *Experimental.* Profit estimate for crafting — resource cost vs. market value. |
| [Battle Advisor](Battle-Advisor) | *Experimental.* Highlights your side's button on battle pages and previews active orders inline. |
| [Pill Reminder](Pill-Reminder) | *Experimental.* Topbar status + countdown for the pill cycle, with health/hunger checks. |
| [Bounty Notifications](Bounty-Notify) | *Experimental.* Background poller sending allied bounty alerts to your phone or desktop via ntfy.sh. |
| [Player Notes](Player-Notes) | *Experimental.* A private note icon next to player links, stored locally. |
| [Diagnostics](Diagnostics) | Feature-health panel, scan-performance traffic-light, and a debug dump. |
| [Settings & Cheat Sheet](Settings) | Gear menu: feature toggles, optional API token, locale (DE/EN), and an in-app cheat sheet. |

## Quick start

1. Install a userscript manager (Tampermonkey / Violentmonkey).
2. Install PROST — see **[Installation](Installation)**.
3. Open [WareEra](https://app.warera.io), visit your inventory or the equipment
   market, and click the ⚙ gear (bottom-right) to configure.

Trouble installing or seeing nothing? See **[Installation → Troubleshooting](Installation#troubleshooting)**.

## Privacy & safety

- **No automation.** Overlays only read and annotate the page.
- The optional API token is **your** credential, stored locally via `GM_setValue`
  (lightly obfuscated — not encryption). See [Settings](Settings#api-token).
- No data leaves your browser except calls **you** trigger to the official game
  API and the public stats gateway.

---

📖 This wiki is generated from [`docs/wiki/`](https://github.com/beertierchen/warera-prost/tree/main/docs/wiki)
in the main repo and auto-published on every change to `main`. Edit the source
there, not the wiki directly.
