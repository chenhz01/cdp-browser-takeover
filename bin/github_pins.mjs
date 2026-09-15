#!/usr/bin/env node
// github_pins.mjs — pin repositories on a GitHub profile, because GitHub
// ships NO API for it (GraphQL has no pinItem mutation; REST has no endpoint;
// verified against the live schema). The only way is the web UI — this script
// drives it for you.
//
// Requirements: `npm i playwright-core` (the only optional dependency in this
// repo; everything else is stdlib). You must already be logged into GitHub in
// the browser you connect to (launch one with bin/cdp_launch.mjs and log in
// yourself — this tool never touches credentials).
//
// Usage:
//   node bin/github_pins.mjs --http http://[::1]:9333 --user <login> --login-check
//   node bin/github_pins.mjs --http http://[::1]:9333 --user <login> --pin repo-a,repo-b,repo-c
//
// VERIFY AFTER (never trust page text — your own pinned README contains the
// repo names and will false-positive any DOM-based check):
//   gh api graphql -f query='{ user(login:"<login>") { pinnedItems(first:6, types:REPOSITORY) { totalCount nodes { ... on Repository { name } } } } }'

import { chromium } from 'playwright-core';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      // value only if the next token exists and is not another flag
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) a[key] = argv[++i];
      else a[key] = true;
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.http || !args.user) {
  console.error('required: --http http://[::1]:PORT  --user <github-login>');
  process.exit(2);
}

const browser = await chromium.connectOverCDP(args.http);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] || (await ctx.newPage());

await page.goto(`https://github.com/${args.user}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);

// Login detection: meta tag, never "Sign in" text (locale-dependent).
const login = await page.evaluate(() =>
  document.querySelector('meta[name="user-login"]')?.content || null);

if (!login || login !== args.user) {
  console.log(JSON.stringify({ loggedIn: !!login, login, expected: args.user, note: 'log into GitHub in the connected browser window first' }, null, 2));
  await browser.close();
  process.exit(1);
}

if (args['login-check']) {
  console.log(JSON.stringify({ loggedIn: true, login }, null, 2));
  await browser.close();
  process.exit(0);
}

const targets = String(args.pin || '').split(',').map(s => s.trim()).filter(Boolean);
if (!targets.length) {
  console.error('--pin expects a comma-separated repo list');
  await browser.close();
  process.exit(2);
}

// Open the pin dialog. GitHub's modals are custom elements: the real one is
// <dialog class="Overlay"> containing "Save pins" — NOT [role=dialog].
await page.locator('button:has-text("Customize your pins"), a:has-text("Customize your pins")').first().click({ timeout: 10000 });
await page.waitForTimeout(2000);

const result = await page.evaluate((targets) => {
  const modal = [...document.querySelectorAll('dialog.Overlay')].find(d => d.innerText.includes('Save pins'));
  if (!modal) return { error: 'pin dialog not found (dialog.Overlay with Save pins)' };
  const out = [];
  for (const cb of modal.querySelectorAll('input[type=checkbox]')) {
    const root = cb.closest('li') || cb.parentElement;
    const text = root ? root.innerText : '';
    const hit = targets.find(t => text.toLowerCase().includes(t.toLowerCase()));
    if (!hit) continue;
    if (!cb.checked) { cb.click(); out.push(`checked ${hit}`); }
    else out.push(`already ${hit}`);
  }
  return { actions: out };
}, targets);

if (result.error) {
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(1);
}

// Submit by class, not text (GitHub relabels buttons across rollouts).
await page.locator('button.js-pinned-items-submit').first().click({ timeout: 10000 });
await page.waitForTimeout(2500);

console.log(JSON.stringify({ user: login, pinned: targets, actions: result.actions, verifyWith: `gh api graphql -f query='{ user(login:"${login}") { pinnedItems(first:6, types:REPOSITORY) { totalCount nodes { ... on Repository { name } } } } }'` }, null, 2));
await browser.close();
