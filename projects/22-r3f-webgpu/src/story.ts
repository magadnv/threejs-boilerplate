// ============================================================
// STORY – das Drehbuch: Scroll-Offset → alle Fortschritts-Werte
// ============================================================
// In der Vanilla-Version (Studie 20) gab es fünf GSAP-Timelines mit
// ScrollTrigger. Hier ist es eine reine Funktion: offset rein, Werte raus.
// <Director /> ruft sie einmal pro Frame auf und schreibt in EIN
// veränderliches Objekt. Alle Komponenten lesen daraus – ohne React-State.
//
//  offset  0 ─────────── 0.33 ─────────── 0.66 ─────────── 1
//          │ 01 Intro     │ 02 Zerfall + Flug │ 03 Siegel + CTA │

import * as THREE from 'three/webgpu'

export type Story = {
  offset: number
  dissolve: number // 0→1: das Glow-Objekt bricht auf und verschwindet
  scatter: number // 0→1: Splitter fliegen von der Kugel in den Tunnel
  form: number // 0→1: Splitter setzen sich zum Siegel zusammen
  warm: number // 0→1: Licht kühl → warm
  travel: number // 0→1: Position der Kamera auf dem Pfad
  look: number // 0→1: Blick vom Objekt nach vorn auf den Pfad
  settle: number // 0→1: Blick vom Pfad aufs Siegel
}

export const createStory = (): Story => ({
  offset: 0,
  dissolve: 0,
  scatter: 0,
  form: 0,
  warm: 0,
  travel: 0,
  look: 0,
  settle: 0,
})

// smoothstep: 0 vor a, 1 nach b, dazwischen weich
const ss = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b)

export function updateStory(s: Story, offset: number) {
  s.offset = offset
  s.dissolve = ss(0.08, 0.3, offset)
  s.scatter = ss(0.1, 0.42, offset)
  s.travel = ss(0.03, 0.9, offset)
  s.look = ss(0.12, 0.36, offset)
  s.form = ss(0.6, 0.9, offset)
  s.settle = ss(0.55, 0.85, offset)
  s.warm = ss(0.56, 0.92, offset)
}
