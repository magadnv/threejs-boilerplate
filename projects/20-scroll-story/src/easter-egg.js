// ============================================================
// EASTER EGGS – sechs Geheimnisse, sechs verschiedene Auslöser
// ============================================================
//   1 · Stempeln  fünfmal aufs fertige Siegel klicken. Die Stöße werden stärker,
//                 beim fünften schreiben die Splitter „hey.“ (uniform U.egg)
//   2 · Halten    im Intro die Kugel 2,5 s gedrückt halten. Sie lädt sich auf
//                 (U.charge: Zittern + Glühen) und explodiert (U.burst)
//   3 · Gold      „luxe“ tippen oder dreimal auf „madebymaga“ klicken →
//                 Gold-Edition für die ganze Seite (U.gold + CSS-Klasse)
//   4 · Stille    auf der Reise 5 s nichts tun → die Welt hält an, eine
//                 Sternschnuppe zieht durchs Bild
//   5 · Kuzushi   das Siegel schnell zur Seite ziehen → es kippt aus dem
//                 Gleichgewicht und federt zurück (U.tilt)
//   6 · Papier    ↑↑↓↓←→←→ oder das Siegel 1,5 s halten (geht auch am Handy)
//                 → Paper Edition: Tinte auf Papier, Siegel rot auf weiß
//
// Jeder Fund zählt mit: „Easter egg 2 / 6“ – wer zwei hat, sucht weiter.

import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import * as THREE from "three/webgpu";
import { U } from "./scene.js";
import { BG } from "./setup.js";

const TOTAL = 6;
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

export function createEasterEggs({ reduced, scene, camera, post }) {
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

  // ---------------- 2 · Halten → Supernova (und 6 · Siegel halten → Papier) ----------------
  // Halten funktioniert für zwei Ziele: die Kugel im Intro und das Siegel am Ende.
  // Beides lädt dieselbe Ladung U.charge auf – die Splitter glühen dabei auf.
  const HOLD_TIME = { sphere: 2.5, seal: 1.5 };
  let holdTarget = null; // null | "sphere" | "seal"
  let overSphere = false;
  let cooldown = 0;
  let held = false; // ein fertiges Halten soll beim Loslassen nicht auch noch stempeln

  addEventListener("pointerdown", (e) => {
    held = false;
    if (e.target.closest("a") || cooldown > 0) return;
    if (overSphere) holdTarget = "sphere";
    else if (lastOverSeal && !heyActive) holdTarget = "seal";
  });
  addEventListener("pointerup", () => (holdTarget = null));
  addEventListener("pointercancel", () => (holdTarget = null));

  function supernova() {
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

  // ---------------- 4 · Stille → Sternschnuppe ----------------
  const IDLE_CALM = 2.5; // ab hier wird die Welt ruhiger
  const IDLE_WISH = 5; //  ab hier kommt die Sternschnuppe
  let idle = 0;
  let wished = false;

  for (const type of ["pointermove", "pointerdown", "wheel", "keydown", "touchstart", "scroll"]) {
    addEventListener(type, () => (idle = 0), { passive: true });
  }

  // Die Sternschnuppe hängt an der Kamera – so fliegt sie immer durchs Bild
  const starMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(4, 3.8, 3.4), transparent: true, opacity: 0, fog: false });
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.018, 1.4, 6), starMat);
  scene.add(camera);
  camera.add(star);
  star.visible = false;

  function shootingStar() {
    const from = new THREE.Vector3(-3.6, 2.4, -8);
    const to = new THREE.Vector3(3.8, 0.6, -8);
    // Zylinder zeigt entlang Y → in Flugrichtung drehen, dünnes Ende hinten
    star.rotation.z = Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2;
    star.position.copy(from);
    star.visible = true;
    gsap
      .timeline({ onComplete: () => (star.visible = false) })
      .to(starMat, { opacity: 1, duration: 0.15 }, 0)
      .to(star.position, { x: to.x, y: to.y, duration: 1.2, ease: "power1.in" }, 0)
      .to(starMat, { opacity: 0, duration: 0.35 }, 0.85);
    toast(discover("wish"), "Still enough to see it. <em>Make a wish.</em>");
  }

  function updateStillness(dt) {
    const onJourney = U.scatter.value > 0.6 && U.form.value < 0.05;
    idle = onJourney ? idle + dt : 0;
    if (!onJourney) wished = false;

    // Wer still hält, dessen Welt wird auch still: Treiben und Drehen ebben ab
    if (!reduced) {
      const calm = THREE.MathUtils.smoothstep(idle, IDLE_CALM, IDLE_WISH);
      U.motion.value = 1 - calm * 0.85;
    }
    if (idle > IDLE_WISH && !wished) {
      wished = true;
      shootingStar();
    }
  }

  // ---------------- 5 · Kuzushi → Siegel kippt ----------------
  let drag = null;
  let dragged = false;

  addEventListener("pointerdown", (e) => {
    dragged = false;
    drag = lastOverSeal ? { x: e.clientX, t: performance.now() } : null;
  });
  addEventListener("pointermove", (e) => {
    if (!drag || U.tilt.value.lengthSq() > 0.01) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 10) dragged = true;
    const fast = performance.now() - drag.t < 700;
    if (fast && Math.abs(dx) > Math.min(220, innerWidth * 0.16)) {
      kuzushi(Math.sign(dx));
      drag = null;
    }
  });
  addEventListener("pointerup", () => (drag = null));

  function kuzushi(dir) {
    const t = U.tilt.value;
    gsap
      .timeline()
      .to(t, { x: dir * 0.85, y: 0.3, duration: 0.35, ease: "power2.out" })
      .to(t, { x: 0, y: 0, duration: 2.4, ease: "elastic.out(1, 0.28)" });
    toast(discover("kuzushi"), "Kuzushi. <em>Off balance, and back.</em>");
  }

  // ---------------- 6 · Konami → Paper Edition ----------------
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"];
  let keys = [];
  let paperOn = false;
  // Papierweiß, deutlich über 1 – ACES-Tone-Mapping drückt helle Werte sonst ins Grau
  const NIGHT = BG.clone();
  const PAPER = new THREE.Color(3.2, 3.05, 2.75);

  function togglePaper() {
    paperOn = !paperOn;
    const to = paperOn ? PAPER : NIGHT;
    const d = reduced ? 0.3 : 1.4;
    document.body.classList.toggle("paper", paperOn);
    gsap.to([U.paper, post.paper], { value: paperOn ? 1 : 0, duration: d, ease: "power2.inOut", overwrite: true });
    // Hintergrund und Nebel gemeinsam umfärben, sonst bleibt am Horizont ein Rest Nacht
    gsap.to([scene.background, scene.fog.color], { r: to.r, g: to.g, b: to.b, duration: d, ease: "power2.inOut", overwrite: true });
    if (paperOn) toast(discover("paper"), "Red on white. <em>Where it all began.</em>");
  }

  addEventListener("keydown", (e) => {
    keys = [...keys, e.key].slice(-KONAMI.length);
    if (keys.join() !== KONAMI.join()) return;
    keys = [];
    togglePaper();
  });

  // Ein Gruß für alle, die in die Konsole schauen
  console.log(
    "%cpsst.%c Six easter eggs hide in this page. One of them starts by typing a four-letter word for what you deserve.",
    "font: italic 20px 'Instrument Serif', serif; color: #cf1830",
    "font: 12px Inter, sans-serif"
  );

  let lastOverSeal = false;

  // Pro Frame: Treffer übernehmen, Ladung auf- oder abbauen, Stille messen
  function update(dt, { sphereHit, overSeal }) {
    lastOverSeal = overSeal;
    updateStillness(dt);
    cooldown = Math.max(0, cooldown - dt);
    overSphere = sphereHit && cooldown === 0;

    // Wer zieht (Kuzushi), hält nicht
    if (dragged) holdTarget = null;
    const stillOver = holdTarget === "sphere" ? overSphere : holdTarget === "seal" && overSeal;

    if (stillOver) {
      U.charge.value = Math.min(1, U.charge.value + dt / HOLD_TIME[holdTarget]);
      if (U.charge.value >= 1) {
        const target = holdTarget;
        holdTarget = null;
        held = true;
        cooldown = 3;
        U.charge.value = 0;
        if (target === "sphere") supernova();
        else togglePaper();
      }
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
    // Nach einem Kuzushi-Zug oder fertigem Halten soll der Klick nicht auch noch stempeln
    get suppressClick() {
      return dragged || held;
    },
    stamp,
    closeHey,
    update,
  };
}
