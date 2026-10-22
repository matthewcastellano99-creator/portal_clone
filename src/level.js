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

export function buildLevel(root, physics, materials, def) {
  const boxes = def.boxes.map((d) => {
    const box = new Box(d.min, d.max, d);
    box.hidden = !!d.hidden;
    return physics.addStatic(box);
  });
  for (const m of buildMeshes(boxes, materials)) root.add(m);
  def.decor(root);
}

// ------------------------------------------------------------ decoration

const lampMat = () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf4f8ff, emissiveIntensity: 2.4 });
const darkMetal = () => new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.4, metalness: 0.7 });

// Rows of light panels just under a ceiling at height y.
export function lamps(root, xs, zs, y) {
  const lamp = lampMat();
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
  const lampGeo = new THREE.BoxGeometry(3.4, 0.08, 0.45);
  const frameGeo = new THREE.BoxGeometry(3.7, 0.12, 0.7);
  for (const x of xs) {
    for (const z of zs) {
      const f = new THREE.Mesh(frameGeo, frame);
      f.position.set(x, y - 0.06, z);
      const l = new THREE.Mesh(lampGeo, lamp);
      l.position.set(x, y - 0.12, z);
      root.add(f, l);
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
