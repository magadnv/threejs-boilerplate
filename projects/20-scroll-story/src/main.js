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

import { createRenderer, createScene, createCamera, createPost, onResize, isMobile, reducedMotion } from "./setup.js";
import { createCameraPath, createCameraRig, createPathHelper } from "./camera-path.js";
import { createWorld, U } from "./scene.js";
import { createScroll, startLoop, createAutoScroll } from "./scroll.js";
import { prepareText, createIntro } from "./text-animations.js";
import { createChapters } from "./chapters.js";
import { createDebug } from "./debug.js";

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

// Shader vorab bauen, damit der erste Scroll nicht ruckelt
rig.update(1);
await renderer.compileAsync(scene, camera);

// --- 4 · Der eine Loop (gsap.ticker) ---
startLoop(lenis, (dt) => {
  U.spinAngle.value += dt * U.spin.value * U.motion.value;
  rig.update(dt);
  debug.update(dt);
  pipeline.render();
});

document.body.classList.add("is-ready");
intro.play();
