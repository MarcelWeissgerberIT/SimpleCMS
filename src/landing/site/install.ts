/** Website entry to the same browser-native install flow as the workspace app. */
import { BRAND } from '@/shared/brand'
import { canOfferInstall, getInstallMode, installGuide, installOne, subscribeInstall } from '@/shared/install'
import type { Ctx } from './context'
import { esc } from './util'
import './install.css'

export function renderInstall({ t }: Ctx): string {
  const guide = installGuide()
  return `<dialog class="site-install" data-install-dialog aria-labelledby="site-install-title">
    <div class="site-install__body">
      <p class="lbl">${esc(t(guide.label))}</p>
      <h2 id="site-install-title">${esc(t(guide.title))}</h2>
      <p>${esc(t('shell.install.placard.why'))}</p>
      <ol>${guide.steps.map((key) => `<li>${esc(t(key))}</li>`).join('')}</ol>
      <p class="site-install__note">${esc(t(guide.note))}</p>
      <div class="site-install__actions">
        <a class="btn btn-sig" href="${BRAND.appHref}">${esc(t('shell.install.openWorkspace'))}<span aria-hidden="true">→</span></a>
        <button type="button" class="btn btn-ink" data-install-close>${esc(t('shell.install.placard.done'))}</button>
      </div>
    </div>
  </dialog>`
}

export function bindInstall(root: HTMLElement): () => void {
  const dialog = root.querySelector<HTMLDialogElement>('[data-install-dialog]')
  const keys = root.querySelectorAll<HTMLButtonElement>('[data-install-one]')
  const update = () => keys.forEach((key) => { key.hidden = !canOfferInstall(getInstallMode()) })
  const showGuide = () => dialog?.showModal()
  const press = () => void installOne(showGuide)
  keys.forEach((key) => key.addEventListener('click', press))
  dialog?.querySelector('[data-install-close]')?.addEventListener('click', () => dialog.close())
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close()
    }
  })
  const unsubscribe = subscribeInstall(update)
  update()
  return () => {
    unsubscribe()
    keys.forEach((key) => key.removeEventListener('click', press))
    dialog?.close()
  }
}
