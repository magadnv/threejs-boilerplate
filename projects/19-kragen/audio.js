// Prozedurales Stoff-Knarzen mit Web Audio: kurze Körner aus gefiltertem Rauschen,
// deren Dichte und Lautstärke der Zugkraft folgen. Bewusst kaum hörbar.
export class GiAudio {
  constructor() {
    this.ctx = null;
    this.next = 0;
    this.volume = 0.5;
  }

  // Muss in einer Nutzergeste aufgerufen werden (pointerdown)
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // Rosa-ähnliches Rauschen: weicher als weißes
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6;
    }

    // Dauerhaftes, leises Reiben, das mit der Bewegung anschwillt
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.rubFilter = ctx.createBiquadFilter();
    this.rubFilter.type = "bandpass";
    this.rubFilter.frequency.value = 1400;
    this.rubFilter.Q.value = 0.8;
    this.rubGain = ctx.createGain();
    this.rubGain.gain.value = 0;
    src.connect(this.rubFilter).connect(this.rubGain).connect(this.master);
    src.start();
  }

  grain({ freq, q = 7, gain, decay, at = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, decay + 0.05);
  }

  // Zupacken: kurzes Rascheln
  grip(force = 1) {
    if (!this.ctx) return;
    this.grain({ freq: 2600, q: 0.9, gain: 0.05 * force, decay: 0.14 });
    this.grain({ freq: 700, q: 1.5, gain: 0.04 * force, decay: 0.2, at: 0.01 });
  }

  // Kuzushi: harter Ruck mit tiefem Schlag
  yank() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.grain({ freq: 1800, q: 0.7, gain: 0.12, decay: 0.25 });
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  // tension: Zugkraft 0..~1.5, rate: Änderung pro Sekunde
  update(dt, tension, rate) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const motion = Math.min(1, Math.abs(rate) * 0.8);
    this.rubGain.gain.setTargetAtTime(0.06 * motion * Math.min(1, tension + 0.2), now, 0.05);
    this.rubFilter.frequency.setTargetAtTime(900 + tension * 900, now, 0.1);

    // Knarzen: Körnerdichte wächst mit Zugkraft und Bewegung
    const density = tension * (4 + motion * 40);
    this.next -= dt;
    while (this.next <= 0 && density > 0.5) {
      this.next += (0.4 + Math.random()) / density;
      this.grain({
        freq: 500 + Math.random() * 1700 + tension * 300,
        q: 5 + Math.random() * 8,
        gain: (0.012 + Math.random() * 0.03) * Math.min(1.4, tension),
        decay: 0.02 + Math.random() * 0.05,
        at: Math.random() * 0.02,
      });
    }
    if (density <= 0.5) this.next = 0;
  }
}
