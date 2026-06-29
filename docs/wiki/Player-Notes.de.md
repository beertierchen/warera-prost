> 🌐 [🇬🇧 English](Player-Notes) · **🇩🇪 Deutsch**

# 📒 Spieler-Notizen

Fügt neben Spieler-Links ein Notiz-Icon hinzu. Ein Klick öffnet einen Dialog, in dem
du dir eine private Notiz zu diesem Spieler speichern kannst - lokal in deinem Browser.
Experimentell.

![Spieler-Notizen Ablauf](/images/user_notes.gif)

## Bedienung

- Neben einem Spieler-Link erscheint ein 📒-Icon. Hat der Spieler bereits eine Notiz,
  ist das Icon hervorgehoben.
- Klick auf das Icon öffnet den Notiz-Dialog **„Notiz: \<Spieler\>"** mit Textfeld und
  den Schaltflächen **Löschen**, **Abbrechen** und **Speichern**.

## Hinweise

- Notizen liegen **nur lokal** (via `GM_setValue`) und werden nirgends übertragen.
- **Konflikt vermeiden:** Wenn du zusätzlich das eigenständige *Warera User Notes*-Script
  betreibst, deaktiviere diese Funktion hier, damit nicht zwei Notiz-Icons erscheinen.

## Aktivieren

Zahnrad ⚙ → **Spieler-Notizen 📒 (experimentell)** einschalten.

Siehe auch: [Einstellungen](Settings.de)
