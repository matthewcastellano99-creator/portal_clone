import * as THREE from 'three';
import { Box } from './physics.js';

const ANT_OFF = new THREE.Color(0x3a7fd0);
const ANT_ON = new THREE.Color(0xff9a2a);

// Floor button. Pressed while the player or the (unheld) cube rests on it.
export class FloorButton {
  constructor(scene, pos) {
    this.pos = new THREE.Vector3(...pos);
    this.pressed = false;
    this.press = 0; // animated 0..1
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.45, metalness: 0.7 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.95, 0.06, 48), baseMat);
    base.position.y = 0.03;
    base.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 10, 48), new THREE.MeshStandardMaterial({ color: 0x1f2225, roughness: 0.4, metalness: 0.8 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.065;
    this.padMat = new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.4, metalness: 0.1, emissive: 0x5a0805, emissiveIntensity: 0.6 });
    this.pad = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 48), this.padMat);
    this.pad.castShadow = true;
    this.pad.receiveShadow = true;
    this.group.add(base, rim, this.pad);
    scene.add(this.group);
    this.update(0, []);
  }

  isOn(body) {
    const dx = body.pos.x - this.pos.x;
    const dz = body.pos.z - this.pos.z;
    const bottom = body.min(1) - this.pos.y;
    return Math.hypot(dx, dz) < 0.75 && bottom > -0.2 && bottom < 0.3;
  }

  // Returns 'down' / 'up' when the state changes.
  update(dt, bodies) {
    const was = this.pressed;
    this.pressed = bodies.some((b) => this.isOn(b));
    this.press = THREE.MathUtils.clamp(this.press + (this.pressed ? dt : -dt) / 0.12, 0, 1);
    this.pad.position.y = THREE.MathUtils.lerp(0.07, -0.02, this.press);
    this.padMat.emissiveIntensity = 0.6 + this.press * 1.4;
    if (this.pressed !== was) return this.pressed ? 'down' : 'up';
    return null;
  }
}

// Two-panel sliding door set into a wall facing +x.
export class SlidingDoor {
  constructor(scene, def) {
    this.def = def;
    this.open = 0;
    this.target = 0;
    const panelMat = new THREE.MeshStandardMaterial({ color: 0xd9dbdc, roughness: 0.4, metalness: 0.2 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x25282c, roughness: 0.5, metalness: 0.7 });
    const half = def.width / 2;
    const panelGeo = new THREE.BoxGeometry(0.22, def.height, half);
    this.panels = [-1, 1].map((side) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(panelGeo, panelMat);
      m.castShadow = true;
      m.receiveShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, def.height, 0.08), trimMat);
      stripe.position.z = -side * (half / 2 - 0.04);
      g.add(m, stripe);
      scene.add(g);
      return { group: g, side, box: new Box([0, 0, 0], [0, 0, 0], { mat: 'metal', dynamic: true, tag: 'door' }) };
    });

    // frame on the wall face
    const fx = def.x + 0.5 + 0.04;
    const frame = [
      [0.1, 0.2, def.width + 0.5, fx, def.y + def.height + 0.1, def.z],
      [0.1, def.height, 0.2, fx, def.y + def.height / 2, def.z - half - 0.1],
      [0.1, def.height, 0.2, fx, def.y + def.height / 2, def.z + half + 0.1],
    ];
    for (const [w, h, d, x, y, z] of frame) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimMat);
      m.position.set(x, y, z);
      scene.add(m);
    }
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a1a, emissiveIntensity: 3 });
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.7), this.lightMat);
    light.position.set(fx + 0.04, def.y + def.height + 0.1, def.z);
    scene.add(light);
    this.layout();
  }

  layout() {
    const d = this.def;
    const half = d.width / 2;
    for (const p of this.panels) {
      const zc = d.z + p.side * (half / 2 + this.open * half);
      p.group.position.set(d.x, d.y + d.height / 2, zc);
      p.box.min = [d.x - 0.11, d.y, zc - half / 2];
      p.box.max = [d.x + 0.11, d.y + d.height, zc + half / 2];
    }
  }

  get boxes() {
    return this.panels.map((p) => p.box);
  }

  update(dt) {
    const speed = this.target > this.open ? 1.6 : 2.6;
    const before = this.open;
    this.open = THREE.MathUtils.clamp(this.open + Math.sign(this.target - this.open) * dt * speed, 0, 1);
    if (this.open !== before) this.layout();
    this.lightMat.emissive.setHex(this.open > 0.98 ? 0x30ff6a : 0xff2a1a);
  }
}

// Indicator dots from the button to the door; they light up when powered.
// `path` is a list of points; the dots follow it segment by segment, across
// floors and down walls.
export class Antline {
  constructor(scene, path) {
    const pts = path.map((p) => new THREE.Vector3(...p));
    const dots = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const n = Math.max(1, Math.round(pts[i].distanceTo(pts[i + 1]) / 0.3));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) dots.push(pts[i].clone().lerp(pts[i + 1], k / n));
    }
    this.mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: ANT_OFF.clone(), emissiveIntensity: 1.2 });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), this.mat, dots.length);
    const m = new THREE.Matrix4();
    dots.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    scene.add(mesh);
  }

  set(on) {
    this.mat.emissive.copy(on ? ANT_ON : ANT_OFF);
    this.mat.emissiveIntensity = on ? 2.2 : 1.2;
  }
}

const ELEVATOR_RADIUS = 1.1;
const ELEVATOR_HEIGHT = 2.85;
const DOOR_GAP = 1.9; // radians of tube left open for the doorway

// Glass elevator car that carries the player between chambers. `pos` is the
// centre of its floor and `yaw` turns the doorway (which faces +z at yaw 0)
// towards the room.
export class Elevator {
  constructor(scene, { pos, yaw }) {
    this.base = new THREE.Vector3(...pos);
    this.lift = 0;
    this.closed = 0;
    this.group = new THREE.Group();
    this.group.position.copy(this.base);
    this.group.rotation.y = yaw;

    const glass = new THREE.MeshStandardMaterial({
      color: 0xa9dcff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.1,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.45, metalness: 0.7 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xbfe8ff, emissiveIntensity: 2.6 });
    const R = ELEVATOR_RADIUS, H = ELEVATOR_HEIGHT;

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 48, 1, true, DOOR_GAP / 2, Math.PI * 2 - DOOR_GAP), glass);
    tube.position.y = H / 2;
    this.door = new THREE.Group();
    const doorGlass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, H - 0.1, 24, 1, true, -DOOR_GAP / 2, DOOR_GAP), glass);
    doorGlass.position.y = H / 2;
    this.door.add(doorGlass);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.16, R + 0.16, 0.12, 48), metal);
    floor.position.y = -0.04;
    floor.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.16, R + 0.16, 0.16, 48), metal);
    roof.position.y = H + 0.08;
    const roofLight = new THREE.Mesh(new THREE.CircleGeometry(R * 0.7, 40), glow);
    roofLight.rotation.x = Math.PI / 2;
    roofLight.position.y = H - 0.005;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.08, 0.035, 8, 48), glow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    const posts = [-1, 1].map((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), metal);
      const a = side * DOOR_GAP / 2;
      post.position.set(Math.sin(a) * R, H / 2, Math.cos(a) * R);
      return post;
    });
    this.group.add(tube, this.door, floor, roof, roofLight, ring, ...posts);
    scene.add(this.group);
    this.setDoor(0);
  }

  // 0 = open, 1 = closed. The door slides round behind the glass to open.
  setDoor(closed) {
    this.closed = closed;
    this.door.rotation.y = (1 - closed) * (DOOR_GAP + 0.15);
  }

  setLift(h) {
    this.lift = h;
    this.group.position.y = this.base.y + h;
  }

  // Is a body standing inside the car, near its middle?
  holds(body) {
    const dx = body.pos.x - this.base.x, dz = body.pos.z - this.base.z;
    return Math.hypot(dx, dz) < 0.7 && Math.abs(body.min(1) - this.base.y) < 0.4;
  }
}
