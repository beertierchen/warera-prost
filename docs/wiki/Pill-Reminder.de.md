# Pillen-Reminder & H&H Budget

> [!WARNING]
> **Experimentelle Funktion**: Der Pillen-Reminder und das H&H Budget sind experimentell. Alle Timer basieren auf deiner lokalen Systemzeit und dem ersten erfassten Status nach Einnahme einer Pille.

Der **Pillen-Reminder** optimiert deine Spielzyklen, indem er dich an Einnahmefenster erinnert und dir hilft, dein Lebens- und Hungersbudget (H&H) so zu verwalten, dass du pünktlich zum nächsten Pillenfenster die vollen 100% H&H erreichst.

![Pill-Reminder](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pilltimer_user.png)

## Hauptkonzepte

### 1. Buff- & Debuff-Phasen-Timer
Pillen lösen Zyklen mit bestimmten Phasen aus (Messer-Phase, Regen-Phase, Bereit-Phase). Der Reminder zeigt:
- **Aktive Buff-Dauer**: Restzeit der aktuellen Pille.
- **Phasenübergangs-Timer**: Countdowns und Anzeigen für den Start der nächsten Phase (z.B. Beginn der Regenerationszeit oder nächstes Einnahmefenster).

![Pill Timer Tooltip](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pillentimer_tooltip.png)

### 2. H&H Budget-Optimierung
Um zu verhindern, dass du Regeneration verschenkst oder zum Ende eines Zyklus unter 100% H&H fällst, überwacht das System deine Werte:
- **Messer-Phase**: Solange deine H&H-Werte über dem liegen, was du im verbleibenden Zyklus regenerieren musst, kannst du Messer-Aktionen ausführen.

![Pill H&H Budget](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pilltimer_user_2.png)

- **Regen-Phase**: Warnungen signalisieren dir, Messer-Aktionen einzustellen und Nahrung zu konsumieren, um rechtzeitig vor Ablauf der Abklingzeit wieder 100% H&H zu erreichen.

![Pill H&H Recovery](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/pilltimer_user_3.png)

## Konfiguration

Diese Funktion ist **standardmäßig deaktiviert**.

Du kannst sie aktivieren, indem du den PROST-Einstellungsdialog (Zahnrad-Symbol ⚙) öffnest und den Haken bei **Pill Reminder** setzt.
