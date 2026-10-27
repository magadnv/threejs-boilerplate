// ============================================================
// <StoryText /> – HTML-Kapitel mit SplitText, synchron zum Scroll
// ============================================================
// Zwei Welten:
//  - <Scroll html> rendert in eine EIGENE React-Root im DOM (über dem Canvas).
//    Dort gibt es kein useFrame – wohl aber useGSAP.
//  - Darum baut jedes <Chapter> nur seine pausierte GSAP-Timeline und legt
//    sie in ein gemeinsames Array. <StoryText> (im R3F-Baum) setzt pro Frame
//    tl.progress(…) aus dem Scroll-Offset. Scroll rückwärts = Animation rückwärts.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Scroll, useScroll } from '@react-three/drei'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { useGSAP } from '@gsap/react'
import { reducedMotion } from '../three-setup'

gsap.registerPlugin(SplitText, useGSAP)

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

type Timelines = (gsap.core.Timeline | undefined)[]

const CHAPTERS = [
  { eyebrow: '01 — Intro', title: 'One point.', lead: 'Everything with weight starts out small.', side: 'intro' },
  { eyebrow: '02 — Through', title: 'Comes apart.', lead: 'Look long enough and every fragment finds its own way.', side: 'right' },
  { eyebrow: '03 — madebymaga', title: 'excellence. <em>simply designed.</em>', lead: 'I bring weight to the web.', side: 'cta' },
] as const

// Jede Timeline ist genau 1 s lang: 0.05–0.35 rein · halten · 0.6–0.85 raus
function Chapter({ index, timelines }: { index: number; timelines: Timelines }) {
  const root = useRef<HTMLElement>(null)
  const c = CHAPTERS[index]
  const isLast = index === CHAPTERS.length - 1

  useGSAP(
    () => {
      const el = root.current!
      const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } })
      const title = el.querySelector('.title')!
      const rest = el.querySelectorAll('.eyebrow, .lead, .cta')

      if (reducedMotion) {
        // Nur Deckkraft, keine Bewegung
        tl.from([title, ...rest], { autoAlpha: 0, duration: 0.25, stagger: 0.03 }, 0.05)
        if (!isLast) tl.to([title, ...rest], { autoAlpha: 0, duration: 0.2 }, 0.6)
      } else {
        // mask: 'words' → jedes Wort hat eine eigene Maske, es steigt „aus dem Boden“
        const split = SplitText.create(title, { type: 'words', mask: 'words' })
        tl.from(split.words, { yPercent: 110, duration: 0.25, stagger: 0.025 }, 0.05)
          .from(rest, { autoAlpha: 0, y: 24, duration: 0.2, stagger: 0.04 }, 0.15)
        if (!isLast) {
          tl.to(split.words, { yPercent: -110, duration: 0.2, stagger: 0.015, ease: 'power2.in' }, 0.6)
            .to(rest, { autoAlpha: 0, y: -16, duration: 0.15, ease: 'power2.in' }, 0.6)
        }
      }
      tl.set({}, {}, 1) // auf genau 1 s auffüllen
      timelines[index] = tl
      return () => void (timelines[index] = undefined)
    },
    { scope: root },
  )

  return (
    <section ref={root} className={`chapter chapter--${c.side}`} style={{ top: `${index * 100}%` }}>
      <div className="copy">
        <p className="eyebrow">{c.eyebrow}</p>
        <h2 className="title" dangerouslySetInnerHTML={{ __html: c.title }} />
        <p className="lead">{c.lead}</p>
        {isLast && (
          <a className="cta" href="https://madebymaga.de" target="_blank" rel="noopener">
            Start a project <span>→</span>
          </a>
        )}
      </div>
    </section>
  )
}

export function StoryText() {
  const scroll = useScroll()
  const timelines = useMemo<Timelines>(() => [], [])
  // Beim Laden spielt das Intro einmal von selbst ein (0 → 0.5 = fertig eingeblendet)
  const intro = useMemo(() => {
    const p = { v: reducedMotion ? 0.5 : 0 }
    gsap.to(p, { v: 0.5, duration: 1.8, delay: 0.4, ease: 'power2.out' })
    return p
  }, [])

  useFrame(() => {
    const o = scroll.offset
    const last = CHAPTERS.length - 1
    timelines.forEach((tl, i) => {
      if (!tl) return
      // Kapitel i steht bei offset i/last genau in der Mitte des Bildes
      let p = clamp01((o - (i / last - 0.4)) / 0.8)
      if (i === 0 && p <= 0.5) p = Math.min(intro.v, p)
      // Nur setzen, wenn sich etwas ändert – spart Style-Schreibzugriffe
      if (Math.abs(tl.progress() - p) > 1e-4) tl.progress(p)
    })
  })

  return (
    <Scroll html style={{ width: '100%', height: '100%' }}>
      {CHAPTERS.map((_, i) => (
        <Chapter key={i} index={i} timelines={timelines} />
      ))}
    </Scroll>
  )
}


