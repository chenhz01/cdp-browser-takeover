#!/usr/bin/env node
// smoke.mjs — end-to-end smoke test of the repo's core promise:
// launch a real Chrome with a CDP port, discover the endpoint on both
// loopbacks, and confirm it answers /json/version. Zero dependencies.
//
// Used by CI (.github/workflows/ci.yml) and runnable locally:
//   node tests/smoke.mjs [--chrome /path/to/chrome]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 9500 + Math.floor(Math.random() * 400); // random: avoid collisions
const profile = mkdtempSync(join(tmpdir(), 'cdp-smoke-'));
const chromeArg = process.argv.includes('--chrome')
  ? process.argv[process.argv.indexOf('--chrome') + 1] : undefined;

const launcher = spawn(process.execPath, [
  join(root, 'bin', 'cdp_launch.mjs'),
  '--port', String(port),
  '--profile', profile,
  ...(chromeArg ? ['--chrome', chromeArg] : []),
], { stdio: ['ignore', 'pipe', 'pipe'] });

const fail = async (msg) => {
  console.error('SMOKE FAIL:', msg);
  launcher.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(1);
};

// launcher prints one JSON object on success — grab it with a timeout.
const endpoint = await new Promise((resolve) => {
  let buf = '';
  const timer = setTimeout(() => resolve(null), 45000);
  launcher.stdout.on('data', d => {
    buf += d;
    const m = buf.match(/\{[\s\S]*\}/);
    if (m) { clearTimeout(timer); try { resolve(JSON.parse(m[0])); } catch { resolve(null); } }
  });
  launcher.on('exit', code => { clearTimeout(timer); resolve(null); if (code) fail(`launcher exited ${code}`); });
});

if (!endpoint) await fail('no endpoint JSON from cdp_launch.mjs within 45s');
if (!/^Chrome\//.test(endpoint.browser)) await fail(`unexpected browser string: ${endpoint.browser}`);
console.log('launched:', endpoint.browser, 'on', endpoint.http);

// Independent confirmation through the probe script (its own dual-loopback logic).
const probe = spawn(process.execPath, [
  join(root, 'bin', 'cdp_probe.mjs'), String(port), '--targets',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let pbuf = '';
probe.stdout.on('data', d => { pbuf += d; });
const probeOk = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 20000);
  probe.on('exit', () => {
    clearTimeout(timer);
    try {
      const out = JSON.parse(pbuf);
      resolve(out.alive === true && Array.isArray(out.targets));
    } catch { resolve(false); }
  });
});

launcher.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}

if (!probeOk) await fail('probe did not confirm a live CDP endpoint with targets');
console.log(`SMOKE PASS: chrome launched, endpoint found on ${endpoint.http}, targets listed`);
process.exit(0);
