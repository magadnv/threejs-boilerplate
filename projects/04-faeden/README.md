# Fäden · Studie N° 04

Für die code.talks 2026 (4./5.11., Kinopolis HafenCity). Besucher scannen den QR-Code am Badge,
schreiben ein Wort auf die Frage „Was tut dir hier gut?“, und daraus wird ein roter Faden im
gemeinsamen Knäuel. Der eigene Faden bleibt schwarz. Jede Nutzung ist ein Gespräch.

| Seite | Wofür |
| --- | --- |
| `index.html` | Mitmachen am Handy: Wort, Name, dein Faden |
| `wand.html` | Das ganze Knäuel live, zum Zeigen am Handy oder auf einem Screen, mit QR |
| `badge.html` | Einleger 90 × 120 mm für die Badge-Hülle, drucken mit 100 % |

Ohne Eintrag in `config.js` läuft alles im **Demo-Modus** (48 Beispiel-Fäden, Sync zwischen Tabs).

## Live schalten

1. Kostenloses Projekt auf supabase.com anlegen (das machst du selbst).
2. SQL Editor → Inhalt von `setup.sql` einfügen → Run.
3. Project Settings → API: `Project URL` und `anon public` Key in `config.js` eintragen.
4. Ordner hosten (z. B. Vercel oder Netlify, statisch, kein Build) und die Adresse als `publicUrl` eintragen.
5. `badge.html` öffnen, QR mit dem Handy testen, drucken.

Moderation: Im Table Editor bei einem Faden `versteckt = true` setzen. Höchstens 30 neue Fäden pro Minute.
