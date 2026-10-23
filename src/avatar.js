import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildGunModel, disposeMeshes } from './gun.js';
import { sweep, armorBump, weaveBump, skinBump } from './sculpt.js';

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

  // A Sangheili warrior in silver armour, styled after the Arbiter:
  // reverse-jointed legs, layered pauldrons, a high collar, a helmet with a
  // tall swept-back crest, and four mandibles lined with teeth.
  buildArbiter() {
    const armor = new THREE.MeshPhysicalMaterial({
      color: 0x9aa1aa, metalness: 0.8, roughness: 0.34, clearcoat: 0.4, clearcoatRoughness: 0.3,
      envMapIntensity: 1.8, bumpMap: armorBump([1, 1]), bumpScale: 1.2, side: THREE.DoubleSide,
    });
    const trim = new THREE.MeshStandardMaterial({ color: 0x4a4f58, metalness: 0.8, roughness: 0.35, envMapIntensity: 2, side: THREE.DoubleSide });
    const suit = new THREE.MeshStandardMaterial({ color: 0x24252c, roughness: 0.75, bumpMap: weaveBump([8, 6]), bumpScale: 1.5 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x564a3b, roughness: 0.6, bumpMap: skinBump([2, 2]), bumpScale: 2 });
    const bone = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.5 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa21a, emissiveIntensity: 2.5 });
    const add = (geo, mat, parent = this.root) => {
      const m = new THREE.Mesh(geo, mat);
      parent.add(m);
      return m;
    };
    const fwd = [0, 0, -1];

    // Legs: thigh forward to the knee, shin back to a raised ankle, then a
    // long armoured foot. Built in the hip's coordinates; outward is +x * s.
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.13 * s, 0.95, 0);
      const outer = s > 0 ? [-0.08, 0.38] : [0.12, 0.58];
      add(sweep([[0, 0.03, 0.01], [0, -0.2, -0.07], [0, -0.42, -0.13]], {
        width: [0.09, 0.085, 0.058], height: [0.095, 0.09, 0.062], up: fwd,
      }), suit, hip);
      add(sweep([[0, 0.0, 0.0], [0, -0.2, -0.08], [0, -0.38, -0.13]], {
        width: [0.1, 0.1, 0.07], height: [0.106, 0.1, 0.073], exp: 2.4, arc: outer, up: fwd,
      }), armor, hip);
      add(sweep([[0.09 * s, 0.08, 0.0], [0.115 * s, -0.05, -0.02], [0.105 * s, -0.17, -0.045]], {
        width: [0.07, 0.085, 0.05], height: 0.01, exp: 3, up: [s, 0, 0],
      }), trim, hip);
      add(sweep([[0, -0.33, -0.19], [0, -0.42, -0.215], [0, -0.5, -0.19]], {
        width: [0.045, 0.07, 0.04], height: [0.02, 0.036, 0.015], exp: 2.5, up: fwd,
      }), trim, hip);
      add(sweep([[0, -0.42, -0.13], [0, -0.62, -0.03], [0, -0.8, 0.07]], {
        width: [0.058, 0.05, 0.04], height: [0.062, 0.055, 0.045], up: fwd,
      }), suit, hip);
      add(sweep([[0, -0.46, -0.13], [0, -0.62, -0.04], [0, -0.77, 0.055]], {
        width: [0.07, 0.066, 0.052], height: [0.076, 0.07, 0.056], exp: 2.4, arc: [0, 0.5], up: fwd,
      }), armor, hip);
      add(sweep([[0, -0.8, 0.07], [0, -0.87, 0.0], [0, -0.915, -0.06]], {
        width: [0.042, 0.04, 0.045], height: [0.042, 0.036, 0.03], exp: 2.3, up: fwd,
      }), armor, hip);
      add(sweep([[0, -0.925, 0.03], [0, -0.93, -0.08], [0, -0.935, -0.2]], {
        width: [0.055, 0.065, 0.03], height: [0.03, 0.028, 0.014], exp: 3,
      }), armor, hip);
      for (const k of [-1, 1]) {
        add(sweep([[0.025 * k, -0.932, -0.18], [0.03 * k, -0.937, -0.24], [0.03 * k, -0.952, -0.27]], {
          width: [0.014, 0.01, 0.002], height: [0.012, 0.008, 0.002],
        }), trim, hip);
      }
      add(sweep([[0, -0.9, 0.05], [0, -0.93, 0.11]], { width: [0.015, 0.002], height: [0.012, 0.002] }), trim, hip);
      this.root.add(hip);
      this.legs.push(hip);
    }

    // pelvis, belt and the plates hanging from it
    add(sweep([[0, 0.88, 0], [0, 0.96, 0], [0, 1.04, 0]], { width: [0.17, 0.2, 0.17], height: [0.12, 0.14, 0.12], exp: 2.4, up: fwd }), trim);
    add(sweep([[0, 0.985, 0], [0, 1.03, 0]], { width: 0.207, height: 0.152, exp: 2.6, up: fwd, segments: 2, radial: 28 }), armor);
    add(sweep([[0, 0.98, -0.15], [0, 0.86, -0.18], [0, 0.72, -0.17]], { width: [0.09, 0.085, 0.055], height: 0.012, exp: 4, up: fwd }), armor);
    add(sweep([[0, 0.98, 0.14], [0, 0.84, 0.17], [0, 0.7, 0.16]], { width: [0.1, 0.09, 0.06], height: 0.012, exp: 4, up: [0, 0, 1] }), trim);
    for (const s of [-1, 1]) {
      add(sweep([[0.13 * s, 0.98, -0.1], [0.16 * s, 0.86, -0.12], [0.17 * s, 0.76, -0.1]], {
        width: [0.06, 0.06, 0.04], height: 0.01, exp: 4, up: [0.6 * s, 0, -0.8],
      }), armor);
    }

    // abdomen with banded plates, then the chest
    add(sweep([[0, 1.0, 0.0], [0, 1.1, -0.005], [0, 1.2, 0]], { width: [0.16, 0.15, 0.18], height: [0.115, 0.11, 0.13], up: fwd }), suit);
    for (let k = 0; k < 3; k++) {
      add(sweep([[0, 1.035 + 0.05 * k, 0], [0, 1.075 + 0.05 * k, 0]], {
        width: 0.158 + 0.006 * k, height: 0.118 + 0.006 * k, exp: 2.5, arc: [0.02, 0.48], up: fwd, segments: 3,
      }), armor);
    }
    add(sweep([[0, 1.18, 0.0], [0, 1.3, -0.015], [0, 1.42, 0.0], [0, 1.5, 0.02]], {
      width: [0.19, 0.26, 0.27, 0.17], height: [0.14, 0.175, 0.17, 0.12], exp: 2.5, up: fwd, radial: 28,
    }), armor);
    add(sweep([[0, 1.22, -0.145], [0, 1.33, -0.19], [0, 1.46, -0.16]], { width: [0.008, 0.014, 0.008], height: [0.012, 0.02, 0.01], up: fwd }), trim);
    for (const s of [-1, 1]) {
      add(sweep([[0.06 * s, 1.24, -0.15], [0.13 * s, 1.36, -0.178], [0.12 * s, 1.47, -0.14]], {
        width: [0.04, 0.08, 0.06], height: 0.014, exp: 3, up: [0.25 * s, 0, -1],
      }), armor);
    }
    add(sweep([[0, 1.2, 0.12], [0, 1.34, 0.155], [0, 1.48, 0.12]], { width: [0.12, 0.16, 0.12], height: [0.035, 0.05, 0.035], exp: 3, up: [0, 0, 1] }), armor);
    add(sweep([[-0.13, 1.47, -0.04], [-0.12, 1.53, 0.06], [0, 1.57, 0.11], [0.12, 1.53, 0.06], [0.13, 1.47, -0.04]], {
      width: [0.02, 0.025, 0.025, 0.025, 0.02], height: [0.035, 0.05, 0.06, 0.05, 0.035], segments: 28,
    }), armor);

    // pauldrons: three overlapping plates, each lower and wider than the last
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.08, 16, 12), suit).position.set(0.27 * s, 1.42, 0);
      const arc = s > 0 ? [0.2, 0.62] : [-0.12, 0.3];
      for (let k = 0; k < 3; k++) {
        const x = (0.3 + 0.014 * k) * s, y = 1.5 - 0.04 * k;
        add(sweep([[x, y - 0.02, -0.15], [x + 0.03 * s, y + 0.02, 0.0], [x, y - 0.02, 0.15]], {
          width: [0.08, 0.125 + 0.015 * k, 0.08], height: [0.055, 0.08 + 0.008 * k, 0.055], exp: 2.2, arc, radial: 14,
        }), k === 2 ? trim : armor);
      }
    }
    add(sweep([[0, 1.46, 0.03], [0, 1.54, 0.0], [0, 1.6, -0.035]], { width: [0.065, 0.055, 0.05], height: [0.07, 0.06, 0.055], up: fwd }), skin);

    // Head: a long skull under a helmet with a tall crest, swept-back fins and
    // four mandibles.
    this.head = new THREE.Group();
    this.head.position.set(0, 1.6, -0.02);
    this.head.scale.setScalar(1.15);
    const head = this.head;
    add(sweep([[0, 0.03, 0.12], [0, 0.035, 0.04], [0, 0.015, -0.06], [0, -0.015, -0.15], [0, -0.03, -0.2], [0, -0.035, -0.215]], {
      width: [0.045, 0.08, 0.075, 0.055, 0.03, 0.006], height: [0.04, 0.075, 0.07, 0.05, 0.025, 0.006],
    }), skin, head);
    add(sweep([[0, -0.03, -0.02], [0, -0.045, -0.1]], { width: 0.04, height: 0.02 }), skin, head);
    add(sweep([[0, 0.035, 0.14], [0, 0.045, 0.04], [0, 0.03, -0.06], [0, 0.01, -0.12]], {
      width: [0.05, 0.092, 0.088, 0.06], height: [0.05, 0.088, 0.082, 0.05], exp: 2.3, arc: [-0.04, 0.54], radial: 24,
    }), armor, head);
    add(sweep([[-0.07, 0.03, -0.09], [0, 0.045, -0.125], [0.07, 0.03, -0.09]], { width: 0.014, height: 0.012 }), trim, head);
    add(sweep([[0, 0.075, -0.07], [0, 0.12, 0.0], [0, 0.165, 0.1], [0, 0.19, 0.22], [0, 0.2, 0.3]], {
      width: [0.006, 0.01, 0.01, 0.007, 0.001], height: [0.012, 0.05, 0.055, 0.04, 0.004], segments: 32,
    }), armor, head);
    for (const s of [-1, 1]) {
      add(sweep([[0.075 * s, 0.0, 0.0], [0.08 * s, -0.03, -0.07], [0.06 * s, -0.04, -0.12]], {
        width: [0.035, 0.03, 0.015], height: 0.008, up: [s, 0, 0],
      }), armor, head);
      for (let k = 0; k < 2; k++) {
        add(sweep([[0.07 * s, 0.04 - 0.03 * k, 0.0], [0.095 * s, 0.05 - 0.03 * k, 0.1], [0.11 * s, 0.07 - 0.03 * k, 0.2 - 0.04 * k]], {
          width: [0.02, 0.02, 0.003], height: 0.005, up: [s, 0, 0],
        }), k ? trim : armor, head);
      }
      const e = add(new THREE.SphereGeometry(0.011, 10, 8), eye, head);
      e.position.set(0.055 * s, 0.0, -0.1);
      e.scale.y = 0.6;
      for (let k = 0; k < 2; k++) {
        const bx = s * (0.028 + 0.022 * k), dy = 0.012 * k;
        const path = [[bx, -0.02 - dy, -0.1], [bx * 1.25, -0.045 - dy, -0.16], [bx * 1.05, -0.06 - dy, -0.215], [bx * 0.8, -0.066 - dy, -0.245]];
        add(sweep(path, { width: [0.014, 0.012, 0.008, 0.002], height: [0.012, 0.01, 0.007, 0.002] }), skin, head);
        for (let i = 1; i < 4; i++) {
          const [x, y, z] = path[i];
          const tooth = add(new THREE.ConeGeometry(0.004, 0.016, 5), bone, head);
          tooth.position.set(x - s * 0.009, y, z + 0.012);
          tooth.rotation.z = s * Math.PI / 2;
        }
      }
    }

    // Arms reach forward to hold the rifle: right hand on the grip, left
    // hand under the prongs.
    this.aim = new THREE.Group();
    this.aim.position.y = 1.36;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const arms = [
      [V(0.27, 0.06, 0), V(0.24, -0.17, -0.1), V(0.07, -0.12, -0.27)],
      [V(-0.27, 0.06, 0), V(-0.22, -0.15, -0.16), V(-0.0, -0.1, -0.47)],
    ];
    for (const [S, E, W] of arms) {
      const mid = S.clone().lerp(E, 0.5).add(V(0, 0, 0.02));
      add(sweep([S, mid, E].map((v) => v.toArray()), { width: [0.07, 0.065, 0.05], height: [0.07, 0.065, 0.05], up: fwd }), suit, this.aim);
      add(sweep([S.clone().lerp(E, 0.1), S.clone().lerp(E, 0.7)].map((v) => v.toArray()), {
        width: [0.08, 0.07], height: [0.08, 0.07], exp: 2.4, up: fwd, segments: 6,
      }), armor, this.aim);
      add(new THREE.SphereGeometry(0.05, 14, 10), trim, this.aim).position.copy(E);
      add(sweep([E, E.clone().lerp(W, 0.5), W].map((v) => v.toArray()), { width: [0.05, 0.045, 0.035], height: [0.05, 0.045, 0.035], up: fwd }), suit, this.aim);
      add(sweep([E.clone().lerp(W, 0.2), W.clone().lerp(E, 0.12)].map((v) => v.toArray()), {
        width: [0.064, 0.05], height: [0.062, 0.048], exp: 2.5, up: fwd, segments: 6,
      }), armor, this.aim);
      const hand = add(new RoundedBoxGeometry(0.05, 0.06, 0.07, 2, 0.015), suit, this.aim);
      hand.position.copy(W).add(V(0, -0.01, -0.03));
    }
    this.root.add(this.head, this.aim);
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
