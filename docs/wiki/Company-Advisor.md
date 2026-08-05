# Company Advisor

> 🌐 **🇬🇧 English** · [🇩🇪 Deutsch](Company-Advisor.de)

The **Company Advisor** injects real-time economy data directly into your company overview (`/companies`), helping you optimize production and spot issues at a glance without leaving the page.

## Economy Badges

On each of your companies, PROST adds two small badges:

1. **Daily Profit**: Estimates your daily net profit (e.g., `+17.8/d`) based on the market price of the produced item, material costs, and the current level of your automated engine. *Note: Wages for workers are not subtracted.*
2. **Storage Capacity**: Shows the remaining time until your company's storage is full (`FULL`, `4.2h`, or `1.5d`).

## Eco Alerts

PROST keeps an eye on critical company parameters and highlights them using color-coded flags on the company card:
- **Production Bonus Warnings**: Warns you if the regional production bonus is low or missing.
- **Tax Warnings**: Alerts you to high market taxes in the company's country.
- **Deposit Expiration**: For raw material companies, it displays the remaining time of the active resource deposit, turning yellow or red as it gets closer to depletion.

## Requirements
- This feature works automatically by loading market prices and taxes from the public API.
- You must have an API Key configured in your [Settings](Settings) to ensure prices and country data can be fetched reliably.
