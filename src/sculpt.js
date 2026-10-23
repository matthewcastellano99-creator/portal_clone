import * as THREE from 'three';

// Tools for modelling smooth, organic parts in code: a sweep that runs a
// varying cross-section along a curve, and procedural bump textures.

// A value over t in [0, 1]: a number, a function, or keyframes spread evenly
// over the range and joined smoothly (Catmull-Rom).
function sampler(v) {
  if (typeof v === 'function') return v;
  if (!Array.isArray(v)) return () => v;
  if (v.length === 1) return () => v[0];
  const n = v.length - 1;
  return (t) => {
    const x = THREE.MathUtils.clamp(t, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const f = x - i;
    const p0 = v[Math.max(0, i - 1)], p1 = v[i], p2 = v[i + 1], p3 = v[Math.min(n, i + 2)];
    const m1 = (p2 - p0) / 2, m2 = (p3 - p1) / 2;
    const f2 = f * f, f3 = f2 * f;
    return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
  };
}

// Sweep a superellipse along a smooth curve through `points`.
//   width, height: half extents of the section (sideways / along `up`)
//   exp: 2 is an ellipse, larger is boxier
//   arc: the part of the section to build, as fractions of a turn starting
//        sideways (+x for a curve heading -z) and turning towards `up`.
//        Anything less than a full turn makes an open shell.
//   lift: moves the section along `up`
// UVs run along the curve (u) and around the section (v).
export function sweep(points, opts = {}) {
  const {
    width = 0.05, height = width, exp = 2, lift = 0,
    segments = 14, radial = 14, arc = [0, 1], caps = true, up = [0, 1, 0],
  } = opts;
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const W = sampler(width), H = sampler(height), E = sampler(exp), L = sampler(lift);
  const full = arc[1] - arc[0] >= 1;
  const cols = radial + 1;
  const pos = [];
  const uv = [];
  const index = [];

  const C = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3(...up);
  const B = new THREE.Vector3();
  const prevT = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const rings = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, C);
    curve.getTangentAt(t, T);
    if (i === 0) {
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-8) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize();
    } else {
      // rotation-minimising frame: carry the last normal along the turn
      q.setFromUnitVectors(prevT, T);
      N.applyQuaternion(q);
      N.addScaledVector(T, -N.dot(T)).normalize();
    }
    prevT.copy(T);
    B.crossVectors(T, N);
    const w = Math.max(0, W(t)), h = Math.max(0, H(t)), e = 2 / Math.max(0.5, E(t)), l = L(t);
    const ring = [];
    for (let j = 0; j <= radial; j++) {
      const a = (arc[0] + (arc[1] - arc[0]) * (j / radial)) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const x = w * Math.sign(c) * Math.pow(Math.abs(c), e);
      const y = h * Math.sign(s) * Math.pow(Math.abs(s), e) + l;
      const p = C.clone().addScaledVector(B, x).addScaledVector(N, y);
      pos.push(p.x, p.y, p.z);
      uv.push(t, j / radial);
      ring.push(p);
    }
    rings.push({ center: C.clone().addScaledVector(N, l), tangent: T.clone(), ring });
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j, b = a + cols, c = a + 1, d = b + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const sideCount = pos.length / 3;

  const geo = new THREE.BufferGeometry();
  if (full && caps) {
    // flat end caps with their own vertices, so their edges stay crisp
    for (const [k, flip] of [[0, false], [segments, true]]) {
      const { center, ring } = rings[k];
      const base = pos.length / 3;
      pos.push(center.x, center.y, center.z);
      uv.push(k / segments, 0.5);
      for (let j = 0; j <= radial; j++) {
        pos.push(ring[j].x, ring[j].y, ring[j].z);
        uv.push(k / segments, j / radial);
      }
      for (let j = 0; j < radial; j++) {
        if (flip) index.push(base, base + 2 + j, base + 1 + j);
        else index.push(base, base + 1 + j, base + 2 + j);
      }
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  if (full) {
    // the first and last column are the same place; share their normals
    const n = geo.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const a = i * cols, b = a + radial;
      v.fromBufferAttribute(n, a).add(new THREE.Vector3().fromBufferAttribute(n, b)).normalize();
      n.setXYZ(a, v.x, v.y, v.z);
      n.setXYZ(b, v.x, v.y, v.z);
    }
  }
  if (full && caps) {
    // caps face straight out of the ends
    const n = geo.attributes.normal;
    const ends = [[sideCount, rings[0].tangent.clone().negate()], [sideCount + radial + 2, rings[segments].tangent]];
    for (const [start, dir] of ends) {
      for (let j = 0; j < radial + 2; j++) n.setXYZ(start + j, dir.x, dir.y, dir.z);
    }
  }
  return geo;
}

// Mirror a list of points across x = 0.
export const mirrorX = (points) => points.map(([x, y, z]) => [-x, y, z]);

// ------------------------------------------------------------ surface detail
// Each texture is drawn as a height image and stored as a normal map.

const cache = new Map();

function canvasTexture(key, w, h, draw, repeat = [1, 1]) {
  if (!cache.has(key)) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    draw(g, w, h);
    heightToNormal(g, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    cache.set(key, tex);
  }
  const tex = cache.get(key).clone();
  tex.repeat.set(...repeat);
  tex.needsUpdate = true;
  return tex;
}

// Turn the grey height image drawn on a canvas into a tangent-space normal
// map, in place. (Normal maps rather than bump maps: three.js's bump shading
// can produce NaN pixels on thin or edge-on surfaces, which bloom then spreads
// across the screen.)
function heightToNormal(g, w, h, strength = 2.5) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = d[i * 4] / 255;
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// A sunken seam with a lit edge, drawn as height (mid grey is flat).
function groove(g, draw, width = 3) {
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = width + 2;
  g.save();
  g.translate(1, 1);
  g.beginPath();
  draw();
  g.stroke();
  g.restore();
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = width;
  g.beginPath();
  draw();
  g.stroke();
}

function grain(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
  }
}

// Panel lines, rivets and a little brushing for machined armour.
export function armorBump(repeat) {
  return canvasTexture('armor', 512, 256, (g, w, h) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    grain(g, w, h, 5000, 0.05);
    for (const y of [40, 128, 216]) groove(g, () => { g.moveTo(0, y); g.lineTo(w, y); });
    for (const x of [120, 300, 430]) {
      groove(g, () => {
        g.moveTo(x, 0);
        g.bezierCurveTo(x + 30, h * 0.3, x - 30, h * 0.7, x, h);
      });
    }
    // a few bolts along the seams
    g.fillStyle = '#b8b8b8';
    for (const [x, y] of [[60, 56], [200, 112], [360, 144], [470, 200], [250, 24]]) {
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }, repeat);
}

// ------------------------------------------------------------ merging

// Combine the meshes directly inside `group` that share a material into one
// mesh each, then do the same inside every child group. A model built from
// dozens of parts then costs a handful of draw calls per view, which matters
// because the player is drawn again in every portal view and the shadow map.
// Groups (joints that move) are kept; meshes with children are left alone.
export function mergeByMaterial(group) {
  const byMat = new Map();
  for (const child of [...group.children]) {
    if (child.isMesh && child.children.length === 0 && !child.isSkinnedMesh) {
      if (!byMat.has(child.material)) byMat.set(child.material, []);
      byMat.get(child.material).push(child);
    } else {
      mergeByMaterial(child);
    }
  }
  for (const [material, meshes] of byMat) {
    if (meshes.length < 2) continue;
    const pos = [], nor = [], uv = [], index = [];
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    let renderOrder = 0, cast = false, receive = false;
    for (const m of meshes) {
      m.updateMatrix();
      nm.getNormalMatrix(m.matrix);
      const g = m.geometry;
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      const base = pos.length / 3;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrix);
        pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        nor.push(v.x, v.y, v.z);
        uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      }
      // a mirrored part (negative scale) needs its triangles turned round
      const flip = m.matrix.determinant() < 0;
      if (g.index) {
        const I = g.index.array;
        for (let i = 0; i < I.length; i += 3) {
          if (flip) index.push(base + I[i], base + I[i + 2], base + I[i + 1]);
          else index.push(base + I[i], base + I[i + 1], base + I[i + 2]);
        }
      } else {
        for (let i = 0; i < P.count; i += 3) {
          if (flip) index.push(base + i, base + i + 2, base + i + 1);
          else index.push(base + i, base + i + 1, base + i + 2);
        }
      }
      renderOrder = Math.max(renderOrder, m.renderOrder);
      cast ||= m.castShadow;
      receive ||= m.receiveShadow;
      group.remove(m);
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, material);
    merged.renderOrder = renderOrder;
    merged.castShadow = cast;
    merged.receiveShadow = receive;
    group.add(merged);
  }
  return group;
}
