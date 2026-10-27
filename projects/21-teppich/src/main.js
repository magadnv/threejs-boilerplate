// ============================================================
// 21 · Teppich – Instancing: Zehntausende Objekte in Wellen
// ============================================================
// Ein Raster aus 40.000 Säulen, Grashalmen oder Kugeln, das wie ein
// lebendiger Teppich reagiert – in EINEM Draw Call.
//
// Aufbau:
//   setup.js           Renderer, Szene, Kamera, Licht, Bloom
//   instance-field.js  das wiederverwendbare Modul (Instancing + Material)
//   waves.js           Wellen, Maus, Schockwellen als TSL
//   variants.js        Pixel-Stadt, Wiese, Kugeln
//   interaction.js     Raycast, Klick, Autopilot
//   looks.js           Nacht / Modell
//   gui.js             lil-gui
//   controls.js        Tasten, Formate, Screenshot, Anzeige

import { createSetup } from "./setup.js";
import { createInstanceField } from "./instance-field.js";
import { VARIANTS, VARIANT_KEYS } from "./variants.js";
import { createInteraction } from "./interaction.js";
import { LOOKS, applyLook } from "./looks.js";
import { createGui } from "./gui.js";
import { createControls } from "./controls.js";

const EXTENT = 40;
const canvas = document.querySelector("#scene");
const setup = await createSetup(canvas);
const { renderer, scene, camera, controls, pipeline } = setup;

// --- Das Feld ---
const field = createInstanceField(renderer, scene, { side: 200, extent: EXTENT, variant: "stadt" });
field.start();

// Ein kleiner Startimpuls, damit sofort etwas passiert
field.shock(0, 0, 1.2);

// --- Zustand für GUI und Looks ---
const params = {
  side: 200,
  variant: "stadt",
  speed: 1,
  mouseMode: 0,
  shadows: true,
  colorA: LOOKS[0].colorA,
  colorB: LOOKS[0].colorB,
  bloom: LOOKS[0].bloom,
  progressMode: "rise",
};
let lookIndex = 0;

function refreshLook() {
  applyLook(LOOKS[lookIndex], { setup, field, params });
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

const { autopilot } = createInteraction({ canvas, camera, field, extent: EXTENT });

// Nach Neubau (Variante/Anzahl) bekommt das neue Material wieder den Look
const gui = createGui({ setup, field, params, onRebuild: refreshLook });

const ui = createControls({
  setup,
  canvas,
  field,
  gui,
  autopilot,
  actions: {
    nextVariant() {
      const next = VARIANT_KEYS[(VARIANT_KEYS.indexOf(field.variant) + 1) % VARIANT_KEYS.length];
      field.setVariant(next);
      params.variant = next;
      refreshLook();
      return VARIANTS[next].label;
    },
    nextLook() {
      lookIndex = (lookIndex + 1) % LOOKS.length;
      refreshLook();
      return LOOKS[lookIndex].name;
    },
  },
});

refreshLook();

// --- Loop ---
// setAnimationLoop statt requestAnimationFrame: der Renderer steuert den
// Takt selbst (auch in WebXR) und setzt renderer.info pro Frame zurück.
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const delta = Math.min((now - last) / 1000, 1 / 20); // Tab-Wechsel: kein Riesensprung
  last = now;

  autopilot.update(delta);
  field.update(delta);
  controls.update(delta);

  pipeline.render();
  ui.afterRender(delta);
});
