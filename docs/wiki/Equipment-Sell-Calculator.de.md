# Equipment Preisrechner

Der **Equipment Preisrechner** (Equipment Sell Calculator) ist ein schwebendes, interaktives Werkzeug direkt im Equipment-Markt, das dir hilft, den optimalen Verkaufspreis für deine Items präzise zu berechnen. Inspiriert von Lebly, zeigt es dir genau, wie viel ein Käufer zahlen muss, damit du nach Abzug der Steuern deinen gewünschten Nettogewinn erhältst.

![Equipment Preisrechner](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/equip-sell-calc.png)

## Hauptfunktionen

- **Präzise Rundung**: Simuliert die exakte 3-Nachkommastellen-Rundung des Spiels, um den absolut genauesten Listenpreis zu berechnen.
- **Dynamische Steuern**: Erlaubt es dir, den Marktsteuersatz on-the-fly anzupassen, um zu sehen, wie er sich auf den vom Käufer zu zahlenden Endbetrag auswirkt.
- **Auto-Undercut**: Bietet eine eingebaute "Unterbieten (-0.001)" Checkbox (standardmäßig aktiv). Du kannst den aktuell günstigsten Preis im Markt direkt in das Zielfeld eingeben, und der Rechner zieht automatisch 0.001 ab, bevor er den exakten Listenpreis berechnet.
- **Klicken zum Kopieren**: Zeigt ein großes Endergebnis und Zwischenschritte (Ticks) an. Ein Klick auf eine Zahl kopiert diese sofort in die Zwischenablage, sodass du sie direkt in das Verkaufsfenster des Spiels einfügen kannst.
- **Interaktive Ticks**: Zeigt Variationen um deinen Zielpreis herum (in `-0.002` bis `+0.001` Schritten), damit du deinen Verkaufspreis für psychologische Preissetzung oder exakte Gewinnmargen feineinstellen kannst.

## Wie es funktioniert

1. **Ziel eingeben**: Gib den Netto-Goldbetrag ein, den du *nach* Steuern erhalten möchtest.
2. **Steuern festlegen**: Passe den Prozentsatz an (standardmäßig dein zuletzt verwendeter oder normaler Marktsteuersatz).
3. **Preis wählen**: Der Rechner ermittelt den exakten Listenpreis sowie eine Liste von Tick-Anpassungen. Klicke auf deinen bevorzugten Wert, um ihn zu kopieren, und füge ihn dann in das Verkaufsfenster des Spiels ein.

## Konfiguration

Dieses Feature kann im **Einstellungen & Spickzettel** Panel unter der Kategorie "Wirtschaft" (bzw. "Market") aktiviert oder deaktiviert werden.
