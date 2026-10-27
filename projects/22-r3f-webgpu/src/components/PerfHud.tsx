// ============================================================
// <PerfHud /> – FPS, Draw Calls, Dreiecke, Backend
// ============================================================
// Warum nicht r3f-perf? Es fragt intern gl.getContext() und WebGL-Timer-
// Extensions ab – die gibt es beim WebGPURenderer nicht, es stürzt ab.
// Diese Anzeige schreibt direkt per textContent in ein DOM-Element:
// kein React-State, also kein Re-Render pro Frame.

import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, type RefObject } from 'react'
import type * as THREE from 'three/webgpu'

export function PerfHud({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer
  const backend = (gl.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2'
  const acc = useMemo(() => ({ frames: 0, time: 0 }), [])

  // Priorität 3: nach dem Render, damit die Zähler den ganzen Frame enthalten
  useFrame((_, delta) => {
    acc.frames++
    acc.time += delta
    if (acc.time < 0.5 || !target.current) return
    const fps = Math.round(acc.frames / acc.time)
    const { drawCalls, triangles } = gl.info.render
    target.current.textContent = `${fps} fps · ${drawCalls} calls · ${(triangles / 1000).toFixed(0)}k tris · ${backend}`
    acc.frames = 0
    acc.time = 0
  }, 3)

  return null
}
