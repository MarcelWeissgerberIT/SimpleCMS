/**
 * The smash (Three.js). A transparent full-viewport canvas above the spreadsheet.
 *
 *  0.00  swap: DOM → WebGL plane textured with the capture (pixel-aligned, invisible swap)
 *  0.00  hammer swoops in from the top-right, close to the camera, winds up
 *  0.70  HIT 1  flash, shake, radial crack star, chips, sparks, shockwave, recoil
 *  1.70  HIT 2  cracks race to the edges, the page buckles into a mosaic (dent), the crater
 *               pieces fall out, warm light leaks through the cracks
 *  2.80  HIT 3  120 ms freeze-frame, then full Voronoi shatter: shards with thickness tumble
 *               and fall away revealing the new site; big flash, dust, the hammer flies off
 * ~4.5   onDone → everything disposed
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Sfx } from '../audio'
import { captureScale } from '../capture'
import { buildFracture, rng, type Shard } from './fracture'
import { paintCracks } from './cracks'
import { buildHammer, HANDLE_LEN, HEAD_LEN } from './hammer'
import { createPageMaterial } from './shaders'
import { Fx } from './fx'

export interface SmashHooks {
  /** First WebGL frame is on screen — hide the DOM page now. */
  onSwap(): void
  /** Sequence finished; the stage disposes itself right after. */
  onDone(): void
}

export interface SmashStage {
  setPage(canvas: HTMLCanvasElement): void
  /** `wash` = strength of the "Not Responding" white wash on screen at swap time (0…1). */
  play(hooks: SmashHooks, opts?: { wash?: number }): void
  /** Manual clock (tests): advance the sequence by `ms` and render. */
  advance?(ms: number): void
  dispose(): void
}

export interface SmashOptions {
  mobile: boolean
  sfx: Sfx | null
  manualClock: boolean
}

const FOV = 38
const VIEW_H = 10
const IMPACT_UV: [number, number] = [0.46, 0.46]
const T_HIT1 = 0.7
const T_HIT2 = 1.7
const T_HIT3 = 2.8
const FREEZE = 0.12
const SHATTER_LEN = 1.6
const GRAVITY = 20
const DEG = Math.PI / 180

type Ease = (k: number) => number
const linear: Ease = (k) => k
const outCubic: Ease = (k) => 1 - Math.pow(1 - k, 3)
const inCubic: Ease = (k) => k * k * k
const inQuart: Ease = (k) => k * k * k * k
const inOutCubic: Ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const inOutSine: Ease = (k) => -(Math.cos(Math.PI * k) - 1) / 2
const outQuad: Ease = (k) => 1 - (1 - k) * (1 - k)
const inQuad: Ease = (k) => k * k

interface Key {
  t: number
  th: number
  ps: number
  off: [number, number, number]
  ease: Ease
}

/** Hammer choreography: swing angle θ (deg, + = cocked back toward camera), twist ψ, pivot offset. */
const KEYS: Key[] = [
  { t: 0.0, th: 60, ps: 30, off: [6, 4, 5.5], ease: linear },
  { t: 0.44, th: 35, ps: 10, off: [1.6, -0.6, 2.5], ease: outCubic },
  { t: 0.58, th: 41, ps: 12, off: [1.75, -0.5, 2.8], ease: inOutSine },
  { t: T_HIT1, th: 6, ps: 0, off: [0, 0, 0], ease: inCubic },
  { t: 0.88, th: 22, ps: -5, off: [0.3, 0, 0.9], ease: outCubic },
  { t: 1.4, th: 38, ps: 12, off: [1.7, -0.8, 2.7], ease: inOutCubic },
  { t: 1.55, th: 44, ps: 14, off: [1.85, -0.7, 3.0], ease: inOutSine },
  { t: T_HIT2, th: 6, ps: 0, off: [0, 0, 0], ease: inCubic },
  { t: 1.9, th: 24, ps: -8, off: [0.35, 0, 1.0], ease: outCubic },
  { t: 2.56, th: 50, ps: 18, off: [0.8, -1.8, 4.0], ease: inOutCubic },
  { t: 2.66, th: 56, ps: 20, off: [0.95, -1.7, 4.3], ease: inOutSine },
  { t: T_HIT3, th: 6, ps: 0, off: [0, 0, 0], ease: inQuart },
  { t: T_HIT3 + FREEZE, th: 6, ps: 0, off: [0, 0, 0], ease: linear },
  { t: T_HIT3 + FREEZE + 0.14, th: -14, ps: -10, off: [-0.2, -0.3, -0.6], ease: outQuad },
  { t: T_HIT3 + FREEZE + 0.9, th: 170, ps: -140, off: [9, 8, 9], ease: inQuad },
]

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k
}

interface Body {
  shard: Shard
  mesh: THREE.Mesh
  vel: THREE.Vector3
  axis: THREE.Vector3
  spin: number
  delay: number
  state: 'rest' | 'fly' | 'gone'
  dentQ: THREE.Quaternion
  dentZ: number
}

export async function createSmashStage(host: HTMLElement, opts: SmashOptions): Promise<SmashStage> {
  const W = window.innerWidth
  const H = window.innerHeight
  const aspect = W / H
  const pr = captureScale()
  const mobile = opts.mobile
  const rand = rng(20260101)

  // ------------------------------------------------------------------ renderer
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance', premultipliedAlpha: true })
  renderer.setPixelRatio(pr)
  renderer.setSize(W, H, false)
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.05
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:200;pointer-events:none;visibility:hidden'
  host.appendChild(canvas)

  const flash = document.createElement('div')
  flash.setAttribute('aria-hidden', 'true')
  flash.style.cssText = `position:absolute;inset:0;z-index:201;pointer-events:none;opacity:0;background:radial-gradient(circle at ${IMPACT_UV[0] * 100}% ${IMPACT_UV[1] * 100}%, #fff 0, rgba(255,250,242,.85) 12%, rgba(255,236,214,.35) 34%, rgba(255,255,255,0) 62%)`
  host.appendChild(flash)
  const white = document.createElement('div')
  white.setAttribute('aria-hidden', 'true')
  white.style.cssText = 'position:absolute;inset:0;z-index:202;pointer-events:none;opacity:0;background:#fffaf2'
  host.appendChild(white)

  // ------------------------------------------------------------------ scene / camera
  const viewW = VIEW_H * aspect
  const camZ = VIEW_H / 2 / Math.tan((FOV / 2) * DEG)
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.05, 200)
  camera.position.set(0, 0, camZ)
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const envRT = pmrem.fromScene(room, 0.04)
  room.dispose()
  scene.environment = envRT.texture
  scene.environmentIntensity = 1.15
  const key = new THREE.DirectionalLight(0xffeedd, 3.4)
  key.position.set(-6, 8, 12)
  const rim = new THREE.DirectionalLight(0xff4f00, 4.5)
  rim.position.set(6, 3, -9)
  const rim2 = new THREE.DirectionalLight(0xff7a2a, 1.6)
  rim2.position.set(-7, -3, -6)
  scene.add(key, rim, rim2, new THREE.HemisphereLight(0xfff4e8, 0x2a2622, 0.45))

  const impact = new THREE.Vector2((IMPACT_UV[0] - 0.5) * viewW, (0.5 - IMPACT_UV[1]) * VIEW_H)
  const impact3 = new THREE.Vector3(impact.x, impact.y, 0)
  const pageMat = createPageMaterial(new THREE.Vector2(viewW, VIEW_H), impact)

  // intact page plane
  const planeGeo = new THREE.PlaneGeometry(viewW, VIEW_H, 1, 1)
  const plane = new THREE.Mesh(planeGeo, pageMat)
  scene.add(plane)

  // fracture + crack textures
  const fr = buildFracture(viewW, VIEW_H, [impact.x, impact.y], mobile)
  const bufW = Math.floor(W * pr)
  const bufH = Math.floor(H * pr)
  const crackScale = Math.min(1, 2560 / Math.max(bufW, bufH))
  const tex = paintCracks(fr, viewW, VIEW_H, [impact.x, impact.y], Math.round(bufW * crackScale), Math.round(bufH * crackScale), pr * crackScale)
  const crackTex = new THREE.CanvasTexture(tex.crack)
  crackTex.colorSpace = THREE.SRGBColorSpace
  crackTex.generateMipmaps = false
  crackTex.minFilter = THREE.LinearFilter
  const glowTex = new THREE.CanvasTexture(tex.glow)
  glowTex.generateMipmaps = false
  glowTex.minFilter = THREE.LinearFilter
  pageMat.uniforms.uCrack.value = crackTex
  pageMat.uniforms.uGlow.value = glowTex

  // shards
  const thick = mobile ? 0.07 : 0.085
  const sideMat = new THREE.MeshPhysicalMaterial({ color: 0xd6d2c8, roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 })
  const backMat = new THREE.MeshStandardMaterial({ color: 0x23211e, roughness: 0.7, metalness: 0.1 })
  const shardGroup = new THREE.Group()
  scene.add(shardGroup)
  const bodies: Body[] = fr.shards.map((s) => {
    const geo = shardGeometry(s, thick, viewW, VIEW_H)
    const mesh = new THREE.Mesh(geo, [pageMat, sideMat, backMat])
    mesh.position.set(s.cx, s.cy, 0)
    mesh.visible = false
    shardGroup.add(mesh)
    // dent pose for HIT 2: pushed away from the camera and tilted toward the impact (bowl)
    const r = s.dist
    const D = mobile ? 0.28 : 0.34
    const sig2 = mobile ? 1.5 : 2.6
    const depth = D * Math.exp(-(r * r) / sig2)
    const slope = depth * ((2 * r) / sig2)
    const dir = new THREE.Vector2(s.cx - impact.x, s.cy - impact.y).normalize()
    const n = new THREE.Vector3(-dir.x * slope, -dir.y * slope, 1)
    n.x += (rand() - 0.5) * 0.035 * Math.max(0, 1 - r / 5)
    n.y += (rand() - 0.5) * 0.035 * Math.max(0, 1 - r / 5)
    n.normalize()
    const dentQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
    return { shard: s, mesh, vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), spin: 0, delay: 0, state: 'rest', dentQ, dentZ: depth }
  })

  // hammer
  const hammer = buildHammer()
  const hs = mobile ? 0.6 : 1
  const offX = mobile ? 0.55 : 1
  hammer.pivot.scale.setScalar(hs)
  scene.add(hammer.pivot)
  const dHandle = mobile ? new THREE.Vector3(0.42, 0.91, 0).normalize() : new THREE.Vector3(0.6, 0.8, 0).normalize()
  const Z = new THREE.Vector3(0, 0, 1)
  const X = new THREE.Vector3().crossVectors(dHandle, Z)
  const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, dHandle, Z))
  const qa = new THREE.Quaternion()
  const qb = new THREE.Quaternion()
  const AX = new THREE.Vector3(1, 0, 0)
  const AY = new THREE.Vector3(0, 1, 0)
  function orient(out: THREE.Quaternion, th: number, ps: number) {
    qa.setFromAxisAngle(AX, -th * DEG)
    qb.setFromAxisAngle(AY, ps * DEG)
    return out.copy(Q0).multiply(qa).multiply(qb)
  }
  // pivot such that the striking face (local -Z) centre touches the impact at the contact pose
  const qc = orient(new THREE.Quaternion(), KEYS[3].th, 0)
  const headC = impact3.clone().add(new THREE.Vector3(0, 0, (HEAD_LEN / 2) * hs + 0.02).applyQuaternion(qc))
  const pivotC = headC.clone().add(new THREE.Vector3(0, HANDLE_LEN * hs, 0).applyQuaternion(qc))
  const headPos = new THREE.Vector3()

  function poseHammer(t: number) {
    let i = 1
    while (i < KEYS.length - 1 && KEYS[i].t < t) i++
    const a = KEYS[i - 1]
    const b = KEYS[i]
    const k = b.ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1))))
    const th = lerp(a.th, b.th, k)
    const ps = lerp(a.ps, b.ps, k)
    orient(hammer.pivot.quaternion, th, ps)
    hammer.pivot.position.set(
      pivotC.x + lerp(a.off[0], b.off[0], k) * hs * offX,
      pivotC.y + lerp(a.off[1], b.off[1], k) * hs,
      pivotC.z + lerp(a.off[2], b.off[2], k) * hs,
    )
    headPos.set(0, -HANDLE_LEN, 0).multiplyScalar(hs).applyQuaternion(hammer.pivot.quaternion).add(hammer.pivot.position)
  }

  // effects
  const fx = new Fx(rand, mobile, renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((FOV / 2) * DEG)))
  scene.add(fx.group)

  // ------------------------------------------------------------------ warm-up (compile shaders, upload buffers)
  for (const b of bodies) b.mesh.visible = true
  poseHammer(1.0)
  try {
    await renderer.compileAsync(scene, camera)
  } catch {
    renderer.compile(scene, camera)
  }
  renderer.render(scene, camera)
  for (const b of bodies) b.mesh.visible = false
  poseHammer(0)

  // ------------------------------------------------------------------ sequence state
  let pageTex: THREE.CanvasTexture | null = null
  let seq = 0
  let freezeLeft = 0
  let raf = 0
  let last = 0
  let hooks: SmashHooks | null = null
  let disposed = false
  let doneFired = false
  let trauma = 0
  let punch = 0
  let shakeT = 0
  let flashA = 0
  let whiteA = 0
  let hot = 0
  let wash0 = 0
  let glowTarget = 0
  let dentK = 0
  let dentOn = false
  let shattered = false
  let crackFrom = 0
  let crackTo = 0
  let crackT0 = 0
  let crackDur = 0.001
  const sfx = opts.sfx
  const maxCrackR = Math.hypot(viewW, VIEW_H)
  const R1 = mobile ? 1.5 : 2.2
  const hd = Math.hypot(viewW, VIEW_H) / 2

  type Ev = { t: number; fn: () => void; done?: boolean }
  const events: Ev[] = [
    { t: 0.5, fn: () => sfx?.whoosh(0.22, 0.7, 0.4, 0.25) },
    { t: 0.58, fn: () => sfx?.whoosh(0.13, 0.5, -0.1, 0.55) },
    { t: T_HIT1, fn: () => hit(1) },
    { t: 1.55, fn: () => sfx?.whoosh(0.16, 0.5, -0.1, 0.6) },
    { t: T_HIT2, fn: () => hit(2) },
    { t: 2.64, fn: () => sfx?.whoosh(0.17, 0.6, -0.2, 0.75) },
    { t: T_HIT3, fn: () => contact() },
    { t: T_HIT3 + FREEZE, fn: () => shatter() },
  ]

  function growCracks(to: number, dur: number) {
    crackFrom = pageMat.uniforms.uCrackR.value
    crackTo = to
    crackT0 = seq
    crackDur = dur
  }

  function hit(n: 1 | 2) {
    trauma = Math.min(1, trauma + (n === 1 ? 0.55 : 0.75))
    punch = Math.max(punch, n === 1 ? 0.035 : 0.045)
    flashA = n === 1 ? 0.9 : 0.75
    hot = 1
    fx.burst(impact3, n === 1 ? 0.9 : 1.1, { chips: n === 1 ? 14 : 22, sparks: n === 1 ? 12 : 18, dust: n === 1 ? 14 : 26 })
    fx.ring(impact3, n === 1 ? 3.2 : 4.4, n === 1 ? 0.32 : 0.4)
    sfx?.clang(n === 1 ? 0.9 : 1)
    sfx?.crack(n === 1 ? 0.7 : 1, n === 1 ? 8 : 16, n === 1 ? 0.14 : 0.35)
    if (n === 1) {
      growCracks(R1, 0.14)
      glowTarget = 0.18
    } else {
      growCracks(maxCrackR, 0.42)
      glowTarget = 1
      // the page turns into a buckled mosaic of pieces; the crater falls out
      plane.visible = false
      for (const b of bodies) b.mesh.visible = true
      dentOn = true
      for (const b of bodies) {
        if (b.shard.ring <= 1) launch(b, 0.55, 0)
      }
    }
  }

  function contact() {
    trauma = Math.min(1, trauma + 0.3)
    punch = Math.max(punch, 0.06)
    whiteA = 0.62
    flashA = 1
    hot = 1.6
    glowTarget = 2.4
    freezeLeft = FREEZE
    sfx?.clang(1.1)
  }

  function shatter() {
    shattered = true
    trauma = 1
    fx.burst(impact3, 1.5, { chips: mobile ? 30 : 46, sparks: mobile ? 22 : 34, dust: mobile ? 30 : 50 })
    fx.ring(impact3, 9, 0.55, 0.16)
    for (const b of bodies) {
      if (b.state !== 'rest') continue
      launch(b, 1, Math.min(0.28, b.shard.dist * 0.03))
      if (rand() < 0.45) fx.puff(new THREE.Vector3(b.shard.cx, b.shard.cy, 0), 2, b.shard.radius * 0.6, 0.8, 1.2)
    }
    sfx?.boom()
    sfx?.shatter()
    sfx?.crack(1, 24, 0.5)
  }

  function launch(b: Body, power: number, delay: number) {
    const s = b.shard
    const dx = s.cx - impact.x
    const dy = s.cy - impact.y
    const len = Math.hypot(dx, dy) || 1
    const near = 1 / (1 + s.dist * 0.6)
    const vr = (0.8 + 6.5 * near) * (0.6 + rand() * 0.8) * power
    b.vel.set((dx / len) * vr, (dy / len) * vr + (0.3 + rand() * 1.6) * power, (0.6 + 6 * near) * (0.2 + rand()) * power)
    // tumble outward like opening petals: spin mostly around the tangential axis
    b.axis.set(-dy / len + (rand() - 0.5) * 0.9, dx / len + (rand() - 0.5) * 0.9, (rand() - 0.5) * 0.5).normalize()
    b.spin = (0.8 + rand() * 3.5 + 0.8 / (s.area + 0.2)) * (rand() < 0.8 ? 1 : -1)
    b.spin = Math.min(9, b.spin)
    b.delay = delay
    b.state = 'fly'
  }

  const tmpQ = new THREE.Quaternion()
  const identity = new THREE.Quaternion()
  function stepBodies(dt: number) {
    for (const b of bodies) {
      if (b.state === 'rest') {
        if (dentOn) {
          b.mesh.position.z = -b.dentZ * dentK
          b.mesh.quaternion.copy(identity).slerp(b.dentQ, dentK)
        }
        continue
      }
      if (b.state !== 'fly') continue
      if (b.delay > 0) {
        b.delay -= dt
        if (dentOn) {
          b.mesh.position.z = -b.dentZ * dentK
          b.mesh.quaternion.copy(identity).slerp(b.dentQ, dentK)
        }
        continue
      }
      b.vel.y -= GRAVITY * dt
      b.vel.multiplyScalar(1 - 0.35 * dt)
      b.mesh.position.addScaledVector(b.vel, dt)
      tmpQ.setFromAxisAngle(b.axis, b.spin * dt)
      b.mesh.quaternion.premultiply(tmpQ)
      const p = b.mesh.position
      const halfH = (VIEW_H / 2) * Math.max(0.05, (camZ - p.z) / camZ)
      if (p.z > camZ - 0.4 || p.y < -halfH - b.shard.radius * 1.5 || p.y > halfH * 3) {
        b.state = 'gone'
        b.mesh.visible = false
      }
    }
  }

  const shakeNoise = (t: number, o: number) => Math.sin(t * 37 + o) * 0.5 + Math.sin(t * 61 + o * 2.1) * 0.3 + Math.sin(t * 97 + o * 3.7) * 0.2

  function step(dt: number) {
    const worldDt = freezeLeft > 0 ? 0 : dt
    if (freezeLeft > 0) freezeLeft = Math.max(0, freezeLeft - dt)
    seq += worldDt
    for (const ev of events) {
      if (!ev.done && seq >= ev.t) {
        ev.done = true
        ev.fn()
      }
    }
    poseHammer(seq)
    // cracks + glow
    const ck = Math.min(1, (seq - crackT0) / crackDur)
    pageMat.uniforms.uCrackR.value = lerp(crackFrom, crackTo, outCubic(Math.max(0, ck)))
    const glow = pageMat.uniforms.uGlowAmt.value
    const flicker = glowTarget >= 1 && !shattered ? 0.85 + 0.15 * Math.sin(seq * 63) * Math.sin(seq * 17) : 1
    pageMat.uniforms.uGlowAmt.value = lerp(glow, glowTarget * flicker, 1 - Math.exp(-dt * 14))
    hot = Math.max(0, hot - dt * 3.2)
    pageMat.uniforms.uHot.value = hot
    // the hung window "wakes up" as the hammer swoops in
    pageMat.uniforms.uWash.value = wash0 * (1 - inOutSine(Math.min(1, Math.max(0, (seq - 0.12) / 0.3))))
    if (dentOn && dentK < 1) dentK = Math.min(1, dentK + worldDt / 0.07)
    stepBodies(worldDt)
    fx.update(worldDt)
    // contact shadow
    if (!shattered) {
      const z = Math.max(0, headPos.z)
      const sx = headPos.x + z * 0.32
      const sy = headPos.y - z * 0.42
      const size = (1.25 + z * 0.22) * hs
      const alpha = 0.5 * Math.exp(-z * 0.16) * Math.min(1, seq * 4)
      fx.setShadow(sx, sy, size, alpha, Math.min(0.95, 0.4 + z * 0.07))
    } else fx.setShadow(0, 0, 1, 0, 1)
    // camera: punch-in + trauma shake (kept inside the page edges until the shatter)
    trauma = Math.max(0, trauma - dt * 1.5)
    punch *= Math.exp(-dt / 0.3)
    shakeT += dt
    const shake = trauma * trauma
    let off = shake * (shattered ? 0.32 : 0.22)
    let roll = shake * (shattered ? 0.02 : 0.01)
    if (!shattered) {
      const margin = (VIEW_H / 2) * punch
      off = Math.min(off, margin * 0.6)
      roll = Math.min(roll, (margin * 0.35) / hd)
    }
    camera.position.set(off * shakeNoise(shakeT, 0), off * shakeNoise(shakeT, 11), camZ * (1 - punch))
    camera.rotation.set(0, 0, roll * shakeNoise(shakeT, 29))
    // flashes
    flashA = Math.max(0, flashA - dt / 0.06)
    whiteA = freezeLeft > 0 ? whiteA : Math.max(0, whiteA - dt / 0.22)
    flash.style.opacity = flashA.toFixed(3)
    white.style.opacity = whiteA.toFixed(3)
  }

  function finished(): boolean {
    if (!shattered) return false
    const since = seq - (T_HIT3 + FREEZE)
    if (since > SHATTER_LEN + 0.35) return true
    return since > SHATTER_LEN - 0.3 && bodies.every((b) => b.state === 'gone')
  }

  function render() {
    renderer.render(scene, camera)
  }

  function loop(now: number) {
    if (disposed) return
    raf = requestAnimationFrame(loop)
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
    last = now
    step(dt)
    render()
    checkDone()
  }

  function checkDone() {
    if (!doneFired && finished()) {
      doneFired = true
      cancelAnimationFrame(raf)
      const h = hooks
      stage.dispose()
      h?.onDone()
    }
  }

  const stage: SmashStage = {
    setPage(src: HTMLCanvasElement) {
      pageTex?.dispose()
      pageTex = new THREE.CanvasTexture(src)
      pageTex.colorSpace = THREE.SRGBColorSpace
      pageTex.generateMipmaps = false
      pageTex.minFilter = THREE.LinearFilter
      pageTex.magFilter = THREE.LinearFilter
      pageMat.uniforms.uPage.value = pageTex
      renderer.initTexture(pageTex)
    },
    play(h: SmashHooks, o?: { wash?: number }) {
      hooks = h
      wash0 = o?.wash ?? 0
      pageMat.uniforms.uWash.value = wash0
      seq = 0
      poseHammer(0)
      step(0)
      render()
      canvas.style.visibility = 'visible'
      requestAnimationFrame((now) => {
        if (disposed) return
        h.onSwap()
        last = now
        if (!opts.manualClock) raf = requestAnimationFrame(loop)
      })
    },
    advance(ms: number) {
      if (disposed) return
      let left = ms / 1000
      while (left > 1e-6 && !disposed) {
        const dt = Math.min(1 / 60, left)
        left -= dt
        step(dt)
        if (finished()) break
      }
      render()
      checkDone()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && m.geometry && m !== plane && m.parent === shardGroup) m.geometry.dispose()
      })
      planeGeo.dispose()
      pageMat.dispose()
      sideMat.dispose()
      backMat.dispose()
      pageTex?.dispose()
      crackTex.dispose()
      glowTex.dispose()
      hammer.dispose()
      fx.dispose()
      envRT.dispose()
      pmrem.dispose()
      renderer.renderLists.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      flash.remove()
      white.remove()
    },
  }
  return stage
}

/** Prism for one shard: front = page (uv from rest position), back = dark, sides = plaster/glass. */
function shardGeometry(s: Shard, thick: number, viewW: number, viewH: number): THREE.BufferGeometry {
  const contour = s.poly.map(([x, y]) => new THREE.Vector2(x - s.cx, y - s.cy))
  let faces = THREE.ShapeUtils.triangulateShape(contour, [])
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    pos.push(x, y, z)
    nor.push(nx, ny, nz)
    uv.push((x + s.cx) / viewW + 0.5, (y + s.cy) / viewH + 0.5)
  }
  faces = faces.map((f) => {
    const [a, b, c] = f.map((i) => contour[i])
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    return area < 0 ? [f[0], f[2], f[1]] : f
  })
  for (const f of faces) for (const i of f) push(contour[i].x, contour[i].y, 0, 0, 0, 1)
  const frontCount = faces.length * 3
  for (const f of faces) for (const i of [f[0], f[2], f[1]]) push(contour[i].x, contour[i].y, -thick, 0, 0, -1)
  const backCount = faces.length * 3
  const n = contour.length
  for (let i = 0; i < n; i++) {
    const a = contour[i]
    const b = contour[(i + 1) % n]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const l = Math.hypot(ex, ey) || 1
    const nx = ey / l
    const ny = -ex / l
    push(a.x, a.y, 0, nx, ny, 0)
    push(a.x, a.y, -thick, nx, ny, 0)
    push(b.x, b.y, 0, nx, ny, 0)
    push(b.x, b.y, 0, nx, ny, 0)
    push(a.x, a.y, -thick, nx, ny, 0)
    push(b.x, b.y, -thick, nx, ny, 0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.addGroup(0, frontCount, 0)
  geo.addGroup(frontCount + backCount, n * 6, 1)
  geo.addGroup(frontCount, backCount, 2)
  return geo
}
