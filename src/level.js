import * as THREE from 'three';
import { Box } from './physics.js';
import { chamberSignTexture } from './textures.js';

const TEX_WORLD_SIZE = 4; // metres covered by one repeat of a surface texture

// One axis-aligned box of level geometry.
export const b = (x0, y0, z0, x1, y1, z1, mat, opts = {}) => ({ min: [x0, y0, z0], max: [x1, y1, z1], mat, ...opts });

// A horizontal slab covering x0..x1, z0..z1 with rectangular holes
// ([hx0, hx1, hz0, hz1]) cut out of it, as a list of boxes.
export function slab(x0, x1, z0, z1, y0, y1, holes, mat, opts = {}) {
  const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h[0], h[1]])])].filter((x) => x >= x0 && x <= x1).sort((p, q) => p - q);
  const zs = [...new Set([z0, z1, ...holes.flatMap((h) => [h[2], h[3]])])].filter((z) => z >= z0 && z <= z1).sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    let run = null; // merge consecutive cells along z
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      const inHole = holes.some((h) => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3]);
      if (inHole) {
        run = null;
      } else if (run) {
        run.max[2] = zs[j + 1];
      } else {
        run = b(xs[i], y0, zs[j], xs[i + 1], y1, zs[j + 1], mat, opts);
        out.push(run);
      }
    }
  }
  return out;
}

const FACES = [
  { axis: 0, sign: 1, u: [0, 0, -1], v: [0, 1, 0] },
  { axis: 0, sign: -1, u: [0, 0, 1], v: [0, 1, 0] },
  { axis: 1, sign: 1, u: [1, 0, 0], v: [0, 0, -1] },
  { axis: 1, sign: -1, u: [1, 0, 0], v: [0, 0, 1] },
  { axis: 2, sign: 1, u: [1, 0, 0], v: [0, 1, 0] },
  { axis: 2, sign: -1, u: [-1, 0, 0], v: [0, 1, 0] },
];

// A face is hidden when another box completely covers it from the outside.
function faceHidden(box, face, boxes) {
  const a = face.axis;
  const coord = face.sign > 0 ? box.max[a] : box.min[a];
  const probe = coord + face.sign * 1e-3;
  for (const o of boxes) {
    if (o === box || o.hidden) continue;
    if (probe <= o.min[a] || probe >= o.max[a]) continue;
    let covers = true;
    for (let t = 0; t < 3; t++) {
      if (t === a) continue;
      if (o.min[t] > box.min[t] + 1e-6 || o.max[t] < box.max[t] - 1e-6) covers = false;
    }
    if (covers) return true;
  }
  return false;
}

function buildMeshes(boxes, materials) {
  const groups = new Map();
  for (const box of boxes) {
    if (box.hidden) continue;
    for (const f of FACES) {
      if (faceHidden(box, f, boxes)) continue;
      const mat = box.faceMaterial(f.axis, f.sign);
      const key = `${mat}|${box.castShadow}`;
      if (!groups.has(key)) groups.set(key, { mat, cast: box.castShadow, pos: [], nor: [], uv: [], idx: [] });
      const g = groups.get(key);
      const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
      c[f.axis] = f.sign > 0 ? box.max[f.axis] : box.min[f.axis];
      const ua = f.u.findIndex((x) => x !== 0);
      const va = f.v.findIndex((x) => x !== 0);
      const hu = (box.max[ua] - box.min[ua]) / 2;
      const hv = (box.max[va] - box.min[va]) / 2;
      const base = g.pos.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 1, 2].map((i) => c[i] + f.u[i] * su * hu + f.v[i] * sv * hv);
        g.pos.push(...p);
        g.nor.push(...[0, 1, 2].map((i) => (i === f.axis ? f.sign : 0)));
        const u = p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2];
        const v = p[0] * f.v[0] + p[1] * f.v[1] + p[2] * f.v[2];
        g.uv.push(u / TEX_WORLD_SIZE, v / TEX_WORLD_SIZE);
      }
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const meshes = [];
  for (const g of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materials[g.mat]);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

export function buildLevel(root, physics, materials, def, dust = 0) {
  const boxes = def.boxes.map((d) => {
    const box = new Box(d.min, d.max, d);
    box.hidden = !!d.hidden;
    return physics.addStatic(box);
  });
  for (const m of buildMeshes(boxes, materials)) root.add(m);
  def.decor(root);
  if (dust > 0) dustMotes(root, boxes, dust);
}

// ------------------------------------------------------------ atmosphere

// Seconds since the game started; drives the drifting dust and the shimmer
// in the light shafts.
export const atmosphereTime = { value: 0 };

// Specks of dust drifting slowly through the air, catching the light.
function dustMotes(root, boxes, count) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], b.min[a]);
      hi[a] = Math.max(hi[a], b.max[a]);
    }
  }
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) pos[i * 3 + a] = lo[a] + Math.random() * (hi[a] - lo[a]);
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: atmosphereTime, pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `attribute float seed; uniform float time; uniform float pixelRatio; varying float vFade;
      void main() {
        vec3 p = position + vec3(sin(time * 0.11 + seed) * 0.6, sin(time * 0.07 + seed * 1.7) * 0.4, cos(time * 0.09 + seed * 1.3) * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vFade = smoothstep(0.3, 1.5, d) * (1.0 - smoothstep(10.0, 24.0, d)) * (0.55 + 0.45 * sin(time * 0.8 + seed * 5.0));
        gl_PointSize = pixelRatio * (16.0 + fract(seed) * 14.0) / d;
      }`,
    fragmentShader: `varying float vFade;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r) * vFade * 0.5;
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  root.add(points);
}

// A soft shaft of light falling from a ceiling lamp: a widening, open-ended
// box that fades towards the floor and at its edges.
const beamMaterial = () => new THREE.ShaderMaterial({
  uniforms: { time: atmosphereTime },
  vertexShader: `varying float vY; varying vec3 vN; varying vec3 vView;
    void main() {
      vY = uv.y;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform float time; varying float vY; varying vec3 vN; varying vec3 vView;
    void main() {
      float edge = pow(abs(dot(vN, vView)), 1.6);
      float a = edge * pow(vY, 1.8) * (0.11 + 0.012 * sin(time * 0.6));
      gl_FragColor = vec4(vec3(0.92, 0.96, 1.0) * a, a);
    }`,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
});

function lightBeam(length, width, depth, spread, material) {
  const geo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * spread, length, 4, 1, true);
  geo.rotateY(Math.PI / 4);
  geo.scale(width, 1, depth);
  geo.translate(0, -length / 2, 0);
  const m = new THREE.Mesh(geo, material);
  m.renderOrder = 2;
  return m;
}

// ------------------------------------------------------------ decoration

const lampMat = () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf4f8ff, emissiveIntensity: 2.4 });
const darkMetal = () => new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.4, metalness: 0.7 });

// Settings the game picks for the device: whether ceiling lamps cast real
// light (each one is a point light, which costs every lit pixel).
export const levelOptions = { lampLights: true };

// Rows of light panels just under a ceiling at height y.
export function lamps(root, xs, zs, y) {
  const lamp = lampMat();
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
  const lampGeo = new THREE.BoxGeometry(3.4, 0.08, 0.45);
  const beamMat = beamMaterial();
  const frameGeo = new THREE.BoxGeometry(3.7, 0.12, 0.7);
  for (const x of xs) {
    for (const z of zs) {
      const f = new THREE.Mesh(frameGeo, frame);
      f.position.set(x, y - 0.06, z);
      const l = new THREE.Mesh(lampGeo, lamp);
      l.position.set(x, y - 0.12, z);
      const beam = lightBeam(Math.min(7, y - 1), 3.4, 0.45, 1.9, beamMat);
      beam.position.set(x, y - 0.16, z);
      root.add(f, l, beam);
      if (levelOptions.lampLights) {
        const light = new THREE.PointLight(0xe8f0ff, 9, 16, 1.6);
        light.position.set(x, y - 0.5, z);
        root.add(light);
      }
    }
  }
}

// A light strip along a corridor ceiling; `along` is 'x' or 'z'.
export function stripLight(root, x, y, z, length, along) {
  const m = new THREE.Mesh(along === 'x' ? new THREE.BoxGeometry(length, 0.06, 0.35) : new THREE.BoxGeometry(0.35, 0.06, length), lampMat());
  m.position.set(x, y - 0.04, z);
  root.add(m);
}

// Dark observation window set into a wall. rotY turns it (it faces +z at 0).
export function observationWindow(root, x, y, z, rotY, width = 6, height = 2) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ color: 0x0b1418, emissive: 0x16262e, emissiveIntensity: 1, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.5 }),
  );
  glass.position.z = 0.03;
  g.add(glass);
  const frame = darkMetal();
  for (const [w, h, fx, fy] of [[width + 0.4, 0.2, 0, height / 2 + 0.1], [width + 0.4, 0.2, 0, -height / 2 - 0.1], [0.2, height + 0.2, -width / 2 - 0.1, 0], [0.2, height + 0.2, width / 2 + 0.1, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), frame);
    m.position.set(fx, fy, 0.05);
    g.add(m);
  }
  root.add(g);
}

// The chamber's info panel on a wall. rotY turns it (it faces +z at 0).
export function chamberSign(root, x, y, z, rotY, sign) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.35, 0.06), darkMetal());
  back.position.z = 0.03;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 2.2),
    new THREE.MeshStandardMaterial({ map: chamberSignTexture(sign), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.12 }),
  );
  panel.position.z = 0.08;
  g.add(back, panel);
  root.add(g);
}

// Cube dispenser: a white tube hanging from the ceiling (yTop) down to yBottom.
export function dispenser(root, x, z, yBottom, yTop) {
  const len = yTop - yBottom;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, len, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.35 }));
  tube.position.set(x, yBottom + len / 2, z);
  tube.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 12, 32), darkMetal());
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, yBottom + 0.02, z);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.58, 32), new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.9 }));
  inner.rotation.x = Math.PI / 2;
  inner.position.set(x, yBottom + 0.3, z);
  root.add(tube, ring, inner);
}
