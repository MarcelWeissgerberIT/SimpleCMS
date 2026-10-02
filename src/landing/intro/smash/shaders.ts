/**
 * Shaders for the page surface (the intact plane AND every shard's front face).
 * Untilted geometry facing the camera renders the captured page texel-exact (no tone
 * mapping, no lighting), which is what makes the DOM → WebGL swap invisible. Cracks/glow
 * are revealed by distance from the impact; tilted shards pick up shading and glints.
 */
import * as THREE from 'three'

const pageVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const pageFragment = /* glsl */ `
uniform sampler2D uPage;
uniform sampler2D uCrack;
uniform sampler2D uGlow;
uniform vec2 uView;
uniform vec2 uImpact;
uniform float uCrackR;
uniform float uGlowAmt;
uniform float uHot;
uniform float uFlash;
uniform float uWash;
uniform vec3 uLight;
uniform vec3 uGlowColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;

void main() {
  vec3 col = texture2D(uPage, vUv).rgb;
  if (uWash > 0.0) {
    // reproduce the DOM's rgba(255,255,255,a) wash, composited in sRGB like the browser does
    vec3 sc = sRGBTransferOETF(vec4(col, 1.0)).rgb;
    col = sRGBTransferEOTF(vec4(mix(sc, vec3(1.0), uWash), 1.0)).rgb;
  }
  vec2 wp = (vUv - 0.5) * uView;
  vec2 d = wp - uImpact;
  float r = length(d);
  float ang = atan(d.y, d.x);
  float wob = 1.0 + 0.11 * sin(ang * 5.0 + 1.3) + 0.06 * sin(ang * 13.0 + 0.4);
  float edge = uCrackR * wob;
  float reveal = 1.0 - smoothstep(edge - 0.12, edge, r);
  vec4 ck = texture2D(uCrack, vUv);
  col = mix(col, ck.rgb, ck.a * reveal);
  float g = texture2D(uGlow, vUv).a * reveal;
  col += uGlowColor * g * uGlowAmt;
  // white-hot core at the impact right after a hit
  col += vec3(1.0, 0.8, 0.58) * uHot * exp(-r * r * 22.0);
  // shading for pieces that are no longer facing the camera
  vec3 N = normalize(vN);
  float tilt = clamp(1.0 - N.z, 0.0, 1.0);
  float lam = dot(N, uLight) - uLight.z;
  col *= 1.0 + 1.1 * lam;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uLight + V);
  col += vec3(1.0, 0.96, 0.9) * pow(max(dot(N, H), 0.0), 70.0) * min(tilt * 40.0, 1.0) * 0.9;
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export type PageUniforms = {
  uPage: { value: THREE.Texture | null }
  uCrack: { value: THREE.Texture | null }
  uGlow: { value: THREE.Texture | null }
  uView: { value: THREE.Vector2 }
  uImpact: { value: THREE.Vector2 }
  uCrackR: { value: number }
  uGlowAmt: { value: number }
  uHot: { value: number }
  uFlash: { value: number }
  uWash: { value: number }
  uLight: { value: THREE.Vector3 }
  uGlowColor: { value: THREE.Color }
}

export function createPageMaterial(view: THREE.Vector2, impact: THREE.Vector2): THREE.ShaderMaterial & { uniforms: PageUniforms } {
  const uniforms: PageUniforms = {
    uPage: { value: null },
    uCrack: { value: null },
    uGlow: { value: null },
    uView: { value: view },
    uImpact: { value: impact },
    uCrackR: { value: 0 },
    uGlowAmt: { value: 0 },
    uHot: { value: 0 },
    uFlash: { value: 0 },
    uWash: { value: 0 },
    uLight: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() },
    // linear-space warm signal orange
    uGlowColor: { value: new THREE.Color(1.0, 0.36, 0.06) },
  }
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: pageVertex, fragmentShader: pageFragment, toneMapped: false })
  return mat as THREE.ShaderMaterial & { uniforms: PageUniforms }
}

/* ---------------------------------------------------------------- soft particles (dust) */

export const dustVertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
uniform float uScale;
varying float vAlpha;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  vAlpha = aAlpha;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}
`

export const dustFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 17.0) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  float n = noise(p * 5.0 + vSeed * 9.0) * 0.6 + noise(p * 11.0) * 0.4;
  float a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.55) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`

/* ---------------------------------------------------------------- shockwave ring + contact shadow */

export const ringVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

export const ringFragment = /* glsl */ `
uniform float uAlpha;
uniform float uThick;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float band = smoothstep(1.0 - uThick, 1.0 - uThick * 0.45, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float a = band * uAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`

export const shadowFragment = /* glsl */ `
uniform float uAlpha;
uniform float uSoft;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(1.0 - uSoft, 1.0, r)) * uAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`
