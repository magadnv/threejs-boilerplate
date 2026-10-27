import * as THREE from "three";
import gsap from "gsap";
import GUI from "lil-gui";
import { createScene } from "./scene.js";
import { Interaction, physics } from "./interaction.js";
import { GiAudio } from "./audio.js";

// Schwache Geräte: weniger Unterteilung, kein MSAA, Pixelratio 1
const coarse = matchMedia("(pointer: coarse)").matches;
const low = (navigator.hardwareConcurrency || 8) <= 4 || (coarse && Math.min(screen.width, screen.height) < 520);

const canvas = document.getElementById("scene");
const wordEl = document.getElementById("word");
const ctx = createScene(canvas, { low });
const audio = new GiAudio();

function showWord(text, hold) {
  gsap.timeline()
    .to(wordEl, { opacity: 0, duration: 0.25 })
    .call(() => (wordEl.textContent = text))
    .to(wordEl, { opacity: text === "GRIP" ? 0.5 : 0.9, duration: 0.5 })
    .to(wordEl, { opacity: 0, duration: 0.4, delay: hold })
    .call(() => (wordEl.textContent = "GRIP"))
    .to(wordEl, { opacity: 0.5, duration: 0.8 });
}

const interaction = new Interaction(ctx, { audio, onWord: showWord });
canvas.addEventListener("pointerdown", () => canvas.classList.add("is-gripping"));
window.addEventListener("pointerup", () => canvas.classList.remove("is-gripping"));

window.addEventListener("resize", ctx.resize);
ctx.resize();

// --- Auftritt: Licht kommt aus der Dunkelheit, dann greift eine unsichtbare Hand zu
const intro = { light: 0 };
gsap.to(ctx.renderer, { toneMappingExposure: 1.0, duration: 2.6, ease: "power2.out" });
gsap.to(intro, { light: 1, duration: 2.2, ease: "power3.out", onUpdate: () => ctx.applyLight(intro.light) });
gsap.to(wordEl, { opacity: 0.5, duration: 1.4, delay: 2.4 });
interaction.ghostGrip(1.1);

// --- Feintuning (H) ---------------------------------------------------------
const gui = new GUI({ title: "Kragen" });
gui.hide();
const u = ctx.uniforms;
const fStoff = gui.addFolder("Stoff");
fStoff.add(u.uStiff, "value", 0.5, 2.0, 0.01).name("Steifigkeit");
fStoff.add(u.uFoldDepth, "value", 0.0, 0.6, 0.01).name("Faltentiefe (cm)");
fStoff.add(u.uFoldCount, "value", 3, 14, 1).name("Faltenzahl");
fStoff.add(u.uWeave, "value", 0, 2, 0.01).name("Webrelief");
fStoff.add(u.uWear, "value", 0, 1, 0.01).name("Abnutzung");
const fPhys = gui.addFolder("Feder");
fPhys.add(physics, "gripStiffness", 50, 600, 1).name("Zupacken k");
fPhys.add(physics, "releaseStiffness", 10, 300, 1).name("Rückfedern k");
fPhys.add(physics, "releaseDamping", 0.05, 1.2, 0.01).name("Rückfedern ζ");
fPhys.add(physics, "maxPull", 0.5, 8, 0.1).name("max. Zug (cm)");
fPhys.add(physics, "memoryDecay", 0.3, 10, 0.1).name("Erinnerung (s)");
const fLicht = gui.addFolder("Licht");
fLicht.add(ctx.light, "azimuth", -180, 180, 1).name("Rim Azimut").onChange(() => ctx.applyLight());
fLicht.add(ctx.light, "elevation", -80, 80, 1).name("Rim Elevation").onChange(() => ctx.applyLight());
fLicht.add(ctx.light, "rimIntensity", 0, 15, 0.1).name("Rim").onChange(() => ctx.applyLight());
fLicht.add(ctx.light, "fillIntensity", 0, 1, 0.01).name("Fill").onChange(() => ctx.applyLight());
const fPost = gui.addFolder("Post");
fPost.add(ctx.dof, "aperture", 0, 0.006, 0.0001).name("Blende");
fPost.add(ctx.dof, "maxblur", 0, 0.03, 0.001).name("max. Unschärfe");
fPost.add(ctx.bloom, "strength", 0, 1.5, 0.01).name("Bloom");
fPost.add(ctx.finish.uniforms.uGrain, "value", 0, 0.2, 0.001).name("Korn");
fPost.add(ctx.finish.uniforms.uVignette, "value", 0, 2, 0.01).name("Vignette");
fPost.close();
window.addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") gui._hidden ? gui.show() : gui.hide();
});

// --- Loop ------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);
const tmp = new THREE.Vector3();
let frames = 0, acc = 0, slow = 0;

function tick(now) {
  if (window.kragen?.paused) return requestAnimationFrame(tick);
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 1 / 20);
  const t = timer.getElapsed();
  u.uTime.value = t;

  interaction.update(dt, t);
  ctx.dust.update(dt, t);
  ctx.dust.material.uniforms.uLightDir.value.copy(ctx.rimDir);

  // Kamera: Makro aus der Hand, minimal atmend, plus Shake
  const cam = ctx.camera, s = interaction.shake;
  cam.position.copy(ctx.camBase);
  cam.position.x += Math.sin(t * 0.31) * 0.12 + s.x;
  cam.position.y += Math.sin(t * 0.23 + 1.3) * 0.09 + s.y;
  cam.lookAt(ctx.camTarget);
  cam.rotateZ(s.r);

  // Schärfe folgt dem Griffpunkt
  const want = tmp.copy(interaction.focusPoint).applyMatrix4(cam.matrixWorldInverse).z * -1;
  interaction.focusDist += (want - interaction.focusDist) * (1 - Math.exp(-dt * 6));
  const bu = ctx.bokeh.uniforms; // eigener DOF-Pass (dof.js)
  bu.focus.value = interaction.focusDist;
  bu.aperture.value = ctx.dof.aperture;
  bu.maxblur.value = ctx.dof.maxblur;
  ctx.finish.uniforms.uTime.value = t;

  ctx.composer.render(dt);

  // Adaptiv: wenn es ruckelt, Pixelratio senken
  // (erst nach dem Auftritt messen, Shader-Kompilierung verfälscht sonst)
  if (t > 4) {
    frames++; acc += dt;
    if (acc > 2) {
      const fps = frames / acc;
      slow = fps < 48 ? slow + 1 : 0;
      if (slow >= 2 && ctx.dpr > 1) { ctx.setDpr(Math.max(1, ctx.dpr - 0.25)); slow = 0; }
      frames = 0; acc = 0;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Für die Konsole
window.kragen = { ctx, interaction, physics };
