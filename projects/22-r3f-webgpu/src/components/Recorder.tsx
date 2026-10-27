// ============================================================
// Aufnahme-Helfer: Screenshot (S), Auto-Scroll (A), Export-Auflösung (F)
// ============================================================

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useScroll } from '@react-three/drei'
import gsap from 'gsap'

export type Format = 'full' | 'square' | 'wide'

// S → PNG. Bei WebGPU ist der Canvas-Inhalt nur bis zum Ende des Frames
// gültig. Darum: Taste merkt sich nur den Wunsch, gespeichert wird in einem
// useFrame mit Priorität 2 – direkt NACH dem Render in <Effects /> (Priorität 1).
export function Screenshot({ format }: { format: Format }) {
  const gl = useThree((s) => s.gl)
  const wanted = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) wanted.current = true
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  useFrame(() => {
    if (!wanted.current) return
    wanted.current = false
    gl.domElement.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `r3f-webgpu-${format}-${Date.now()}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }, 'image/png')
  }, 2)

  return null
}

// A → einmal von oben nach unten in 15 s (nochmal A = Stopp)
export function AutoScroll() {
  const scroll = useScroll()

  useEffect(() => {
    let tween: gsap.core.Tween | null = null
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'a' || e.metaKey || e.ctrlKey) return
      const el = scroll.el
      if (tween?.isActive()) return void tween.kill()
      el.scrollTop = 0
      tween = gsap.to(el, {
        scrollTop: el.scrollHeight - el.clientHeight,
        duration: 15,
        delay: 0.6, // kurz stehen lassen, damit der Clip ruhig beginnt
        ease: 'sine.inOut',
      })
    }
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
      tween?.kill()
    }
  }, [scroll])

  return null
}

// In den Formaten 1:1 und 16:9 rechnet der Canvas exakt 1080 px hoch –
// egal wie groß er auf dem Bildschirm ist. Screenshots sind dann 1080×1080
// bzw. 1920×1080, direkt fertig für X. (Die Bühnenhöhe kommt aus dem CSS.)
export function exportDpr(format: Format): number | [number, number] {
  if (format === 'full') return [1, 2]
  const h = format === 'square' ? Math.min(innerWidth, innerHeight) : Math.min(innerHeight, (innerWidth * 9) / 16)
  return 1080 / h
}

// Fix für den Formatwechsel: Ändert sich die Canvas-Größe, hängt R3F seine
// Events wieder an den Canvas-Container – drei ScrollControls hört dann nicht
// mehr auf den Scroll. Wir verbinden die Events zurück mit dem Scroll-Element.
export function KeepScrollConnected() {
  const scroll = useScroll()
  const events = useThree((s) => s.events)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  useEffect(() => {
    if (events.connected !== scroll.el) events.connect?.(scroll.el)
  }, [events, scroll, size, dpr])

  return null
}
