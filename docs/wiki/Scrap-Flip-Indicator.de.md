> 🌐 [🇬🇧 English](Scrap-Flip-Indicator) · **🇩🇪 Deutsch**

# ♻️ Scrap-Flip-Indikator

Markiert auf dem **Equipment-Markt** Angebote, die sich zum Kaufen und sofortigen
Zerlegen lohnen: Wenn der Netto-Schrotterlös über dem Kaufpreis liegt, ist das Item
ein „Flip". Experimentelles Feature, standardmäßig aus.

## Was du siehst

- Ein grünes Band am unteren Rand der Kachel sowie ein grüner Rahmen markieren
  profitable Angebote.
- Negative bzw. nicht profitable Kandidaten werden grau dargestellt.
- Der Tooltip zeigt die Rechnung:

  > `Kauf {buy} → Scrap {yield}×{unit} netto {net} = +{profit} Gewinn`

  Also: Kaufpreis → erwartete Schrottmenge × Schrott-Stückpreis, abzüglich Steuer,
  ergibt den Netto-Gewinn.

## Warum manchmal nichts markiert wird

- **Sicherheits-Marge auf Grid-Preise:** Marktraster-Preise sind ungenau gerundet.
  Eine Marge (`scrapFlipGridMargin`) inflationiert den angenommenen Kaufpreis leicht,
  um falsch-positive Flip-Signale durch zu optimistische Rasterpreise zu vermeiden.
- Ohne [API-Token](Settings.de#api-token) basiert die Schrottbewertung auf
  zwischengespeicherten/gescrapten Preisen und kann veralten.

## Aktivieren

Zahnrad ⚙ → **Scrap-Flip-Indikator (experimentell)** einschalten. Wirkt auf der
Seite `/market/equipments`.

Siehe auch: [Inventory Advisor](Inventory-Advisor.de) ·
[Einstellungen](Settings.de)
