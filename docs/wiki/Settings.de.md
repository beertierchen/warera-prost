> 🌐 [🇬🇧 English](Settings) · **🇩🇪 Deutsch**

# ⚙️ Einstellungen & Spickzettel

Das Zahnrad ⚙ unten rechts öffnet die Einstellungen. Ein kleiner Punkt am Zahnrad zeigt
den Frische-Status der Marktdaten (grün = aktuell, orange = veraltet, rot = Rate-Limit).

> 📷 _Screenshot folgt:_ `images/settings-modal.png` _— der Einstellungs-Dialog mit allen Schaltern._

## Feature-Schalter

Jeder Schalter hat ein **ℹ**, das eine kurze Erklärung ein-/ausklappt, damit das
Panel kompakt bleibt:

- **Live-Angebote über API abrufen** — holt aktuelle Marktangebote über die offizielle
  API, um Item-Stats gegen derzeit aktive Angebote zu ranken. Benötigt API-Token.
- **Täglicher P&L Tracker** — zeigt deinen [täglichen Gewinn/Verlust](Daily-PnL-Tracker.de)
  in der Topbar. Standardmäßig an.
- **Ressourcen-Markt Intraday-Grafik** — *experimentell.* Blendet einen
  [Intraday-Preisverlauf](Market-Graph.de) in Ressourcen-Modals ein.
- **Pill Reminder** — *experimentell.* Topbar-Status & Timer für den
  [Pillen-Zyklus](Pill-Reminder.de).
- **Scrap-Flip-Indikator** — *experimentell.* Markiert profitable Schrott-Flips auf dem
  Markt. Siehe [Scrap-Flip-Indikator](Scrap-Flip-Indicator.de).
- **Spieler-Notizen 📒** — *experimentell.* Notiz-Icon neben Spieler-Links. Siehe
  [Spieler-Notizen](Player-Notes.de).
- **Battle-Advisor ⚔️** — *experimentell.* Button-Hervorhebung auf Kampfseiten; blendet
  darunter das Feld für **Verbündete Ländercodes** ein. Siehe [Battle Advisor](Battle-Advisor.de).

## Diagnose

Ein eingebautes **[Diagnose](Diagnostics.de)**-Panel zeigt Feature-Health, Scan-Performance
(grün/gelb/rot-Ampel) und einen Debug-Dump — praktisch, wenn nach einem Spiel-Update etwas
nicht stimmt.

## API-Token

<a id="api-token"></a>

Optionaler Token für `api2.warera.io`, um frische Equipment- und Schrottpreise zu laden.

> **Sicherheit:** Der Token ist **deine** persönliche Zugangsberechtigung. Er wird
> lokal via `GM_setValue` gespeichert und nur **leicht verschleiert (XOR)** — das ist
> *keine* Verschlüsselung und schützt nur gegen flüchtiges Mitlesen im GM-Storage-Viewer,
> nicht gegen lokale Schadsoftware oder andere Scripts mit GM-Zugriff. Behandle den
> Rechner als vertrauenswürdig. Bei Verdacht auf Kompromittierung den Token in WareEra
> widerrufen/erneuern.

> PROST funktioniert auch ohne Token — du bekommst dann gecachte statt Live-Preise.

## Sprache

Über die Flaggen-Schaltfläche oben im Dialog wechselst du zwischen **Deutsch** und
**Englisch**.

## Spickzettel (Cheat Sheet)

Der aufklappbare Spickzettel erklärt Empfehlungen (Farbe + Symbol) und die Overlays
direkt in der App. Auf breiten Fenstern öffnet er als scrollbares Panel rechts neben
dem Dialog, auf schmalen klappt er darunter auf.

## Weitere Schaltflächen

- **Speichern** — übernimmt Token und Feature-Schalter (Token-Änderung leert den Cache).
- **Cache leeren** — verwirft zwischengespeicherte Preise/Status.
- **Schließen** — schließt den Dialog ohne Speichern.

Siehe auch: [Installation](Installation.de) · [Home](Home.de)
