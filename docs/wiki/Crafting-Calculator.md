# Crafting Calculator

The **Crafting Calculator** assists players in evaluating the economic feasibility of crafting recipes. It compares the total market value of required raw materials against the market floor price of the finished product, showing you instantly whether it is cheaper to craft or to buy.

![Crafting Profit Overlay](/images/carfting_advisor.png)

## Key Features

- **Recipe Cost Analysis**: Automatically scans the active recipe ingredients and calculates the total material cost using current market floor prices.
- **Profitability Indicators**: Computes the net profit or loss of the craft:
  - **Green Indicator**: Crafting the item is profitable (cheaper than buying, or the result sells for more than the ingredients' cost).
  - **Red Indicator**: Crafting the item is a net loss (it is cheaper to buy the finished item directly or sell the raw materials).
- **Direct UI Injection**: Displays a clean, localized stats overlay directly on the crafting detail screen.

## How It Works

1. **Active Recipe Detection**: When you open any item recipe detail in the crafting menu, the calculator parses the required quantities for each material.
2. **Cost Calculation**: Raw material prices are extracted from your local price cache (updated via market scans).
3. **Outcome Evaluation**: The calculator retrieves the market floor price of the crafted item and subtracts the material cost (including any base gold requirements) to determine the final margins.

## Configuration

The Crafting Calculator is integrated into the core engine and runs automatically whenever valid price data is available. No extra configuration is required.
