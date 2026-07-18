<div align="center">

# 🍻 PROST

**P**ersonal **R**ecommendation **O**verlay & **S**upport **T**ool

A suite of client-side [userscripts](https://en.wikipedia.org/wiki/Userscript) for the browser game [**WareEra**](https://app.warera.io). Visual overlays and decision helpers, item advice, market scrap-flip indicators, notes, and more.

**Prost! 🍺 It just helps you play, it doesn't play for you.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![No automation](https://img.shields.io/badge/automation-none-green.svg)
[![Install from Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-Install-red?logo=tampermonkey)](https://greasyfork.org/de/scripts/583766-prost)
[![Wiki](https://img.shields.io/badge/docs-Wiki-blue?logo=github)](https://github.com/beertierchen/warera-prost/wiki)

📖 **Full docs with screenshots:** [Wiki](https://github.com/beertierchen/warera-prost/wiki) · [Deutsch](https://github.com/beertierchen/warera-prost/wiki/Home.de)

</div>

---

## ⚠️ No automation

PROST is a **client-side visual assistant only**. It runs session-less (never reads or forwards your game session cookies) and reads the page. Official-API features require your personal API key; without it, only the community gateway is used. It never clicks, trades, or plays for you.

## ⚖️ Disclaimer & Open Source

> **Use at your own risk.** PROST is provided free of charge, **"as is"**, without any warranty of any kind (see [LICENSE](LICENSE)). You alone are responsible for how you use it. Running a userscript on WareEra may conflict with the game's terms of service and could put your account at risk. The author accepts **no liability whatsoever** for any consequence of your use — account action, data loss, or anything else. If in doubt, don't run it.

**Not claimed as intellectual property.** This project is deliberately open source under the [MIT license](LICENSE). I do not treat it as private property. Copy it, fork it, modify it, redistribute it.

**Cooperation is welcome.** This is a community project. Contributions, issues, and forks are actively encouraged — see [CONTRIBUTING.md](CONTRIBUTING.md).

📄 Full text: [DISCLAIMER.md](DISCLAIMER.md).

<details>
<summary><b>🇩🇪 Haftungsausschluss (Deutsch)</b></summary>

> **Nutzung auf eigene Gefahr.** PROST wird kostenlos und **„wie besehen"** ohne jede Gewährleistung bereitgestellt (siehe [LICENSE](LICENSE)). Für die Nutzung bist allein du verantwortlich. Der Einsatz eines Userscripts kann gegen die Nutzungsbedingungen von WareEra verstoßen und dein Spielkonto gefährden. Der Autor übernimmt **keinerlei Haftung** für Folgen der Nutzung (Konto-Sperren, Datenverlust o. Ä.). Im Zweifel: nicht nutzen.

**Kein Anspruch auf geistiges Eigentum.** Dieses Projekt ist bewusst Open Source unter der [MIT-Lizenz](LICENSE). Ich betrachte es nicht als mein Eigentum. Kopieren, Forken, Verändern und Weiterverteilen sind ausdrücklich erlaubt.

**Zusammenarbeit erwünscht.** Ein Community-Projekt. Beiträge, Issues und Forks sind ausdrücklich willkommen — siehe [CONTRIBUTING.md](CONTRIBUTING.md).

</details>

## Scripts

| Script | What it does |
|--------|--------------|
| **PROST** (`warera-prost.user.js`) | KEEP / SELL / SCRAP advice from local stats + market floors. Scrap-flip profitability badges on the market. Session-less design requiring a personal API key for official-API features (runs keyless using the gateway for prices/battles). i18n (DE/EN). Includes built-in 📒 **player notes** and ⚔️ **ntfy push notifications** for active allied bounties (configurable in settings). |
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

The script is strictly **session-less** — it never accesses or transmits your game session cookies. Outbound requests are anonymous (to the community gateway) or authenticated solely with your official **API key** (required for official-API features). The script never contacts `api2.warera.io` without your API key. The API key is stored locally in GM storage as plain text to allow auditing.

## Roadmap

PROST ships as an overlay *suite*. Already shipped beyond inventory advice: **battle advisor**, **pill / H&H timer**, **market price graph**, **daily P&L tracker**, **ntfy + in-page bounty notifications**, and a built-in **health / status HUD**.

Planned work and the idea backlog are tracked in [issues](https://github.com/beertierchen/warera-prost/issues) (labelled by area — `market`, `battle`, `notifications`, `equipment`, …) and organised on a Kanban [project board](https://github.com/users/beertierchen/projects/1).

## Contributing

PRs welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Run tests with `npm test`.

## License

[MIT](LICENSE) © beertierchen
