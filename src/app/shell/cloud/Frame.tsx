import { useEffect, type ReactNode } from 'react'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { Led } from '../../ui/controls'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import './cloud.css'

export type StepState = 'done' | 'now' | 'next'
export interface Step {
  label: string
  state: StepState
}

/**
 * Full-screen frame of the cloud screens (sign-in, invitation): a technical-manual sheet with the
 * form on the left and the procedure plate on the right (stacked on phones).
 */
export function CloudFrame({ docTitle, steps, status, children }: { docTitle: string; steps: Step[]; status: { led: 'on' | 'ok' | 'off'; text: string }; children: ReactNode }) {
  const t = useT()
  const lang = useLang()
  useEffect(() => {
    document.title = `${docTitle} — One`
  }, [docTitle])
  return (
    <div className="cl-screen">
      <header className="cl-top">
        <a className="cl-brand" href={BRAND.homeHref} aria-label={BRAND.name}>
          <span className="cl-brand__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(22) }} />
          <span className="cl-brand__name">One</span>
        </a>
        <span className="cl-top__rule" aria-hidden />
        <span className="label">{t('shell.cloud.frame.team')}</span>
        <div className="cl-lang" role="radiogroup" aria-label={t('shell.cloud.frame.lang')}>
          {(['en', 'de'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lang === l}
              className="cl-lang__btn"
              onClick={() => useWorkspace.getState().updateSettings({ language: l })}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <main className="cl-main">
        <section className="cl-sheet">{children}</section>
        <aside className="cl-plate" aria-label={t('shell.cloud.frame.procedure')}>
          <div className="label cl-plate__head">{t('shell.cloud.frame.procedure')}</div>
          <ol className="cl-steps">
            {steps.map((s, i) => (
              <li key={i} className="cl-step" data-state={s.state} aria-current={s.state === 'now' ? 'step' : undefined}>
                <span className="cl-step__n">{String(i + 1).padStart(2, '0')}</span>
                <span className="cl-step__label">{s.label}</span>
                <Led state={s.state === 'done' ? 'ok' : s.state === 'now' ? 'on' : 'off'} />
              </li>
            ))}
          </ol>
          <div className="label cl-plate__head">{t('shell.cloud.frame.spec')}</div>
          <dl className="cl-spec">
            <div>
              <dt>{t('shell.cloud.spec.password')}</dt>
              <dd>{t('shell.cloud.spec.passwordV')}</dd>
            </div>
            <div>
              <dt>{t('shell.cloud.spec.offline')}</dt>
              <dd>{t('shell.cloud.spec.offlineV')}</dd>
            </div>
            <div>
              <dt>{t('shell.cloud.spec.ai')}</dt>
              <dd>{t('shell.cloud.spec.aiV')}</dd>
            </div>
          </dl>
        </aside>
      </main>
      <footer className="cl-foot">
        <span className="cl-foot__cell">
          {t('shell.cloud.frame.server')} · {window.location.host || '—'}
        </span>
        <span className="cl-foot__cell" role="status">
          <Led state={status.led} />
          {status.text}
        </span>
        <span className="cl-foot__spacer" />
        <span className="cl-foot__cell">
          {BRAND.name} {BRAND.version}
        </span>
      </footer>
    </div>
  )
}

/** Mono section line at the top of a sheet: "§ 01 — SIGN IN ······ FORM T-1". */
export function SheetHead({ section, code }: { section: string; code?: string }) {
  return (
    <div className="cl-sheet__head label">
      <span>{section}</span>
      <span className="cl-sheet__rule" aria-hidden />
      {code && <span>{code}</span>}
    </div>
  )
}
