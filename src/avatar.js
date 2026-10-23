import * as THREE from 'three';
import { buildGunModel, disposeMeshes } from './gun.js';

// The player's figure, only ever seen through portals (and in shadow).
// Origin is at the feet; faces -z. Each skin builds the same moving parts:
// two legs swinging from the hips, a head and the arms holding the device.
export class Avatar {
  constructor(scene, layers, skin = 'subject') {
    this.layers = layers;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.setSkin(skin);
  }

  setSkin(skin) {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      disposeMeshes(child);
    }
    this.legs = [];
    if (skin === 'arbiter') this.buildArbiter();
    else this.buildSubject();

    const gun = buildGunModel(skin);
    gun.group.scale.setScalar(1.1);
    gun.group.position.set(0.05, 0.0, -0.42);
    this.gunCore = gun.coreMat;
    this.aim.add(gun.group);

    const layers = this.layers;
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
      o.layers.set(0);
      for (const l of layers) o.layers.enable(l);
      if (!layers.includes(0)) o.layers.disable(0);
    });
  }

  // Simple test subject in an orange jumpsuit with long-fall boots.
  buildSubject() {
    const suit = new THREE.MeshStandardMaterial({ color: 0xe0702a, roughness: 0.75 });
    const tank = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc99272, roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x2e1d14, roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0xc8cacc, roughness: 0.4, metalness: 0.5 });

    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.1 * s, 0.9, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.62, 4, 10), suit);
      leg.position.y = -0.4;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.24), boot);
      foot.position.set(0, -0.84, -0.04);
      const spring = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.25, 0.03), boot);
      spring.position.set(0, -0.72, 0.1);
      spring.rotation.x = 0.4;
      hip.add(leg, foot, spring);
      this.root.add(hip);
      this.legs.push(hip);
    }
    const waist = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.06, 8, 20), suit);
    waist.rotation.x = Math.PI / 2;
    waist.position.y = 0.95;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 4, 12), tank);
    torso.position.y = 1.2;
    torso.scale.z = 0.75;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), skin);
    neck.position.y = 1.47;

    this.head = new THREE.Group();
    this.head.position.y = 1.58;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), skin);
    headMesh.scale.set(0.9, 1.05, 0.95);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairCap.rotation.x = 0.35;
    hairCap.position.z = 0.01;
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), hair);
    bun.position.set(0, 0.02, 0.12);
    this.head.add(headMesh, hairCap, bun);

    // arms reach forward to hold the device
    this.aim = new THREE.Group();
    this.aim.position.y = 1.32;
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.42, 4, 8), skin);
      arm.position.set(0.17 * s, -0.05, -0.18);
      arm.rotation.set(Math.PI / 2 - 0.3, 0, s * 0.35);
      this.aim.add(arm);
    }
    this.root.add(waist, torso, neck, this.head, this.aim);
  }

  // A Sangheili warrior in silver ceremonial armour, styled after the Arbiter:
  // reverse-jointed legs, broad pauldrons, a long swept-back helmet crest and
  // four mandibles.
  buildArbiter() {
    const armor = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.32, metalness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x5a5f68, roughness: 0.4, metalness: 0.6 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x26262d, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x5f5244, roughness: 0.7 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa21a, emissiveIntensity: 2 });

    // A capsule from a to b.
    const limb = (a, b, r, mat) => {
      const dir = b.clone().sub(a);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, dir.length(), 4, 10), mat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return m;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.13 * s, 0.95, 0);
      // thigh forward to the knee, shin back to a raised ankle, long foot
      const knee = V(0, -0.42, -0.14);
      const ankle = V(0, -0.8, 0.08);
      const thigh = limb(V(0, 0, 0), knee, 0.075, suit);
      const thighPlate = limb(V(0.02 * s, -0.04, -0.03), V(0.02 * s, -0.34, -0.14), 0.085, armor);
      thighPlate.scale.set(1, 1, 0.7);
      const shin = limb(knee, ankle, 0.06, suit);
      const greave = limb(knee.clone().add(V(0, -0.04, -0.03)), ankle.clone().add(V(0, 0.12, -0.03)), 0.068, armor);
      const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), trim);
      kneeCap.position.copy(knee).add(V(0, 0, -0.03));
      const instep = limb(ankle, V(0, -0.9, -0.06), 0.05, suit);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.3), armor);
      foot.position.set(0, -0.91, -0.08);
      const toe = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 4), trim);
      toe.rotation.x = -Math.PI / 2;
      toe.position.set(0, -0.92, -0.27);
      hip.add(thigh, thighPlate, shin, greave, kneeCap, instep, foot, toe);
      this.root.add(hip);
      this.legs.push(hip);
    }

    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.16, 12), trim);
    pelvis.position.y = 0.98;
    const tasset = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.03), armor);
    tasset.position.set(0, 0.86, -0.17);
    tasset.rotation.x = 0.12;
    const abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.22, 12), suit);
    abdomen.position.y = 1.14;
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 14), armor);
    chest.scale.set(1.05, 0.8, 0.72);
    chest.position.set(0, 1.36, -0.01);
    const chestRidge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.05), trim);
    chestRidge.position.set(0, 1.34, -0.18);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.1), trim);
    back.position.set(0, 1.38, 0.16);

    // big pauldrons that sweep up and out
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), armor);
      pad.scale.set(1.15, 0.8, 1.1);
      pad.position.set(0.29 * s, 1.43, 0);
      pad.rotation.z = -0.45 * s;
      const flare = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.22), trim);
      flare.position.set(0.39 * s, 1.47, 0);
      flare.rotation.z = -0.5 * s;
      this.root.add(pad, flare);
    }

    const neck = limb(V(0, 1.44, 0.02), V(0, 1.55, -0.03), 0.06, skin);

    // Long head pointing forward, helmet crest swept back, mandibles below.
    this.head = new THREE.Group();
    this.head.position.y = 1.6;
    this.head.scale.setScalar(1.25);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), skin);
    skull.scale.set(0.85, 0.8, 1.35);
    skull.position.z = -0.04;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), armor);
    helmet.scale.set(0.9, 0.8, 1.5);
    helmet.position.set(0, 0.01, -0.02);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.36), trim);
    crest.position.set(0, 0.11, 0.1);
    crest.rotation.x = -0.32;
    const crestTip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 4), armor);
    crestTip.rotation.x = Math.PI / 2 - 0.3;
    crestTip.position.set(0, 0.17, 0.32);
    this.head.add(skull, helmet, crest, crestTip);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.24), armor);
      fin.position.set(0.075 * s, 0.03, 0.1);
      fin.rotation.set(-0.15, -0.25 * s, 0.25 * s);
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eye);
      e.position.set(0.055 * s, 0.005, -0.12);
      this.head.add(fin, e);
      for (const [x, y] of [[0.025, -0.03], [0.06, -0.045]]) {
        const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.1, 6), skin);
        tusk.position.set(x * s, y, -0.15);
        tusk.rotation.set(-Math.PI / 2 - 0.6, 0, -0.15 * s);
        this.head.add(tusk);
      }
    }

    this.aim = new THREE.Group();
    this.aim.position.y = 1.36;
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.44, 4, 8), suit);
      arm.position.set(0.22 * s, -0.05, -0.18);
      arm.rotation.set(Math.PI / 2 - 0.3, 0, s * 0.45);
      const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 6), armor);
      bracer.position.set(0.13 * s, -0.1, -0.32);
      bracer.rotation.set(Math.PI / 2 - 0.3, 0, s * 0.45);
      this.aim.add(arm, bracer);
    }
    this.root.add(pelvis, tasset, abdomen, chest, chestRidge, back, neck, this.head, this.aim);
  }

  pose(feet, yaw, pitch, walkPhase, moving, color) {
    this.root.position.copy(feet);
    this.root.rotation.set(0, yaw, 0);
    const swing = Math.sin(walkPhase) * 0.55 * moving;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.head.rotation.x = pitch * 0.6;
    this.aim.rotation.x = pitch * 0.9;
    this.gunCore.emissive.copy(color);
  }
}
