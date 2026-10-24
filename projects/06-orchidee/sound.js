// Ton aus dem Browser, ohne Datei: warme Akkordflächen mit Hall,
// dazwischen leise Spieluhr-Töne, beim Herz ein Glockenspiel nach oben.

const CHORDS = [
  [50, 57, 62, 66, 69, 76], // D-Dur 9
  [47, 54, 61, 62, 66, 73], // h-Moll 9
  [43, 50, 57, 59, 62, 69], // G-Dur add9
  [45, 52, 57, 61, 64, 71], // A-Dur add9
];
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]; // D-Pentatonik
const CHORD_SECONDS = 10;
const VOLUME = 0.35;

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export function createSound() {
  let ctx, master, bus, reverb;
  let on = false;
  let chordIndex = 0;
  let padTimer, melodyTimer;

  function impulse(seconds) {
    const length = ctx.sampleRate * seconds;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    return buffer;
  }

  function setup() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(4.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    reverb.connect(wet).connect(master);

    // Alles geht trocken und in den Hall
    bus = ctx.createGain();
    bus.connect(master);
    bus.connect(reverb);
  }

  function pad() {
    const now = ctx.currentTime;
    const end = now + CHORD_SECONDS + 4;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.linearRampToValueAtTime(1300, now + CHORD_SECONDS / 2);
    filter.frequency.linearRampToValueAtTime(700, end);
    filter.connect(bus);

    for (const midi of CHORDS[chordIndex % CHORDS.length]) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.045, now + 3.5);
      env.gain.setValueAtTime(0.045, now + CHORD_SECONDS);
      env.gain.linearRampToValueAtTime(0, end);
      env.connect(filter);
      for (const [type, cents] of [["sine", -5], ["triangle", 5]]) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = hz(midi);
        osc.detune.value = cents;
        osc.connect(env);
        osc.start(now);
        osc.stop(end);
      }
    }
    chordIndex++;
    padTimer = setTimeout(pad, CHORD_SECONDS * 1000);
  }

  function bell(midi, when = ctx.currentTime, volume = 0.06) {
    const f = hz(midi);
    for (const [ratio, gain, decay] of [[1, 1, 2.6], [2.01, 0.35, 1.4], [3.02, 0.12, 0.8]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f * ratio;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(volume * gain, when + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(env).connect(bus);
      osc.start(when);
      osc.stop(when + decay + 0.1);
    }
  }

  function melody() {
    const note = SCALE[Math.floor(Math.random() * SCALE.length)];
    bell(note);
    if (Math.random() < 0.3) bell(note + (Math.random() < 0.5 ? 5 : 7), ctx.currentTime + 0.22, 0.04);
    melodyTimer = setTimeout(melody, 1600 + Math.random() * 2600);
  }

  return {
    get on() {
      return on;
    },

    start() {
      if (on) return;
      if (!ctx) setup();
      ctx.resume();
      on = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 3);
      pad();
      melodyTimer = setTimeout(melody, 2500);
    },

    stop() {
      if (!on) return;
      on = false;
      clearTimeout(padTimer);
      clearTimeout(melodyTimer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => !on && ctx.suspend(), 1700);
    },

    // Glockenspiel nach oben, wenn sich das Herz bildet
    chime() {
      if (!on) return;
      const t = ctx.currentTime;
      [62, 66, 69, 74, 78, 81, 86].forEach((midi, i) => bell(midi, t + i * 0.16, 0.05));
    },
  };
}
