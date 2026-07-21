# Troop Radar

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Troop-Radar.de)

The **Troop Radar** is a tactical overlay module for Military Units (MUs) that provides a quick view of your unit's combat readiness, active buffs, and individual member state.

![Troop Radar Overview](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/troop-radar.png)

## Key Features

- **Combat Readiness Overview**: Injects a clean summary block at the top of the MU members roster page displaying:
  - **Combat Ready Ratio**: Number of Warskillers who have a full HP/Hunger bar and either have a pill buff active or are ready/able to pill.
  - **Warskillers**: Total number of members classified under the "WAR" skill build (at least 75% war points).
  - **Pilled**: Total number of currently active pills across all unit members.
  - **Average HP**: Roster-wide average health percentage.
- **Actionable Warnings**: Prominently highlights Warskiller members who are currently unpilled but have 100% HP & Hunger (ready to pill), with direct links to quickly ping or view their profiles.
- **Roster List Overlay (Member Chips)**:
  - **Build Badges**: Identifies each member's skill build class: `💥 WAR (X%)`, `⚖ Hybrid (X%)`, or `💰 Eco`.
  - **Health Indicators**: Compact, color-coded health bars showing absolute values.
  - **Absolute Expiration Timestamps**:
    - **Pill Active**: Displays when the active buff ends: `💊 Gepillt bis: HH:MM` (in local time).
    - **Debuff Cooldown**: Muted red badges highlighting when the recovery cooldown ends and the member can take a pill again: `💊 Kann pillen ab: HH:MM`.
    - **Pill Ready**: Highlighted warning badge for unpilled members ready to ingest: `💊 ungepillt · bereit`.

## Enabling

Enable it in [Settings](Settings) → *Battle Advisor Options* → *Troop-Radar (MU Member list)*. It requires the master *Battle Advisor* feature toggle to be active.
