// ============================================================
// <App /> – Bühne, Canvas, Tasten, Leva
// ============================================================

import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Leva } from 'leva'
import { createWebGPURenderer } from './three-setup'
import { Experience } from './components/Experience'
import { exportDpr, type Format } from './components/Recorder'

const FORMATS: Format[] = ['full', 'square', 'wide']
const FORMAT_LABEL: Record<Format, string> = { full: 'Full', square: '1:1 · 1080²', wide: '16:9 · 1920×1080' }

export function App() {
  const [ui, setUi] = useState(true) // H: Leva + Perf + Hinweise
  const [format, setFormat] = useState<Format>('full') // F: Bildformat
  const [backend, setBackend] = useState<'webgpu' | 'webgl' | null>(null)
  const perf = useRef<HTMLDivElement>(null)
  const [dpr, setDpr] = useState(() => exportDpr('full'))

  // Pixel-Dichte passend zum Format – neu bei Formatwechsel und Fenstergröße
  useEffect(() => {
    const update = () => setDpr(exportDpr(format))
    update()
    addEventListener('resize', update)
    return () => removeEventListener('resize', update)
  }, [format])

  // React-State nur für Dinge, die selten passieren (Taste gedrückt) –
  // nie für Werte, die sich pro Frame ändern
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'h') setUi((v) => !v)
      if (k === 'f') setFormat((f) => FORMATS[(FORMATS.indexOf(f) + 1) % FORMATS.length])
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`stage stage--${format}`}>
      <Canvas
        // Die async Factory: R3F wartet auf init(), dann startet der Loop
        gl={createWebGPURenderer}
        camera={{ position: [0, 0, 6.5], fov: 40, near: 0.05, far: 120 }}
        dpr={dpr}
        onCreated={({ gl }) =>
          setBackend((gl as unknown as { backend: { isWebGPUBackend?: boolean } }).backend.isWebGPUBackend ? 'webgpu' : 'webgl')
        }
      >
        <Suspense fallback={null}>
          <Experience format={format} perfTarget={perf} />
        </Suspense>
      </Canvas>

      <header className="brand">
        <span className="brand__mark">madebymaga</span>
        <span className="brand__meta">Studie N° 22 — R3F × WebGPU</span>
      </header>

      {ui && (
        <>
          <div className="perf" ref={perf}>
            …
          </div>
          <div className="keys">
            H Hide · S Shot · A Auto · F {FORMAT_LABEL[format]}
          </div>
          {backend === 'webgl' && (
            <div className="fallback" role="status">
              WebGPU ist hier nicht verfügbar – die Szene läuft über den WebGL2-Fallback. Gleicher TSL-Code, nur als GLSL übersetzt.
            </div>
          )}
        </>
      )}

      <Leva hidden={!ui} collapsed titleBar={{ title: 'Studie 22' }} />
    </div>
  )
}
