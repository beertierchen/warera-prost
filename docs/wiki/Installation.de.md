> 🌐 [🇬🇧 English](Installation) · **🇩🇪 Deutsch**

# 📥 Installation

PROST ist ein [Userscript](https://de.wikipedia.org/wiki/Userscript) und benötigt einen
Userscript-Manager im Browser.

> ⚠️ **Open Beta.** Rechne mit Ecken und Kanten: kann langsam oder ungenau sein, und
> ein WareEra-UI-Update kann die Erkennung vorübergehend lahmlegen, bis PROST
> nachgezogen wird. Es liest und annotiert die Seite nur - keine Automatisierung.

## 1. Userscript-Manager installieren

- **[Tampermonkey](https://www.tampermonkey.net/)** (Chrome, Edge, Firefox, Safari) - empfohlen
- **[Violentmonkey](https://violentmonkey.github.io/)** (Chrome, Edge, Firefox)

## 2. PROST installieren

Über **[Greasy Fork](https://greasyfork.org/de/scripts/583766-prost)** installieren -
„Diese Version installieren" anklicken; der Userscript-Manager übernimmt den Rest und
liefert künftige Updates automatisch.

**Manuell - aus dem Repo:** Die [Raw-Datei `warera-prost.user.js`](https://github.com/beertierchen/warera-prost/raw/main/warera-prost.user.js)
öffnen; der Manager bietet die Installation an - bestätigen.

## 3. Loslegen

1. [WareEra](https://app.warera.io) öffnen.
2. Dein Inventar oder den Equipment-Markt aufrufen.
3. Unten rechts auf das ⚙-Zahnrad klicken, um Funktionen zu konfigurieren - siehe
   [Einstellungen](Settings.de). Der Punkt am Zahnrad zeigt die Datenfrische
   (grün = aktuell, orange = veraltet, rot = Rate-Limit).

## Fehlerbehebung

<a id="fehlerbehebung"></a>

**Chrome / Edge: Fehler „Allow User Scripts"**

Auf aktuellem Chrome/Edge (Manifest V3) zeigt Tampermonkey ggf.:

> Please enable the "Allow User Scripts" extension setting. Click here for more info how to do this.

Einmalig beheben:

1. `chrome://extensions` öffnen (Edge: `edge://extensions`).
2. **Tampermonkey → Details** öffnen.
3. **Allow User Scripts / Benutzerskripts zulassen** einschalten. (Auf älteren
   Chrome-Versionen gibt es den Schalter nicht - dann oben rechts den
   **Entwicklermodus** aktivieren.)
4. WareEra neu laden.

Details in der [Tampermonkey-FAQ](https://www.tampermonkey.net/faq.php#Q209).

> 📷 _Screenshot folgt:_ `images/chrome-allow-userscripts.png` _- der Schalter „Allow User Scripts" in Tampermonkeys Details-Seite._

**Weitere Checks**

- Das Skript ist im Manager-Dashboard **aktiviert** (eingeschaltet).
- Richtige Domain: `app.warera.io`.
- Beim ersten API-Aufruf die **`@connect`-Berechtigungen** bestätigen
  (`api2.warera.io`, `gateway.warerastats.io`).
- **Hängt nach einem Release auf alter Version?** Greasy Fork kann kurz verzögern.
  Erzwingen: Tampermonkey-Dashboard → PROST → **Auf Userscript-Updates prüfen**.

## Updates

Über Greasy Fork installierte Scripts werden vom Userscript-Manager automatisch
aktualisiert. Die jeweils aktuelle Version steht im
[CHANGELOG](https://github.com/beertierchen/warera-prost/blob/main/CHANGELOG.md).

## Optional: API-Token

Die meisten Funktionen laufen ohne Einrichtung. Für frische Markt- und Schrottpreise
trägst du deinen eigenen WareEra-API-Token in den [Einstellungen](Settings.de#api-token)
ein. Er bleibt auf deinem Rechner.

> ⚠️ Behandle den Token wie ein Passwort. Bei Verdacht auf Kompromittierung in WareEra
> widerrufen/erneuern.

Siehe auch: [Home](Home.de) · [Einstellungen](Settings.de)
