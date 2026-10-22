import * as THREE from 'three';
import { PHYSICS } from './config.js';

// The world is built from axis-aligned boxes and every moving thing is an
// axis-aligned box too. Portals always sit on box faces, so a portal is an
// axis-aligned rectangle on an axis-aligned plane. That keeps "cut a hole in
// the wall" down to clipping boxes against a plane.

const EPS = 1e-4;

export class Box {
  constructor(min, max, props = {}) {
    this.min = min;
    this.max = max;
    this.mat = props.mat ?? 'metal';
    this.top = props.top ?? null; // optional material override for the +y face
    this.castShadow = props.castShadow ?? true;
    this.dynamic = props.dynamic ?? false;
    this.tag = props.tag ?? null;
  }

  faceMaterial(axis, sign) {
    return axis === 1 && sign > 0 && this.top ? this.top : this.mat;
  }
}

export function isPortalable(mat) {
  return mat === 'white' || mat === 'whiteFloor';
}

export function boxesOverlap(aMin, aMax, bMin, bMax) {
  return (
    aMin[0] < bMax[0] && aMax[0] > bMin[0] &&
    aMin[1] < bMax[1] && aMax[1] > bMin[1] &&
    aMin[2] < bMax[2] && aMax[2] > bMin[2]
  );
}

export class Body {
  constructor(half) {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.half = half;
    this.onGround = false;
    this.ground = null;
    this.portalMode = null; // portal whose hole this body is currently allowed into
    this.refOffset = 0; // height of the teleport reference point above the centre
    this.box = { min: [0, 0, 0], max: [0, 0, 0], body: this }; // collision box as seen by others
  }

  min(a) {
    return this.pos.getComponent(a) - this.half[a];
  }

  max(a) {
    return this.pos.getComponent(a) + this.half[a];
  }

  refPoint(out) {
    return out.set(this.pos.x, this.pos.y + this.refOffset, this.pos.z);
  }

  syncBox() {
    for (let a = 0; a < 3; a++) {
      this.box.min[a] = this.min(a);
      this.box.max[a] = this.max(a);
    }
    return this.box;
  }
}

// Keep only the part of a box that lies in front of a portal's plane.
function clipToFront(b, P) {
  const a = P.axis;
  if (P.sign > 0) {
    if (b.max[a] <= P.plane) return null;
    if (b.min[a] >= P.plane) return b;
    const min = b.min.slice();
    min[a] = P.plane;
    return { min, max: b.max, src: b };
  }
  if (b.min[a] >= P.plane) return null;
  if (b.max[a] <= P.plane) return b;
  const max = b.max.slice();
  max[a] = P.plane;
  return { min: b.min, max, src: b };
}

export class PhysicsWorld {
  constructor() {
    this.statics = [];
    this.dynamicSources = []; // functions (body) => array of boxes
    this.portals = [];
    this._sMin = [0, 0, 0];
    this._sMax = [0, 0, 0];
    this._wMin = [0, 0, 0];
    this._wMax = [0, 0, 0];
    this._d = [0, 0, 0];
    this._prevRef = new THREE.Vector3();
    this._ref = new THREE.Vector3();
  }

  addStatic(box) {
    this.statics.push(box);
    return box;
  }

  // Decide whether a body is entering (or still inside) a portal's hole.
  // wMin/wMax are the body's bounds swept over this substep.
  portalModeFor(body, wMin, wMax) {
    for (const P of this.portals) {
      if (!P.linked) continue;
      const a = P.axis;
      const c = P.plane;
      const near = P.sign > 0 ? body.min(a) - c : c - body.max(a);
      if (near < 0 && body.portalMode === P) return P; // already part-way through
      const sweptNear = P.sign > 0 ? wMin[a] - c : c - wMax[a];
      if (near < -0.01 || sweptNear > 0.06) continue;
      const t1 = P.t1;
      const t2 = P.t2;
      const tol = 0.02;
      if (
        wMin[t1] >= P.rmin[t1] - tol && wMax[t1] <= P.rmax[t1] + tol &&
        wMin[t2] >= P.rmin[t2] - tol && wMax[t2] <= P.rmax[t2] + tol
      ) {
        return P;
      }
    }
    return null;
  }

  collect(body, d, ignore) {
    const sMin = this._sMin, sMax = this._sMax, wMin = this._wMin, wMax = this._wMax;
    for (let a = 0; a < 3; a++) {
      const lo = body.min(a), hi = body.max(a);
      wMin[a] = Math.min(lo, lo + d[a]);
      wMax[a] = Math.max(hi, hi + d[a]);
      sMin[a] = wMin[a] - 0.05;
      sMax[a] = wMax[a] + 0.05;
    }
    const portal = this.portalModeFor(body, wMin, wMax);
    body.portalMode = portal;

    const out = [];
    const consider = (b) => {
      if (!boxesOverlap(sMin, sMax, b.min, b.max)) return;
      if (portal) {
        b = clipToFront(b, portal);
        if (!b || !boxesOverlap(sMin, sMax, b.min, b.max)) return;
      }
      out.push(b);
    };
    for (const s of this.statics) consider(s);
    for (const src of this.dynamicSources) {
      for (const b of src(body)) if (b && b !== ignore) consider(b);
    }
    if (portal) {
      for (const t of portal.tunnelBoxes) if (boxesOverlap(sMin, sMax, t.min, t.max)) out.push(t);
    }
    return out;
  }

  overlaps(body, c) {
    for (let a = 0; a < 3; a++) {
      if (body.min(a) >= c.max[a] || body.max(a) <= c.min[a]) return false;
    }
    return true;
  }

  // Move a body by its velocity with axis-separated collision response.
  // opts.onCross(portal) is called when the body's reference point passes
  // through a linked portal; it is expected to teleport the body.
  moveBody(body, dt, opts = {}) {
    const dist = body.vel.length() * dt;
    const n = Math.min(32, Math.max(1, Math.ceil(dist / PHYSICS.maxSubstepDistance)));
    const h = dt / n;
    const d = this._d;
    body.onGround = false;
    body.ground = null;

    for (let i = 0; i < n; i++) {
      d[0] = body.vel.x * h;
      d[1] = body.vel.y * h;
      d[2] = body.vel.z * h;
      body.refPoint(this._prevRef);
      const colliders = this.collect(body, d, opts.ignore);

      for (const a of [1, 0, 2]) {
        if (d[a] === 0) continue;
        body.pos.setComponent(a, body.pos.getComponent(a) + d[a]);
        for (const c of colliders) {
          if (!this.overlaps(body, c)) continue;
          if (d[a] > 0) {
            // Only resolve overlaps that this move created.
            if (body.max(a) - d[a] > c.min[a] + 0.01) continue;
            body.pos.setComponent(a, c.min[a] - body.half[a] - EPS);
          } else {
            if (body.min(a) - d[a] < c.max[a] - 0.01) continue;
            body.pos.setComponent(a, c.max[a] + body.half[a] + EPS);
            if (a === 1) {
              body.onGround = true;
              body.ground = c;
            }
          }
          body.vel.setComponent(a, 0);
        }
      }

      if (opts.onCross) {
        body.refPoint(this._ref);
        const P = this.findCrossing(this._prevRef, this._ref);
        if (P) opts.onCross(P);
      }
    }
  }

  // Push a body out of anything it is stuck in (used after teleports and when
  // a portal it was passing through disappears).
  depenetrate(body, ignore) {
    const zero = [0, 0, 0];
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const c of this.collect(body, zero, ignore)) {
        if (!this.overlaps(body, c)) continue;
        let bestA = 1, bestD = Infinity, bestS = 1;
        for (let a = 0; a < 3; a++) {
          const pushUp = c.max[a] - body.min(a);
          const pushDown = body.max(a) - c.min[a];
          if (pushUp < bestD) { bestD = pushUp; bestA = a; bestS = 1; }
          if (pushDown < bestD) { bestD = pushDown; bestA = a; bestS = -1; }
        }
        body.pos.setComponent(bestA, body.pos.getComponent(bestA) + bestS * (bestD + EPS));
        if (Math.sign(body.vel.getComponent(bestA)) === -bestS) body.vel.setComponent(bestA, 0);
        moved = true;
      }
      if (!moved) break;
    }
  }

  findCrossing(p0, p1) {
    for (const P of this.portals) {
      if (!P.linked) continue;
      const a = P.axis;
      const d0 = P.sign * (p0.getComponent(a) - P.plane);
      const d1 = P.sign * (p1.getComponent(a) - P.plane);
      if (d0 >= 0 && d1 < 0) {
        const t = d0 / (d0 - d1);
        const x1 = THREE.MathUtils.lerp(p0.getComponent(P.t1), p1.getComponent(P.t1), t);
        const x2 = THREE.MathUtils.lerp(p0.getComponent(P.t2), p1.getComponent(P.t2), t);
        const tol = 0.05;
        if (
          x1 >= P.rmin[P.t1] - tol && x1 <= P.rmax[P.t1] + tol &&
          x2 >= P.rmin[P.t2] - tol && x2 <= P.rmax[P.t2] + tol
        ) {
          return P;
        }
      }
    }
    return null;
  }

  // Ray against the static boxes plus any extra boxes. Returns the nearest hit
  // with an axis-aligned normal, or null.
  raycast(origin, dir, maxDist, extra = []) {
    let best = null;
    const o = [origin.x, origin.y, origin.z];
    const dv = [dir.x, dir.y, dir.z];
    const test = (b) => {
      let tmin = -Infinity, tmax = Infinity, axis = -1;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dv[a]) < 1e-9) {
          if (o[a] < b.min[a] || o[a] > b.max[a]) return;
          continue;
        }
        let t0 = (b.min[a] - o[a]) / dv[a];
        let t1 = (b.max[a] - o[a]) / dv[a];
        if (t0 > t1) [t0, t1] = [t1, t0];
        if (t0 > tmin) {
          tmin = t0;
          axis = a;
        }
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) return;
      }
      if (axis < 0 || tmin < 0 || tmin > maxDist) return;
      if (!best || tmin < best.t) best = { t: tmin, axis, box: b };
    };
    for (const b of this.statics) test(b);
    for (const b of extra) if (b) test(b);
    if (!best) return null;
    best.point = origin.clone().addScaledVector(dir, best.t);
    best.sign = dv[best.axis] > 0 ? -1 : 1;
    best.normal = new THREE.Vector3().setComponent(best.axis, best.sign);
    return best;
  }

  // Is any static (or extra) box overlapping the given bounds?
  anyOverlap(min, max, extra = []) {
    for (const b of this.statics) if (boxesOverlap(min, max, b.min, b.max)) return true;
    for (const b of extra) if (b && boxesOverlap(min, max, b.min, b.max)) return true;
    return false;
  }
}
