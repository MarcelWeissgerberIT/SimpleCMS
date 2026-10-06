/**
 * Quick capture: a compact sheet for a thought, a voice note or a photo — saved in seconds, online or not.
 *
 *  - Opens with the floating key on phones (bottom right, hidden while typing or while the keyboard is up),
 *    Mod+Shift+K anywhere, ⌘K "Quick capture", and the home-screen shortcut "Quick note" (?launch=capture).
 *  - Text (Markdown; the first line becomes the title), a mic key (the browser's speech recognition, the one
 *    meeting notes use — finished phrases are typed into the text), a camera key (input capture → image
 *    blocks), an attach key (any file), a target (Clippings, or any page / database → a row), Save (Enter;
 *    on touch screens Enter is a new line and the Save key saves).
 *  - CaptureHost (mounted once by the shell) also runs the manifest's other shortcuts (?launch=new-page |
 *    search | terminal) and shows the install placard.
 * The unsent text is kept per device (localStorage `one.capture.draft`) until it is saved.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Camera, ChevronDown, FileText, Inbox, Mic, Paperclip, Plus, Square, X } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import { shortcutLabel } from '../../ui/controls'
import { useT } from '../../i18n'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { flushSave } from '../../store/persistence'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { SpeechRecognizer, openAgent, speechSupported, type SpeechErrorCode } from '../../features'
import { useIsMobile } from '../lib/hooks'
import { createPageAndOpen, goToPage } from '../lib/actions'
import { isReadOnly, useReadOnly } from '../cloud/state'
import { InstallPlacardHost } from './Install'
import { captureTargets, saveCapture, writable, type CaptureTarget } from './quick'
import { SHARE_FILE_MAX, SHARE_TOTAL_MAX } from './share'
import { sizeLabel } from './ClipConfirm'
import { closeQuickCapture, openQuickCapture, useCaptureUI, QUICK_CAPTURE_SHORTCUT } from './state'
import './capture.css'

const DRAFT_KEY = 'one.capture.draft'

/* ------------------------------------------------------------------ */
/* Host: the key, the sheet, the placard, the shortcuts                */
/* ------------------------------------------------------------------ */

export function CaptureHost() {
  const sheet = useCaptureUI((s) => s.sheet)
  const placard = useCaptureUI((s) => s.placard)
  useCaptureShortcut()
  useLaunchAction()
  return (
    <>
      <CaptureFab />
      {sheet && <QuickCaptureSheet onClose={closeQuickCapture} />}
      <InstallPlacardHost open={placard} />
    </>
  )
}

/** Mod+Shift+K opens (and closes) the sheet — in the capture phase, before editors see the key. */
function useCaptureShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || !e.shiftKey || !(e.metaKey || e.ctrlKey)) return
      const k = e.key.length === 1 && /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyK' ? 'k' : ''
      if (k !== 'k') return
      e.preventDefault()
      e.stopPropagation()
      if (useCaptureUI.getState().sheet) closeQuickCapture()
      else if (!isReadOnly()) openQuickCapture()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

let launched = false

/** The manifest's shortcuts: /app/?launch=capture | new-page | search | terminal (the parameter is removed). */
function useLaunchAction() {
  useEffect(() => {
    if (launched) return
    const what = new URLSearchParams(window.location.search).get('launch')
    if (!what) return
    launched = true
    const rest = window.location.search
      .slice(1)
      .split('&')
      .filter((p) => p && !/^launch(=|$)/.test(p))
    history.replaceState(null, '', `${window.location.pathname}${rest.length ? `?${rest.join('&')}` : ''}${window.location.hash}`)
    // after the start page took its place
    requestAnimationFrame(() => {
      if (what === 'capture' && !isReadOnly()) openQuickCapture()
      else if (what === 'new-page' && !isReadOnly()) createPageAndOpen(null)
      else if (what === 'search') useUI.getState().openPalette()
      else if (what === 'terminal') openAgent()
    })
  }, [])
}

/** Something is being typed: an input / editor has focus, or the on-screen keyboard is up. */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    const editable = (el: Element | null) =>
      el instanceof HTMLElement && !!el.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="file"]), textarea, select, [contenteditable="true"], [contenteditable=""]')
    const update = () => setTyping(editable(document.activeElement) || (!!vv && vv.height < window.innerHeight * 0.75))
    const later = () => window.setTimeout(update, 0)
    update()
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', later)
    vv?.addEventListener('resize', update)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', later)
      vv?.removeEventListener('resize', update)
    }
  }, [])
  return typing
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [])
  return online
}

/** Phones: the floating capture key (nothing on wider screens — Mod+Shift+K there). */
function CaptureFab() {
  const t = useT()
  const mobile = useIsMobile()
  const readOnly = useReadOnly()
  const typing = useTyping()
  const covered = useUI((s) => s.mobileSidebarOpen || !!s.modal || s.paletteOpen || !!s.peekPageId || !!s.presentPageId || s.focusMode)
  // one short toast: the key steps up above it; a stack of toasts: the key waits until they are gone
  const toasts = useUI((s) => (!s.toasts.length ? 'none' : s.toasts.length === 1 && !s.toasts[0].more?.length ? 'one' : 'many'))
  const hidden = typing || toasts === 'many'
  const sheet = useCaptureUI((s) => s.sheet)
  if (!mobile || readOnly || covered || sheet) return null
  return (
    <button
      type="button"
      className="qcap-fab"
      data-hidden={hidden || undefined}
      data-lifted={toasts === 'one' || undefined}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      aria-label={t('shell.qcap.title')}
      data-testid="capture-fab"
      onClick={openQuickCapture}
    >
      <Plus size={22} strokeWidth={1.75} aria-hidden />
      <span className="qcap-fab__led" aria-hidden />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Voice: the meeting notes' recognizer, phrases into the text         */
/* ------------------------------------------------------------------ */

function speechLang(ui: string): string {
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  if (nav && nav.toLowerCase().startsWith(ui)) return nav
  return ui === 'de' ? 'de-DE' : 'en-US'
}

function useVoice(onFinal: (text: string) => void) {
  const lang = useWorkspace((s) => s.settings.language)
  const [state, setState] = useState<'idle' | 'starting' | 'listening'>('idle')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<SpeechErrorCode | null>(null)
  const rec = useRef<InstanceType<typeof SpeechRecognizer> | null>(null)
  const final = useRef(onFinal)
  final.current = onFinal
  useEffect(() => () => rec.current?.abort(), [])
  const start = () => {
    setError(null)
    setState('starting')
    const r = new SpeechRecognizer(speechLang(lang), {
      onStart: () => setState('listening'),
      onFinal: (text) => final.current(text),
      onInterim: setInterim,
      onEnd: (err) => {
        if (rec.current === r) rec.current = null
        setState('idle')
        setInterim('')
        if (err) setError(err)
      },
    })
    rec.current = r
    r.start()
  }
  const stop = () => rec.current?.stop()
  /** stop now, without waiting for phrases in flight (Save takes the interim text as it is) */
  const abort = () => {
    rec.current?.abort()
    rec.current = null
    setState('idle')
    setInterim('')
  }
  return { state, interim, error, start, stop, abort }
}

/** A phrase joins the text: a space after a word, nothing after a line break or an empty field. */
const joinPhrase = (text: string, phrase: string) => (!text || /\s$/.test(text) ? `${text}${phrase}` : `${text} ${phrase}`)

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

interface Attached {
  id: number
  file: File
  /** object URL of an image (thumbnail) */
  url: string | null
}

let nextFileId = 1

export function QuickCaptureSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const uid = useId()
  const mobile = useIsMobile()
  const online = useOnline()
  const [text, setText] = useState(() => safeLocalGet(DRAFT_KEY) ?? '')
  const [files, setFiles] = useState<Attached[]>([])
  const [target, setTarget] = useState<CaptureTarget>({ kind: 'inbox' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const attach = useRef<HTMLInputElement>(null)
  const voice = useVoice((phrase) => setText((v) => joinPhrase(v, phrase)))
  // a target picked: back to the text, so Enter saves
  const pick = useCallback((next: CaptureTarget) => {
    setTarget(next)
    requestAnimationFrame(() => area.current?.focus({ preventScroll: true }))
  }, [])
  const canSpeak = speechSupported()

  // the draft stays on this device until it is saved
  useEffect(() => {
    safeLocalSet(DRAFT_KEY, text ? text : null)
  }, [text])
  // thumbnails are object URLs: released with the sheet
  const filesRef = useRef(files)
  filesRef.current = files
  useEffect(() => () => filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)), [])
  // phones: the sheet sits on the on-screen keyboard (the visual viewport shrinks, the layout one may not)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--qcap-kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`)
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--qcap-kb')
    }
  }, [])
  // the field grows with its text (up to the CSS max-height)
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [text])

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? [])
    if (!picked.length) return
    let total = files.reduce((n, f) => n + f.file.size, 0)
    const ok: Attached[] = []
    for (const file of picked) {
      if (file.size > SHARE_FILE_MAX) {
        setMsg(t('shell.qcap.tooBig', { name: file.name }))
        continue
      }
      if (total + file.size > SHARE_TOTAL_MAX) {
        setMsg(t('shell.qcap.overTotal'))
        continue
      }
      total += file.size
      ok.push({ id: nextFileId++, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })
    }
    if (ok.length) setFiles((f) => [...f, ...ok])
  }
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files)
    e.target.value = ''
    area.current?.focus({ preventScroll: true })
  }
  const remove = (id: number) =>
    setFiles((list) =>
      list.filter((f) => {
        if (f.id === id && f.url) URL.revokeObjectURL(f.url)
        return f.id !== id
      }),
    )

  const save = async () => {
    if (busy) return
    const value = (voice.interim ? joinPhrase(text, voice.interim) : text).trim()
    if (!value && !files.length) {
      setMsg(t('shell.qcap.empty'))
      area.current?.focus()
      return
    }
    voice.abort()
    setBusy(true)
    setMsg(null)
    try {
      const res = await saveCapture({ text: value, files: files.map((f) => ({ name: f.file.name, type: f.file.type, blob: f.file })), target })
      safeLocalSet(DRAFT_KEY, null)
      setText('')
      onClose()
      const p = useWorkspace.getState().pages[res.target.kind === 'inbox' ? res.id : res.target.id]
      const where = res.target.kind === 'inbox' ? t('shell.capture.inbox') : p?.title.trim() || t('common.untitled')
      const key = res.target.kind === 'inbox' ? 'shell.qcap.savedInbox' : res.target.kind === 'database' ? 'shell.qcap.savedRow' : 'shell.qcap.savedPage'
      useUI.getState().toast({
        message: `${t(key, { where })}${navigator.onLine ? '' : ` · ${t('shell.qcap.offlineSaved')}`}${res.failed ? ` · ${t('shell.qcap.filesFailed', { n: res.failed })}` : ''}`,
        kind: res.failed ? 'error' : 'success',
        action: { label: t('shell.qcap.open'), run: () => goToPage(res.id) },
      })
      void flushSave().catch(() => {})
    } catch (e) {
      console.warn('[one] quick capture failed', e)
      setMsg(t('shell.qcap.failed'))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    const mod = e.metaKey || e.ctrlKey
    // touch screens: the return key writes a new line, the Save key saves
    const touch = window.matchMedia?.('(pointer: coarse)').matches
    if (mod || (!e.shiftKey && !touch)) {
      e.preventDefault()
      void save()
    }
  }

  const micLabel = !canSpeak ? t('shell.qcap.mic.unsupported') : !online ? t('shell.qcap.mic.offline') : voice.state === 'idle' ? t('shell.qcap.mic.start') : t('shell.qcap.mic.stop')
  const hint = target.kind === 'database' ? t('shell.qcap.hint.row') : target.kind === 'page' ? t('shell.qcap.hint.page') : t('shell.qcap.hint.inbox')

  return (
    <Modal open onClose={onClose} width={520} bare className="qcap" ariaLabel={t('shell.qcap.title')}>
      <form
        className="qcap__body"
        data-testid="quick-capture"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="qcap__head">
          <span className="label qcap__code">
            <span className={`led${voice.state === 'listening' ? ' led--on qcap__rec' : ' led--on'}`} aria-hidden /> {t('shell.qcap.title')}
          </span>
          {!online && (
            <span className="label qcap__offline" role="status">
              <span className="led" aria-hidden /> {t('shell.qcap.offline')}
            </span>
          )}
          {!mobile && <span className="kbd qcap__kbd">{shortcutLabel(QUICK_CAPTURE_SHORTCUT)}</span>}
          <button type="button" className="icon-btn qcap__close" aria-label={t('common.close')} onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>

        <label className="visually-hidden" htmlFor={`${uid}-text`}>
          {t('shell.qcap.textLabel')}
        </label>
        <textarea
          ref={area}
          id={`${uid}-text`}
          className="qcap__text"
          value={text}
          rows={3}
          placeholder={t('shell.qcap.placeholder')}
          aria-describedby={`${uid}-hint`}
          data-autofocus=""
          enterKeyHint="enter"
          spellCheck
          onChange={(e) => {
            setText(e.target.value)
            if (msg) setMsg(null)
          }}
          onKeyDown={onKeyDown}
        />
        {voice.interim && (
          <p className="qcap__interim" aria-live="polite">
            {voice.interim}
          </p>
        )}

        {files.length > 0 && (
          <ul className="qcap__files" aria-label={t('shell.qcap.attached')}>
            {files.map((f) => (
              <li key={f.id} className="qcap__file" data-kind={f.url ? 'image' : 'file'}>
                {f.url ? <img src={f.url} alt="" className="qcap__thumb" /> : <FileText size={16} strokeWidth={1.75} aria-hidden className="qcap__fglyph" />}
                <span className="qcap__fname">{f.file.name}</span>
                <span className="qcap__fsize mono">{sizeLabel(f.file.size)}</span>
                <button type="button" className="icon-btn icon-btn--sm qcap__fdel" aria-label={t('shell.qcap.remove', { name: f.file.name })} onClick={() => remove(f.id)}>
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="qcap__target">
          <span className="label" id={`${uid}-to`}>
            {t('shell.qcap.to')}
          </span>
          <TargetPicker target={target} onChange={pick} labelledBy={`${uid}-to`} />
          <span className="qcap__hint" id={`${uid}-hint`}>
            {hint}
          </span>
        </div>

        {(msg || voice.error) && (
          <p className="qcap__msg" role="alert">
            {msg ?? t(`shell.qcap.mic.err.${voice.error}`)}
          </p>
        )}

        <div className="qcap__bar">
          <Tooltip label={micLabel} placement="top">
            <button
              type="button"
              className="qcap__tool"
              data-on={voice.state !== 'idle' || undefined}
              aria-pressed={voice.state !== 'idle'}
              aria-label={micLabel}
              disabled={!canSpeak || (!online && voice.state === 'idle')}
              onClick={() => (voice.state === 'idle' ? voice.start() : voice.stop())}
            >
              {voice.state === 'idle' ? <Mic size={18} strokeWidth={1.75} aria-hidden /> : <Square size={14} strokeWidth={2} aria-hidden />}
            </button>
          </Tooltip>
          <Tooltip label={t('shell.qcap.photo')} placement="top">
            <button type="button" className="qcap__tool" aria-label={t('shell.qcap.photo')} onClick={() => camera.current?.click()}>
              <Camera size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={t('shell.qcap.attach')} placement="top">
            <button type="button" className="qcap__tool" aria-label={t('shell.qcap.attach')} onClick={() => attach.current?.click()}>
              <Paperclip size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </Tooltip>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-testid="capture-photo" onChange={onPick} />
          <input ref={attach} type="file" multiple hidden data-testid="capture-file" onChange={onPick} />
          {voice.state === 'listening' && <span className="label qcap__listening">{t('shell.qcap.mic.listening')}</span>}
          <span className="qcap__spacer" />
          <button type="submit" className="btn btn--primary qcap__save" disabled={busy}>
            {t('shell.qcap.save')}
            {!mobile && <span className="kbd qcap__savekbd">↵</span>}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Target: Clippings, a database (→ a row) or a page (→ at its end)    */
/* ------------------------------------------------------------------ */

function TargetPicker({ target, onChange, labelledBy }: { target: CaptureTarget; onChange: (t: CaptureTarget) => void; labelledBy: string }) {
  const t = useT()
  const menu = useMenu()
  const page = useWorkspace((s) => (target.kind === 'inbox' ? undefined : s.pages[target.id]))
  // the chosen page went away (trashed, locked meanwhile): back to Clippings
  useEffect(() => {
    if (target.kind !== 'inbox' && !writable(page)) onChange({ kind: 'inbox' })
  }, [page, target.kind, onChange])
  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu.open) return []
    const list = captureTargets()
    const item = (p: (typeof list)[number]): MenuEntry => ({
      id: p.id,
      label: p.page.title.trim() || t('common.untitled'),
      icon: <PageIcon icon={p.page.icon} kind={p.kind} size={15} />,
      checked: target.kind !== 'inbox' && target.id === p.id,
      hint: p.kind === 'database' ? t('shell.qcap.kind.db') : undefined,
      onSelect: () => onChange({ kind: p.kind === 'database' ? 'database' : 'page', id: p.id }),
    })
    const dbs = list.filter((p) => p.kind === 'database')
    const pages = list.filter((p) => p.kind === 'page')
    return [
      { id: 'inbox', label: t('shell.capture.inbox'), icon: <Inbox size={15} />, checked: target.kind === 'inbox', hint: t('shell.qcap.kind.default'), onSelect: () => onChange({ kind: 'inbox' }) },
      ...(dbs.length ? [{ kind: 'section', label: t('shell.qcap.databases') } as MenuEntry, ...dbs.map(item)] : []),
      ...(pages.length ? [{ kind: 'section', label: t('shell.qcap.pages') } as MenuEntry, ...pages.map(item)] : []),
    ]
  }, [menu.open, target, onChange, t])
  const label = target.kind === 'inbox' ? t('shell.capture.inbox') : page?.title.trim() || t('common.untitled')
  return (
    <>
      <button
        type="button"
        className="qcap__pick"
        onClick={menu.toggle}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-labelledby={`${labelledBy} ${labelledBy}-v`}
        data-testid="capture-target"
      >
        <span className="qcap__pickicon" aria-hidden>
          {target.kind === 'inbox' ? <Inbox size={15} /> : <PageIcon icon={page?.icon} kind={page?.kind} size={15} />}
        </span>
        <span className="qcap__picklabel" id={`${labelledBy}-v`}>
          {label}
        </span>
        <ChevronDown size={14} className="faint" aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} searchable searchPlaceholder={t('shell.qcap.searchTarget')} width={300} placement="top-start" />
    </>
  )
}
