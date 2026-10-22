// Leer = Demo-Modus: Fäden liegen nur in diesem Browser und wandern zwischen Tabs.
// Für die code.talks die Werte aus Supabase → Project Settings → API eintragen.
// Der anon-Key ist öffentlich gedacht; geschützt wird über die Regeln in setup.sql.
export const CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  // Adresse, auf die der QR-Code zeigt, z. B. "https://faeden.vercel.app/".
  // Leer = die Mitmach-Seite neben der aktuellen Seite.
  publicUrl: "",
};
