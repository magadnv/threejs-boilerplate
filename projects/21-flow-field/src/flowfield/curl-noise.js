// ============================================================
// CURL NOISE – ein Strömungsfeld, das nirgends staut
// ============================================================
// Warum nicht einfach Noise als Geschwindigkeit nehmen?
//   Ein zufälliges Vektorfeld hat Quellen (Pfeile zeigen weg) und Senken
//   (Pfeile zeigen hin). In Senken sammeln sich die Partikel zu Klumpen,
//   um Quellen herum entstehen leere Löcher. Das sieht nach Mücken aus,
//   nicht nach Rauch.
//
// Die Idee in 2D:
//   Nimm ein Noise-Gebirge ψ(x, y). Sein Gradient ∇ψ zeigt bergauf.
//   Dreh ihn um 90°:  v = (∂ψ/∂y, −∂ψ/∂x)
//   Jetzt zeigt v ENTLANG der Höhenlinien. Partikel laufen um Berge und
//   Täler herum wie Wasser um Steine – sie steigen nie bergauf, fallen nie
//   ins Tal, also kann sich nirgends etwas sammeln.
//
// Dasselbe in 3D:
//   Statt einem Gebirge nehmen wir drei unabhängige Noise-Kanäle
//   ψ = (ψx, ψy, ψz) und bilden die Rotation (curl):
//     v = ∇ × ψ = ( ∂ψz/∂y − ∂ψy/∂z,
//                   ∂ψx/∂z − ∂ψz/∂x,
//                   ∂ψy/∂x − ∂ψx/∂y )
//
// Warum ist das divergenzfrei?
//   Divergenz = „wie viel fließt aus einem winzigen Würfel heraus“.
//   Für JEDES glatte Feld gilt die Identität  div(curl ψ) = 0 – die
//   gemischten Ableitungen heben sich paarweise auf (∂²ψz/∂x∂y − ∂²ψz/∂y∂x …).
//   Was in einen Würfel hineinfließt, fließt also wieder heraus. Genau das
//   tun echte Flüssigkeiten und Gase (inkompressibel) – deshalb wirkt
//   Curl Noise sofort wie Rauch, Tinte oder Wind: lange Stromlinien,
//   Wirbel, Falten, aber keine Klumpen.
//
// Die Ableitungen schätzen wir mit zentralen Differenzen:
//   ∂ψ/∂x ≈ (ψ(p + εx) − ψ(p − εx)) / 2ε
// Das kostet 6 Noise-Abfragen pro Partikel – auf der GPU kein Problem.

import { Fn, float, vec3, mx_noise_vec3 } from "three/tsl";

export const curlNoise = Fn(([p]) => {
  const e = float(0.05);
  const dx = vec3(e, 0, 0);
  const dy = vec3(0, e, 0);
  const dz = vec3(0, 0, e);

  // mx_noise_vec3 liefert drei Perlin-Kanäle auf einmal: (ψx, ψy, ψz)
  const px0 = mx_noise_vec3(p.sub(dx));
  const px1 = mx_noise_vec3(p.add(dx));
  const py0 = mx_noise_vec3(p.sub(dy));
  const py1 = mx_noise_vec3(p.add(dy));
  const pz0 = mx_noise_vec3(p.sub(dz));
  const pz1 = mx_noise_vec3(p.add(dz));

  // Die Formel oben, Zeile für Zeile (noch ohne / 2ε)
  const x = py1.z.sub(py0.z).sub(pz1.y.sub(pz0.y)); // ∂ψz/∂y − ∂ψy/∂z
  const y = pz1.x.sub(pz0.x).sub(px1.z.sub(px0.z)); // ∂ψx/∂z − ∂ψz/∂x
  const z = px1.y.sub(px0.y).sub(py1.x.sub(py0.x)); // ∂ψy/∂x − ∂ψx/∂y

  return vec3(x, y, z).div(e.mul(2));
});
