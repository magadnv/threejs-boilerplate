// ============================================================
// THREE-SETUP – WebGPU-Renderer-Factory + extend()
// ============================================================

import * as THREE from 'three/webgpu'
import type { WebGLRenderer } from 'three'
import { extend, type ThreeToJSXElements } from '@react-three/fiber'

// ------------------------------------------------------------
// Was macht extend()?
// R3F kennt von Haus aus nur die Klassen aus 'three' (WebGL-Build).
// JSX wie <meshStandardNodeMaterial /> heißt für R3F: „suche die Klasse
// MeshStandardNodeMaterial in meinem Katalog und rufe new auf“.
// extend() trägt alle Klassen aus 'three/webgpu' in diesen Katalog ein –
// danach sind die Node-Materialien ganz normale JSX-Elemente, und Props
// wie colorNode={…} werden einfach als Property gesetzt.
// ------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
extend(THREE as any)

// Damit TypeScript die neuen JSX-Elemente samt Props kennt. (Alle auf einmal
// per „extends“ kollidiert bei <audio>, <line> … mit HTML – also gezielt.)
type WebGPUElements = ThreeToJSXElements<typeof THREE>
declare module '@react-three/fiber' {
  interface ThreeElements {
    meshStandardNodeMaterial: WebGPUElements['meshStandardNodeMaterial']
    meshBasicNodeMaterial: WebGPUElements['meshBasicNodeMaterial']
    meshPhysicalNodeMaterial: WebGPUElements['meshPhysicalNodeMaterial']
  }
}

// Hat der Browser WebGPU UND einen passenden Grafik-Adapter?
export async function hasWebGPU() {
  if (!navigator.gpu) return false
  try {
    return (await navigator.gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

// ------------------------------------------------------------
// Wie funktioniert die WebGPU-Factory in R3F?
// <Canvas gl={…}> nimmt statt eines Objekts auch eine Funktion. R3F ruft sie
// mit seinen Default-Props auf (canvas, antialias, powerPreference …) und
// wartet, falls sie ein Promise liefert. Erst wenn init() fertig ist – der
// GPU-Adapter also wirklich da ist – startet R3F den Render-Loop.
// Ohne await init() würde der erste Frame auf einem halb fertigen Renderer
// laufen.
//
// forceWebGL: Gibt es kein WebGPU, nimmt derselbe Renderer WebGL2. Der
// TSL-Code bleibt identisch – er wird nur in GLSL statt WGSL übersetzt.
// ------------------------------------------------------------
export async function createWebGPURenderer(props: { canvas: unknown }) {
  const renderer = new THREE.WebGPURenderer({
    canvas: props.canvas as HTMLCanvasElement,
    antialias: true,
    powerPreference: 'high-performance',
    forceWebGL: !(await hasWebGPU()),
  })
  await renderer.init()
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  // R3F nutzt seinen eigenen requestAnimationFrame, nicht renderer.setAnimationLoop –
  // also zählt der Renderer die Draw Calls nie zurück. Das machen wir selbst
  // in <Effects /> einmal pro Frame (für die Perf-Anzeige).
  renderer.info.autoReset = false

  // R3Fs Typen kennen nur den WebGLRenderer. Zur Laufzeit braucht R3F bloß
  // render(scene, camera), setSize, setPixelRatio – die hat der WebGPURenderer.
  // In den Komponenten casten wir gl darum zurück: useThree(s => s.gl) as unknown as WebGPURenderer
  return renderer as unknown as WebGLRenderer
}

// Einmal beim Laden: kleines Gerät? Wunsch nach weniger Bewegung?
export const isMobile = matchMedia('(max-width: 768px), (pointer: coarse)').matches
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

export const BG = '#060609'
