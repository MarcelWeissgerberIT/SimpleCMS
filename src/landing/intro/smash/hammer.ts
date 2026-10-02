/**
 * A procedurally modelled premium sledgehammer.
 *  - Head: chamfered octagonal steel block (ExtrudeGeometry with bevelled striking faces),
 *    brushed-steel MeshPhysicalMaterial; the faces are lathe-turned (concentric roughness).
 *    A laser-etched spec plate on the cheek ("ONE · 2 KG · FORGED").
 *  - Handle: tapered hickory (LatheGeometry) with a procedural wood-grain CanvasTexture,
 *    varnish clearcoat. Steel overstrike collar, steel wedge in the eye.
 *  - Grip: black ribbed rubber with a signal-orange band.
 * Local frame: head centre at the origin, head axis = Z (striking faces at ±Z),
 * handle runs along +Y to the grip end at y = HANDLE_LEN.
 */
import * as THREE from 'three'

export const HEAD_LEN = 2.3
export const HEAD_W = 0.92
export const HANDLE_LEN = 6.4

export interface Hammer {
  /** Pivot at the grip end; rotate/position this. The model hangs off it toward -Y. */
  pivot: THREE.Group
  /** Head geometry (centred at the head's origin) — reused for the motion-smear ghosts. */
  headGeometry: THREE.BufferGeometry
  dispose(): void
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  draw(cv.getContext('2d')!)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

function brushedRoughness(): THREE.CanvasTexture {
  // continuous lines along v (= the head axis on the extruded sides): seamless brushing
  return canvasTex(256, 64, (c) => {
    c.fillStyle = 'rgb(92,92,92)'
    c.fillRect(0, 0, 256, 64)
    for (let i = 0; i < 520; i++) {
      const x = Math.random() * 256
      const v = 66 + Math.random() * 60
      c.fillStyle = `rgba(${v},${v},${v},${0.3 + Math.random() * 0.5})`
      c.fillRect(x, 0, 0.5 + Math.random() * 1.2, 64)
    }
  })
}

function turnedFace(): THREE.CanvasTexture {
  const t = canvasTex(256, 256, (c) => {
    c.fillStyle = 'rgb(46,46,46)'
    c.fillRect(0, 0, 256, 256)
    for (let r = 2; r < 182; r += 1.6) {
      const v = 30 + Math.random() * 50
      c.strokeStyle = `rgba(${v},${v},${v},0.8)`
      c.lineWidth = 0.8
      c.beginPath()
      c.arc(128, 128, r, 0, Math.PI * 2)
      c.stroke()
    }
  })
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

function woodGrain(): THREE.CanvasTexture {
  const t = canvasTex(256, 1024, (c) => {
    const g = c.createLinearGradient(0, 0, 256, 0)
    g.addColorStop(0, '#b98b5c')
    g.addColorStop(0.3, '#cfa677')
    g.addColorStop(0.55, '#ad7c4e')
    g.addColorStop(0.8, '#c99d6c')
    g.addColorStop(1, '#b98b5c')
    c.fillStyle = g
    c.fillRect(0, 0, 256, 1024)
    // long grain lines running along the handle (v axis)
    for (let i = 0; i < 140; i++) {
      let x = Math.random() * 256
      const dark = Math.random() < 0.7
      c.strokeStyle = dark ? `rgba(90,48,18,${0.12 + Math.random() * 0.3})` : `rgba(255,226,180,${0.08 + Math.random() * 0.18})`
      c.lineWidth = 0.6 + Math.random() * (dark ? 2.6 : 1.4)
      c.beginPath()
      c.moveTo(x, 0)
      for (let y = 0; y <= 1024; y += 32) {
        x += (Math.random() - 0.5) * 3
        c.lineTo(x, y)
      }
      c.stroke()
    }
    // a couple of cathedral flames
    for (let k = 0; k < 3; k++) {
      const cx = 40 + Math.random() * 176
      const cy = Math.random() * 1024
      for (let j = 0; j < 6; j++) {
        c.strokeStyle = `rgba(110,60,22,${0.18 - j * 0.02})`
        c.lineWidth = 1.2
        c.beginPath()
        c.ellipse(cx, cy, 6 + j * 6, 60 + j * 26, 0, 0, Math.PI * 2)
        c.stroke()
      }
    }
  })
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function specPlate(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 160
  const c = cv.getContext('2d')!
  c.clearRect(0, 0, 512, 160)
  c.fillStyle = 'rgba(20,20,22,0.82)'
  c.font = '600 44px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'
  c.textBaseline = 'middle'
  c.fillText('ONE', 92, 58)
  c.font = '500 26px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'
  c.fillText('2 KG · FORGED · REV 26', 92, 112)
  // the One mark: orange tag with a hanger hole
  c.fillStyle = '#ff4f00'
  c.fillRect(14, 36, 62, 62)
  c.fillStyle = '#121210'
  c.beginPath()
  c.arc(27, 49, 4.5, 0, Math.PI * 2)
  c.fill()
  c.fillRect(44, 48, 10, 40)
  c.strokeStyle = 'rgba(20,20,22,0.6)'
  c.lineWidth = 2
  c.strokeRect(4, 26, 504, 108)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function buildHammer(): Hammer {
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x)
    return x
  }

  const pivot = new THREE.Group()
  const model = new THREE.Group()
  model.position.y = -HANDLE_LEN
  pivot.add(model)

  // ---------------------------------------------------------------- head
  const w = HEAD_W / 2
  const ch = 0.17
  const shape = new THREE.Shape()
  shape.moveTo(-w + ch, -w)
  shape.lineTo(w - ch, -w)
  shape.lineTo(w, -w + ch)
  shape.lineTo(w, w - ch)
  shape.lineTo(w - ch, w)
  shape.lineTo(-w + ch, w)
  shape.lineTo(-w, w - ch)
  shape.lineTo(-w, -w + ch)
  shape.closePath()
  const bevelT = 0.11
  const depth = HEAD_LEN - bevelT * 2
  const headGeo = keep(
    new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevelT, bevelSize: 0.075, bevelSegments: 3, curveSegments: 1, steps: 1 }),
  )
  headGeo.translate(0, 0, -depth / 2)
  headGeo.computeVertexNormals()
  const rough = keep(brushedRoughness())
  rough.repeat.set(1.4, 0.6)
  const steel = keep(
    new THREE.MeshPhysicalMaterial({
      color: 0xc9ccd1,
      metalness: 1,
      roughness: 0.32,
      roughnessMap: rough,
      anisotropy: 0.45,
      clearcoat: 0.3,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.0,
    }),
  )
  const face = keep(turnedFace())
  face.repeat.set(1 / (HEAD_W + 0.16), 1 / (HEAD_W + 0.16))
  face.offset.set(0.5, 0.5)
  const polished = keep(
    new THREE.MeshPhysicalMaterial({
      color: 0xc4c7cc,
      metalness: 1,
      roughness: 0.22,
      roughnessMap: face,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.0,
    }),
  )
  // ExtrudeGeometry groups: 0 = caps (striking faces), 1 = sides + bevel
  const head = new THREE.Mesh(headGeo, [polished, steel])
  model.add(head)

  // laser-etched spec plate on one cheek (+X side)
  const plateTex = keep(specPlate())
  const plateMat = keep(new THREE.MeshPhysicalMaterial({ map: plateTex, transparent: true, metalness: 0.6, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  const plateGeo = keep(new THREE.PlaneGeometry(1.25, 0.39))
  const plate = new THREE.Mesh(plateGeo, plateMat)
  plate.position.set(w + 0.001, 0, 0)
  plate.rotation.set(0, Math.PI / 2, 0)
  model.add(plate)
  const plate2 = plate.clone()
  plate2.position.set(-w - 0.001, 0, 0)
  plate2.rotation.set(0, -Math.PI / 2, 0)
  model.add(plate2)

  // ---------------------------------------------------------------- handle (hickory)
  const prof: [number, number][] = [
    [0.0, -w - 0.002],
    [0.15, -w - 0.002],
    [0.155, w],
    [0.172, w + 0.3],
    [0.152, 1.3],
    [0.146, 2.2],
    [0.16, 3.4],
    [0.178, HANDLE_LEN - 1.9],
    [0.19, HANDLE_LEN - 0.4],
    [0.18, HANDLE_LEN - 0.12],
    [0.1, HANDLE_LEN - 0.02],
    [0.0, HANDLE_LEN],
  ]
  const handleGeo = keep(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28))
  const wood = keep(woodGrain())
  wood.repeat.set(1, 1.6)
  const woodMat = keep(
    new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.5, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.3, sheen: 0.2, envMapIntensity: 0.8 }),
  )
  model.add(new THREE.Mesh(handleGeo, woodMat))

  // end grain + steel wedge visible in the eye on the far face
  const endGeo = keep(new THREE.CircleGeometry(0.15, 24))
  const endMat = keep(new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.85 }))
  const end = new THREE.Mesh(endGeo, endMat)
  end.position.set(0, -w - 0.004, 0)
  end.rotation.x = Math.PI / 2
  end.scale.set(1, 1.25, 1)
  model.add(end)
  const darkSteel = keep(new THREE.MeshPhysicalMaterial({ color: 0x5d6168, metalness: 1, roughness: 0.42, clearcoat: 0.2 }))
  const wedgeGeo = keep(new THREE.BoxGeometry(0.035, 0.03, 0.36))
  const wedge = new THREE.Mesh(wedgeGeo, darkSteel)
  wedge.position.set(0, -w - 0.01, 0)
  model.add(wedge)
  const pinGeo = keep(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16))
  const pin = new THREE.Mesh(pinGeo, darkSteel)
  pin.position.set(0, -w - 0.012, 0)
  model.add(pin)

  // overstrike collar
  const collarGeo = keep(new THREE.CylinderGeometry(0.215, 0.2, 0.36, 32, 1, false))
  const collar = new THREE.Mesh(collarGeo, darkSteel)
  collar.position.y = w + 0.18
  model.add(collar)
  const lipGeo = keep(new THREE.TorusGeometry(0.205, 0.022, 10, 32))
  const lip = new THREE.Mesh(lipGeo, steel)
  lip.rotation.x = Math.PI / 2
  lip.position.y = w + 0.36
  model.add(lip)

  // ---------------------------------------------------------------- rubber grip
  const g0 = HANDLE_LEN - 2.05
  const gp: THREE.Vector2[] = []
  for (let y = g0; y <= HANDLE_LEN - 0.08; y += 0.02) {
    const t = (y - g0) / (HANDLE_LEN - g0)
    const base = 0.198 + 0.03 * Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.9
    const rib = Math.pow(Math.max(0, Math.sin(((y - g0) / 0.13) * Math.PI * 2)), 0.6) * 0.022
    gp.push(new THREE.Vector2(base + (t > 0.06 && t < 0.97 ? rib : 0), y))
  }
  gp.push(new THREE.Vector2(0.205, HANDLE_LEN - 0.03))
  gp.push(new THREE.Vector2(0.15, HANDLE_LEN + 0.03))
  gp.push(new THREE.Vector2(0.0, HANDLE_LEN + 0.04))
  const gripGeo = keep(new THREE.LatheGeometry(gp, 32))
  const rubber = keep(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.82, metalness: 0, envMapIntensity: 0.6 }))
  model.add(new THREE.Mesh(gripGeo, rubber))
  const bandGeo = keep(new THREE.CylinderGeometry(0.212, 0.212, 0.09, 32))
  const signal = keep(new THREE.MeshStandardMaterial({ color: 0xff4f00, roughness: 0.45, metalness: 0, emissive: 0x331000 }))
  const band = new THREE.Mesh(bandGeo, signal)
  band.position.y = g0 - 0.02
  model.add(band)

  return {
    pivot,
    headGeometry: headGeo,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
