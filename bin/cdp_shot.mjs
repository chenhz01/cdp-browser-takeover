#!/usr/bin/env node
// cdp_shot.mjs — save a tab's viewport as PNG over raw CDP. Stdlib only,
// Node >= 21 (global WebSocket). Works with headed and headless Chrome.
//
// Usage:
//   node bin/cdp_shot.mjs --http http://[::1]:9333 --url github.com --out shot.png
//
// Output: JSON { ok, target, out, bytes }. Exit 0 on success, 1 on a capture
// or file error, 2 on missing arguments or an unsupported Node runtime.

import { writeFileSync } from 'node:fs';

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
if (typeof args.http !== 'string' || typeof args.out !== 'string'
    || (args.url !== undefined && typeof args.url !== 'string')) {
  console.error('required: --http http://[::1]:PORT  --out shot.png  [--url <substring>]');
  process.exit(2);
}
if (typeof WebSocket === 'undefined') {
  console.error('global WebSocket missing — needs Node >= 21');
  process.exit(2);
}

try {
  const res = await fetch(`${args.http.replace(/\/$/, '')}/json/list`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`/json/list -> ${res.status}`);
  const targets = await res.json();
  const target = targets.find(t => t.type === 'page'
    && (!args.url || (t.url || '').includes(args.url)));
  if (!target) throw new Error(`no page target matching --url ${args.url}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let timer;
  let data;
  try {
    data = await new Promise((resolve, reject) => {
      let id = 1;
      timer = setTimeout(() => reject(new Error('CDP screenshot timed out')), 15000);
      ws.onopen = () => ws.send(JSON.stringify({ id, method: 'Page.enable' }));
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onclose = () => reject(new Error('websocket closed before screenshot'));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
          // Page.enable can emit events before its reply. Only consume the
          // response to the current command, never an unrelated notification.
          if (msg.id !== id) return;
          if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
          if (!msg.result) throw new Error('CDP response has no result');
          if (id === 1) {
            ws.send(JSON.stringify({ id: ++id, method: 'Page.captureScreenshot', params: { format: 'png' } }));
          } else {
            if (typeof msg.result.data !== 'string' || !msg.result.data) {
              throw new Error('CDP screenshot has no image data');
            }
            resolve(msg.result.data);
          }
        } catch (error) {
          reject(error);
        }
      };
    });
  } finally {
    clearTimeout(timer);
    ws.close();
  }

  const png = Buffer.from(data, 'base64');
  if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('CDP screenshot is not a PNG');
  }
  writeFileSync(args.out, png);
  console.log(JSON.stringify({ ok: true, target: target.url, out: args.out, bytes: png.length }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}
