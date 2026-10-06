/**
 * "Install One": the key in Settings → General and the workspace menu, and the placard for browsers without
 * an install prompt (iOS Safari: Share → Add to Home Screen; Android browsers: their menu). Nothing shows
 * once One runs installed.
 */
import { useId, type ReactNode } from 'react'
import { Download, EllipsisVertical, Share, SquarePlus } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import type { MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { HelpLink } from '../../help'
import { canOfferInstall, installOne, isIOS, useInstallMode } from './install'
import { closeInstallPlacard, openInstallPlacard } from './state'
import './capture.css'

const install = () => void installOne(openInstallPlacard)

/** Settings → General: "Install One" (renders nothing when installed or when the browser cannot install). */
export function InstallSection() {
  const t = useT()
  const id = useId()
  const mode = useInstallMode()
  if (!canOfferInstall(mode)) return null
  return (
    <div className="st-field" data-inline="" data-testid="install-one">
      <div className="st-field__text">
        <div className="st-field__label" id={`${id}-l`}>
          {t('shell.install.title')} <HelpLink id="offline-app" topic={t('shell.install.title')} />
        </div>
        <div className="st-field__hint" id={`${id}-h`}>
          {t(mode === 'prompt' ? 'shell.install.hint' : mode === 'ios' ? 'shell.install.hintIos' : 'shell.install.hintMenu')}
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

/** The workspace menu's "Install One" entry ([] when there is nothing to install). */
export function useInstallMenuEntries(): MenuEntry[] {
  const t = useT()
  const mode = useInstallMode()
  if (!canOfferInstall(mode)) return []
  return [{ id: 'install-one', label: t('shell.install.title'), icon: <Download size={15} />, onSelect: install }]
}

/** iOS / Android without a prompt: how to add One to the home screen, with the browser's own symbols. */
export function InstallPlacard({ onClose }: { onClose: () => void }) {
  const t = useT()
  const ios = isIOS()
  const steps: Array<[string, ReactNode]> = ios
    ? [
        [t('shell.install.ios.share'), <Share key="i" size={16} strokeWidth={1.75} aria-hidden />],
        [t('shell.install.ios.add'), <SquarePlus key="i" size={16} strokeWidth={1.75} aria-hidden />],
        [t('shell.install.ios.confirm'), null],
      ]
    : [
        [t('shell.install.menu.open'), <EllipsisVertical key="i" size={16} strokeWidth={1.75} aria-hidden />],
        [t('shell.install.menu.add'), <SquarePlus key="i" size={16} strokeWidth={1.75} aria-hidden />],
      ]
  return (
    <Modal open onClose={onClose} width={420} bare className="installq" ariaLabel={t('shell.install.placard.title')}>
      <div className="installq__body" data-testid="install-placard">
        <div className="installq__head">
          <span className="label">
            <span className="led led--on" aria-hidden /> {t(ios ? 'shell.install.placard.labelIos' : 'shell.install.placard.labelMenu')}
          </span>
        </div>
        <h2 className="installq__title">{t('shell.install.placard.title')}</h2>
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
        {ios && <p className="installq__note">{t('shell.install.ios.note')}</p>}
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
