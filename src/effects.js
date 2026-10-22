import * as THREE from 'three';
import { getGlowTexture } from './textures.js';

const MAX_PARTICLES = 400;

// Portal shot projectiles and spark bursts.
export class Effects {
  constructor(scene) {
    this.shots = [];
    this.shotMats = [0x2a8cff, 0xff8a1c].map(
      (c) => new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(c).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.scene = scene;

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.06, map: getGlowTexture(), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.particles = [];
  }

  shoot(from, to, id, onArrive) {
    const sprite = new THREE.Sprite(this.shotMats[id]);
    sprite.scale.setScalar(0.35);
    sprite.position.copy(from);
    this.scene.add(sprite);
    const dist = from.distanceTo(to);
    this.shots.push({ sprite, from: from.clone(), to: to.clone(), t: 0, dur: Math.max(0.04, Math.min(0.2, dist / 120)), onArrive });
  }

  burst(pos, normal, color, count = 40, speed = 4) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      if (normal && dir.dot(normal) < 0) dir.addScaledVector(normal, -2 * dir.dot(normal));
      this.particles.push({
        p: pos.clone().addScaledVector(normal ?? dir, 0.03),
        v: dir.multiplyScalar(speed * (0.3 + Math.random())),
        life: 0.4 + Math.random() * 0.5,
        age: 0,
        c: c.clone().multiplyScalar(2 + Math.random() * 2),
      });
    }
  }

  update(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt / s.dur;
      s.sprite.position.lerpVectors(s.from, s.to, Math.min(1, s.t));
      if (s.t >= 1) {
        this.scene.remove(s.sprite);
        this.shots.splice(i, 1);
        s.onArrive?.();
      }
    }
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.v.y -= 9 * dt;
      p.v.multiplyScalar(Math.exp(-dt * 2));
      p.p.addScaledVector(p.v, dt);
      const fade = 1 - p.age / p.life;
      this.positions.set([p.p.x, p.p.y, p.p.z], n * 3);
      this.colors.set([p.c.r * fade, p.c.g * fade, p.c.b * fade], n * 3);
      n++;
    }
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
