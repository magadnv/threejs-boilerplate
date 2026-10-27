// ============================================================
// TRAILS – Feedback-Spuren per Ping-Pong-RenderTarget
// ============================================================
// Wie entstehen aus Punkten seidige Linien?
//   Wir löschen das Bild NICHT jeden Frame. Stattdessen:
//     neuesBild = altesBild × fade + Partikel dieses Frames
//   fade < 1 dunkelt das Alte ein wenig ab. Ein Partikel, der sich bewegt,
//   hinterlässt so eine Spur, die langsam verblasst – wie Belichtung auf Film.
//   Viele dünne Spuren übereinander ergeben die Seide.
//
// Warum zwei RenderTargets (Ping-Pong)?
//   Eine Textur kann nicht gleichzeitig gelesen und beschrieben werden.
//   Also: aus A lesen, in B schreiben – nächsten Frame umgekehrt.
//
//   Frame n:   [read A] × fade + [frame] ──► [write B] ──► Bildschirm
//   Frame n+1: [read B] × fade + [frame] ──► [write A] ──► Bildschirm
//
// Halbe Gleitkommazahlen (HalfFloat), damit sich Licht über 1.0 sammeln
// darf. Erst die Komposition am Ende bringt es auf Bildschirm-Werte.

import * as THREE from "three/webgpu";
import { texture, uniform, vec4, exp, mix } from "three/tsl";
// bloom() liegt bei den Addons, nicht direkt in three/tsl
import { bloom } from "three/addons/tsl/display/BloomNode.js";

export function createTrails(renderer, scene, camera, { paper }) {
  const rtOptions = { type: THREE.HalfFloatType, depthBuffer: false };
  const frame = new THREE.RenderTarget(1, 1, rtOptions); // nur die Partikel dieses Frames
  let read = new THREE.RenderTarget(1, 1, rtOptions);
  let write = new THREE.RenderTarget(1, 1, rtOptions);

  const settings = { enabled: true, length: 1.4 }; // Spurlänge in Sekunden
  const uniforms = {
    fade: uniform(0),
    bloom: uniform(0.35),
    exposure: uniform(1),
    night: uniform(new THREE.Color("#050507")),
    paper: uniform(new THREE.Color("#f1ece2")),
  };

  // ----------------------------------------------------------
  // 1 · Feedback-Material: altes Bild × fade + neue Partikel
  // ----------------------------------------------------------
  const previous = texture(read.texture);
  const current = texture(frame.texture);
  const feedback = new THREE.NodeMaterial();
  feedback.fragmentNode = vec4(previous.rgb.mul(uniforms.fade).add(current.rgb), 1);
  const quad = new THREE.QuadMesh(feedback);

  // ----------------------------------------------------------
  // 2 · Komposition: Licht → Bild, mit dezentem Bloom
  // ----------------------------------------------------------
  // Der Puffer enthält „gesammeltes Licht“ (oder auf Papier: „gesammelte Tinte“).
  //   Nacht:  Hintergrund + (1 − e^(−Licht))   → hell, aber nie hart weiß
  //   Papier: Papier × e^(−Tinte)              → wie Tinte, die Licht schluckt
  // Beide Kurven laufen weich in die Sättigung – darum wirken dichte
  // Stellen samtig statt ausgebrannt. Zwischen beiden blendet `paper`.
  const accumulated = texture(write.texture);
  const glow = bloom(accumulated, uniforms.bloom, 0.6, 0.35);
  const amount = accumulated.rgb.add(glow.rgb).mul(uniforms.exposure);
  const night = uniforms.night.add(exp(amount.negate()).oneMinus());
  const day = uniforms.paper.mul(exp(amount.negate()));

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = vec4(mix(night, day, paper), 1);

  // ----------------------------------------------------------
  // Pro Frame
  // ----------------------------------------------------------
  const size = new THREE.Vector2();
  let clearNext = true;

  function render(delta) {
    renderer.getDrawingBufferSize(size);
    if (size.x !== frame.width || size.y !== frame.height) {
      frame.setSize(size.x, size.y);
      read.setSize(size.x, size.y);
      write.setSize(size.x, size.y);
      clearNext = true;
    }

    // Spurlänge in Sekunden → fade pro Frame. exp(−Δt/Länge) sorgt dafür,
    // dass die Spur bei 60 und 120 Hz gleich lang ist.
    // Ohne Trails ist fade = 0: dann bleibt nur der aktuelle Frame.
    uniforms.fade.value = settings.enabled && !clearNext ? Math.exp(-delta / settings.length) : 0;
    clearNext = false;

    // a) Partikel allein in `frame` – transparent schwarz gelöscht
    renderer.setRenderTarget(frame);
    renderer.render(scene, camera);

    // b) altes Bild abdunkeln + neuen Frame drauf → in `write`
    previous.value = read.texture;
    renderer.setRenderTarget(write);
    quad.render(renderer);

    // c) Ergebnis mit Bloom auf den Bildschirm
    renderer.setRenderTarget(null);
    accumulated.value = write.texture;
    pipeline.render();

    // d) Ping-Pong: was gerade geschrieben wurde, wird nächsten Frame gelesen
    [read, write] = [write, read];
  }

  return {
    settings,
    uniforms,
    render,
    clear: () => (clearNext = true),
    dispose() {
      frame.dispose();
      read.dispose();
      write.dispose();
      feedback.dispose();
      pipeline.dispose();
    },
  };
}
