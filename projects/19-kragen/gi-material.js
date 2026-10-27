import * as THREE from "three";
import { HALF_W, HALF_H } from "./collar.js";

// Gemeinsame Uniforms für Kragen und Fäden. interaction.js schreibt hinein.
export const giUniforms = {
  uTime: { value: 0 },
  // Griff (aktuell)
  uGrip: { value: 0 },              // Griffkraft, federnd, kann kurz unter 0 schwingen
  uGripPos: { value: new THREE.Vector3() },
  uGripT: { value: new THREE.Vector3(1, 0, 0) },
  uGripW: { value: new THREE.Vector3(0, 1, 0) },
  uGripN: { value: new THREE.Vector3(0, 0, 1) },
  uGripS: { value: 0 },
  uPull: { value: new THREE.Vector3() },
  uTwist: { value: 0 },
  // Erinnerung: Falten des letzten Griffs, die langsam ausglätten
  uGripSeed: { value: 0 },
  uMemory: { value: 0 },
  uMemSeed: { value: 0 },
  uMemPos: { value: new THREE.Vector3() },
  uMemT: { value: new THREE.Vector3(1, 0, 0) },
  uMemW: { value: new THREE.Vector3(0, 1, 0) },
  // Hover-Atem
  uHover: { value: 0 },
  uHoverPos: { value: new THREE.Vector3() },
  // Feintuning
  uStiff: { value: 1.0 },           // Stoffsteifigkeit: >1 = steifer, Falten größer und weiter
  uFoldDepth: { value: 0.42 },      // Faltentiefe in cm
  uFoldCount: { value: 5.0 },       // Anzahl radialer Falten um den Griff
  uWeave: { value: 1.0 },           // Relief der Pearl-Weave-Struktur
  uWear: { value: 0 },              // Abnutzung 0..1 (Vergilbung, längere Fransen)
  uFray: { value: 1.0 },
};

const DEFORM = /* glsl */ `
uniform float uTime, uGrip, uGripS, uTwist, uMemory, uHover, uGripSeed, uMemSeed;
uniform vec3 uGripPos, uGripT, uGripW, uGripN, uPull;
uniform vec3 uMemPos, uMemT, uMemW, uHoverPos;
uniform float uStiff, uFoldDepth, uFoldCount, uWear, uFray;

attribute vec3 aCenter;
attribute vec3 aT;
attribute vec3 aN;
attribute float aS;

// Radiale Falten um einen Griffpunkt, im Tangentialraum des Griffs
float giFolds(vec3 q, vec3 T, vec3 W, float seed) {
  vec2 l = vec2(dot(q, T), dot(q, W));
  float r = length(l);
  float a = atan(l.y, l.x) + seed * 6.2832;
  float wob = 0.55 * sin(a * 3.0 + r * 0.9) + 0.3 * sin(a * 5.0 - r * 0.6);
  float s = sin(a * uFoldCount + wob + r * 0.35);
  // weiche, runde Bäuche statt scharfer Kniffe
  float ridge = s * (1.15 - 0.15 * s * s);
  // Jede Falte anders stark und lang: Stoff faltet nie symmetrisch
  float var = 0.3 + 0.7 * (0.5 + 0.5 * sin(a * 2.0 + seed * 17.0) * cos(a * 1.0 + seed * 29.0));
  float reach = 0.6 + 0.8 * (0.5 + 0.5 * sin(a * 1.0 + seed * 41.0));
  ridge *= var * exp(-r / (4.0 * reach * uStiff)) * 1.6;
  float ring = smoothstep(0.1, 1.6, r) * exp(-r / (4.0 * uStiff));
  return ridge * ring;
}

vec3 giRotate(vec3 v, vec3 axis, float ang) {
  float c = cos(ang), s = sin(ang);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

vec3 giDeform(vec3 p) {
  vec3 d = vec3(0.0);

  // Atem: weiche Wölbung unter dem Cursor
  vec3 hq = p - uHoverPos;
  d += aN * uHover * 0.14 * exp(-dot(hq, hq) / 10.0) * (0.7 + 0.3 * sin(uTime * 1.7));

  // Griff: zusammenziehen, anheben, radiale Falten
  vec3 q = p - uGripPos;
  float R = 1.65 * uStiff;
  float g = exp(-dot(q, q) / (R * R));
  float ds = aS - uGripS;
  float gl = exp(-abs(ds) / (11.0 * uStiff));         // Spannung über das ganze Band
  vec3 qt = q - uGripN * dot(q, uGripN);
  d -= qt * uGrip * 0.42 * g;
  d += uGripN * uGrip * 1.1 * g;
  d += aN * uGrip * uFoldDepth * giFolds(q, uGripT, uGripW, uGripSeed);

  // Zug: der Griffbereich folgt der Hand, das Band zieht nach
  float pl = length(uPull);
  d += uPull * max(g, gl * 0.72);
  if (pl > 1e-3) {
    vec3 pd = uPull / pl;
    vec3 perp = cross(pd, aN);
    perp /= max(length(perp), 1e-4);
    float across = dot(q, perp);
    float along = dot(q, pd);
    // Zugfalten laufen parallel zur Zugrichtung
    float tf = sin(across * 3.4 + 0.9 * sin(along * 0.6));
    float env = gl * (1.0 - g) * exp(-across * across / (8.0 * uStiff * uStiff)) * smoothstep(0.4, 2.5, abs(along));
    d += aN * tf * env * min(pl, 3.0) * 0.38 * uFoldDepth;
  }

  // Erinnerung an den letzten Griff
  d += aN * uMemory * uFoldDepth * 0.85 * giFolds(p - uMemPos, uMemT, uMemW, uMemSeed);

  // Verdrehung um die Längsachse, abklingend zum Griffpunkt hin
  float tw = uTwist * exp(-abs(ds) / (7.0 * uStiff));
  vec3 o = p - aCenter;
  d += giRotate(o, aT, tw) - o;
  return d;
}
`;

const VARY_V = /* glsl */ `
#ifndef GI_THREAD
attribute vec2 aProf;
attribute float aPeri;
varying vec2 vWeaveUv;
varying vec2 vProf;
#else
attribute vec3 aRoot;
#endif
varying float vFold;
`;

const VARY_F = /* glsl */ `
#ifndef GI_THREAD
varying vec2 vWeaveUv;
varying vec2 vProf;
#endif
varying float vFold;
uniform float uWeave, uWear, uTime;
`;

const NOISE = /* glsl */ `
float giHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float giNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(giHash(i), giHash(i + vec2(1, 0)), u.x),
             mix(giHash(i + vec2(0, 1)), giHash(i + vec2(1, 1)), u.x), u.y);
}
float giFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * giNoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}
`;

// Höhe der Stoffoberfläche in cm: Pearl Weave + Steppnähte.
// Liefert x = Höhe, y = Nahtfaden-Maske, z = Rille, w = Webhöhe 0..1
const SURFACE = /* glsl */ `
#define HALF_W ${HALF_W.toFixed(3)}
#define HALF_H ${HALF_H.toFixed(3)}

// Pearl Weave: versetzte Reihen kleiner Körner, wie Reiskörner in Waben
float giPearl(vec2 uv) {
  vec2 cell = vec2(0.12, 0.08);
  vec2 g = uv / cell;
  float row = floor(g.y);
  g.x += mod(row, 2.0) * 0.5;
  vec2 id = vec2(floor(g.x), row);
  vec2 f = fract(g) - 0.5;
  float rnd = giHash(id);
  float ang = (mod(row, 2.0) * 2.0 - 1.0) * 0.4 + (rnd - 0.5) * 0.35;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 fr = rot * (f * cell) / cell.y;
  fr.x *= 0.72;
  float dd = length(fr) * 1.9;
  float dome = sqrt(max(0.0, 1.0 - dd * dd));
  // einzelne Fasern im Korn
  float fib = 0.16 * sin((fr.x * 0.9 + fr.y * 0.4) * 38.0 + rnd * 6.28);
  return dome * (0.8 + 0.35 * rnd) + fib * dome;
}

vec4 giSurface(vec2 uv, vec2 prof, float fade) {
  float weave = giPearl(uv);
  // Flaum: feines Faserrauschen über allem
  float fuzz = giNoise(uv * 60.0) - 0.5;
  float h = (weave * 0.009 * fade + fuzz * 0.005 * fade + 0.012 * giNoise(uv * 6.0)) * uWeave;

  // Steppnähte: parallele Reihen auf Ober- und Unterseite
  float face = smoothstep(HALF_H - 0.2, HALF_H - 0.08, abs(prof.y))
             * (1.0 - smoothstep(HALF_W - 0.42, HALF_W - 0.3, abs(prof.x)));
  float spacing = 0.52;
  float rc = (prof.x + HALF_W) / spacing;
  float rowId = floor(rc + 0.5);
  float dcm = (rc - rowId) * spacing;
  float rowRnd = giHash(vec2(rowId, sign(prof.y)));
  float groove = exp(-pow(dcm / 0.07, 2.0));
  float pillow = 0.5 + 0.5 * cos(dcm / spacing * 6.2832);   // Polster zwischen den Reihen
  float t = fract(uv.x / 0.3 + rowRnd);
  float dash = smoothstep(0.02, 0.1, t) * (1.0 - smoothstep(0.9, 0.98, t));
  float capsule = sqrt(max(0.0, 1.0 - pow(dcm / 0.03, 2.0)));
  float thread = dash * capsule;
  float twist = 0.25 * sin(uv.x * 140.0 + dcm * 90.0);

  h += face * (0.03 * pillow - 0.03 * groove * (1.0 - thread));
  h = mix(h, face * (0.008 + 0.018 * capsule * (1.0 + twist)), face * thread);
  return vec4(h, face * thread, face * groove * (1.0 - thread), weave);
}

vec3 giPerturb(vec3 pos, vec3 n, vec2 dH, float faceDir) {
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  vec2 slope = dH / vec2(max(length(dpx), 1e-6), max(length(dpy), 1e-6));
  vec3 sx = normalize(dpx), sy = normalize(dpy);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (slope.x * r1 + slope.y * r2);
  return normalize(abs(det) * n - grad);
}
`;

export function createGiMaterial({ thread = false } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: thread ? 0xefe9dc : 0xf3f0e8,
    roughness: thread ? 0.62 : 0.86,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xfffaf0).multiplyScalar(0.8),
    side: thread ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (thread) mat.defines = { GI_THREAD: "" };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, giUniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${DEFORM}\n${VARY_V}`)
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
        vec3 giP = position;
        #ifdef GI_THREAD
          giP = aRoot + (position - aRoot) * uFray;
        #endif
        vec3 giN0 = normal;
        vec3 giTa = normalize(cross(giN0, abs(giN0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 giTb = cross(giN0, giTa);
        float giE = 0.035;
        vec3 giD = giDeform(giP);
        vec3 giP0 = giP + giD;
        vec3 giP1 = giP + giTa * giE + giDeform(giP + giTa * giE);
        vec3 giP2 = giP + giTb * giE + giDeform(giP + giTb * giE);
        vec3 objectNormal = normalize(cross(giP1 - giP0, giP2 - giP0));
        if (dot(objectNormal, giN0) < 0.0) objectNormal = -objectNormal;
        vFold = dot(giD, aN);
        #ifndef GI_THREAD
          vWeaveUv = vec2(aS, aPeri);
          vProf = aProf;
        #endif
        `
      )
      .replace("#include <begin_vertex>", "vec3 transformed = giP0;");

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${VARY_F}\n${NOISE}\n${SURFACE}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        float giFade = 1.0;
        vec4 giS = vec4(0.0);
        #ifndef GI_THREAD
          float giPx = length(fwidth(vWeaveUv));
          giFade = 1.0 - smoothstep(0.018, 0.06, giPx);
          giS = giSurface(vWeaveUv, vProf, giFade);
          // Mikro-Rauschen, damit es nicht nach CG aussieht
          float giN1 = giFbm(vWeaveUv * 2.2);
          float giN2 = giHash(floor(vWeaveUv * 55.0));
          diffuseColor.rgb *= 0.92 + 0.08 * giN1 + 0.035 * (giN2 - 0.5);
          // Hohlräume zwischen den Körnern dunkler
          diffuseColor.rgb *= mix(0.94, mix(0.82, 1.03, giS.w), giFade);
          diffuseColor.rgb *= 1.0 - 0.28 * giS.z;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.94, 0.9), giS.y * 0.4);
          // Vergilbung an Kanten und Flanken, fleckig
          float giEdge = smoothstep(HALF_W - 0.75, HALF_W, abs(vProf.x))
                       + (1.0 - smoothstep(HALF_H - 0.3, HALF_H - 0.1, abs(vProf.y))) * 0.7;
          float giPatch = giFbm(vWeaveUv * vec2(0.35, 1.2) + 3.1);
          float giYellow = clamp(giEdge, 0.0, 1.0) * smoothstep(0.25, 0.75, giPatch) * (0.38 + 0.55 * uWear);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.0, 0.88, 0.64), giYellow);
        #endif
        // Faltentäler bekommen etwas Schatten
        diffuseColor.rgb *= 1.0 - 0.3 * smoothstep(0.0, -0.3, vFold);
        `
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        #include <roughnessmap_fragment>
        #ifndef GI_THREAD
          roughnessFactor = mix(roughnessFactor + 0.06 * (1.0 - giS.w) * giFade, 0.55, giS.y);
        #endif
        `
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        #ifndef GI_THREAD
          // Höhe an zwei Nachbar-Pixeln neu auswerten (sauberer als dFdx der Höhe)
          vec2 giDx = dFdx(vWeaveUv), giDy = dFdy(vWeaveUv);
          float giHx = giSurface(vWeaveUv + giDx, vProf + dFdx(vProf), giFade).x;
          float giHy = giSurface(vWeaveUv + giDy, vProf + dFdy(vProf), giFade).x;
          normal = giPerturb(-vViewPosition, normal, vec2(giHx - giS.x, giHy - giS.x), faceDirection);
        #endif
        `
      );
  };
  return mat;
}
