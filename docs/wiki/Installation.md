# Installation

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Installation.de)

PROST is a userscript — it runs inside a userscript manager in your browser. No
account, no server, no build step.

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
3. Open your **inventory** or the **equipment market** to see overlays.

## Updating

- **Greasy Fork install:** updates are pulled automatically by your manager.
- **Manual install:** re-open the raw script to pull the latest version.

## Optional: API token

Most features work without any setup. To fetch fresh market and scrap prices,
add your own WareEra API token in [Settings](Settings#api-token). It stays on
your machine.

> ⚠️ Treat the token like a password. It grants access to your account's API.
> Revoke/rotate it in WareEra if you suspect exposure.
