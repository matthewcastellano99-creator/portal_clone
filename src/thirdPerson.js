import * as THREE from 'three';

// Over-the-shoulder camera. A boom runs from just beside the player's head
// back along the view direction. It stops short of walls, and it passes
// through portals, so the camera can watch the player from the far side of
// one. The crosshair ray starts at the boom's pivot, beside the head.
export class ThirdPersonCamera {
  constructor() {
    this.distance = 3.1; // boom length when nothing is in the way
    this.shoulder = 0.6; // pivot offset to the right of the head
    this.lift = 0.32; // and above it
    this.length = this.distance; // current (eased) boom length
    this.pivot = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._segments = [];
  }

  reset() {
    this.length = this.distance;
    this.height = null;
  }

  // Places `camera` behind the player, whose eye is drawn at `eyeAt`.
  // `rayPortal(origin, dir, maxT)` returns the nearest linked portal a ray
  // enters, if any. `snap` skips the smoothing (after a teleport).
  update(dt, camera, player, eyeAt, physics, extra, rayPortal, snap = false) {
    const q = player.quaternion(this._q);
    const fwd = this.forward.set(0, 0, -1).applyQuaternion(q);
    const eye = eyeAt.clone();
    // Ease over small height changes (steps, landings); follow big ones.
    if (snap || this.height === null || Math.abs(eye.y - this.height) > 0.8) this.height = eye.y;
    else this.height += (eye.y - this.height) * (1 - Math.exp(-dt * 14));
    eye.y = this.height + this.lift;

    // The pivot stays on the player's side of any wall or portal.
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    let side = this.shoulder;
    const wall = physics.raycast(eye, right, side + 0.2, extra);
    if (wall) side = Math.min(side, wall.t - 0.2);
    const sidePortal = rayPortal(eye, right, side + 0.2);
    if (sidePortal) side = Math.min(side, sidePortal.t - 0.2);
    this.pivot.copy(eye).addScaledVector(right, Math.max(0, side));

    // Trace the boom backwards, hopping through at most two portals.
    const segments = this._segments;
    segments.length = 0;
    let origin = this.pivot.clone();
    let dir = fwd.clone().negate();
    let rot = new THREE.Quaternion();
    let remaining = this.distance;
    let reach = 0;
    for (let hop = 0; hop < 3; hop++) {
      const hit = physics.raycast(origin, dir, remaining + 0.3, extra);
      const portal = hop < 2 ? rayPortal(origin, dir, remaining) : null;
      if (portal && (!hit || portal.t < hit.t)) {
        segments.push({ origin, dir, length: portal.t, rot });
        reach += portal.t;
        remaining -= portal.t;
        origin = portal.point.clone().applyMatrix4(portal.P.toPartner);
        dir = dir.clone().applyQuaternion(portal.P.rotToPartner);
        rot = portal.P.rotToPartner.clone().multiply(rot);
        continue;
      }
      // Probe with a small ring of rays round the boom, not one thin ray, so
      // grazing an edge doesn't make the camera jump in and out.
      const t = this.probe(physics, origin, dir, remaining + 0.3, extra, hit ? hit.t : Infinity);
      const free = Math.max(0, Math.min(remaining, t - 0.3));
      segments.push({ origin, dir, length: free, rot });
      reach += free;
      break;
    }

    // Snap in when blocked, ease back out when clear.
    if (reach < this.length) this.length = reach;
    else this.length += (reach - this.length) * (1 - Math.exp(-dt * 3));

    let left = this.length;
    for (const s of segments) {
      const step = Math.min(left, s.length);
      camera.position.copy(s.origin).addScaledVector(s.dir, step);
      camera.quaternion.copy(s.rot).multiply(q);
      left -= step;
      if (left <= 1e-6) break;
    }
    camera.updateMatrixWorld();
  }

  // Nearest wall along the boom for the centre ray (tCentre) and four rays
  // offset around it. Offset rays that start inside something are ignored.
  probe(physics, origin, dir, maxT, extra, tCentre) {
    let t = tCentre;
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : X).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (const [a, b] of RING) {
      const o = origin.clone().addScaledVector(side, a * PROBE).addScaledVector(up, b * PROBE);
      const hit = physics.raycast(o, dir, maxT, extra);
      if (hit && hit.t > 0.05) t = Math.min(t, hit.t);
    }
    return t;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const PROBE = 0.14; // radius of the ring of probe rays
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1]];
