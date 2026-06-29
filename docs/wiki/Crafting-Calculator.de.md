# Crafting-Rechner

Der **Crafting-Rechner** unterstützt dich bei der wirtschaftlichen Bewertung von Rezepten. Er vergleicht den Marktwert der benötigten Materialien mit dem Marktpreis des hergestellten Gegenstands und zeigt dir sofort, ob sich die Herstellung lohnt oder ob der Direktkauf günstiger ist.

![Crafting-Rechner](images/crafting-calculator.png)

## Hauptfunktionen

- **Materialkosten-Analyse**: Scant das aktive Rezept und berechnet die Summe aller Zutaten basierend auf den aktuellen Tiefstpreisen des Marktes.
- **Profitabilitäts-Indikatoren**: Errechnet die Marge für das Rezept:
  - **Grüner Indikator**: Die Herstellung ist rentabel (günstiger als Kaufen, bzw. der Erlös übersteigt die Materialkosten).
  - **Roter Indikator**: Die Herstellung ist ein Verlustgeschäft (Zutaten einzeln zu verkaufen oder das fertige Item direkt zu kaufen ist wirtschaftlicher).
- **Direkte UI-Einbettung**: Zeigt ein kompaktes Overlay direkt über dem Crafting-Button an.

## Funktionsweise

1. **Rezepterkennung**: Beim Öffnen einer Rezept-Detailansicht erfasst der Rechner die benötigten Mengen aller Zutaten.
2. **Kostenberechnung**: Die Preise für die Rohstoffe werden aus dem lokalen Preis-Cache geladen (welcher durch deine Marktsuchen gepflegt wird).
3. **Ergebnisbewertung**: Der Rechner ermittelt den aktuellen Marktwert des hergestellten Gegenstands und zieht die Materialkosten (sowie etwaige Basisgoldkosten) ab, um die Marge zu bestimmen.

## Konfiguration

Der Crafting-Rechner ist fest in das Skript integriert und wird automatisch eingeblendet, sobald ausreichende Preisdaten vorliegen. Es ist keine zusätzliche Aktivierung notwendig.
