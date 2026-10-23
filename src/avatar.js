import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildGunModel } from './gun.js';
import { mergeByMaterial } from './sculpt.js';

// The player's figure: seen from behind in third person, and through portals
// and in shadow in first person. Origin is at the feet; faces -z. It has two
// legs swinging from the hips with a knee joint each, a head, and arms
// holding the device.
//
// The look is deliberately simple and geometric: a few clean shapes with
// bold silhouettes and a small palette, rather than an attempt at realism.
export class Avatar {
  constructor(scene, layers) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // squashes and stretches
    this.root.add(this.body);
    scene.add(this.root);
    this.squash = 0; // landing squash, springs back to 0
    this.squashVel = 0;
    this.lastY = null;
    this.lastTime = 0;
    this.wasAir = 0;
    this.legs = [];
    this.knees = [];
    this.buildRobot();

    this.aimHeight = this.aim.position.y;
    const gun = buildGunModel();
    gun.group.scale.setScalar(1.1);
    gun.group.position.set(0.05, 0.0, -0.42);
    this.gunCore = gun.coreMat;
    this.aim.add(gun.group);
    this.muzzlePoint = new THREE.Object3D();
    this.muzzlePoint.position.set(0, 0, -0.28);
    gun.group.add(this.muzzlePoint);

    mergeByMaterial(this.body);
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
      o.layers.set(0);
      for (const l of layers) o.layers.enable(l);
      if (!layers.includes(0)) o.layers.disable(0);
    });
  }

  // A small test robot in glossy white plastic over dark grey joints, with
  // one big glowing eye, and a blue and an orange ring on its shoulders.
  buildRobot() {
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xd2d3cf, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.8 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.45, metalness: 0.5 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.15, metalness: 0.6 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x8fe0ff, emissiveIntensity: 2.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0c2c5a, emissive: 0x2a8cff, emissiveIntensity: 1.4 });
    const orange = new THREE.MeshStandardMaterial({ color: 0x5a2c08, emissive: 0xff8a1c, emissiveIntensity: 1.4 });
    const { add, limb } = parts(this.body);

    // legs: a thin dark thigh, a white shin shell and a chunky white foot
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.11 * s, 0.84, 0);
      add(new THREE.SphereGeometry(0.06, 16, 12), joint, hip);
      limb([0, 0, 0], [0, -0.38, 0], 0.05, 0.042, 12, joint, hip);
      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0);
      hip.add(knee);
      add(new THREE.SphereGeometry(0.052, 16, 12), joint, knee);
      add(new THREE.CapsuleGeometry(0.066, 0.18, 6, 16), shell, knee).position.y = -0.17;
      const foot = add(new RoundedBoxGeometry(0.14, 0.08, 0.24, 3, 0.035), shell, knee);
      foot.position.set(0, -0.395, -0.035);
      const sole = add(new RoundedBoxGeometry(0.145, 0.03, 0.245, 2, 0.012), joint, knee);
      sole.position.set(0, -0.43, -0.035);
      this.body.add(hip);
      this.legs.push(hip);
      this.knees.push(knee);
    }

    // hips, an egg-shaped body with a glowing core, neck and shoulders
    add(new THREE.SphereGeometry(0.15, 20, 14), joint).position.y = 0.86;
    const torso = add(new THREE.SphereGeometry(0.25, 32, 24), shell);
    torso.position.y = 1.16;
    torso.scale.set(1, 1.12, 0.84);
    const ring = add(new THREE.TorusGeometry(0.19, 0.03, 10, 32), joint);
    ring.position.y = 0.94;
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(1, 0.84, 1);
    const core = add(new THREE.CircleGeometry(0.05, 24), eye);
    core.position.set(0, 1.2, -0.212);
    core.rotation.y = Math.PI;
    const coreRim = add(new THREE.TorusGeometry(0.055, 0.012, 8, 24), joint);
    coreRim.position.set(0, 1.2, -0.21);
    limb([0, 1.38, 0], [0, 1.47, 0], 0.05, 0.045, 12, joint);
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.07, 16, 12), joint).position.set(0.26 * s, 1.34, 0);
      const band = add(new THREE.TorusGeometry(0.072, 0.014, 8, 24), s < 0 ? blue : orange);
      band.position.set(0.26 * s, 1.34, 0);
      band.rotation.y = Math.PI / 2;
    }

    // head: a rounded box with a dark visor and one big eye
    this.head = new THREE.Group();
    this.head.position.y = 1.58;
    const h = this.head;
    add(new RoundedBoxGeometry(0.36, 0.26, 0.3, 4, 0.09), shell, h);
    const face = add(new RoundedBoxGeometry(0.29, 0.17, 0.04, 3, 0.025), visor, h);
    face.position.z = -0.14;
    const iris = add(new THREE.SphereGeometry(0.052, 20, 14), eye, h);
    iris.position.z = -0.155;
    iris.scale.z = 0.5;
    const rim = add(new THREE.TorusGeometry(0.064, 0.013, 8, 24), joint, h);
    rim.position.z = -0.162;
    for (const s of [-1, 1]) {
      const ear = add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), joint, h);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(0.185 * s, 0, 0.02);
    }
    limb([0.07, 0.12, 0.05], [0.1, 0.23, 0.09], 0.008, 0.008, 8, joint, h);
    add(new THREE.SphereGeometry(0.018, 12, 8), eye, h).position.set(0.1, 0.23, 0.09);

    // arms: right hand on the grip, left hand under the barrel
    this.aim = new THREE.Group();
    this.aim.position.y = 1.32;
    const arms = parts(this.aim);
    for (const [S, E, W] of [
      [[0.26, 0.02, 0], [0.24, -0.16, -0.12], [0.07, -0.1, -0.29]],
      [[-0.26, 0.02, 0], [-0.2, -0.14, -0.2], [0.0, -0.06, -0.46]],
    ]) {
      arms.limb(S, E, 0.038, 0.034, 10, joint);
      arms.add(new THREE.SphereGeometry(0.042, 14, 10), joint).position.fromArray(E);
      arms.limb(E, W, 0.05, 0.042, 16, shell, undefined, true);
      arms.add(new THREE.SphereGeometry(0.048, 16, 12), shell).position.fromArray(W).add(new THREE.Vector3(0, -0.01, -0.03));
    }
    this.body.add(this.head, this.aim);
  }

  // World position of the device's tip, where shots start.
  muzzle() {
    this.root.updateMatrixWorld(true);
    return this.muzzlePoint.getWorldPosition(new THREE.Vector3());
  }

  // Walk cycle: legs swing from the hips and bend at the knee on the way
  // forward, the body bobs, sways and leans into the step. In the air the
  // legs tuck; rising and falling stretch the body, and landing squashes it.
  pose(feet, yaw, pitch, walkPhase, moving, color, air = 0, time = 0) {
    const dt = THREE.MathUtils.clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;
    const vy = this.lastY === null || dt === 0 ? 0 : (feet.y - this.lastY) / dt;
    this.lastY = feet.y;
    if (this.wasAir && !air) this.squashVel -= Math.min(2.2, 0.6 + Math.max(0, -vy) * 0.12);
    this.wasAir = air;
    // a damped spring brings the squash back to rest
    this.squashVel += (-180 * this.squash - 16 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    const stretch = air * THREE.MathUtils.clamp(Math.abs(vy) * 0.012, 0, 0.12);
    const sy = THREE.MathUtils.clamp(1 + this.squash + stretch, 0.75, 1.2);
    this.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));

    const bob = -Math.abs(Math.sin(walkPhase)) * 0.045 * moving + Math.sin(time * 1.8) * 0.008 * (1 - moving);
    this.root.position.set(feet.x, feet.y, feet.z);
    this.body.position.y = bob;
    this.root.rotation.set(0, yaw, 0);
    this.body.rotation.set(-0.07 * moving, Math.sin(walkPhase) * 0.06 * moving, Math.sin(walkPhase) * 0.04 * moving, 'YXZ');
    for (let i = 0; i < 2; i++) {
      const phase = walkPhase + i * Math.PI;
      this.legs[i].rotation.x = Math.sin(phase) * 0.6 * moving + 0.5 * air * (i ? 0.6 : 1);
      this.knees[i].rotation.x = -Math.max(0, Math.cos(phase)) * 0.9 * moving - 0.8 * air;
    }
    this.head.rotation.x = pitch * 0.6;
    this.head.rotation.z = Math.sin(walkPhase) * 0.04 * moving;
    this.aim.rotation.x = pitch * 0.9;
    this.aim.position.y = this.aimHeight + Math.sin(walkPhase * 2) * 0.01 * moving;
    this.gunCore.emissive.copy(color);
  }
}

// Helpers for building a figure out of simple shapes inside `group`.
function parts(group) {
  const add = (geo, mat, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  // A tapered prism or rod from point a to point b (radius r0 at a, r1 at b).
  // `capped` closes the ends; open rods are hidden inside joints anyway.
  const limb = (a, b, r0, r1, sides, mat, parent = group, capped = true) => {
    const A = new THREE.Vector3().fromArray(a), B = new THREE.Vector3().fromArray(b);
    const dir = B.clone().sub(A);
    const m = add(new THREE.CylinderGeometry(r1, r0, dir.length(), sides, 1, !capped), mat, parent);
    m.position.copy(A).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };
  return { add, limb };
}
