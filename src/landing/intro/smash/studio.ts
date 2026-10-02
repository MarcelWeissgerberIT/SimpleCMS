/**
 * A procedural photo-studio environment for the hammer's reflections: a dark cyclorama,
 * a big overhead softbox, long strip softboxes around (and behind) the camera and a
 * signal-orange kicker. Metals read as "product shot" — dark body, crisp highlight bands
 * that sweep across the large flat faces as the hammer turns — instead of flat grey.
 */
import * as THREE from 'three'

export function studioEnvironment(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; dispose(): void } {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x060606)
  const disposables: { dispose(): void }[] = []
  /** A light panel; `fade` gives it a gradient along its length (softbox falloff). */
  const panel = (w: number, h: number, color: THREE.Color, pos: [number, number, number], look: [number, number, number], fade = 0) => {
    const geo = new THREE.PlaneGeometry(w, h, 1, 8)
    const cols: number[] = []
    const p = geo.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const k = 1 - fade * (0.5 - p.getY(i) / h) // brighter at the top end
      cols.push(color.r * k, color.g * k, color.b * k)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false })
    const m = new THREE.Mesh(geo, mat)
    m.position.set(...pos)
    m.lookAt(...look)
    scene.add(m)
    disposables.push(geo, mat)
  }
  // dark room shell with a soft vertical gradient (ceiling a touch brighter than the floor)
  const roomGeo = new THREE.SphereGeometry(30, 32, 24)
  const cols: number[] = []
  const p = roomGeo.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 30
    const k = Math.max(0, Math.min(1, (y + 0.4) / 1.4))
    const v = 0.035 + Math.pow(k, 1.6) * 0.16
    cols.push(v, v * 0.99, v * 0.97)
  }
  roomGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })
  scene.add(new THREE.Mesh(roomGeo, roomMat))
  disposables.push(roomGeo, roomMat)
  const warmWhite = (k: number) => new THREE.Color(1, 0.97, 0.93).multiplyScalar(k)
  const coolWhite = (k: number) => new THREE.Color(0.92, 0.96, 1).multiplyScalar(k)
  // floor bounce (warm, dim)
  panel(40, 40, new THREE.Color(0.11, 0.1, 0.09), [0, -9, 0], [0, 0, 0])
  // overhead softbox (key) + a broad dim ceiling scrim, so faces turned up still read as steel
  panel(14, 7, warmWhite(4.2), [-3, 10, 5], [0, 0, 0], 0.5)
  panel(36, 22, coolWhite(0.42), [0, 14, -2], [0, 0, 0], 0.8)
  // long strip softboxes behind / beside the camera: the camera-facing faces reflect these,
  // so the big flat cheeks get bright gradient bands instead of one flat tone
  panel(26, 1.5, warmWhite(5.5), [0, 5.5, 13], [0, 0, 0])
  panel(1.4, 20, coolWhite(4.2), [-9, 0, 11], [0, 0, 0], 0.7)
  panel(22, 0.9, coolWhite(2.2), [2, -4.5, 14], [0, 0, 0])
  // tall side strips (edge definition)
  panel(1.6, 16, warmWhite(3.8), [-13, 1, 1], [0, 0, 0], 0.4)
  panel(1.2, 16, coolWhite(2.8), [12, 1, 5], [0, 0, 0], 0.4)
  // warm signal-orange kicker from behind
  panel(1.6, 10, new THREE.Color(1, 0.32, 0.04).multiplyScalar(3), [9, 2, -10], [0, 0, 0])

  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0.02)
  pmrem.dispose()
  for (const d of disposables) d.dispose()
  return { texture: rt.texture, dispose: () => rt.dispose() }
}
