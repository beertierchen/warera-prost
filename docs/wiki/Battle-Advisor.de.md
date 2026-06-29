> 🌐 [🇬🇧 English](Battle-Advisor) · **🇩🇪 Deutsch**

# ⚔️ Battle Advisor

Hebt auf Kampfseiten (`/battle/<id>`) den Button **deiner** Seite hervor und blendet
die aktiven Befehle (Orders) kompakt direkt im Button ein. Experimentell.

![Battle-Seite: DEFEND-Button hervorgehoben mit verbündeten Flaggen, ATTACK-Seite gedimmt](images/battle-advisor.png)

## Was du siehst

- **Hervorgehobener Button:** grüner Rahmen, leicht vergrößert - das ist die Seite,
  auf der du kämpfen solltest.
- **Gedimmte Seite:** abgeschwächt und entsättigt (Graustufen).
- **Inline-Befehle:** kleine Flaggen/Symbole im Button zeigen die aktuell aktiven
  Orders (von Land **oder** Militäreinheit) für diese Seite.

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
