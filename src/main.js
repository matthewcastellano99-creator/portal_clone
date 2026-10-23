import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { PLAYER, PHYSICS, PORTAL, CUBE, RENDER } from './config.js';
import { PhysicsWorld } from './physics.js';
import { PortalSystem, teleportBody } from './portals.js';
import { PortalRenderer } from './portalRenderer.js';
import { createMaterials } from './materials.js';
import { buildLevel } from './level.js';
import { LEVELS } from './levels.js';
import { Player } from './player.js';
import { WeightedCube } from './cube.js';
import { FloorButton, SlidingDoor, Antline, Elevator } from './entities.js';
import { ViewModel } from './gun.js';
import { Avatar } from './avatar.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';
import { TouchControls } from './touch.js';

// Draws a second scene (the first-person gun) over the main image.
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}

const params = new URLSearchParams(location.search);
const TOUCH = window.matchMedia('(pointer: coarse)').matches;

// Phones and tablets get lighter settings; ?quality=high|mobile|low overrides.
const PRESETS = {
  high: { pixelRatio: RENDER.maxPixelRatio, recursion: 4, composerSamples: 4, portalSamples: 2, shadowMap: 2048, texture: 1024 },
  mobile: { pixelRatio: 1.25, recursion: 3, composerSamples: 4, portalSamples: 0, shadowMap: 1024, texture: 512 },
  low: { pixelRatio: 1, recursion: 2, composerSamples: 0, portalSamples: 0, shadowMap: 1024, texture: 512 },
};
const QUALITY = PRESETS[params.get('quality')] ?? (TOUCH ? PRESETS.mobile : PRESETS.high);
PORTAL.maxRecursion = QUALITY.recursion;

class Game {
  constructor(saved = {}) {
    this.canvas = document.getElementById('game');
    this.ui = {
      overlay: document.getElementById('overlay'),
      overlayTitle: document.getElementById('overlay-title'),
      play: document.getElementById('play'),
      complete: document.getElementById('complete'),
      stats: document.getElementById('complete-stats'),
      replay: document.getElementById('replay'),
      chooseChamber: document.getElementById('choose-chamber'),
      completeChoose: document.getElementById('complete-choose'),
      restartChamber: document.getElementById('restart-chamber'),
      chambers: document.getElementById('chambers'),
      skins: document.querySelectorAll('[data-skin]'),
      help: document.getElementById('help'),
      hint: document.getElementById('hint'),
      subtitle: document.getElementById('subtitle'),
      chBlue: document.getElementById('ch-blue'),
      chOrange: document.getElementById('ch-orange'),
      debug: params.has('debug') ? document.getElementById('debug') : null,
      fade: document.getElementById('fade'),
      loading: document.getElementById('loading'),
      rotate: document.getElementById('rotate'),
    };
    document.body.classList.toggle('touch', TOUCH);
    if (TOUCH) this.ui.play.textContent = 'Tap to begin testing';

    this.initRenderer();
    this.initWorld();
    this.initInput();
    this.onResize();

    this.state = { started: false, paused: true, completed: false, time: 0, portalsFired: 0 };
    this.transition = null;
    this.keys = new Set();
    this.accumulator = 0;
    this.timer = new THREE.Timer();
    this.elapsed = 0;
    this.hintTimer = 0;
    this.subtitleTimer = 0;
    this.loadLevel(LEVELS[saved?.level] ? saved.level : 0);
    this.restore(saved);

    window.__game = this;
    if (params.has('autostart')) this.begin(false);
    this.ui.loading.classList.add('hidden');
    this.renderer.setAnimationLoop((time) => this.tick(time));
  }

  initRenderer() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio, QUALITY.pixelRatio);
    renderer.setPixelRatio(this.maxPixelRatio);
    // Some mobile GPUs can't render into half-float targets; fall back to
    // 8-bit targets (and no bloom, which needs them) there.
    const ext = renderer.extensions;
    this.halfFloat = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.targetType = this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);
    scene.matrixWorldAutoUpdate = false;
    if (this.halfFloat) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      scene.environmentIntensity = 0.35;
    } else {
      // PMREMGenerator always renders into half-float targets, which this GPU
      // can't draw into; light the metal with a plain ambient term instead.
      scene.add(new THREE.AmbientLight(0xdde6f0, 0.6));
    }
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);

    const sun = new THREE.DirectionalLight(0xfff4e6, 2.3);
    sun.position.set(2, 30, 5);
    sun.target.position.set(-4, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(QUALITY.shadowMap, QUALITY.shadowMap);
    const sc = sun.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17;
    sc.near = 5; sc.far = 60;
    sc.layers.enable(1); // let the third-person body cast a shadow
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;
    scene.add(new THREE.HemisphereLight(0xdde6f0, 0x3a3f45, 0.9));
    // Lights the exit corridor; each level places it.
    this.fillLight = new THREE.PointLight(0xdfefff, 8, 9, 2);
    scene.add(this.fillLight);

    this.composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: this.targetType, samples: QUALITY.composerSamples });
    this.composer = new EffectComposer(renderer, this.composerTarget);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.skin = savedSkin();
    this.viewModel = new ViewModel(1, this.skin);
    // reflections for the glossy device
    this.viewModel.scene.environment = scene.environment;
    this.viewModel.scene.environmentIntensity = 0.4;
    this.composer.addPass(new OverlayPass(this.viewModel.scene, this.viewModel.camera));
    if (this.halfFloat) {
      const { strength, radius, threshold } = RENDER.bloom;
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), strength, radius, threshold));
    }
    this.composer.addPass(new OutputPass());
  }

  initWorld() {
    const scene = this.scene;
    this.physics = new PhysicsWorld();
    this.materials = createMaterials(this.renderer, QUALITY.texture);

    this.resolution = new THREE.Vector2(1, 1);
    this.portals = new PortalSystem(scene, this.physics, this.resolution);
    this.portalRenderer = new PortalRenderer(this.renderer, scene, this.portals.portals, { samples: QUALITY.portalSamples, type: this.targetType });

    this.player = new Player();
    this.avatar = new Avatar(scene, [1], this.skin);
    this.avatarClone = new Avatar(scene, [0, 1], this.skin);
    this.avatarClone.root.matrixAutoUpdate = false;
    this.effects = new Effects(scene);
    this.sfx = new Sfx();

    this.physics.dynamicSources.push(() => this.door.boxes);
    this.physics.dynamicSources.push((body) => {
      if (this.cube.held) return [];
      if (body === this.player.body) return [this.cube.body.syncBox()];
      if (body === this.cube.body) return [this.player.body.syncBox()];
      return [];
    });
  }

  initInput() {
    window.addEventListener('resize', () => this.onResize());
    window.visualViewport?.addEventListener('resize', () => this.onResize());
    this.ui.play.addEventListener('click', () => this.begin(true));
    this.ui.replay.addEventListener('click', () => {
      this.newGame();
      this.begin(true);
    });
    this.ui.chooseChamber.addEventListener('click', () => this.showChambers(this.ui.chambers.hidden));
    this.ui.completeChoose.addEventListener('click', () => {
      this.ui.complete.classList.add('hidden');
      this.ui.overlay.classList.remove('hidden');
      this.showChambers(true);
    });
    this.ui.restartChamber.addEventListener('click', () => {
      this.restart();
      this.begin(true);
    });
    this.ui.chambers.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-chamber]');
      if (tile) this.selectChamber(Number(tile.dataset.chamber));
    });
    for (const button of this.ui.skins) {
      button.addEventListener('click', () => this.setSkin(button.dataset.skin));
    }
    this.showSkin();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state.started && !this.state.paused && !this.state.completed) this.pause();
      if (!document.hidden && this.state.started && !this.state.paused && !this.state.completed) this.keepAwake();
    });

    this.touch = new TouchControls(document.getElementById('touch'), {
      onLook: (dx, dy) => this.look(dx, dy),
      onFire: (id) => this.shoot(id),
      onUse: () => this.use(),
      onPause: () => this.pause(),
    });
    // A finger anywhere switches to the on-screen controls (e.g. on a laptop
    // with a touch screen) and the mouse switches back. A pen works with
    // whichever controls are showing, so it doesn't switch.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'mouse') return;
      const touch = e.pointerType === 'touch';
      if (touch === document.body.classList.contains('touch')) return;
      const playing = this.state.started && !this.state.paused && !this.state.completed;
      document.body.classList.toggle('touch', touch);
      this.touch.enabled = touch && playing;
      if (touch) {
        // The finger landed on the game view before the controls appeared.
        if (this.touch.enabled && e.target === this.canvas) this.touch.down(e);
      } else if (playing) {
        // The hidden controls swallow this click, so take over the mouse here.
        this.begin(true);
      }
    }, true);

    // Mouse: pointer lock when the browser allows it. Where it doesn't (some
    // embedded views), drag to look and click without dragging to fire.
    this.pointerLockFailed = !('requestPointerLock' in this.canvas);
    this.hadLock = false;
    this.drag = null;
    document.addEventListener('pointerlockerror', () => this.onPointerLockFailed());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) this.hadLock = true;
      if (!locked && this.state.started && !this.state.completed && !params.has('autostart')) this.pause();
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state.paused || this.state.completed) return;
      if (document.pointerLockElement === this.canvas) {
        if (e.button === 0) this.shoot(0);
        else if (e.button === 2) this.shoot(1);
      } else if (this.pointerLockFailed) {
        this.drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
      } else {
        this.begin(true);
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.look(e.movementX, e.movementY);
      } else if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.look(dx * 1.5, dy * 1.5);
      }
    });
    document.addEventListener('mouseup', () => {
      if (!this.drag) return;
      if (this.drag.moved < 6 && !this.state.paused) {
        if (this.drag.button === 0) this.shoot(0);
        else if (this.drag.button === 2) this.shoot(1);
      }
      this.drag = null;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      // Without pointer lock the browser doesn't turn Esc into a pause for us.
      if (e.code === 'Escape' && document.pointerLockElement !== this.canvas && this.state.started && !this.state.paused && !this.state.completed) {
        this.pause();
        return;
      }
      if (e.repeat || this.state.paused) return;
      if (e.code === 'KeyE' || e.code === 'KeyF') this.use();
      if (e.code === 'KeyR' && !this.transition) this.restart();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  begin(lock) {
    this.sfx.init();
    this.state.started = true;
    this.state.paused = false;
    this.ui.overlay.classList.add('hidden');
    this.ui.complete.classList.add('hidden');
    const touch = document.body.classList.contains('touch');
    this.touch.enabled = touch && !this.transition;
    if (touch) {
      // Full screen and landscape where the browser allows it (Android).
      const el = document.documentElement;
      if (lock && !document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' })
          .then(() => screen.orientation?.lock?.('landscape'))
          .catch(() => {});
      }
    } else if (lock && !this.pointerLockFailed) {
      // Older browsers return undefined here instead of a promise.
      this.canvas.requestPointerLock()?.catch?.(() => this.onPointerLockFailed());
    }
    this.keepAwake();
    if (!this.introShown) {
      this.introShown = true;
      this.say(this.level.intro, 7);
    }
  }

  // A refusal after the lock has worked before is temporary (Chrome refuses
  // for a moment after Esc), so pause and let the next click try again. A
  // refusal before that means this page can't lock the pointer at all.
  onPointerLockFailed() {
    if (!this.hadLock) this.pointerLockFailed = true;
    else if (this.state.started && !this.state.paused && !this.state.completed) this.pause();
  }

  pause() {
    this.state.paused = true;
    this.dirty = true;
    this.releaseWakeLock();
    this.keys.clear();
    this.drag = null;
    this.touch.enabled = false;
    this.ui.overlayTitle.textContent = `Paused · ${chamberName(this.level)}`;
    this.ui.play.textContent = document.body.classList.contains('touch') ? 'Tap to resume' : 'Click to resume';
    this.ui.restartChamber.hidden = false;
    this.showChambers(false);
    this.ui.overlay.classList.remove('hidden');
    this.ui.overlay.scrollTop = 0;
  }

  // The chamber cards in the start/pause menu. Every chamber can be picked;
  // finished ones are ticked (remembered on this device only).
  showChambers(open) {
    const done = completedChambers();
    this.ui.chambers.innerHTML = LEVELS.map((def, i) => {
      const finished = done.has(def.number);
      const current = i === this.levelIndex && this.state.started;
      const state = finished ? '✓ Completed' : current ? 'Current' : 'Not yet solved';
      const bar = LEVELS.map((_, k) => `<i class="${k < def.number ? 'on' : ''}"></i>`).join('');
      return `<button class="chamber-tile${finished ? ' done' : ''}${current ? ' current' : ''}" data-chamber="${i}" aria-label="Play ${chamberName(def)}">` +
        `<span class="tile-num">${pad2(def.number)}</span><span class="tile-bar">${bar}</span>` +
        `<span class="tile-line">${def.card[0]}</span><span class="tile-state">${state}</span></button>`;
    }).join('');
    this.ui.chambers.hidden = !open;
    this.ui.help.hidden = open;
    this.ui.chooseChamber.setAttribute('aria-expanded', String(open));
    this.ui.chooseChamber.textContent = open ? 'Hide levels' : 'Select level';
  }

  // The look of the player's body and device; remembered on this device.
  setSkin(skin) {
    if (skin === this.skin) return;
    this.skin = skin;
    this.viewModel.setSkin(skin);
    this.avatar.setSkin(skin);
    this.avatarClone.setSkin(skin);
    this.dirty = true;
    this.showSkin();
    try {
      localStorage.setItem(SKIN_KEY, skin);
    } catch {
      // not remembered
    }
  }

  showSkin() {
    for (const button of this.ui.skins) button.setAttribute('aria-pressed', String(button.dataset.skin === this.skin));
  }

  selectChamber(index) {
    this.newGame(index);
    this.showChambers(false);
    this.begin(true);
  }

  // Stop the screen dimming while playing on a phone. Optional everywhere.
  keepAwake() {
    if (!navigator.wakeLock || this.wakeLock) return;
    navigator.wakeLock.request('screen').then((lock) => {
      if (this.state.paused || this.state.completed) {
        lock.release().catch(() => {});
        return;
      }
      this.wakeLock = lock;
      lock.addEventListener('release', () => (this.wakeLock = null));
    }).catch(() => {});
  }

  releaseWakeLock() {
    const lock = this.wakeLock;
    this.wakeLock = null;
    lock?.release().catch(() => {});
  }

  look(dx, dy) {
    this.player.look(dx, dy);
    this.viewModel.addSway(dx, dy);
  }

  // Build a chamber, replacing the current one.
  loadLevel(index) {
    if (this.levelRoot) {
      this.scene.remove(this.levelRoot);
      disposeTree(this.levelRoot, new Set(Object.values(this.materials)));
    }
    const def = LEVELS[index];
    this.levelIndex = index;
    this.level = def;
    this.physics.statics = [];
    this.levelRoot = new THREE.Group();
    this.scene.add(this.levelRoot);
    buildLevel(this.levelRoot, this.physics, this.materials, def);
    this.cube = new WeightedCube(this.levelRoot, def.cube);
    this.button = new FloorButton(this.levelRoot, def.button);
    this.door = new SlidingDoor(this.levelRoot, def.door);
    this.antline = new Antline(this.levelRoot, def.antline);
    this.exitLift = new Elevator(this.levelRoot, def.exit);
    this.arrivalLift = def.arrival ? new Elevator(this.levelRoot, def.arrival) : null;
    this.fillLight.position.fromArray(def.fillLight);
    const { x, z, half } = def.shadow;
    this.sun.position.set(x + 6, 30, z + 5);
    this.sun.target.position.set(x, 0, z);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -half;
    sc.right = sc.top = half;
    sc.updateProjectionMatrix();
    if (!this.state.started) this.ui.overlayTitle.textContent = chamberName(def);
    this.restart();
  }

  // Put the current chamber back the way it started.
  restart() {
    this.dirty = true;
    this.portals.reset();
    this.cube.reset();
    this.cube.lastExit = null;
    this.sfx.setHolding(false);
    this.spawnPlayer();
    this.door.open = 0;
    this.door.target = 0;
    this.door.layout();
    this.button.pressed = false;
    this.antline.set(false);
    this.doorAnnounced = false;
    this.exitLift.setDoor(0);
    this.exitLift.setLift(0);
    this.arrivalLift?.setDoor(0);
    this.arrivalLift?.setLift(0);
    this.ui.complete.classList.add('hidden');
    this.updateCrosshair();
  }

  // The first chamber starts on the floor; later ones in the arrival elevator.
  spawnPlayer() {
    const { arrival, spawn } = this.level;
    if (arrival) this.player.spawn(arrival.pos, arrival.yaw + Math.PI);
    else this.player.spawn(spawn.pos, spawn.yaw);
  }

  // Back to the first chamber with fresh totals.
  newGame(index = 0) {
    this.transition = null;
    this.fade(false);
    this.state.completed = false;
    this.state.time = 0;
    this.state.portalsFired = 0;
    this.introShown = false;
    this.ui.complete.classList.add('hidden');
    this.loadLevel(index);
  }

  onResize() {
    this.dirty = true;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio ?? this.maxPixelRatio);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // In portrait, widen the view so the sides aren't cut off as much.
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(RENDER.fov) / 2) * 16 / 9);
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect));
    this.camera.fov = THREE.MathUtils.clamp(vfov, RENDER.fov, 95);
    this.camera.updateProjectionMatrix();
    this.ui.rotate.hidden = !(TOUCH && h > w);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.portalRenderer.setSize(W, H);
    this.resolution.set(W, H);
    this.viewModel.setSize(w / h);
  }

  input() {
    const k = this.keys;
    const down = (...codes) => codes.some((c) => k.has(c));
    const t = this.touch;
    return {
      forward: THREE.MathUtils.clamp((down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0) + t.move.y, -1, 1),
      strafe: THREE.MathUtils.clamp((down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0) + t.move.x, -1, 1),
      jump: down('Space') || t.jump || t.jumpLatch,
    };
  }

  // ---------------------------------------------------------------- actions

  shoot(id) {
    if (this.state.completed || this.transition) return;
    const eye = this.player.eye;
    const dir = this.player.forward();
    const P = this.portals.portals[id];
    const before = this.captureTunnelState(P);
    // Shots pass through the cube, so aiming at it puts a portal under it.
    const res = this.portals.tryPlace(id, eye, dir, dir, this.door.boxes, this.door.boxes);
    this.state.portalsFired++;
    this.viewModel.fire(id);
    this.sfx.shoot(id);
    const muzzle = new THREE.Vector3(0.2, -0.17, -0.8).applyMatrix4(this.camera.matrixWorld);
    if (res.ok) this.onPortalMoved(P, before);
    if (res.point) {
      this.effects.shoot(muzzle, res.point, id, () => {
        if (res.ok) {
          this.effects.burst(res.point, res.normal, PORTAL.colors[id], 50, 3);
          this.sfx.portalOpen(id);
        } else {
          this.effects.burst(res.point, res.normal, 0xc8d8ff, 24, 2.5);
          this.sfx.fizzle();
        }
      });
    }
    this.updateCrosshair();
  }

  // Remember which bodies are part way into portal P before it moves.
  captureTunnelState(P) {
    if (!P.placed) return [];
    const inside = [];
    for (const body of [this.player.body, this.cube.body]) {
      if (body.portalMode !== P) continue;
      const near = P.sign > 0 ? body.min(P.axis) - P.plane : P.plane - body.max(P.axis);
      if (near < 0) inside.push({ body, axis: P.axis, sign: P.sign, plane: P.plane });
    }
    return inside;
  }

  onPortalMoved(P, before) {
    // Anything that was half-way into the old hole is pushed back out.
    for (const { body, axis, sign, plane } of before) {
      const out = sign > 0 ? plane + body.half[axis] + 0.01 : plane - body.half[axis] - 0.01;
      body.pos.setComponent(axis, out);
      body.portalMode = null;
      this.physics.depenetrate(body, body === this.cube.body ? this.cube.body.box : undefined);
    }
    if (this.cube.held && this.cube.via && (this.cube.via === P || this.cube.via === P.partner)) this.dropCube();
  }

  use() {
    if (this.state.completed || this.transition) return;
    if (this.cube.held) {
      this.dropCube();
      return;
    }
    const hit = this.lookAtCube();
    if (hit && !this.standingOnCube()) {
      this.cube.held = true;
      this.cube.via = hit.via;
      this.cube.strain = 0;
      this.cube.lastExit = null;
      this.sfx.pickup();
    } else {
      this.sfx.denied();
    }
  }

  dropCube() {
    if (!this.cube.held) return;
    this.cube.held = false;
    this.cube.via = null;
    this.cube.body.vel.multiplyScalar(0.5);
    this.sfx.drop();
  }

  standingOnCube() {
    const p = this.player.body, c = this.cube.body;
    return Math.abs(p.min(1) - c.max(1)) < 0.06 &&
      Math.abs(p.pos.x - c.pos.x) < p.half[0] + c.half[0] &&
      Math.abs(p.pos.z - c.pos.z) < p.half[2] + c.half[2];
  }

  // Ray from the eye that can pass through one portal. Returns { via } when
  // the cube is within reach.
  lookAtCube() {
    let origin = this.player.eye;
    let dir = this.player.forward();
    let remaining = PLAYER.reach;
    let via = null;
    const box = this.cube.body.syncBox();
    const grab = { min: box.min.map((v) => v - 0.1), max: box.max.map((v) => v + 0.1) };
    for (let hop = 0; hop < 2; hop++) {
      const cubeT = rayBox(origin, dir, grab);
      const wall = this.physics.raycast(origin, dir, remaining, this.door.boxes);
      const tWall = wall ? wall.t : Infinity;
      const portal = this.rayPortal(origin, dir, remaining);
      if (cubeT !== null && cubeT <= remaining && cubeT <= tWall + 1e-3 && (!portal || cubeT < portal.t)) return { via };
      if (!portal || portal.t > tWall + 0.02 || via) return null;
      origin = portal.point.applyMatrix4(portal.P.toPartner);
      dir = dir.clone().applyQuaternion(portal.P.rotToPartner);
      origin.addScaledVector(dir, 0.01);
      remaining -= portal.t;
      via = portal.P;
    }
    return null;
  }

  rayPortal(origin, dir, maxT) {
    let best = null;
    for (const P of this.portals.portals) {
      if (!P.linked) continue;
      const dn = dir.dot(P.normal);
      if (dn >= -1e-4) continue;
      const t = -P.distance(origin) / dn;
      if (t < 0 || t > maxT || (best && t > best.t)) continue;
      const point = origin.clone().addScaledVector(dir, t);
      const local = point.clone().sub(P.pos);
      const u = local.dot(P.right) / (PORTAL.width / 2);
      const v = local.dot(P.up) / (PORTAL.height / 2);
      if (u * u + v * v <= 1) best = { P, t, point };
    }
    return best;
  }

  // ---------------------------------------------------------------- update

  tick(time) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.elapsed += dt;
    if (!this.state.paused && !this.state.completed) {
      this.adaptResolution(dt);
      this.state.time += dt;
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= PHYSICS.fixedStep && steps < 12) {
        this.fixedUpdate(PHYSICS.fixedStep);
        this.accumulator -= PHYSICS.fixedStep;
        steps++;
      }
      if (steps === 12) this.accumulator = 0;
      // A tap on Jump shorter than a frame still counts once.
      if (steps > 0) this.touch.jumpLatch = false;
    }
    this.frameUpdate(dt);
    // Behind the title, pause and end screens the picture doesn't need to
    // change, so stop spending GPU (and battery) on it.
    if ((this.state.paused || this.state.completed) && !this.dirty) return;
    this.dirty = false;
    this.render();
  }

  // Lower the render resolution while frames take too long and raise it again
  // when there is headroom. Checked every two seconds of play.
  adaptResolution(dt) {
    const s = this.frames ?? (this.frames = { sum: 0, n: 0, prev: 0, lowered: false, floor: 0.6 });
    s.sum += dt;
    s.n++;
    if (s.sum < 2) return;
    const avg = s.sum / s.n;
    s.sum = s.n = 0;
    if (s.floorUntil && this.state.time > s.floorUntil) {
      s.floor = 0.6;
      s.floorUntil = 0;
    }
    const cur = this.pixelRatio ?? this.maxPixelRatio;
    let next = cur;
    if (avg > 1 / 45) {
      if (s.lowered && avg > s.prev * 0.92) {
        // Lowering didn't help, so the frame rate is probably capped by
        // something else (a battery saver, a 30 Hz screen). Go back up and
        // stay there for a while, then try again (the view may have changed).
        next = Math.min(this.maxPixelRatio, cur / 0.85);
        s.floor = next;
        s.floorUntil = this.state.time + 30;
        s.lowered = false;
      } else if (cur * 0.85 >= s.floor) {
        next = cur * 0.85;
        s.lowered = true;
      }
    } else {
      s.lowered = false;
      if (avg < 1 / 57) next = Math.min(this.maxPixelRatio, cur * 1.1);
    }
    s.prev = avg;
    if (Math.abs(next - cur) > 0.01) {
      this.pixelRatio = next;
      this.onResize();
    }
  }

  // Advance the simulation (also used by tests through window.__game).
  step(seconds, input) {
    const n = Math.round(seconds / PHYSICS.fixedStep);
    for (let i = 0; i < n; i++) this.fixedUpdate(PHYSICS.fixedStep, input);
  }

  fixedUpdate(h, forcedInput) {
    const input = forcedInput ?? this.input();
    const player = this.player;
    const cube = this.cube;

    if (this.transition) {
      this.updateTransition(h);
      if (!this.transition || this.state.completed) return;
    } else {
      this.funnel(player.body, h);
      player.update(h, input, this.physics, (P) => this.onPlayerTeleport(P));
      if (player.landed) this.sfx.land();
    }

    const cubeCross = (P) => this.onCubeTeleport(P);
    if (cube.held) {
      const target = this.holdTarget();
      cube.updateHeld(h, this.physics, target, cubeCross);
      if (cube.held) {
        // Let go only if the cube stays stuck out of reach for a moment, so a
        // quick turn doesn't drop it.
        const far = cube.body.pos.distanceTo(this.holdTarget()) > CUBE.dropDistance;
        cube.strain = far ? cube.strain + h : 0;
        if (cube.strain > 0.4) this.dropCube();
      }
    } else {
      this.funnel(cube.body, h);
      this.slideIntoPortal(cube, h);
      cube.updateFree(h, this.physics, cubeCross);
      if (Math.abs(cube.body.min(1) - this.button.pos.y) < 0.2) cube.settleOnto(h, this.button.pos);
    }

    const pressing = [player.body];
    if (!cube.held) pressing.push(cube.body);
    const evt = this.button.update(h, pressing);
    if (evt) {
      const down = evt === 'down';
      this.sfx.button(down);
      this.sfx.door(down);
      this.door.target = down ? 1 : 0;
      this.antline.set(down);
      if (down && !this.doorAnnounced && !cube.held && this.button.isOn(cube.body)) {
        this.doorAnnounced = true;
        this.say(this.level.doorOpen, 6);
      }
    }
    cube.setActivated(!cube.held && this.button.isOn(cube.body));
    this.door.update(h);

    if (player.body.pos.y < this.level.killY) {
      this.spawnPlayer();
      this.dropCube();
    }
    if (cube.body.pos.y < this.level.killY) {
      this.dropCube();
      cube.reset();
    }

    if (!this.transition && !this.state.completed && this.exitLift.holds(player.body)) this.startDeparture();
  }

  // A cube left lying across the edge of a floor portal slides into the
  // hole, but never back into the portal it just came out of.
  slideIntoPortal(cube, h) {
    const body = cube.body;
    if (!body.onGround) return;
    for (const P of this.portals.portals) {
      if (!P.linked || P.axis !== 1 || P.sign < 0 || P === cube.lastExit) continue;
      if (Math.abs(body.min(1) - P.plane) > 0.05) continue;
      if (![P.t1, P.t2].every((t) => body.max(t) > P.rmin[t] && body.min(t) < P.rmax[t])) continue;
      body.vel.x += (P.pos.x - body.pos.x) * 30 * h;
      body.vel.z += (P.pos.z - body.pos.z) * 30 * h;
    }
  }

  // ------------------------------------------------------------ elevators
  //
  // Stepping into the exit elevator closes its door and rides it up the
  // shaft while the screen fades out. The next chamber is built behind the
  // black card, then the player rides its arrival elevator down into the
  // room, the door opens and control comes back. Runs in the fixed step so
  // tests can drive it.

  startDeparture() {
    markCompleted(this.level.number);
    this.dropCube();
    this.transition = { phase: 'depart', t: 0 };
    this.touch.enabled = false;
    this.say('', 0);
    this.sfx.door(false);
  }

  updateTransition(h) {
    const tr = this.transition;
    tr.t += h;
    const body = this.player.body;
    const smooth = (x) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const ride = (lift, height) => {
      // the player stands in the middle of the car and moves with it
      const k = 1 - Math.exp(-h * 8);
      body.pos.x += (lift.base.x - body.pos.x) * k;
      body.pos.z += (lift.base.z - body.pos.z) * k;
      body.pos.y = lift.base.y + height + body.half[1] + 0.002;
      body.vel.set(0, 0, 0);
      body.portalMode = null;
    };

    if (tr.phase === 'depart') {
      const lift = this.exitLift;
      lift.setDoor(smooth(tr.t / 0.8));
      const p = THREE.MathUtils.clamp((tr.t - 0.9) / 3, 0, 1);
      const height = 4.5 * p * p;
      lift.setLift(height);
      ride(lift, height);
      if (tr.t > 1 && !tr.hum) {
        tr.hum = true;
        this.sfx.elevator(3.5, true);
      }
      if (tr.t > 1.9 && !tr.faded) {
        tr.faded = true;
        this.fade(true, LEVELS[this.levelIndex + 1]);
      }
      if (tr.t > 3.2) {
        if (this.levelIndex + 1 >= LEVELS.length) {
          this.transition = null;
          this.complete();
          return;
        }
        // Swap chambers while the screen is black.
        this.loadLevel(this.levelIndex + 1);
        this.transition = { phase: 'arrive', t: 0 };
        this.arrivalLift.setDoor(1);
        this.arrivalLift.setLift(4.5);
        ride(this.arrivalLift, 4.5);
      }
      return;
    }

    // arrive
    const lift = this.arrivalLift;
    if (tr.t > 1.4 && !tr.shown) {
      tr.shown = true;
      this.fade(false);
      this.sfx.elevator(2.8, false);
    }
    const p = THREE.MathUtils.clamp((tr.t - 1.4) / 2.8, 0, 1);
    const height = 4.5 * (1 - p) * (1 - p);
    lift.setLift(height);
    ride(lift, height);
    if (p >= 1 && tr.openAt === undefined) {
      tr.openAt = tr.t;
      this.sfx.door(true);
    }
    if (tr.openAt !== undefined) {
      lift.setDoor(1 - smooth((tr.t - tr.openAt) / 0.8));
      if (tr.t - tr.openAt > 0.8) {
        this.transition = null;
        const playing = this.state.started && !this.state.paused;
        this.touch.enabled = playing && document.body.classList.contains('touch');
        this.say(this.level.intro, 7);
      }
    }
  }

  // Black screen with the next chamber's card (or plain black) over the game.
  fade(on, next) {
    const el = this.ui.fade;
    if (on && next) {
      el.querySelector('.card-number').textContent = pad2(next.number);
      el.querySelector('.card-count').textContent = `${pad2(next.number)}/${pad2(LEVELS.length)}`;
      el.querySelector('.card-bar').innerHTML = LEVELS.map((_, i) => `<i class="${i < next.number ? 'on' : ''}"></i>`).join('');
      el.querySelector('.card-lines').innerHTML = next.card.map((l) => `<p>${l}</p>`).join('');
    }
    el.querySelector('.card').hidden = !next;
    el.classList.toggle('on', on);
  }

  holdTarget() {
    const eye = this.player.eye;
    const fwd = this.player.forward();
    const target = eye.addScaledVector(fwd, CUBE.holdDistance);
    target.y -= 0.1;
    // keep the cube out of the player's own body
    const dx = target.x - this.player.body.pos.x, dz = target.z - this.player.body.pos.z;
    const minD = PLAYER.half[0] + CUBE.size / 2 + 0.08;
    const d = Math.hypot(dx, dz);
    if (d < minD && target.y < this.player.body.max(1) + CUBE.size / 2) {
      const yaw = this.player.yaw;
      target.x = this.player.body.pos.x - Math.sin(yaw) * minD;
      target.z = this.player.body.pos.z - Math.cos(yaw) * minD;
    }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.player.yaw);
    if (this.cube.via) {
      target.applyMatrix4(this.cube.via.toPartner);
      q.premultiply(this.cube.via.rotToPartner);
    }
    this.cube.targetQuat.copy(q);
    return target;
  }

  onPlayerTeleport(P) {
    this.sfx.teleport();
    const cube = this.cube;
    if (!cube.held) return;
    if (cube.via === P) cube.via = null;
    else if (cube.via === null) cube.via = P.partner;
    else this.dropCube();
  }

  onCubeTeleport(P) {
    const cube = this.cube;
    teleportBody(cube.body, P);
    this.physics.depenetrate(cube.body, cube.body.box);
    cube.applyPortalRotation(P.rotToPartner);
    cube.lastExit = P.partner;
    if (!cube.held) return;
    if (cube.via === null) cube.via = P;
    else if (cube.via === P.partner) cube.via = null;
    else this.dropCube();
  }

  // Steer a falling body into a floor portal below it, so a jump or a step
  // off a ledge that is roughly on target goes in. Within a cone that widens
  // with height, the body's sideways speed is eased towards the speed that
  // lands it on the portal's centre. Low hops (such as popping out of a
  // floor portal) and anything flying fast (a fling) are left alone.
  funnel(body, h) {
    if (body.onGround || body.vel.y > -0.5 || Math.hypot(body.vel.x, body.vel.z) > 7) return;
    for (const P of this.portals.portals) {
      if (!P.linked || P.axis !== 1 || P.sign < 0) continue;
      const height = body.min(1) - P.plane;
      if (height < 0.6 || height > 12) continue;
      const dx = P.pos.x - body.pos.x, dz = P.pos.z - body.pos.z;
      if (Math.hypot(dx, dz) > Math.min(4, 1 + 0.35 * height)) continue;
      const fall = -body.vel.y, g = PHYSICS.gravity;
      const t = (-fall + Math.sqrt(fall * fall + 2 * g * height)) / g; // until the feet reach the portal
      const k = Math.min(1, 8 * h);
      body.vel.x += (dx / t - body.vel.x) * k;
      body.vel.z += (dz / t - body.vel.z) * k;
    }
  }

  complete() {
    this.state.completed = true;
    this.dirty = true;
    this.releaseWakeLock();
    this.dropCube();
    this.sfx.complete();
    const t = this.state.time;
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60).toString().padStart(2, '0');
    this.ui.stats.textContent = `${LEVELS.length} levels  ·  Time ${mm}:${ss}  ·  Portals fired ${this.state.portalsFired}`;
    this.ui.complete.classList.remove('hidden');
    document.exitPointerLock?.();
  }

  frameUpdate(dt) {
    const t = this.elapsed;
    this.player.updateView(dt);
    this.portals.update(dt, t);
    this.effects.update(dt);
    this.cube.updateVisual(dt);

    this.camera.position.copy(this.player.eye);
    this.player.quaternion(this.camera.quaternion);
    this.camera.updateMatrixWorld();
    this.viewModel.update(dt, t, this.player, this.cube.held);

    const body = this.player.body;
    const feet = new THREE.Vector3(body.pos.x, body.min(1), body.pos.z);
    const moving = Math.min(1, this.player.speed / 4) * (body.onGround ? 1 : 0);
    this.avatar.pose(feet, this.player.yaw, this.player.pitch, this.player.walkPhase, moving, this.viewModel.color);
    const P = body.portalMode;
    this.avatarClone.root.visible = !!(P && P.linked);
    if (this.avatarClone.root.visible) {
      this.avatarClone.pose(feet, this.player.yaw, this.player.pitch, this.player.walkPhase, moving, this.viewModel.color);
      this.avatar.root.updateMatrix();
      this.avatarClone.root.matrix.multiplyMatrices(P.toPartner, this.avatar.root.matrix);
    }
    this.cube.updateClone();

    this.hintTimer -= dt;
    if (this.hintTimer <= 0) {
      this.hintTimer = 0.1;
      this.updateHint();
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.ui.subtitle.classList.remove('show');
    }
    if (this.ui.debug) {
      this.ui.debug.textContent = `${(1 / Math.max(dt, 1e-3)).toFixed(0)} fps · portal passes ${this.portalRenderer.stats.renders}`;
    }
  }

  render() {
    this.scene.updateMatrixWorld();
    const clone = this.avatarClone.root;
    const cloneHead = new THREE.Vector3();
    // While rendering a portal view, hide the copy of the body that sits
    // exactly where that view's camera is.
    this.portalRenderer.render(this.camera, (camPos) => {
      if (!clone.visible) return;
      cloneHead.set(0, 1.58, 0).applyMatrix4(clone.matrixWorld);
      clone.children.forEach((c) => (c.visible = cloneHead.distanceTo(camPos) > 0.6));
    });
    clone.children.forEach((c) => (c.visible = true));
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
  }

  // ---------------------------------------------------------------- UI

  updateCrosshair() {
    const [blue, orange] = this.portals.portals;
    this.ui.chBlue.classList.toggle('placed', blue.placed);
    this.ui.chOrange.classList.toggle('placed', orange.placed);
  }

  updateHint() {
    const touch = document.body.classList.contains('touch');
    let text = '';
    let grabbable = false;
    if (this.state.started && !this.state.completed) {
      if (this.cube.held) {
        text = touch ? 'Grab — drop cube' : 'E — drop cube';
      } else if (this.lookAtCube() && !this.standingOnCube()) {
        grabbable = true;
        text = touch ? 'Grab — pick up cube' : 'E — pick up cube';
      } else if (this.state.time < 12 && this.state.portalsFired === 0) {
        text = touch ? 'Tap the blue and orange buttons to fire portals' : 'Left click — blue portal  ·  Right click — orange portal';
      }
    }
    this.touch.setGrabReady(grabbable || this.cube.held);
    if (this.ui.hint.textContent !== text) this.ui.hint.textContent = text;
    this.ui.hint.classList.toggle('show', !!text);
  }

  say(text, seconds) {
    this.ui.subtitle.textContent = text;
    this.ui.subtitle.classList.toggle('show', !!text);
    this.subtitleTimer = text ? seconds : 0;
  }

  // ---------------------------------------------------------------- saving

  // Snapshot kept across a live reload of the page.
  serialize() {
    const p = this.player, c = this.cube;
    return {
      level: this.levelIndex,
      player: { pos: p.body.pos.toArray(), vel: p.body.vel.toArray(), yaw: p.yaw, pitch: p.pitch, portalMode: this.portals.portals.indexOf(p.body.portalMode) },
      cube: { pos: c.body.pos.toArray(), portalMode: this.portals.portals.indexOf(c.body.portalMode) },
      portals: this.portals.portals.map((P) => (P.placed
        ? { pos: P.pos.toArray(), axis: P.axis, sign: P.sign, plane: P.plane, up: P.up.toArray(), right: P.right.toArray() }
        : null)),
      state: { started: this.state.started, completed: this.state.completed, time: this.state.time, portalsFired: this.state.portalsFired },
    };
  }

  restore(saved) {
    if (!saved?.player || saved.state?.completed) return;
    try {
      const p = this.player;
      p.body.pos.fromArray(saved.player.pos);
      p.body.vel.fromArray(saved.player.vel);
      p.yaw = saved.player.yaw;
      p.pitch = saved.player.pitch;
      this.cube.body.pos.fromArray(saved.cube.pos);
      saved.portals.forEach((d, i) => {
        if (!d) return;
        const P = this.portals.portals[i];
        P.place(new THREE.Vector3().fromArray(d.pos), d.axis, d.sign, d.plane, new THREE.Vector3().fromArray(d.up), new THREE.Vector3().fromArray(d.right));
        P.open = 1;
      });
      this.portals.refresh();
      // Keep anything that was part-way through a portal in its hole.
      p.body.portalMode = this.portals.portals[saved.player.portalMode] ?? null;
      this.cube.body.portalMode = this.portals.portals[saved.cube.portalMode] ?? null;
      this.physics.depenetrate(p.body);
      this.physics.depenetrate(this.cube.body, this.cube.body.box);
      this.dirty = true;
      Object.assign(this.state, { time: saved.state.time, portalsFired: saved.state.portalsFired });
      this.updateCrosshair();
      if (saved.state.started) {
        this.state.started = true;
        this.introShown = true;
        this.pause();
      }
    } catch (err) {
      console.warn('Could not restore the saved game', err);
      this.restart();
    }
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const chamberName = (def) => `Level ${pad2(def.number)}`;

// Which chambers this device has finished. Storage can be unavailable
// (private windows, embedded views), in which case nothing is remembered.
const COMPLETED_KEY = 'portal-clone:completed';
function completedChambers() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COMPLETED_KEY)) ?? []);
  } catch {
    return new Set();
  }
}
function markCompleted(number) {
  try {
    const done = completedChambers();
    done.add(number);
    localStorage.setItem(COMPLETED_KEY, JSON.stringify([...done]));
  } catch {
    // not remembered
  }
}

const SKIN_KEY = 'portal-clone:skin';
const SKINS = ['subject', 'arbiter'];
function savedSkin() {
  try {
    const skin = localStorage.getItem(SKIN_KEY);
    if (SKINS.includes(skin)) return skin;
  } catch {
    // storage unavailable
  }
  return 'subject';
}

// Free the GPU resources of a level that is being replaced, keeping the
// shared surface materials.
function disposeTree(root, keep) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [].concat(o.material)) {
      if (keep.has(m)) continue;
      m.map?.dispose();
      m.emissiveMap?.dispose();
      m.dispose();
    }
  });
}

function rayBox(origin, dir, box) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < box.min[a] || o[a] > box.max[a]) return null;
      continue;
    }
    let t0 = (box.min[a] - o[a]) / d[a];
    let t1 = (box.max[a] - o[a]) / d[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return Math.max(tmin, 0);
}

let game = null;

function start(saved) {
  try {
    game = new Game(saved ?? {});
  } catch (err) {
    console.error(err);
    const el = document.getElementById('loading');
    el.textContent = 'This game needs WebGL 2. ' + err.message;
    el.classList.remove('hidden');
  }
}

// When hosted as a Claude artifact, keep the game's state across live updates.
const hot = window.claude?.hot;
hot?.snapshot?.(() => game?.serialize());
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
