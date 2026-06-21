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

## Testing

```bash
npm test   # runs tests/test-advisor-load.js (mocks GM_* APIs)
```

Manual check: install your branch's `.user.js` in Tampermonkey and verify on [app.warera.io](https://app.warera.io). WareEra ships dynamically-generated CSS class names,prefer resilient DOM selectors (text/structure) over brittle class names.

## Releases

Maintainer tags releases as `vX.Y.Z` on `main`. Userscript managers pick up the new `@version` via `@updateURL` automatically.
