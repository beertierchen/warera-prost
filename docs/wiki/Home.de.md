> 🌐 [🇬🇧 English](Home) · **🇩🇪 Deutsch**

# 🍻 PROST Wiki

**P**ersonal **R**ecommendation **O**verlay & **S**upport **T**ool — eine Sammlung
clientseitiger [Userscripts](https://de.wikipedia.org/wiki/Userscript) für das
Browserspiel [**WareEra**](https://app.warera.io).

> **Prost! 🍺 Es hilft dir beim Spielen, es spielt nicht für dich.** Keine
> Automatisierung — jedes Overlay ist rein lesende Entscheidungshilfe.

## Funktionen

| Funktion | Was sie tut |
| --- | --- |
| [Inventory Advisor](Inventory-Advisor.de) | KEEP / HOLD / SELL / SCRAP-Empfehlung auf jeder Inventarkarte, inkl. Stat-Ranking und Schrott-vs-Markt-Preisleisten. |
| [Scrap-Flip-Indikator](Scrap-Flip-Indicator.de) | Markiert Equipment-Marktangebote, die sich zum Kaufen und Zerlegen (Schrott) lohnen. |
| [Battle Advisor](Battle-Advisor.de) | Hebt auf Kampfseiten den Button deiner Seite hervor und zeigt aktive Befehle inline an. |
| [Spieler-Notizen](Player-Notes.de) | Ein privates Notiz-Icon neben Spieler-Links, lokal gespeichert. |
| [Einstellungen & Spickzettel](Settings.de) | Zahnrad-Menü: Feature-Schalter, optionaler API-Token, Sprache (DE/EN) und ein In-App-Spickzettel. |

## Schnellstart

1. Userscript-Manager installieren (Tampermonkey / Violentmonkey).
2. PROST installieren — siehe **[Installation](Installation.de)**.
3. [WareEra](https://app.warera.io) öffnen, Inventar oder Equipment-Markt
   aufrufen und unten rechts auf das ⚙-Zahnrad klicken, um zu konfigurieren.

## Datenschutz & Sicherheit

- **Keine Automatisierung.** Overlays lesen und annotieren die Seite nur.
- Der optionale API-Token ist **dein** Zugang, lokal via `GM_setValue` gespeichert
  (leicht verschleiert — keine Verschlüsselung). Siehe [Einstellungen](Settings.de#api-token).
- Keine Daten verlassen deinen Browser, außer Aufrufen, die **du** an die
  offizielle Spiel-API und das öffentliche Stats-Gateway auslöst.

---

📖 Dieses Wiki wird aus [`docs/wiki/`](https://github.com/beertierchen/warera-prost/tree/main/docs/wiki)
im Haupt-Repo generiert und bei jeder Änderung an `main` automatisch
veröffentlicht. Bearbeite die Quelle dort, nicht das Wiki direkt.
