# Settings & Cheat Sheet

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Settings.de)

Open settings with the ⚙ **gear button** at the bottom-right of any WareEra page
(also available via your userscript manager's menu). The dot on the gear shows
data freshness: 🟢 fresh · 🟠 stale · 🔴 rate-limited.

![Settings Dialog](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/settings.gif)

## Options

Each toggle has an **ℹ** info button that expands a short explanation, so the
panel stays compact.

| Setting | Purpose |
| --- | --- |
| **API Key** | Required for official-API features. Without it, the script only uses the community gateway. |
| **Daily P&L Tracker** | Shows your [daily profit/loss](Daily-PnL-Tracker) in the topbar. On by default. |
| **Resource Market Intraday Graph** | *Experimental.* Adds an [intraday price graph](Market-Graph) to resource market modals. |
| **Pill Reminder** | *Experimental.* Topbar [pill-cycle status & timer](Pill-Reminder). |
| **User notes on player links** | *Experimental.* Enables [Player Notes](Player-Notes). |
| **Battle advisor** | *Experimental.* Enables [Battle Advisor](Battle-Advisor); reveals the allied-codes field. |
| **Allied country codes** | Comma-separated, lowercase (e.g. `de,pt`). Your side on battle pages. |
| **🔧 Item Advisor Options** | Configures **Stock items to keep per type** (defines the maximum limit of items of a specific type/tier to keep in stock as `💎 KEEP`, default: 3). |

## Diagnostics

A built-in **[Diagnostics](Diagnostics)** panel shows feature health, scan
performance (a green/yellow/red traffic-light) and a debug dump.
* **Test Notifications**: An expandable section allows you to trigger all in-game toasts and ntfy push notifications (Bounty, HnH, Pill Window, Debuff) directly for instant verification.

## Notifications (ntfy.sh)

A dedicated settings category configures your personal recipient feed:
* **Personal ntfy Topic** — The channel (defaults to `wia-user-<yourPlayerId>`) you want to subscribe to.
* **Topic Secret (optional)** — A secret key appending to the topic URL to protect your alerts from third parties.
* **Subscription Link** — A direct link to open and subscribe to your topic on `ntfy.sh`.

## Cheat Sheet

The **Cheat Sheet** button opens an in-app reference of what every badge, color,
and overlay means. On wide screens it opens as a scrollable panel to the **right**
of the settings dialog; on narrow screens it expands **below**.

## Language

Switch between 🇬🇧 English and 🇩🇪 German with the flag button in the top-right of
the dialog.

## API key

<a id="api-token"></a>

- The script runs **session-less** — it never reads or forwards your game session cookies.
- An official **API key** is required for all official-API features. Without it, the script only uses the community gateway (prices, transactions, battles), and alliance- and search-based features stay off.
- The script never contacts `api2.warera.io` without your API key.
- The API key is stored locally in GM storage as plain text to allow auditing.
- To obtain a key:
  1. Go to Settings > API Keys in the game.
  2. Create a read-only key.
  3. Paste it in Settings.
