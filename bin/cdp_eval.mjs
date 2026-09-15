#!/usr/bin/env node
// cdp_eval.mjs — evaluate JavaScript in a browser tab over CDP using ONLY the
// Node stdlib (global WebSocket, Node >= 21). No playwright needed.
//
// Usage:
//   node bin/cdp_eval.mjs --http http://[::1]:9333 --eval "document.title"
//   node bin/cdp_eval.mjs --http http://[::1]:9333 --url github.com --eval "location.href"
//   node bin/cdp_eval.mjs --http http://[::1]:9333 --new --eval "1+1"
//
// Output: JSON { ok, value, exception? } — exit 0 on clean evaluation.

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) a[key] = argv[++i];
      else a[key] = true;
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.http || !args.eval) {
  console.error('required: --http http://[::1]:PORT  --eval "expression"  [--url <substring>] [--new]');
  process.exit(2);
}
if (typeof WebSocket === 'undefined') {
  console.error('global WebSocket missing — needs Node >= 21 (this is the one stdlib-only script with a floor above 18)');
  process.exit(2);
}

// 1. find or create the target tab
let target;
if (args.new) {
  const res = await fetch(`${args.http}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) { console.error(JSON.stringify({ ok: false, error: `/json/new -> ${res.status}` })); process.exit(1); }
  target = await res.json();
} else {
  const res = await fetch(`${args.http}/json/list`);
  const targets = await res.json();
  const pages = targets.filter(t => t.type === 'page');
  target = args.url
    ? pages.find(t => (t.url || '').includes(args.url))
    : pages[0];
  if (!target) { console.error(JSON.stringify({ ok: false, error: `no page target matching --url ${args.url}` })); process.exit(1); }
}

// 2. raw CDP over WebSocket: Runtime.evaluate with a matching-id response wait
const ws = new WebSocket(target.webSocketDebuggerUrl);
const done = new Promise((resolve) => {
  let id = 0;
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: {
      expression: args.eval, returnByValue: true, awaitPromise: true, userGesture: true,
    }}));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id === 1) resolve(msg);
  };
  ws.onerror = () => resolve({ error: 'websocket error' });
});
const reply = await done;
ws.close();

if (reply.error || !reply.result) {
  console.log(JSON.stringify({ ok: false, target: target.url, error: reply.error || 'no reply' }, null, 2));
  process.exit(1);
}
const r = reply.result.result;
const out = { ok: !reply.result.exceptionDetails, target: target.url, type: r.type, value: r.value };
if (reply.result.exceptionDetails) {
  out.exception = reply.result.exceptionDetails.exception?.description
    || reply.result.exceptionDetails.text;
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
