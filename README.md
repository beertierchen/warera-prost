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
| **PROST** (`warera-prost.user.js`) | KEEP / SELL / SCRAP advice from local stats + market floors. Scrap-flip profitability badges on the market. Optional WareEra API integration via your own key. i18n (DE/EN). Includes built-in 📒 **player notes** (enable in settings). |
| **User Notes** (`warera-notes.user.js`) | Standalone script for local, persistent notes on player links. Use this *or* the built-in notes in PROST — not both at the same time. |

## Install

### Schritt 1 – Userscript-Manager installieren

[Tampermonkey](https://www.tampermonkey.net/) (empfohlen) oder [Violentmonkey](https://violentmonkey.github.io/) im Browser installieren.

### Schritt 2 – Script installieren

**Einfachste Methode – Greasy Fork (ein Klick):**

| Script | Greasy Fork |
|--------|-------------|
| **PROST** (Hauptscript) | [![Install from Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-Install-red?logo=tampermonkey)](https://greasyfork.org/de/scripts/583766-prost) |
| **User Notes** | *(demnächst auf Greasy Fork)* |

→ Greasy Fork-Seite öffnen → **„Dieses Script installieren"** klicken → im Tampermonkey-Dialog bestätigen.

<details>
<summary>Alternativ: direkt von GitHub installieren</summary>

- **PROST** → [`warera-prost.user.js`](https://raw.githubusercontent.com/beertierchen/warera-prost/main/warera-prost.user.js)
- **User Notes** → [`warera-notes.user.js`](https://raw.githubusercontent.com/beertierchen/warera-prost/main/warera-notes.user.js)

</details>

### Schritt 3 – Fertig

[app.warera.io](https://app.warera.io) öffnen – das Overlay lädt automatisch. Einstellungen über das Tampermonkey-Menü (⚙️ *Menübefehle*).

Updates werden automatisch über deinen Userscript-Manager eingespielt (`@updateURL`).

## Privacy & API key

The optional WareEra API token is **your personal credential**, stored locally via `GM_setValue`. A userscript sandbox has no real keystore. The light XOR obfuscation only deters casual shoulder-surfing, it is **not encryption**. Treat your machine as trusted; rotate the token in WareEra if you suspect exposure.

## Roadmap

PROST is built as an overlay *suite*. Planned non-inventory helpers: battle advisory, HUD tweaks. See [debate notes / issues](https://github.com/beertierchen/warera-prost/issues).

## Contributing

PRs welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Run tests with `npm test`.

## License

[MIT](LICENSE) © beertierchen
