> 🌐 [🇬🇧 English](Company-Advisor) · **🇩🇪 Deutsch**

# Firmen-Berater

Der **Firmen-Berater** integriert Echtzeit-Wirtschaftsdaten direkt in deine Firmenübersicht (`/companies`). Er hilft dir dabei, die Produktion zu optimieren und Probleme auf einen Blick zu erkennen, ohne die Seite zu verlassen.

## Economy-Badges

PROST fügt jeder deiner Firmen zwei kleine Badges hinzu:

1. **Täglicher Gewinn**: Schätzt den täglichen Nettogewinn (z.B. `+17.8/d`) basierend auf dem Marktpreis des produzierten Items, den Materialkosten und dem aktuellen Level deiner automatisierten Fabrik. *Hinweis: Löhne für Mitarbeiter werden nicht abgezogen.*
2. **Lagerkapazität**: Zeigt die verbleibende Zeit, bis das Firmenlager voll ist (`FULL`, `4.2h`, oder `1.5d`).

## Eco Alerts

PROST überwacht kritische Firmenparameter und hebt sie durch farblich markierte Warnungen hervor:
- **Produktionsbonus**: Warnt dich, wenn der regionale Produktionsbonus niedrig ist oder fehlt.
- **Steuern**: Weist auf hohe Steuern im jeweiligen Land hin.
- **Rohstoff-Vorkommen**: Zeigt für Rohstofffirmen die verbleibende Dauer der Vorkommen an (die Warnung wird gelb oder rot, je näher die Erschöpfung rückt).

## Voraussetzungen
- Diese Funktion arbeitet automatisch und lädt Marktpreise und Steuern über die öffentliche API.
- Du musst in den [Einstellungen](Settings.de) einen API-Key hinterlegen, damit die Daten zuverlässig abgerufen werden können.
