import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// Schlanke Schärfentiefe: Tiefe in halber Auflösung, Unschärfe als Spirale aus
// 16 Abtastungen (goldener Winkel). Gewichtet nach eigener Unschärfe, damit
// scharfe Vordergrund-Kanten nicht in den Hintergrund bluten.
export class DofPass extends Pass {
  constructor(scene, camera, { focus = 30, aperture = 0.004, maxblur = 0.014 } = {}) {
    super();
    this.hide = []; // z. B. additive Partikel, die keine Tiefe haben sollen
    this.scene = scene;
    this.camera = camera;
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.blending = THREE.NoBlending;

    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: this.depthTarget.texture },
      focus: { value: focus },
      aperture: { value: aperture },
      maxblur: { value: maxblur },
      aspect: { value: 1 },
      nearClip: { value: camera.near },
      farClip: { value: camera.far },
    };
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          #include <packing>
          uniform sampler2D tColor, tDepth;
          uniform float focus, aperture, maxblur, aspect, nearClip, farClip;
          varying vec2 vUv;
          float coc(vec2 uv) {
            float d = unpackRGBAToDepth(texture2D(tDepth, uv));
            float z = -perspectiveDepthToViewZ(d, nearClip, farClip);
            return clamp((z - focus) * aperture, -maxblur, maxblur);
          }
          void main() {
            float c0 = abs(coc(vUv));
            // Spirale pro Pixel drehen: Rauschen statt Geisterkopien, das Korn schluckt es
            float rot = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
            vec4 sum = texture2D(tColor, vUv);
            float wsum = 1.0;
            const int N = 16;
            for (int i = 1; i <= N; i++) {
              float fi = float(i);
              float r = sqrt(fi / float(N));
              float a = fi * 2.39996 + rot;
              vec2 off = vec2(cos(a), sin(a)) * r * c0 * vec2(1.0, aspect);
              vec2 uv = vUv + off;
              // Nachbar zählt, wenn er selbst mindestens so unscharf ist
              float ci = abs(coc(uv));
              float w = smoothstep(0.0, 1.0, (ci + 0.0015) / max(c0 * r, 0.0015));
              sum += texture2D(tColor, uv) * w;
              wsum += w;
            }
            gl_FragColor = sum / wsum;
          }
        `,
      })
    );
  }

  setSize(w, h) {
    this.depthTarget.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
    this.uniforms.aspect.value = w / h;
  }

  render(renderer, writeBuffer, readBuffer) {
    const bg = this.scene.background;
    const oldClear = renderer.getClearColor(new THREE.Color());
    const oldAlpha = renderer.getClearAlpha();
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    this.hide.forEach((o) => (o.visible = false));
    this.scene.overrideMaterial = this.depthMaterial;
    this.scene.background = null;
    renderer.setClearColor(0xffffff, 1);
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    this.hide.forEach((o) => (o.visible = true));
    this.scene.background = bg;
    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = oldAuto;

    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.nearClip.value = this.camera.near;
    this.uniforms.farClip.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
