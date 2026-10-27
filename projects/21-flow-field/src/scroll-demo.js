// ============================================================
// SCROLL-DEMO – das Flowfield-Modul in einer GSAP-Timeline
// ============================================================
// Das Modul kennt kein Scrollen. Es hat nur uniforms – und GSAP kann
// jede Zahl tweenen. ScrollTrigger mit `scrub` koppelt die Timeline an
// die Scrollposition: oben = Anfang, unten = Ende, rückwärts scrollen
// spult zurück.
//
//   Abschnitt 1  „flow“ als Text, ruhig (progress 0)
//   Abschnitt 2  Text löst sich in Rauch auf (progress → 1)
//   Abschnitt 3  Farbe kippt ins Feuer, Kamera fährt näher
//   Abschnitt 4  Papier: dieselbe Strömung als Tinte

import * as THREE from "three/webgpu";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createRenderer, createScene } from "./setup.js";
import { createFlowField, EMITTERS, PALETTES } from "./flowfield/index.js";
import { createTrails } from "./trails.js";

gsap.registerPlugin(ScrollTrigger);

await document.fonts.load("italic 220px 'Instrument Serif'").catch(() => {});

const canvas = document.querySelector("#scene");
const { renderer, isWebGPU } = await createRenderer(canvas);
const scene = createScene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 0, 8);

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// 1) Modul anlegen – Start: Text, ganz ruhig
const flow = createFlowField(renderer, scene, {
  count: isWebGPU ? 300_000 : 50_000,
  maxCount: isWebGPU ? 300_000 : 50_000,
  emitter: EMITTERS.Text,
  text: "flow",
  progress: 0,
});
flow.uniforms.mouseOn.value = 0;
flow.start();

const trails = createTrails(renderer, scene, camera, { paper: flow.uniforms.paper });

// 2) Eine Timeline, an den Scroll gekoppelt
const fire = PALETTES[2].colors.map((c) => new THREE.Color(c));
const u = flow.uniforms;

const tl = gsap.timeline({
  defaults: { ease: "none" }, // bei scrub bestimmt der Finger das Tempo
  scrollTrigger: {
    trigger: "#story",
    start: "top top",
    end: "bottom bottom",
    scrub: 1, // 1 s Nachlauf: weich statt ruckig
  },
});

tl.to(u.progress, { value: 1, duration: 1 }) // Abschnitt 2: Text → Rauch
  .to(u.colorA.value, { r: fire[0].r, g: fire[0].g, b: fire[0].b, duration: 1 }) // Abschnitt 3
  .to(u.colorB.value, { r: fire[1].r, g: fire[1].g, b: fire[1].b, duration: 1 }, "<")
  .to(u.colorC.value, { r: fire[2].r, g: fire[2].g, b: fire[2].b, duration: 1 }, "<")
  .to(camera.position, { z: 5.5, duration: 1 }, "<")
  .to(u.paper, { value: 1, duration: 1 }); // Abschnitt 4: Papier

// 3) Loop: Modul weiterrechnen, Spuren rendern
const timer = new THREE.Timer();
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), 1 / 30);
  flow.update(delta);
  trails.render(delta);
});
