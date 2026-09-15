# TRAPS.md — every trap this toolkit exists for, in the order you'll hit them

All of these were hit and verified on a real Windows 11 + Git Bash + Node 22
setup (2026-09-15), while automating something GitHub deliberately does not
expose via API. The lessons are platform-agnostic.

## Trap 0: "The API just doesn't exist" — and that's not a permission problem

GitHub pins are a **product decision**, not a scope issue:

- GraphQL schema has **no `pinItem`-style mutation** (introspect it yourself:
  only `pinIssue` / `pinEnvironment` exist).
- REST has **no endpoint** at all.
- No scope upgrade (`user`, `admin`, anything) will make it appear.

Stop burning time on auth refreshes. Web UI automation is the only path. This
is true for a growing set of platform features — assume the gap before you
search for the endpoint.

## Trap 1: Your browser-automation wrapper daemon can be a dead end

Wrappers around Playwright/Puppeteer often run a **daemon** to hold the
browser. If that daemon is killed by your sandbox/AV/host (SIGTERM, empty
output, `Chrome exited early without writing DevToolsActivePort`), you can
burn hours on flags (`--no-sandbox`, managed Node on PATH, background runs)
that all fail the same way.

**Escape hatch**: the daemon is just a shell. Launch Chrome **yourself** with
a debugging port, and connect with a raw CDP client:

```bash
chrome.exe --remote-debugging-port=9333 --no-sandbox --disable-gpu \
  --user-data-dir=~/.cdp-browser-takeover/profile about:blank
```

`--user-data-dir` pinned to a fixed path means you log in **once** and the
session survives restarts.

## Trap 2: The port is up — on the other loopback

This one is pure poison. `Chrome` announces `DevTools listening on
ws://[::1]:9333` — **IPv6 loopback**. Meanwhile another process (a dev server,
an IDE helper) owns **IPv4 127.0.0.1:9333**. Every request to
`127.0.0.1:9333` reaches the *wrong process* and returns 404 or garbage, so
you conclude "Chrome failed to bind" — it didn't. You're knocking on the wrong
door.

**Rule**: never probe one loopback. Probe both, trust the one that answers
`/json/version`, and use the host that answered for the CDP connect URL:

```js
await chromium.connectOverCDP('http://[::1]:9333');   // not always 127.0.0.1
```

`bin/cdp_probe.mjs` does exactly this; `bin/cdp_launch.mjs` does it
automatically after spawn and reports the winning host in its JSON output.

## Trap 3: GitHub's dialogs are custom elements

Selectors that work on normal sites fail here:

| What you expect | What GitHub actually renders |
|---|---|
| `[role=dialog]`, `<dialog open>` | `<dialog class="Overlay">` (find it by content, e.g. contains "Save pins") |
| Button by label text | Label text shifts across rollouts — submit buttons carry stable classes (e.g. `.js-pinned-items-submit`) |
| Login state via "Sign in" link | Locale-dependent. Use `meta[name="user-login"]` content |

Prefer `page.evaluate()` with plain DOM traversal over brittle locator
chains — it survives GitHub's component churn better.

## Trap 4: Your own verification will lie to you

After scripting the pin flow, checking "does the profile page contain
'repo-name'" **always passes** — because your profile README lists the same
repos. Text matching against a page you helped fill is self-certification.

**Iron rule**: every web-UI write must be verified through an independent,
authoritative channel (API read, database, second machine). For pins:

```bash
gh api graphql -f query='{ user(login:"YOU") { pinnedItems(first:6, types:REPOSITORY) { totalCount nodes { ... on Repository { name } } } } }'
```

`totalCount` is the truth; the page is the mood.

## Bonus: hard numbers are testable claims

When publishing anything, don't write "30+ checks pass". Run the counter,
paste the real number. We caught ourselves writing "28 checks" when the suite
prints exactly 25 — minutes before posting to a high-visibility repo.
