// ============================================================
// GUI – lil-gui, alles live änderbar
// ============================================================
// Fast jeder Regler ändert nur ein Uniform → wirkt im nächsten Frame,
// ohne Shader-Neubau. Ausnahme: Instanzen und Variante bauen das Mesh neu.

import GUI from "lil-gui";
import { VARIANTS } from "./variants.js";

export const SIDES = { "2.500 (50²)": 50, "10.000 (100²)": 100, "40.000 (200²)": 200, "90.000 (300²)": 300, "160.000 (400²)": 400 };

export function createGui({ setup, field, params, onRebuild }) {
  const u = field.uniforms;
  const gui = new GUI({ title: "Teppich · Instancing" });

  const raster = gui.addFolder("Raster");
  raster.add(params, "side", SIDES).name("Instanzen").onChange((side) => {
    field.setSide(side);
    onRebuild();
  });
  raster
    .add(params, "variant", Object.fromEntries(Object.entries(VARIANTS).map(([key, v]) => [v.label, key])))
    .name("Variante (M)")
    .onChange((name) => {
      field.setVariant(name);
      onRebuild();
    });

  const waves = gui.addFolder("Wellen");
  waves.add(u.waveHeight, "value", 0, 10, 0.1).name("Wellenhöhe");
  waves.add(u.waveFrequency, "value", 0.05, 1.2, 0.01).name("Wellenfrequenz");
  waves.add(params, "speed", 0, 3, 0.01).name("Geschwindigkeit").onChange((v) => (field.speed = v));

  const mouse = gui.addFolder("Maus");
  mouse.add(u.mouseRadius, "value", 1, 15, 0.1).name("Maus-Radius");
  mouse.add(u.mouseStrength, "value", 0, 2, 0.01).name("Maus-Stärke");
  mouse
    .add(params, "mouseMode", { drücken: 0, heben: 1 })
    .name("Modus")
    .onChange((v) => (u.mouseRaise.value = v));
  mouse.add(u.shockSpeed, "value", 4, 30, 0.5).name("Schockwellen-Tempo");

  const look = gui.addFolder("Licht & Farbe");
  look.add(params, "shadows").name("Schatten").onChange((on) => {
    setup.sun.castShadow = on;
    field.setShadows(on);
  });
  look.add(u.aoStrength, "value", 0, 1, 0.01).name("AO-Look");
  look.addColor(params, "colorA").name("Farbe A").onChange((c) => u.colorA.value.set(c));
  look.addColor(params, "colorB").name("Farbe B").onChange((c) => u.colorB.value.set(c));
  look.add(u.glow, "value", 0, 3, 0.01).name("Leuchten");
  look.add(params, "bloom", 0, 2, 0.01).name("Bloom-Stärke").onChange((v) => (setup.bloomStrength.value = v));

  const story = gui.addFolder("Scroll-Story");
  story.add(field.progress, "value", 0, 1, 0.001).name("progress");
  story
    .add(params, "progressMode", { "flach → Wellen": "rise", "verstreut → Raster": "assemble" })
    .name("progress-Modus")
    .onChange((mode) => field.setProgressMode(mode));
  story.close();

  return gui;
}
