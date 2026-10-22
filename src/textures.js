import * as THREE from 'three';

// All textures are generated at load time, so the game ships no image assets.
// Surface textures cover 4 x 4 m of world and tile seamlessly.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Tileable value noise over a size x size pixel canvas with cellsX by cellsY
// lattice cells.
function makeNoise(size, cellsX, seed, cellsY = cellsX) {
  const rand = rng(seed);
  const lattice = new Float32Array(cellsX * cellsY).map(() => rand());
  const sx = cellsX / size, sy = cellsY / size;
  return (x, y) => {
    const fx = x * sx, fy = y * sy;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % cellsX) + cellsX) % cellsX, y0 = ((iy % cellsY) + cellsY) % cellsY;
    const x1 = (x0 + 1) % cellsX, y1 = (y0 + 1) % cellsY;
    const a = lattice[y0 * cellsX + x0], b = lattice[y0 * cellsX + x1];
    const c = lattice[y1 * cellsX + x0], d = lattice[y1 * cellsX + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

function fbm(noises, x, y) {
  let s = 0, amp = 0.5, norm = 0;
  for (const n of noises) {
    s += n(x, y) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return s / norm;
}

function canvasTexture(canvas, srgb) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function heightToNormal(height, size, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Generic panel texture: pixels are classified by the panel grid, then the
// callbacks produce colour (0..1 grey or rgb) and height.
function panelTexture({ size, panelW, panelH, seed, shade, normalStrength, roughness }) {
  const rand = rng(seed);
  const cols = Math.round(size / panelW), rows = Math.round(size / panelH);
  const panelTone = Array.from({ length: cols * rows }, () => rand());
  const noises = [makeNoise(size, 8, seed + 1), makeNoise(size, 32, seed + 2), makeNoise(size, 128, seed + 3)];
  const fine = makeNoise(size, 256, seed + 4);
  const color = document.createElement('canvas');
  color.width = color.height = size;
  const ctx = color.getContext('2d');
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = roughness ? document.createElement('canvas') : null;
  let rImg = null;
  if (rough) {
    rough.width = rough.height = size;
    rImg = rough.getContext('2d').createImageData(size, size);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x % panelW, py = y % panelH;
      const pi = Math.floor(y / panelH) * cols + Math.floor(x / panelW);
      const edge = Math.min(px, py, panelW - 1 - px, panelH - 1 - py);
      const n = fbm(noises, x, y);
      const f = fine(x, y);
      const out = shade({ x, y, px, py, edge, tone: panelTone[pi], n, f, panelW, panelH });
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, out.r * 255);
      img.data[i + 1] = Math.min(255, out.g * 255);
      img.data[i + 2] = Math.min(255, out.b * 255);
      img.data[i + 3] = 255;
      height[y * size + x] = out.h;
      if (rImg) {
        const rv = Math.min(255, Math.max(0, out.rough * 255));
        rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rv;
        rImg.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  if (rough) rough.getContext('2d').putImageData(rImg, 0, 0);
  return {
    map: canvasTexture(color, true),
    normalMap: canvasTexture(heightToNormal(height, size, normalStrength), false),
    roughnessMap: rough ? canvasTexture(rough, false) : null,
  };
}

function bevel(edge, seam, width) {
  if (edge < seam) return 0;
  return Math.min(1, (edge - seam + 1) / width);
}

// Bright, matte, portal-friendly wall panels (1 x 1 m).
export function whitePanels(size = 1024) {
  return panelTexture({
    size, panelW: size / 4, panelH: size / 4, seed: 11, normalStrength: 2.2,
    shade: ({ edge, tone, n, f, py, panelH }) => {
      const h = bevel(edge, 2, 5);
      let g = 0.84 + (tone - 0.5) * 0.05 + (n - 0.5) * 0.06 + (f - 0.5) * 0.02;
      g -= Math.pow(py / panelH, 6) * 0.05; // a little grime collecting at the bottom
      if (edge < 2) g = 0.28;
      else if (edge < 5) g *= 0.93;
      return { r: g * 0.99, g: g, b: g * 1.01, h };
    },
  });
}

// Dark, brushed, non-portalable metal panels (2 x 2 m) with rivets.
export function metalPanels(size = 1024) {
  const pw = size / 2, ph = size / 2;
  const streak = makeNoise(size, 24, 77, 512); // stretched sideways: brushed metal
  return panelTexture({
    size, panelW: pw, panelH: ph, seed: 23, normalStrength: 3, roughness: true,
    shade: ({ x, y, px, py, edge, tone, n, f }) => {
      let h = bevel(edge, 3, 6);
      const s = streak(x, y);
      let g = 0.2 + (tone - 0.5) * 0.04 + (n - 0.5) * 0.05 + (s - 0.5) * 0.05 + (f - 0.5) * 0.02;
      // horizontal rib across the middle of each panel
      const rib = Math.abs(py - ph / 2);
      if (rib < 10) {
        h -= 0.6 * (1 - rib / 10);
        g *= 0.85;
      }
      // rivets near the corners
      for (const [cx, cy] of [[16, 16], [pw - 17, 16], [16, ph - 17], [pw - 17, ph - 17]]) {
        const d = Math.hypot(px - cx, py - cy);
        if (d < 6) {
          h += 0.9 * Math.sqrt(1 - (d / 6) * (d / 6));
          g += 0.08;
        }
      }
      if (edge < 3) g = 0.06;
      return { r: g * 0.97, g: g, b: g * 1.04, h, rough: 0.38 + (n - 0.5) * 0.3 + (1 - s) * 0.12 };
    },
  });
}

// Dark floor tiles (0.5 m).
export function floorTiles(size = 1024) {
  return panelTexture({
    size, panelW: size / 8, panelH: size / 8, seed: 41, normalStrength: 2.5, roughness: true,
    shade: ({ edge, tone, n, f }) => {
      const h = bevel(edge, 2, 4);
      let g = 0.24 + (tone - 0.5) * 0.06 + (n - 0.5) * 0.08 + (f - 0.5) * 0.04;
      if (edge < 2) g = 0.08;
      return { r: g, g: g * 1.01, b: g * 1.04, h, rough: 0.55 + (n - 0.5) * 0.4 };
    },
  });
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let glow = null;
export function getGlowTexture() {
  if (!glow) glow = glowTexture();
  return glow;
}

// The weighted cube's face: light panels, dark corner brackets and a ring
// that glows (the ring lives in a separate emissive map).
export function cubeFaceTextures() {
  const size = 512;
  const color = document.createElement('canvas');
  color.width = color.height = size;
  const ctx = color.getContext('2d');
  ctx.fillStyle = '#b9bdc1';
  ctx.fillRect(0, 0, size, size);
  // subtle panel lines
  ctx.strokeStyle = '#8d9196';
  ctx.lineWidth = 6;
  ctx.strokeRect(70, 70, size - 140, size - 140);
  // corner brackets
  ctx.fillStyle = '#4b4f55';
  const b = 150;
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [size, 0, -1, 1], [0, size, 1, -1], [size, size, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sx * b, y);
    ctx.lineTo(x + sx * b, y + sy * 46);
    ctx.lineTo(x + sx * 46, y + sy * 46);
    ctx.lineTo(x + sx * 46, y + sy * b);
    ctx.lineTo(x, y + sy * b);
    ctx.closePath();
    ctx.fill();
  }
  // central disc
  ctx.fillStyle = '#7c8086';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 118, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d4d7da';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 62, 0, Math.PI * 2);
  ctx.fill();

  const emissive = document.createElement('canvas');
  emissive.width = emissive.height = size;
  const e = emissive.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);
  e.strokeStyle = '#fff';
  e.lineWidth = 22;
  e.beginPath();
  e.arc(size / 2, size / 2, 90, 0, Math.PI * 2);
  e.stroke();
  // the ring is broken into four arcs
  e.strokeStyle = '#000';
  e.lineWidth = 30;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    e.beginPath();
    e.moveTo(size / 2 + Math.cos(a) * 70, size / 2 + Math.sin(a) * 70);
    e.lineTo(size / 2 + Math.cos(a) * 110, size / 2 + Math.sin(a) * 110);
    e.stroke();
  }
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(emissive);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

// The info panel next to the start position.
export function chamberSignTexture() {
  const w = 512, h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#eceae4';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2b2b2b';
  ctx.font = 'bold 300px "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('01', 30, 40);
  ctx.font = 'bold 48px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('01/19', 36, 350);
  // progress bar
  for (let i = 0; i < 19; i++) {
    ctx.fillStyle = i < 1 ? '#2b2b2b' : '#c9c7c0';
    ctx.fillRect(36 + i * 23, 420, 18, 14);
  }
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(30, 460, w - 60, 4);
  ctx.font = '600 30px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('TEST CHAMBER', 36, 480);
  // pictograms: cube drop, cube on button, portal
  const icon = (x, y, draw, on) => {
    ctx.fillStyle = on ? '#2b2b2b' : '#c9c7c0';
    ctx.fillRect(x, y, 120, 120);
    ctx.fillStyle = '#eceae4';
    ctx.strokeStyle = '#eceae4';
    ctx.lineWidth = 8;
    draw(x, y);
  };
  icon(36, 560, (x, y) => {
    ctx.fillRect(x + 38, y + 20, 44, 44);
    ctx.beginPath();
    ctx.moveTo(x + 60, y + 72);
    ctx.lineTo(x + 60, y + 100);
    ctx.stroke();
  }, true);
  icon(196, 560, (x, y) => {
    ctx.fillRect(x + 38, y + 30, 44, 44);
    ctx.fillRect(x + 20, y + 84, 80, 12);
  }, true);
  icon(356, 560, (x, y) => {
    ctx.beginPath();
    ctx.ellipse(x + 40, y + 60, 16, 38, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x + 84, y + 60, 16, 38, 0, 0, Math.PI * 2);
    ctx.stroke();
  }, true);
  icon(36, 720, (x, y) => {
    ctx.beginPath();
    ctx.arc(x + 60, y + 50, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + 50, y + 70, 20, 34);
  }, false);
  icon(196, 720, (x, y) => {
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 22 + i * 22, y + 30, 8, 60);
  }, false);
  icon(356, 720, (x, y) => {
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 90);
    ctx.quadraticCurveTo(x + 60, y + 10, x + 100, y + 90);
    ctx.stroke();
  }, false);
  ctx.fillStyle = '#2b2b2b';
  ctx.font = '500 22px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('Bring the cube to the button.', 36, 880);
  ctx.fillText('Some surfaces will not hold a portal.', 36, 912);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
