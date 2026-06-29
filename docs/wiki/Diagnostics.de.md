# Diagnose-Modus

Das **Diagnose-Panel** bietet technische Einblicke, Performance-Messungen und Werkzeuge zur Fehlerbehebung. Es hilft sicherzustellen, dass PROST flüssig läuft und deinen Browser beim Scannen des Inventars nicht ausbremst.

![Diagnose-Panel](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/debuging_healt_traficlight.gif)

## Hauptfunktionen

### 1. Feature-Health-Übersicht
Zeigt den Funktionsstatus aller Hauptmodule (z.B. Daily P&L, Markt-Graph, Pill-Reminder) an, sodass du leicht prüfen kannst, ob ein Feature aktiv ist, Daten geladen hat oder einen Fehler meldet.

### 2. Performance-Status (Scan-Ampel)
Erfasst die exakte Ausführungszeit deiner Inventar-Scans:
- <span style="color:#2ea043; font-weight:bold;">● Grün (&lt; 50ms)</span>: Die Scans laufen absolut flüssig und haben keinen spürbaren Einfluss auf das Spiel.
- <span style="color:#d29922; font-weight:bold;">● Gelb (50ms - 150ms)</span>: Scans sind messbar, aber unkritisch.
- <span style="color:#f85149; font-weight:bold;">● Rot (&ge; 150ms)</span>: Die Scans sind sehr schwerfällig und können kurze Ruckler bei Inventar-Aktualisierungen verursachen.

### 3. Technischer Diagnose-Dump
Ein Block strukturierter Daten (Cache-Status, Timing-Statistiken, DOM-Details), der einfach kopiert und bei Fehlern in GitHub-Issues eingefügt werden kann.

### 4. Scoping-Debugger für Entwickler
- Zeigt die Anzahl erkannter Skins und Gegenstände des letzten Scans.
- **Scoping-Protokoll-Befehl**: Sendet einen detaillierten Scoping-Trace der ersten Karte direkt an deine Browser-Konsole, um Selektoren, Eltern-Elemente und Bildquellen zu prüfen.

## Zugriff

1. Öffne den PROST-Einstellungsdialog (Zahnrad-Symbol ⚙).
2. Klicke ganz unten auf den Button **Diagnose / Diagnostics**.
3. Das Diagnose-Overlay öffnet sich direkt über den Einstellungen.
