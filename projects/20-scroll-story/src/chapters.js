// ============================================================
// CHAPTERS – fünf Timelines, eine pro Section
// ============================================================
// Jede Timeline ist genau 1 Sekunde lang. Positionen wie 0.3 heißen also
// „bei 30 % dieses Kapitels“. Das macht Timing lesbar und leicht zu justieren.
//
// Was macht scrub? Ohne scrub spielt eine Timeline ab, sobald der Trigger
// erreicht ist – nach Zeit. Mit scrub hängt ihr Fortschritt direkt an der
// Scrollposition: halb durchgescrollt = halb abgespielt, rückwärts = rückwärts.
//   scrub: true → exakt am Scroll (die Glättung kommt hier schon von Lenis)
//   scrub: 1    → holt den Scroll in 1 s ein (zusätzliche Trägheit)
// Wir nehmen true, damit Texte und 3D aufs Pixel genau zusammen bleiben –
// die filmische Trägheit gibt das Kamera-Damping in camera-path.js.
//
// Mehrere Kapitel tweenen dieselben Werte (z. B. state.t). Das klappt, weil
// .to() seinen Startwert erst beim ersten Abspielen merkt und wir die Kapitel
// von oben nach unten anlegen: Kapitel 2 startet dort, wo Kapitel 1 aufhört.

import gsap from "gsap";
import * as THREE from "three/webgpu";
import { U } from "./scene.js";
import { textIn, textOut } from "./text-animations.js";

// Farbe weich überblenden: GSAP tweent einfach r, g, b des THREE.Color-Objekts
function toColor(tl, color, hex, at, duration = 0.3) {
  const c = new THREE.Color(hex);
  tl.to(color, { r: c.r, g: c.g, b: c.b, duration }, at);
}

function chapter(n, { start = "top top", end = "bottom top" } = {}) {
  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: `.chapter[data-chapter="${n}"]`,
      start,
      end,
      scrub: true,
      markers: { startColor: "#cf1830", endColor: "#6f7bff", fontSize: "11px", indent: 140 + n * 30 },
      id: `ch${n}`,
    },
  });
  tl.set({}, {}, 1); // Timeline auf genau 1 s Länge bringen
  return tl;
}

export function createChapters({ rig, path, world, post, scene, text, reduced }) {
  const { state } = rig;
  const { keys } = path;
  const { lights, core } = world;
  const opt = { reduced };

  // ---------------- Kapitel 1 · Intro ----------------
  // Das Objekt allein im Dunkeln. Die Kamera schiebt sich minimal heran,
  // der Kern wird heller, der Titel löst sich nach oben auf.
  const ch1 = chapter(1);
  ch1
    .to(state, { t: keys.intro, duration: 1 }, 0)
    .to(U.coreGlow, { value: 3.2, duration: 0.7 }, 0.2)
    .to(".scroll-cue", { autoAlpha: 0, duration: 0.1 }, 0);
  textOut(ch1, document.querySelector(".copy--intro"), 0.5, opt);

  // ---------------- Kapitel 2 · Annäherung ----------------
  // Kamera fährt nah heran. Ab 30 % zerfällt die Kugel: scatter 0 → 0.28,
  // der Kern erlischt, die Splitter beginnen sich zu drehen.
  const ch2 = chapter(2);
  ch2
    .to(state, { t: keys.close, duration: 0.75, ease: "power1.inOut" }, 0)
    .to(U.scatter, { value: 0.28, duration: 0.7 }, 0.3)
    .to(U.spin, { value: 0.6, duration: 0.6 }, 0.3)
    .to(U.coreGlow, { value: 0, duration: 0.5 }, 0.35)
    .to(core.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.5, ease: "power2.in" }, 0.35)
    .to(lights.coreLight, { intensity: 0, duration: 0.5 }, 0.35)
    .to(U.glow, { value: 0.9, duration: 0.5 }, 0.4)
    .to(post.bloomStrength, { value: 0.5, duration: 0.5 }, 0.2)
    // Nah an der Kugel weniger Licht, sonst überstrahlt das Bild zu einer weißen Fläche
    .to(lights.key, { intensity: 1.1, duration: 0.5 }, 0.2)
    .to(scene, { environmentIntensity: 0.18, duration: 0.5 }, 0.2)
    .to(post.bloomThreshold, { value: 0.6, duration: 0.5 }, 0.2);
  textIn(ch2, text.chapters[2], 0.06, opt);
  textOut(ch2, text.chapters[2].copy, 0.8, opt);

  // ---------------- Kapitel 3 · Reise ----------------
  // Kamera folgt dem Pfad durch die Wolke, die Teile fliegen weiter auseinander
  // (scatter → 1), die Farben wandern: Eis → Violett/Türkis → Glut.
  const ch3 = chapter(3);
  ch3
    .to(state, { t: keys.journeyEnd, duration: 1, ease: "sine.inOut" }, 0)
    .to(U.scatter, { value: 1, duration: 0.55 }, 0)
    .to(scene.fog, { density: 0.042, duration: 0.4 }, 0.1)
    .to(post.bloomStrength, { value: 0.95, duration: 0.4 }, 0.2)
    .to(post.bloomThreshold, { value: 0.45, duration: 0.4 }, 0.2);
  toColor(ch3, U.colorA.value, "#a99bff", 0.1);
  toColor(ch3, U.colorB.value, "#20c9c0", 0.1);
  toColor(ch3, U.colorA.value, "#ff5a6e", 0.6);
  toColor(ch3, U.colorB.value, "#6a4dff", 0.6);
  textIn(ch3, text.chapters[3], 0.1, opt);
  textOut(ch3, text.chapters[3].copy, 0.8, opt);

  // ---------------- Kapitel 4 · Transformation ----------------
  // Die Teile setzen sich zum Siegel zusammen (form 0 → 1). Das Licht wechselt
  // von kühl zu warm, alles wird rot und weiß, die Drehung kommt zur Ruhe.
  const ch4 = chapter(4);
  ch4
    .to(U.form, { value: 1, duration: 0.8 }, 0)
    .to(state, { t: keys.seal, duration: 0.85, ease: "power2.out" }, 0)
    .to(U.spin, { value: 0, duration: 0.5 }, 0.4)
    .to(scene.fog, { density: 0.028, duration: 0.5 }, 0)
    .to(lights.key, { intensity: 2.8, duration: 0.6 }, 0.1)
    .to(lights.hemi, { intensity: 0.5, duration: 0.6 }, 0.1)
    .to(post.bloomStrength, { value: 0.75, duration: 0.5 }, 0.4)
    .to(U.glow, { value: 1.1, duration: 0.5 }, 0.4);
  toColor(ch4, lights.key.color, "#ffb27a", 0.1, 0.6);
  toColor(ch4, lights.hemi.color, "#ffd6bd", 0.1, 0.6);
  toColor(ch4, U.colorA.value, "#cf1830", 0.2, 0.55);
  toColor(ch4, U.colorB.value, "#f4ece6", 0.2, 0.55);
  textIn(ch4, text.chapters[4], 0.12, opt);
  textOut(ch4, text.chapters[4].copy, 0.85, opt);

  // ---------------- Kapitel 5 · Outro ----------------
  // Die Kamera zieht sich zurück, der Nebel lichtet sich, alles steht still.
  // Startet schon, wenn die Section zu 40 % im Bild ist, und endet ganz unten.
  const ch5 = chapter(5, { start: "top 60%", end: "bottom bottom" });
  ch5
    .to(state, { pull: 14, lift: 1.2, drop: 2.6, duration: 0.75, ease: "power2.inOut" }, 0)
    .to(scene.fog, { density: 0.012, duration: 0.6 }, 0)
    .to(post.bloomStrength, { value: 0.55, duration: 0.6 }, 0.2)
    .to(post.vignette, { value: 0.6, duration: 0.6 }, 0.2);
  textIn(ch5, text.chapters[5], 0.4, opt);

  // Lichtschimmer übers Siegel – läuft nach Zeit, sichtbar nur wenn es fertig ist
  if (!reduced) {
    gsap.fromTo(U.sweep, { value: -6 }, { value: 6, duration: 2.4, ease: "power2.inOut", repeat: -1, repeatDelay: 2.2 });
  }

  return [ch1, ch2, ch3, ch4, ch5];
}
