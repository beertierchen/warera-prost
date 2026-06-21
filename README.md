<div align="center">

# 🍻 PROST

**P**ersonal **R**ecommendation **O**verlay & **S**upport **T**ool

A suite of client-side [userscripts](https://en.wikipedia.org/wiki/Userscript) for the browser game [**WareEra**](https://app.warera.io). Visual overlays and decision helpers, item advice, market scrap-flip indicators, notes, and more.

**Prost! 🍺 It just helps you play, it doesn't play for you.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![No automation](https://img.shields.io/badge/automation-none-green.svg)

</div>

---

## ⚠️ No automation

PROST is a **client-side visual assistant only**. It reads the page (and, optionally, the official game API with *your* key) and shows advice. It never clicks, trades, or plays for you. Use at your own risk and within WareEra's terms.

## Scripts

| Script | What it does |
|--------|--------------|
| **PROST** (`warera-prost.user.js`) | KEEP / SELL / SCRAP advice from local stats + market floors. Scrap-flip profitability badges on the market. Optional WareEra API integration via your own key. i18n (DE/EN). |
| **User Notes** (`warera-notes.user.js`) | Local, persistent notes attached to Warera user links. |

## Install

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) (recommended) or [Violentmonkey](https://violentmonkey.github.io/).
2. Click a script to install it directly from GitHub:
   - **PROST** (main) → [`warera-prost.user.js`](https://raw.githubusercontent.com/beertierchen/warera-prost/main/warera-prost.user.js)
   - **User Notes** → [`warera-notes.user.js`](https://raw.githubusercontent.com/beertierchen/warera-prost/main/warera-notes.user.js)
3. Open [app.warera.io](https://app.warera.io), the overlay loads automatically. Configure via the Tampermonkey menu (⚙️ *Register Menu Command*).

Updates are delivered automatically through your userscript manager (`@updateURL`).

## Privacy & API key

The optional WareEra API token is **your personal credential**, stored locally via `GM_setValue`. A userscript sandbox has no real keystore. The light XOR obfuscation only deters casual shoulder-surfing, it is **not encryption**. Treat your machine as trusted; rotate the token in WareEra if you suspect exposure.

## Roadmap

PROST is built as an overlay *suite*. Planned non-inventory helpers: battle advisory, HUD tweaks. See [debate notes / issues](https://github.com/beertierchen/warera-prost/issues).

## Contributing

PRs welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Run tests with `npm test`.

## License

[MIT](LICENSE) © beertierchen
