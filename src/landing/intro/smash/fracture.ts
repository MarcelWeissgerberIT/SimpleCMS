/**
 * Voronoi fracture of the page (world units, origin = screen centre, y up).
 * Seeds sit on jittered rings around the impact → spider-web glass pattern: small wedges near
 * the impact, big plates at the edges. Shared cell edges get one jagged polyline, used both
 * as the shard outline (both neighbours) and as the visible crack — so pieces later separate
 * exactly along the cracks the user watched grow.
 */
import { Delaunay } from 'd3-delaunay'

export type Vec2 = [number, number]

export interface Shard {
  id: number
  /** Counter-clockwise outline (world units). */
  poly: Vec2[]
  cx: number
  cy: number
  /** Distance centroid → impact. */
  dist: number
  /** Seed ring (0 = crater). */
  ring: number
  area: number
  radius: number
}

export interface Crack {
  pts: Vec2[]
  /** Distance of each point to the impact. */
  d: number[]
}

export interface Fracture {
  shards: Shard[]
  cracks: Crack[]
  hairlines: Crack[]
}

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function polyArea(p: Vec2[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % p.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

function centroid(p: Vec2[]): Vec2 {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % p.length]
    const f = x1 * y2 - x2 * y1
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
    a += f
  }
  a *= 0.5
  if (Math.abs(a) < 1e-9) return p[0]
  return [cx / (6 * a), cy / (6 * a)]
}

export function buildFracture(viewW: number, viewH: number, impact: Vec2, mobile: boolean, seed = 1997): Fracture {
  const rand = rng(seed)
  const hw = viewW / 2
  const hh = viewH / 2
  const [ix, iy] = impact
  const pts: Vec2[] = []
  const rings: number[] = []
  const R = mobile ? [0, 0.42, 0.95, 1.7, 2.7, 3.9, 5.2, 6.8, 8.6] : [0, 0.4, 0.95, 1.7, 2.7, 3.9, 5.2, 6.7, 8.4, 10.6]
  const N = mobile ? [1, 5, 7, 8, 9, 10, 10, 9, 8] : [1, 6, 8, 10, 12, 14, 15, 16, 15, 12]
  for (let ri = 0; ri < R.length; ri++) {
    const n = N[ri]
    const phase = rand() * Math.PI * 2
    for (let k = 0; k < n; k++) {
      if (ri === 0) {
        pts.push([ix + (rand() - 0.5) * 0.04, iy + (rand() - 0.5) * 0.04])
        rings.push(0)
        continue
      }
      const a = phase + ((k + (rand() - 0.5) * 0.62) / n) * Math.PI * 2
      const r = R[ri] * (1 + (rand() - 0.5) * 0.34)
      const x = ix + Math.cos(a) * r
      const y = iy + Math.sin(a) * r
      if (x < -hw + 0.12 || x > hw - 0.12 || y < -hh + 0.12 || y > hh - 0.12) continue
      pts.push([x, y])
      rings.push(ri)
    }
  }

  const delaunay = Delaunay.from(pts)
  const vor = delaunay.voronoi([-hw, -hh, hw, hh])
  const eps = 1e-6
  const onBorder = (p: Vec2) => Math.abs(p[0] + hw) < eps || Math.abs(p[0] - hw) < eps || Math.abs(p[1] + hh) < eps || Math.abs(p[1] - hh) < eps
  const sameSide = (a: Vec2, b: Vec2) =>
    (Math.abs(a[0] + hw) < eps && Math.abs(b[0] + hw) < eps) ||
    (Math.abs(a[0] - hw) < eps && Math.abs(b[0] - hw) < eps) ||
    (Math.abs(a[1] + hh) < eps && Math.abs(b[1] + hh) < eps) ||
    (Math.abs(a[1] - hh) < eps && Math.abs(b[1] - hh) < eps)
  const key = (p: Vec2) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`

  const edgeCache = new Map<string, Vec2[]>()
  const cracks: Crack[] = []
  const dist = (p: Vec2) => Math.hypot(p[0] - ix, p[1] - iy)

  /** Jagged polyline from a to b, shared between the two neighbouring cells. */
  function jagged(a: Vec2, b: Vec2): Vec2[] {
    const ka = key(a)
    const kb = key(b)
    const forward = ka < kb
    const ek = forward ? `${ka}|${kb}` : `${kb}|${ka}`
    let line = edgeCache.get(ek)
    if (!line) {
      const p0 = forward ? a : b
      const p1 = forward ? b : a
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
      line = [p0]
      if (!(onBorder(p0) && onBorder(p1) && sameSide(p0, p1))) {
        const segs = Math.max(1, Math.min(9, Math.round(len / 0.24)))
        const nx = -(p1[1] - p0[1]) / (len || 1)
        const ny = (p1[0] - p0[0]) / (len || 1)
        const amp = Math.min(0.075, (len / segs) * 0.3)
        const er = rng(Math.floor((p0[0] * 73.1 + p0[1] * 191.7 + p1[0] * 37.3 + p1[1] * 11.9) * 1000))
        for (let s = 1; s < segs; s++) {
          const t = s / segs + (er() - 0.5) * (0.4 / segs)
          const o = (er() - 0.5) * 2 * amp
          line.push([p0[0] + (p1[0] - p0[0]) * t + nx * o, p0[1] + (p1[1] - p0[1]) * t + ny * o])
        }
        line.push(p1)
        cracks.push({ pts: line, d: line.map(dist) })
      } else {
        line.push(p1)
      }
      edgeCache.set(ek, line)
    }
    return forward ? line.slice(0, -1) : line.slice().reverse().slice(0, -1)
  }

  const shards: Shard[] = []
  for (let i = 0; i < pts.length; i++) {
    const cell = vor.cellPolygon(i) as Vec2[] | null
    if (!cell || cell.length < 4) continue
    let ring = cell.slice(0, -1) as Vec2[]
    if (polyArea(ring) < 0) ring = ring.reverse()
    const poly: Vec2[] = []
    for (let k = 0; k < ring.length; k++) poly.push(...jagged(ring[k], ring[(k + 1) % ring.length]))
    const area = Math.abs(polyArea(poly))
    if (area < 1e-4) continue
    const [cx, cy] = centroid(poly)
    let radius = 0
    for (const p of poly) radius = Math.max(radius, Math.hypot(p[0] - cx, p[1] - cy))
    shards.push({ id: shards.length, poly, cx, cy, dist: Math.hypot(cx - ix, cy - iy), ring: rings[i], area, radius })
  }

  // Decorative hairline cracks: a micro starburst in the crater + short branches near the impact.
  const hairlines: Crack[] = []
  const branchFrom = (x: number, y: number, ang: number, len: number, steps: number) => {
    const line: Vec2[] = [[x, y]]
    let a = ang
    let px = x
    let py = y
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 0.7
      px += Math.cos(a) * (len / steps)
      py += Math.sin(a) * (len / steps)
      line.push([px, py])
    }
    hairlines.push({ pts: line, d: line.map(dist) })
  }
  const burst = mobile ? 12 : 16
  for (let k = 0; k < burst; k++) {
    const a = (k / burst) * Math.PI * 2 + rand() * 0.3
    branchFrom(ix + Math.cos(a) * 0.03, iy + Math.sin(a) * 0.03, a, 0.25 + rand() * 0.55, 4)
  }
  for (const c of cracks) {
    if (c.d[0] > 3.2 || rand() > 0.55) continue
    const j = Math.floor(rand() * c.pts.length)
    const [x, y] = c.pts[j]
    const away = Math.atan2(y - iy, x - ix) + (rand() - 0.5) * 1.6
    branchFrom(x, y, away, 0.18 + rand() * 0.45, 3)
  }

  return { shards, cracks, hairlines }
}
