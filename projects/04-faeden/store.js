import { CONFIG } from "./config.js";

// Ein Faden: { id, wort, name, created_at }. Zwei Speicher mit gleicher Form:
// Supabase live für die Konferenz, sonst ein Demo-Knäuel im Browser.

const BLOCK = ["nazi", "hitler", "fick", "fuck", "hure", "nigg", "schwuchtel", "fotze", "wichs", "cunt", "bitch"];

export function clean(s, max) {
  const t = (s || "").replace(/\s+/g, " ").trim().slice(0, max);
  const flat = t.toLowerCase().normalize("NFKD").replace(/[^a-zäöüß]/g, "");
  return BLOCK.some((b) => flat.includes(b)) ? null : t;
}

export function mitmachUrl() {
  return CONFIG.publicUrl || new URL("./", location.href).href;
}

export async function createStore() {
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey ? supabaseStore() : demoStore();
}

async function supabaseStore() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  const db = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  const cols = "id,wort,name,created_at";

  return {
    demo: false,
    async list() {
      const { data, error } = await db.from("faeden").select(cols).order("id").limit(3000);
      if (error) throw error;
      return data;
    },
    async add(f) {
      const { data, error } = await db.from("faeden").insert(f).select(cols).single();
      if (error) throw error;
      return data;
    },
    subscribe(cb) {
      db.channel("faeden")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "faeden" }, (e) => cb(e.new))
        .subscribe();
    },
  };
}

const DEMO_KEY = "faeden:demo";
const DEMO_WORDS = [
  "Gespräche", "Kaffee", "Neugier", "Ruhe", "Shader", "Menschen", "Lachen", "Mut",
  "Pausen", "Ideen", "Hafen", "Musik", "Pizza", "Freunde", "Lernen", "Talks",
  "Sonne", "Ehrlichkeit", "Code", "Zuhören", "Staunen", "Energie", "Teilen", "Neues",
];
const DEMO_NAMES = ["Lena", "Jonas", "", "Ayşe", "Tom", "", "Mira", "Ole", "Sam", "", "Noor", "Finn"];

function demoStore() {
  const bus = "BroadcastChannel" in window ? new BroadcastChannel("faeden") : null;
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(DEMO_KEY)) || null;
    } catch {
      return null;
    }
  };
  const write = (list) => {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(list));
    } catch {}
  };
  let list = read();
  if (!list) {
    list = Array.from({ length: 48 }, (_, i) => ({
      id: i + 1,
      wort: DEMO_WORDS[(i * 7) % DEMO_WORDS.length],
      name: DEMO_NAMES[(i * 5) % DEMO_NAMES.length] || null,
      created_at: new Date(Date.now() - (48 - i) * 6e4).toISOString(),
    }));
    write(list);
  }

  return {
    demo: true,
    async list() {
      return read() || list;
    },
    async add(f) {
      const cur = read() || list;
      const row = { id: (cur.at(-1)?.id || 0) + 1, ...f, created_at: new Date().toISOString() };
      cur.push(row);
      write(cur);
      list = cur;
      bus?.postMessage(row);
      return row;
    },
    subscribe(cb) {
      bus?.addEventListener("message", (e) => cb(e.data));
    },
  };
}
