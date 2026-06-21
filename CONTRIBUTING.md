# Contributing to PROST 🍻

Thanks for helping out! PROST is a suite of WareEra userscripts. Contributions of any size are welcome.

## Ground rules

- **No automation.** PROST never plays the game for the user. PRs that click, trade, or automate gameplay will be rejected. It must stay a passive visual/advice overlay.
- **Client-side only.** No external servers beyond the official WareEra API (with the user's own key) and the price gateway already declared in `@connect`.
- **Respect privacy.** Never log, transmit, or store a user's API token anywhere but local `GM_setValue`.

## Project layout

```
warera-inventory-advisor.user.js   # main script (item advice, scrap-flip)
warera-notes.user.js               # notes overlay
tests/                             # node test harness with Tampermonkey API mocks
CHANGELOG.md
```

> Today each script is a single `.user.js` file. As the suite grows, we plan to move to a
> `src/` + small build (esbuild) layout with a feature-registry. If you're adding a large
> new overlay feature, open an issue first so we can coordinate that split.

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
