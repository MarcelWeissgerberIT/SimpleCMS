/**
 * Read-only view of a page received as a share link (#/s/<payload>).
 * Nothing is stored until the reader chooses "Save to my workspace".
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ArrowRight, Check, Download, Lock, Unlock } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { plainText, useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { navigate, openPage } from '../../lib/router'
import { resolveAssetUrl, saveFile } from '../../lib/files'
import { PageIcon } from '../../ui/PageIcon'
import { ReadOnlyDoc } from '../../editor'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import { canEncrypt, decodePayload, decryptPayload, isEncryptedPayload, ShareDecodeError, sniffRaster, type SharePayload } from './codec'
import './share.css'
import './shared-view.css'
import './readonly.css'

/**
 * Move inlined data-URL images into local file storage (keeps the workspace lean).
 * Only verified raster images are stored, with their sniffed type — never SVG or HTML, which
 * would run script on this origin when opened as a document.
 */
async function storeImages(nodes: JSONContent[] | undefined): Promise<JSONContent[] | undefined> {
  if (!nodes) return nodes
  return Promise.all(
    nodes.map(async (n) => {
      const out: JSONContent = { ...n }
      const src = n.attrs?.src
      if (n.type === 'image' && typeof src === 'string' && src.startsWith('data:')) {
        let stored = ''
        try {
          const raw = await (await fetch(src)).arrayBuffer()
          const type = sniffRaster(new Uint8Array(raw.slice(0, 16)))
          if (type) stored = await saveFile(new Blob([raw], { type }), String(n.attrs?.alt || 'image').slice(0, 120))
        } catch {
          stored = ''
        }
        out.attrs = { ...n.attrs, src: stored }
      }
      if (n.content) out.content = await storeImages(n.content)
      return out
    }),
  )
}

export function SharedPageView({ payload }: { payload: string }) {
  const t = useT()
  const lang = useLang()
  const encrypted = useMemo(() => isEncryptedPayload(payload), [payload])
  const decoded = useMemo<{ page: SharePayload } | { error: ShareDecodeError['code'] } | { locked: true }>(() => {
    if (encrypted) return { locked: true }
    try {
      return { page: decodePayload(payload) }
    } catch (e) {
      return { error: e instanceof ShareDecodeError ? e.code : 'corrupt' }
    }
  }, [payload, encrypted])
  // a protected link, opened with the right password (kept in memory only)
  const [unlocked, setUnlocked] = useState<{ payload: string; page: SharePayload } | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  const page = unlocked?.payload === payload ? unlocked.page : 'page' in decoded ? decoded.page : null
  const locked = !page && 'locked' in decoded

  useEffect(() => {
    const prev = document.title
    document.title = page
      ? `${page.title.trim() || t('common.untitled')} — ${BRAND.short}`
      : `${locked ? t('features.share.lock.docTitle') : t('features.share.view.errorTitle')} — ${BRAND.short}`
    return () => {
      document.title = prev
    }
  }, [page, locked, t])

  const save = async () => {
    if (!page || saving) return
    setSaving(true)
    try {
      const content = page.content ? { ...page.content, content: await storeImages(page.content.content) } : null
      const id = useWorkspace.getState().createPage({ title: page.title, icon: page.icon, cover: page.cover, content })
      setSavedId(id)
      useUI.getState().toast({ message: t('features.share.view.saved'), kind: 'success' })
      openPage(id)
    } catch {
      useUI.getState().toast({ message: t('features.share.view.saveFailed'), kind: 'error' })
      setSaving(false)
    }
  }

  const words = page ? plainText(page.content, 5_000_000).split(/\s+/).filter(Boolean).length : 0
  const date = page?.at ? new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(page.at) : null
  const fmtNum = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US')

  return (
    <div className="shv">
      <header className="shv__bar">
        <a className="shv__brand" href="#/" aria-label={BRAND.name}>
          <span className="shv__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(20) }} />
          <span className="label shv__via">{t('features.share.view.via')}</span>
        </a>
        <span className="shv__spacer" />
        {page && (
          <>
            <span className="shv__ro label">
              <span className="led led--ok" aria-hidden /> {t('features.share.view.readOnly')}
            </span>
            <button className="btn btn--primary" onClick={() => void save()} disabled={saving || !!savedId}>
              {savedId ? <Check size={14} strokeWidth={2.2} /> : <Download size={14} strokeWidth={1.8} />}
              <span className="shv__save-long">{savedId ? t('features.share.view.savedShort') : t('features.share.view.save')}</span>
              <span className="shv__save-short">{savedId ? t('features.share.view.savedShort') : t('features.share.view.saveShort')}</span>
            </button>
          </>
        )}
      </header>

      {page ? (
        <article className={`shv__page${page.cover ? ' has-cover' : ''}`}>
          {page.cover && <Cover cover={page.cover} />}
          <div className="shv__col">
            {page.icon && (
              <div className="shv__icon">
                <PageIcon icon={page.icon} size={68} fallback={false} />
              </div>
            )}
            <h1 className="shv__title">{page.title.trim() || t('common.untitled')}</h1>
            <div className="shv__meta label">
              <span>{t('features.share.view.copy')}</span>
              {date && <span>{date}</span>}
              <span>{t('features.share.view.words', { count: fmtNum.format(words) })}</span>
            </div>
            <ReadOnlyDoc content={page.content} className="shv__doc" headingOffset={1} />
          </div>
          <footer className="shv__foot">
            <span className="shv__foot-rule" />
            <p>{t('features.share.view.footer')}</p>
            <a className="shv__foot-link" href="#/">
              {t('features.share.view.openApp', { name: BRAND.name })} <ArrowRight size={13} strokeWidth={1.8} />
            </a>
          </footer>
        </article>
      ) : locked ? (
        <LockPrompt payload={payload} onUnlock={(p) => setUnlocked({ payload, page: p })} />
      ) : (
        <div className="shv__error" role="alert">
          <span className="label shv__err-code">ERR · {t(`features.share.view.code.${'error' in decoded ? decoded.error : 'corrupt'}`)}</span>
          <h1 className="shv__err-title">{t('features.share.view.errorTitle')}</h1>
          <p>{t(`features.share.view.error.${'error' in decoded ? decoded.error : 'corrupt'}`)}</p>
          <button className="btn btn--ink" onClick={() => navigate({ name: 'home' })}>
            {t('features.share.view.toWorkspace')} <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/** Password prompt of a protected link: decrypts on this device, a wrong password can be retried. */
function LockPrompt({ payload, onUnlock }: { payload: string; onUnlock: (page: SharePayload) => void }) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'password' | 'corrupt' | 'unsupported' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // unique per prompt: password managers key saved entries by field name and site
  const fieldName = `share-key-${useId().replace(/[^\w-]/g, '')}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    if (!canEncrypt()) return setError('unsupported')
    setBusy(true)
    setError(null)
    try {
      onUnlock(await decryptPayload(payload, password))
    } catch (err) {
      setError(err instanceof ShareDecodeError && err.code !== 'password' ? 'corrupt' : 'password')
      setBusy(false)
      window.requestAnimationFrame(() => inputRef.current?.select())
    }
  }

  const message = error === 'password' ? t('features.share.lock.wrong') : error === 'unsupported' ? t('features.share.lock.unsupported') : error ? t('features.share.view.error.corrupt') : ''
  return (
    <form className="shv__lock" onSubmit={(e) => void submit(e)} aria-labelledby="shv-lock-title" autoComplete="off" data-share-lock="">
      <div className="shv__lock-plate" aria-hidden>
        <Lock size={24} strokeWidth={1.6} />
      </div>
      <span className="label shv__lock-code">
        <span className={`led${error ? ' led--on' : busy ? ' led--on shv__lock-busy' : ''}`} aria-hidden /> {t('features.share.lock.code')}
      </span>
      <h1 id="shv-lock-title" className="shv__err-title">
        {t('features.share.lock.title')}
      </h1>
      <p className="shv__lock-text">{t('features.share.lock.text')}</p>
      <label className="label shv__lock-label" htmlFor="shv-lock-input">
        {t('features.share.lock.label')}
      </label>
      <div className="shv__lock-row">
        {/* a one-off link password, not an account: no autofill, no "save password?" prompt */}
        <input
          id="shv-lock-input"
          ref={inputRef}
          className="input shv__lock-input"
          type="password"
          name={fieldName}
          value={password}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          spellCheck={false}
          aria-invalid={error === 'password' || undefined}
          aria-describedby={error ? 'shv-lock-error' : undefined}
          onChange={(e) => {
            setPassword(e.target.value)
            if (error === 'password') setError(null)
          }}
        />
        <button type="submit" className="btn btn--primary shv__lock-go" disabled={!password || busy}>
          <Unlock size={14} strokeWidth={1.8} /> {busy ? t('features.share.lock.unlocking') : t('features.share.lock.unlock')}
        </button>
      </div>
      {error && (
        <p id="shv-lock-error" className="shv__lock-error" role="alert">
          {message}
        </p>
      )}
    </form>
  )
}

function Cover({ cover }: { cover: NonNullable<SharePayload['cover']> }) {
  if (cover.type === 'image')
    return (
      <div className="shv__cover">
        <img src={resolveAssetUrl(cover.value)} alt="" style={{ objectPosition: `center ${cover.positionY}%` }} />
      </div>
    )
  if (cover.type === 'gradient') return <div className="shv__cover" style={{ background: cover.value }} />
  return <div className="shv__cover" style={{ background: `var(--c-${cover.value}-bg)` }} />
}
