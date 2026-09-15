# cdp-browser-takeover

> Drive a real browser through the Chrome DevTools Protocol when the official
> API doesn't exist and your automation wrapper's daemon won't start.
> **Zero dependencies at the core** — Node ≥ 18 stdlib only.

## Why this exists

Some platform features ship **no API at all** — GitHub profile pins is the
canonical example (no GraphQL mutation, no REST endpoint; verified against the
live schema). And the moment you reach for browser automation, the wrapper
tooling fights you: daemons die in sandboxes, Chrome "fails" to bind a port it
actually bound on the other loopback.

This toolkit is the distilled escape path:

1. **Launch** Chrome yourself with a debugging port — `bin/cdp_launch.mjs`
   (stdlib-only) auto-discovers the binary, spawns it, probes **both**
   loopbacks (`[::1]` and `127.0.0.1`), and prints the real endpoint as JSON.
2. **Probe** any port to see what's actually listening — `bin/cdp_probe.mjs`
   (stdlib-only), so you never knock on the wrong loopback again.
3. **Operate** the web UI with Playwright-over-CDP — `bin/github_pins.mjs`
   automates GitHub's pin dialog end-to-end (`--login-check` mode for a safe
   dry run). Playwright-core is the repo's **single optional dependency**.

Every trap discovered along the way — daemon death, IPv6-vs-IPv4 loopback
squatting, GitHub's custom `<dialog class="Overlay">` modals, and
self-certifying verification — is documented with fixes in
**[TRAPS.md](TRAPS.md)**.

## Quickstart

```bash
# 1. launch (finds Chrome automatically, prints endpoint JSON)
node bin/cdp_launch.mjs --port 9333 --headed

# 2. probe (works even if step 1 was done by hand)
node bin/cdp_probe.mjs 9333 --targets

# 3a. check who is logged in (safe, read-only)
npm i playwright-core   # one-time, only needed for step 3
node bin/github_pins.mjs --http http://[::1]:9333 --user <login> --login-check

# 3b. pin repositories (you are already logged in inside that browser window)
node bin/github_pins.mjs --http http://[::1]:9333 --user <login> --pin repo-a,repo-b

# 4. VERIFY — always, via the API, never via page text
gh api graphql -f query='{ user(login:"<login>") { pinnedItems(first:6, types:REPOSITORY) { totalCount nodes { ... on Repository { name } } } } }'
```

## Design rules

- **Stdlib core, one optional dep.** Launch/probe never require npm install.
  Only DOM-driving scripts import `playwright-core`.
- **Credentials never pass through the tool.** You log in yourself, in a
  visible window. The tool reads login *state* (a meta tag), never secrets.
- **Verify out-of-band.** Web-UI writes are confirmed through an independent
  channel (API reads), because page-text checks self-certify. See TRAPS.md.
- **Sessions persist.** A fixed `--user-data-dir` means one login, reusable.

## Verified case

Used to pin 6 repositories on a live GitHub profile end-to-end (login check →
dialog traversal → save → GraphQL re-verification, 6/6) on 2026-09-15, after
four wrapper-daemon launch strategies failed in the same environment.

## Collaboration

- **Who**: teams building browser-automation or agent tooling that must
  survive sandboxed hosts, and anyone automating no-API platform features.
- **What I can bring**: CDP takeover hardening for your host environment,
  additional no-API workflow scripts in this repo's style, audits of your
  automation stack's failure modes.
- **How to reach**: open an [issue](../../issues) or email
  **shanlun2029@outlook.com**.

## License

MIT — see [LICENSE](LICENSE).
