/**
 * Paints the crack network once into two canvases (uploaded once as textures):
 *  - crack: dark fissure + light chipped edge, thicker near the impact, a powdered crater
 *  - glow:  soft blurred strokes along the same cracks (warm light leaking through)
 * The shader reveals both progressively by distance from the impact, so the cracks "grow"
 * without re-uploading anything.
 */
import type { Crack, Fracture, Vec2 } from './fracture'
import { rng } from './fracture'

export interface CrackTextures {
  crack: HTMLCanvasElement
  glow: HTMLCanvasElement
}

export function paintCracks(fr: Fracture, viewW: number, viewH: number, impact: Vec2, pxW: number, pxH: number, pxPerCss: number): CrackTextures {
  const crack = document.createElement('canvas')
  crack.width = pxW
  crack.height = pxH
  const ctx = crack.getContext('2d')!
  const sx = pxW / viewW
  const sy = pxH / viewH
  const X = (x: number) => (x + viewW / 2) * sx
  const Y = (y: number) => (viewH / 2 - y) * sy
  const s = pxPerCss
  const rand = rng(4711)

  const path = (c: Crack, ox = 0, oy = 0) => {
    ctx.beginPath()
    c.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x) + ox, Y(y) + oy) : ctx.moveTo(X(x) + ox, Y(y) + oy)))
  }
  const width = (d: number) => {
    const k = Math.min(1, d / 6)
    return (2.1 - 1.2 * k) * s
  }

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Powdered crater.
  const [ix, iy] = impact
  const cr = 0.5 * sx
  const grad = ctx.createRadialGradient(X(ix), Y(iy), 0, X(ix), Y(iy), cr)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.35, 'rgba(238,236,230,0.7)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(X(ix), Y(iy), cr, 0, Math.PI * 2)
  ctx.fill()
  for (let i = 0; i < 160; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.pow(rand(), 1.7) * 0.55
    ctx.fillStyle = rand() < 0.5 ? 'rgba(30,28,25,0.55)' : 'rgba(255,255,255,0.9)'
    const sz = (0.6 + rand() * 1.8) * s
    ctx.fillRect(X(ix + Math.cos(a) * r), Y(iy + Math.sin(a) * r), sz, sz)
  }

  const all = [...fr.cracks, ...fr.hairlines.map((h) => ({ ...h, hair: true }))] as (Crack & { hair?: boolean })[]

  // 1) soft shadow under each fissure (depth)
  for (const c of all) {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    ctx.lineWidth = width(c.d[0]) * (c.hair ? 1.6 : 2.4)
    path(c)
    ctx.stroke()
  }
  // 2) chipped light edge (offset toward the light: up-left)
  for (const c of all) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = Math.max(0.7 * s, width(c.d[0]) * (c.hair ? 0.4 : 0.55))
    path(c, -0.8 * s, -0.8 * s)
    ctx.stroke()
  }
  // 3) dark fissure core
  for (const c of all) {
    ctx.strokeStyle = c.hair ? 'rgba(14,14,13,0.75)' : 'rgba(10,10,9,0.96)'
    ctx.lineWidth = width(c.d[0]) * (c.hair ? 0.45 : 0.7)
    path(c)
    ctx.stroke()
  }
  // 4) spall chips along cracks near the impact
  for (const c of fr.cracks) {
    for (let i = 1; i < c.pts.length; i++) {
      if (c.d[i] > 2.6 || rand() > 0.5) continue
      const [x, y] = c.pts[i]
      const sz = (1.5 + rand() * 3.5) * s * (1 - c.d[i] / 3)
      ctx.fillStyle = 'rgba(250,248,244,0.95)'
      ctx.beginPath()
      ctx.moveTo(X(x), Y(y))
      ctx.lineTo(X(x) + (rand() - 0.5) * sz * 2, Y(y) + (rand() - 0.5) * sz * 2)
      ctx.lineTo(X(x) + (rand() - 0.5) * sz * 2, Y(y) + (rand() - 0.5) * sz * 2)
      ctx.closePath()
      ctx.fill()
    }
  }

  // Glow: quarter resolution, cheap blur via stacked strokes.
  const glow = document.createElement('canvas')
  const g = 4
  glow.width = Math.max(64, Math.round(pxW / g))
  glow.height = Math.max(64, Math.round(pxH / g))
  const gx = glow.getContext('2d')!
  const gsx = glow.width / viewW
  const gsy = glow.height / viewH
  const GX = (x: number) => (x + viewW / 2) * gsx
  const GY = (y: number) => (viewH / 2 - y) * gsy
  gx.lineJoin = 'round'
  gx.lineCap = 'round'
  const passes: [number, number][] = [
    [11, 0.08],
    [6, 0.18],
    [2.6, 0.55],
    [1.1, 0.9],
  ]
  for (const [w, a] of passes) {
    for (const c of fr.cracks) {
      const near = Math.pow(Math.max(0.07, 1 - c.d[0] / 7.5), 1.4)
      gx.strokeStyle = `rgba(255,255,255,${(a * near).toFixed(3)})`
      gx.lineWidth = w * (0.6 + near * 0.8) * (s / 1.5)
      gx.beginPath()
      c.pts.forEach(([x, y], i) => (i ? gx.lineTo(GX(x), GY(y)) : gx.moveTo(GX(x), GY(y))))
      gx.stroke()
    }
  }
  const hg = gx.createRadialGradient(GX(ix), GY(iy), 0, GX(ix), GY(iy), 1.4 * gsx)
  hg.addColorStop(0, 'rgba(255,255,255,0.9)')
  hg.addColorStop(1, 'rgba(255,255,255,0)')
  gx.fillStyle = hg
  gx.fillRect(0, 0, glow.width, glow.height)

  return { crack, glow }
}
