import * as THREE from 'three';
import { PORTAL } from './config.js';

// Portal device model built from primitives. Points down -z.
export function buildGunModel() {
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
    claws.push(arm);
  }

  gun.add(shell, back, collar, barrel, tip, tube, core, grip);
  gun.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
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
    const { group, coreMat, claws } = buildGunModel();
    this.gun = group;
    this.coreMat = coreMat;
    this.claws = claws;
    this.root = new THREE.Group();
    this.root.add(this.gun);
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x30343a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);
    this.gunLight = new THREE.PointLight(PORTAL.colors[0], 0.4, 0.6, 2);
    this.gunLight.position.set(0, 0.05, -0.3);
    this.gun.add(this.gunLight);
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
    for (const c of this.claws) c.rotation.y = 0.12 + this.holding * 0.35 + Math.sin(time * 30) * 0.02 * this.holding;
    this.color.lerp(this.targetColor, 1 - Math.exp(-dt * 12));
    this.coreMat.emissive.copy(this.color);
    this.coreMat.emissiveIntensity = 3 + this.holding * (2 + Math.sin(time * 20));
    this.gunLight.color.copy(this.color);
  }

  setSize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
