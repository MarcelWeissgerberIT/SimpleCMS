/**
 * Screenshot frames: a technical-drawing frame around a real screenshot
 * (assets/shots/*.webp). Until the file exists the schematic SVG underneath stays
 * visible — the <img> is removed on error and faded in on load. Fixed aspect
 * ratio → no layout shift either way.
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
}

export const CROPS =
  '<i class="crop crop-tl" aria-hidden="true"></i><i class="crop crop-tr" aria-hidden="true"></i><i class="crop crop-bl" aria-hidden="true"></i><i class="crop crop-br" aria-hidden="true"></i>'

export function frame(o: FrameOpts): string {
  return `
<figure class="frame ${o.extraClass ?? ''}">
  <div class="frame-box">
    ${CROPS}
    ${o.outside ?? ''}
    <div class="frame-media">
      <div class="frame-sk">${o.schematic}</div>
      <img class="frame-img" src="${asset(o.shot)}" alt="${esc(o.alt)}" width="1600" height="1000" decoding="async" ${o.eager ? 'fetchpriority="high"' : 'loading="lazy"'} />
      ${o.overlay ?? ''}
    </div>
  </div>
  <figcaption class="frame-cap lbl"><span>${esc(o.caption)}</span>${o.meta ? `<span>${esc(o.meta)}</span>` : ''}</figcaption>
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
