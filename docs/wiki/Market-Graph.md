# Resource Market Intraday Graph

> [!WARNING]
> **Experimental Feature**: The Market Graph is currently in active development. Performance and data consistency may vary depending on local browser storage limits.

The **Resource Market Intraday Graph** injects an interactive price history chart directly into the resource trading pages of WareEra. This visualization helps you spot price trends, identify daily low/high points, and decide the best moments to buy or sell raw materials.

![Resource Market Intraday Graph](/images/market_Graph.gif)

## Key Features

- **Price Trend Line**: Renders price movements for the selected resource over the last 24 hours.
- **Intraday Sampling**: Aggregates price data points observed during your sessions into hourly buckets to minimize storage overhead.
- **Visual Integration**: Injected seamlessly above the resource listing to provide immediate decision support without cluttering the screen.

## How It Works

1. **Local Observation**: Whenever you view the market or retrieve fresh resource prices, PROST records the current lowest sell offer.
2. **Data Aggregation**: To avoid filling up your browser storage, price entries are grouped and bucketed. Only the most representative pricing trends are stored locally.
3. **Chart Rendering**: Built using lightweight inline SVG rendering to ensure maximum compatibility and zero dependency on external tracking libraries.

## Configuration

This feature is **disabled by default** to conserve local storage.

To enable it, open the PROST settings dialog (⚙ button) and check the **Market Graph** option.
