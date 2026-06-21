# 🍻 PROST Wiki

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Home.de)

**P**ersonal **R**ecommendation **O**verlay & **S**upport **T**ool — a suite of
client-side [userscripts](https://en.wikipedia.org/wiki/Userscript) for the
browser game [**WareEra**](https://app.warera.io).

> **Prost! 🍺 It just helps you play, it doesn't play for you.** No automation —
> every overlay is read-only decision support.

## Features

| Feature | What it does |
| --- | --- |
| [Inventory Advisor](Inventory-Advisor) | KEEP / HOLD / SELL / SCRAP advice on every inventory card, with stat ranking and scrap-vs-market price bars. |
| [Scrap-Flip Indicator](Scrap-Flip-Indicator) | Flags equipment-market listings that are profitable to buy and dismantle for scrap. |
| [Battle Advisor](Battle-Advisor) | Highlights your side's button on battle pages and previews active orders inline. |
| [Player Notes](Player-Notes) | A private note icon next to player links, stored locally. |
| [Settings & Cheat Sheet](Settings) | Gear menu: feature toggles, optional API token, locale (DE/EN), and an in-app cheat sheet. |

## Quick start

1. Install a userscript manager (Tampermonkey / Violentmonkey).
2. Install PROST — see **[Installation](Installation)**.
3. Open [WareEra](https://app.warera.io), visit your inventory or the equipment
   market, and click the ⚙ gear (bottom-right) to configure.

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
