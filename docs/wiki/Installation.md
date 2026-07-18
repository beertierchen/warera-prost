# Installation

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Installation.de)

PROST is a userscript — it runs inside a userscript manager in your browser. No
account, no server, no build step.

> ⚠️ **Open beta.** Expect rough edges: it can be slow or imprecise, and a WareEra
> UI update can temporarily break detection until PROST is updated. It only reads
> and annotates the page — no automation.

## 1. Install a userscript manager

| Browser | Recommended manager |
| --- | --- |
| Chrome / Edge / Brave | [Tampermonkey](https://www.tampermonkey.net/) |
| Firefox | [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) |
| Safari | [Tampermonkey](https://www.tampermonkey.net/) |

## 2. Install PROST

**Easiest — Greasy Fork (gets updates automatically):**

➡️ **[Install from Greasy Fork](https://greasyfork.org/de/scripts/583766-prost)**

**Manual — from the repo:**

1. Open [`warera-prost.user.js`](https://github.com/beertierchen/warera-prost/raw/main/warera-prost.user.js).
2. Your userscript manager should offer to install it. Confirm.

## 3. Verify

1. Open [WareEra](https://app.warera.io) and log in.
2. A ⚙ gear button appears at the **bottom-right**. The small dot on it shows
   data freshness (green = fresh, orange = stale, red = rate-limited).
3. Open your **inventory** to see overlays.

## Troubleshooting

<a id="troubleshooting"></a>

**Chrome / Edge: "Allow User Scripts" error**

On recent Chrome/Edge (Manifest V3) Tampermonkey may show:

> Please enable the "Allow User Scripts" extension setting. Click here for more info how to do this.

Fix it once:

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Open **Tampermonkey → Details**.
3. Turn on **Allow User Scripts**. (On older Chrome versions there's no such
   toggle — enable **Developer mode** at the top-right of the extensions page instead.)
4. Reload WareEra.

See Tampermonkey's [FAQ](https://www.tampermonkey.net/faq.php#Q209) for details.

> 📷 _Screenshot pending:_ `images/chrome-allow-userscripts.png` _— the "Allow User Scripts" toggle in Tampermonkey's details page._

**Other checks**

- The script is **enabled** in the manager dashboard (toggle on).
- You're on the right domain: `app.warera.io`.
- On first API use, **allow the `@connect` permissions** when prompted
  (`api2.warera.io`, `gateway.warerastats.io`).
- **Stuck on an old version after a release?** Greasy Fork can lag briefly. Force
  it: Tampermonkey dashboard → PROST → **Check for userscript updates**.

## Updating

- **Greasy Fork install:** updates are pulled automatically by your manager.
- **Manual install:** re-open the raw script to pull the latest version.
- Current version & changes: [CHANGELOG](https://github.com/beertierchen/warera-prost/blob/main/CHANGELOG.md).

## Optional: API key

Most features (including prices, transactions, and basic battle overlays) work without any setup via the community gateway. To enable official-API features (like alliance-based battle highlights and advanced bounty filters), add your own WareEra API key in [Settings](Settings#api-token). It stays on your machine.

> ⚠️ Ensure you create a **read-only** API key in WareEra settings. Do not share it, and revoke/rotate it if you suspect exposure.
