# ⚔️ Bounty-Push-Benachrichtigungen (ntfy.sh)

Das Feature **Bounty-Push-Benachrichtigungen** ist ein Hintergrunddienst (Poller), der in WareEra-Schlachten nach aktiven verbündeten Kopfgeld-Zahlungen sucht und sofortige Push-Benachrichtigungen auf dein Smartphone oder deinen Desktop-Browser sendet. Hierzu wird der kostenlose Open-Source-Dienst [ntfy.sh](https://ntfy.sh) verwendet.

---

## Funktionsweise

1. **Hintergrund-Abfragen:** Das Script fragt alle 30 Sekunden im Hintergrund die aktiven Schlachten ab.
2. **Tab-Deduplizierung:** Wenn du WareEra in mehreren Browser-Tabs geöffnet hast, sorgt eine tabübergreifende Sperre (Lock) dafür, dass immer nur ein einziger Tab den Server abfragt.
3. **Multi-Geräte-Staggering:** Wenn du das Spiel auf verschiedenen Profilen oder Geräten geöffnet hast, verhindern ein zufälliger Jitter (0–10s) und eine ntfy.sh-Historienprüfung doppelte Push-Meldungen für dasselbe Kopfgeld.
4. **Ziel-Filterung:** Push-Nachrichten werden nur ausgelöst, wenn ein Kopfgeld aktiv ist, das deinem konfigurierten Benachrichtigungs-Umfang entspricht.

---

## Benachrichtigungs-Umfänge (Scope)

In den Einstellungen kannst du zwischen drei Benachrichtigungs-Umfängen wählen:
* **Alle (`all`):** Sendet Benachrichtigungen für alle aktiven Kopfgelder im Spiel (ohne Länder-/Allianz-Filter).
* **Verbündete (`allies`):** Filtert nach Kopfgeldern für dein eigenes Land, deine Allianz-Mitglieder sowie deine direkten Verbündeten und Verteidigungspakte.
* **Kaskade (`cascade` - Standard):** Bezieht zusätzlich zu deinen eigenen Alliierten auch die Verbündeten und Verteidigungspakte aller anderen Mitgliedsländer deiner Allianz mit ein.

---

## Topic-Namensschema

Standardmäßig generiert das Script den ntfy-Topic-Namen vollautomatisch basierend auf deiner Identität im Spiel und dem ausgewählten Umfang:
* **Umfang `all`:** `wia-bounty-all`
* **Umfang `allies`:** `wia-bounty-{allianz}` (oder `wia-bounty-{land}`, wenn du in keiner Allianz bist).
* **Umfang `cascade`:** `wia-bounty-{allianz}-casc` (oder `wia-bounty-{land}-casc`, wenn du in keiner Allianz bist).

*Hinweis: Sonderzeichen in Länder- oder Allianznamen werden automatisch entfernt (z. B. wird aus `b.e.e.r.` -> `beer` -> `wia-bounty-beer-casc`).*

### Custom-Topic & Topic-Secrets
Wenn du ein eigenes Topic nutzen möchtest, kannst du dieses im Feld **ntfy-Topic (Basis)** eintragen.

Um zu verhindern, dass gegnerische Spieler dein Topic erraten und mitlesen, kannst du im Feld **Topic-Secret (optional)** einen geheimen Zusatz eintragen. Dieser wird an das Topic angehängt (z. B. `wia-bounty-beer-x7q2`), sodass nur Personen mit Kenntnis des Secrets die Benachrichtigungen empfangen können.

---

## Zentrales Verzeichnis (`wia-bounty-topics`)

Um genutzte Topics zu koordinieren, kündigt der Client sein genutztes Topic einmalig im Verzeichnis-Topic **`wia-bounty-topics`** an.

* **Schutz der Privatsphäre:** Das Script übermittelt nur das **Basis-Topic** (z. B. `wia-bounty-beer`) und **gibt dein Topic-Secret niemals im öffentlichen Log preis**.
* **Übertragene Daten:** Die Registrierungsnachricht enthält das Basis-Topic, dein Land/deine Allianz und den Aktivierungszeitstempel.
* **Anti-Spam:** Vor dem Senden prüft der Client die letzten 12 Stunden von `wia-bounty-topics` und überspringt die Registrierung, falls das Topic im Cache bereits als aktiv gemeldet wurde.

Unter [https://ntfy.sh/wia-bounty-topics](https://ntfy.sh/wia-bounty-topics) kannst du im Browser eine Liste aller aktiven Kopfgeld-Topics der Community einsehen.

---

## Abonnement-Anleitung

### 📱 Auf dem Smartphone (App)
1. Installiere die kostenlose **ntfy**-App auf deinem Handy:
   * **Android:** Download im [Google Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy) oder auf [F-Droid](https://f-droid.org/de/packages/io.heckel.ntfy/).
   * **iOS:** Download im [Apple App Store](https://apps.apple.com/de/app/ntfy/id1625396347).
2. Öffne die ntfy-App.
3. Tippe auf das **+** (Abonnement hinzufügen) Symbol.
4. Gib den Topic-Namen ein, der dir in den PROST-Einstellungen angezeigt wird (z. B. `wia-bounty-beer-casc` bzw. `wia-bounty-beer-casc-DEINSECRET`).
5. Tippe auf **Abonnieren**. Du erhältst nun sofort Push-Benachrichtigungen bei neuen Kopfgeldern!

### 💻 Auf dem PC (Web-Interface - kein Account benötigt)
Es ist keine Registrierung, App-Installation oder ein Account notwendig, um Benachrichtigungen auf dem PC zu erhalten.
1. Öffne deinen Browser und gehe auf `https://ntfy.sh/[DEIN_TOPIC]` (ersetze `[DEIN_TOPIC]` mit der Adresse, die dir in den PROST-Einstellungen angezeigt wird).
2. Klicke im Web-Interface auf den Button **Abonnieren** (Subscribe), um Web-Push-Meldungen zu aktivieren.
3. Stelle sicher, dass Browser-Benachrichtigungen für `ntfy.sh` zugelassen sind. Du erhältst nun Desktop-Popups bei aktiven Kopfgeldern.
