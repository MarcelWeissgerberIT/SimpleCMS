/**
 * "Install One": the key in Settings → General and the workspace menu, and the placard for browsers without
 * an install prompt (desktop browser menus, Safari Dock, iOS Home Screen and Android). Nothing shows
 * once One runs installed.
 */
import { useId, type ReactNode } from 'react'
import { Check, Download, EllipsisVertical, Share, SquarePlus } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import type { MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { HelpLink } from '../../help'
import { canOfferInstall, installOne, installGuide, useInstallMode } from './install'
import { closeInstallPlacard, openInstallPlacard } from './state'
import './capture.css'

const install = () => void installOne(openInstallPlacard)

/** Settings → General: "Install One" (native prompt or browser-specific instructions; hidden in app mode). */
export function InstallSection() {
  const t = useT()
  const id = useId()
  const mode = useInstallMode()
  if (mode === 'installed') return <div className="st-field" data-testid="install-one-status"><div className="st-field__label"><Check size={14} aria-hidden /> {t('shell.install.installed')}</div><div className="st-field__hint">{t('shell.install.installedHint')}</div></div>
  if (!canOfferInstall(mode)) return null
  return (
    <div className="st-field" data-inline="" data-testid="install-one">
      <div className="st-field__text">
        <div className="st-field__label" id={`${id}-l`}>
          {t('shell.install.title')} <HelpLink id="offline-app" topic={t('shell.install.title')} />
        </div>
        <div className="st-field__hint" id={`${id}-h`}>
          {t(mode === 'prompt' ? 'shell.install.hint' : mode === 'ios' ? 'shell.install.hintIos' : mode === 'desktop' ? 'shell.install.hintDesktop' : 'shell.install.hintMenu')}
        </div>
      </div>
      <div className="st-field__control">
        <button type="button" className="btn btn--primary install-key" aria-describedby={`${id}-h`} onClick={install}>
          <Download size={14} strokeWidth={1.75} aria-hidden />
          {t(mode === 'prompt' ? 'shell.install.button' : 'shell.install.how')}
        </button>
      </div>
    </div>
  )
}

/** Always discoverable in a browser tab, including browsers without a native prompt. */
export function InstallTopbarButton({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const mode = useInstallMode()
  if (!canOfferInstall(mode)) return null
  return <button type="button" className="tb-install" data-compact={compact || undefined} data-testid="install-one-topbar" aria-label={t('shell.install.website')} title={t('shell.install.website')} onClick={install}>
    <Download size={15} strokeWidth={1.75} aria-hidden /><span>{t('shell.install.website')}</span>
  </button>
}

/** The workspace menu's "Install One" entry ([] when there is nothing to install). */
export function useInstallMenuEntries(): MenuEntry[] {
  const t = useT()
  const mode = useInstallMode()
  if (!canOfferInstall(mode)) return []
  return [{ id: 'install-one', label: t('shell.install.title'), icon: <Download size={15} />, onSelect: install }]
}

/** Browser-specific install steps when the page cannot open a native install prompt. */
export function InstallPlacard({ onClose }: { onClose: () => void }) {
  const t = useT()
  const guide = installGuide()
  const ios = guide.kind === 'ios'
  const steps: Array<[string, ReactNode]> = guide.steps.map((key, i) => [
    t(key),
    i === 0 ? (ios ? <Share key="i" size={16} strokeWidth={1.75} aria-hidden /> : <EllipsisVertical key="i" size={16} strokeWidth={1.75} aria-hidden />)
      : i === 1 ? <SquarePlus key="i" size={16} strokeWidth={1.75} aria-hidden /> : null,
  ])
  return (
    <Modal open onClose={onClose} width={520} bare className="installq" ariaLabel={t(guide.title)}>
      <div className="installq__body" data-testid="install-placard">
        <div className="installq__head">
          <span className="label">
            <span className="led led--on" aria-hidden /> {t(guide.label)}
          </span>
        </div>
        <h2 className="installq__title">{t(guide.title)}</h2>
        <p className="installq__why">{t('shell.install.placard.why')}</p>
        <ol className="installq__steps">
          {steps.map(([text, icon], i) => (
            <li key={i} className="installq__step">
              <span className="installq__num mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="installq__text">{text}</span>
              {icon && <span className="installq__glyph">{icon}</span>}
            </li>
          ))}
        </ol>
        <p className="installq__note">{t(guide.note)}</p>
        <div className="installq__actions">
          <button type="button" className="btn btn--primary" data-autofocus="" onClick={onClose}>
            {t('shell.install.placard.done')}
          </button>
          <HelpLink id={ios ? 'iphone' : 'offline-app'} topic={t('shell.install.title')} />
        </div>
      </div>
    </Modal>
  )
}

export function InstallPlacardHost({ open }: { open: boolean }) {
  return open ? <InstallPlacard onClose={closeInstallPlacard} /> : null
}
