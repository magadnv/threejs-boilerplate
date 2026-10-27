// ============================================================
// 20 · Scroll Story – GSAP × Three.js
// ============================================================
// Ein Punkt im Dunkeln zerfällt in Tausende Splitter, die Kamera fliegt
// hindurch, am Ende setzen sie sich zum madebymaga-Siegel zusammen.
//
// Aufbau (eine Datei pro Abschnitt):
//   setup.js           Renderer (WebGPU → WebGL2), Szene, Kamera, Bloom + Vignette
//   scene.js           Splitter (Instancing + TSL), Kern, Lichter, uniforms U
//   camera-path.js     Kamera- und Blick-Kurve, gedämpftes Kamera-Rig
//   chapters.js        fünf ScrollTrigger-Timelines, eine pro Kapitel
//   scroll.js          Lenis + ScrollTrigger + der eine Takt, Auto-Scroll
//   text-animations.js SplitText-Intro und Text-Helfer für die Kapitel
//   debug.js           Tasten D/H/A, HUD, Fortschrittsbalken
//   easter-egg.js      sechs Geheimnisse: Stempeln, Halten, Gold, Stille, Kuzushi, Konami

import { createRenderer, createScene, createCamera, createPost, onResize, isMobile, reducedMotion } from "./setup.js";
import * as THREE from "three/webgpu";
import { createCameraPath, createCameraRig, createPathHelper, SEAL_CENTER } from "./camera-path.js";
import { createWorld, U } from "./scene.js";
import { createScroll, startLoop, createAutoScroll } from "./scroll.js";
import { prepareText, createIntro } from "./text-animations.js";
import { createChapters } from "./chapters.js";
import { createDebug } from "./debug.js";
import { createEasterEggs } from "./easter-egg.js";

// --- 1 · Setup ---
const canvas = document.querySelector("#scene");
const renderer = await createRenderer(canvas);
const scene = createScene(renderer);
const camera = createCamera();
const { pipeline, post } = createPost(renderer, scene, camera);
onResize(renderer, camera);

// --- 2 · Szene + Pfad ---
const path = createCameraPath();
const world = await createWorld(scene, path, {
  count: isMobile ? 1600 : 4000, // Mobile: weniger Instanzen, dafür größere Splitter
  reduced: reducedMotion,
});
const pathHelper = createPathHelper(path);
scene.add(pathHelper);

const rig = createCameraRig(camera, path, {
  reduced: reducedMotion,
  parallax: !isMobile && !reducedMotion,
});

// --- 3 · Scroll + Text + Kapitel ---
const lenis = createScroll({ reduced: reducedMotion });
const text = await prepareText();
const intro = createIntro(text.intro, { reduced: reducedMotion });
const chapters = createChapters({ rig, path, world, post, scene, text, reduced: reducedMotion });

const autoScroll = createAutoScroll(lenis, {
  duration: 20,
  onStart: () => {
    document.body.classList.add("autoplay");
    intro.restart();
  },
  onEnd: () => document.body.classList.remove("autoplay"),
});

const debug = createDebug({ chapters, pathHelper, rig, renderer, autoScroll });

const eggs = createEasterEggs({ reduced: reducedMotion, scene, camera, post });

// --- Siegel-Entdeckungen: Maus drückt die Splitter weg, Klick stempelt ---
// Der Mausstrahl trifft die Ebene des Siegels; der Treffpunkt geht als uniform
// in den Shader. Erst aktiv, wenn das Siegel fertig ist.
const raycaster = new THREE.Raycaster();
const sealPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -SEAL_CENTER.z);
const ndc = new THREE.Vector2(9, 9);
const hit = new THREE.Vector3();
let overSeal = false;
const introSphere = new THREE.Sphere(new THREE.Vector3(), 1.45); // Kugel im Intro

addEventListener("pointermove", (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});

addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  if (eggs.heyActive) return eggs.closeHey();
  if (overSeal && !eggs.dragged) eggs.stamp();
});

function updatePointer(dt) {
  raycaster.setFromCamera(ndc, camera);
  const onPlane = raycaster.ray.intersectPlane(sealPlane, hit);
  overSeal = U.form.value > 0.9 && onPlane !== null && hit.distanceTo(SEAL_CENTER) < 3.6;
  if (overSeal) U.pointer.value.copy(hit);
  U.pointerAmt.value = THREE.MathUtils.damp(U.pointerAmt.value, overSeal && !reducedMotion ? 1 : 0, 6, dt);
  // Die Kugel lässt sich nur im Intro greifen, solange sie noch ganz ist
  const sphereHit = U.scatter.value < 0.02 && raycaster.ray.intersectsSphere(introSphere);
  const overSphere = eggs.update(dt, { sphereHit, overSeal });

  document.body.style.cursor = overSeal || overSphere || eggs.heyActive ? "pointer" : "";
  // Wer hochscrollt, bekommt das Siegel zurück
  if (eggs.heyActive && U.form.value < 0.9) eggs.closeHey();
}

// Shader vorab bauen, damit der erste Scroll nicht ruckelt
rig.update(1);
await renderer.compileAsync(scene, camera);

// --- 4 · Der eine Loop (gsap.ticker) ---
startLoop(lenis, (dt) => {
  U.spinAngle.value += dt * U.spin.value * U.motion.value;
  rig.update(dt);
  updatePointer(dt);
  debug.update(dt);
  pipeline.render();
});

document.body.classList.add("is-ready");
intro.play();
