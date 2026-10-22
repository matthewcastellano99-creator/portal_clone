// On-screen controls for touch screens. The left half of the screen is a
// floating movement stick, dragging anywhere else turns the view, and the
// buttons fire portals, jump, grab and pause. Dragging after pressing a fire
// button keeps turning the view, so aiming and firing can share a thumb.

const STICK_RADIUS = 56; // px of thumb travel for full speed
const LOOK_SCALE = 2.4; // touch pixels are coarser than mouse counts

export class TouchControls {
  constructor(root, { onLook, onFire, onUse, onPause }) {
    this.root = root;
    this.move = { x: 0, y: 0 }; // -1..1, y > 0 is forward
    this.jump = false;
    this.jumpLatch = false; // set on press, cleared once the game has seen it
    this.handlers = { onLook, onFire, onUse, onPause };
    this.pointers = new Map(); // pointerId -> { kind, x, y, ox, oy }

    this.stick = root.querySelector('.stick');
    this.knob = root.querySelector('.stick-knob');
    this.grab = root.querySelector('[data-act="use"]');

    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.moveEvent(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      root.addEventListener(type, (e) => this.up(e));
    }
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  set enabled(on) {
    this.root.hidden = !on;
    if (!on) this.reset();
  }

  get enabled() {
    return !this.root.hidden;
  }

  reset() {
    this.pointers.clear();
    this.move.x = this.move.y = 0;
    this.jump = this.jumpLatch = false;
    this.showStick(null);
    for (const b of this.root.querySelectorAll('.pressed')) b.classList.remove('pressed');
  }

  // Highlight the grab button while the cube is within reach.
  setGrabReady(on) {
    this.grab.classList.toggle('ready', on);
  }

  down(e) {
    if (this.root.hidden || e.pointerType === 'mouse') return;
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // the pointer may already be gone
    }
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      btn.classList.add('pressed');
      this.pointers.set(e.pointerId, { kind: 'button', btn, act, x: e.clientX, y: e.clientY });
      if (act === 'fire0') this.handlers.onFire(0);
      else if (act === 'fire1') this.handlers.onFire(1);
      else if (act === 'use') this.handlers.onUse();
      else if (act === 'jump') this.jump = this.jumpLatch = true;
      else if (act === 'pause') this.handlers.onPause();
      return;
    }
    const stickTaken = [...this.pointers.values()].some((p) => p.kind === 'stick');
    if (e.clientX < window.innerWidth * 0.45 && !stickTaken) {
      this.pointers.set(e.pointerId, { kind: 'stick', ox: e.clientX, oy: e.clientY });
      this.showStick(e.clientX, e.clientY);
      this.updateStick(e.clientX, e.clientY);
    } else {
      this.pointers.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
    }
  }

  moveEvent(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') {
      this.updateStick(e.clientX, e.clientY);
      return;
    }
    // look pointers, and fire buttons that are dragged to keep aiming
    if (p.kind === 'look' || p.act === 'fire0' || p.act === 'fire1') {
      this.handlers.onLook((e.clientX - p.x) * LOOK_SCALE, (e.clientY - p.y) * LOOK_SCALE);
    }
    p.x = e.clientX;
    p.y = e.clientY;
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind === 'stick') {
      this.move.x = this.move.y = 0;
      this.showStick(null);
    } else if (p.kind === 'button') {
      p.btn.classList.remove('pressed');
      if (p.act === 'jump') this.jump = false;
    }
  }

  updateStick(x, y) {
    const p = [...this.pointers.values()].find((q) => q.kind === 'stick');
    let dx = x - p.ox, dy = y - p.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) {
      dx *= STICK_RADIUS / d;
      dy *= STICK_RADIUS / d;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // small dead zone, then full range
    const m = Math.min(1, d / STICK_RADIUS);
    const k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / Math.max(m, 1e-6);
    this.move.x = (dx / STICK_RADIUS) * k;
    this.move.y = (-dy / STICK_RADIUS) * k;
  }

  showStick(x, y) {
    if (x === null) {
      this.stick.classList.remove('active');
      this.stick.style.left = '';
      this.stick.style.top = '';
      this.knob.style.transform = '';
      return;
    }
    this.stick.classList.add('active');
    this.stick.style.left = `${x}px`;
    this.stick.style.top = `${y}px`;
  }
}
