// ============================================================
// GUI – lil-gui + stats.js
// ============================================================
// Die Regler schreiben direkt in die uniforms (.value) – die GPU sieht
// die neue Zahl im nächsten Frame, ohne dass ein Shader neu gebaut wird.

import GUI from "lil-gui";
import Stats from "stats.js";
import { EMITTERS, PALETTES } from "./flowfield/index.js";

export function createGui({ flow, trails, state, countOptions, actions }) {
  const u = flow.uniforms;
  const gui = new GUI({ title: "Flow Field · Curl Noise" });

  const sim = gui.addFolder("Simulation");
  sim
    .add(state, "count", countOptions)
    .name("Partikel")
    .onChange((n) => flow.setCount(n));
  sim.add(u.progress, "value", 0, 1, 0.001).name("progress (ruhig → wild)");
  sim
    .add(u.emitter, "value", EMITTERS)
    .name("Emitter-Form")
    .onChange(() => flow.reset());
  sim
    .add(state, "text")
    .name("Text")
    .onFinishChange((t) => {
      flow.setText(t || " ");
      flow.reset();
    });
  sim.add(u.lifetime, "value", 0.5, 12, 0.1).name("Lebensdauer (s)");
  sim.add(actions, "reset").name("Reset (R)");

  const field = gui.addFolder("Feld");
  field.add(u.frequency, "value", 0.05, 1.5, 0.01).name("Noise-Frequenz");
  field.add(u.strength, "value", 0, 2, 0.01).name("Feldstärke");
  field.add(u.fieldSpeed, "value", 0, 1, 0.005).name("Feld-Geschwindigkeit");
  field.add(u.inertia, "value", 0.01, 2, 0.01).name("Trägheit (s)");
  field.add(u.mouseOn, "value", { an: 1, aus: 0 }).name("Maus-Wirbel");
  field.add(u.mouseStrength, "value", 0, 12, 0.1).name("Wirbel-Stärke");

  const look = gui.addFolder("Look");
  look
    .add(trails.settings, "enabled")
    .name("Feedback-Trails")
    .onChange(() => trails.clear());
  look.add(trails.settings, "length", 0.05, 3, 0.01).name("Trail-Länge (s)");
  look.add(u.size, "value", 0.002, 0.05, 0.001).name("Partikelgröße");
  look.add(u.brightness, "value", 0.01, 1, 0.005).name("Helligkeit");
  look.add(u.colorBy, "value", { Tempo: 0, Lebensdauer: 1 }).name("Farbe nach");
  look
    .add(state, "palette", Object.fromEntries(PALETTES.map((p, i) => [p.name, i])))
    .name("Palette (C)")
    .onChange((i) => actions.palette(i));
  look.add(trails.uniforms.bloom, "value", 0, 1.5, 0.01).name("Bloom-Stärke");

  // FPS-Anzeige: grün und ruhig = die GPU schafft es locker
  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);

  return {
    gui,
    stats,
    refresh: () => gui.controllersRecursive().forEach((c) => c.updateDisplay()),
  };
}
