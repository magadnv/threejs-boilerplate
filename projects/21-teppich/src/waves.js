// ============================================================
// WAVES – die Bewegung, komplett als TSL-Node-Graph
// ============================================================
// Alles in dieser Datei läuft im Vertex-Shader, also auf der GPU, für jede
// Instanz parallel. Die Funktionen hier rechnen NICHT sofort: jedes .mul(),
// sin(), distance() baut einen Knoten in einem Graphen. three.js übersetzt
// den Graphen einmal in WGSL (WebGPU) bzw. GLSL (WebGL2-Fallback).
//
// Eingang ist immer p = die Rasterposition der Instanz (x/z in Weltkoordinaten).
// Pro Frame ändern sich nur ein paar Uniforms (Zeit, Maus, Klicks) –
// 40.000 Instanzen rechnen daraus selbst ihre Höhe aus.

import { vec2, vec3, float, sin, exp, step, length, distance, normalize, smoothstep, mx_noise_float } from "three/tsl";

// --- 1 · Überlagerte Wellen ---
// Drei Sinuswellen + Noise ergeben zusammen ein „lebendiges“ Muster.
// Einzeln sähe jede Welle mechanisch aus, überlagert wirkt es organisch.
// Ergebnis liegt grob zwischen -1 und 1.
export function waveField(u, p) {
  const t = u.time;
  const f = u.waveFrequency;

  // a) Radiale Welle: Ringe laufen vom Zentrum nach außen
  const radial = sin(length(p).mul(f).mul(0.9).sub(t.mul(2.2)));

  // b) Zwei schräge Sinuswellen über X und Z, unterschiedlich schnell
  const alongX = sin(p.x.mul(f).mul(0.55).add(t.mul(1.3)));
  const alongZ = sin(p.y.mul(f).mul(0.4).add(p.x.mul(0.06)).sub(t.mul(0.9)));

  // c) Noise: wandert langsam durch die Zeit (3. Koordinate = Zeit)
  const noise = mx_noise_float(vec3(p.mul(f).mul(0.18), t.mul(0.22)));

  return radial.mul(0.4).add(alongX.mul(0.2)).add(alongZ.mul(0.2)).add(noise.mul(0.75));
}

// --- 2 · Maus-Einfluss ---
// 1 direkt unter der Maus, 0 ab dem Radius, dazwischen weich.
// mouseActive wird in JS weich ein- und ausgeblendet (siehe instance-field.js),
// dadurch klingt die Delle sanft ab, statt hart zu verschwinden.
export function mouseField(u, p) {
  const d = distance(p, u.mouse);
  const falloff = smoothstep(0, u.mouseRadius, d).oneMinus();
  return falloff.mul(falloff).mul(u.mouseActive).mul(u.mouseStrength);
}

// --- 3 · Schockwellen (Klick) ---
// Jeder Klick schreibt (x, z, Startzeit, Stärke) in eines von 6 vec4-Uniforms.
// Der Shader rechnet für jede Welle: Wie weit ist der Ring schon gelaufen?
// Wie weit ist diese Instanz vom Ring entfernt? → Gauß-Glocke um den Ring.
// Die JS-Schleife läuft nur EINMAL beim Bauen des Shaders: sie schreibt
// 6 Kopien der Rechnung in den Shader („Loop Unrolling“).
// Rückgabe: amount = Höhe des Rings hier, push = Richtung weg vom Klick
// (für die Grashalme, die sich vom Ring wegbiegen).
export function shockField(u, p) {
  let amount = float(0);
  let push = vec2(0, 0);

  for (const shock of u.shocks) {
    const age = u.clock.sub(shock.z).max(0);
    const radius = age.mul(u.shockSpeed);
    const away = p.sub(shock.xy);
    const x = length(away).sub(radius); // Abstand zum Ring (negativ = innen)

    const ring = exp(x.mul(x).mul(-0.3)); // Glocke, ~2 Einheiten breit
    // Kleine Nachwellen nur innen (x < 0); sin(0) = 0, also kein Sprung am Ring
    const trail = sin(x.mul(1.6)).mul(0.3).mul(smoothstep(-9, -1, x)).mul(step(x, 0));
    const fade = exp(age.mul(-0.55)).mul(shock.w); // wird mit der Zeit schwächer

    const value = ring.add(trail).mul(fade);
    amount = amount.add(value);
    push = push.add(normalize(away.add(vec2(0.0001, 0))).mul(ring.mul(fade)));
  }

  return { amount, push };
}
