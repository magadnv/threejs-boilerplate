// ============================================================
// LOOKS – zwei Stimmungen für X (Taste B)
// ============================================================
// Ein Look ist nur ein Satz Werte. Umschalten ändert Uniforms und
// Lichtfarben – kein Shader wird neu gebaut.

import * as THREE from "three/webgpu";

export const LOOKS = [
  {
    name: "Nacht",
    background: "#07070a",
    floor: "#0a0a0e",
    colorA: "#1b1d26",
    colorB: "#cf1830",
    colorTip: "#ffd6cc",
    shockColor: "#cf1830",
    glow: 1.2,
    shockGlow: 1.5,
    bloom: 0.8,
    bloomThreshold: 0.55,
    hemi: 0.4,
    hemiGround: "#222222",
    sun: 2.2,
    roughness: 0.55,
    exposure: 1,
  },
  {
    // Architekturmodell: weiße Würfel, weiche Schatten, Rot nur im Klick
    name: "Modell",
    background: "#eeece8",
    floor: "#eeece8",
    colorA: "#d9d5ce",
    colorB: "#ffffff",
    colorTip: "#ffffff",
    shockColor: "#cf1830",
    glow: 0,
    shockGlow: 0.9,
    bloom: 0.12,
    bloomThreshold: 0.95,
    hemi: 1.6,
    hemiGround: "#bdb7ae",
    sun: 2.6,
    roughness: 0.9,
    exposure: 1,
  },
];

export function applyLook(look, { setup, field, params }) {
  const { scene, floor, hemi, sun, renderer, bloomStrength, bloomPass } = setup;
  const u = field.uniforms;

  scene.background = new THREE.Color(look.background);
  scene.fog.color.set(look.background);
  floor.material.color.set(look.floor);
  hemi.intensity = look.hemi;
  hemi.groundColor.set(look.hemiGround);
  sun.intensity = look.sun;
  renderer.toneMappingExposure = look.exposure;

  u.colorA.value.set(look.colorA);
  u.colorB.value.set(look.colorB);
  u.colorTip.value.set(look.colorTip);
  u.shockColor.value.set(look.shockColor);
  u.glow.value = look.glow;
  u.shockGlow.value = look.shockGlow;
  field.mesh.material.roughness = look.roughness;

  bloomStrength.value = look.bloom;
  bloomPass.threshold.value = look.bloomThreshold;

  // GUI-Werte nachziehen, damit die Regler den Look zeigen
  Object.assign(params, {
    colorA: look.colorA,
    colorB: look.colorB,
    bloom: look.bloom,
  });
}
