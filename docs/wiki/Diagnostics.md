# Diagnostics

The **Diagnostics** panel provides technical oversight, performance monitoring, and troubleshooting utilities to ensure PROST is running optimally and not lagging your browser during inventory management.

![Diagnostics Panel](images/diagnostics.png)

## Key Features

### 1. Feature Health Panel
Displays the operational status of all major script modules (such as Daily P&L, Market Graph, Pill Reminder, etc.) so you can verify if a feature is enabled, cached, or experiencing errors.

### 2. Performance Status Ampel (Traffic Light)
Tracks the exact duration (in milliseconds) of your inventory scans to identify bottlenecks:
- <span style="color:#2ea043; font-weight:bold;">● Green (&lt; 50ms)</span>: Scanning is near-instantaneous and has zero impact on browser responsiveness.
- <span style="color:#d29922; font-weight:bold;">● Yellow (50ms - 150ms)</span>: Scans are noticeable but acceptable.
- <span style="color:#f85149; font-weight:bold;">● Red (&ge; 150ms)</span>: Scans are heavy and might cause frame drops during mutation events.

### 3. Technical Diagnostic Dump
A copy-pasteable data block containing cache stats, active page details, and execution logs. Useful for sharing inside Github Issues if you encounter an error.

### 4. Card Scoping Debugger
For developers or advanced users troubleshooting page layout shifts:
- Displays skin/item detection counts.
- **Scoping Log Menu**: Triggers a scoping trace of the first visible card directly in the browser developer console, printing the climb selectors, container widths, and image details.

## How to Access

1. Open the PROST settings dialog (⚙ button).
2. Click the **Diagnose / Diagnostics** button at the bottom of the modal.
3. The diagnostics overlay will render on top of the settings panel.
