// ============================================================
// 21 · Flow Field – Curl Noise auf der GPU
// ============================================================
// Hunderttausende Partikel folgen einem divergenzfreien Strömungsfeld.
// Die Physik läuft komplett per TSL Compute auf der Grafikkarte, die
// Spuren entstehen durch ein Feedback-Bild, das nie ganz gelöscht wird.
//
//   setup.js           WebGPU prüfen, Renderer, Kamera, Formate
//   flowfield/         das wiederverwendbare Modul (Simulation + Rendering)
//     curl-noise.js    warum das Feld nach Rauch aussieht
//     emitters.js      Kugel, Ring, Linie, Text
//   trails.js          Ping-Pong-Feedback, Komposition, Bloom
//   gui.js             lil-gui + stats.js
//   controls.js        Maus-Wirbel, Tasten
//   main.js            hier wird alles verbunden

import * as THREE from "three/webgpu";
import gsap from "gsap";
import { createRenderer, createScene, createCamera, createResizer } from "./setup.js";
import { createFlowField, PALETTES } from "./flowfield/index.js";
import { createTrails } from "./trails.js";
import { createGui } from "./gui.js";
import { createPointer, bindKeys } from "./controls.js";

const canvas = document.querySelector("#scene");

// Schrift für den Text-Emitter laden, bevor wir sie auf ein Canvas schreiben
await document.fonts.load("italic 220px 'Instrument Serif'").catch(() => {});

// ------------------------------------------------------------
// Setup
// ------------------------------------------------------------
const { renderer, isWebGPU } = await createRenderer(canvas);
const scene = createScene();
const { camera, controls } = createCamera(canvas);
const resizer = createResizer(renderer, camera, canvas);

if (!isWebGPU) {
  const notice = document.querySelector("#notice");
  notice.textContent =
    "Kein WebGPU – läuft über WebGL2 mit 60.000 statt 400.000 Partikeln. Am schönsten in Chrome, Edge oder Safari 26.";
  notice.hidden = false;
}

// Speicher fürs Maximum anlegen, die aktive Anzahl ist frei wählbar
const countOptions = isWebGPU
  ? { "100.000": 100_000, "250.000": 250_000, "400.000": 400_000, "700.000": 700_000, "1 Mio.": 1_000_000 }
  : { "20.000": 20_000, "60.000": 60_000, "120.000": 120_000 };
const maxCount = Math.max(...Object.values(countOptions));

const state = {
  count: isWebGPU ? 400_000 : 60_000,
  palette: 0,
  text: "flow",
  paper: false,
  autopilot: false,
};

// ------------------------------------------------------------
// Flow Field + Trails
// ------------------------------------------------------------
const flow = createFlowField(renderer, scene, {
  maxCount,
  count: state.count,
  text: state.text,
  progress: 0.85,
});
flow.start();

const trails = createTrails(renderer, scene, camera, { paper: flow.uniforms.paper });

// ------------------------------------------------------------
// Aktionen (GUI und Tasten teilen sie sich)
// ------------------------------------------------------------
const badge = document.querySelector("#badge");
let badgeTimer;
function showBadge(text) {
  badge.textContent = text;
  badge.classList.add("show");
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => badge.classList.remove("show"), 1400);
}

let screenshotRequested = false;

const actions = {
  reset() {
    flow.reset();
    trails.clear();
    showBadge("Reset");
  },

  // Paletten weich überblenden statt springen – sieht im Clip besser aus
  palette(index = (state.palette + 1) % PALETTES.length) {
    state.palette = index;
    const { name, colors } = PALETTES[index];
    ["colorA", "colorB", "colorC"].forEach((key, i) => {
      const to = new THREE.Color(colors[i]);
      gsap.to(flow.uniforms[key].value, { r: to.r, g: to.g, b: to.b, duration: 1.2, ease: "power2.inOut" });
    });
    refresh(); // Palette-Auswahl im Panel nachziehen
    showBadge(name);
  },

  // Nacht ↔ Papier: ein uniform von 0 nach 1, alles andere rechnet der Shader
  background() {
    state.paper = !state.paper;
    document.body.classList.toggle("paper", state.paper);
    gsap.to(flow.uniforms.paper, { value: state.paper ? 1 : 0, duration: 1.4, ease: "power2.inOut" });
    showBadge(state.paper ? "Tinte auf Papier" : "Licht auf Schwarz");
  },

  // Autopilot: Kamera dreht langsam, das Feld atmet – zum Aufnehmen ohne Hände
  autopilot() {
    state.autopilot = !state.autopilot;
    controls.autoRotate = state.autopilot;
    gsap.to(flow.uniforms.breath, { value: state.autopilot ? 1 : 0, duration: 2 });
    showBadge(state.autopilot ? "Autopilot an" : "Autopilot aus");
  },
};

const { stats, refresh } = createGui({ flow, trails, state, countOptions, actions });

const updatePointer = createPointer(canvas, camera, flow);

bindKeys({
  h: () => document.body.classList.toggle("clean"),
  s: () => (screenshotRequested = true), // erst nach dem nächsten Render lesen
  r: actions.reset,
  c: () => actions.palette(),
  b: actions.background,
  f: () => {
    showBadge(resizer.next());
    trails.clear();
  },
  a: actions.autopilot,
});

function saveScreenshot() {
  canvas.toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `flow-field-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
  showBadge("PNG gespeichert");
}

// ------------------------------------------------------------
// Loop
// ------------------------------------------------------------
// setAnimationLoop statt requestAnimationFrame: der Renderer gibt den Takt
// vor und wartet von selbst, bis WebGPU bereit ist.
const timer = new THREE.Timer();

renderer.setAnimationLoop((timestamp) => {
  stats.begin();
  timer.update(timestamp);
  // Nach einem Tab-Wechsel nicht mit riesigem Zeitschritt weiterrechnen
  const delta = Math.min(timer.getDelta(), 1 / 30);

  controls.update(delta);
  updatePointer(delta);

  flow.update(delta); // 1) Physik auf der GPU
  trails.render(delta); // 2) Partikel → Feedback → Bloom → Bildschirm

  if (screenshotRequested) {
    screenshotRequested = false;
    saveScreenshot();
  }
  stats.end();
});

// Nur beim Entwickeln: in der Browser-Konsole live mit flow.uniforms spielen
if (import.meta.env.DEV) Object.assign(window, { flow, trails, renderer });
