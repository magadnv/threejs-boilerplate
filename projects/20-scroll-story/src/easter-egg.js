// ============================================================
// EASTER EGG – fünfmal aufs Siegel stempeln
// ============================================================
// Jeder Klick aufs fertige Siegel ist ein Stempel-Stoß. Die Stöße werden mit
// jedem Mal etwas stärker – man spürt, dass sich etwas aufbaut. Beim fünften
// lösen sich die Splitter aus dem Siegel und schreiben „hey.“ (uniform U.egg),
// dazu kommt die Frage: Hey. How did you find this?
//
// Zurück geht's mit Klick, Escape oder einfach Hochscrollen.

import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { U } from "./scene.js";

const NEEDED = 5;
const WINDOW = 4; // Sekunden zwischen zwei Stempeln, sonst fängt das Zählen neu an

export function createEasterEgg({ reduced }) {
  const el = document.querySelector(".egg");
  const split = SplitText.create(el.querySelector(".title"), { type: "words,chars", mask: "chars", charsClass: "char" });
  const rest = el.querySelectorAll(".eyebrow, .lead, .cta, .egg__close");

  let count = 0;
  let lastStamp = -Infinity;
  let active = false;
  let reveal;

  function stamp() {
    const now = performance.now() / 1000;
    count = now - lastStamp < WINDOW ? count + 1 : 1;
    lastStamp = now;

    // Stoß wächst: 0.9, 1.1, 1.3, 1.5 …
    const strength = 0.9 + (count - 1) * 0.2;
    if (!reduced) gsap.fromTo(U.stamp, { value: strength }, { value: 0, duration: 1.8, ease: "elastic.out(1, 0.3)", overwrite: true });

    if (count >= NEEDED) open();
  }

  function open() {
    active = true;
    count = 0;
    document.body.classList.add("egg-on");
    gsap.to(U.egg, { value: 1, duration: reduced ? 0.6 : 2.4, ease: "power2.inOut", overwrite: true });

    el.hidden = false;
    reveal?.kill();
    reveal = gsap.timeline({ delay: reduced ? 0 : 0.9 });
    if (reduced) {
      reveal.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 });
    } else {
      reveal
        .set(el, { autoAlpha: 1 })
        .from(split.chars, { yPercent: 140, rotate: 8, duration: 1.1, ease: "expo.out", stagger: 0.03 })
        .from(rest, { y: 18, autoAlpha: 0, duration: 0.8, ease: "power3.out", stagger: 0.1 }, 0.4);
    }
  }

  function close() {
    if (!active) return;
    active = false;
    document.body.classList.remove("egg-on");
    gsap.to(U.egg, { value: 0, duration: reduced ? 0.6 : 1.8, ease: "power2.inOut", overwrite: true });
    reveal?.kill();
    gsap.to(el, { autoAlpha: 0, duration: 0.4, onComplete: () => (el.hidden = true) });
  }

  addEventListener("keydown", (e) => e.key === "Escape" && close());

  return {
    get active() {
      return active;
    },
    stamp,
    close,
  };
}
