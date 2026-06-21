# AGENTS.md

Standing instructions for AI coding agents working in this repo (tool-neutral —
Claude Code, Codex, Copilot, Gemini, etc. all read this).

## Project

Client-side userscripts for the browser game [WareEra](https://app.warera.io).
No automation — every feature is read-only decision support.

- `warera-prost.user.js` — main script (PROST suite).
- `warera-notes.user.js` — standalone player-notes script.
- `tests/test-advisor-load.js` — load + unit smoke tests. Run: `npm test`.

## Wiki maintenance (read before touching features or docs)

The GitHub Wiki is **generated from `docs/wiki/` in this repo** and auto-published
by `.github/workflows/publish-wiki.yml` (which runs `scripts/publish-wiki.sh`) on
every push to `main` that touches `docs/wiki/**`.

Rules:

1. **Source of truth is `docs/wiki/` — never edit the GitHub Wiki directly.**
   Direct wiki edits are overwritten on the next publish.
2. **Bilingual parity is mandatory.** Every page exists twice: `Page.md` (English)
   and `Page.de.md` (German). When you change one, change the other in the same
   commit. Keep the language switcher line at the top of each page intact.
3. **Screenshots are language-neutral.** Store once in `docs/wiki/images/`; both
   languages reference the same files. Don't duplicate per language.
4. **Whenever you add or change a user-facing feature in `warera-prost.user.js`,
   update the matching wiki page(s) — EN *and* `.de` — in the same change.**

   | Feature / code area | Wiki page |
   | --- | --- |
   | KEEP/HOLD/SELL/SCRAP advice, inventory overlays | `Inventory-Advisor` |
   | Scrap-flip market badges (`computeScrapFlip`, `showScrapFlip`) | `Scrap-Flip-Indicator` |
   | Battle highlight + compact orders (`detectAllySide`, battle advisor) | `Battle-Advisor` |
   | Player notes (`featNotes`, note icon/modal) | `Player-Notes` |
   | Settings modal, toggles, cheat sheet, API token | `Settings` |
   | Install / update / token setup | `Installation` |

5. **Publishing:** normally automatic via the workflow on merge to `main`. To
   publish manually: `GIT_TOKEN="$(gh auth token)" bash scripts/publish-wiki.sh`.
   **One-time prerequisite:** GitHub provisions `<repo>.wiki.git` only after the
   first page is created in the web UI (a push to a never-used wiki returns
   "Repository not found"). Create one page once at the repo's Wiki tab; after
   that the script/workflow clone-and-sync normally.

> This is a prompt-level rule, not an enforced gate. If feature/doc drift becomes
> a recurring problem, add a CI check that fails when feature code changes without
> a corresponding `docs/wiki/**` change.

## General

- Keep all brittle game-markup assumptions (selectors, colors, layout) in the
  `CONFIG` block of the userscript — edit `CONFIG` first when the game's markup
  changes, not the logic.
- Run `npm test` before committing changes to the userscripts.
