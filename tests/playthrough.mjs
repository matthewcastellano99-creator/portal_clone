// Headless end-to-end check: plays every test chamber (and the elevator rides
// between them) through the game's own simulation, checks Chamber 03 can't
// trap the player, stress-tests portal transits in every chamber and drives
// the chamber menu. Fails if any step doesn't happen or the page logs an error.
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
// The scripted routes aim from the eye, so play them in first person.
await page.evaluate(() => window.__game.setView('first'));

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
  steps.elevatorDeparted = !!g.transition && g.levelIndex === 0;

  // The ride: up and out of Chamber 01, down into Chamber 02.
  walk(10);
  const arrival = g.level.arrival?.pos ?? [];
  steps.arrivedInChamber02 = g.levelIndex === 1 && !g.transition &&
    Math.hypot(g.player.body.pos.x - arrival[0], g.player.body.pos.z - arrival[2]) < 0.3;

  // Chamber 02: drop the cube out of its pit through a portal under it, then
  // drop it into a floor portal so it falls out of the alcove ceiling onto
  // the button.
  const walkTo = (x, z) => {
    for (let i = 0; i < 960; i++) {
      const p = g.player.body.pos, dx = x - p.x, dz = z - p.z;
      if (Math.hypot(dx, dz) < 0.15) break;
      g.player.yaw = Math.atan2(-dx, -dz);
      walk(1 / 120, { forward: Math.min(1, Math.hypot(dx, dz)) });
    }
    walk(0.3);
  };
  const cube = g.cube.body.pos;
  walkTo(5.5, 5.35); // rim of the pit
  lookAt(cube.x, cube.y, cube.z); g.shoot(0); // under the cube
  lookAt(-1, 0, -2); g.shoot(1); // white floor patch
  walk(2.5);
  steps.cubeOutOfPit = cube.y > -0.1 && cube.y < 1;
  walkTo(2.5, 6.5); walkTo(1.5, 1); // around the pit
  walkTo(cube.x + 1.3, cube.z + 1.3);
  lookAt(cube.x, cube.y, cube.z); g.use();
  walk(0.8);
  walkTo(1.0, 0.8); walkTo(-5.5, 0.8); walkTo(-5.5, -1.5); // around the floor portal
  lookAt(-5.5, 5.4, -14.3); g.shoot(0); // alcove ceiling, above the button
  const hole = orange.pos;
  walkTo(-3.5, 1.5); walkTo(hole.x, hole.z + 1.3);
  lookAt(hole.x, 0.9, hole.z);
  walk(1.0);
  g.use(); // let go over the floor portal
  walk(2.5);
  steps.cubeOnAlcoveButton = g.button.pressed && g.button.isOn(g.cube.body) && g.door.open === 1;
  walkTo(-4, 1.5); walkTo(-8.5, 1.5); walkTo(-9, -5); walkTo(-14.6, -5);
  walk(10);
  steps.arrivedInChamber03 = g.levelIndex === 2 && !g.transition;
  const cube3 = g.cube.body.pos; // a new chamber has a new cube

  // Chamber 03: carry the cube up the tower, re-aim the portals for a fling
  // (white floor at the tower's foot, high strip on the south wall), drop
  // the cube off the edge, then step off and fly across the chasm.
  walkTo(3.2, 7.8);
  lookAt(cube3.x, cube3.y, cube3.z); g.use();
  walk(0.6);
  walkTo(6.3, 6.5);
  lookAt(8, 1.2, 6); g.shoot(0); // east wall, at the floor
  lookAt(-8, 11.8, 7.7); g.shoot(1); // wall above the tower
  walkTo(5.6, blue.pos.z);
  lookAt(8, g.player.eye.y - 0.2, blue.pos.z);
  walk(0.5);
  steps.climbedTower = walkUntilTeleport({ forward: 1 }) && g.cube.held;
  walk(0.6);
  walkTo(-4.4, 7.5);
  lookAt(-1.2, 0, 7.5); g.shoot(0); // floor at the tower's foot
  lookAt(0, 9.5, 10); g.shoot(1); // high on the south wall, facing the chasm
  walkTo(-4.5, 7.5);
  lookAt(-2.5, 3, 7.5);
  walk(1.0);
  g.use(); // drop the cube off the edge
  walk(3);
  steps.cubeFlungAcross = cube3.z < -4.5 && cube3.y > -0.1 && cube3.y < 1;
  lookAt(0, 9.6, 7.5);
  walk(2.5, { forward: 1 }); // step off
  walk(2);
  steps.playerFlungAcross = g.player.body.pos.z < -4.5 && g.player.body.onGround && g.player.body.pos.y > 0;
  walkTo(cube3.x + 1.2, cube3.z + 1.2);
  lookAt(cube3.x, cube3.y, cube3.z); g.use();
  walk(0.5);
  walkTo(3.5, -7.4);
  lookAt(3.5, 0.4, -9);
  walk(0.8);
  g.use();
  walk(1.5);
  steps.goalButtonPressed = g.button.isOn(g.cube.body) && g.door.open === 1;
  walkTo(-6, -11); walkTo(-12.6, -11);
  walk(5);
  steps.completed = g.state.completed;
  return steps;
});

// Chamber 03 can't trap you: a fall into the chasm can be portalled out of,
// and from the goal side the pillar's hidden white face leads back.
const escapes = await page.evaluate(() => {
  const g = window.__game;
  const idle = { forward: 0, strafe: 0, jump: false };
  const lookAt = (x, y, z) => {
    const e = g.player.eye, dx = x - e.x, dy = y - e.y, dz = z - e.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  };
  // Line up 1.5 m in front of a wall portal, then walk straight in.
  const walkIn = (P) => {
    let n = 0;
    const orig = g.onPlayerTeleport;
    g.onPlayerTeleport = (Q) => { n++; orig.call(g, Q); };
    const spot = P.pos.clone().addScaledVector(P.normal, 1.5);
    for (let i = 0; i < 600; i++) {
      const p = g.player.body.pos, dx = spot.x - p.x, dz = spot.z - p.z;
      if (Math.hypot(dx, dz) < 0.1) break;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.step(1 / 120, { ...idle, forward: Math.min(1, Math.hypot(dx, dz)) });
    }
    lookAt(P.pos.x, g.player.eye.y, P.pos.z);
    for (let i = 0; i < 600 && !n; i++) g.step(1 / 120, { ...idle, forward: 1 });
    g.onPlayerTeleport = orig;
    g.step(2, idle);
    return n > 0;
  };
  const [blue, orange] = g.portals.portals;
  g.newGame(2);
  g.player.body.pos.set(0, -4.0999, -1); // fell into the chasm
  lookAt(0, -3.5, 2); g.shoot(0); // white panel at the bottom of the chasm wall
  lookAt(8, 8, 6); g.shoot(1); // the tall white panel on the start side, seen over the rim
  const outOfChasm = blue.placed && orange.placed && walkIn(blue) && g.player.body.pos.y > 0.5 && g.player.body.pos.z > 2;
  g.newGame(2);
  g.player.body.pos.set(3, 0.9001, -15); // on the goal side, north of the pillar
  lookAt(0, 1.2, -13); g.shoot(0); // the pillar's hidden face
  lookAt(8, 5, 6); g.shoot(1); // back on the start side
  const wayBack = blue.placed && orange.placed && walkIn(blue) && g.player.body.pos.z > 2;
  g.newGame();
  return { outOfChasm, wayBack };
});
Object.assign(result, escapes);

// The chamber menu: open it from the start screen and pick Chamber 02.
await page.evaluate(() => {
  const g = window.__game;
  g.newGame();
  g.state.started = false;
  g.pause();
});
await page.click('#choose-chamber');
await page.click('[data-chamber="1"]');
result.chamberMenuWorks = await page.evaluate(() => window.__game.levelIndex === 1 && !window.__game.state.paused &&
  document.getElementById('overlay').classList.contains('hidden'));


// Fuzz: put the two portals at random spots on the white surfaces and throw
// the player or the cube through one of them at random speeds and offsets.
// After every physics step, nothing may be stuck inside solid geometry and
// the player's eye may not sit behind a wall or a portal.
const runFuzz = (level) => page.evaluate((level) => {
  const g = window.__game;
  g.newGame();
  if (level) g.loadLevel(level);
  g.pause();
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const R = (a, b) => a + (b - a) * rnd();
  const v = (x, y, z) => g.player.body.pos.clone().set(x, y, z);
  // [ray origin, ray target] onto each portalable surface of each chamber
  const surfaces = [[
    () => { const y = R(0.2, 3.8), z = R(-1.8, 5.8); return [v(-6, y, z), v(-9, y, z)]; },
    () => { const y = R(4.2, 7.8), z = R(1.2, 6.8); return [v(7, y, z), v(9, y, z)]; },
    () => { const y = R(4.2, 7.3), x = R(-6.8, -3.2); return [v(x, y, -8), v(x, y, -11)]; },
    () => { const x = R(-1.8, 1.8), z = R(2.2, 5.8); return [v(x, 3, z), v(x, 0, z)]; },
  ], [
    () => { const x = R(4.2, 6.8), z = R(2.2, 4.8); return [v(x, 3, z), v(x, -3, z)]; }, // pit floor
    () => { const x = R(-2.8, 0.8), z = R(-3.8, -0.2); return [v(x, 3, z), v(x, 0, z)]; }, // floor patch
    () => { const x = R(-6.6, -4.4), z = R(-15.4, -13.2); return [v(x, 3, z), v(x, 5.4, z)]; }, // alcove ceiling
    () => { const y = R(3.2, 7.8), z = R(-1.8, 5.8); return [v(7, y, z), v(10, y, z)]; }, // high east wall
  ], [
    () => { const x = R(-3.8, -1.2), z = R(5.7, 9.3); return [v(x, 3, z), v(x, 0, z)]; }, // floor at the tower's foot
    () => { const x = R(-2.8, 2.8), y = R(8.2, 11.8); return [v(x, y, 6), v(x, y, 10)]; }, // south wall strip
    () => { const y = R(8.2, 12.3), z = R(6.2, 9.3); return [v(-6, y, z), v(-8, y, z)]; }, // above the tower
    () => { const y = R(0.2, 9.8), z = R(3.2, 8.8); return [v(6, y, z), v(8, y, z)]; }, // east wall
    () => { const x = R(-1.8, 1.8), y = R(-4.8, -1.2); return [v(x, y, -1), v(x, y, 2)]; }, // chasm wall
    () => { const x = R(-0.8, 0.8), y = R(0.2, 3.0); return [v(x, y, -15), v(x, y, -13)]; }, // pillar (way back)
  ]][level];
  const inside = (p, b) => p.x > b.min[0] + 0.02 && p.x < b.max[0] - 0.02 && p.y > b.min[1] + 0.02 && p.y < b.max[1] - 0.02 && p.z > b.min[2] + 0.02 && p.z < b.max[2] - 0.02;
  // inside the hole just behind a portal (not merely somewhere behind its wall)
  const behind = (p, Q) => Q.linked && Q.distance(p) < -0.03 && Q.distance(p) > -3 &&
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
      const [from, to] = surfaces[Math.floor(rnd() * surfaces.length)]();
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
    if (useCube) g.player.body.pos.set(0, 0.9001, 9); // keep the player out of the way
    g.player.pitch = R(-1.4, 1);
    for (let i = 0; i < 480; i++) {
      g.step(1 / 120, { forward: 0, strafe: 0, jump: false });
      const point = useCube ? body.pos : g.player.eye;
      let issue = g.physics.statics.find((s) => inside(point, s)) ? 'inside a wall' : null;
      if (!issue && !useCube && [P0, P1].some((Q) => behind(point, Q))) issue = 'eye behind a portal';
      // level geometry only: the player and the cube may overlap briefly while they move apart
      const solid = g.physics.collect(body, [0, 0, 0], useCube ? body.box : undefined).filter((c) => !(c.body || c.src?.body));
      if (!issue && solid.some((c) => g.physics.overlaps(body, c))) issue = 'overlapping geometry';
      if (issue) {
        problems.push({ trial: n, what: useCube ? 'cube' : 'player', step: i, issue, pos: body.pos.toArray().map((x) => +x.toFixed(2)), portals: [P0, P1].map((P) => P.pos.toArray().map((x) => +x.toFixed(2))) });
        break;
      }
    }
  }
  restorePlayer();
  restoreCube();
  g.newGame();
  return { trials, transits, problems };
}, level);
for (const level of [0, 1, 2]) {
  const fuzz = await runFuzz(level);
  result[`portalExitsClear${level + 1}`] = fuzz.problems.length === 0 && fuzz.transits >= 80;
  if (fuzz.problems.length) console.error('Portal exit problems:', JSON.stringify(fuzz.problems.slice(0, 5), null, 1));
  console.log(`Portal fuzz, chamber ${level + 1}: ${fuzz.transits} transits in ${fuzz.trials} trials, ${fuzz.problems.length} problems`);
}

// From the button platform, portals aimed anywhere on the wall behind it must
// be walkable: they slide down to the floor, and a small lip is stepped over.
const walkIn = await page.evaluate(() => {
  const g = window.__game;
  const lookAt = (x, y, z) => {
    const e = g.player.eye, dx = x - e.x, dy = y - e.y, dz = z - e.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  };
  const walkUntilTeleport = () => {
    let n = 0;
    const orig = g.onPlayerTeleport;
    g.onPlayerTeleport = (P) => { n++; orig.call(g, P); };
    for (let i = 0; i < 480 && !n; i++) g.step(1 / 120, { forward: 1, strafe: 0, jump: false });
    g.onPlayerTeleport = orig;
    return n > 0;
  };
  const [blue, orange] = g.portals.portals;
  const v = (x, y, z) => g.player.body.pos.clone().set(x, y, z);
  let tries = 0, through = 0;
  for (const [px, pz] of [[-5, -9.5], [-2, -7], [-8, -10]]) {
    for (const ledgeY of [4.6, 7.5]) {
      for (const [wx, wy] of [[-6.5, 4.5], [-5, 6.8], [-3.5, 7.3]]) {
        g.restart();
        g.player.body.pos.set(px, 4.9001, pz);
        lookAt(9, ledgeY, 4); g.shoot(0);
        lookAt(wx, wy, -11); g.shoot(1);
        lookAt(orange.pos.x, g.player.eye.y, orange.pos.z);
        tries++;
        if (blue.placed && orange.placed && walkUntilTeleport()) through++;
      }
    }
  }
  // A portal whose bottom edge sits a little above the floor is stepped into;
  // a high one still needs a jump.
  const lip = (h) => {
    g.restart();
    orange.place(v(-5, 5.1 + h, -11), 2, 1, -11, v(0, 1, 0), v(1, 0, 0));
    blue.place(v(9, 5.1, 4), 0, -1, 9, v(0, 1, 0), v(0, 0, 1));
    g.portals.refresh();
    g.player.body.pos.set(-5, 4.9001, -8.5);
    g.player.yaw = 0;
    g.player.pitch = 0;
    return walkUntilTeleport();
  };
  const result = { tries, through, smallLip: lip(0.3), bigLip: lip(0.6) };
  g.restart();
  return result;
});
result.platformPortalsWalkable = walkIn.through === walkIn.tries;
result.stepsOverSmallLip = walkIn.smallLip && !walkIn.bigLip;
console.log(`Platform walk-in: ${walkIn.through}/${walkIn.tries} went through`);

// Third person: from many spots and view directions, the camera never ends up
// inside solid geometry, and a shot from the shoulder lands where the
// crosshair points (straight down the middle of the screen).
result.thirdPersonCamera = await page.evaluate(() => {
  const g = window.__game;
  g.newGame();
  g.setView('third');
  const inside = (p) => g.physics.statics.some((b) => !b.hidden &&
    p.x > b.min[0] + 0.02 && p.x < b.max[0] - 0.02 && p.y > b.min[1] + 0.02 && p.y < b.max[1] - 0.02 && p.z > b.min[2] + 0.02 && p.z < b.max[2] - 0.02);
  let seed = 3;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let ok = true;
  for (let i = 0; i < 300 && ok; i++) {
    g.player.yaw = rnd() * Math.PI * 2;
    g.player.pitch = (rnd() - 0.5) * 2.6;
    g.step(0.3, { forward: rnd() < 0.7 ? 1 : 0, strafe: Math.round(rnd() * 2 - 1), jump: false });
    g.thirdPerson.reset();
    g.frameUpdate(1 / 60);
    if (inside(g.camera.position) || inside(g.thirdPerson.pivot)) ok = false;
  }
  const center = g.camera.getWorldDirection(new g.camera.position.constructor());
  const aim = g.player.forward();
  g.setView('first');
  return ok && center.angleTo(aim) < 1e-3;
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
console.log('All levels solved.');
