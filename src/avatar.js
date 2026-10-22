import * as THREE from 'three';
import { buildGunModel } from './gun.js';

// Simple test-subject figure, only ever seen through portals (and in shadow).
// Origin is at the feet; faces -z.
export class Avatar {
  constructor(scene, layers) {
    const suit = new THREE.MeshStandardMaterial({ color: 0xe0702a, roughness: 0.75 });
    const tank = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc99272, roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x2e1d14, roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0xc8cacc, roughness: 0.4, metalness: 0.5 });

    this.root = new THREE.Group();
    this.legs = [];
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
    const gun = buildGunModel();
    gun.group.scale.setScalar(1.1);
    gun.group.position.set(0.05, 0.0, -0.42);
    this.gunCore = gun.coreMat;
    this.aim.add(gun.group);

    this.root.add(waist, torso, neck, this.head, this.aim);
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
      o.layers.set(0);
      for (const l of layers) o.layers.enable(l);
      if (!layers.includes(0)) o.layers.disable(0);
    });
    scene.add(this.root);
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
