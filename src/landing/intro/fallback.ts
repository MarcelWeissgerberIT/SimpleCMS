/**
 * DOM fallback when WebGL or the capture is unavailable: the window cracks (SVG), shakes,
 * then breaks into Voronoi tiles — live clones of the window clipped with clip-path — that
 * tumble away with CSS 3D transforms. Resolves when everything has fallen.
 */
import { Delaunay } from 'd3-delaunay'

type Pt = [number, number]

export async function runDomShatter(root: HTMLElement, sheetEl: HTMLElement, opts: { mobile: boolean }): Promise<void> {
  const w = window.innerWidth
  const h = window.innerHeight
  const ix = w * 0.46
  const iy = h * 0.46
  const seeds: Pt[] = [[ix, iy]]
  const rings = opts.mobile ? [90, 240, 520] : [110, 290, 600]
  const counts = opts.mobile ? [4, 4, 4] : [4, 6, 7]
  rings.forEach((r, ri) => {
    for (let k = 0; k < counts[ri]; k++) {
      const a = ((k + Math.random() * 0.6) / counts[ri]) * Math.PI * 2
      const rr = r * (0.8 + Math.random() * 0.4)
      const x = ix + Math.cos(a) * rr
      const y = iy + Math.sin(a) * rr
      if (x > 4 && x < w - 4 && y > 4 && y < h - 4) seeds.push([x, y])
    }
  })
  const vor = Delaunay.from(seeds).voronoi([0, 0, w, h])

  // 1) cracks + shake
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.style.cssText = 'position:absolute;inset:0;z-index:150;pointer-events:none'
  const edges = vor.render()
  for (const [stroke, width, dx] of [
    ['rgba(255,255,255,.9)', 2, -1],
    ['rgba(10,10,10,.9)', 1.6, 0],
  ] as const) {
    const p = document.createElementNS(svgNS, 'path')
    p.setAttribute('d', edges)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', stroke)
    p.setAttribute('stroke-width', String(width))
    p.setAttribute('transform', `translate(${dx} ${dx})`)
    svg.appendChild(p)
  }
  svg.animate([{ clipPath: `circle(0px at ${ix}px ${iy}px)` }, { clipPath: `circle(${Math.hypot(w, h)}px at ${ix}px ${iy}px)` }], {
    duration: 380,
    easing: 'cubic-bezier(.2,.8,.2,1)',
    fill: 'forwards',
  })
  sheetEl.appendChild(svg)
  const flash = document.createElement('div')
  flash.style.cssText = `position:absolute;inset:0;z-index:151;pointer-events:none;background:radial-gradient(circle at ${ix}px ${iy}px,#fff,rgba(255,255,255,0) 45%)`
  root.appendChild(flash)
  flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' })
  await sheetEl.animate(
    [
      { transform: 'translate(0,0)' },
      { transform: 'translate(-7px,4px)' },
      { transform: 'translate(6px,-5px)' },
      { transform: 'translate(-4px,3px)' },
      { transform: 'translate(2px,-1px)' },
      { transform: 'translate(0,0)' },
    ],
    { duration: 420, easing: 'linear' },
  ).finished.catch(() => {})

  // 2) tiles
  const scroll = sheetEl.querySelector<HTMLElement>('.x97-scroll')
  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;inset:0;z-index:140;pointer-events:none;perspective:1400px;overflow:hidden'
  root.appendChild(layer)
  const anims: Promise<unknown>[] = []
  for (let i = 0; i < seeds.length; i++) {
    const poly = vor.cellPolygon(i) as Pt[] | null
    if (!poly) continue
    let cx = 0
    let cy = 0
    for (const [x, y] of poly) {
      cx += x
      cy += y
    }
    cx /= poly.length
    cy /= poly.length
    const tile = document.createElement('div')
    tile.style.cssText = `position:absolute;inset:0;clip-path:polygon(${poly.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')});transform-origin:${cx}px ${cy}px;will-change:transform`
    const clone = sheetEl.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
    clone.style.transform = ''
    tile.appendChild(clone)
    layer.appendChild(tile)
    const cs = clone.querySelector<HTMLElement>('.x97-scroll')
    if (cs && scroll) {
      cs.scrollLeft = scroll.scrollLeft
      cs.scrollTop = scroll.scrollTop
    }
    const dx = cx - ix
    const dy = cy - iy
    const dist = Math.hypot(dx, dy) || 1
    const push = 60 + 260 / (1 + dist / 220)
    const tx = (dx / dist) * push + (Math.random() - 0.5) * 80
    const ty = h * (0.9 + Math.random() * 0.5)
    const rot = (Math.random() - 0.5) * 140
    const ax = (-dy / dist).toFixed(2)
    const ay = (dx / dist).toFixed(2)
    anims.push(
      tile.animate(
        [
          { transform: 'translate3d(0,0,0) rotate3d(0,0,1,0deg)', opacity: 1 },
          { transform: `translate3d(${tx * 0.35}px,${-30 - push * 0.1}px,${push * 0.6}px) rotate3d(${ax},${ay},0.3,${rot * 0.3}deg)`, opacity: 1, offset: 0.25 },
          { transform: `translate3d(${tx}px,${ty}px,${push}px) rotate3d(${ax},${ay},0.3,${rot}deg)`, opacity: 0.9 },
        ],
        { duration: 1000 + Math.random() * 400, delay: Math.min(260, dist * 0.35), easing: 'cubic-bezier(.45,0,.9,.6)', fill: 'forwards' },
      ).finished,
    )
  }
  sheetEl.style.visibility = 'hidden'
  flash.remove()
  await Promise.race([Promise.all(anims), new Promise((r) => setTimeout(r, 2200))]).catch(() => {})
  layer.remove()
}
