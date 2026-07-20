# Battle Advisor

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Battle-Advisor.de)

*Experimental.* On battle pages, PROST highlights the button for **your side**
so you don't attack/defend the wrong way, and previews the active orders inline.

![Battle page with the DEFEND button highlighted green and the ATTACK button muted](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/battle-advisor.png)

## What you see

- **Your side's button is highlighted** (green outline, slightly enlarged); the
  other side is muted (dimmed, grayscale). In the screenshot the **DEFEND** side
  is highlighted and **ATTACK** is muted.
- **Compact orders** are cloned into the button: the country flags / military
  unit icons that have posted orders for that side, shown inline so you can read
  the call to action at a glance.

![Battle Order Tooltip](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/Fighting_Tooltip.png)

## Order Radar (Entity Banners)

On **Country** (`/country/<id>`) and **Military Unit** (`/mu/<id>`) pages, PROST injects a dynamic **Order Radar** strip into the bottom-right corner of the header banner card.

![Order Radar on Country Page Banner](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/order-radar-country.png)

![Order Radar on Military Unit Banner](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/order-radar-mu.png)

### Key Features:
- **Priority Target Markers**: Color-coded target icons indicate the priority set for each active battle order (`🔴 Red = High`, `🟡 Yellow = Medium`, `🟢 Green = Low`).
- **Live Matchup & Stats**: Shows belligerents (`🇧🇫 › 🇳🇬`), target region, ratio percentage, round ground points (`⛰`), and money bounties (`💰`).
- **4-Tier Responsive Layout**: Automatically collapses based on available window width:
  - **Full (>= 750px)**: Complete details line.
  - **No Region (580px – 749px)**: Omits target region to preserve header text visibility.
  - **Minimal (440px – 579px)**: Shows target marker, flags, and percentage.
  - **Icon-Only (< 440px)**: Collapses into round priority target badges.
- **Instant Route Purge**: Automatically clears leftover strips during SPA navigation across countries and MUs.

## How your side is chosen

1. **Primary — your allied list.** The side whose country flag code is in your
   configured allied codes (e.g. `de,pt`) is highlighted. Set this in
   [Settings](Settings) → *Allied country codes*.
2. **Fallback — order-giving side.** If neither side matches your allied list,
   the side that has **orders** (from a country *or* a military unit) is treated
   as a temporary ally for this battle and highlighted.
3. **No guess.** If both sides or neither side have orders and nothing matches
   your allied list, nothing is highlighted — PROST won't guess.

## Enabling

Off by default (experimental). Turn it on in [Settings](Settings) → *Battle
advisor*, then enter your **allied country codes** (comma-separated, lowercase,
e.g. `de,pt`). The allied-codes field appears once the feature is enabled.

> Decision support only. PROST highlights a button — you still click it.
