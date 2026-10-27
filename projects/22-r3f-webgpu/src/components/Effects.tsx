// ============================================================
// <Effects /> – Post-Processing als TSL-Node-Graph
// ============================================================
//   scenePass → + Bloom (HDR) → Tone Mapping/sRGB → Vignette
//
// Hinweis: bloom() liegt nicht direkt in 'three/tsl', sondern bei den
// Addons (three/addons/tsl/display/BloomNode.js) – es ist aber ein ganz
// normaler TSL-Node und hängt sich so in den Graphen ein.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls, folder } from 'leva'
import * as THREE from 'three/webgpu'
import { pass, renderOutput, uniform, uv, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { vignette } from 'three/addons/tsl/display/CRT.js'

export function Effects() {
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const { strength, radius, threshold, vignetteAmount } = useControls({
    Bloom: folder({
      strength: { value: 0.75, min: 0, max: 3, step: 0.01 },
      radius: { value: 0.55, min: 0, max: 1, step: 0.01 },
      threshold: { value: 0.4, min: 0, max: 1.5, step: 0.01 },
      vignetteAmount: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'vignette' },
    }),
  })

  // Uniforms leben für immer (useMemo), die Pipeline pro Renderer/Szene/Kamera
  const u = useMemo(
    () => ({ strength: uniform(0.75), radius: uniform(0.55), threshold: uniform(0.4), vignette: uniform(0.45) }),
    [],
  )
  const pipeline = useRef<THREE.RenderPipeline | null>(null)

  // Die Pipeline entsteht im useEffect statt in useMemo: so gehören Bauen
  // und dispose() zusammen – auch wenn React (StrictMode) Effekte doppelt fährt
  useEffect(() => {
    const p = new THREE.RenderPipeline(gl)
    // Tone Mapping machen wir selbst (renderOutput) – Bloom braucht davor echte HDR-Werte
    p.outputColorTransform = false

    const color = pass(scene, camera).getTextureNode('output')
    const glow = bloom(color, u.strength, u.radius, u.threshold)
    const mapped = renderOutput(color.add(glow))
    p.outputNode = vec4(vignette(mapped.rgb, u.vignette, uniform(0.55), uv()), 1)

    pipeline.current = p
    return () => {
      pipeline.current = null
      p.dispose()
    }
  }, [gl, scene, camera, u])

  useEffect(() => {
    u.strength.value = strength
    u.radius.value = radius
    u.threshold.value = threshold
    u.vignette.value = vignetteAmount
  }, [u, strength, radius, threshold, vignetteAmount])

  // ----------------------------------------------------------
  // Render-Priorität: Jedes useFrame mit Priorität > 0 schaltet R3Fs
  // eigenes gl.render(scene, camera) ab – ab jetzt rendern WIR.
  // Kleinere Zahlen laufen zuerst: Animationen (Priorität 0 oder negativ)
  // sind also schon fertig, wenn hier gerendert wird.
  // ----------------------------------------------------------
  useFrame(() => {
    gl.info.reset() // Zähler für die Perf-Anzeige (siehe three-setup.ts)
    pipeline.current?.render()
  }, 1)

  return null
}
