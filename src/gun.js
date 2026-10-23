import * as THREE from 'three';
import { PORTAL } from './config.js';
import { sweep, mergeByMaterial, armorBump } from './sculpt.js';

// The portal device model, pointing down -z: the group, the material that
// glows in the last portal's colour, and the claws that open while holding
// something.
export function buildGunModel() {
  const model = buildPortalDevice();
  mergeByMaterial(model.group);
  return model;
}

// The portal device: a glossy white shell swelling towards the back, a black
// ribbed barrel inside three curved claws, and a glass tube along the top
// with the glowing core inside. Points down -z.
function buildPortalDevice() {
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xc9cac8, roughness: 0.35, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.12,
    envMapIntensity: 0.8, normalMap: armorBump([1, 1]), normalScale: new THREE.Vector2(0.36, 0.36),
  });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9da2a8, roughness: 0.35, metalness: 0.6, envMapIntensity: 1.2, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.4, metalness: 0.7, envMapIntensity: 1.2 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xd8f0ff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, envMapIntensity: 2, depthWrite: false,
  });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(PORTAL.colors[0]), emissiveIntensity: 3 });
  const gun = new THREE.Group();
  const add = (geo, mat, parent = gun) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };

  // white shell: a rounded back swelling forward, then tapering to the collar
  add(sweep([[0, 0, 0.27], [0, 0, 0.22], [0, 0, 0.12], [0, 0, 0.0], [0, 0, -0.13]], {
    width: [0.015, 0.068, 0.08, 0.072, 0.056], height: [0.015, 0.07, 0.08, 0.072, 0.056], segments: 20, radial: 20,
  }), white);
  // grey panels inset along both sides
  for (const side of [0, 0.5]) {
    add(sweep([[0, 0, 0.18], [0, 0, 0.06], [0, 0, -0.08]], {
      width: [0.081, 0.083, 0.064], height: [0.081, 0.083, 0.064], arc: [side - 0.07, side + 0.07], segments: 16, radial: 8,
    }), grey);
  }
  // collar, ribbed barrel and the emitter tip
  add(sweep([[0, 0, -0.12], [0, 0, -0.16]], { width: [0.06, 0.056], segments: 2, radial: 20 }), dark);
  add(sweep([[0, 0, -0.15], [0, 0, -0.29]], { width: [0.038, 0.03], segments: 2, radial: 16 }), black);
  for (let i = 0; i < 4; i++) {
    const rib = add(new THREE.TorusGeometry(0.037 - i * 0.002, 0.005, 8, 24), dark);
    rib.position.z = -0.175 - i * 0.03;
  }
  const tip = add(new THREE.SphereGeometry(1, 20, 14), coreMat);
  tip.scale.set(0.022, 0.022, 0.012);
  tip.position.z = -0.292;

  // glass tube with the glowing core along the top, in two clamps
  const tube = add(sweep([[0, 0.072, 0.17], [0, 0.074, -0.08]], { width: 0.022, segments: 2, radial: 20 }), glass);
  tube.renderOrder = 1;
  add(sweep([[0, 0.072, 0.16], [0, 0.074, -0.07]], { width: 0.009, segments: 2, radial: 12 }), coreMat);
  for (const z of [0.15, -0.06]) {
    add(sweep([[0, 0.065, z + 0.012], [0, 0.065, z - 0.012]], { width: 0.028, height: 0.03, segments: 2, radial: 20 }), dark);
  }

  // grip and trigger
  add(sweep([[0, -0.05, 0.08], [0, -0.1, 0.095], [0, -0.14, 0.12]], { width: [0.022, 0.02, 0.022], height: [0.034, 0.03, 0.03], exp: 2.6, up: [0, 0, -1] }), dark);
  add(sweep([[0, -0.055, 0.045], [0, -0.075, 0.04], [0, -0.085, 0.05]], { width: 0.005, height: 0.004, up: [0, 0, -1], segments: 6 }), grey);

  // three curved claws around the barrel
  const claws = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI * 2) / 3 + Math.PI / 2;
    const arm = new THREE.Group();
    arm.position.set(0.05, 0, -0.14);
    add(sweep([[0.0, 0, 0.0], [0.018, 0, -0.07], [0.012, 0, -0.14], [-0.008, 0, -0.18]], {
      width: [0.012, 0.012, 0.01, 0.004], height: [0.016, 0.018, 0.014, 0.004], exp: 2.6, segments: 16, radial: 10,
    }), black, arm);
    arm.rotation.y = 0.12;
    pivot.add(arm);
    gun.add(pivot);
    claws.push(arm);
  }

  gun.traverse((o) => {
    if (o.isMesh && o.material !== glass) o.castShadow = true;
  });
  return { group: gun, coreMat, claws };
}

// The gun as seen in first person, drawn in its own pass on top of the world.
export class ViewModel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    // A narrower field of view than the world camera keeps the gun from
    // looking stretched and oversized.
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.01, 10);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x30343a, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);
    this.gunLight = new THREE.PointLight(PORTAL.colors[0], 0.4, 0.6, 2);
    this.gunLight.position.set(0, 0.05, -0.3);
    const { group, coreMat, claws } = buildGunModel();
    this.gun = group;
    this.coreMat = coreMat;
    this.claws = claws;
    this.gun.add(this.gunLight);
    this.root.add(this.gun);
    this.base = new THREE.Vector3(0.22, -0.22, -0.56);
    this.kick = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.color = new THREE.Color(PORTAL.colors[0]);
    this.targetColor = this.color.clone();
    this.holding = 0;
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
    this.gun.rotation.set(k * 0.18 + this.swayY * 2, 0.06 - this.swayX * 2, 0);

    this.holding += ((holding ? 1 : 0) - this.holding) * (1 - Math.exp(-dt * 10));
    const open = this.holding * 0.35 + Math.sin(time * 30) * 0.02 * this.holding;
    for (const c of this.claws) c.rotation.y = 0.12 + open;
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
