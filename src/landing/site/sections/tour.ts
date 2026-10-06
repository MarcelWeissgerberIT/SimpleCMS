import type { Ctx } from '../context'
import { asset, esc } from '../util'

/**
 * The 60-second tour (public/media/simplecms-one.mp4, made by scripts/promo): the hero's "Watch the
 * tour" key opens it in a carbon dialog. Nothing loads until it is opened (preload none, the poster
 * only then); closing it — Close, Esc, a click beside the video — stops it.
 */
export const TOUR_VIDEO = 'media/simplecms-one.mp4'
export const TOUR_POSTER = 'media/simplecms-one.jpg'

export function renderTour({ t }: Ctx): string {
  return `
<dialog class="tour tone-carbon" data-tour-dialog aria-labelledby="tour-h">
  <figure class="tour-fig">
    <figcaption class="lbl tour-head">
      <span id="tour-h"><span class="led" aria-hidden="true"></span>${esc(t('tour.title'))}</span>
      <button type="button" class="lb-close" data-tour-close>${esc(t('tour.close'))} <span class="lb-esc" aria-hidden="true">Esc</span></button>
    </figcaption>
    <div class="tour-media"><video class="tour-video" controls playsinline preload="none" width="1920" height="1080" data-src="${asset(TOUR_VIDEO)}" data-poster="${asset(TOUR_POSTER)}"></video></div>
    <p class="lbl tour-note">${esc(t('tour.note'))}</p>
  </figure>
</dialog>`
}

export function bindTour(root: HTMLElement): () => void {
  const dlg = root.querySelector<HTMLDialogElement>('[data-tour-dialog]')
  const video = dlg?.querySelector<HTMLVideoElement>('video')
  const keys = Array.from(root.querySelectorAll<HTMLElement>('[data-tour]'))
  if (!dlg || !video || typeof dlg.showModal !== 'function') {
    keys.forEach((k) => k.remove())
    return () => {}
  }
  let opener: HTMLElement | null = null
  const open = (e: Event) => {
    opener = e.currentTarget as HTMLElement
    // the file is only requested now
    if (!video.getAttribute('src')) {
      video.poster = video.dataset.poster ?? ''
      video.src = video.dataset.src ?? ''
    }
    document.documentElement.classList.add('lb-open')
    dlg.showModal()
    video.play().catch(() => {})
  }
  const close = () => dlg.open && dlg.close()
  const onClose = () => {
    video.pause()
    document.documentElement.classList.remove('lb-open')
    opener?.focus({ preventScroll: true })
    opener = null
  }
  // a click on the backdrop (the dialog itself, outside the figure) closes it
  const onClick = (e: MouseEvent) => {
    if (e.target === dlg || (e.target as HTMLElement).closest('[data-tour-close]')) close()
  }
  keys.forEach((k) => k.addEventListener('click', open))
  dlg.addEventListener('click', onClick)
  dlg.addEventListener('close', onClose)
  return () => {
    keys.forEach((k) => k.removeEventListener('click', open))
    dlg.removeEventListener('click', onClick)
    dlg.removeEventListener('close', onClose)
    if (dlg.open) dlg.close()
  }
}
