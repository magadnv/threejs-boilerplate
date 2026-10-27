// ============================================================
// SETUP – WebGPU prüfen, Renderer, Szene, Kamera, Formate
// ============================================================

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Hat der Browser WebGPU UND einen passenden Grafik-Adapter?
async function hasWebGPU() {
  if (!navigator.gpu) return false;
  try {
    return (await navigator.gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

export async function createRenderer(canvas) {
  // WebGPURenderer nimmt WebGPU, wenn möglich – sonst WebGL2. Derselbe
  // TSL-Code wird dann in GLSL übersetzt, Compute läuft über Transform
  // Feedback (deutlich langsamer → weniger Partikel).
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false, // bei Hunderttausenden Punkten kostet MSAA nur
    forceWebGL: !(await hasWebGPU()),
  });
  // Die Spuren sammeln Licht in eigenen Puffern – Tone Mapping machen wir dort selbst
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  // Erst nach init() steht fest, welches Backend läuft – vorher nicht rendern
  await renderer.init();
  const isWebGPU = renderer.backend.isWebGPUBackend === true;
  return { renderer, isWebGPU };
}

export function createScene() {
  // Kein Hintergrund: die Szene wird in einen transparenten Puffer gerendert,
  // die Farbe des Grunds (Nacht/Papier) kommt erst in der Komposition dazu
  return new THREE.Scene();
}

export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0.6, 9);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotateSpeed = 0.35; // Autopilot: eine Umdrehung in ~3 Minuten
  controls.minDistance = 3;
  controls.maxDistance = 20;
  return { camera, controls };
}

// ------------------------------------------------------------
// Canvas-Formate (Taste F): Vollbild · 1:1 · 16:9
// ------------------------------------------------------------
// Feste Formate rendern pixelgenau in der Zielgröße (fürs Aufnehmen) und
// werden nur per CSS ins Fenster eingepasst.
export const FORMATS = [
  { name: "Vollbild", width: null, height: null },
  { name: "1:1 · 1080×1080", width: 1080, height: 1080 },
  { name: "16:9 · 1920×1080", width: 1920, height: 1080 },
];

export function createResizer(renderer, camera, canvas) {
  let index = 0;

  function resize() {
    const f = FORMATS[index];
    if (!f.width) {
      canvas.style.width = canvas.style.height = "";
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
    } else {
      renderer.setPixelRatio(1);
      renderer.setSize(f.width, f.height, false);
      const scale = Math.min(innerWidth / f.width, innerHeight / f.height, 1);
      canvas.style.width = `${f.width * scale}px`;
      canvas.style.height = `${f.height * scale}px`;
      camera.aspect = f.width / f.height;
    }
    camera.updateProjectionMatrix();
  }

  addEventListener("resize", resize);
  resize();

  return {
    next() {
      index = (index + 1) % FORMATS.length;
      resize();
      return FORMATS[index].name;
    },
  };
}
