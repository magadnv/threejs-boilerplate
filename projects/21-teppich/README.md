# 21 · Teppich – Instancing

40.000 Säulen, Grashalme oder Kugeln in einem Draw Call. Wellen, Maus-Dellen und
Klick-Schockwellen laufen komplett im Shader (TSL), JavaScript schickt pro Frame
nur ein paar Uniforms.

## Starten

```bash
cd ~/dev/threejs/projects/21-teppich
npm install
npm run dev
```

- `http://localhost:5173/` – das Experiment
- `http://localhost:5173/scroll.html` – das Modul in einer GSAP-ScrollTrigger-Timeline

Neu aufsetzen von null (so ist der Ordner entstanden):

```bash
mkdir 21-teppich && cd 21-teppich
npm init -y
npm install --save-exact three@0.186.1 gsap@3.15.0 lil-gui@0.21.0
npm install --save-exact -D vite@8.3.5
```

## Tasten

Maus = Delle · Klick = Schockwelle · **M** Variante · **B** Look (Nacht/Modell) ·
**F** Format (Vollbild / 1:1 / 16:9) · **A** Autopilot · **S** PNG · **H** Panel aus

Für den X-Clip: `B` Look wählen, `F` auf 1:1, `H` Panel weg, `A` Autopilot,
dann mit QuickTime (⌘⇧5) den Canvas aufnehmen.

## Aufbau (`src/`)

| Datei | Inhalt |
|---|---|
| `setup.js` | WebGPURenderer, Kamera, Licht + Schatten, Boden, Bloom |
| `instance-field.js` | **das Modul** `createInstanceField(renderer, scene, options)` |
| `waves.js` | Wellen, Maus-Einfluss, Schockwellen als TSL |
| `variants.js` | Pixel-Stadt, Wiese, Kugeln |
| `interaction.js` | Raycast auf den Boden, Klick, Autopilot |
| `looks.js` | Nacht / Architekturmodell |
| `gui.js` | lil-gui |
| `controls.js` | Tasten, Formate, Screenshot, FPS + Draw Calls |
| `scroll-example.js` | Beispiel mit ScrollTrigger + scrub |

## Modul-API

```js
const field = createInstanceField(renderer, scene, {
  side: 200,              // 200² Instanzen
  extent: 40,             // Kantenlänge in Welteinheiten
  variant: "stadt",       // "stadt" | "wiese" | "kugeln"
  progressMode: "rise",   // "rise": flach → Wellen · "assemble": verstreut → Raster → Wellen
});
field.start();            // stop() friert ein, dispose() räumt auf
field.update(delta);      // jeden Frame
field.progress.value = 0; // TSL-uniform, 0 … 1
field.shock(x, z);        // Schockwelle
field.setPointer(x, z);   // Maus auf dem Boden, null = weg
field.uniforms.waveHeight.value = 6;
```

In einer Scroll-Story:

```js
gsap.timeline({ scrollTrigger: { trigger: "#story", start: "top top", end: "bottom bottom", scrub: 1 } })
  .to(field.progress, { value: 1, ease: "none" });
```

## 3 Ideen zum Weiterbauen

1. **Raster formt ein Bild:** Logo oder Typo als Textur laden, im Shader mit
   `texture(map, gridUV)` die Höhe lesen – das Siegel wächst aus dem Teppich.
2. **Audio-Visualizer:** Web Audio `AnalyserNode` → Frequenzen in eine
   `DataTexture`, radial ausgelesen: Bass im Zentrum, Höhen außen.
3. **Stadtmodell aus echten Höhen:** Gebäudehöhen aus OpenStreetMap
   (z. B. Hamburg-Speicherstadt) in eine Höhen-Textur rastern, Wellen als
   „Puls der Stadt“ darüber.
