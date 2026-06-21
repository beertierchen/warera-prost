# Settings & Cheat Sheet

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Settings.de)

Open settings with the ⚙ **gear button** at the bottom-right of any WareEra page
(also available via your userscript manager's menu). The dot on the gear shows
data freshness: 🟢 fresh · 🟠 stale · 🔴 rate-limited.

## Options

| Setting | Purpose |
| --- | --- |
| **API Token** | Optional. Fetches fresh equipment & scrap prices from the official API. See below. |
| **Fetch live offers via API** | Ranks item stats against currently active market listings (needs token). |
| **Scrap-Flip indicator** | Enables the [market flip badges](Scrap-Flip-Indicator). |
| **User notes on player links** | Enables [Player Notes](Player-Notes). |
| **Battle advisor** | Enables [Battle Advisor](Battle-Advisor); reveals the allied-codes field. |
| **Allied country codes** | Comma-separated, lowercase (e.g. `de,pt`). Your side on battle pages. |

Each experimental feature has an **ℹ** toggle next to it that expands a short
explanation, so the panel stays compact.

## Cheat Sheet

The **Cheat Sheet** button opens an in-app reference of what every badge, color,
and overlay means. On wide screens it opens as a scrollable panel to the **right**
of the settings dialog; on narrow screens it expands **below**.

## Language

Switch between 🇬🇧 English and 🇩🇪 German with the flag button in the top-right of
the dialog.

## API token

<a id="api-token"></a>

- The token is **your** personal WareEra credential.
- Stored locally via `GM_setValue`, lightly **obfuscated** (XOR) — this guards
  against casual shoulder-surfing in the storage viewer only. **It is not
  encryption** and gives no protection against local malware or other scripts
  with GM access.
- Treat the machine as trusted. **Revoke/rotate** the token in WareEra if you
  suspect exposure.

> PROST works without a token — you just get cached prices instead of live ones.
