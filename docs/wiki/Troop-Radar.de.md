# Truppen-Radar

> 🌐 **[🇬🇧 English](Troop-Radar)** · [🇩🇪 Deutsch](Troop-Radar.de)

Das **Truppen-Radar** ist ein taktisches Overlay-Modul für Militäreinheiten (MUs), das der MU-Leitung und den Mitgliedern eine schnelle Übersicht über die Kampfbereitschaft, aktive Buffs und den individuellen Status der Truppe liefert.

![Truppen-Radar Übersicht](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/troop-radar.png)

## Hauptfunktionen

- **Kampfbereitschafts-Übersicht**: Injiziert ein kompaktes Info-Banner am Anfang der MU-Mitgliederliste mit folgenden Kennzahlen:
  - **Kampfbereit-Verhältnis**: Anzahl der Warskiller, die ein volles HP/Hunger-Bar haben und entweder gepillt oder bereit/debuff-frei zum Pillen sind.
  - **Warskiller**: Gesamtanzahl der Mitglieder, die als reine Kriegsskillung klassifiziert sind (mind. 75 % Kriegspunkte).
  - **Gepillt**: Anzahl aller aktiven Pille-Buffs in der Truppe.
  - **Ø HP**: Der durchschnittliche Gesundheitszustand der gesamten Einheit.
- **Handlungsaufforderungen**: Listet ungepillte Warskiller mit vollen Balken auf, die sofort kampfbereit wären, inklusive Direktlinks zu ihren Profilen zum schnellen Anpingen.
- **Mitgliederliste-Chips**:
  - **Skillungs-Badges**: Zeigt den Build-Typ jedes Spielers: `💥 WAR (X%)`, `⚖ Hybrid (X%)` oder `💰 Eco`.
  - **Gesundheits-Balken**: Kompakte, farblich abgestufte Visualisierung des HP-Balkens mit Absolutwerten.
  - **Absolute Uhrzeiten für Buffs & Debuffs**:
    - **Gepillt**: Zeigt die exakte Uhrzeit an, bis wann die Pille läuft: `💊 Gepillt bis: HH:MM` (in lokaler Client-Uhrzeit).
    - **Debuff-Sperre**: Rote Warnanzeige für aktive Erholungsphasen nach Pille-Ablauf: `💊 Kann pillen ab: HH:MM`.
    - **Pillen-Bereit**: Gelb leuchtende Anzeige für ungepillte Soldaten mit vollen H&H-Balken: `💊 ungepillt · bereit`.

## Aktivierung

Aktiviere das Radar unter [Einstellungen](Settings.de) → *Battle-Advisor Optionen* → *Truppen-Radar (MU-Mitgliederliste)*. Diese Option benötigt den übergeordneten Schalter *Battle Advisor*.
