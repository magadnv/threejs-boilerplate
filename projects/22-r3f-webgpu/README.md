# 22 · R3F × WebGPU

Die Scroll-Story aus Studie 20 in drei Kapiteln, diesmal mit React Three Fiber, `WebGPURenderer` und TSL.
Ein atmender Kern zerfällt in Splitter, die Kamera fliegt hindurch, und die Splitter setzen sich zum Siegel zusammen.

## Aufsetzen

```bash
cd ~/dev/threejs/projects/22-r3f-webgpu
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build → dist/
```

So wurde das Projekt von Null angelegt (alle Versionen fest gepinnt):

```bash
npm create vite@latest 22-r3f-webgpu -- --template react-ts
cd 22-r3f-webgpu
npm install --save-exact three@0.186.1 @react-three/fiber@9.8.2 @react-three/drei@10.7.9 \
  gsap@3.15.0 @gsap/react@2.1.2 leva@0.10.1 maath@0.10.8 react@19.3.1 react-dom@19.3.1
npm install --save-exact -D @types/three@0.186.0
```

Kompatibilität: R3F 9 braucht React 19 (`>=19 <19.4`) und three `>=0.156`. drei 10 braucht R3F 9.
**r3f-perf ist absichtlich nicht dabei**, weil es intern `gl.getContext()` und WebGL-Timer-Extensions aufruft. Mit dem `WebGPURenderer` stürzt es ab. Ersatz ist `<PerfHud />`.

## Tasten

| Taste | Was passiert |
| --- | --- |
| H | Leva, Perf-Anzeige und Hinweise aus- und einblenden |
| S | PNG des Canvas speichern (nur WebGPU-Bild, ohne HTML-Texte) |
| A | Auto-Scroll von oben nach unten in 15 s (nochmal A = Stopp) |
| F | Format: Vollbild → 1:1 (1080×1080) → 16:9 (1920×1080) |

## Dateien

```
src/
  three-setup.ts        extend(), async WebGPU-Factory, WebGPU-Check
  story.ts              Drehbuch: scroll offset → dissolve/scatter/form/warm/…
  path.ts               Kamerapfad (CatmullRom) + Siegel-Position
  seal.ts               Siegel-SVG zu Zielpunkten abtasten
  App.tsx               Bühne, <Canvas gl={factory}>, Tasten, Leva
  components/
    Experience.tsx      Szenengraph: ScrollControls + alle Teile
    Director.tsx        useFrame(-1): schreibt den Fortschritt ins story-Objekt
    GlowObject.tsx      TSL: atmendes Displacement + Fresnel-Glow
    InstanceField.tsx   InstancedMesh, Positionen komplett im Vertex-Shader
    CameraRig.tsx       Pfad + maath-Damping + Maus-Parallaxe
    Lights.tsx          kühl → warm, Environment
    Effects.tsx         RenderPipeline: bloom() + Vignette, useFrame(…, 1)
    StoryText.tsx       <Scroll html> + SplitText-Timelines am Scroll-Offset
    Recorder.tsx        Screenshot, Auto-Scroll, Export-Auflösung
    PerfHud.tsx         FPS · Draw Calls · Dreiecke · Backend
```

## Die vier Kernfragen

**Wie funktioniert die WebGPU-Factory?** `gl` nimmt eine (async) Funktion. R3F wartet auf das Promise, also auf `await renderer.init()`, und startet erst dann den Render-Loop. Ohne WebGPU setzt `forceWebGL` auf WebGL2 um. Der TSL-Code bleibt gleich.

**Warum kein setState in useFrame?** useFrame läuft 60- bis 120-mal pro Sekunde außerhalb von React. Jedes setState würde einen kompletten React-Render auslösen. Darum mutieren wir direkt `uniform.value`, `camera.position` oder `textContent`. React-State gibt es nur für seltene Dinge wie eine gedrückte Taste.

**Wie lebt ein TSL-uniform in React?** Es wird einmal per `useMemo(() => uniform(0), [])` erzeugt und bleibt dasselbe Objekt, sonst würde der Shader neu kompiliert. Pro Frame wird `.value` in useFrame gesetzt, bei Leva-Änderungen in useEffect.

**Was macht extend()?** Es trägt die Klassen aus `three/webgpu` in R3Fs JSX-Katalog ein. Danach ist `<meshStandardNodeMaterial colorNode={…} />` ein normales Element.

## Was ich anders gemacht habe als im Briefing

- **`bloom()`** liegt nicht in `three/tsl`, sondern in `three/addons/tsl/display/BloomNode.js`. Es ist aber ein normaler TSL-Node.
- **Keine drei `<Instances>`.** Dort schreibt die CPU jede Instanz-Matrix pro Frame neu. Hier rechnet der Vertex-Shader alle Positionen, und die CPU setzt pro Frame nur zwei Zahlen.
- **Kein StrictMode.** drei `<Scroll html>` legt seine React-Root in useMemo an. StrictMode erzeugt sie doppelt, und die Texte gehen verloren.
- **Formatwechsel:** Ändert sich die Canvas-Größe, hängt R3F die Events wieder an den Container. Dann reagiert ScrollControls nicht mehr. `<KeepScrollConnected />` verbindet sie wieder.

## Vanilla Three.js + GSAP vs. R3F – wann nehme ich was?

1. **Kundenprojekte:** Ist die Seite schon React oder Next.js, nehme ich R3F, weil sich 3D dann wie jede andere Komponente einbauen lässt. Bei einem freien Award-Showpiece mit einer einzigen großen Szene nehme ich Vanilla. Das ist weniger Schicht, und Lenis, ScrollTrigger und Seitenübergänge sind direkter steuerbar.
2. **Performance:** Auf der GPU gibt es keinen Unterschied, Shader und Draw Calls sind identisch. R3F kostet etwas CPU für Reconciler und Bundle, das sind hier gut 2 MB statt ~1 MB. Kritisch wird es nur, wenn man React-State pro Frame benutzt.
3. **Wartbarkeit:** Bei R3F hat jede Komponente ihre eigenen Ressourcen und räumt sie beim Unmount auf, und Hot Reload hält den Zustand. Bei Vanilla schreibe ich `dispose()`, Resize und Loop selbst. Das ist bei einer Szene übersichtlich, bei zehn Szenen verliert man den Überblick.
4. **Lernkurve:** Vanilla zeigt, was wirklich passiert. R3F setzt dieses Wissen voraus und fügt eigene Fallen hinzu: Render-Prioritäten, eine zweite React-Root bei `<Scroll html>`, StrictMode, Typen bei extend(). Erst Vanilla lernen, dann R3F.
5. **Teamarbeit:** Mit React-Devs ist R3F klar besser, weil sie Props, Hooks und Komponenten sofort lesen können und Leva oder drei viel Arbeit abnehmen. Arbeitet ein Creative Dev allein, ist Vanilla schneller.
6. **Neue Technik (WebGPU, TSL):** Vanilla bekommt sie zuerst und ohne Umwege. R3F zieht nach, braucht aber Casts und Workarounds (Typen, r3f-perf, Events).

## Drei Ideen zum Weiterbauen

1. **TSL Compute statt Vertex-Mix:** Die Splitter mit einem Compute-Shader per Curl-Noise treiben lassen (wie Studie 21) und `form` als Anziehungskraft zum Siegel nutzen. Dann wird aus dem Ablauf eine lebendige Simulation.
2. **Maus als Kraft im Tunnel:** Splitter in der Nähe des Cursors weichen aus, langes Halten zieht sie zusammen. Das wäre eine Entdeckung, die sich nur beim Spielen zeigt.
3. **Gleicher Clip, zwei Renderer:** Studie 20 und 22 nebeneinander mit identischem Auto-Scroll aufnehmen, mit FPS und Bundle-Größe im Bild. Das ist der X-Post zum Vergleich.
