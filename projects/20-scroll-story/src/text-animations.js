// ============================================================
// TEXT-ANIMATIONS – SplitText für Titel, Helfer für die Kapitel
// ============================================================
// SplitText zerlegt einen Titel in einzelne <div>s pro Buchstabe (chars) und
// Wort (words). Wörter zuerst, damit beim Umbruch kein Wort zerrissen wird.
// mask: "chars" legt um jeden Buchstaben einen Rahmen mit overflow: clip –
// so „wächst“ der Buchstabe von unten aus einer unsichtbaren Kante heraus.
//
// Die Kapitel-Texte hängen in DERSELBEN Timeline wie die 3D-Werte. Dadurch
// sind sie automatisch synchron: Wenn das Siegel bei 80 % fertig ist und der
// Text bei 80 % verschwindet, passiert beides am selben Scroll-Pixel.

import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(SplitText);

export async function prepareText() {
  // Erst splitten, wenn die Webfont da ist – sonst stimmen die Breiten nicht
  await document.fonts.ready;

  const intro = SplitText.create(".copy--intro .title", { type: "words,chars" });

  const chapters = {};
  for (const section of document.querySelectorAll(".chapter:not([data-chapter='1'])")) {
    const copy = section.querySelector(".copy");
    chapters[section.dataset.chapter] = {
      copy,
      split: SplitText.create(copy.querySelector(".title"), { type: "words,chars", mask: "chars", charsClass: "char" }),
      rest: copy.querySelectorAll(".eyebrow, .lead, .cta"),
    };
  }
  return { intro, chapters };
}

// Intro: Buchstaben fliegen aus der Tiefe herein (läuft nach Zeit, nicht nach Scroll)
export function createIntro(split, { reduced }) {
  const copy = document.querySelector(".copy--intro");
  const rest = copy.querySelectorAll(".eyebrow, .lead");
  const tl = gsap.timeline({ paused: true });

  if (reduced) {
    tl.from(copy, { autoAlpha: 0, duration: 1 });
    return tl;
  }

  tl.from(split.chars, {
    yPercent: 70,
    z: -320,
    rotationX: -95,
    autoAlpha: 0,
    filter: "blur(14px)",
    transformOrigin: "50% 100% -40px",
    duration: 1.7,
    ease: "expo.out",
    stagger: 0.055,
  }).from(rest, { y: 18, autoAlpha: 0, duration: 1.1, ease: "power3.out", stagger: 0.12 }, 0.7);

  return tl;
}

// Kapitel-Text einblenden – `at` ist die Position in der 0..1-Timeline
export function textIn(tl, { copy, split, rest }, at, { reduced }) {
  if (reduced) {
    tl.fromTo(copy, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12 }, at);
    return;
  }
  tl.fromTo(copy, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01 }, at);
  tl.from(split.chars, { yPercent: 140, rotate: 8, stagger: { amount: 0.1 }, duration: 0.16, ease: "power3.out" }, at);
  tl.from(rest, { y: 24, autoAlpha: 0, duration: 0.14, stagger: 0.03, ease: "power2.out" }, at + 0.06);
}

// Kapitel-Text ausblenden: nach oben, unscharf, weg
export function textOut(tl, copy, at, { reduced }) {
  const to = reduced ? { autoAlpha: 0 } : { autoAlpha: 0, y: -50, filter: "blur(10px)" };
  tl.to(copy, { ...to, duration: 0.16, ease: "power2.in" }, at);
}
