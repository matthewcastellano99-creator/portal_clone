import * as THREE from 'three';
import { PORTAL } from './config.js';

// Device models built from primitives. Both point down -z and return the same
// parts: the group, the material that glows in the last portal's colour, and
// the claws that open while holding something.
export function buildGunModel(skin = 'subject') {
  return skin === 'arbiter' ? buildPlasmaRifle() : buildPortalDevice();
}

// A tool in the shape of a Covenant plasma rifle: a bulb at the back, two
// curved prongs forming an open mouth at the front, and glowing side vents.
function buildPlasmaRifle() {
  const shell = new THREE.MeshStandardMaterial({ color: 0x8466b8, roughness: 0.28, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2438, roughness: 0.5, metalness: 0.5 });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(PORTAL.colors[0]), emissiveIntensity: 3 });
  const gun = new THREE.Group();
  const along = (geo) => geo.rotateX(Math.PI / 2);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 28, 18), shell);
  bulb.scale.set(0.85, 0.95, 1.7);
  bulb.position.z = 0.1;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.14), dark);
  fin.position.set(0, 0.062, 0.1);

  // Two prongs, each a thick base sweeping out of the bulb and a tip curling
  // back in, hinged at the bulb so they can flex open.
  const claws = [];
  const lump = (rx, ry, rz) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shell);
    m.scale.set(rx, ry, rz);
    return m;
  };
  for (const s of [1, -1]) {
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.03 * s, 0.0);
    const base = lump(0.048, 0.03, 0.085);
    base.position.set(0, 0.018 * s, -0.06);
    base.rotation.x = 0.35 * s;
    const tip = lump(0.04, 0.022, 0.06);
    tip.position.set(0, 0.03 * s, -0.14);
    tip.rotation.x = -0.45 * s;
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.07), coreMat);
    inner.position.set(0, 0.0, -0.1);
    inner.rotation.x = 0.2 * s;
    hinge.add(base, tip, inner);
    gun.add(hinge);
    claws.push({ rotation: hinge.rotation, axis: 'x', sign: s });
  }

  const emitter = new THREE.Mesh(along(new THREE.CylinderGeometry(0.016, 0.022, 0.1, 16)), coreMat);
  emitter.position.z = -0.07;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), coreMat);
  tip.position.z = -0.13;

  // three glowing vents on each side of the bulb
  for (const x of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05 - i * 0.008, 0.012), coreMat);
      vent.position.set(x * 0.058, 0.005, 0.07 + i * 0.035);
      vent.rotation.x = -0.3;
      gun.add(vent);
    }
  }

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.11, 0.05), dark);
  grip.position.set(0, -0.1, 0.1);
  grip.rotation.x = -0.35;
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 8, 16, Math.PI), dark);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.07, 0.06);

  gun.add(bulb, fin, emitter, tip, grip, guard);
  gun.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group: gun, coreMat, claws };
}

// The armoured forearm and three-fingered hand that hold the rifle in first
// person (Arbiter skin only). Lives in the gun's own coordinates.
function buildGauntlet() {
  const armor = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.55 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x26262d, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x5f5244, roughness: 0.7 });
  const g = new THREE.Group();
  const from = new THREE.Vector3(0.0, -0.14, 0.12);
  const to = new THREE.Vector3(0.1, -0.36, 0.42);
  const dir = to.clone().sub(from);
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, dir.length(), 4, 12), suit);
  arm.position.copy(from).addScaledVector(dir, 0.5);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, dir.length() * 0.75, 6), armor);
  plate.position.copy(arm.position).addScaledVector(dir, 0.08);
  plate.quaternion.copy(arm.quaternion);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.07), suit);
  hand.position.set(0, -0.12, 0.1);
  for (let i = 0; i < 3; i++) {
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.05, 3, 6), skin);
    finger.position.set(-0.035, -0.095 + i * 0.022, 0.085);
    finger.rotation.z = Math.PI / 2;
    g.add(finger);
  }
  g.add(arm, plate, hand);
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
    this.base.set(arbiter ? 0.19 : 0.22, arbiter ? -0.17 : -0.22, arbiter ? -0.52 : -0.56);
    this.yaw = arbiter ? 0.28 : 0.06;
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
