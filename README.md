# Three.js / WebGL Boilerplate

Persönliches Setup für tägliche Three.js- und WebGL-Lernprojekte. Ein Repo, viele
Mini-Projekte — jedes in seinem eigenen Ordner unter `projects/`.

## Struktur

- `index.html` — Übersichtsseite, listet alle Projekte unter `projects/` auf
- `shared/base.css` — gemeinsame Basis (Reset, Fonts, CSS-Variablen, Header/Footer) für alle Seiten
- `_template/` — Startpunkt für ein neues Mini-Projekt (index.html, styles.css, script.js)
- `projects/NN-thema/` — ein Ordner pro Übung, z. B. `01-intro-cube`
- `favicon.svg` — von allen Seiten über relativen Pfad genutzt

## Neues Mini-Projekt starten

1. `_template/` kopieren und umbenennen:
   ```bash
   cp -r _template projects/02-mein-thema
   ```
2. In `script.js` weitere Three.js-Module importieren, z. B.:
   ```js
   import { OrbitControls } from "three/addons/controls/OrbitControls.js";
   import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
   ```
   Three.js selbst und `three/addons/` sind bereits per Import Map in der `index.html`
   des Projekts eingebunden (CDN, keine Installation nötig).
3. In `script.js` loslegen — Scene, Camera, Renderer und ein Animation-Loop sind
   bereits vorbereitet.
4. Neuen Eintrag in der Root-`index.html` unter `.project-grid` ergänzen, damit das
   Projekt in der Übersicht auftaucht.
5. Lokal ansehen, z. B. mit VS Code "Live Server" oder:
   ```bash
   npx serve .
   ```
   (Ein lokaler Server ist bei ES-Modulen/Import Maps nötig — `file://` funktioniert
   in den meisten Browsern nicht.)

## Täglich dranbleiben

Damit nichts verloren geht, nach jeder Session committen und pushen:

```bash
git add .
git commit -m "NN: kurze Beschreibung des Themas"
git push
```

## Three.js Version

Aktuell per CDN (jsDelivr) über Import Maps eingebunden, Version `0.185.1`. Beim
Start eines neuen Themas gerne kurz prüfen, ob eine neuere Version sinnvoll ist,
und dann in allen `index.html`-Dateien der neuen Projekte konsistent aktualisieren.

## Grundsatz

`shared/` und `_template/` bleiben unverändert und generisch — projektspezifisches
Styling und Markup gehört in den jeweiligen `projects/NN-thema/`-Ordner, nicht in
die geteilte Basis.
