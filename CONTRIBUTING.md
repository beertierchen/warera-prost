# Contributing to PROST 🍻

Thanks for helping out! PROST is a single WareEra userscript that grows by adding self-contained modules. Contributions of any size are welcome.

## Ground rules

- **No automation.** PROST never plays the game for the user. PRs that click, trade, or automate gameplay will be rejected. It must stay a passive visual/advice overlay.
- **Client-side only.** No external servers beyond the official WareEra API (with the user's own key) and the price gateway already declared in `@connect`.
- **Respect privacy.** Never log, transmit, or store a user's API token anywhere but local `GM_setValue`.

## Project layout

```
warera-prost.user.js               # the one script — inventory advice, scrap-flip, notes, …
warera-notes.user.js               # legacy standalone notes script (no longer actively developed)
tests/                             # node test harness with Tampermonkey API mocks
docs/wiki/                         # GitHub Wiki source (EN + *.de.md), images in docs/wiki/images/
scripts/publish-wiki.sh            # mirrors docs/wiki/ → the GitHub Wiki repo
.github/workflows/publish-wiki.yml # auto-publishes the wiki on push to main
CHANGELOG.md
```

**One script, no build step.** PROST is intentionally a single plain `.user.js` file. Greasy Fork requires fully readable, unminified code, and Tampermonkey needs no bundler. There is no `/src` split planned.

New features are added as **self-contained modules** inside the main IIFE:
- Add a `CONFIG` flag (`featMyThing: false`) and a `KEYS` entry to persist it.
- Implement `initMyThing()` / `teardownMyThing()` functions.
- Wire the toggle into the settings modal and `start()`.
- Keep styles inside `injectStyles()`.

## Workflow

1. Fork and branch from `main`: `git checkout -b feat/my-feature`.
2. Make your change. Keep the userscript metadata block (`// ==UserScript== ...`) intact.
3. Bump `@version` in the script header **and** `version` in `package.json` ([SemVer](https://semver.org)).
4. Add an entry to `CHANGELOG.md`.
5. Run the tests: `npm test`.
6. Open a PR against `main` with a clear description. Squash-merge is preferred.

## Documentation (Wiki)

The [GitHub Wiki](https://github.com/beertierchen/warera-prost/wiki) is **generated**, not edited directly.

- **Source of truth:** `docs/wiki/`. Edit the `.md` there in a normal PR.
- **Bilingual:** every page exists as `Page.md` (EN) and `Page.de.md` (DE). Keep both in sync; images are language-neutral and live once in `docs/wiki/images/`.
- **Publishing:** on push to `main`, `.github/workflows/publish-wiki.yml` mirrors `docs/wiki/` into the wiki via `scripts/publish-wiki.sh`. Editing the wiki on GitHub directly will be overwritten on the next sync.
- **One-time setup:** GitHub creates the wiki repo only after the first page is saved in the Wiki tab UI. Create any page once; the script/workflow sync over it afterwards.
- **Local publish:** `GIT_TOKEN="$(gh auth token)" bash scripts/publish-wiki.sh`.

## Testing

```bash
npm test   # runs tests/test-advisor-load.js (mocks GM_* APIs)
```

Manual check: install your branch's `.user.js` in Tampermonkey and verify on [app.warera.io](https://app.warera.io). WareEra ships dynamically-generated CSS class names,prefer resilient DOM selectors (text/structure) over brittle class names.

## Releases

Maintainer tags releases as `vX.Y.Z` on `main`. Userscript managers pick up the new `@version` via `@updateURL` automatically.
