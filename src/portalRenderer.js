import * as THREE from 'three';
import { PORTAL } from './config.js';

// Renders what each portal sees into a screen-sized texture. The portal
// surface shader then samples that texture in screen space, so the view lines
// up exactly with the main camera.
//
// Looking into portal P shows the world from a virtual camera placed behind
// its partner Q. If P is visible again inside that view, the next level is the
// virtual camera pushed through once more, and so on. Levels are rendered
// deepest first, ping-ponging between P's final target and a shared scratch
// target, and each level is scissored to where P appears on screen.
export class PortalRenderer {
  constructor(renderer, scene, portals, { samples = 0 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.portals = portals;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.matrixAutoUpdate = false;
    this.cam.layers.enable(1); // third-person player model is on layer 1
    const opts = { type: THREE.HalfFloatType, depthBuffer: true };
    this.finals = portals.map(() => new THREE.WebGLRenderTarget(1, 1, { ...opts, samples }));
    this.scratch = new THREE.WebGLRenderTarget(1, 1, opts);
    this.width = 1;
    this.height = 1;
    this.mats = Array.from({ length: PORTAL.maxRecursion + 1 }, () => new THREE.Matrix4());
    this.rects = Array.from({ length: PORTAL.maxRecursion + 1 }, () => [0, 0, 0, 0]);
    this.clipPlane = new THREE.Plane();
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._v4 = new THREE.Vector4();
    this._camPos = new THREE.Vector3();
    this.stats = { renders: 0 };
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    for (const rt of this.finals) rt.setSize(w, h);
    this.scratch.setSize(w, h);
  }

  render(mainCam, beforeRender) {
    this.stats.renders = 0;
    for (const P of this.portals) P.deepMesh.visible = false;
    this.portals.forEach((P, i) => {
      if (P.linked) this.renderPortal(P, this.finals[i], mainCam, beforeRender);
    });
    this.renderer.clippingPlanes = [];
    this.renderer.setRenderTarget(null);

    this._camPos.setFromMatrixPosition(mainCam.matrixWorld);
    this.portals.forEach((P, i) => {
      P.uniforms.tex.value = this.finals[i].texture;
      P.uniforms.mode.value = P.linked ? 0 : 1;
      P.mesh.visible = P.placed;
      P.deepMesh.visible = P.linked && this.cameraHugging(P, this._camPos);
    });
  }

  // True when the camera is close enough to the portal surface that the near
  // plane could cut it.
  cameraHugging(P, camPos) {
    const d = P.distance(camPos);
    if (d < 0 || d > 0.35) return false;
    const m = 0.25;
    return (
      camPos.getComponent(P.t1) > P.rmin[P.t1] - m && camPos.getComponent(P.t1) < P.rmax[P.t1] + m &&
      camPos.getComponent(P.t2) > P.rmin[P.t2] - m && camPos.getComponent(P.t2) < P.rmax[P.t2] + m
    );
  }

  renderPortal(P, final, mainCam, beforeRender) {
    const Q = P.partner;
    const proj = mainCam.projectionMatrix;
    const mats = this.mats;
    const rects = this.rects;
    mats[0].copy(mainCam.matrixWorld);
    rects[0][0] = 0; rects[0][1] = 0; rects[0][2] = this.width; rects[0][3] = this.height;

    let levels = 0;
    for (let k = 1; k <= PORTAL.maxRecursion; k++) {
      if (!this.visibleFrom(P, mats[k - 1], proj)) break;
      const r = rects[k];
      this.screenRect(P, mats[k - 1], proj, r);
      r[0] = Math.max(r[0], rects[k - 1][0]);
      r[1] = Math.max(r[1], rects[k - 1][1]);
      r[2] = Math.min(r[2], rects[k - 1][2]);
      r[3] = Math.min(r[3], rects[k - 1][3]);
      if (r[2] - r[0] < 1 || r[3] - r[1] < 1) break;
      mats[k].multiplyMatrices(P.toPartner, mats[k - 1]);
      levels = k;
    }
    if (levels === 0) return;

    const renderer = this.renderer;
    const cam = this.cam;
    cam.projectionMatrix.copy(proj);
    cam.projectionMatrixInverse.copy(mainCam.projectionMatrixInverse);
    this.clipPlane.setFromNormalAndCoplanarPoint(Q.normal, Q.pos);
    const qVisible = Q.mesh.visible;
    Q.mesh.visible = false;

    for (let k = levels; k >= 1; k--) {
      const target = k % 2 === 1 ? final : this.scratch;
      if (k === levels) {
        P.uniforms.mode.value = 2;
      } else {
        P.uniforms.mode.value = 0;
        P.uniforms.tex.value = ((k + 1) % 2 === 1 ? final : this.scratch).texture;
      }
      cam.matrix.copy(mats[k]);
      cam.updateMatrixWorld(true);
      beforeRender?.(this._v.setFromMatrixPosition(mats[k]));

      const r = rects[k];
      target.viewport.set(0, 0, this.width, this.height);
      target.scissor.set(Math.floor(r[0]), Math.floor(r[1]), Math.ceil(r[2] - r[0]), Math.ceil(r[3] - r[1]));
      target.scissorTest = true;
      renderer.clippingPlanes = [this.clipPlane];
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(this.scene, cam);
      this.stats.renders++;
    }
    Q.mesh.visible = qVisible;
  }

  visibleFrom(P, camMatrix, proj) {
    const camPos = this._v.setFromMatrixPosition(camMatrix);
    if (P.distance(camPos) <= 0.0005) return false;
    this._m.copy(camMatrix).invert().premultiply(proj);
    this._frustum.setFromProjectionMatrix(this._m);
    return this._frustum.intersectsSphere(P.sphere);
  }

  // Pixel-space bounding rectangle of the portal as seen from a camera.
  screenRect(P, camMatrix, proj, out) {
    this._m.copy(camMatrix).invert().premultiply(proj);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 0.5 : -0.5;
      const sy = i & 2 ? 0.5 : -0.5;
      const v = this._v4.set(
        P.pos.x + P.right.x * sx * PORTAL.width + P.up.x * sy * PORTAL.height,
        P.pos.y + P.right.y * sx * PORTAL.width + P.up.y * sy * PORTAL.height,
        P.pos.z + P.right.z * sx * PORTAL.width + P.up.z * sy * PORTAL.height,
        1,
      ).applyMatrix4(this._m);
      if (v.w <= 1e-4) {
        out[0] = 0; out[1] = 0; out[2] = this.width; out[3] = this.height;
        return out;
      }
      const px = (v.x / v.w * 0.5 + 0.5) * this.width;
      const py = (v.y / v.w * 0.5 + 0.5) * this.height;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px);
      y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    out[0] = Math.max(0, x0 - 2);
    out[1] = Math.max(0, y0 - 2);
    out[2] = Math.min(this.width, x1 + 2);
    out[3] = Math.min(this.height, y1 + 2);
    return out;
  }
}
