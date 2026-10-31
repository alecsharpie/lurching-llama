// Tiny synthesised sound effects (no assets).
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.45;
    this.master.connect(this.ctx.destination);
  }

  env(node, t, a, d, vol) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g); g.connect(this.master);
    return g;
  }

  tone(type, f0, f1, dur, vol = 0.25, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env(o, t, 0.01, dur, vol);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, vol, freq = 800, q = 1, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f);
    this.env(f, t, 0.005, dur, vol);
    src.start(t);
  }

  jump() { this.tone('sine', 260, 720, 0.18, 0.22); }
  land(v) { this.noise(0.12, Math.min(0.35, 0.05 + v * 0.025), 300, 0.8); }
  step() { this.noise(0.05, 0.035, 1400 + Math.random() * 600, 2); }
  bonk() { this.tone('triangle', 240, 70, 0.25, 0.3); this.noise(0.08, 0.2, 2000, 1); }
  boing() { this.tone('sine', 180, 520, 0.12, 0.15); this.tone('sine', 520, 260, 0.2, 0.12, 0.12); }

  // A wobbly "mehhh" bleat: sawtooth with vibrato through a vowel-ish formant.
  bleat(pitch = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, dur = 0.7;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420 * pitch, t);
    o.frequency.linearRampToValueAtTime(360 * pitch, t + dur);
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 9; lg.gain.value = 28 * pitch;
    lfo.connect(lg); lg.connect(o.frequency);
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 900; f1.Q.value = 4;
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2300; f2.Q.value = 6;
    o.connect(f1); o.connect(f2);
    const mix = this.ctx.createGain(); mix.gain.value = 1;
    f1.connect(mix); f2.connect(mix);
    this.env(mix, t, 0.04, dur, 0.5);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }

  spit() { this.noise(0.09, 0.25, 2600, 1.5); this.tone('sine', 900, 300, 0.08, 0.08); }
  uhoh() { this.tone('triangle', 520, 500, 0.12, 0.12); this.tone('triangle', 400, 340, 0.2, 0.12, 0.13); }

  // --- bouncy procedural background music --------------------------------
  // A little marimba + bass + shaker loop over I-vi-IV-V, scheduled ahead.
  startMusic() {
    if (!this.ctx || this.music) return;
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
    const bpm = 128, step = 60 / bpm / 2; // eighth notes
    // A section: I-vi-IV-V; B section: IV-V-iii-vi for contrast. 16 bars: A A B A.
    const chordsA = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    const chordsB = [[53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64]];
    const melodyA = [
      [72, -1, 74, 76, -1, 79, 76, -1], [72, -1, 69, -1, 72, 74, -1, -1],
      [77, -1, 76, 74, -1, 72, 69, -1], [71, 72, 74, -1, 79, -1, 77, 74],
    ];
    const melodyB = [
      [77, -1, -1, 76, 77, -1, 79, -1], [79, -1, 77, 76, 74, -1, -1, -1],
      [76, -1, 74, -1, 71, -1, 72, 74], [76, -1, -1, -1, 72, -1, -1, -1],
    ];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let n = 0, next = ctx.currentTime + 0.1;
    const pluck = (f, t, dur, vol, type = 'triangle') => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + dur + 0.02);
    };
    const tick = () => {
      // after a throttled background tab, skip missed notes instead of firing them all at once
      if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
      while (next < ctx.currentTime + 0.25) {
        const bar = Math.floor(n / 8) % 4, beat = n % 8;
        const section = Math.floor(n / 32) % 4; // A A B A
        const B = section === 2;
        const ch = (B ? chordsB : chordsA)[bar];
        const melody = B ? melodyB : melodyA;
        if (beat % 2 === 0) pluck(hz(ch[0] - 24), next, step * 1.8, 0.22, 'sine');            // bass
        if (beat === 2 || beat === 6) ch.forEach((m) => pluck(hz(m), next, step * 0.9, 0.05)); // offbeat chord stab
        const mel = melody[bar][beat];
        if (mel > 0 && section !== 0) pluck(hz(mel), next, step * 1.4, 0.07);
        if (beat === 0 || beat === 4) this.kick(next);
        if (!this.muted) this.shaker(next, beat % 2 ? 0.025 : 0.04);
        next += step; n++;
      }
    };
    this.music = setInterval(tick, 60);
    tick();
  }

  kick(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + 0.2);
  }

  shaker(t, vol) {
    if (!this.noiseBuf) {
      const len = Math.floor(this.ctx.sampleRate * 0.05);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(t);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
  }

  beep(hi) { this.tone('square', hi ? 880 : 440, hi ? 880 : 440, hi ? 0.45 : 0.18, 0.12); }

  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.2, i * 0.12));
    this.tone('triangle', 1047, 1047, 0.6, 0.2, 0.5);
  }
}
