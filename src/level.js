import * as THREE from 'three';
import { Box } from './physics.js';
import { chamberSignTexture } from './textures.js';

const TEX_WORLD_SIZE = 4; // metres covered by one repeat of a surface texture

const b = (x0, y0, z0, x1, y1, z1, mat, opts = {}) => ({ min: [x0, y0, z0], max: [x1, y1, z1], mat, ...opts });

// Test Chamber 01
//
// The main room spans x -9..9, z -11..11 and is 10 m tall. The cube sits on a
// 4 m high ledge against the east wall. The button and the exit door are on a
// 4 m high platform in the north-west corner. Only a few surfaces are white
// (portalable): a strip of the west wall at ground level, the east wall above
// the ledge, the north wall above the platform, and a patch of floor.
export const LEVEL = {
  name: 'Test Chamber 01',
  spawn: { pos: [0, 0, 8.5], yaw: 0 }, // feet position; yaw 0 faces -z (north)
  cube: [6.6, 4.37, 3.5],
  button: [-3.2, 4, -8.5],
  door: { x: -9.5, y: 4, z: -8.5, width: 2, height: 2.6 },
  exit: { min: [-16, 4, -10], max: [-13, 7, -7] },
  killY: -25,
  boxes: [
    // floor, with a portalable patch in the middle
    b(-2, -1, 2, 2, 0, 6, 'whiteFloor'),
    b(-10, -1, -12, -2, 0, 12, 'floor'),
    b(2, -1, -12, 10, 0, 12, 'floor'),
    b(-2, -1, -12, 2, 0, 2, 'floor'),
    b(-2, -1, 6, 2, 0, 12, 'floor'),
    // ceiling
    b(-10, 10, -12, 10, 11, 12, 'metal', { castShadow: false }),
    // south wall
    b(-10, 0, 11, 10, 10, 12, 'metal'),
    // north wall, white above the exit platform
    b(-10, 0, -12, -7, 10, -11, 'metal'),
    b(-7, 0, -12, -3, 4, -11, 'metal'),
    b(-7, 4, -12, -3, 7.5, -11, 'white'),
    b(-7, 7.5, -12, -3, 10, -11, 'metal'),
    b(-3, 0, -12, 10, 10, -11, 'metal'),
    // west wall: exit doorway above the platform, white strip at ground level
    b(-10, 0, -12, -9, 10, -9.5, 'metal'),
    b(-10, 0, -9.5, -9, 4, -7.5, 'metal'),
    b(-10, 6.6, -9.5, -9, 10, -7.5, 'metal'),
    b(-10, 0, -7.5, -9, 10, -2, 'metal'),
    b(-10, 0, -2, -9, 4, 6, 'white'),
    b(-10, 4, -2, -9, 10, 6, 'metal'),
    b(-10, 0, 6, -9, 10, 12, 'metal'),
    // east wall, white above the cube ledge
    b(9, 0, -12, 10, 10, 1, 'metal'),
    b(9, 0, 1, 10, 4, 7, 'metal'),
    b(9, 4, 1, 10, 8, 7, 'white'),
    b(9, 8, 1, 10, 10, 7, 'metal'),
    b(9, 0, 7, 10, 10, 12, 'metal'),
    // cube ledge and exit platform
    b(5, 0, 0, 9, 4, 8, 'metal', { top: 'floor' }),
    b(-9, 0, -11, -1, 4, -6, 'metal', { top: 'floor' }),
    // cube dispenser tube hanging over the ledge
    b(6.0, 8.2, 2.9, 7.2, 10, 4.1, 'metal', { tag: 'dispenser', hidden: true }),
    // exit corridor behind the door
    b(-17, 3, -11, -10, 4, -6, 'floor'),
    b(-17, 7, -11, -10, 8, -6, 'metal', { castShadow: false }),
    b(-17, 4, -11, -10, 7, -10, 'metal'),
    b(-17, 4, -7, -10, 7, -6, 'metal'),
    b(-17, 4, -10, -16, 7, -7, 'metal'),
  ],
};

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

export function buildLevel(scene, physics, materials) {
  const boxes = LEVEL.boxes.map((d) => {
    const box = new Box(d.min, d.max, d);
    box.hidden = !!d.hidden;
    return physics.addStatic(box);
  });
  for (const m of buildMeshes(boxes, materials)) scene.add(m);
  addDecor(scene);
}

function addDecor(scene) {
  // ceiling light panels
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf4f8ff, emissiveIntensity: 2.4 });
  const lampFrame = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
  const lampGeo = new THREE.BoxGeometry(3.4, 0.08, 0.45);
  const frameGeo = new THREE.BoxGeometry(3.7, 0.12, 0.7);
  for (const x of [-4.5, 4.5]) {
    for (const z of [-6, 0, 6]) {
      const frame = new THREE.Mesh(frameGeo, lampFrame);
      frame.position.set(x, 9.94, z);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 9.88, z);
      scene.add(frame, lamp);
    }
  }
  // corridor lamp
  const corridorLamp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 0.35), lampMat);
  corridorLamp.position.set(-13.5, 6.96, -8.5);
  scene.add(corridorLamp);

  // observation window high on the south wall
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 2),
    new THREE.MeshStandardMaterial({ color: 0x0b1418, emissive: 0x16262e, emissiveIntensity: 1, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.5 }),
  );
  glass.position.set(0, 7.6, 10.97);
  glass.rotation.y = Math.PI;
  scene.add(glass);
  const winFrame = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.4, metalness: 0.7 });
  for (const [w, h, x, y] of [[6.4, 0.2, 0, 8.7], [6.4, 0.2, 0, 6.5], [0.2, 2.2, -3.1, 7.6], [0.2, 2.2, 3.1, 7.6]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), winFrame);
    m.position.set(x, y, 10.95);
    scene.add(m);
  }

  // chamber sign near the start
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 2.2),
    new THREE.MeshStandardMaterial({ map: chamberSignTexture(), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.12 }),
  );
  sign.position.set(-8.92, 1.9, 8.6);
  sign.rotation.y = Math.PI / 2;
  const signBack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.35, 1.25), winFrame);
  signBack.position.set(-8.99, 1.9, 8.6);
  scene.add(signBack, sign);

  // cube dispenser: a white tube hanging from the ceiling above the ledge
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.35 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 32, 1, true), tubeMat);
  tube.position.set(6.6, 9.1, 3.5);
  tube.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 12, 32), winFrame);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(6.6, 8.22, 3.5);
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(0.58, 32),
    new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.9 }),
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.set(6.6, 8.5, 3.5);
  scene.add(tube, ring, inner);

  // exit elevator at the end of the corridor
  const elevGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 3, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
  );
  elevGlass.position.set(-14.6, 5.5, -8.5);
  const elevBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 32), winFrame);
  elevBase.position.set(-14.6, 4.04, -8.5);
  const elevGlow = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.04, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9fe0ff, emissiveIntensity: 3 }),
  );
  elevGlow.rotation.x = Math.PI / 2;
  elevGlow.position.set(-14.6, 4.1, -8.5);
  scene.add(elevGlass, elevBase, elevGlow);
}
