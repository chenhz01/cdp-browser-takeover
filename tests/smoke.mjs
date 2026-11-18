#!/usr/bin/env node
// smoke.mjs — end-to-end smoke test of the repo's core promise:
// launch a real Chrome with a CDP port, discover the endpoint on both
// loopbacks, and confirm it answers /json/version. Zero dependencies.
//
// Used by CI (.github/workflows/ci.yml) and runnable locally:
//   node tests/smoke.mjs [--chrome /path/to/chrome] [--headed]

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 9500 + Math.floor(Math.random() * 400); // random: avoid collisions
const profile = mkdtempSync(join(tmpdir(), 'cdp-smoke-'));
const artifacts = mkdtempSync(join(tmpdir(), 'cdp-shot-'));
const chromeArg = process.argv.includes('--chrome')
  ? process.argv[process.argv.indexOf('--chrome') + 1] : undefined;

const launcher = spawn(process.execPath, [
  join(root, 'bin', 'cdp_launch.mjs'),
  '--port', String(port),
  '--profile', profile,
  ...(chromeArg ? ['--chrome', chromeArg] : []),
  ...(process.argv.includes('--headed') ? ['--headed'] : []),
], { stdio: ['ignore', 'pipe', 'pipe'] });

const fail = async (msg) => {
  console.error('SMOKE FAIL:', msg);
  launcher.kill('SIGINT');
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  rmSync(artifacts, { recursive: true, force: true });
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

if (!probeOk) await fail('probe did not confirm a live CDP endpoint with targets');

// Node 18/20 retain launch/probe coverage; the raw WebSocket tools need >=21.
if (typeof WebSocket !== 'undefined') {
  try {
    // A ready CDP endpoint does not guarantee that Chrome's initial tab is
    // registered yet. Create our own fixture and wait for its URL to commit.
    const pageURL = 'data:text/html,<title>cdp-shot-fixture</title><body style="background:salmon">CDP screenshot</body>';
    const created = await fetch(`${endpoint.http}/json/new?${encodeURIComponent(pageURL)}`, { method: 'PUT' });
    if (!created.ok) throw new Error(`creating screenshot fixture: ${created.status}`);
    const page = await created.json();
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const targets = await (await fetch(`${endpoint.http}/json/list`)).json();
      if (targets.some(t => t.id === page.id && (t.url || '').includes('cdp-shot-fixture'))) {
        ready = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error('screenshot fixture did not become ready');
    const screenshot = join(root, 'bin', 'cdp_shot.mjs');
    const out = join(artifacts, 'viewport with spaces.png');
    const result = JSON.parse(execFileSync(process.execPath, [
      screenshot, '--http', endpoint.http, '--url', 'cdp-shot-fixture', '--out', out,
    ], { encoding: 'utf8', timeout: 20000 }));
    const png = readFileSync(out);
    if (!result.ok || result.out !== out || !result.target.includes('cdp-shot-fixture') || result.bytes !== png.length) {
      throw new Error(`bad screenshot result: ${JSON.stringify(result)}`);
    }
    // Inspect the actual image header independently of the CLI's JSON report.
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || png.toString('ascii', 12, 16) !== 'IHDR'
        || png.readUInt32BE(16) === 0 || png.readUInt32BE(20) === 0) {
      throw new Error('screenshot is not a PNG with nonzero dimensions');
    }
    console.log(`screenshot: ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${png.length} bytes`);

    // Failures must preserve an existing output and avoid reporting success.
    for (const [extra, code] of [
      [['--url', 'no-such-page-cdp-smoke'], 1],
      [['--out'], 2],
    ]) {
      const sentinel = Buffer.from('keep existing output');
      writeFileSync(out, sentinel);
      let failed = false;
      try {
        execFileSync(process.execPath, [
          screenshot, '--http', endpoint.http, '--out', out, ...extra,
        ], { encoding: 'utf8', timeout: 20000, stdio: 'pipe' });
      } catch (error) {
        if (error.status !== code || error.stdout !== '' || !error.stderr) throw error;
        failed = true;
      }
      if (!failed || !readFileSync(out).equals(sentinel)) throw new Error('failure replaced the output');
    }

    const missing = join(artifacts, 'missing', 'shot.png');
    try {
      execFileSync(process.execPath, [
        screenshot, '--http', endpoint.http, '--out', missing,
      ], { encoding: 'utf8', timeout: 20000, stdio: 'pipe' });
      throw new Error('writing to a missing directory unexpectedly succeeded');
    } catch (error) {
      if (error.status !== 1 || error.stdout !== '' || existsSync(missing)) throw error;
    }
    console.log('SCREENSHOT PASS: PNG captured; target, argument and file failures checked');
  } catch (error) {
    await fail(error.stack || error.message);
  }
} else {
  console.log('SCREENSHOT SKIP: global WebSocket needs Node >= 21');
}

launcher.kill('SIGINT');
try { rmSync(profile, { recursive: true, force: true }); } catch {}
rmSync(artifacts, { recursive: true, force: true });

console.log(`SMOKE PASS: chrome launched, endpoint found on ${endpoint.http}, targets listed`);
process.exit(0);
