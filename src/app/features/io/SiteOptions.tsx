/**
 * Export → Website: site title, base URL, feed source and "how to put it online".
 */
import { useId } from 'react'
import { useT } from '../../i18n'
import { Led } from '../../ui/controls'
import type { ID, Page } from '../../store/types'

const PREFS_KEY = 'one.export.site'

export interface SitePrefs {
  baseUrl: string
  /** 'recent' or a database id */
  feed: string
}

export function loadSitePrefs(): SitePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<SitePrefs>
    return { baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.slice(0, 500) : '', feed: typeof raw.feed === 'string' ? raw.feed : 'recent' }
  } catch {
    return { baseUrl: '', feed: 'recent' }
  }
}

export function saveSitePrefs(p: SitePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* private mode */
  }
}

interface Props {
  title: string
  onTitle: (v: string) => void
  baseUrlRaw: string
  onBaseUrl: (v: string) => void
  /** normalised base URL, '' when empty, null when invalid */
  baseUrl: string | null
  feed: string
  onFeed: (v: ID | 'recent') => void
  feedDbs: Page[]
}

export function SiteOptions({ title, onTitle, baseUrlRaw, onBaseUrl, baseUrl, feed, onFeed, feedDbs }: Props) {
  const t = useT()
  const id = useId()
  const steps: Array<[string, string]> = [
    [t('features.site.ghTitle'), t('features.site.gh')],
    [t('features.site.netlifyTitle'), t('features.site.netlify')],
    [t('features.site.localTitle'), t('features.site.local')],
  ]
  return (
    <section className="io-section">
      <div className="io-section__label label">
        <b>C</b> {t('features.site.options')}
      </div>
      <div className="io-site">
        <label className="io-field">
          <span className="io-field__label label">{t('features.site.title')}</span>
          <input className="input" value={title} maxLength={120} onChange={(e) => onTitle(e.target.value)} data-site-title="" />
        </label>
        <label className="io-field io-field--wide">
          <span className="io-field__label label">
            {t('features.site.baseUrl')} <span className="io-field__opt">· {t('features.site.optional')}</span>
          </span>
          <input
            className="input mono io-field__url"
            type="url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            placeholder="https://name.github.io/site/"
            value={baseUrlRaw}
            maxLength={500}
            onChange={(e) => onBaseUrl(e.target.value)}
            aria-invalid={baseUrl === null || undefined}
            aria-describedby={`${id}-note`}
            data-site-base=""
          />
        </label>
        <label className="io-field">
          <span className="io-field__label label">{t('features.site.feed')}</span>
          <select className="input" value={feed} onChange={(e) => onFeed(e.target.value)} data-site-feed="">
            <option value="recent">{t('features.site.feedRecent')}</option>
            {feedDbs.map((p) => (
              <option key={p.id} value={p.id}>
                {t('features.site.feedDb', { name: p.title.trim() || t('common.untitled') })}
              </option>
            ))}
          </select>
        </label>
        <p id={`${id}-note`} className="io-site__note" data-state={baseUrl === null ? 'error' : baseUrl ? 'ok' : 'off'} aria-live="polite">
          <Led state={baseUrl ? 'ok' : baseUrl === null ? 'on' : 'off'} />
          <span>{baseUrl === null ? t('features.site.baseInvalid') : baseUrl ? t('features.site.withBase', { url: baseUrl }) : t('features.site.noBase')}</span>
        </p>
      </div>
      <div className="io-online">
        <div className="io-online__head label">{t('features.site.online')}</div>
        <ol className="io-online__steps">
          {steps.map(([name, text], i) => (
            <li key={name}>
              <span className="io-online__code mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="io-online__text">
                <b>{name}</b> {text}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
