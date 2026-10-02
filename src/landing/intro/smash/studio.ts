/**
 * A procedural photo-studio environment for the hammer's reflections: a dark cyclorama
 * with a big overhead softbox, two tall strip lights and a signal-orange kicker. Metals
 * read as "product shot" (dark body, crisp highlight bands) instead of flat grey.
 */
import * as THREE from 'three'

export function studioEnvironment(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; dispose(): void } {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0c0c0d)
  const disposables: { dispose(): void }[] = []
  const panel = (w: number, h: number, color: THREE.Color, pos: [number, number, number], look: [number, number, number]) => {
    const geo = new THREE.PlaneGeometry(w, h)
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false })
    const m = new THREE.Mesh(geo, mat)
    m.position.set(...pos)
    m.lookAt(...look)
    scene.add(m)
    disposables.push(geo, mat)
  }
  // room shell with a vertical gradient (bright ceiling → dark floor) for smooth metal falloff
  const roomGeo = new THREE.SphereGeometry(30, 32, 24)
  const cols: number[] = []
  const p = roomGeo.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 30
    const z = p.getZ(i) / 30
    const k = Math.max(0, Math.min(1, (y + 0.35) / 1.35))
    const v = 0.16 + Math.pow(k, 1.1) * 0.6 + Math.max(0, z) * 0.25
    cols.push(v, v * 0.99, v * 0.97)
  }
  roomGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })
  scene.add(new THREE.Mesh(roomGeo, roomMat))
  disposables.push(roomGeo, roomMat)
  // floor bounce
  panel(40, 40, new THREE.Color(0.2, 0.19, 0.18), [0, -9, 0], [0, 0, 0])
  // overhead softbox (key)
  panel(14, 8, new THREE.Color(1, 0.97, 0.93).multiplyScalar(3.6), [-3, 10, 6], [0, 0, 0])
  // tall strip lights
  panel(1.6, 16, new THREE.Color(1, 1, 1).multiplyScalar(3.6), [-11, 1, 3], [0, 0, 0])
  panel(1.2, 16, new THREE.Color(0.9, 0.95, 1).multiplyScalar(2.6), [10, 1, 7], [0, 0, 0])
  // warm signal-orange kicker from behind
  panel(1.6, 10, new THREE.Color(1, 0.32, 0.04).multiplyScalar(3), [9, 2, -10], [0, 0, 0])
  // big soft front card (camera side) → bright gradient band on the cheeks
  panel(22, 7, new THREE.Color(1, 0.98, 0.95).multiplyScalar(0.7), [-2, 4, 14], [0, 0, 0])

  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0.02)
  pmrem.dispose()
  for (const d of disposables) d.dispose()
  return { texture: rt.texture, dispose: () => rt.dispose() }
}
