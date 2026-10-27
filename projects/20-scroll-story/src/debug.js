// ============================================================
// GUI / DEBUG – Tasten D, H, A + Kapitel-Fortschrittsbalken
// ============================================================
//   D  Debug an/aus: ScrollTrigger-Marker, Kamerapfad in 3D, HUD
//   H  alles Technische ausblenden (Hinweis, HUD, Marker) – für Aufnahmen
//   A  Auto-Scroll von oben nach unten in 20 s

import { U } from "./scene.js";

export function createDebug({ chapters, pathHelper, rig, renderer, autoScroll }) {
  const body = document.body;
  const hud = document.querySelector(".hud");
  const field = (k) => hud.querySelector(`[data-hud="${k}"]`);
  const out = {
    chapter: field("chapter"),
    scroll: field("scroll"),
    cam: field("cam"),
    scatter: field("scatter"),
    form: field("form"),
    fps: field("fps"),
  };
  field("backend").textContent = renderer.backend.isWebGPUBackend ? "WebGPU" : "WebGL2";

  let debug = false;
  let fps = 60;

  function setDebug(on) {
    debug = on;
    body.classList.toggle("debug", on);
    hud.hidden = !on;
    pathHelper.visible = on;
  }

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "d") {
      body.classList.remove("clean");
      setDebug(!debug);
    } else if (key === "h") {
      const clean = !body.classList.contains("clean");
      body.classList.toggle("clean", clean);
      if (clean) setDebug(false);
    } else if (key === "a") {
      autoScroll.toggle();
    }
  });

  // --- Kapitel-Fortschrittsbalken: jede Timeline füllt ihren Balken ---
  const items = document.querySelectorAll(".progress li");
  const names = chapters.map((tl) => tl.scrollTrigger.trigger.dataset.name);
  let active = 0;

  function update(dt) {
    let current = 0;
    chapters.forEach((tl, i) => {
      const p = tl.scrollTrigger.progress;
      items[i].querySelector("i").style.transform = `scaleY(${p})`;
      if (p > 0) current = i;
    });
    if (current !== active) {
      items[active].classList.remove("is-active");
      active = current;
    }
    items[active].classList.add("is-active");

    if (!debug) return;
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;
    const max = document.documentElement.scrollHeight - innerHeight;
    out.chapter.textContent = `${active + 1} · ${names[active]}`;
    out.scroll.textContent = `${((scrollY / max) * 100).toFixed(1)} %`;
    out.cam.textContent = rig.smooth.t.toFixed(3);
    out.scatter.textContent = U.scatter.value.toFixed(2);
    out.form.textContent = U.form.value.toFixed(2);
    out.fps.textContent = fps.toFixed(0);
  }

  return { update };
}
