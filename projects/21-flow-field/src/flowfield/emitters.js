// ============================================================
// EMITTER – wo abgelaufene Partikel neu geboren werden
// ============================================================
// Die Form entscheidet die GPU pro Partikel selbst (TSL If/ElseIf).
// Umschalten = eine Zahl im uniform ändern, kein Shader-Neubau.

import { Fn, If, uint, vec3, hash, sin, cos, acos, sqrt, PI2 } from "three/tsl";

export const EMITTERS = { Kugel: 0, Ring: 1, Linie: 2, Text: 3 };

// So viele Punkte tasten wir aus dem Text ab – die Partikel wählen zufällig einen davon
export const TEXT_POINTS = 32768;

// ------------------------------------------------------------
// Text → Punktwolke (läuft einmal auf der CPU)
// ------------------------------------------------------------
// Text auf ein unsichtbares 2D-Canvas schreiben, jedes deckende Pixel ist ein
// möglicher Geburtsort. Rückgabe als vec4 pro Punkt (xyz + 1 Füllwert),
// weil vec4 im GPU-Speicher ohne Ausrichtungs-Lücken liegt.
export function sampleText(text, { width = 5, font = "italic 400 220px 'Instrument Serif', Georgia, serif" } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.font = font;
  const metrics = ctx.measureText(text);
  canvas.width = Math.ceil(metrics.width) + 40;
  canvas.height = 300;

  ctx.font = font; // nach dem Größenwechsel ist der Kontext zurückgesetzt
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = [];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 128) pixels.push(x, y);
    }
  }

  const scale = width / canvas.width;
  const out = new Float32Array(TEXT_POINTS * 4);
  const n = pixels.length / 2;

  for (let i = 0; i < TEXT_POINTS; i++) {
    const j = Math.floor(Math.random() * n) * 2;
    // Pixel → Welt: Mitte auf 0, y nach oben, leicht verwackelt gegen Pixel-Raster
    out[i * 4 + 0] = (pixels[j] - canvas.width / 2 + Math.random()) * scale;
    out[i * 4 + 1] = (canvas.height / 2 - pixels[j + 1] + Math.random()) * scale;
    out[i * 4 + 2] = (Math.random() - 0.5) * 0.08;
    out[i * 4 + 3] = 1;
  }
  return out;
}

// ------------------------------------------------------------
// Geburtsort auf der GPU
// ------------------------------------------------------------
// seed: eine uint, die für jeden Partikel UND jede Wiedergeburt anders ist.
// hash() macht daraus reproduzierbaren Zufall 0…1.
export const createSpawn = ({ emitter, radius, textPoints }) =>
  Fn(([seed]) => {
    // .toVar(): einmal oben deklarieren. Sonst legt TSL die Werte im ersten
    // If-Zweig an, der sie benutzt – und die anderen Zweige sehen Unsinn.
    const r1 = hash(seed).toVar();
    const r2 = hash(seed.add(7919)).toVar();
    const r3 = hash(seed.add(104729)).toVar();
    const out = vec3(0).toVar();

    If(emitter.lessThan(0.5), () => {
      // Kugel: gleichmäßig verteilte Richtung, dünne Schale statt voller Kugel –
      // so sieht man beim Ausströmen die Form
      const theta = r1.mul(PI2);
      const phi = acos(r2.mul(2).sub(1));
      const dir = vec3(sin(phi).mul(cos(theta)), cos(phi), sin(phi).mul(sin(theta)));
      out.assign(dir.mul(radius.mul(r3.mul(0.12).add(0.88))));
    })
      .ElseIf(emitter.lessThan(1.5), () => {
        // Ring in der Bildebene, mit etwas Dicke (sqrt: gleichmäßig im Querschnitt)
        const angle = r1.mul(PI2);
        const spread = sqrt(r2).mul(0.12).mul(radius);
        const tube = r3.mul(PI2);
        const ring = radius.add(cos(tube).mul(spread));
        out.assign(vec3(cos(angle).mul(ring), sin(angle).mul(ring), sin(tube).mul(spread)));
      })
      .ElseIf(emitter.lessThan(2.5), () => {
        // Linie: waagrecht durchs Bild, wie ein Schlitz, aus dem Rauch quillt
        out.assign(vec3(r1.sub(0.5).mul(radius.mul(3)), r2.sub(0.5).mul(0.04), r3.sub(0.5).mul(0.04)));
      })
      .Else(() => {
        // Text: einer der vorab abgetasteten Punkte. Die liegen schon in
        // zufälliger Reihenfolge im Buffer, darum reicht seed % Anzahl.
        const index = seed.mod(uint(TEXT_POINTS));
        out.assign(textPoints.element(index).xyz.mul(radius.div(2)));
      });

    return out;
  });
