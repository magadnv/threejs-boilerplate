// ============================================================
// BEISPIEL – das Modul in einer GSAP-ScrollTrigger-Timeline
// ============================================================
// Läuft unter /scroll.html. Kern ist nur dieser Teil:
//
//   const field = createInstanceField(renderer, scene, { progressMode: "assemble" });
//   field.progress.value = 0;
//   field.start();
//   gsap.timeline({ scrollTrigger: { trigger: "#story", scrub: 1, … } })
//     .to(field.progress, { value: 1, ease: "none" });
//
// field.progress ist ein TSL-uniform. GSAP tweent einfach dessen .value –
// der Shader liest den neuen Wert im nächsten Frame, nichts wird neu gebaut.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createSetup } from "./setup.js";
import { createInstanceField } from "./instance-field.js";
import { LOOKS, applyLook } from "./looks.js";

gsap.registerPlugin(ScrollTrigger);

const canvas = document.querySelector("#scene");
const setup = await createSetup(canvas);
const { renderer, scene, camera, controls, pipeline } = setup;
controls.enabled = false; // Kamera gehört hier dem Scroll

const field = createInstanceField(renderer, scene, {
  side: 200,
  variant: "stadt",
  progressMode: "assemble", // 0 verstreut → 0,55 Raster → 1 Wellen
});
field.progress.value = 0;
applyLook(LOOKS[0], { setup, field, params: {} });
field.start();

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Die Timeline: scrub koppelt sie an den Scrollbalken ---
// scrub: 1 = die Timeline holt den Scroll in ~1 s ein (weich statt ruckig)
camera.position.set(0, 48, 30);
const lookAt = { y: 0 };

gsap
  .timeline({
    scrollTrigger: { trigger: "#story", start: "top top", end: "bottom bottom", scrub: 1 },
    defaults: { ease: "none" },
  })
  .to(field.progress, { value: 1, duration: 1 }, 0)
  .to(camera.position, { x: 30, y: 20, z: 34, duration: 1, ease: "power1.inOut" }, 0)
  .to(lookAt, { y: 1, duration: 1 }, 0)
  .to(field.uniforms.waveHeight, { value: 6, duration: 0.25 }, 0.75);

// Am Ende eine Schockwelle, sobald das letzte Kapitel erreicht ist
ScrollTrigger.create({
  trigger: ".chapter:last-child",
  start: "top center",
  onEnter: () => field.shock(0, 0, 1.4),
});

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const delta = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  field.update(delta);
  camera.lookAt(0, lookAt.y, 0);
  pipeline.render();
});
