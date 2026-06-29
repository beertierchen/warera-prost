# Daily P&L Tracker

The **Daily Profit & Loss (P&L) Tracker** helps you monitor your financial performance in WareEra in real time. It calculates your net gains or losses for the current day based on your market actions, crafting results, and equipment wear.

![Daily P&L Panel](/images/P_L_Tracker.gif)

## Key Features

- **Transaction Ledger**: Tracks gold fluctuations from buying and selling items on the resource and equipment markets.
- **Equipment Wear Tracking**: Monitors durability drops on your active gear (armor, weapons) and logs the estimated gold loss (wear cost) automatically, helping you anticipate repair expenses.
- **Crafting P&L**: Logs gold spent on crafting materials versus the estimated market value of the crafted outcomes.
- **Real-Time HUD**: Displays a compact, floating overview of your current day's profit or loss directly on the screen.

## How It Works (Delta & Click Tracking)

The P&L tracker uses a non-intrusive local state engine to capture financial events:
1. **Gold Deltas**: Whenever your inventory updates or a transaction is confirmed, the tracker calculates the gold difference and assigns it to the appropriate ledger entry.
2. **Durability Shifts**: Durability changes are captured during scans. A decrease in durability is recorded as "Wear Loss" based on item replacement or repair cost estimates, while an increase indicates a repair or new item purchase (which sets a new baseline without logging false wear).
3. **Daily Reset**: The ledger automatically resets at midnight local time. The previous day's balance is cleared, starting a fresh tracker sheet for the new day.

## Configuration

The Daily P&L Tracker is **enabled by default**. 

If you prefer to disable it, open the PROST settings dialog (⚙ button) and toggle the **P&L Tracker** option under the Features section.
