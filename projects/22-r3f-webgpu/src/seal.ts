// ============================================================
// SEAL – Zielpositionen aus dem echten Siegel-SVG abtasten
// ============================================================
// Jedes deckende Pixel ist ein möglicher Platz für einen Splitter.

import { SEAL_CENTER, SEAL_SIZE } from './path'

export function sampleSeal(img: HTMLImageElement, count: number) {
  const S = 400
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, S, S)
  const data = ctx.getImageData(0, 0, S, S).data

  const pixels: number[] = []
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (data[(y * S + x) * 4 + 3] > 140) pixels.push(x, y)
    }
  }

  const out = new Float32Array(count * 3)
  const n = pixels.length / 2
  for (let i = 0; i < count; i++) {
    const j = Math.floor(Math.random() * n) * 2
    out[i * 3 + 0] = SEAL_CENTER.x + (pixels[j] / S - 0.5) * SEAL_SIZE
    out[i * 3 + 1] = SEAL_CENTER.y - (pixels[j + 1] / S - 0.5) * SEAL_SIZE
    out[i * 3 + 2] = SEAL_CENTER.z + (Math.random() - 0.5) * 0.22
  }
  return out
}
