# Pill Reminder

> [!WARNING]
> **Experimental Feature**: The Pill Reminder and H&H Budget modules are experimental. Timers rely on local system clocks and the initial sync when you consume a pill.

The **Pill Reminder** is designed to maximize your efficiency by tracking pill consumption windows and optimizing your Health & Hunger (H&H) recovery budget. It helps you stay above critical limits, ensuring you don't drop below 100% H&H right before a new pill window opens.

![Pill Reminder](/images/pilltimer_user.png)

## Key Concepts

### 1. Buff & Debuff Phase Timers
Pill consumption in WareEra triggers specific phases (Active/Knife phase, Recovery phase, and Ready phase). The Pill Reminder displays:
- **Remaining Effect Timers**: How long the active pill buff/effect lasts.
- **Phase Transition Indicators**: Clear notifications and countdowns showing when the next phase (such as the recovery or next pill window) starts.

![Pill Timer Tooltip](/images/pillentimer_tooltip.png)

### 2. H&H Budget Optimization
To prevent wasting regeneration or dropping below 100% H&H at the end of a cycle, the system monitors your current health/hunger levels:
- **Knife/Active Phase**: Safe to perform active tasks (e.g. using a knife) as long as your H&H remains above what you can safely regenerate.

![Pill H&H Budget](/images/pilltimer_user_2.png)

- **Recovery Phase**: Alert indicators warn you to stop knife actions or start consuming food to restore H&H back to 100% before the pill timer ends.

![Pill H&H Recovery](/images/pilltimer_user_3.png)

## Configuration

This feature is **disabled by default**.

To enable it, open the PROST settings dialog (⚙ button) and check the **Pill Reminder** option.
