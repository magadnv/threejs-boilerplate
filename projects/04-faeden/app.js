import { createKnaeuel } from "./knaeuel.js";
import { createStore, clean, mitmachUrl } from "./store.js";

// Mitmachen in drei Bildschirmen: Wort → Name → dein Faden im Knäuel.

const MINE_KEY = "faeden:mein";
const VORSCHLAEGE = ["Gespräche", "Kaffee", "Neugier", "Ruhe", "Menschen"];
const $ = (s) => document.querySelector(s);

const store = await createStore();
const knaeuel = await createKnaeuel($("#scene"));

let faeden = await store.list();
let mineId = Number(localStorage.getItem(MINE_KEY)) || null;
if (!faeden.some((f) => f.id === mineId)) mineId = null;
knaeuel.set(faeden, { mineId });

store.subscribe((f) => {
  if (faeden.some((x) => x.id === f.id)) return;
  faeden.push(f);
  knaeuel.add(f, { mine: f.id === mineId });
  zaehlen();
});

function zeige(name) {
  document.querySelectorAll(".step").forEach((s) => s.classList.toggle("is-active", s.dataset.step === name));
}

function zaehlen() {
  const i = faeden.findIndex((f) => f.id === mineId);
  $("#nr").textContent = String(i + 1).padStart(3, "0");
  $("#anzahl").textContent = faeden.length - 1;
}

// --- 1 · Wort ------------------------------------------------------------------

const wort = $("#wort");
const chips = $("#chips");
for (const v of VORSCHLAEGE) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = v;
  b.setAttribute("aria-pressed", v === wort.value);
  b.onclick = () => {
    wort.value = v;
    markChips();
  };
  chips.append(b);
}
function markChips() {
  chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c.textContent === wort.value.trim()));
}
wort.addEventListener("input", markChips);
wort.addEventListener("focus", () => wort.select());

$("#form-wort").addEventListener("submit", (e) => {
  e.preventDefault();
  const w = clean(wort.value, 24);
  const note = $("#note-wort");
  note.classList.toggle("note--error", !w);
  note.textContent = w ? "" : "Lieber ein anderes Wort.";
  if (!w) return;
  wort.value = w;
  zeige("name");
});

// --- 2 · Name und Spinnen --------------------------------------------------------

async function spinnen(name) {
  const btn = $("#spinnen");
  const note = $("#note-name");
  const n = name === null ? null : clean(name, 20);
  if (name && !n) {
    note.classList.add("note--error");
    note.textContent = "Lieber einen anderen Namen.";
    return;
  }
  btn.disabled = true;
  try {
    const row = await store.add({ wort: wort.value, name: n || null });
    mineId = row.id;
    localStorage.setItem(MINE_KEY, row.id);
    if (!faeden.some((f) => f.id === row.id)) {
      faeden.push(row);
      knaeuel.add(row, { mine: true });
    } else {
      knaeuel.markMine(row.id);
    }
    zaehlen();
    zeige("fertig");
  } catch (err) {
    console.error(err);
    note.classList.add("note--error");
    note.textContent = "Hat nicht geklappt. Nochmal?";
  } finally {
    btn.disabled = false;
  }
}

$("#form-name").addEventListener("submit", (e) => {
  e.preventDefault();
  spinnen($("#name").value);
});
$("#ohne").addEventListener("click", () => spinnen(null));

// --- 3 · Teilen ------------------------------------------------------------------

$("#teilen").addEventListener("click", async () => {
  const mine = faeden.find((f) => f.id === mineId);
  const text = `Mein roter Faden auf der code.talks: „${mine?.wort}“ – N° ${$("#nr").textContent}`;
  const url = mitmachUrl();
  try {
    if (navigator.share) await navigator.share({ title: "Fäden", text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      $("#teilen").textContent = "Kopiert";
    }
  } catch {}
});

if (mineId) {
  zaehlen();
  zeige("fertig");
} else {
  zeige("wort");
}
