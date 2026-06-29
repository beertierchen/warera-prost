# Ressourcen-Markt-Graph

> [!WARNING]
> **Experimentelle Funktion**: Der Markt-Graph befindet sich in der aktiven Entwicklung. Die Performance und Datenkonsistenz hängen von den Speicherlimits deines Browsers ab.

Der **Ressourcen-Markt Intraday-Graph** bettet eine interaktive Preisverlaufsgrafik direkt in die Ressourcen-Handelsfenster von WareEra ein. Diese Visualisierung hilft dir, Preistrends zu erkennen, Tief- und Höhepunkte des Tages zu identifizieren und den optimalen Zeitpunkt für den Kauf oder Verkauf zu wählen.

![Ressourcen-Markt-Graph](/images/market_Graph.gif)

## Hauptfunktionen

- **Preistrend-Linie**: Zeigt die Preisbewegungen der ausgewählten Ressource über die letzten 24 Stunden an.
- **Intraday-Aggregation**: Gruppiert beobachtete Preisdaten in stündliche Abschnitte (Buckets), um den lokalen Speicherbedarf deines Browsers zu minimieren.
- **Nahtlose Integration**: Wird direkt über der Ressourcenliste eingeblendet, um schnelle Entscheidungen zu unterstützen.

## Funktionsweise

1. **Beobachtung**: Jedes Mal, wenn du den Markt öffnest oder Preise geladen werden, erfasst PROST das günstigste Verkaufsangebot.
2. **Daten-Kompression**: Um deinen Browserspeicher nicht zu überladen, werden alte Einträge aggregiert. Nur repräsentative Preistrends bleiben lokal gespeichert.
3. **Leichtgewichtiges Rendering**: Der Graph wird als inline SVG direkt im Browser generiert - ohne Abhängigkeiten von externen Bibliotheken oder Skripten.

## Konfiguration

Diese Funktion ist **standardmäßig deaktiviert**, um lokalen Speicherplatz zu sparen.

Du kannst sie aktivieren, indem du den PROST-Einstellungsdialog (Zahnrad-Symbol ⚙) öffnest und den Haken bei **Market Graph** setzt.
