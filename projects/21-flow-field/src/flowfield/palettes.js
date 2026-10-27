// ============================================================
// PALETTEN – je drei Farben für einen Verlauf langsam → schnell
// ============================================================
// Auf dunklem Grund leuchten diese Farben (additiv). Auf Papier werden sie
// zu Tinte: der Shader nimmt dann ihr Gegenstück (1 − Farbe) als „was die
// Tinte vom Licht schluckt“ – übrig bleibt wieder die Farbe selbst.

export const PALETTES = [
  { name: "Tinte", colors: ["#1b2a6b", "#6f86d6", "#f4f1ea"] },
  { name: "Polarlicht", colors: ["#0b3d4f", "#19d3a2", "#c9a3ff"] },
  { name: "Feuer", colors: ["#5a0c12", "#cf1830", "#ffc27a"] },
  { name: "Ozean", colors: ["#04204a", "#1677c9", "#9ff3ff"] },
];
