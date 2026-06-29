> 🌐 [🇬🇧 English](Home) · **🇩🇪 Deutsch**

# 🍻 PROST Wiki

**P**ersonal **R**ecommendation **O**verlay & **S**upport **T**ool - eine Sammlung
clientseitiger [Userscripts](https://de.wikipedia.org/wiki/Userscript) für das
Browserspiel [**WareEra**](https://app.warera.io).

> **Prost! 🍺 Es hilft dir beim Spielen, es spielt nicht für dich.** Keine
> Automatisierung - jedes Overlay ist rein lesende Entscheidungshilfe.

> ⚠️ **Open Beta.** PROST ist in aktiver Entwicklung - es kann langsam, ungenau
> oder gelegentlich fehlerhaft sein; Empfehlungen sind Entscheidungshilfe,
> **keine Garantie**. Da es sich vollständig an die **Oberfläche von WareEra**
> hängt, kann ein Spiel-Update die Erkennung lahmlegen, bis PROST nachgezogen
> wird. Problem gefunden?
> [Issue öffnen](https://github.com/beertierchen/warera-prost/issues).

## Funktionen

| Funktion | Was sie tut |
| --- | --- |
| [Inventory Advisor](Inventory-Advisor.de) | KEEP / HOLD / SELL / SCRAP-Empfehlung auf jeder Inventarkarte, inkl. Stat-Ranking, Schrott-vs-Markt-Leisten, Skin-/Ausrüstungserkennung und Haltbarkeit. |
| [Scrap-Flip-Indikator](Scrap-Flip-Indicator.de) | *Experimentell.* Markiert Equipment-Marktangebote, die sich zum Kaufen und Zerlegen (Schrott) lohnen. |
| [Täglicher P&L Tracker](Daily-PnL-Tracker.de) | Täglicher Gewinn/Verlust in der Topbar neben deinem Gold, inkl. automatisch gebuchter Verschleiß-(Reparatur-)Kosten. Standardmäßig an. |
| [Ressourcen-Markt-Graph](Market-Graph.de) | *Experimentell.* Intraday-Preisverlauf (24h/3d) im Kauf-/Verkaufs-Modal von Ressourcen. |
| [Crafting-Rechner](Crafting-Calculator.de) | *Experimentell.* Profit-Schätzung fürs Herstellen - Ressourcenkosten vs. Marktwert. |
| [Battle Advisor](Battle-Advisor.de) | *Experimentell.* Hebt auf Kampfseiten den Button deiner Seite hervor und zeigt aktive Befehle inline. |
| [Pill Reminder](Pill-Reminder.de) | *Experimentell.* Topbar-Status + Countdown für den Pillen-Zyklus, mit HP-/Hunger-Prüfung. |
| [Spieler-Notizen](Player-Notes.de) | *Experimentell.* Privates Notiz-Icon neben Spieler-Links, lokal gespeichert. |
| [Diagnose](Diagnostics.de) | Feature-Health-Panel, Scan-Performance-Ampel und Debug-Dump. |
| [Einstellungen & Spickzettel](Settings.de) | Zahnrad-Menü: Feature-Schalter, optionaler API-Token, Sprache (DE/EN) und ein In-App-Spickzettel. |

## Schnellstart

1. Userscript-Manager installieren (Tampermonkey / Violentmonkey).
2. PROST installieren - siehe **[Installation](Installation.de)**.
3. [WareEra](https://app.warera.io) öffnen, Inventar oder Equipment-Markt
   aufrufen und unten rechts auf das ⚙-Zahnrad klicken, um zu konfigurieren.

Probleme bei Installation oder nichts zu sehen? Siehe **[Installation → Fehlerbehebung](Installation.de#fehlerbehebung)**.

## Datenschutz & Sicherheit

- **Keine Automatisierung.** Overlays lesen und annotieren die Seite nur.
- Der optionale API-Token ist **dein** Zugang, lokal via `GM_setValue` gespeichert
  (leicht verschleiert - keine Verschlüsselung). Siehe [Einstellungen](Settings.de#api-token).
- Keine Daten verlassen deinen Browser, außer Aufrufen, die **du** an die
  offizielle Spiel-API und das öffentliche Stats-Gateway auslöst.

---

📖 Dieses Wiki wird aus [`docs/wiki/`](https://github.com/beertierchen/warera-prost/tree/main/docs/wiki)
im Haupt-Repo generiert und bei jeder Änderung an `main` automatisch
veröffentlicht. Bearbeite die Quelle dort, nicht das Wiki direkt.
