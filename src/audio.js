// Small synthesised sound set (WebAudio), so there are no audio assets.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.holdGain = null;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  env(gainNode, t, attack, dur, peak) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  tone({ type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.1, attack = 0.005, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, attack, dur, gain);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, gain = 0.1, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = 0.005, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, attack, dur, gain);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  startAmbience() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    for (const f of [55, 55.4, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    lp.connect(g).connect(this.master);
  }

  shoot(id) {
    const base = id === 0 ? 820 : 640;
    this.tone({ type: 'sawtooth', f0: base * 1.8, f1: base * 0.35, dur: 0.16, gain: 0.07 });
    this.tone({ type: 'sine', f0: base * 2.2, f1: base * 0.8, dur: 0.12, gain: 0.12 });
    this.noise({ dur: 0.14, gain: 0.08, f0: 4000, f1: 900, q: 2 });
  }

  portalOpen(id) {
    this.noise({ dur: 0.5, gain: 0.1, f0: 300, f1: 2200, q: 1.4, attack: 0.04 });
    this.tone({ type: 'sine', f0: id === 0 ? 220 : 180, f1: id === 0 ? 330 : 270, dur: 0.45, gain: 0.06, attack: 0.03 });
  }

  fizzle() {
    this.noise({ dur: 0.25, gain: 0.1, type: 'highpass', f0: 2500, f1: 5000, q: 0.7 });
    this.tone({ type: 'square', f0: 140, f1: 60, dur: 0.18, gain: 0.04 });
  }

  teleport() {
    this.noise({ dur: 0.35, gain: 0.06, f0: 1800, f1: 200, q: 1.2, attack: 0.02 });
  }

  pickup() {
    this.tone({ type: 'sine', f0: 260, f1: 520, dur: 0.15, gain: 0.08 });
    this.setHolding(true);
  }

  drop() {
    this.tone({ type: 'sine', f0: 480, f1: 220, dur: 0.15, gain: 0.07 });
    this.setHolding(false);
  }

  denied() {
    this.tone({ type: 'square', f0: 180, f1: 170, dur: 0.12, gain: 0.04 });
    this.tone({ type: 'square', f0: 140, f1: 135, dur: 0.14, gain: 0.04, delay: 0.12 });
  }

  setHolding(on) {
    if (!this.ctx) return;
    if (on && !this.holdGain) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 92;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 6;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 8;
      lfo.connect(lfoGain).connect(o.frequency);
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.05, this.ctx.currentTime + 0.1);
      o.connect(g).connect(this.master);
      o.start();
      lfo.start();
      this.holdGain = { g, o, lfo };
    } else if (!on && this.holdGain) {
      const { g, o, lfo } = this.holdGain;
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.1);
      o.stop(this.ctx.currentTime + 0.15);
      lfo.stop(this.ctx.currentTime + 0.15);
      this.holdGain = null;
    }
  }

  button(down) {
    if (down) {
      this.tone({ type: 'sine', f0: 140, f1: 45, dur: 0.25, gain: 0.25 });
      this.noise({ dur: 0.05, gain: 0.1, f0: 2500, q: 3 });
    } else {
      this.tone({ type: 'sine', f0: 70, f1: 150, dur: 0.18, gain: 0.15 });
    }
  }

  door(open) {
    this.noise({ dur: 0.7, gain: 0.08, type: 'lowpass', f0: open ? 300 : 600, f1: open ? 900 : 200, q: 2, attack: 0.05 });
    this.tone({ type: 'triangle', f0: open ? 70 : 90, f1: open ? 90 : 60, dur: 0.6, gain: 0.08, attack: 0.05 });
  }

  land() {
    this.tone({ type: 'sine', f0: 90, f1: 40, dur: 0.12, gain: 0.12 });
  }

  complete() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.08, delay: i * 0.12 });
    });
  }
}
