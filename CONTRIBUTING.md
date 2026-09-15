# Contributing to cdp-browser-takeover

Thanks for your interest. This repo automates **no-API** platform features by
driving a real browser through CDP. Before you open a PR, read the design
rules — they are what keeps this toolkit honest.

## Design rules (non-negotiable)

1. **Stdlib first.** Anything that only needs HTTP (`/json/version`,
   `/json/list`, `/json/new`) or a WebSocket must stay dependency-free. Only
   scripts that need full DOM interaction may import `playwright-core`, and
   they must degrade with a clear error message when it's absent.
2. **Credentials never pass through the tool.** Login happens in a visible
   window, by the user. Scripts read login *state* (`meta[name="user-login"]`),
   never secrets.
3. **Verify out-of-band.** Every web-UI write must be verifiable through an
   independent channel (GraphQL/REST read, unauthenticated page fetch). If no
   independent channel exists, say so loudly in the script header — page-text
   matching is self-certification and will be rejected in review.
4. **Document the traps you hit.** New selector quirks, loopback surprises,
   dialog element oddities → add them to `TRAPS.md` in the same PR.
5. **Hard numbers, no vibes.** Test output prints counts that were actually
   counted. CI must stay green across the supported Node matrix.

## Adding a new automation script

1. Recon first: drive the target UI manually (or with a throwaway CDP session)
   and record the real DOM — element names, dialog classes, submit button
   classes. GitHub modals are usually `<dialog class="Overlay">`, and submit
   buttons carry stable classes (e.g. `.js-pinned-items-submit`).
2. Write the script in `bin/` following the style of `github_pins.mjs`:
   parse args, check login state, act via `page.evaluate()` DOM traversal,
   print JSON including a `verifyWith` hint.
3. Add a `--*-check` dry-run mode if any part of the flow is read-only — it
   makes CI and users' first runs safer.
4. Update the README script table and, if you hit new platform quirks,
   `TRAPS.md`.

## Running the tests

```bash
node --check bin/*.mjs && node --check tests/*.mjs   # syntax
node tests/smoke.mjs                                  # real-Chrome end-to-end
```

CI runs the same checks on Node 18 / 20 / 22 (Linux) and Node 22 (Windows)
on every push. PRs must keep it green.

## Issues

`good first issue` labels mark tasks with recon data already attached — start
there if you want to help close GitHub's API gaps.
