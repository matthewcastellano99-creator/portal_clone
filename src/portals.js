import * as THREE from 'three';
import { PORTAL, PHYSICS } from './config.js';
import { Box, isPortalable } from './physics.js';

const ONE = new THREE.Vector3(1, 1, 1);
const MAT_Y_PI = new THREE.Matrix4().makeRotationY(Math.PI);
const ROT_Y_PI = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const TANGENTS = [[1, 2], [0, 2], [0, 1]];

// Candidate offsets for nudging a portal onto a surface, nearest first.
const OFFSETS = (() => {
  const list = [];
  const r = PORTAL.searchRadius;
  const step = 0.08;
  for (let x = -r; x <= r + 1e-6; x += step) {
    for (let y = -r; y <= r + 1e-6; y += step) {
      if (x * x + y * y <= r * r) list.push([x, y]);
    }
  }
  return list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
})();

// Points across the portal rectangle that must all lie on portalable surface.
// Corners go first because they fail most often.
const SAMPLES = (() => {
  const list = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 6; j++) {
      const s = [i / 4, j / 6];
      if (!list.some((q) => q[0] === s[0] && q[1] === s[1])) list.push(s);
    }
  }
  return list;
})();

const portalVertex = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`;

const portalFragment = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform sampler2D tex;
uniform vec2 resolution;
uniform vec3 color;
uniform float time;
uniform float open;
uniform float mode;  // 0: view through, 1: no partner yet, 2: recursion limit
uniform float deep;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

void main() {
  #include <clipping_planes_fragment>
  vec2 screenUv = gl_FragCoord.xy / resolution;
  if (deep > 0.5) {
    gl_FragColor = vec4(texture2D(tex, screenUv).rgb, 1.0);
    return;
  }
  vec2 p = vUv * 2.0 - 1.0;
  float len = length(p);
  float r = len / max(open, 0.001);
  vec2 dir = p / max(len, 1e-4);
  float n1 = fbm(dir * 2.2 + vec2(time * 0.9, -time * 0.7));
  float n2 = fbm(dir * 5.0 + vec2(-time * 1.7, time * 1.3) + r * 3.0);
  float outer = 0.98 - 0.06 * n2;
  if (r > outer) discard;

  vec3 inner;
  if (mode < 0.5) {
    inner = texture2D(tex, screenUv).rgb;
  } else {
    float ang = r * 5.0 - time * 2.2;
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    float sw = fbm(R * p * 3.0 + time * 0.25);
    inner = color * (0.12 + 1.2 * sw * sw);
    if (mode > 1.5) inner *= 0.6;
  }
  float rimStart = outer - 0.17 - 0.07 * n1;
  float rim = smoothstep(rimStart, outer, r);
  float flick = 0.6 + 0.8 * n2;
  vec3 rimCol = color * 2.8 * flick + vec3(1.0) * pow(rim, 10.0) * 0.8;
  gl_FragColor = vec4(mix(inner, rimCol, rim), 1.0);
}
`;

export class Portal {
  constructor(id, resolution) {
    this.id = id;
    this.color = new THREE.Color(PORTAL.colors[id]);
    this.placed = false;
    this.partner = null;
    this.pos = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4();
    this.matrixInv = new THREE.Matrix4();
    this.toPartner = new THREE.Matrix4(); // maps points near this portal to near the partner
    this.rotToPartner = new THREE.Quaternion();
    this.axis = 0;
    this.sign = 1;
    this.plane = 0;
    this.t1 = 1;
    this.t2 = 2;
    this.rmin = [0, 0, 0];
    this.rmax = [0, 0, 0];
    this.tunnelBoxes = [];
    this.open = 0;
    this.sphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(PORTAL.width, PORTAL.height) / 2 + 0.05);

    this.uniforms = {
      tex: { value: null },
      resolution: { value: resolution },
      color: { value: this.color.clone() },
      time: { value: 0 },
      open: { value: 0 },
      mode: { value: 1 },
      deep: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: portalVertex,
      fragmentShader: portalFragment,
      clipping: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PORTAL.width, PORTAL.height), material);
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;

    // When the camera is right up against the portal its near plane slices
    // through the surface. This box behind the hole keeps the view filled in.
    const deepMaterial = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, deep: { value: 1 } },
      vertexShader: portalVertex,
      fragmentShader: portalFragment,
      clipping: true,
      side: THREE.BackSide,
    });
    this.deepMesh = new THREE.Mesh(new THREE.BoxGeometry(PORTAL.width, PORTAL.height, 0.6), deepMaterial);
    this.deepMesh.visible = false;
    this.deepMesh.matrixAutoUpdate = false;

    this.light = new THREE.PointLight(this.color, 0, 7, 2);
  }

  get linked() {
    return this.placed && this.partner.placed;
  }

  place(center, axis, sign, plane, up, right) {
    this.pos.copy(center).setComponent(axis, plane);
    this.normal.set(0, 0, 0).setComponent(axis, sign);
    this.up.copy(up);
    this.right.copy(right);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, this.normal));
    this.matrix.compose(this.pos, this.quat, ONE);
    this.matrixInv.copy(this.matrix).invert();
    this.axis = axis;
    this.sign = sign;
    this.plane = plane;
    [this.t1, this.t2] = TANGENTS[axis];
    rectBounds(this.pos, axis, right, up, this.rmin, this.rmax);
    this.tunnelBoxes = buildTunnel(this);
    this.sphere.center.copy(this.pos);

    this.mesh.position.copy(this.pos).addScaledVector(this.normal, 0.004);
    this.mesh.quaternion.copy(this.quat);
    this.mesh.updateMatrix();
    this.mesh.visible = true;
    this.deepMesh.position.copy(this.pos).addScaledVector(this.normal, -0.3);
    this.deepMesh.quaternion.copy(this.quat);
    this.deepMesh.updateMatrix();
    this.light.position.copy(this.pos).addScaledVector(this.normal, 0.6);
    this.placed = true;
    this.open = 0;
  }

  remove() {
    this.placed = false;
    this.mesh.visible = false;
    this.deepMesh.visible = false;
    this.light.intensity = 0;
  }

  refreshTransform() {
    if (!this.linked) return;
    const Q = this.partner;
    this.toPartner.copy(Q.matrix).multiply(MAT_Y_PI).multiply(this.matrixInv);
    this.rotToPartner.copy(Q.quat).multiply(ROT_Y_PI).multiply(this.quat.clone().invert());
  }

  // Signed distance of a point in front of the portal's plane.
  distance(p) {
    return this.sign * (p.getComponent(this.axis) - this.plane);
  }
}

function rectBounds(center, axis, right, up, outMin, outMax) {
  for (let t = 0; t < 3; t++) {
    if (t === axis) {
      outMin[t] = outMax[t] = center.getComponent(t);
      continue;
    }
    const h = (Math.abs(right.getComponent(t)) * PORTAL.width + Math.abs(up.getComponent(t)) * PORTAL.height) / 2;
    outMin[t] = center.getComponent(t) - h;
    outMax[t] = center.getComponent(t) + h;
  }
}

// Collision walls lining the hole behind a portal, so a body that is part way
// through can't wander sideways into the wall it is passing through.
function buildTunnel(P) {
  const a = P.axis, c = P.plane, D = PORTAL.tunnelDepth, T = 1;
  const [t1, t2] = TANGENTS[a];
  const lo = P.sign > 0 ? c - D : c;
  const hi = P.sign > 0 ? c : c + D;
  const make = (aLo, aHi, t1Lo, t1Hi, t2Lo, t2Hi) => {
    const min = [0, 0, 0], max = [0, 0, 0];
    min[a] = aLo; max[a] = aHi;
    min[t1] = t1Lo; max[t1] = t1Hi;
    min[t2] = t2Lo; max[t2] = t2Hi;
    return new Box(min, max, { mat: 'metal', tag: 'tunnel' });
  };
  const r1 = [P.rmin[t1], P.rmax[t1]];
  const r2 = [P.rmin[t2], P.rmax[t2]];
  const capLo = P.sign > 0 ? c - D - T : c + D;
  return [
    make(lo, hi, r1[0] - T, r1[0], r2[0] - T, r2[1] + T),
    make(lo, hi, r1[1], r1[1] + T, r2[0] - T, r2[1] + T),
    make(lo, hi, r1[0], r1[1], r2[0] - T, r2[0]),
    make(lo, hi, r1[0], r1[1], r2[1], r2[1] + T),
    make(capLo, capLo + T, r1[0] - T, r1[1] + T, r2[0] - T, r2[1] + T),
  ];
}

export class PortalSystem {
  constructor(scene, physics, resolution) {
    this.physics = physics;
    this.portals = [new Portal(0, resolution), new Portal(1, resolution)];
    this.portals[0].partner = this.portals[1];
    this.portals[1].partner = this.portals[0];
    for (const P of this.portals) scene.add(P.mesh, P.deepMesh, P.light);
    physics.portals = this.portals;
    this._pt = [0, 0, 0];
  }

  reset() {
    for (const P of this.portals) P.remove();
  }

  refresh() {
    for (const P of this.portals) P.refreshTransform();
  }

  // Fire portal `id` along a ray. rayBlockers stop the shot (cube, door);
  // placeBlockers may not sit in front of a portal (door).
  tryPlace(id, origin, dir, viewForward, rayBlockers = [], placeBlockers = []) {
    const P = this.portals[id];
    const hit = this.physics.raycast(origin, dir, 250, rayBlockers);
    if (!hit) return { ok: false, point: null };
    const result = { ok: false, point: hit.point, normal: hit.normal };
    if (hit.box.dynamic || hit.box.body || !isPortalable(hit.box.faceMaterial?.(hit.axis, hit.sign))) {
      return result;
    }
    const { axis, sign } = hit;
    const plane = sign > 0 ? hit.box.max[axis] : hit.box.min[axis];
    const up = new THREE.Vector3();
    if (axis !== 1) {
      up.set(0, 1, 0);
    } else if (Math.abs(viewForward.x) > Math.abs(viewForward.z)) {
      up.set(Math.sign(viewForward.x) || 1, 0, 0);
    } else {
      up.set(0, 0, Math.sign(viewForward.z) || 1);
    }
    const right = new THREE.Vector3().crossVectors(up, hit.normal);
    const center = new THREE.Vector3();
    for (const [ox, oy] of OFFSETS) {
      center.copy(hit.point).addScaledVector(right, ox).addScaledVector(up, oy);
      center.setComponent(axis, plane);
      if (this.fits(center, axis, sign, plane, right, up, P.partner, placeBlockers)) {
        // A wall portal shot just above the floor drops down to sit on it,
        // so it can be walked into.
        if (axis !== 1) {
          const lower = center.clone();
          for (let i = 0; i < 60; i++) {
            lower.y -= 0.02;
            if (!this.fits(lower, axis, sign, plane, right, up, P.partner, placeBlockers)) break;
            center.copy(lower);
          }
        }
        P.place(center, axis, sign, plane, up, right);
        this.refresh();
        return { ok: true, point: P.pos.clone(), normal: P.normal.clone(), portal: P };
      }
    }
    return result;
  }

  fits(center, axis, sign, plane, right, up, other, placeBlockers) {
    const rmin = [0, 0, 0], rmax = [0, 0, 0];
    rectBounds(center, axis, right, up, rmin, rmax);
    const [t1, t2] = TANGENTS[axis];

    if (other.placed && other.axis === axis && other.sign === sign && Math.abs(other.plane - plane) < 0.01) {
      if (rmin[t1] < other.rmax[t1] && rmax[t1] > other.rmin[t1] && rmin[t2] < other.rmax[t2] && rmax[t2] > other.rmin[t2]) {
        return false;
      }
    }

    const pt = this._pt;
    for (const [i, j] of SAMPLES) {
      pt[t1] = rmin[t1] + (rmax[t1] - rmin[t1]) * i;
      pt[t2] = rmin[t2] + (rmax[t2] - rmin[t2]) * j;
      if (!this.covered(pt, axis, sign, plane, t1, t2)) return false;
    }

    const smin = rmin.slice(), smax = rmax.slice();
    smin[t1] += 0.02; smax[t1] -= 0.02;
    smin[t2] += 0.02; smax[t2] -= 0.02;
    if (sign > 0) {
      smin[axis] = plane + 0.02;
      smax[axis] = plane + 0.4;
    } else {
      smin[axis] = plane - 0.4;
      smax[axis] = plane - 0.02;
    }
    return !this.physics.anyOverlap(smin, smax, placeBlockers);
  }

  // Is this point on the plane covered by a portalable face (and not by a
  // non-portalable one)?
  covered(pt, axis, sign, plane, t1, t2) {
    const e = 1e-3;
    let ok = false;
    for (const b of this.physics.statics) {
      const f = sign > 0 ? b.max[axis] : b.min[axis];
      if (Math.abs(f - plane) > e) continue;
      const u = pt[t1], v = pt[t2];
      if (u < b.min[t1] - e || u > b.max[t1] + e || v < b.min[t2] - e || v > b.max[t2] + e) continue;
      if (isPortalable(b.faceMaterial(axis, sign))) ok = true;
      else if (u > b.min[t1] + e && u < b.max[t1] - e && v > b.min[t2] + e && v < b.max[t2] - e) return false;
    }
    return ok;
  }

  update(dt, time) {
    for (const P of this.portals) {
      if (!P.placed) continue;
      P.open = Math.min(1, P.open + dt / 0.25);
      const e = 1 - Math.pow(1 - P.open, 3);
      P.uniforms.open.value = e;
      P.uniforms.time.value = time + P.id * 7.3;
      P.light.intensity = 5 * e * (0.9 + 0.1 * Math.sin(time * 9 + P.id));
    }
  }
}

// Carry a body through portal P. The body's reference point is mapped through
// the portal, its velocity rotated, and it is settled so it is not left
// hanging inside the exit wall.
// `ahead` is the horizontal direction to drift in when popping slowly out of
// a floor portal (defaults to the exit portal's up direction).
export function teleportBody(body, P, ahead = null) {
  const Q = P.partner;
  const ref = body.refPoint(new THREE.Vector3()).applyMatrix4(P.toPartner);
  body.vel.applyQuaternion(P.rotToPartner);
  body.pos.set(ref.x, ref.y - body.refOffset, ref.z);
  settleExit(body, Q, ahead ?? Q.up);
  body.portalMode = Q;
}

function settleExit(body, Q, ahead) {
  // Keep the body inside the outline of the exit hole. Standing the player
  // upright (or carrying sideways momentum) can leave part of the body
  // outside it, e.g. feet below the bottom edge of a wall portal, which would
  // put them inside the solid surface around the portal.
  for (const t of [Q.t1, Q.t2]) {
    const lo = Q.rmin[t] + body.half[t] + 0.01;
    const hi = Q.rmax[t] - body.half[t] - 0.01;
    if (lo <= hi) body.pos.setComponent(t, THREE.MathUtils.clamp(body.pos.getComponent(t), lo, hi));
  }
  if (Q.axis === 1 && Q.sign > 0) {
    // Coming up out of a floor: make sure there is enough speed to clear it.
    const depth = Q.plane - body.min(1);
    if (depth > 0) {
      const vmin = Math.sqrt(2 * PHYSICS.gravity * (depth + 0.3));
      if (body.vel.y < vmin) {
        body.vel.y = vmin;
        // A slow exit would just fall back in, so drift clear of the hole.
        const h = Math.hypot(body.vel.x, body.vel.z);
        if (h < 2.8) {
          body.vel.x += ahead.x * (2.8 - h);
          body.vel.z += ahead.z * (2.8 - h);
        }
      }
    }
  }
}
