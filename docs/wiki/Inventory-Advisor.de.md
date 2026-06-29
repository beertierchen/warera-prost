> 🌐 [🇬🇧 English](Inventory-Advisor) · **🇩🇪 Deutsch**

# 🎒 Inventory Advisor

Legt auf jede Inventarkarte ein Overlay mit einer Empfehlung - **KEEP**, **HOLD**,
**SELL** oder **SCRAP** - und zeigt dazu Stat-Wert sowie Schrott- und Marktpreis.
Rein lesend, keine Automatisierung.

![Inventory-Advisor-Overlays auf Waffen- und Rüstungskarten](https://raw.githubusercontent.com/beertierchen/warera-prost/main/docs/wiki/images/itemadvisor.gif)

## Empfehlungen (Farbe + Symbol)

| Symbol | Empfehlung | Bedeutung |
| --- | --- | --- |
| 💎 | **KEEP** (Blau) | Behalten. Greift bei deinen Top-3-Beständen (je Typ/Tier) oder wenn das Item im obersten Drittel (Top Roll, Top 33 %) der Live-Angebote bzw. deines Inventars liegt. |
| ✋ | **HOLD** (Orange) | Zurückhalten/reservieren. Item liegt in den besten 10 % der theoretisch möglichen Stat-Spanne (Top Itemscore). Wird nur vergeben, wenn nicht ohnehin 💎 KEEP. |
| 💰 | **SELL** (Grün) | Auf dem Markt verkaufen. Netto-Marktpreis (abzüglich 1 % Steuer) liegt über dem Schrottwert. |
| 🔨 | **SCRAP** (Rot) | Zerlegen/verschrotten. Schrottwert liegt über dem Netto-Marktpreis. |

Ein **gestrichelter weißer Rand** um das Badge bedeutet: die Empfehlung ist
**vorläufig** — Preise/Marktdaten werden noch geladen und können sich ändern.

## Overlays auf den Karten

PROST reserviert einen schmalen Streifen **über und unter** jeder Karte, sodass
die Overlays in einem eigenen Band liegen und die nativen Stats nicht mehr verdecken.

- **Oben links — Score-Pille:** Rüstungs-Stat bzw. Waffen-Score.
  - *Blauer Hintergrund* = Top 3 im Bestand (Stock Keep).
  - *Grau* = normal.
- **Oben rechts — Empfehlungs-Badge:** das Symbol 💎 / ✋ / 💰 / 🔨 von oben.
- **Unten — Preis-Streifen** (`🔨 [Schrottwert] / 💰 [Marktpreis]`):
  - *Grüner Hintergrund* = Verschrotten ist besser.
  - *Oranger Hintergrund* = Verkaufen ist besser.

## Skins & Haltbarkeit

- **Geskinnte Ausrüstung wird erkannt** und wie das Basis-Item bewertet - ein
  Waffen-/Rüstungs-Skin versteckt die Empfehlung nicht mehr.
- **Haltbarkeit** wird direkt aus dem Fortschrittsbalken des Items gelesen.

## Hinweise

- **Ausgerüstete Items** (Badge „Equip.") und Items unter 100 % Haltbarkeit
  erhalten keine Verkaufs-/Schrott-Empfehlung - ihr Wert ist nicht mit einem
  frischen Angebot vergleichbar.
- Items in **Charakter-Profil**-Slots werden ausgenommen, und der gesamte
  **Shop** (`/shop/…`) wird übersprungen, damit nur dein handelbares Inventar
  annotiert wird.

## Preis-Frische

Preise stammen aus zwischengespeicherten Marktdaten und (optional) der Live-API.
Der Punkt am ⚙-Zahnrad zeigt die Frische; in den [Einstellungen](Settings.de)
aktualisieren oder einen [API-Token](Settings.de#api-token) für Live-Werte hinterlegen.

Siehe auch: [Scrap-Flip-Indikator](Scrap-Flip-Indicator.de) ·
[Einstellungen](Settings.de)
