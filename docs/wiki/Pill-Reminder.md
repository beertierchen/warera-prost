# Pill Reminder

> [!WARNING]
> **Experimental Feature**: The Pill Reminder and H&H Budget modules are experimental. Timers rely on local system clocks and the initial sync when you consume a pill.

The **Pill Reminder** is designed to maximize your efficiency by tracking pill consumption windows and optimizing your Health & Hunger (H&H) recovery budget. It helps you stay above critical limits, ensuring you don't drop below 100% H&H right before a new pill window opens.

![Pill Reminder](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pilltimer_user.png)

## Key Concepts

### 1. Buff & Debuff Phase Timers
Pill consumption in WareEra triggers specific phases (Active/Knife phase, Recovery phase, and Ready phase). The Pill Reminder displays:
- **Remaining Effect Timers**: How long the active pill buff/effect lasts.
- **Phase Transition Indicators**: Clear notifications and countdowns showing when the next phase (such as the recovery or next pill window) starts.

![Pill Timer Tooltip](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pillentimer_tooltip.png)

### 2. H&H Budget Optimization
To prevent wasting regeneration or dropping below 100% H&H at the end of a cycle, the system monitors your current health/hunger levels:
- **Knife/Active Phase**: Safe to perform active tasks (e.g. using a knife) as long as your H&H remains above what you can safely regenerate.

![Pill H&H Budget](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pilltimer_user_2.png)

- **Recovery Phase**: Alert indicators warn you to stop knife actions or start consuming food to restore H&H back to 100% before the pill timer ends.

![Pill H&H Recovery](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pilltimer_user_3.png)

## Configuration

This feature is **disabled by default**.

To enable it, open the PROST settings dialog (⚙ button) and check the **Pill Reminder** option.

---

## 🔔 Notifications & Toasts

The Pill Reminder can trigger push and desktop notifications when specific events occur. These are controlled via the **Notification Checkbox** (on the right-hand side of the Pill Reminder row) or individually in the expanded details block:

* **Master Checkbox:** Checks or unchecks all three Pill Reminder notification options simultaneously.
* **H&H Full:** Sends an alert as soon as your Health and Hunger both reach 100%, signaling readiness for the next pill.
* **Preferred Window:** Alerts you when your configured preferred pill consumption window is reached.
* **Debuff Expired:** Informs you when the pill cooldown phase ends and your character is clear of active debuffs.

*Local Toasts:* Each of these events also triggers a styled, colored in-game popup toast at the top center of the screen when you are active in the browser.
