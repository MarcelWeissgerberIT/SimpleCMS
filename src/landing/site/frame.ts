/**
 * Screenshot frames: a technical-drawing frame around a real screenshot
 * (assets/shots/*.webp). Until the file exists the schematic SVG underneath stays
 * visible — the <img> is removed on error and faded in on load. Fixed aspect
 * ratio → no layout shift either way.
 *
 * A frame can hold several screenshots behind a row of mode keys (tabbed frame), and
 * every frame with `zoom` opens full size in a lightbox (one <dialog> per page).
 */
import { asset, esc } from './util'

export interface FrameOpts {
  shot: string
  alt: string
  schematic: string
  caption: string
  meta?: string
  extraClass?: string
  /** Extra markup inside the media box (callouts, overlays) — clipped with it. */
  overlay?: string
  /** Extra markup around the media box (dimension lines) — not clipped. */
  outside?: string
  eager?: boolean
  /** Label of the "enlarge" button; without it the frame has no lightbox. */
  zoom?: string
}

export interface FrameShot {
  shot: string
  /** Mode-key label. */
  tab: string
  /** Caption; doubles as the image's alt text. */
  caption: string
}

export interface TabbedFrameOpts {
  id: string
  shots: FrameShot[]
  schematic: string
  /** Accessible name of the tab list. */
  label: string
  meta?: string
  extraClass?: string
  zoom: string
}

export const CROPS =
  '<i class="crop crop-tl" aria-hidden="true"></i><i class="crop crop-tr" aria-hidden="true"></i><i class="crop crop-bl" aria-hidden="true"></i><i class="crop crop-br" aria-hidden="true"></i>'

const ZOOM_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>'

const zoomButton = (label: string) => `<button type="button" class="frame-zoom" data-zoom aria-label="${esc(label)}">${ZOOM_ICON}</button>`

const img = (shot: string, alt: string, extra: string, on = false) =>
  `<img class="frame-img${on ? ' is-on' : ''}" src="${asset(shot)}" alt="${esc(alt)}" width="1600" height="1000" decoding="async" ${extra} />`

export function frame(o: FrameOpts): string {
  return `
<figure class="frame ${o.extraClass ?? ''}">
  <div class="frame-box">
    ${CROPS}
    ${o.outside ?? ''}
    <div class="frame-media">
      <div class="frame-sk">${o.schematic}</div>
      ${img(o.shot, o.alt, o.eager ? 'fetchpriority="high"' : 'loading="lazy"')}
      ${o.overlay ?? ''}
      ${o.zoom ? zoomButton(o.zoom) : ''}
    </div>
  </div>
  <figcaption class="frame-cap lbl"><span>${esc(o.caption)}</span>${o.meta ? `<span>${esc(o.meta)}</span>` : ''}</figcaption>
</figure>`
}

/** Several screenshots in one frame, switched with a row of mode keys (ARIA tabs). */
export function tabbedFrame(o: TabbedFrameOpts): string {
  const keys = o.shots
    .map(
      (s, i) =>
        `<button type="button" role="tab" id="${o.id}-t${i}" aria-controls="${o.id}-p" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${i}"><span class="ftab-n" aria-hidden="true">${String.fromCharCode(65 + i)}</span>${esc(s.tab)}</button>`,
    )
    .join('')
  const imgs = o.shots
    .map((s, i) => img(`assets/shots/${s.shot}.webp`, s.caption, `loading="lazy" data-shot="${i}"${i ? ' aria-hidden="true"' : ''}`, i === 0))
    .join('')
  return `
<figure class="frame frame-tabs ${o.extraClass ?? ''}" data-frame-tabs>
  <div class="ftabs" role="tablist" aria-label="${esc(o.label)}">${keys}</div>
  <div class="frame-box">
    ${CROPS}
    <div class="frame-media" id="${o.id}-p" role="tabpanel" aria-labelledby="${o.id}-t0">
      <div class="frame-sk">${o.schematic}</div>
      ${imgs}
      ${zoomButton(o.zoom)}
    </div>
  </div>
  <figcaption class="frame-cap lbl"><span data-cap>${esc(o.shots[0]?.caption ?? '')}</span>${o.meta ? `<span>${esc(o.meta)}</span>` : ''}</figcaption>
</figure>`
}

/** Wire up load/error handling for every frame image inside root. */
export function bindFrames(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>('img.frame-img').forEach((img) => {
    const fig = img.closest('.frame')
    const ok = () => {
      fig?.classList.add('has-shot')
      fig?.querySelector('.frame-sk svg')?.setAttribute('aria-hidden', 'true')
    }
    const fail = () => img.remove()
    if (img.complete) {
      if (img.naturalWidth > 0) ok()
      else fail()
      return
    }
    img.addEventListener('load', ok, { once: true })
    img.addEventListener('error', fail, { once: true })
  })
}

/** Selected screenshot per tabbed frame (panel id) — survives the language re-render. */
const selected = new Map<string, number>()

/** Mode keys of tabbed frames: click, arrows / Home / End (roving tabindex, automatic activation). */
export function bindFrameTabs(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-frame-tabs]').forEach((fig) => {
    const tabs = Array.from(fig.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const panel = fig.querySelector<HTMLElement>('[role="tabpanel"]')
    const cap = fig.querySelector<HTMLElement>('[data-cap]')
    const select = (i: number, focus: boolean) => {
      if (panel) selected.set(panel.id, i)
      tabs.forEach((tab, j) => {
        const on = i === j
        tab.setAttribute('aria-selected', String(on))
        tab.tabIndex = on ? 0 : -1
      })
      fig.querySelectorAll<HTMLImageElement>('img.frame-img').forEach((im) => {
        const on = Number(im.dataset.shot) === i
        im.classList.toggle('is-on', on)
        if (on) {
          im.removeAttribute('aria-hidden')
          // a lazy image that never came close to the viewport: load it now
          im.loading = 'eager'
          if (cap) cap.textContent = im.alt
        } else im.setAttribute('aria-hidden', 'true')
      })
      panel?.setAttribute('aria-labelledby', tabs[i].id)
      if (focus) tabs[i].focus()
    }
    const kept = panel ? selected.get(panel.id) : undefined
    if (kept && kept < tabs.length) select(kept, false)
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(i, false))
      tab.addEventListener('keydown', (e) => {
        const n = tabs.length
        const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
        if (to < 0) return
        e.preventDefault()
        select(to, true)
      })
    })
  })
}

/* ------------------------------------------------------------------ */
/* Lightbox                                                             */
/* ------------------------------------------------------------------ */

export function lightboxHtml(closeLabel: string): string {
  return `
<dialog class="lightbox tone-carbon" data-lightbox>
  <figure class="lb-fig">
    <img class="lb-img" alt="" width="1600" height="1000" />
    <figcaption class="lbl lb-cap"><span data-lb-cap></span><button type="button" class="lb-close" data-lb-close>${esc(closeLabel)} <span class="lb-esc" aria-hidden="true">Esc</span></button></figcaption>
  </figure>
</dialog>`
}

/** Open the visible screenshot of a frame full size: the enlarge button, or a click on the image. */
export function bindLightbox(root: HTMLElement): () => void {
  const dlg = root.querySelector<HTMLDialogElement>('[data-lightbox]')
  if (!dlg || typeof dlg.showModal !== 'function') {
    root.querySelectorAll('[data-zoom]').forEach((b) => b.remove())
    return () => {}
  }
  const big = dlg.querySelector<HTMLImageElement>('.lb-img')!
  const cap = dlg.querySelector<HTMLElement>('[data-lb-cap]')!
  let opener: HTMLElement | null = null

  const open = (fig: HTMLElement, from: HTMLElement) => {
    const shot = fig.querySelector<HTMLImageElement>('img.frame-img.is-on') ?? fig.querySelector<HTMLImageElement>('img.frame-img')
    if (!shot || !shot.naturalWidth) return
    big.src = shot.currentSrc || shot.src
    big.alt = shot.alt
    cap.textContent = fig.querySelector('.frame-cap span')?.textContent ?? shot.alt
    opener = from
    document.documentElement.classList.add('lb-open')
    dlg.showModal()
  }
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const zoom = target.closest<HTMLElement>('[data-zoom]')
    const pic = !zoom && target.closest('.frame-media') && target.closest<HTMLElement>('.frame')?.querySelector('[data-zoom]') ? target.closest<HTMLElement>('.frame-media') : null
    if (!zoom && !pic) return
    const fig = (zoom ?? pic)!.closest<HTMLElement>('.frame')
    if (fig) open(fig, zoom ?? fig.querySelector<HTMLElement>('[data-zoom]') ?? fig)
  }
  const close = () => dlg.open && dlg.close()
  const onClose = () => {
    document.documentElement.classList.remove('lb-open')
    opener?.focus({ preventScroll: true })
    opener = null
  }
  // a click on the backdrop (the dialog box itself, outside the figure) closes it
  const onDlgClick = (e: MouseEvent) => {
    if (e.target === dlg || (e.target as HTMLElement).closest('[data-lb-close]') || e.target === big) close()
  }
  root.addEventListener('click', onClick)
  dlg.addEventListener('click', onDlgClick)
  dlg.addEventListener('close', onClose)
  return () => {
    root.removeEventListener('click', onClick)
    dlg.removeEventListener('click', onDlgClick)
    dlg.removeEventListener('close', onClose)
    if (dlg.open) dlg.close()
  }
}
