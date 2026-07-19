> 🌐 [🇬🇧 English](Settings) · **🇩🇪 Deutsch**

# ⚙️ Einstellungen & Spickzettel

Das Zahnrad ⚙ unten rechts öffnet die Einstellungen. Ein kleiner Punkt am Zahnrad zeigt
den Frische-Status der Marktdaten (grün = aktuell, orange = veraltet, rot = Rate-Limit).

![Settings Dialog](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/settings.gif)

## Feature-Schalter

Jeder Schalter hat ein **ℹ**, das eine kurze Erklärung ein-/ausklappt, damit das
Panel kompakt bleibt:

- **Täglicher P&L Tracker** - zeigt deinen [täglichen Gewinn/Verlust](Daily-PnL-Tracker.de)
  in der Topbar. Standardmäßig an.
- **Ressourcen-Markt Intraday-Grafik** - *experimentell.* Blendet einen
  [Intraday-Preisverlauf](Market-Graph.de) in Ressourcen-Modals ein.
- **Pill Reminder** - *experimentell.* Topbar-Status & Timer für den
  [Pillen-Zyklus](Pill-Reminder.de).
- **Spieler-Notizen 📒** - *experimentell.* Notiz-Icon neben Spieler-Links. Siehe
  [Spieler-Notizen](Player-Notes.de).
- **Battle-Advisor ⚔️** - *experimentell.* Button-Hervorhebung auf Kampfseiten; blendet
  darunter das Feld für **Verbündete Ländercodes** ein. Siehe [Battle Advisor](Battle-Advisor.de).
- **🔧 Item-Advisor-Optionen**:
  - **Anzahl zu behaltender Items im Bestand (pro Typ/Tier)**: Legt die Bestandsgrenze fest, wie viele Gegenstände desselben Typs/Tiers als `💎 KEEP` empfohlen werden sollen (Standard: 3). Gegenstände außerhalb dieser Grenze erhalten keinen Diamanten.

## Diagnose

Ein eingebautes **[Diagnose](Diagnostics.de)**-Panel zeigt Feature-Health, Scan-Performance
(grün/gelb/rot-Ampel) und einen Debug-Dump. 
* **Benachrichtigungen testen**: Über das ausklappbare Untermenü können alle In-Game Toasts und ntfy-Push-Events (Kopfgeld, HP & Hunger voll, Pillenfenster, Debuff abgelaufen) direkt per Knopfdruck simuliert und getestet werden.

## Benachrichtigungen (ntfy.sh)

Ein eigener Einstellungsbereich konfiguriert das persönliche Empfänger-Topic:
* **Persönliches ntfy-Topic** — Der Kanal (Standard: `wia-user-<deineSpielerId>`), auf dem du deine Push-Nachrichten empfangen möchtest.
* **Topic-Secret (optional)** — Ein Geheimschlüssel zum Schutz deines Topics vor unbefugtem Mitlesen.
* **Abonnement-Link** — Ein direkter Link zu deinem Topic auf `ntfy.sh` für die unkomplizierte Einrichtung.


## API-Key

<a id="api-token"></a>

- Das Skript läuft **session-los** — es liest oder überträgt niemals deine Spiel-Session-Cookies.
- Ein offizieller **API-Key** ist für alle offiziellen API-Funktionen erforderlich. Ohne Key nutzt das Skript nur das Community-Gateway (Preise, Transaktionen, Schlachten); Allianz- und Suchfunktionen bleiben deaktiviert.
- Das Skript kontaktiert `api2.warera.io` niemals ohne deinen API-Key.
- Der API-Key wird lokal im GM-Speicher im Klartext gespeichert, um Audits zu ermöglichen.
- So erstellst du einen Key:
  1. Gehe im Spiel auf Einstellungen > API-Keys.
  2. Erstelle einen Key mit Lese-Rechten.
  3. Füge ihn in den PROST-Einstellungen ein.

### Interaktive Einführung („Tour of Beers“)

Wenn du neu bist oder noch kein API-Token konfiguriert ist, bietet PROST beim Start automatisch eine interaktive Anleitung namens **„Tour of Beers“** an.
- Klicke auf **„Zeig mir wie“**, um die Schritt-für-Schritt-Tour zu starten.
- Die Anleitung führt dich direkt durch das Spielmenü, die Einstellungen, den API-Token-Bereich, den Token-Ersteller und den Kopieren-Button.
- Am Ende öffnet sie automatisch die PROST-Einstellungen und hilft dir, den Token einzufügen und zu speichern.
- Du kannst die Tour jederzeit neu starten, indem du in den PROST-Einstellungen auf **„Tour of Beers“** klickst oder `PROST.tour()` in die Entwicklerkonsole deines Browsers eingibst.

## Sprache

Über die Flaggen-Schaltfläche oben im Dialog wechselst du zwischen **Deutsch** und
**Englisch**.

## Spickzettel (Cheat Sheet)

Der aufklappbare Spickzettel erklärt Empfehlungen (Farbe + Symbol) und die Overlays
direkt in der App. Auf breiten Fenstern öffnet er als scrollbares Panel rechts neben
dem Dialog, auf schmalen klappt er darunter auf.

## Weitere Schaltflächen

- **Speichern** — übernimmt Key und Feature-Schalter (Key-Änderung leert den Cache).
- **Cache leeren** — verwirft zwischengespeicherte Preise/Status.
- **Schließen** — schließt den Dialog ohne Speichern.

Siehe auch: [Installation](Installation.de) · [Home](Home.de)
