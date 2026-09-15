#!/usr/bin/env node
// cdp_probe.mjs — check what's REALLY listening on a CDP port, without any
// dependency. Tries both loopbacks because Chrome binds [::1] about as often
// as 127.0.0.1, and other services love squatting on 9222.
//
// Usage:
//   node bin/cdp_probe.mjs [port]        # default 9333
//   node bin/cdp_probe.mjs [port] --targets

const port = Number(process.argv[2] || 9333);
const wantTargets = process.argv.includes('--targets');
const hosts = ['[::1]', '127.0.0.1'];

let hit = null;
for (const host of hosts) {
  try {
    const res = await fetch(`http://${host}:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      hit = { host, info: await res.json() };
      break;
    }
  } catch { /* try next loopback */ }
}

if (!hit) {
  console.log(JSON.stringify({ alive: false, port, note: 'no CDP on [::1] or 127.0.0.1 — either the browser is down, or the port is squatted by another process' }, null, 2));
  process.exit(1);
}

const out = { alive: true, http: `http://${hit.host}:${port}`, browser: hit.info.Browser, ws: hit.info.webSocketDebuggerUrl };

if (wantTargets) {
  try {
    const res = await fetch(`http://${hit.host}:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
    out.targets = (await res.json()).map(t => ({ type: t.type, title: (t.title || '').slice(0, 60), url: (t.url || '').slice(0, 100) }));
  } catch (e) {
    out.targetsError = String(e.message || e);
  }
}

console.log(JSON.stringify(out, null, 2));
