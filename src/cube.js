import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CUBE, PHYSICS } from './config.js';
import { Body } from './physics.js';
import { cubeFaceTextures } from './textures.js';

const GLOW_IDLE = new THREE.Color(0x7fd2ff);
const GLOW_ACTIVE = new THREE.Color(0xffa040);

// Snap a rotation to the nearest of the 24 axis-aligned orientations.
function snapQuaternion(q, out) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const cols = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  m.extractBasis(cols[0], cols[1], cols[2]);
  const snap = (v) => {
    const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
    if (ax >= ay && ax >= az) return v.set(Math.sign(v.x), 0, 0);
    if (ay >= az) return v.set(0, Math.sign(v.y), 0);
    return v.set(0, 0, Math.sign(v.z));
  };
  snap(cols[0]);
  snap(cols[1]);
  // keep the basis orthogonal and right-handed
  if (Math.abs(cols[0].dot(cols[1])) > 0.5) cols[1].set(cols[0].y, cols[0].z, cols[0].x);
  cols[2].crossVectors(cols[0], cols[1]);
  return out.setFromRotationMatrix(m.makeBasis(cols[0], cols[1], cols[2]));
}

export class WeightedCube {
  constructor(scene, spawn) {
    this.spawn = new THREE.Vector3(...spawn);
    const h = CUBE.size / 2;
    this.body = new Body([h, h, h]);
    this.held = false;
    this.via = null; // portal the player looks through to see the held cube
    this.strain = 0; // how long the held cube has been stuck out of reach
    this.activated = false;
    this.glow = GLOW_IDLE.clone();
    this.visualQuat = new THREE.Quaternion();
    this.targetQuat = new THREE.Quaternion();

    const { map, emissiveMap } = cubeFaceTextures();
    this.material = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: this.glow,
      emissiveIntensity: 2.2,
      roughness: 0.42,
      metalness: 0.25,
      envMapIntensity: 0.8,
    });
    const geo = new RoundedBoxGeometry(CUBE.size, CUBE.size, CUBE.size, 4, 0.06);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Copy drawn at the far side of a portal while the cube is part way through.
    this.clone = new THREE.Mesh(geo, this.material);
    this.clone.castShadow = true;
    this.clone.matrixAutoUpdate = false;
    this.clone.visible = false;
    scene.add(this.mesh, this.clone);
    this.reset();
  }

  reset() {
    this.body.pos.copy(this.spawn);
    this.body.vel.set(0, 0, 0);
    this.body.portalMode = null;
    this.held = false;
    this.via = null;
    this.visualQuat.identity();
    this.targetQuat.identity();
  }

  // Free-falling cube physics.
  updateFree(dt, physics, onCross) {
    const v = this.body.vel;
    v.y = Math.max(v.y - PHYSICS.gravity * dt, -PHYSICS.maxFallSpeed);
    physics.moveBody(this.body, dt, { ignore: this.body.box, onCross });
    if (this.body.onGround) {
      const k = Math.exp(-10 * dt);
      v.x *= k;
      v.z *= k;
    }
  }

  // Spring the held cube towards a target point.
  updateHeld(dt, physics, target, onCross) {
    const v = this.body.vel;
    v.subVectors(target, this.body.pos).multiplyScalar(14);
    if (v.length() > 24) v.setLength(24);
    physics.moveBody(this.body, dt, { ignore: this.body.box, onCross });
  }

  // Ease towards a centred position when resting on the button.
  settleOnto(dt, center) {
    if (this.held || !this.body.onGround) return;
    const dx = center.x - this.body.pos.x;
    const dz = center.z - this.body.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9 && d > 0.01) {
      this.body.vel.x += dx * 30 * dt;
      this.body.vel.z += dz * 30 * dt;
    }
  }

  setActivated(on) {
    this.activated = on;
  }

  updateVisual(dt) {
    if (!this.held) snapQuaternion(this.visualQuat, this.targetQuat);
    this.visualQuat.slerp(this.targetQuat, 1 - Math.exp(-12 * dt));
    this.mesh.position.copy(this.body.pos);
    this.mesh.quaternion.copy(this.visualQuat);
    this.glow.lerp(this.activated ? GLOW_ACTIVE : GLOW_IDLE, 1 - Math.exp(-6 * dt));
    this.material.emissive.copy(this.glow);
  }

  updateClone() {
    const P = this.body.portalMode;
    this.clone.visible = !!(P && P.linked);
    if (this.clone.visible) {
      this.mesh.updateMatrix();
      this.clone.matrix.multiplyMatrices(P.toPartner, this.mesh.matrix);
    }
  }

  // Rotate the visual orientation when the cube goes through a portal.
  applyPortalRotation(q) {
    this.visualQuat.premultiply(q);
    this.targetQuat.premultiply(q);
  }
}
