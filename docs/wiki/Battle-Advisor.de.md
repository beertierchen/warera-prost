> 🌐 [🇬🇧 English](Battle-Advisor) · **🇩🇪 Deutsch**

# ⚔️ Battle Advisor

Hebt auf Kampfseiten (`/battle/<id>`) den Button **deiner** Seite hervor und blendet
die aktiven Befehle (Orders) kompakt direkt im Button ein. Experimentell.

![Battle-Seite: DEFEND-Button hervorgehoben mit verbündeten Flaggen, ATTACK-Seite gedimmt](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/battle-advisor.png)

## Was du siehst

- **Hervorgehobener Button:** grüner Rahmen, leicht vergrößert - das ist die Seite,
  auf der du kämpfen solltest.
- **Gedimmte Seite:** abgeschwächt und entsättigt (Graustufen).
- **Inline-Befehle:** kleine Flaggen/Symbole im Button zeigen die aktuell aktiven
  Orders (von Land **oder** Militäreinheit) für diese Seite.

![Kampfbefehl-Tooltip](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/Fighting_Tooltip.png)

## Order-Radar (Banner-Leiste)

Auf **Länder-** (`/country/<id>`) und **Militäreinheiten-Seiten** (`/mu/<id>`) bettet PROST eine dynamische **Order-Radar-Leiste** unten rechts im Header-Banner ein.

![Order-Radar auf der Länderseite](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/order-radar-country.png)

![Order-Radar auf der Militäreinheiten-Seite](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/order-radar-mu.png)

### Hauptfunktionen:
- **Prioritäts-Fadenkreuze**: Farbige Zielscheiben-Icons markieren die gesetzte Priorität des Befehls (`🔴 Rot = Hoch`, `🟡 Gelb = Mittel`, `🟢 Grün = Niedrig`).
- **Live-Matchup & Stats**: Zeigt die Kontrahenten (`🇧🇫 › 🇳🇬`), Zielregion, Ratio-Prozentbalken, Rundenpunkte (`⛰`) und Kopfgeld-Prämien (`💰`).
- **4-Stufen Responsive Layout**: Schrumpft automatisch basierend auf der verfügbaren Fensterbreite:
  - **Vollständig (>= 750px)**: Komplette Zeile mit allen Details.
  - **Ohne Region (580px – 749px)**: Blendet die Region aus, um Überlappungen mit Banner-Texten zu vermeiden.
  - **Minimal (440px – 579px)**: Zeigt Zielscheibe, Flaggen und Prozentbalken.
  - **Icon-Only (< 440px)**: Kompakte runde Fadenkreuz-Badges.
- **Sofortiger Route-Purge**: Entfernt veraltete Leisten beim Wechsel zwischen Ländern oder MUs sofort ohne Verzögerung.

## Wie die Seite bestimmt wird

1. **Primär:** Die Seite, deren Länder-Code in deiner Liste verbündeter Länder steht,
   wird hervorgehoben.
2. **Fallback:** Hat eine Seite Befehle (von Land oder MU), gilt diese Seite als
   temporärer Verbündeter **für diesen Kampf** und wird hervorgehoben - auch wenn das
   Land nicht in deiner Verbündeten-Liste steht.
3. Haben **beide** oder **keine** Seite eindeutig Orders/Verbündete, wird nichts
   geraten (keine Hervorhebung).

> Befehle = impliziter Verbündeter nur für diesen Kampf. Deine konfigurierte
> Verbündeten-Liste bleibt die primäre Quelle.

## Aktivieren & konfigurieren

Zahnrad ⚙ → **Battle-Advisor ⚔️ (experimentell)** einschalten. Darunter erscheint das
Feld **Verbündete Ländercodes** (komma-getrennt, kleingeschrieben, z. B. `de,pt`).

Siehe auch: [Einstellungen](Settings.de)
