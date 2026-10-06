/**
 * Share as link (the page is encoded into the URL — optionally encrypted with a password),
 * download as standalone HTML, copy Markdown.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ClipboardCopy, Download, ExternalLink, Eye, EyeOff, FileCode2, KeyRound, Link2, Lock, UserPlus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { openInviteSettings, useCloud } from '../../cloud'
import { Modal } from '../../ui/Modal'
import { Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { usePage } from '../../store/selectors'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { pageToMarkdown } from './markdown'
import { canEncrypt, encodePayload, encryptPayload, preparePage, shareUrl, SHARE_WARN_BYTES, type PrepareStats, type SharePayload } from './codec'
import { buildStandaloneHTML, downloadText } from './html'
import { HelpLink } from '../../help'
import './share.css'

interface Built {
  url: string
  bytes: number
  raw: number
  stats: PrepareStats
}

async function copyText(text: string, fallbackEl?: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (!fallbackEl) return false
    fallbackEl.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  }
}

export function ShareModal({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const page = usePage(pageId)
  const [prepared, setPrepared] = useState<{ payload: SharePayload; plainUrl: string; raw: number; stats: PrepareStats } | null>(null)
  const [failed, setFailed] = useState(false)
  // password protection: the link is encrypted in the browser (see codec.ts)
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [locked, setLocked] = useState<{ url: string; password: string } | null>(null)
  const [lockFailed, setLockFailed] = useState(false)
  const cryptoOk = useMemo(() => canEncrypt(), [])
  const [copied, setCopied] = useState<'link' | 'md' | null>(null)
  const [busyHtml, setBusyHtml] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fmtKB = useMemo(() => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }), [lang])

  useEffect(() => {
    let alive = true
    setPrepared(null)
    setFailed(false)
    preparePage(pageId)
      .then(({ payload, stats }) => {
        if (!alive) return
        const raw = new TextEncoder().encode(JSON.stringify(payload)).length
        setPrepared({ payload, plainUrl: shareUrl(encodePayload(payload)), raw, stats })
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // rebuild only when the dialog opens for a page
  }, [pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  // encrypt once typing pauses (PBKDF2 is deliberately slow); a fresh salt + IV every time
  useEffect(() => {
    setLocked(null)
    setLockFailed(false)
    if (!protect || !password || !prepared || !cryptoOk) return
    let alive = true
    const id = window.setTimeout(() => {
      encryptPayload(prepared.payload, password)
        .then((enc) => alive && setLocked({ url: shareUrl(enc), password }))
        .catch(() => alive && setLockFailed(true))
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [protect, password, prepared, cryptoOk])

  const url = !prepared ? null : protect ? (locked && locked.password === password ? locked.url : null) : prepared.plainUrl
  const built: Built | null = url && prepared ? { url, bytes: url.length, raw: prepared.raw, stats: prepared.stats } : null
  const linkText = built
    ? built.url
    : failed
      ? t('features.share.failed')
      : !prepared
        ? t('features.share.encoding')
        : lockFailed
          ? t('features.share.pw.failed')
          : protect && !password
            ? t('features.share.pw.enter')
            : t('features.share.pw.encrypting')

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(null), 1800)
    return () => window.clearTimeout(id)
  }, [copied])

  const copyLink = async () => {
    if (!built) return
    const ok = await copyText(built.url, inputRef.current)
    if (ok) setCopied('link')
    else useUI.getState().toast({ message: t('features.share.copyFailed'), kind: 'error' })
  }

  const copyMarkdown = async () => {
    const p = page
    if (!p) return
    // flattened copy: no workspace-internal links, local images replaced by a note
    const { payload } = await preparePage(pageId, 0).catch(() => ({ payload: { content: p.content } }))
    const md = pageToMarkdown(p.title.trim() || t('common.untitled'), payload.content)
    const ok = await copyText(md)
    if (ok) setCopied('md')
    else useUI.getState().toast({ message: t('features.share.copyFailed'), kind: 'error' })
  }

  const downloadHtml = async () => {
    setBusyHtml(true)
    try {
      const { html, filename } = await buildStandaloneHTML(pageId, lang)
      downloadText(filename, html)
      useUI.getState().toast({ message: t('features.share.downloaded', { name: filename }), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.share.htmlFailed'), kind: 'error' })
    } finally {
      setBusyHtml(false)
    }
  }

  const waiting = protect && !password && !!prepared
  const kb = built ? built.bytes / 1024 : 0
  const warn = !!built && built.bytes > SHARE_WARN_BYTES
  const scale = Math.max(64, Math.ceil((kb * 1.15) / 16) * 16)
  const ratio = built && built.bytes ? built.raw / built.bytes : 0

  return (
    <Modal
      open
      onClose={onClose}
      label={`§ ${t('features.share.label')}`}
      title={
        <>
          {t('features.share.title')}
          <HelpLink id="share-links" />
        </>
      }
      width={600}
      className="share"
    >
      <div className="share__hero">
        <p className="share__claim">{t('features.share.claim')}</p>
        <p className="share__sub">{t('features.share.sub')}</p>
      </div>

      <div className="share__link" data-ready={!!built || undefined}>
        <Link2 size={15} strokeWidth={1.7} className="share__link-icon" aria-hidden />
        <input
          ref={inputRef}
          className="share__url mono"
          readOnly
          value={linkText}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t('features.share.linkLabel')}
        />
        <button className="btn btn--primary share__copy" data-autofocus="" onClick={() => void copyLink()} disabled={!built}>
          {copied === 'link' ? <Check size={14} strokeWidth={2.2} /> : null}
          {copied === 'link' ? t('features.share.copied') : t('common.copyLink')}
        </button>
      </div>

      <div className="share__lock" data-on={protect || undefined}>
        <div className="share__lock-head">
          <Lock size={14} strokeWidth={1.8} className="share__lock-icon" aria-hidden />
          <span className="share__lock-title" onClick={() => cryptoOk && setProtect(!protect)}>
            {t('features.share.pw.toggle')}
          </span>
          <span className="share__spacer" />
          {protect && <span className="label share__lock-cipher">{t('features.share.pw.cipher')}</span>}
          <Switch checked={protect} onChange={setProtect} label={t('features.share.pw.toggle')} disabled={!cryptoOk} />
        </div>
        {protect && (
          <div className="share__lock-body">
            <div className="share__pw">
              <KeyRound size={14} strokeWidth={1.7} className="share__pw-icon" aria-hidden />
              <input
                className="share__pw-input"
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('features.share.pw.placeholder')}
                aria-label={t('features.share.pw.label')}
                autoComplete="new-password"
                spellCheck={false}
                autoFocus
                maxLength={256}
                data-share-password=""
              />
              <button type="button" className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? t('features.share.pw.hide') : t('features.share.pw.show')} aria-pressed={reveal}>
                {reveal ? <EyeOff size={14} strokeWidth={1.7} /> : <Eye size={14} strokeWidth={1.7} />}
              </button>
            </div>
            <p className="share__lock-note">
              {t('features.share.pw.note')}
              {password && password.length < 8 && <span className="share__lock-warn"> {t('features.share.pw.short')}</span>}
            </p>
          </div>
        )}
        {!cryptoOk && <p className="share__lock-note">{t('features.share.pw.unsupported')}</p>}
      </div>

      <div className="share__meter" aria-live="polite">
        <div className="share__meter-head label">
          <span className={`led ${waiting ? '' : !built ? 'led--on share__led--busy' : warn ? 'led--on' : 'led--ok'}`} aria-hidden />
          <span>{t('features.share.payload')}</span>
          <span className="share__spacer" />
          {built && (
            <>
              <span className="share__num">{fmtKB.format(kb)} KB</span>
              <span className="share__sep">·</span>
              <span>
                {t('features.share.ratio')} {fmtKB.format(ratio)}:1
              </span>
            </>
          )}
        </div>
        <div className="share__gauge" style={{ ['--fill' as string]: `${Math.min(100, (kb / scale) * 100)}%`, ['--limit' as string]: `${(50 / scale) * 100}%`, ['--tick' as string]: `${(8 / scale) * 100}%` }} data-warn={warn || undefined}>
          <span className="share__gauge-fill" />
          <span className="share__gauge-limit">
            <span className="mono">50 KB</span>
          </span>
        </div>
        <p className="share__note">
          {waiting
            ? t('features.share.pw.enter')
            : !built
              ? t('features.share.encodingNote')
              : warn
                ? t('features.share.warnLong')
                : t('features.share.fits')}
          {built && built.stats.inlined > 0 && ` ${t('features.share.imagesInlined', { count: built.stats.inlined })}`}
          {built && built.stats.dropped > 0 && ` ${t('features.share.imagesDropped', { count: built.stats.dropped })}`}
        </p>
      </div>

      <div className="share__formats">
        <div className="label share__formats-label">{t('features.share.otherFormats')}</div>
        <div className="share__grid">
          <button className="share__card" onClick={() => void downloadHtml()} disabled={busyHtml}>
            <span className="share__card-icon">
              <FileCode2 size={18} strokeWidth={1.6} />
            </span>
            <span className="share__card-text">
              <span className="share__card-title">{t('features.share.html')}</span>
              <span className="share__card-sub">{t('features.share.htmlSub')}</span>
            </span>
            <Download size={15} strokeWidth={1.7} className="share__card-go" />
          </button>
          <button className="share__card" onClick={() => void copyMarkdown()}>
            <span className="share__card-icon mono">M↓</span>
            <span className="share__card-text">
              <span className="share__card-title">{copied === 'md' ? t('features.share.copied') : t('features.share.markdown')}</span>
              <span className="share__card-sub">{t('features.share.markdownSub')}</span>
            </span>
            {copied === 'md' ? <Check size={15} strokeWidth={2} className="share__card-go" /> : <ClipboardCopy size={15} strokeWidth={1.7} className="share__card-go" />}
          </button>
        </div>
        {built && (
          <a className="share__preview" href={built.url} target="_blank" rel="noreferrer">
            {t('features.share.preview')} <ExternalLink size={12} strokeWidth={1.8} />
          </a>
        )}
      </div>
      <TeamInvite />
    </Modal>
  )
}

/** In a team workspace, its admins can invite people instead of sending a copy (Workspace settings → People). */
function TeamInvite() {
  const t = useT()
  const ws = useCloud(
    useShallow((c) => {
      const admin = c.active.kind === 'cloud' && !!c.user && (c.role === 'owner' || c.role === 'admin')
      return admin ? (c.workspaces.find((w) => w.id === c.active.id)?.name ?? null) : null
    }),
  )
  if (!ws) return null
  return (
    <div className="share__team">
      <div className="label share__formats-label">{t('features.share.team.label')}</div>
      <button type="button" className="share__card share__card--wide" data-testid="share-invite" onClick={openInviteSettings}>
        <span className="share__card-icon">
          <UserPlus size={18} strokeWidth={1.6} />
        </span>
        <span className="share__card-text">
          <span className="share__card-title">{t('features.share.team.title', { workspace: ws })}</span>
          <span className="share__card-sub">{t('features.share.team.sub')}</span>
        </span>
        <ArrowRight size={15} strokeWidth={1.7} className="share__card-go" />
      </button>
    </div>
  )
}
