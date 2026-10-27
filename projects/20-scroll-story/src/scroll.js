// ============================================================
// SCROLL – Lenis + ScrollTrigger + ein einziger Takt
// ============================================================
// Wer macht was?
//   Lenis         glättet das Scrollen (Mausrad → weiches Gleiten) und bewegt
//                 dabei die ECHTE Scrollposition des Fensters.
//   ScrollTrigger liest diese Position und setzt den Fortschritt der Timelines.
//   Three.js      rendert, was die Timelines in die uniforms geschrieben haben.
//
// Damit alles im selben Frame passiert, gibt es nur EINEN Takt: gsap.ticker.
//   1. lenis.raf()            → neue Scrollposition
//   2. lenis 'scroll'-Event   → ScrollTrigger.update() → Timelines springen hin
//   3. unser tick()           → Kamera dämpfen, renderPipeline.render()
// Kein zweites requestAnimationFrame, kein renderer.setAnimationLoop –
// sonst laufen Scroll und Bild um einen Frame versetzt und es „schwimmt“.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

gsap.registerPlugin(ScrollTrigger);

export function createScroll({ reduced }) {
  // Eine Story beginnt oben – der Browser soll die alte Position nicht wiederherstellen
  history.scrollRestoration = "manual";
  scrollTo(0, 0);

  const lenis = new Lenis({
    lerp: reduced ? 1 : 0.085, // 1 = kein Nachgleiten
    smoothWheel: !reduced,
    wheelMultiplier: 0.9,
    autoRaf: false, // den Takt geben wir vor (gsap.ticker)
  });

  lenis.on("scroll", ScrollTrigger.update);

  // GSAP würde nach einem Hänger die Zeit „aufholen“ – das würde Lenis springen lassen
  gsap.ticker.lagSmoothing(0);

  return lenis;
}

// Der eine Loop für alles. `onFrame` bekommt Delta- und Gesamtzeit in Sekunden.
export function startLoop(lenis, onFrame) {
  gsap.ticker.add((time, deltaMS) => {
    lenis.raf(time * 1000);
    onFrame(Math.min(deltaMS / 1000, 1 / 20), time);
  });
}

// ------------------------------------------------------------
// Auto-Scroll (Taste A): gleichmäßig von oben nach unten, für Aufnahmen
// ------------------------------------------------------------
export function createAutoScroll(lenis, { duration = 20, hold = 1.6, onStart, onEnd }) {
  let running = false;
  let delayed;

  function stop() {
    delayed?.kill();
    running = false;
    lenis.scrollTo(lenis.animatedScroll, { immediate: true, force: true });
    lenis.start();
    onEnd?.();
  }

  function start() {
    running = true;
    lenis.scrollTo(0, { immediate: true, force: true });
    onStart?.();
    // Kurz oben stehen bleiben, damit das Intro-Titel-Reinfliegen im Video ist
    delayed = gsap.delayedCall(hold, () => {
      lenis.scrollTo(lenis.limit, {
        duration,
        easing: (t) => t, // linear = gleichmäßige Geschwindigkeit
        lock: true, // Mausrad/Touch währenddessen ignorieren
        force: true,
        onComplete: () => {
          running = false;
          onEnd?.();
        },
      });
    });
  }

  return {
    toggle: () => (running ? stop() : start()),
  };
}
