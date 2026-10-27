// ============================================================
// CONTROLS – Tasten, Canvas-Formate, Screenshot, Anzeige
// ============================================================
// M Variante · B Look · F Format · A Autopilot · H GUI aus · S Screenshot

const FORMATS = [
  { name: "Vollbild", width: null, height: null },
  { name: "1:1 · 1080×1080", width: 1080, height: 1080 },
  { name: "16:9 · 1920×1080", width: 1920, height: 1080 },
];

export function createControls({ setup, canvas, field, gui, autopilot, actions }) {
  const { renderer, camera, controls } = setup;
  const hud = document.querySelector("#hud");
  const badge = document.querySelector("#badge");

  // --- Formate (Taste F) ---
  let formatIndex = 0;

  function resize() {
    const f = FORMATS[formatIndex];
    if (!f.width) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
    } else {
      // Exakte Pixel fürs Video rendern, per CSS nur ins Fenster einpassen
      renderer.setPixelRatio(1);
      renderer.setSize(f.width, f.height, false);
      const scale = Math.min(window.innerWidth / f.width, window.innerHeight / f.height, 1);
      canvas.style.width = `${f.width * scale}px`;
      canvas.style.height = `${f.height * scale}px`;
      camera.aspect = f.width / f.height;
    }
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  let badgeTimer;
  function showBadge(text) {
    badge.textContent = text;
    badge.classList.add("show");
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge.classList.remove("show"), 1400);
  }

  // --- Screenshot (Taste S) ---
  // Erst NACH dem Rendern im selben Frame lesen, sonst ist der Canvas leer.
  let screenshotRequested = false;
  function saveScreenshot() {
    canvas.toBlob((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `teppich-${field.variant}-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    }, "image/png");
    showBadge("PNG gespeichert");
  }

  // --- Tasten ---
  window.addEventListener("keydown", (event) => {
    if (event.target.closest?.(".lil-gui")) return; // Tippen im Panel ignorieren
    const key = event.key.toLowerCase();

    if (key === "m") showBadge(actions.nextVariant());
    if (key === "b") showBadge(actions.nextLook());
    if (key === "f") {
      formatIndex = (formatIndex + 1) % FORMATS.length;
      resize();
      showBadge(FORMATS[formatIndex].name);
    }
    if (key === "a") {
      const on = autopilot.toggle();
      controls.autoRotate = on;
      showBadge(on ? "Autopilot an" : "Autopilot aus");
    }
    if (key === "h") {
      const clean = document.body.classList.toggle("clean");
      gui.show(!clean);
    }
    if (key === "s") screenshotRequested = true;
  });

  // --- Anzeige: FPS + Draw Calls ---
  const fmt = new Intl.NumberFormat("de-DE");
  const backend = renderer.backend.isWebGPUBackend ? "WebGPU" : "WebGL2";
  let fps = 60;
  let hudTimer = 0;

  function afterRender(delta) {
    if (screenshotRequested) {
      screenshotRequested = false;
      saveScreenshot();
    }

    // renderer.info zählt alle Draw Calls dieses Frames (Szene, Schatten,
    // Bloom-Pässe). Das Feld zählt seine eigenen über onBeforeRender.
    const fieldCalls = field.takeDrawCalls();
    fps += (1 / Math.max(delta, 1e-4) - fps) * 0.05;
    hudTimer += delta;
    if (hudTimer < 0.25) return; // Text nur 4× pro Sekunde neu setzen
    hudTimer = 0;

    const passes = fieldCalls > 1 ? "Bild + Schatten" : "Bild";
    hud.innerHTML =
      `<b>${Math.round(fps)}</b> fps · ${backend}<br>` +
      `<b>${fmt.format(field.count)}</b> Objekte · <b>${fieldCalls}</b> Draw Call${fieldCalls === 1 ? "" : "s"} (${passes})<br>` +
      `<span>Frame gesamt ${renderer.info.render.drawCalls} Draw Calls (inkl. Boden &amp; Bloom)</span>`;
  }

  return { resize, afterRender, showBadge };
}
