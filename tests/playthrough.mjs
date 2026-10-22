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

// Fuzz: put the two portals at random spots on the white surfaces and throw
// the player or the cube through one of them at random speeds and offsets.
// After every physics step, nothing may be stuck inside solid geometry and
// the player's eye may not sit behind a wall or a portal.
const fuzz = await page.evaluate(() => {
  const g = window.__game;
  g.pause();
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const R = (a, b) => a + (b - a) * rnd();
  const v = (x, y, z) => g.player.body.pos.clone().set(x, y, z);
  // [ray origin, ray target] onto each portalable surface of the level
  const surfaces = [
    () => { const y = R(0.2, 3.8), z = R(-1.8, 5.8); return [v(-6, y, z), v(-9, y, z)]; },
    () => { const y = R(4.2, 7.8), z = R(1.2, 6.8); return [v(7, y, z), v(9, y, z)]; },
    () => { const y = R(4.2, 7.3), x = R(-6.8, -3.2); return [v(x, y, -8), v(x, y, -11)]; },
    () => { const x = R(-1.8, 1.8), z = R(2.2, 5.8); return [v(x, 3, z), v(x, 0, z)]; },
  ];
  const inside = (p, b) => p.x > b.min[0] + 0.02 && p.x < b.max[0] - 0.02 && p.y > b.min[1] + 0.02 && p.y < b.max[1] - 0.02 && p.z > b.min[2] + 0.02 && p.z < b.max[2] - 0.02;
  const behind = (p, Q) => Q.linked && Q.distance(p) < -0.03 &&
    p.getComponent(Q.t1) > Q.rmin[Q.t1] && p.getComponent(Q.t1) < Q.rmax[Q.t1] &&
    p.getComponent(Q.t2) > Q.rmin[Q.t2] && p.getComponent(Q.t2) < Q.rmax[Q.t2];
  const problems = [];
  let trials = 0, transits = 0;
  const count = (obj, name) => {
    const orig = obj[name];
    obj[name] = function (P) { transits++; return orig.call(this, P); };
    return () => (obj[name] = orig);
  };
  const restorePlayer = count(g, 'onPlayerTeleport');
  const restoreCube = count(g, 'onCubeTeleport');
  for (let n = 0; n < 160; n++) {
    g.restart();
    const [P0, P1] = g.portals.portals;
    const ok = [P0, P1].every((P, i) => {
      const [from, to] = surfaces[Math.floor(rnd() * 4)]();
      const dir = to.clone().sub(from).normalize();
      const look = v(R(-1, 1), 0, R(-1, 1)).normalize();
      return g.portals.tryPlace(i, from, dir, look).ok;
    });
    if (!ok) continue;
    trials++;
    const entry = rnd() < 0.5 ? P0 : P1;
    const useCube = rnd() < 0.3;
    const body = useCube ? g.cube.body : g.player.body;
    const start = entry.pos.clone().addScaledVector(entry.normal, R(0.9, 3))
      .addScaledVector(entry.right, R(-0.3, 0.3)).addScaledVector(entry.up, R(-0.2, 0.2));
    const speed = R(3, 16);
    body.pos.copy(start);
    body.vel.copy(entry.normal).multiplyScalar(-speed).addScaledVector(entry.right, R(-1, 1)).addScaledVector(entry.up, R(-1, 1));
    if (entry.axis !== 1) body.vel.y += 10 * (start.distanceTo(entry.pos) / speed); // offset gravity on the way
    body.portalMode = null;
    g.physics.depenetrate(body, useCube ? body.box : undefined);
    if (useCube) g.player.body.pos.set(0, 0.9001, 8.5); // keep the player out of the way
    g.player.pitch = R(-1.4, 1);
    for (let i = 0; i < 480; i++) {
      g.step(1 / 120, { forward: 0, strafe: 0, jump: false });
      const point = useCube ? body.pos : g.player.eye;
      let issue = g.physics.statics.find((s) => inside(point, s)) ? 'inside a wall' : null;
      if (!issue && !useCube && [P0, P1].some((Q) => behind(point, Q))) issue = 'eye behind a portal';
      if (!issue && g.physics.collect(body, [0, 0, 0], useCube ? body.box : undefined).some((c) => g.physics.overlaps(body, c))) issue = 'overlapping geometry';
      if (issue) {
        problems.push({ trial: n, what: useCube ? 'cube' : 'player', step: i, issue, pos: body.pos.toArray().map((x) => +x.toFixed(2)), portals: [P0, P1].map((P) => P.pos.toArray().map((x) => +x.toFixed(2))) });
        break;
      }
    }
  }
  restorePlayer();
  restoreCube();
  g.restart();
  return { trials, transits, problems };
});
result.portalExitsClear = fuzz.problems.length === 0 && fuzz.transits >= 80;
if (fuzz.problems.length) console.error('Portal exit problems:', JSON.stringify(fuzz.problems.slice(0, 5), null, 1));
console.log(`Portal fuzz: ${fuzz.transits} transits in ${fuzz.trials} trials, ${fuzz.problems.length} problems`);

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
