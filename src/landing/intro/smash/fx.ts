/**
 * Impact effects: plaster/glass chips (instanced), orange sparks (instanced, additive),
 * soft dust (points), an expanding shockwave ring and the hammer's contact shadow.
 * Fixed-size pools — nothing is allocated during the sequence.
 */
import * as THREE from 'three'
import { dustFragment, dustVertex, ringFragment, ringVertex, shadowFragment } from './shaders'

const GRAVITY = 24
const X_AXIS = new THREE.Vector3(1, 0, 0)

interface Particle {
  alive: boolean
  life: number
  max: number
  p: THREE.Vector3
  v: THREE.Vector3
  axis: THREE.Vector3
  spin: number
  angle: number
  size: number
}

function pool(n: number): Particle[] {
  return Array.from({ length: n }, () => ({
    alive: false,
    life: 0,
    max: 1,
    p: new THREE.Vector3(),
    v: new THREE.Vector3(),
    axis: new THREE.Vector3(0, 1, 0),
    spin: 0,
    angle: 0,
    size: 1,
  }))
}

export class Fx {
  readonly group = new THREE.Group()
  private chips: Particle[]
  private chipMesh: THREE.InstancedMesh
  private sparks: Particle[]
  private sparkMesh: THREE.InstancedMesh
  private dust: Particle[]
  private dustGeo: THREE.BufferGeometry
  private dustMat: THREE.ShaderMaterial
  private rings: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; dur: number; size: number; alive: boolean }[] = []
  readonly shadow: THREE.Mesh
  private shadowMat: THREE.ShaderMaterial
  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpS = new THREE.Vector3()
  private tmpV = new THREE.Vector3()
  private disposables: { dispose(): void }[] = []

  constructor(private rand: () => number, mobile: boolean, pixelScale: number) {
    // chips
    const chipGeo = new THREE.IcosahedronGeometry(1, 0)
    const chipMat = new THREE.MeshStandardMaterial({ color: 0xe4ded2, roughness: 0.75, metalness: 0, flatShading: true })
    this.chips = pool(mobile ? 60 : 110)
    this.chipMesh = new THREE.InstancedMesh(chipGeo, chipMat, this.chips.length)
    this.chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.chipMesh.frustumCulled = false
    this.chipMesh.count = this.chips.length
    // sparks
    const sparkGeo = new THREE.BoxGeometry(1, 1, 1)
    sparkGeo.translate(-0.5, 0, 0)
    const sparkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.62, 0.26).multiplyScalar(2.2),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    this.sparks = pool(mobile ? 40 : 70)
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, this.sparks.length)
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.sparkMesh.frustumCulled = false
    this.sparkMesh.renderOrder = 6
    // dust
    this.dust = pool(mobile ? 70 : 120)
    this.dustGeo = new THREE.BufferGeometry()
    const n = this.dust.length
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage))
    this.dustGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage))
    this.dustGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage))
    const seeds = new Float32Array(n)
    for (let i = 0; i < n; i++) seeds[i] = rand()
    this.dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: pixelScale }, uColor: { value: new THREE.Color(0.72, 0.69, 0.64) } },
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    const points = new THREE.Points(this.dustGeo, this.dustMat)
    points.frustumCulled = false
    points.renderOrder = 7
    // rings
    const ringGeo = new THREE.PlaneGeometry(1, 1)
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uThick: { value: 0.25 }, uColor: { value: new THREE.Color(1, 0.93, 0.85) } },
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(ringGeo, mat)
      mesh.visible = false
      mesh.renderOrder = 5
      this.rings.push({ mesh, mat, t: 0, dur: 0.35, size: 4, alive: false })
      this.group.add(mesh)
      this.disposables.push(mat)
    }
    // contact shadow
    this.shadowMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uSoft: { value: 0.8 } },
      vertexShader: ringVertex,
      fragmentShader: shadowFragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    this.shadow = new THREE.Mesh(ringGeo, this.shadowMat)
    this.shadow.renderOrder = 2
    this.shadow.visible = false

    this.group.add(this.chipMesh, this.sparkMesh, points, this.shadow)
    this.disposables.push(chipGeo, chipMat, sparkGeo, sparkMat, this.dustGeo, this.dustMat, ringGeo, this.shadowMat)
    this.hideAll()
  }

  private hideAll() {
    this.tmpM.makeScale(0, 0, 0)
    for (let i = 0; i < this.chips.length; i++) this.chipMesh.setMatrixAt(i, this.tmpM)
    for (let i = 0; i < this.sparks.length; i++) this.sparkMesh.setMatrixAt(i, this.tmpM)
    this.chipMesh.instanceMatrix.needsUpdate = true
    this.sparkMesh.instanceMatrix.needsUpdate = true
  }

  private take(arr: Particle[]): Particle | null {
    for (const p of arr) if (!p.alive) return p
    return null
  }

  burst(at: THREE.Vector3, power: number, counts: { chips: number; sparks: number; dust: number }) {
    const r = this.rand
    for (let i = 0; i < counts.chips; i++) {
      const p = this.take(this.chips)
      if (!p) break
      const a = r() * Math.PI * 2
      const sp = (2.5 + r() * 7) * power
      p.alive = true
      p.life = 0
      p.max = 0.9 + r() * 0.9
      p.p.set(at.x + (r() - 0.5) * 0.3, at.y + (r() - 0.5) * 0.3, 0.05)
      p.v.set(Math.cos(a) * sp, Math.sin(a) * sp + 2 * power, (2 + r() * 7) * power)
      p.axis.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize()
      p.spin = (r() - 0.5) * 30
      p.angle = 0
      p.size = 0.025 + Math.pow(r(), 2.5) * 0.09 * (0.6 + power * 0.4)
    }
    for (let i = 0; i < counts.sparks; i++) {
      const p = this.take(this.sparks)
      if (!p) break
      const a = r() * Math.PI * 2
      const sp = (6 + r() * 12) * power
      p.alive = true
      p.life = 0
      p.max = 0.12 + r() * 0.3
      p.p.set(at.x, at.y, 0.1)
      p.v.set(Math.cos(a) * sp, Math.sin(a) * sp + 2, (1 + r() * 6) * power)
      p.size = 0.012 + r() * 0.02
    }
    this.puff(at, counts.dust, 0.25, 1.3 * power, 0.9)
  }

  /** Soft dust: spawn around `at` within `spread` units. */
  puff(at: THREE.Vector3, count: number, spread: number, speed: number, life: number) {
    const r = this.rand
    for (let i = 0; i < count; i++) {
      const p = this.take(this.dust)
      if (!p) break
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * spread
      p.alive = true
      p.life = 0
      p.max = life * (0.6 + r() * 0.8)
      p.p.set(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, 0.1 + r() * 0.4)
      const sp = speed * (0.3 + r())
      p.v.set(Math.cos(a) * sp, Math.sin(a) * sp + 0.4, (0.5 + r() * 1.5) * speed)
      p.size = 0.45 + r() * 1.05
      p.angle = 0.22 + r() * 0.3
    }
  }

  ring(at: THREE.Vector3, size: number, dur: number, thick = 0.22) {
    const ring = this.rings.find((x) => !x.alive) ?? this.rings[0]
    ring.alive = true
    ring.t = 0
    ring.dur = dur
    ring.size = size
    ring.mat.uniforms.uThick.value = thick
    ring.mesh.position.set(at.x, at.y, 0.06)
    ring.mesh.visible = true
  }

  setShadow(x: number, y: number, size: number, alpha: number, soft: number) {
    this.shadow.visible = alpha > 0.003
    this.shadow.position.set(x, y, 0.02)
    this.shadow.scale.set(size * 1.25, size, 1)
    this.shadowMat.uniforms.uAlpha.value = alpha
    this.shadowMat.uniforms.uSoft.value = soft
  }

  get busy(): boolean {
    return this.dust.some((p) => p.alive) || this.chips.some((p) => p.alive)
  }

  update(dt: number) {
    // chips
    for (let i = 0; i < this.chips.length; i++) {
      const p = this.chips[i]
      if (!p.alive) continue
      p.life += dt
      if (p.life >= p.max || p.p.y < -9) {
        p.alive = false
        this.tmpM.makeScale(0, 0, 0)
        this.chipMesh.setMatrixAt(i, this.tmpM)
        continue
      }
      p.v.y -= GRAVITY * dt
      p.v.multiplyScalar(1 - 0.6 * dt)
      p.p.addScaledVector(p.v, dt)
      p.angle += p.spin * dt
      this.tmpQ.setFromAxisAngle(p.axis, p.angle)
      const s = p.size * (1 - Math.pow(p.life / p.max, 4))
      this.tmpS.set(s, s * 0.7, s * 0.45)
      this.tmpM.compose(p.p, this.tmpQ, this.tmpS)
      this.chipMesh.setMatrixAt(i, this.tmpM)
    }
    this.chipMesh.instanceMatrix.needsUpdate = true
    // sparks: stretched along velocity
    for (let i = 0; i < this.sparks.length; i++) {
      const p = this.sparks[i]
      if (!p.alive) continue
      p.life += dt
      if (p.life >= p.max) {
        p.alive = false
        this.tmpM.makeScale(0, 0, 0)
        this.sparkMesh.setMatrixAt(i, this.tmpM)
        continue
      }
      p.v.y -= GRAVITY * 0.6 * dt
      p.p.addScaledVector(p.v, dt)
      const speed = p.v.length()
      this.tmpV.copy(p.v).normalize()
      this.tmpQ.setFromUnitVectors(X_AXIS, this.tmpV)
      const k = 1 - p.life / p.max
      this.tmpS.set(Math.min(0.9, speed * 0.035) * k, p.size * k, p.size * k)
      this.tmpM.compose(p.p, this.tmpQ, this.tmpS)
      this.sparkMesh.setMatrixAt(i, this.tmpM)
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true
    // dust
    const pos = this.dustGeo.getAttribute('position') as THREE.BufferAttribute
    const size = this.dustGeo.getAttribute('aSize') as THREE.BufferAttribute
    const alpha = this.dustGeo.getAttribute('aAlpha') as THREE.BufferAttribute
    for (let i = 0; i < this.dust.length; i++) {
      const p = this.dust[i]
      if (!p.alive) {
        alpha.setX(i, 0)
        continue
      }
      p.life += dt
      if (p.life >= p.max) {
        p.alive = false
        alpha.setX(i, 0)
        continue
      }
      p.v.multiplyScalar(1 - 2.2 * dt)
      p.v.y -= 0.6 * dt
      p.p.addScaledVector(p.v, dt)
      const k = p.life / p.max
      pos.setXYZ(i, p.p.x, p.p.y, p.p.z)
      size.setX(i, p.size * (0.5 + k * 1.6))
      alpha.setX(i, p.angle * Math.min(1, k * 8) * (1 - k) * (1 - k))
    }
    pos.needsUpdate = true
    size.needsUpdate = true
    alpha.needsUpdate = true
    // rings
    for (const ring of this.rings) {
      if (!ring.alive) continue
      ring.t += dt
      const k = ring.t / ring.dur
      if (k >= 1) {
        ring.alive = false
        ring.mesh.visible = false
        continue
      }
      const e = 1 - Math.pow(1 - k, 3)
      const s = 0.2 + e * ring.size
      ring.mesh.scale.set(s, s, 1)
      ring.mat.uniforms.uAlpha.value = 0.85 * (1 - k) * (1 - k)
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.chipMesh.dispose()
    this.sparkMesh.dispose()
  }
}
