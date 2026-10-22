import * as THREE from 'three';
import { PLAYER, PHYSICS } from './config.js';
import { Body } from './physics.js';
import { teleportBody } from './portals.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor() {
    this.body = new Body(PLAYER.half);
    this.body.refOffset = PLAYER.eyeOffset; // teleport when the eye passes through
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0; // leftover roll after exiting a portal, eased back to level
    this.walkPhase = 0;
    this.speed = 0;
    this.landed = false;
    this._wish = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  spawn(feet, yaw) {
    this.body.pos.set(feet[0], feet[1] + PLAYER.half[1] + 0.01, feet[2]);
    this.body.vel.set(0, 0, 0);
    this.body.portalMode = null;
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
  }

  get eye() {
    return new THREE.Vector3(this.body.pos.x, this.body.pos.y + PLAYER.eyeOffset, this.body.pos.z);
  }

  look(dx, dy) {
    this.yaw -= dx * PLAYER.lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * PLAYER.lookSensitivity, -1.55, 1.55);
  }

  quaternion(out = new THREE.Quaternion()) {
    return out.setFromEuler(this._e.set(this.pitch, this.yaw, this.roll, 'YXZ'));
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion(this._q));
  }

  update(dt, input, physics, onTeleport) {
    const body = this.body;
    const v = body.vel;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const wish = this._wish.set(0, 0, 0);
    wish.x += fx * input.forward + -fz * input.strafe;
    wish.z += fz * input.forward + fx * input.strafe;
    if (wish.lengthSq() > 1) wish.normalize();
    const wishSpeed = wish.length() * PLAYER.walkSpeed;
    if (wishSpeed > 0) wish.normalize();

    const wasOnGround = body.onGround;
    if (wasOnGround) {
      // friction
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0) {
        const drop = Math.max(speed, PLAYER.stopSpeed) * PLAYER.friction * dt;
        const k = Math.max(speed - drop, 0) / speed;
        v.x *= k;
        v.z *= k;
      }
      this.accelerate(wish, wishSpeed, PLAYER.groundAccel, dt);
      if (input.jump) {
        v.y = PLAYER.jumpSpeed;
        body.onGround = false;
      }
    } else {
      this.accelerate(wish, wishSpeed, PLAYER.airAccel, dt);
    }
    v.y = Math.max(v.y - PHYSICS.gravity * dt, -PHYSICS.maxFallSpeed);

    const fallSpeed = -v.y;
    physics.moveBody(body, dt, {
      onCross: (P) => {
        this.teleport(P);
        physics.depenetrate(body);
        onTeleport?.(P);
      },
    });
    this.landed = !wasOnGround && body.onGround && fallSpeed > 6;

    this.speed = Math.hypot(v.x, v.z);
    if (body.onGround) this.walkPhase += this.speed * dt * 1.9;
  }

  accelerate(wish, wishSpeed, accel, dt) {
    if (wishSpeed <= 0) return;
    const v = this.body.vel;
    const current = v.x * wish.x + v.z * wish.z;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const a = Math.min(accel * wishSpeed * dt, add);
    v.x += wish.x * a;
    v.z += wish.z * a;
  }

  teleport(P) {
    // Rotate the view through the portal, then stand back upright, keeping the
    // look direction and easing out whatever roll is left over.
    const q = this.quaternion(new THREE.Quaternion()).premultiply(P.rotToPartner);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let hx = fwd.x, hz = fwd.z;
    if (Math.hypot(hx, hz) < 0.05) {
      const s = fwd.y < 0 ? 1 : -1;
      hx = up.x * s;
      hz = up.z * s;
    }
    this.yaw = Math.atan2(-hx, -hz);
    this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)), -1.55, 1.55);
    const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const upU = UP.clone().applyQuaternion(upright);
    const zAxis = fwd.clone().negate();
    this.roll = Math.atan2(new THREE.Vector3().crossVectors(upU, up).dot(zAxis), upU.dot(up));

    teleportBody(this.body, P, new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)));
  }

  updateView(dt) {
    this.roll *= Math.exp(-dt * 5);
    if (Math.abs(this.roll) < 1e-3) this.roll = 0;
  }
}
