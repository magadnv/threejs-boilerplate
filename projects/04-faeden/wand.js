import { createKnaeuel } from "./knaeuel.js";
import { createStore, mitmachUrl } from "./store.js";

// Die Wand: das ganze Knäuel live, darunter wechselt ein Wort nach dem anderen.
// Neue Fäden drängeln sich vor und stehen kurz in Rot.

const $ = (s) => document.querySelector(s);

const store = await createStore();
const knaeuel = await createKnaeuel($("#scene"));

let faeden = await store.list();
knaeuel.set(faeden);
$("#anzahl").textContent = faeden.length;

const qr = qrcode(0, "M");
qr.addData(mitmachUrl());
qr.make();
$("#qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });

const queue = [];
let timer;

function zeige(f, neu = false) {
  const el = $("#wort");
  el.style.opacity = 0;
  setTimeout(() => {
    el.textContent = `„${f.wort}“`;
    el.classList.toggle("is-new", neu);
    const nr = String(faeden.findIndex((x) => x.id === f.id) + 1).padStart(3, "0");
    $("#wer").textContent = `N° ${nr}${f.name ? ` · ${f.name}` : ""}`;
    el.style.opacity = 1;
  }, 600);
}

function weiter() {
  clearTimeout(timer);
  const next = queue.shift();
  if (next) zeige(next, true);
  else if (faeden.length) zeige(faeden[(Math.random() * faeden.length) | 0]);
  timer = setTimeout(weiter, next ? 7000 : 4500);
}
weiter();

store.subscribe((f) => {
  if (faeden.some((x) => x.id === f.id)) return;
  faeden.push(f);
  knaeuel.add(f);
  $("#anzahl").textContent = faeden.length;
  queue.push(f);
  if (queue.length === 1) weiter();
});

// Versteckte Fäden (Moderation in Supabase) fallen beim nächsten Abgleich raus.
if (!store.demo) {
  setInterval(async () => {
    const fresh = await store.list().catch(() => null);
    if (!fresh) return;
    const ids = new Set(fresh.map((f) => f.id));
    for (const f of faeden) if (!ids.has(f.id)) knaeuel.remove(f.id);
    faeden = faeden.filter((f) => ids.has(f.id));
    $("#anzahl").textContent = faeden.length;
  }, 120000);
}
