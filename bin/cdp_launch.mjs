#!/usr/bin/env node
// cdp_launch.mjs — launch a Chrome/Chromium with a CDP debugging port and
// discover the REAL endpoint (Chrome often binds [::1], not 127.0.0.1).
//
// Stdlib-only (Node >= 18). Zero dependencies.
//
// Usage:
//   node bin/cdp_launch.mjs --port 9333 [--chrome <path>] [--profile <dir>] [--headed]
//
// Output: prints a JSON line {"ws": "...", "http": "...", "pid": N} on success
// and writes endpoint.json next to cwd if --out is given.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

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

// Best-effort Chrome discovery per platform.
async function findChrome(explicit) {
  const { existsSync, readdirSync } = await import('node:fs');
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = process.platform === 'win32' ? [
    join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  if (process.platform === 'win32' && candidates[0].includes('ms-playwright')) {
    // newest chromium-* dir wins; check both chrome-win64 and chrome-win layouts
    try {
      const base = candidates[0];
      const dirs = readdirSync(base).filter(d => d.startsWith('chromium-')).sort().reverse();
      for (const d of dirs) for (const sub of ['chrome-win64', 'chrome-win']) {
        const p = join(base, d, sub, 'chrome.exe');
        if (existsSync(p)) return p;
      }
    } catch { /* fall through */ }
  }
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('Chrome/Chromium not found — pass --chrome /path/to/chrome');
}

// Probe both loopbacks: Chrome may bind IPv6 [::1] while another process owns
// IPv4 127.0.0.1 on the same port (yes, this really happens).
async function probeEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const hosts = ['[::1]', '127.0.0.1'];
  while (Date.now() < deadline) {
    for (const host of hosts) {
      try {
        const res = await fetch(`http://${host}:${port}/json/version`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const info = await res.json();
          return { host, port, info };
        }
      } catch { /* not up yet, or wrong loopback — keep trying */ }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || 9333);
const chrome = await findChrome(args.chrome);
const profile = args.profile || join(process.env.HOME || process.env.USERPROFILE || '.', '.cdp-browser-takeover', 'profile');

const child = spawn(chrome, [
  `--remote-debugging-port=${port}`,
  '--no-sandbox',
  '--disable-gpu',
  `--user-data-dir=${profile}`,
  '--window-size=1280,900',
  args.headed ? '' : '--headless=new',
  'about:blank',
].filter(Boolean), { stdio: ['ignore', 'pipe', 'pipe'] });

// Belt and braces: also watch stderr for the authoritative endpoint line.
let stderrTail = '';
child.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-2000); });

const endpoint = await probeEndpoint(port);
if (!endpoint) {
  console.error(JSON.stringify({ error: 'CDP endpoint not reachable', stderrTail }));
  child.kill();
  process.exit(1);
}

const result = {
  pid: child.pid,
  chrome,
  http: `http://${endpoint.host}:${port}`,
  ws: endpoint.info.webSocketDebuggerUrl,
  browser: endpoint.info.Browser,
};
console.log(JSON.stringify(result, null, 2));
if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2));

// Keep running so the browser stays alive for the caller; Ctrl+C kills both.
process.on('SIGINT', () => { child.kill(); process.exit(0); });
