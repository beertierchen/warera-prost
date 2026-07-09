# ⚔️ Bounty-Push-Benachrichtigungen (ntfy.sh)

Das Feature **Bounty-Push-Benachrichtigungen** ist ein Hintergrunddienst (Poller), der in WareEra-Schlachten nach aktiven verbündeten Kopfgeld-Zahlungen sucht und sofortige Push-Benachrichtigungen auf dein Smartphone oder deinen Desktop-Browser sendet. Hierzu wird der kostenlose Open-Source-Dienst [ntfy.sh](https://ntfy.sh) verwendet.

---

## Funktionsweise

1. **Hintergrund-Abfragen & Veröffentlichung:** Das Script fragt alle 30 Sekunden im Hintergrund die aktiven Schlachten ab und veröffentlicht neue Kopfgelder auf den öffentlichen Länder- und Allianz-Topics (z. B. `wia-bounty-{allianz}-casc`).
2. **Spiegelung auf dein persönliches Topic:** Ein Cross-Tab-Poller prüft im Hintergrund alle 3 Sekunden das öffentliche Topic, filtert die Kopfgelder basierend auf deinem eingestellten **Benachrichtigungs-Umfang** und spiegelt die zutreffenden Meldungen auf dein **Persönliches Topic** (z. B. `wia-user-{userId}`).
3. **Tab-Deduplizierung & Sperren:** Wenn du WareEra in mehreren Browser-Tabs geöffnet hast, sorgt eine tabübergreifende Sperre (Lock) dafür, dass immer nur ein einziger Tab die Topics pollt und Spiegelfunktionen ausführt.
4. **Lokale Anzeige (In-Game-Popup & Browser-Notif):** Zusätzlich zum ntfy-Push wird die Erkennung sofort im Spiel als In-Game-Toast oben mittig angezeigt (8s Dauer, Klick navigiert zur Schlacht) sowie als native Desktop-Benachrichtigung des Browsers ausgegeben.

---

## Benachrichtigungs-Umfänge (Scope)

In den Einstellungen kannst du festlegen, welche Kopfgelder auf dein persönliches Topic gespiegelt werden sollen:
* **Alle (`all`):** Spiegelt alle aktiven Kopfgelder im Spiel auf dein persönliches Topic.
* **Verbündete (`allies`):** Spiegelt nur Kopfgelder für dein eigenes Land, deine Allianz-Mitglieder sowie direkte Verbündete und Verteidigungspakte.
* **Kaskade (`cascade` - Standard):** Bezieht zusätzlich zu deinen Alliierten auch die Verbündeten und Verteidigungspakte aller anderen Mitgliedsländer deiner Allianz mit ein.

---

## Persönliches Topic (ntfy.sh)

Um deine Push-Meldungen zu empfangen, konfiguriert PROST ein eigenes persönliches Empfänger-Topic.

* **Persönliches ntfy-Topic:** Standardmäßig `wia-user-{deineSpielerId}`. Dies ist das Topic, das du auf deinen Geräten (Handy/PC) abonnierst.
* **Topic-Secret (optional):** Um zu verhindern, dass Dritte dein Topic erraten, kannst du ein Secret (z. B. `geheimnis123`) hinzufügen. Die Benachrichtigungen werden dann an das Topic `wia-user-{deineSpielerId}-geheimnis123` gesendet.
* **Komfort-Link:** Direkt in den Einstellungen unter dem Topic-Feld befindet sich ein klickbarer Link, der dich sofort zu deinem eingerichteten ntfy-Topic führt, um es im Browser zu abonnieren.

---

## Zentrales Verzeichnis (`wia-bounty-topics`)

Um genutzte Community-Topics zu koordinieren, kündigen die Clients ihre genutzten Allianz-/Länder-Topics im Verzeichnis **`wia-bounty-topics`** an.

* **Schutz der Privatsphäre:** Es wird nur das öffentliche **Basis-Topic** (z. B. `wia-bounty-beer`) registriert. **Dein persönliches Topic oder Secret wird niemals im öffentlichen Verzeichnis preisgegeben.**
* **Anti-Spam:** Vor der Ankündigung wird die Historie geprüft, um doppelte Registrierungen innerhalb von 12 Stunden zu vermeiden.

---

## Abonnement-Anleitung

### 📱 Auf dem Smartphone (App)
1. Installiere die kostenlose **ntfy**-App auf deinem Handy:
   * **Android:** Download im [Google Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy) oder auf [F-Droid](https://f-droid.org/de/packages/io.heckel.ntfy/).
   * **iOS:** Download im [Apple App Store](https://apps.apple.com/de/app/ntfy/id1625396347).
2. Öffne die ntfy-App und tippe auf das **+** (Abonnement hinzufügen) Symbol.
3. Gib dein persönliches ntfy-Topic ein, das in den PROST-Einstellungen angezeigt wird (z. B. `wia-user-69fa68...` bzw. `wia-user-69fa68...-DEINSECRET`).
4. Tippe auf **Abonnieren**. Du erhältst nun alle Kopfgelder (sowie Pill-Reminder-Notifikationen) direkt als Push-Meldung!

### 💻 Auf dem PC (Web-Interface - kein Account benötigt)
1. Klicke in den PROST-Einstellungen auf den Link unter deinem persönlichen Topic oder öffne direkt `https://ntfy.sh/wia-user-[DEINE_ID]-[OPTIONALES_SECRET]`.
2. Klicke im ntfy-Webinterface auf **Abonnieren** (Subscribe), um Web-Push-Meldungen zu aktivieren.
3. Erlaube dem Browser Benachrichtigungen für `ntfy.sh`. Du erhältst nun Desktop-Popups bei aktiven Kopfgeldern.
