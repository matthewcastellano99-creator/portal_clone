import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PORTAL } from './config.js';
import { sweep, armorBump, covenantBump, weaveBump, skinBump } from './sculpt.js';

// Device models built in code. Both point down -z and return the same
// parts: the group, the material that glows in the last portal's colour, and
// the claws that open while holding something.
export function buildGunModel(skin = 'subject') {
  return skin === 'arbiter' ? buildPlasmaRifle() : buildPortalDevice();
}

// A tool in the shape of a Covenant plasma rifle: a swept, glossy housing at
// the back, two curved prongs forming an open mouth at the front with the
// emitter between them, vented sides, a heat gauge and a grip underneath.
function buildPlasmaRifle() {
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0x5a3794, metalness: 0.6, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.12,
    iridescence: 0.55, iridescenceIOR: 1.5, envMapIntensity: 1.6, bumpMap: covenantBump([1, 1]), bumpScale: 1.2,
  });
  const plate = new THREE.MeshPhysicalMaterial({
    color: 0x9a7fd0, metalness: 0.7, roughness: 0.2, clearcoat: 1, iridescence: 0.8, envMapIntensity: 1.8, side: THREE.DoubleSide,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1726, roughness: 0.45, metalness: 0.7, envMapIntensity: 1.2 });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(PORTAL.colors[0]), emissiveIntensity: 3 });
  const gun = new THREE.Group();
  const add = (geo, mat, parent = gun) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };

  // housing: fat in the middle, tapering to a rounded tail
  add(sweep([[0, -0.005, 0.22], [0, 0.008, 0.15], [0, 0.012, 0.06], [0, 0.01, -0.025]], {
    width: [0.012, 0.05, 0.062, 0.058, 0.048], height: [0.012, 0.055, 0.068, 0.064, 0.05], exp: 2.3, segments: 32, radial: 28,
  }), shell);
  // raised cheek plates on both sides
  for (const side of [0, 0.5]) {
    add(sweep([[0, 0.0, 0.18], [0, 0.01, 0.1], [0, 0.012, 0.02]], {
      width: [0.03, 0.068, 0.064], height: [0.03, 0.074, 0.07], exp: 2.3, arc: [side - 0.09, side + 0.09], segments: 20, radial: 10,
    }), plate);
  }
  // spine along the top
  add(sweep([[0, 0.066, 0.17], [0, 0.083, 0.1], [0, 0.08, 0.0], [0, 0.065, -0.03]], {
    width: [0.002, 0.008, 0.008, 0.003], height: [0.002, 0.008, 0.008, 0.002], segments: 20, radial: 8,
  }), dark);

  // The prongs hinge at the housing so they can flex open.
  const claws = [];
  for (const s of [1, -1]) {
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.03 * s, -0.01);
    gun.add(hinge);
    const path = [[0, 0.01 * s, 0.03], [0, 0.04 * s, -0.04], [0, 0.045 * s, -0.12], [0, 0.022 * s, -0.19], [0, 0.0, -0.225]];
    add(sweep(path, {
      width: [0.05, 0.05, 0.042, 0.026, 0.004], height: [0.036, 0.032, 0.026, 0.017, 0.003], exp: 2.2, segments: 32, radial: 24,
    }), shell, hinge);
    // a glossy plate over the outer face, and a glowing strip on the inner face
    add(sweep(path.slice(0, 4), {
      width: [0.046, 0.048, 0.04, 0.02], height: [0.04, 0.036, 0.03, 0.015], exp: 2.2,
      arc: s > 0 ? [0.12, 0.38] : [0.62, 0.88], segments: 24, radial: 10,
    }), plate, hinge);
    add(sweep(path.slice(1).map(([x, y, z]) => [x, y - 0.024 * s, z]), {
      width: [0.026, 0.026, 0.016, 0.002], height: 0.004, segments: 20, radial: 10,
    }), coreMat, hinge);
    claws.push({ rotation: hinge.rotation, axis: 'x', sign: s });
  }

  // emitter: a dark rod ringed with glowing coils, ending in a bright bulb
  add(sweep([[0, 0, 0.0], [0, 0, -0.12]], { width: 0.013, segments: 4, radial: 16 }), dark);
  for (let i = 0; i < 4; i++) {
    const ring = add(new THREE.TorusGeometry(0.019 - i * 0.0015, 0.0035, 8, 24), coreMat);
    ring.position.z = -0.025 - i * 0.026;
  }
  const bulb = add(new THREE.SphereGeometry(1, 20, 14), coreMat);
  bulb.scale.set(0.018, 0.018, 0.034);
  bulb.position.z = -0.135;

  // vents: a recessed panel on each side with glowing slats
  for (const x of [-1, 1]) {
    const panel = add(new RoundedBoxGeometry(0.01, 0.056, 0.1, 2, 0.004), dark);
    panel.position.set(x * 0.058, 0.004, 0.09);
    for (let i = 0; i < 5; i++) {
      const slat = add(new THREE.BoxGeometry(0.004, 0.044 - Math.abs(i - 2) * 0.006, 0.007), coreMat);
      slat.position.set(x * 0.063, 0.004, 0.055 + i * 0.018);
      slat.rotation.x = -0.25;
    }
  }

  // heat gauge on top, beside the spine
  const gauge = add(new RoundedBoxGeometry(0.022, 0.008, 0.07, 2, 0.003), dark);
  gauge.position.set(0.024, 0.07, 0.08);
  gauge.rotation.z = -0.35;
  for (let i = 0; i < 6; i++) {
    const seg = add(new THREE.BoxGeometry(0.014, 0.003, 0.007), coreMat);
    seg.position.set(0.0255, 0.0745, 0.053 + i * 0.011);
    seg.rotation.z = -0.35;
  }

  // grip, trigger guard and trigger
  add(sweep([[0, -0.035, 0.1], [0, -0.09, 0.118], [0, -0.14, 0.145]], {
    width: [0.022, 0.019, 0.021], height: [0.03, 0.026, 0.028], exp: 2.6, up: [0, 0, -1], segments: 12, radial: 16,
  }), dark);
  for (let i = 0; i < 3; i++) {
    const ridge = add(new THREE.TorusGeometry(0.02, 0.003, 6, 16), plate);
    ridge.position.set(0, -0.07 - i * 0.025, 0.112 + i * 0.008);
    ridge.rotation.x = Math.PI / 2 - 0.35;
    ridge.scale.set(1.05, 1.35, 1);
  }
  add(sweep([[0, -0.045, 0.045], [0, -0.09, 0.05], [0, -0.115, 0.085], [0, -0.115, 0.12]], {
    width: 0.006, height: 0.004, segments: 16, radial: 8, up: [0, 0, -1],
  }), dark);
  add(sweep([[0, -0.05, 0.085], [0, -0.07, 0.078], [0, -0.085, 0.085]], {
    width: 0.004, height: 0.003, segments: 8, radial: 8, up: [0, 0, -1],
  }), plate);

  gun.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group: gun, coreMat, claws };
}

// The armoured forearm and four-fingered hand that hold the rifle in first
// person (Arbiter skin only). Lives in the gun's own coordinates.
function buildGauntlet() {
  const armor = new THREE.MeshPhysicalMaterial({
    color: 0xb7bdc6, metalness: 0.85, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2,
    envMapIntensity: 1.4, bumpMap: armorBump([1, 1]), bumpScale: 1.5, side: THREE.DoubleSide,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x4a4f58, metalness: 0.8, roughness: 0.35, envMapIntensity: 1.2 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x24252c, roughness: 0.75, bumpMap: weaveBump([6, 4]), bumpScale: 1.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x4f4537, roughness: 0.6, bumpMap: skinBump([1, 1]), bumpScale: 2 });
  const g = new THREE.Group();
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return m;
  };

  const arm = [[0.0, -0.13, 0.125], [0.05, -0.23, 0.26], [0.13, -0.36, 0.46]];
  add(sweep(arm, { width: [0.03, 0.048, 0.05], height: [0.028, 0.044, 0.046], up: [0, 1, 0], segments: 16, radial: 16 }), suit);
  // layered bracer plates over the top and inner side, with a raised spine
  add(sweep(arm.slice(0, 2).concat([[0.1, -0.31, 0.38]]), {
    width: [0.038, 0.06, 0.062], height: [0.036, 0.056, 0.058], exp: 2.6, arc: [0.1, 0.72], segments: 16, radial: 16,
  }), armor);
  add(sweep([[0.05, -0.215, 0.24], [0.1, -0.3, 0.37], [0.14, -0.37, 0.47]], {
    width: [0.064, 0.068, 0.06], height: [0.06, 0.064, 0.058], exp: 2.6, arc: [0.08, 0.7], segments: 12, radial: 16,
  }), armor);
  add(sweep([[0.01, -0.105, 0.135], [0.06, -0.19, 0.26], [0.12, -0.3, 0.42]], {
    width: 0.006, height: 0.008, lift: 0, segments: 16, radial: 8,
  }), trim);

  // hand: armoured back, a palm round the grip, two fingers and two thumbs
  const palm = add(new RoundedBoxGeometry(0.05, 0.06, 0.058, 3, 0.014), suit);
  palm.position.set(0.006, -0.11, 0.13);
  palm.rotation.x = -0.35;
  const back = add(sweep([[0.03, -0.085, 0.15], [0.032, -0.115, 0.13], [0.03, -0.14, 0.12]], {
    width: 0.014, height: 0.03, exp: 3, segments: 8, radial: 12,
  }), armor);
  back.castShadow = true;
  for (let i = 0; i < 2; i++) {
    const y = -0.075 - i * 0.03;
    add(sweep([[0.024, y, 0.11], [0.022, y - 0.004, 0.08], [0.0, y - 0.006, 0.066], [-0.022, y - 0.004, 0.078], [-0.024, y, 0.095]], {
      width: [0.011, 0.01, 0.009, 0.008, 0.004], height: [0.011, 0.01, 0.009, 0.008, 0.004], segments: 16, radial: 10,
    }), skin);
    const knuckle = add(new RoundedBoxGeometry(0.014, 0.016, 0.02, 2, 0.004), armor);
    knuckle.position.set(0.027, y - 0.002, 0.092);
  }
  for (let i = 0; i < 2; i++) {
    const y = -0.08 - i * 0.034;
    add(sweep([[-0.022, y, 0.14], [-0.034, y + 0.004, 0.11], [-0.03, y + 0.004, 0.08], [-0.02, y, 0.07]], {
      width: [0.012, 0.011, 0.009, 0.005], height: [0.012, 0.011, 0.009, 0.005], segments: 12, radial: 10,
    }), skin);
  }
  return g;
}

// Portal device model built from primitives. Points down -z.
function buildPortalDevice() {
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.3, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35 });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(PORTAL.colors[0]), emissiveIntensity: 3 });

  const gun = new THREE.Group();
  const along = (geo) => geo.rotateX(Math.PI / 2); // cylinder axis -> z

  // main white shell, fat at the back and tapering to the front
  const shell = new THREE.Mesh(along(new THREE.CylinderGeometry(0.055, 0.075, 0.34, 28)), white);
  shell.position.z = 0.03;
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.075, 28, 16), white);
  back.scale.z = 0.8;
  back.position.z = 0.2;
  // dark collar and barrel
  const collar = new THREE.Mesh(along(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 28)), dark);
  collar.position.z = -0.15;
  const barrel = new THREE.Mesh(along(new THREE.CylinderGeometry(0.032, 0.04, 0.14, 20)), black);
  barrel.position.z = -0.22;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), coreMat);
  tip.position.z = -0.29;
  // glass tube with the glowing core along the top
  const tube = new THREE.Mesh(along(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 16)), glass);
  tube.position.set(0, 0.066, 0.03);
  const core = new THREE.Mesh(along(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 10)), coreMat);
  core.position.set(0, 0.066, 0.03);
  // grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.07), dark);
  grip.position.set(0, -0.085, 0.07);
  grip.rotation.x = -0.25;

  // three claws around the barrel
  const claws = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI * 2) / 3 + Math.PI / 2;
    const arm = new THREE.Group();
    arm.position.set(0.05, 0, -0.16);
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.026, 0.15), black);
    claw.position.z = -0.07;
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.026, 0.04), black);
    hook.position.set(-0.012, 0, -0.145);
    hook.rotation.y = 0.6;
    arm.add(claw, hook);
    arm.rotation.y = 0.12;
    pivot.add(arm);
    gun.add(pivot);
    claws.push({ rotation: arm.rotation, axis: 'y', sign: 1 });
  }

  gun.add(shell, back, collar, barrel, tip, tube, core, grip);
  gun.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group: gun, coreMat, claws };
}

// The gun as seen in first person, drawn in its own pass on top of the world.
export class ViewModel {
  constructor(aspect, skin) {
    this.scene = new THREE.Scene();
    // A narrower field of view than the world camera keeps the gun from
    // looking stretched and oversized.
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.01, 10);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x30343a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);
    this.gunLight = new THREE.PointLight(PORTAL.colors[0], 0.4, 0.6, 2);
    this.gunLight.position.set(0, 0.05, -0.3);
    this.base = new THREE.Vector3();
    this.setSkin(skin);
    this.kick = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.color = new THREE.Color(PORTAL.colors[0]);
    this.targetColor = this.color.clone();
    this.holding = 0;
  }

  setSkin(skin) {
    if (this.gun) {
      this.root.remove(this.gun);
      disposeMeshes(this.gun);
    }
    const { group, coreMat, claws } = buildGunModel(skin);
    // The rifle is held turned in a little, so its side and prongs show.
    const arbiter = skin === 'arbiter';
    if (arbiter) group.add(buildGauntlet());
    group.scale.setScalar(arbiter ? 0.85 : 1);
    this.base.set(arbiter ? 0.2 : 0.22, arbiter ? -0.16 : -0.22, arbiter ? -0.62 : -0.56);
    this.yaw = arbiter ? 0.42 : 0.06;
    this.gun = group;
    this.coreMat = coreMat;
    this.claws = claws;
    this.gun.add(this.gunLight);
    this.root.add(this.gun);
  }

  fire(id) {
    this.kick = 1;
    this.targetColor.setHex(PORTAL.colors[id]);
  }

  addSway(dx, dy) {
    this.swayX = THREE.MathUtils.clamp(this.swayX + dx * 0.00035, -0.04, 0.04);
    this.swayY = THREE.MathUtils.clamp(this.swayY + dy * 0.00035, -0.04, 0.04);
  }

  update(dt, time, player, holding) {
    const moving = Math.min(1, player.speed / 5) * (player.body.onGround ? 1 : 0.2);
    const bobX = Math.sin(player.walkPhase) * 0.012 * moving;
    const bobY = -Math.abs(Math.cos(player.walkPhase)) * 0.012 * moving;
    const breathe = Math.sin(time * 1.6) * 0.002;
    this.kick = Math.max(0, this.kick - dt * 6);
    this.swayX *= Math.exp(-dt * 8);
    this.swayY *= Math.exp(-dt * 8);
    const k = this.kick * this.kick;
    this.gun.position.set(this.base.x + bobX - this.swayX, this.base.y + bobY + breathe + this.swayY, this.base.z + k * 0.06);
    this.gun.rotation.set(k * 0.18 + this.swayY * 2, this.yaw - this.swayX * 2, 0);

    this.holding += ((holding ? 1 : 0) - this.holding) * (1 - Math.exp(-dt * 10));
    const open = this.holding * 0.35 + Math.sin(time * 30) * 0.02 * this.holding;
    for (const c of this.claws) c.rotation[c.axis] = c.axis === 'y' ? 0.12 + open : c.sign * open * 0.5;
    this.color.lerp(this.targetColor, 1 - Math.exp(-dt * 12));
    this.coreMat.emissive.copy(this.color);
    this.coreMat.emissiveIntensity = 3 + this.holding * (2 + Math.sin(time * 20));
    this.gunLight.color.copy(this.color);
  }

  setSize(aspect) {
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 80 : 54; // portrait screens are narrow
    this.camera.updateProjectionMatrix();
  }
}

export function disposeMeshes(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [].concat(o.material)) m.dispose();
  });
}
