// ============================================================
// SETUP – Renderer, Szene, Kamera, Post-Processing
// ============================================================

import * as THREE from "three/webgpu";
import { pass, renderOutput, uniform, uv, vec4 } from "three/tsl";
// Fertige Effekt-Nodes liegen bei den Addons, nicht direkt in three/tsl
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { vignette } from "three/addons/tsl/display/CRT.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Einmal beim Laden entscheiden – davon hängen Instanz-Anzahl, Kamera und Parallax ab
export const isMobile = matchMedia("(max-width: 768px), (pointer: coarse)").matches;
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const BG = new THREE.Color(0x060609);

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
  // WebGPURenderer nimmt WebGPU, wenn möglich – sonst WebGL2.
  // Derselbe TSL-Code wird dann einfach in GLSL statt WGSL übersetzt.
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: !(await hasWebGPU()),
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // Erst nach init() steht fest, welches Backend läuft – vorher nicht rendern
  await renderer.init();
  return renderer;
}

export function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = BG;
  // Exponentieller Nebel gibt der Reise Tiefe; GSAP verändert die Dichte pro Kapitel
  scene.fog = new THREE.FogExp2(BG, 0.03);

  // Weiche Umgebungsreflexion, damit die metallischen Splitter funkeln
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  return scene;
}

// Auf schmalen (Hochkant-)Screens wird das Sichtfeld weiter, damit das Siegel
// am Ende auch auf dem Handy ganz ins Bild passt
const BASE_FOV = 40;

function fitFov(camera) {
  const aspect = innerWidth / innerHeight;
  const halfV = THREE.MathUtils.degToRad(BASE_FOV / 2);
  const fov = aspect < 1 ? 2 * Math.atan(Math.tan(halfV) / aspect) : 2 * halfV;
  camera.fov = Math.min(THREE.MathUtils.radToDeg(fov), 72);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 120);
  fitFov(camera);
  return camera;
}

export function onResize(renderer, camera) {
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight, false);
    fitFov(camera);
  });
}

// ------------------------------------------------------------
// Post-Processing als Node-Graph:
//   scenePass → + Bloom (HDR) → Tone Mapping/sRGB → Vignette
// Alle Stärken sind uniforms, damit GSAP sie pro Kapitel animieren kann.
// ------------------------------------------------------------
export function createPost(renderer, scene, camera) {
  const pipeline = new THREE.RenderPipeline(renderer);
  // Tone Mapping machen wir selbst (renderOutput) – Bloom braucht davor echte HDR-Werte
  pipeline.outputColorTransform = false;

  const post = {
    bloomStrength: uniform(0.7),
    bloomRadius: uniform(0.55),
    bloomThreshold: uniform(0.42),
    vignette: uniform(0.42),
    paper: uniform(0), // Easter Egg 6: Paper Edition – auf weißem Papier kein Bloom
  };

  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode("output");

  const glow = bloom(color, post.bloomStrength, post.bloomRadius, post.bloomThreshold);
  // Papier ist hell – mit Bloom würde die ganze Fläche überstrahlen
  const mapped = renderOutput(color.add(glow.mul(post.paper.oneMinus())));
  // Auf Papier nur ein Hauch Vignette, sonst wirkt es schmutzig
  pipeline.outputNode = vec4(vignette(mapped.rgb, post.vignette.mul(post.paper.mul(-0.8).add(1)), uniform(0.55), uv()), 1);

  return { pipeline, post };
}
