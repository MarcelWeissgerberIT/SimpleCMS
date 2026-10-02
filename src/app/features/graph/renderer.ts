/**
 * Canvas graph renderer. d3-force simulation ticked manually inside requestAnimationFrame;
 * the loop stops as soon as the layout has settled and nothing is moving (no idle CPU).
 * World → screen transform: screen = world * k + (tx, ty). Respects devicePixelRatio.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from 'd3-force'
import type { ID } from '../../store/types'
import type { GEdge, GNode } from './model'

export interface RendererCallbacks {
  onHover: (node: GNode | null, x: number, y: number) => void
  onOpen: (node: GNode, ev: PointerEvent) => void
  onState: (s: { settled: boolean; zoom: number; alpha: number }) => void
}

interface Palette {
  ink: string
  ink2: string
  ink3: string
  rule: string
  ruleStrong: string
  signal: string
  bg: string
  surface: string
  font: string
  mono: string
}

/** Layout survives route changes / toggles. */
const positionCache = new Map<ID, { x: number; y: number }>()
let viewCache: { k: number; tx: number; ty: number } | null = null

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const nodeOf = (end: ID | GNode) => end as GNode

export class GraphRenderer {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private dpr = 1
  k = 1
  tx = 0
  ty = 0
  private sim: Simulation<GNode, GEdge>
  private nodes: GNode[] = []
  private edges: GEdge[] = []
  private byId = new Map<ID, GNode>()
  private neighbors = new Map<ID, Set<ID>>()
  private hoverId: ID | null = null
  focusId: ID | null = null
  currentId: ID | null = null
  private colors!: Palette
  private raf = 0
  private dirty = true
  private autoFit = true
  private settled = false
  private lastState = 0
  private drag: { node: GNode; x: number; y: number; moved: boolean; id: number } | null = null
  private pan: { x: number; y: number; tx: number; ty: number; id: number } | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private pinch: { d: number; k: number; mx: number; my: number; tx: number; ty: number } | null = null
  private anim: { from: { k: number; tx: number; ty: number }; to: { k: number; tx: number; ty: number }; t0: number; dur: number } | null = null
  private ro: ResizeObserver
  private mo: MutationObserver
  private reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  constructor(
    private canvas: HTMLCanvasElement,
    private wrap: HTMLElement,
    private cb: RendererCallbacks,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: true })!
    this.readColors()
    this.sim = forceSimulation<GNode, GEdge>()
      .stop()
      .alphaDecay(0.03)
      .velocityDecay(0.36)
      .force(
        'link',
        forceLink<GNode, GEdge>()
          .id((d) => d.id)
          .distance((e) => (e.kind === 'tree' ? (nodeOf(e.target).kind === 'row' ? 18 : 30 + nodeOf(e.target).r + nodeOf(e.source).r) : 70))
          .strength((e) => (e.kind === 'tree' ? 0.55 : 0.16)),
      )
      .force(
        'charge',
        forceManyBody<GNode>()
          .strength((d) => (d.kind === 'row' ? -14 : -60 - d.degree * 5))
          .distanceMax(460)
          .theta(0.9),
      )
      .force('x', forceX<GNode>(0).strength(0.05))
      .force('y', forceY<GNode>(0).strength(0.05))
      .force('collide', forceCollide<GNode>((d) => d.r + 3).iterations(1))
    if (viewCache) {
      ;({ k: this.k, tx: this.tx, ty: this.ty } = viewCache)
      this.autoFit = false
    }

    this.resize()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(wrap)
    this.mo = new MutationObserver(() => {
      this.readColors()
      this.invalidate()
    })
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('dblclick', this.onDbl)
  }

  destroy() {
    this.savePositions()
    // only remember a view the user actually chose (StrictMode mounts twice before any data)
    if (this.nodes.length && !this.autoFit) viewCache = { k: this.k, tx: this.tx, ty: this.ty }
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.mo.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onDown)
    this.canvas.removeEventListener('pointermove', this.onMove)
    this.canvas.removeEventListener('pointerup', this.onUp)
    this.canvas.removeEventListener('pointercancel', this.onUp)
    this.canvas.removeEventListener('pointerleave', this.onLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('dblclick', this.onDbl)
  }

  /* ---------------------------------------------------------------- */
  /* data                                                              */
  /* ---------------------------------------------------------------- */

  setData(nodes: GNode[], edges: GEdge[]) {
    const prev = this.byId
    this.savePositions()
    const fresh = prev.size === 0
    this.byId = new Map(nodes.map((n) => [n.id, n]))
    // carry positions: previous node object → cache → near a positioned neighbour
    const adj = new Map<ID, ID[]>()
    for (const e of edges) {
      const a = e.source as ID
      const b = e.target as ID
      adj.set(a, [...(adj.get(a) ?? []), b])
      adj.set(b, [...(adj.get(b) ?? []), a])
    }
    let placed = 0
    for (const n of nodes) {
      const old = prev.get(n.id) ?? positionCache.get(n.id)
      if (old && Number.isFinite(old.x)) {
        n.x = old.x
        n.y = old.y
        placed++
      }
    }
    for (const n of nodes) {
      if (n.x !== undefined) continue
      const near = (adj.get(n.id) ?? []).map((id) => this.byId.get(id)).find((m) => m?.x !== undefined)
      if (near) {
        n.x = near.x! + (Math.random() - 0.5) * 30
        n.y = near.y! + (Math.random() - 0.5) * 30
      }
    }
    this.nodes = nodes
    this.edges = edges
    const links = edges.filter((e) => e.kind === 'link').length
    this.linkAlpha = Math.max(0.24, 0.78 * Math.sqrt(500 / Math.max(500, links)))
    this.neighbors = new Map()
    for (const n of nodes) this.neighbors.set(n.id, new Set())
    for (const e of edges) {
      this.neighbors.get(e.source as ID)?.add(e.target as ID)
      this.neighbors.get(e.target as ID)?.add(e.source as ID)
    }
    this.sim.nodes(nodes)
    ;(this.sim.force('link') as ReturnType<typeof forceLink<GNode, GEdge>>).links(edges)
    this.sim.alphaDecay(nodes.length > 500 ? 0.045 : 0.03)
    const mostlyPlaced = placed > nodes.length * 0.8
    this.sim.alpha(mostlyPlaced ? 0.25 : fresh ? 1 : 0.6)
    // big graphs: pre-settle off-screen so the first frame is already readable
    if (!mostlyPlaced && nodes.length > 250) for (let i = 0; i < 90; i++) this.sim.tick()
    if (this.reduced) for (let i = 0; i < 300 && this.sim.alpha() > this.sim.alphaMin(); i++) this.sim.tick()
    if (this.hoverId && !this.byId.has(this.hoverId)) this.hoverId = null
    if (this.focusId && !this.byId.has(this.focusId)) this.focusId = null
    this.settled = false
    this.invalidate()
  }

  /** dense graphs get fainter links so structure stays readable */
  private linkAlpha = 0.78

  get counts() {
    let tree = 0
    let link = 0
    for (const e of this.edges) e.kind === 'tree' ? tree++ : link++
    return { nodes: this.nodes.length, tree, link }
  }

  /* ---------------------------------------------------------------- */
  /* view                                                              */
  /* ---------------------------------------------------------------- */

  private readColors() {
    const cs = getComputedStyle(document.documentElement)
    const v = (n: string) => cs.getPropertyValue(n).trim()
    this.colors = {
      ink: v('--ink'),
      ink2: v('--ink-2'),
      ink3: v('--ink-3'),
      rule: v('--rule'),
      ruleStrong: v('--rule-strong'),
      signal: v('--signal'),
      bg: v('--bg'),
      surface: v('--surface'),
      font: v('--font-sans') || 'sans-serif',
      mono: v('--font-mono') || 'monospace',
    }
  }

  private resize() {
    const r = this.wrap.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.w = Math.max(1, r.width)
    this.h = Math.max(1, r.height)
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.canvas.style.width = `${this.w}px`
    this.canvas.style.height = `${this.h}px`
    this.invalidate()
  }

  invalidate() {
    this.dirty = true
    if (!this.raf) this.raf = requestAnimationFrame(this.loop)
  }

  reheat() {
    this.sim.alpha(0.9)
    this.settled = false
    this.invalidate()
  }

  private fitTarget(pad = 60) {
    if (!this.nodes.length) return { k: 1, tx: this.w / 2, ty: this.h / 2 }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const n of this.nodes) {
      x0 = Math.min(x0, n.x! - n.r)
      y0 = Math.min(y0, n.y! - n.r)
      x1 = Math.max(x1, n.x! + n.r)
      y1 = Math.max(y1, n.y! + n.r)
    }
    const bw = Math.max(40, x1 - x0)
    const bh = Math.max(40, y1 - y0)
    const k = clamp(Math.min((this.w - pad * 2) / bw, (this.h - pad * 2) / bh), 0.12, 1.8)
    return { k, tx: this.w / 2 - ((x0 + x1) / 2) * k, ty: this.h / 2 - ((y0 + y1) / 2) * k }
  }

  fit(animate = true) {
    this.autoFit = false
    this.animateTo(this.fitTarget(), animate)
  }

  zoomBy(f: number) {
    this.autoFit = false
    const k = clamp(this.k * f, 0.08, 4)
    const mx = this.w / 2
    const my = this.h / 2
    this.animateTo({ k, tx: mx - ((mx - this.tx) * k) / this.k, ty: my - ((my - this.ty) * k) / this.k }, true)
  }

  focusNode(id: ID) {
    const n = this.byId.get(id)
    if (!n) return
    this.autoFit = false
    this.focusId = id
    const k = Math.max(this.k, 1.4)
    this.animateTo({ k, tx: this.w / 2 - n.x! * k, ty: this.h / 2 - n.y! * k }, true)
  }

  clearFocus() {
    this.focusId = null
    this.invalidate()
  }

  private animateTo(to: { k: number; tx: number; ty: number }, animate: boolean) {
    if (!animate || this.reduced) {
      ;({ k: this.k, tx: this.tx, ty: this.ty } = to)
      this.anim = null
    } else this.anim = { from: { k: this.k, tx: this.tx, ty: this.ty }, to, t0: performance.now(), dur: 420 }
    this.invalidate()
  }

  private toWorld(sx: number, sy: number) {
    return { x: (sx - this.tx) / this.k, y: (sy - this.ty) / this.k }
  }

  private hit(sx: number, sy: number): GNode | null {
    const { x, y } = this.toWorld(sx, sy)
    let best: GNode | null = null
    let bestD = Infinity
    const slop = 5 / this.k
    for (const n of this.nodes) {
      const dx = n.x! - x
      const dy = n.y! - y
      const d = Math.hypot(dx, dy)
      if (d <= n.r + slop && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  private savePositions() {
    for (const n of this.nodes) if (Number.isFinite(n.x)) positionCache.set(n.id, { x: n.x!, y: n.y! })
  }

  /* ---------------------------------------------------------------- */
  /* loop                                                              */
  /* ---------------------------------------------------------------- */

  private loop = (now: number) => {
    this.raf = 0
    let moving = false
    if (this.sim.alpha() > this.sim.alphaMin() || this.drag) {
      // large graphs settle in fewer rendered frames
      this.sim.tick(this.nodes.length > 600 && !this.drag ? 2 : 1)
      moving = true
      this.dirty = true
    }
    if (this.anim) {
      const p = Math.min(1, (now - this.anim.t0) / this.anim.dur)
      const e = easeOut(p)
      const { from, to } = this.anim
      this.k = from.k + (to.k - from.k) * e
      this.tx = from.tx + (to.tx - from.tx) * e
      this.ty = from.ty + (to.ty - from.ty) * e
      if (p >= 1) this.anim = null
      moving = true
      this.dirty = true
    } else if (this.autoFit && moving && this.nodes.length) {
      // follow the settling layout until the user takes over
      const f = this.fitTarget()
      this.k += (f.k - this.k) * 0.12
      this.tx += (f.tx - this.tx) * 0.12
      this.ty += (f.ty - this.ty) * 0.12
    }
    if (this.dirty) {
      this.draw()
      this.dirty = false
    }
    const settled = !moving
    if (settled !== this.settled || now - this.lastState > 250) {
      this.settled = settled
      this.lastState = now
      if (settled) this.savePositions()
      this.cb.onState({ settled, zoom: this.k, alpha: this.sim.alpha() })
    }
    if (moving) this.raf = requestAnimationFrame(this.loop)
  }

  private draw() {
    const { ctx, colors: c, k } = this
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    this.syncGrid()
    if (!this.nodes.length) return
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * this.tx, this.dpr * this.ty)

    const hi = this.hoverId ?? this.focusId
    const nb = hi ? this.neighbors.get(hi) : undefined
    const lit = (id: ID) => !hi || id === hi || !!nb?.has(id)
    const touches = (e: GEdge) => !!hi && (nodeOf(e.source).id === hi || nodeOf(e.target).id === hi)
    // visible world rect (+margin) for culling
    const m = 40 / k
    const vx0 = -this.tx / k - m
    const vy0 = -this.ty / k - m
    const vx1 = (this.w - this.tx) / k + m
    const vy1 = (this.h - this.ty) / k + m
    const inView = (n: GNode) => n.x! + n.r > vx0 && n.x! - n.r < vx1 && n.y! + n.r > vy0 && n.y! - n.r < vy1
    const edgeInView = (a: GNode, b: GNode) =>
      !((a.x! < vx0 && b.x! < vx0) || (a.x! > vx1 && b.x! > vx1) || (a.y! < vy0 && b.y! < vy0) || (a.y! > vy1 && b.y! > vy1))

    const strokeEdges = (kind: GEdge['kind'], highlighted: boolean) => {
      ctx.beginPath()
      for (const e of this.edges) {
        if (e.kind !== kind || touches(e) !== highlighted) continue
        const a = nodeOf(e.source)
        const b = nodeOf(e.target)
        if (!edgeInView(a, b)) continue
        ctx.moveTo(a.x!, a.y!)
        ctx.lineTo(b.x!, b.y!)
      }
      ctx.stroke()
    }

    ctx.lineCap = 'butt'
    // bulk layers as exact 1px hairlines (cheap to rasterize, even without a GPU)
    ctx.lineWidth = 1 / k
    ctx.strokeStyle = c.ruleStrong
    ctx.globalAlpha = hi ? 0.35 : 1
    strokeEdges('tree', false)
    // links / mentions in signal orange
    ctx.strokeStyle = c.signal
    ctx.globalAlpha = hi ? 0.16 : this.linkAlpha
    strokeEdges('link', false)
    if (hi) {
      ctx.globalAlpha = 1
      ctx.lineWidth = 1.4 / k
      ctx.strokeStyle = c.ink2
      strokeEdges('tree', true)
      ctx.lineWidth = 2.2 / k
      ctx.strokeStyle = c.signal
      strokeEdges('link', true)
    }

    // nodes, batched into one path per (colour, alpha)
    const batches: Record<string, GNode[]> = { ink: [], row: [], inkDim: [], rowDim: [], hi: [] }
    for (const n of this.nodes) {
      if (!inView(n)) continue
      if (n.id === hi) batches.hi.push(n)
      else if (lit(n.id)) (n.kind === 'row' ? batches.row : batches.ink).push(n)
      else (n.kind === 'row' ? batches.rowDim : batches.inkDim).push(n)
    }
    const fillBatch = (list: GNode[], color: string, alpha: number) => {
      if (!list.length) return
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.beginPath()
      for (const n of list) {
        if (n.kind === 'database') {
          const s = n.r * 0.9
          ctx.rect(n.x! - s, n.y! - s, s * 2, s * 2)
        } else {
          ctx.moveTo(n.x! + n.r, n.y!)
          ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2)
        }
      }
      ctx.fill()
    }
    fillBatch(batches.inkDim, c.ink, 0.16)
    fillBatch(batches.rowDim, c.ink3, 0.16)
    fillBatch(batches.row, c.ink3, 1)
    fillBatch(batches.ink, c.ink, 1)
    fillBatch(batches.hi, c.signal, 1)
    // database "drawer" marks (one stroke)
    ctx.globalAlpha = 1
    ctx.strokeStyle = c.surface
    ctx.beginPath()
    let anyDb = false
    for (const n of this.nodes) {
      if (n.kind !== 'database' || !inView(n) || n.r * k < 3) continue
      anyDb = true
      ctx.lineWidth = Math.max(0.6, n.r * 0.16)
      ctx.moveTo(n.x! - n.r * 0.55, n.y!)
      ctx.lineTo(n.x! + n.r * 0.55, n.y!)
    }
    if (anyDb) ctx.stroke()
    // "you are here" ring
    const cur = this.currentId ? this.byId.get(this.currentId) : undefined
    if (cur && inView(cur)) {
      ctx.strokeStyle = c.signal
      ctx.lineWidth = 1.6 / k
      ctx.beginPath()
      ctx.arc(cur.x!, cur.y!, cur.r + 4 / k, 0, Math.PI * 2)
      ctx.stroke()
    }

    // labels (screen space → crisp at any zoom), placed greedily by priority without overlaps
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    const cands: Array<{ n: GNode; pri: number; strong: boolean }> = []
    for (const n of this.nodes) {
      const strong = n.id === hi || n.id === this.focusId || n.id === this.currentId
      const near = !!nb?.has(n.id)
      const big = n.kind !== 'row' && (n.r * k >= 6.5 || k >= 1.5)
      if (!strong && !near && (!big || (hi && !lit(n.id)))) continue
      cands.push({ n, strong, pri: (strong ? 1e6 : 0) + (near ? 1e4 : 0) + n.degree * 10 + n.r })
    }
    cands.sort((a, b) => b.pri - a.pri)
    const placed: Array<[number, number, number, number]> = []
    let drawn = 0
    for (const { n, strong } of cands) {
      if (drawn > (this.nodes.length > 400 ? 70 : 160)) break
      const sx = n.x! * k + this.tx
      const sy = n.y! * k + this.ty + n.r * k + 5
      if (sx < -100 || sx > this.w + 100 || sy < -20 || sy > this.h + 20) continue
      const title = n.title.length > 30 ? `${n.title.slice(0, 29)}…` : n.title
      ctx.font = `${strong ? 650 : 500} ${strong ? 12.5 : 11.5}px ${c.font}`
      const tw = ctx.measureText(title).width
      const box: [number, number, number, number] = [sx - tw / 2 - 3, sy - 1, sx + tw / 2 + 3, sy + 15]
      if (!strong && placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue
      placed.push(box)
      drawn++
      ctx.lineWidth = 3.5
      ctx.strokeStyle = c.bg
      ctx.strokeText(title, sx, sy)
      ctx.fillStyle = strong || nb?.has(n.id) ? c.ink : c.ink2
      ctx.fillText(title, sx, sy)
    }
  }

  private gridKey = ''
  private syncGrid() {
    let s = 24 * this.k
    while (s < 14) s *= 2
    while (s > 56) s /= 2
    const key = `${s.toFixed(2)}|${this.tx.toFixed(1)}|${this.ty.toFixed(1)}`
    if (key === this.gridKey) return
    this.gridKey = key
    this.wrap.style.backgroundSize = `${s}px ${s}px`
    this.wrap.style.backgroundPosition = `${this.tx % s}px ${this.ty % s}px`
  }

  /* ---------------------------------------------------------------- */
  /* input                                                             */
  /* ---------------------------------------------------------------- */

  private local(ev: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect()
    return { x: ev.clientX - r.left, y: ev.clientY - r.top }
  }

  private onDown = (ev: PointerEvent) => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return
    const p = this.local(ev)
    this.pointers.set(ev.pointerId, p)
    this.canvas.setPointerCapture(ev.pointerId)
    this.autoFit = false
    this.anim = null
    if (this.pointers.size === 2) {
      // pinch zoom
      const [a, b] = [...this.pointers.values()]
      this.drag = null
      this.pan = null
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx: this.tx, ty: this.ty }
      return
    }
    const n = this.hit(p.x, p.y)
    if (n) {
      this.drag = { node: n, x: p.x, y: p.y, moved: false, id: ev.pointerId }
      this.hoverId = n.id
    } else {
      this.pan = { x: p.x, y: p.y, tx: this.tx, ty: this.ty, id: ev.pointerId }
      this.canvas.style.cursor = 'grabbing'
    }
  }

  private onMove = (ev: PointerEvent) => {
    const p = this.local(ev)
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, p)
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const k = clamp((this.pinch.k * d) / Math.max(1, this.pinch.d), 0.08, 4)
      const { mx, my } = this.pinch
      this.tx = mx - ((mx - this.pinch.tx) * k) / this.pinch.k
      this.ty = my - ((my - this.pinch.ty) * k) / this.pinch.k
      this.k = k
      this.invalidate()
      return
    }
    if (this.drag && this.drag.id === ev.pointerId) {
      const dist = Math.hypot(p.x - this.drag.x, p.y - this.drag.y)
      if (!this.drag.moved && dist < 4) return
      if (!this.drag.moved) {
        this.drag.moved = true
        this.sim.alphaTarget(0.25)
        this.canvas.style.cursor = 'grabbing'
        this.cb.onHover(null, 0, 0)
      }
      const w = this.toWorld(p.x, p.y)
      this.drag.node.fx = w.x
      this.drag.node.fy = w.y
      this.invalidate()
      return
    }
    if (this.pan && this.pan.id === ev.pointerId) {
      this.tx = this.pan.tx + (p.x - this.pan.x)
      this.ty = this.pan.ty + (p.y - this.pan.y)
      this.invalidate()
      return
    }
    if (ev.pointerType === 'touch') return
    const n = this.hit(p.x, p.y)
    const id = n?.id ?? null
    this.canvas.style.cursor = n ? 'pointer' : 'grab'
    if (id !== this.hoverId) {
      this.hoverId = id
      this.invalidate()
    }
    this.cb.onHover(n, n ? n.x! * this.k + this.tx : p.x, n ? n.y! * this.k + this.ty : p.y)
  }

  private onUp = (ev: PointerEvent) => {
    this.pointers.delete(ev.pointerId)
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null
      return
    }
    if (this.drag && this.drag.id === ev.pointerId) {
      const { node, moved } = this.drag
      this.drag = null
      node.fx = null
      node.fy = null
      this.sim.alphaTarget(0)
      this.canvas.style.cursor = 'pointer'
      if (!moved && ev.type === 'pointerup') this.cb.onOpen(node, ev)
      if (ev.pointerType === 'touch') this.hoverId = null
      this.invalidate()
    }
    if (this.pan && this.pan.id === ev.pointerId) {
      this.pan = null
      this.canvas.style.cursor = 'grab'
    }
  }

  private onLeave = () => {
    if (this.drag || this.pan) return
    if (this.hoverId) {
      this.hoverId = null
      this.invalidate()
    }
    this.cb.onHover(null, 0, 0)
  }

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
    this.autoFit = false
    this.anim = null
    const p = this.local(ev)
    const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY
    const k = clamp(this.k * Math.exp(-delta * (ev.ctrlKey ? 0.01 : 0.0016)), 0.08, 4)
    this.tx = p.x - ((p.x - this.tx) * k) / this.k
    this.ty = p.y - ((p.y - this.ty) * k) / this.k
    this.k = k
    this.invalidate()
  }

  private onDbl = (ev: MouseEvent) => {
    const p = this.local(ev)
    if (!this.hit(p.x, p.y)) this.fit(true)
  }
}
