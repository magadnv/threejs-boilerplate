// ============================================================
// EASTER EGGS – drei Geheimnisse, drei verschiedene Auslöser
// ============================================================
//   1 · Stempeln  fünfmal aufs fertige Siegel klicken. Die Stöße werden stärker,
//                 beim fünften schreiben die Splitter „hey.“ (uniform U.egg)
//   2 · Halten    im Intro die Kugel 2,5 s gedrückt halten. Sie lädt sich auf
//                 (U.charge: Zittern + Glühen) und explodiert (U.burst)
//   3 · Gold      „luxe“ tippen oder dreimal auf „madebymaga“ klicken →
//                 Gold-Edition für die ganze Seite (U.gold + CSS-Klasse)
//
// Jeder Fund zählt mit: „Easter egg 2 / 3“ – wer zwei hat, sucht das dritte.

import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import * as THREE from "three/webgpu";
import { U } from "./scene.js";

const TOTAL = 3;
const found = new Set();

// Gibt die Zeile „Easter egg n / 3“ zurück und merkt sich den Fund
function discover(id) {
  found.add(id);
  return found.size === TOTAL ? `All ${TOTAL} easter eggs found` : `Easter egg ${found.size} / ${TOTAL}`;
}

// Kleiner Toast oben in der Mitte für Ei 2 und 3
function createToast() {
  const el = document.querySelector(".toast");
  const eyebrow = el.querySelector(".eyebrow");
  const line = el.querySelector(".toast__line");
  let tl;

  return (label, html) => {
    eyebrow.textContent = label;
    line.innerHTML = html;
    el.hidden = false;
    tl?.kill();
    tl = gsap
      .timeline()
      .fromTo(el, { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power3.out" })
      .to(el, { autoAlpha: 0, y: -10, duration: 0.6, ease: "power2.in" }, 4.5)
      .call(() => (el.hidden = true));
  };
}

export function createEasterEggs({ reduced }) {
  const toast = createToast();

  // ---------------- 1 · Stempeln → „hey.“ ----------------
  const NEEDED = 5;
  const WINDOW = 4; // Sekunden zwischen zwei Stempeln, sonst fängt das Zählen neu an

  const el = document.querySelector(".egg");
  const eggLabel = el.querySelector(".eyebrow");
  const split = SplitText.create(el.querySelector(".title"), { type: "words,chars", mask: "chars", charsClass: "char" });
  const rest = el.querySelectorAll(".eyebrow, .lead, .cta, .egg__close");

  let count = 0;
  let lastStamp = -Infinity;
  let heyActive = false;
  let reveal;

  function stamp() {
    const now = performance.now() / 1000;
    count = now - lastStamp < WINDOW ? count + 1 : 1;
    lastStamp = now;

    // Stoß wächst: 0.9, 1.1, 1.3, 1.5 …
    const strength = 0.9 + (count - 1) * 0.2;
    if (!reduced) gsap.fromTo(U.stamp, { value: strength }, { value: 0, duration: 1.8, ease: "elastic.out(1, 0.3)", overwrite: true });

    if (count >= NEEDED) openHey();
  }

  function openHey() {
    heyActive = true;
    count = 0;
    eggLabel.textContent = `You found it · ${discover("hey")}`;
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
        .fromTo(split.chars, { yPercent: 140, rotate: 8 }, { yPercent: 0, rotate: 0, duration: 1.1, ease: "expo.out", stagger: 0.03 })
        .fromTo(rest, { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, ease: "power3.out", stagger: 0.1 }, 0.4);
    }
  }

  function closeHey() {
    if (!heyActive) return;
    heyActive = false;
    document.body.classList.remove("egg-on");
    gsap.to(U.egg, { value: 0, duration: reduced ? 0.6 : 1.8, ease: "power2.inOut", overwrite: true });
    reveal?.kill();
    gsap.to(el, { autoAlpha: 0, duration: 0.4, onComplete: () => (el.hidden = true) });
  }

  // ---------------- 2 · Halten → Supernova ----------------
  const CHARGE_TIME = 2.5;
  let holding = false;
  let overSphere = false;
  let cooldown = 0;

  addEventListener("pointerdown", (e) => {
    if (overSphere && !e.target.closest("a")) holding = true;
  });
  addEventListener("pointerup", () => (holding = false));
  addEventListener("pointercancel", () => (holding = false));

  function supernova() {
    holding = false;
    cooldown = 3;
    U.charge.value = 0;
    if (!reduced) {
      gsap.fromTo(U.burst, { value: 1 }, { value: 0, duration: 2.6, ease: "elastic.out(1, 0.25)", overwrite: true });
    }
    toast(discover("hold"), "You held on. <em>Patience pays.</em>");
  }

  // ---------------- 3 · Gold-Edition ----------------
  const WORD = "luxe";
  let typed = "";
  let goldOn = false;
  let brandClicks = [];

  function toggleGold() {
    goldOn = !goldOn;
    document.body.classList.toggle("gold", goldOn);
    gsap.to(U.gold, { value: goldOn ? 1 : 0, duration: reduced ? 0.3 : 1.6, ease: "power2.inOut", overwrite: true });
    if (goldOn) toast(discover("gold"), "Gold edition. <em>Some things deserve it.</em>");
  }

  addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closeHey();
    if (e.metaKey || e.ctrlKey || e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-WORD.length);
    if (typed === WORD) {
      typed = "";
      toggleGold();
    }
  });

  // Ohne Tastatur (Handy): dreimal schnell auf den Namen oben links
  document.querySelector(".brand__mark").addEventListener("click", () => {
    const now = performance.now();
    brandClicks = [...brandClicks.filter((t) => now - t < 1200), now];
    if (brandClicks.length >= 3) {
      brandClicks = [];
      toggleGold();
    }
  });

  // Ein Gruß für alle, die in die Konsole schauen
  console.log(
    "%cpsst.%c Three easter eggs hide in this page. One of them starts by typing a four-letter word for what you deserve.",
    "font: italic 20px 'Instrument Serif', serif; color: #cf1830",
    "font: 12px Inter, sans-serif"
  );

  // Pro Frame: Kugel-Treffer übernehmen und Ladung auf- oder abbauen
  function update(dt, { sphereHit }) {
    cooldown = Math.max(0, cooldown - dt);
    overSphere = sphereHit && cooldown === 0;
    if (holding && overSphere) {
      U.charge.value = Math.min(1, U.charge.value + dt / CHARGE_TIME);
      if (U.charge.value >= 1) supernova();
    } else {
      // Loslassen: Ladung fließt weich ab – man darf es nochmal versuchen
      U.charge.value = THREE.MathUtils.damp(U.charge.value, 0, 5, dt);
    }
    return overSphere;
  }

  return {
    get heyActive() {
      return heyActive;
    },
    stamp,
    closeHey,
    update,
  };
}
