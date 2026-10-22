// Headless end-to-end check: solves Test Chamber 01 through the game's own
// simulation and fails if any step doesn't happen or the page logs an error.
//
//   npm install && npm test
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html?autostart`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__game, null, { timeout: 30000 });

const result = await page.evaluate(() => {
  const g = window.__game;
  const idle = { forward: 0, strafe: 0, jump: false };
  const walk = (sec, input = {}) => g.step(sec, { ...idle, ...input });
  const lookAt = (x, y, z) => {
    const e = g.player.eye, dx = x - e.x, dy = y - e.y, dz = z - e.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  };
  const walkUntilTeleport = (input, maxSec = 6) => {
    let n = 0;
    const orig = g.onPlayerTeleport;
    g.onPlayerTeleport = (P) => { n++; orig.call(g, P); };
    for (let i = 0; i < maxSec * 120 && !n; i++) walk(1 / 120, input);
    g.onPlayerTeleport = orig;
    return n > 0;
  };
  const [blue, orange] = g.portals.portals;
  const steps = {};

  lookAt(-9, 1.2, 2); g.shoot(1); // orange: west wall strip
  lookAt(9, 6.2, 4); g.shoot(0); // blue: east wall above the ledge
  steps.portalsPlaced = blue.placed && orange.placed;

  lookAt(-9, g.player.eye.y, orange.pos.z);
  steps.reachedLedge = walkUntilTeleport({ forward: 1 }) && g.player.body.pos.y > 4.5;
  walk(0.8);

  lookAt(...g.cube.body.pos.toArray());
  g.use();
  steps.pickedUpCube = g.cube.held;
  walk(0.6);

  lookAt(-5, 5.0, -11); g.shoot(1); // orange: north wall above the platform
  lookAt(9, g.player.eye.y, blue.pos.z);
  walk(0.5, { forward: -1 });
  lookAt(9, g.player.eye.y - 0.2, blue.pos.z);
  walk(0.6);
  steps.carriedCubeThrough = walkUntilTeleport({ forward: 1 }) && g.cube.held && g.player.body.pos.z < -9;
  walk(0.4);

  const b = g.button.pos;
  lookAt(b.x, g.player.eye.y, b.z);
  for (let i = 0; i < 600 && Math.hypot(g.player.body.pos.x - b.x, g.player.body.pos.z - b.z) > 1.5; i++) walk(1 / 120, { forward: 1 });
  walk(0.4);
  lookAt(b.x, b.y + 0.4, b.z);
  walk(0.8);
  g.use();
  walk(1.5);
  steps.buttonPressed = g.button.pressed && g.door.open === 1;

  lookAt(-9.5, g.player.eye.y, -8.5);
  walk(1.0, { forward: 1 });
  lookAt(-15, g.player.eye.y, -8.5);
  walk(2.0, { forward: 1 });
  steps.completed = g.state.completed;
  return steps;
});

await browser.close();
server.close();

console.table(result);
const failed = Object.entries(result).filter(([, ok]) => !ok).map(([k]) => k);
if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
if (failed.length || errors.length) {
  console.error(`FAILED: ${[...failed, ...(errors.length ? ['page errors'] : [])].join(', ')}`);
  process.exit(1);
}
console.log('Test Chamber 01 solved.');
