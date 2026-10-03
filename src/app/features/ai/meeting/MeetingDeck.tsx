/**
 * The controls of a meeting notes block (rendered by the editor's node view above the notes):
 * a placard bar (state LED + read-out, language, menu), the title, tape-deck transport keys
 * (REC latches while recording, its LED pulses; PAUSE latches while paused; STOP), the live
 * transcript, paste-a-transcript, and errors explained in place. Read-only renders (share view,
 * history, locked pages) get the bar, title and transcript without controls.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ClipboardPaste, Copy, KeyRound, Languages, Mic, MoreHorizontal, NotebookPen, Pause, RotateCcw, Square, Trash2 } from 'lucide-react'
import { meetingAttrs, transcriptText, transcriptWords, type MeetingAttrs, type TranscriptSegment } from '../../../editor'
import { useLang, useT } from '../../../i18n'
import { useUI, toast } from '../../../store/ui'
import { useCloud } from '../../../cloud'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { Key, Notice, PastePanel, TitleField, TranscriptPanel, wordsLabel } from './parts'
import { speechSupported } from './recognition'
import {
  attachMeeting,
  cancelSummary,
  clearMeetingError,
  detachMeeting,
  elapsedMs,
  pauseRecording,
  startRecording,
  stopRecording,
  summarizeMeeting,
  useMeetingRuntime,
  type MeetingRuntime,
} from './session'
import { patchMeeting, editorPageId, type MeetingTarget } from './write'
import './meeting.css'

export type DeckMode = 'blank' | 'starting' | 'listening' | 'paused' | 'interrupted' | 'stopping' | 'remote' | 'summarizing' | 'remoteSummarizing' | 'ready' | 'done'

const IDLE_RT: MeetingRuntime = { phase: 'idle', interim: '', since: null, base: 0, speechError: null, aiError: null }

/** What the deck shows: this device's runtime first, then the block's shared status. */
export function deckMode(a: MeetingAttrs, rt: MeetingRuntime, inCloud: boolean): DeckMode {
  if (rt.phase !== 'idle') return rt.phase
  if (a.status === 'recording' || a.status === 'paused') return inCloud ? 'remote' : 'interrupted'
  if (a.status === 'summarizing' && inCloud) return 'remoteSummarizing'
  if (a.status === 'done') return 'done'
  return a.transcript.length ? 'ready' : 'blank'
}

export const MEETING_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'de-AT', name: 'Deutsch (Österreich)' },
  { code: 'de-CH', name: 'Deutsch (Schweiz)' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'es-ES', name: 'Español' },
  { code: 'it-IT', name: 'Italiano' },
  { code: 'nl-NL', name: 'Nederlands' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pl-PL', name: 'Polski' },
  { code: 'sv-SE', name: 'Svenska' },
  { code: 'ja-JP', name: '日本語' },
]

/** Re-render every `ms` while `on`. */
function useTick(on: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [on, ms])
  return now
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}

export interface MeetingDeckProps {
  editor: Editor
  node: PMNode
  editable: boolean
}

export function MeetingDeck({ editor, node, editable }: MeetingDeckProps) {
  const t = useT()
  const lang = useLang()
  const attrs = useMemo(() => meetingAttrs(node), [node])
  const blockId = attrs.id
  const rt = useMeetingRuntime((s) => (blockId ? s[blockId] : undefined)) ?? IDLE_RT
  const inCloud = useCloud((s) => s.active.kind === 'cloud')
  const mode = deckMode(attrs, rt, inCloud)
  const live = mode === 'listening' || mode === 'starting'
  const now = useTick(mode === 'listening')
  const supported = useMemo(() => speechSupported(), [])
  const [txOpen, setTxOpen] = useState(false)
  const [paste, setPaste] = useState(false)
  const menu = useMenu()

  // page editors (also locked ones) carry the recording; static renders never do
  const bound = !!editorPageId(editor)
  useEffect(() => {
    if (!blockId || !bound) return
    attachMeeting(blockId, editor)
    return () => detachMeeting(blockId, editor)
  }, [blockId, editor, bound])

  // the transcript opens while recording and folds away once the notes are written
  useEffect(() => {
    if (mode === 'listening' || mode === 'starting' || mode === 'paused') setTxOpen(true)
    else if (mode === 'done') setTxOpen(false)
  }, [mode])

  const target = (): MeetingTarget => ({ blockId: blockId ?? '', pageId: editorPageId(editor), editor })
  const elapsed = mode === 'listening' ? elapsedMs(rt, now) : mode === 'paused' || mode === 'stopping' ? rt.base : attrs.duration
  const words = transcriptWords(attrs.transcript)
  const canAct = editable && !!blockId

  const record = () => blockId && startRecording(blockId, { language: attrs.language || 'en-US', resumeFrom: attrs.duration })
  const stop = () => blockId && stopRecording(blockId, { summarize: true })
  const summarize = () => blockId && void summarizeMeeting(blockId)
  const usePasted = (segs: TranscriptSegment[]) => {
    if (!blockId) return
    setPaste(false)
    const ok = patchMeeting(target(), (a) => ({ transcript: [...a.transcript, ...segs], startedAt: a.startedAt ?? Date.now(), endedAt: a.endedAt ?? Date.now() }), { history: true })
    if (ok) void summarizeMeeting(blockId)
  }
  const regenerate = () => {
    if (!blockId) return
    useUI.getState().openModal({
      type: 'confirm',
      title: t('features.meeting.regenerateConfirm'),
      body: t('features.meeting.regenerateBody'),
      confirmLabel: t('features.meeting.regenerateOk'),
      onConfirm: () => void summarizeMeeting(blockId),
    })
  }
  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText(attrs.transcript))
      toast({ message: t('features.meeting.copied'), kind: 'success' })
    } catch {
      toast({ message: t('features.meeting.copyFailed'), kind: 'error' })
    }
  }
  const deleteTranscript = () =>
    useUI.getState().openModal({
      type: 'confirm',
      title: t('features.meeting.deleteConfirm'),
      body: t('features.meeting.deleteBody'),
      danger: true,
      confirmLabel: t('features.meeting.deleteOk'),
      onConfirm: () => patchMeeting(target(), { transcript: [] }, { history: true }),
    })

  const recordingNow = mode === 'starting' || mode === 'listening' || mode === 'paused' || mode === 'stopping'
  const langEntries: MenuEntry[] = (MEETING_LANGUAGES.some((l) => l.code === attrs.language) ? MEETING_LANGUAGES : [{ code: attrs.language, name: attrs.language }, ...MEETING_LANGUAGES])
    .filter((l) => l.code)
    .map((l) => ({
      id: l.code,
      label: l.name,
      hint: l.code,
      checked: l.code === attrs.language,
      onSelect: () => patchMeeting(target(), { language: l.code }),
    }))
  const menuEntries: MenuEntry[] = [
    { label: t('features.meeting.language'), icon: <Languages size={15} />, hint: attrs.language || '—', disabled: recordingNow, submenu: recordingNow ? undefined : langEntries },
    ...(recordingNow ? [{ label: t('features.meeting.languageLocked'), disabled: true } as MenuEntry] : []),
    { kind: 'separator' },
    ...(attrs.transcript.length && mode === 'done' ? [{ label: t('features.meeting.regenerate'), icon: <RotateCcw size={15} />, onSelect: regenerate } as MenuEntry] : []),
    ...(mode === 'done' && supported ? [{ label: t('features.meeting.continue'), icon: <Mic size={15} />, onSelect: record } as MenuEntry] : []),
    ...(!recordingNow && mode !== 'summarizing' ? [{ label: t('features.meeting.paste'), icon: <ClipboardPaste size={15} />, onSelect: () => setPaste(true) } as MenuEntry] : []),
    ...(attrs.transcript.length ? [{ label: t('features.meeting.copyTranscript'), icon: <Copy size={15} />, onSelect: () => void copyTranscript() } as MenuEntry] : []),
    ...(attrs.transcript.length && !recordingNow && mode !== 'summarizing' ? [{ kind: 'separator' } as MenuEntry, { label: t('features.meeting.deleteTranscript'), icon: <Trash2 size={15} />, danger: true, onSelect: deleteTranscript } as MenuEntry] : []),
  ]

  return (
    <div className="mtg__deck" contentEditable={false} suppressContentEditableWarning role="group" aria-label={t('features.meeting.region')} data-mode={mode}>
      <Bar mode={mode} elapsed={elapsed} attrs={attrs} editable={canAct} onMenu={menu.toggle} menuOpen={menu.open} />
      <div className="mtg__head">
        <TitleField value={attrs.title} editable={canAct} onCommit={(v) => patchMeeting(target(), { title: v }, { history: true })} />
        <Meta attrs={attrs} words={words} lang={lang} />
      </div>

      {canAct && (
        <Transport
          mode={mode}
          supported={supported}
          elapsed={elapsed}
          recordedBy={attrs.recordedBy}
          words={wordsLabel(t, words, lang)}
          onRecord={record}
          onPause={() => blockId && pauseRecording(blockId)}
          onStop={stop}
          onCancelStart={() => blockId && pauseRecording(blockId)}
          onSummarize={summarize}
          onCancelSummary={() => blockId && cancelSummary(blockId)}
          onPaste={() => setPaste(true)}
        />
      )}

      {canAct && rt.speechError && (
        <Notice
          code={rt.speechError}
          title={t(`features.meeting.err.${rt.speechError}.title`)}
          actions={
            <>
              {rt.speechError !== 'unsupported' && rt.speechError !== 'language' && (
                <button type="button" className="btn btn--sm btn--ink" onClick={record}>
                  {t('features.meeting.retry')}
                </button>
              )}
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => blockId && clearMeetingError(blockId)}>
                {t('features.meeting.dismiss')}
              </button>
            </>
          }
        >
          {t(`features.meeting.err.${rt.speechError}`, { lang: attrs.language })}
        </Notice>
      )}
      {canAct && rt.aiError && <AINotice error={rt.aiError} onRetry={summarize} onDismiss={() => blockId && clearMeetingError(blockId)} />}

      {canAct && (paste || (mode === 'blank' && !supported)) && (
        <>
          {!supported && mode === 'blank' && <p className="mtg__note">{t('features.meeting.unsupported')}</p>}
          <PastePanel onUse={usePasted} onCancel={supported || mode !== 'blank' ? () => setPaste(false) : undefined} />
        </>
      )}

      <TranscriptPanel
        segments={attrs.transcript}
        interim={rt.interim}
        live={live}
        open={txOpen}
        onToggle={() => setTxOpen((o) => !o)}
        liveAt={mode === 'listening' ? elapsedMs(rt, now) : rt.base}
      />
      {canAct && <Menu {...menu.props} entries={menuEntries} placement="bottom-end" width={260} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bar + meta                                                          */
/* ------------------------------------------------------------------ */

function Bar({ mode, elapsed, attrs, editable, onMenu, menuOpen }: { mode: DeckMode; elapsed: number; attrs: MeetingAttrs; editable: boolean; onMenu: (e: React.MouseEvent) => void; menuOpen: boolean }) {
  const t = useT()
  const state: Record<DeckMode, string> = {
    blank: 'standby',
    starting: 'starting',
    listening: 'rec',
    paused: 'paused',
    interrupted: 'paused',
    stopping: 'stopping',
    remote: 'rec',
    summarizing: 'writing',
    remoteSummarizing: 'writing',
    ready: 'ready',
    done: 'done',
  }
  const led = mode === 'listening' ? 'pulse' : mode === 'starting' || mode === 'summarizing' || mode === 'remoteSummarizing' || mode === 'stopping' ? 'blink' : mode === 'paused' || mode === 'interrupted' || mode === 'remote' ? 'on' : mode === 'done' ? 'ok' : 'off'
  const showClock = mode !== 'blank' && mode !== 'remote' && mode !== 'remoteSummarizing'
  return (
    <div className="mtg__bar">
      <span className="mtg__mark" aria-hidden>
        <NotebookPen size={13} strokeWidth={1.75} />
      </span>
      <span className="label mtg__name">{t('features.meeting.label')}</span>
      <span className="mtg__rule" aria-hidden />
      <span className="mtg__readout" role="status" data-state={state[mode]}>
        <span className={`mtg__led is-${led}`} aria-hidden />
        <span className="label">{t(`features.meeting.state.${state[mode]}`)}</span>
        {showClock && <span className="mtg__clock mono">{clock(elapsed)}</span>}
      </span>
      {attrs.language && <span className="label mtg__lang">{attrs.language}</span>}
      {editable && (
        <button type="button" className="icon-btn icon-btn--sm mtg__more" aria-label={t('features.meeting.menu')} aria-haspopup="menu" aria-expanded={menuOpen} onMouseDown={(e) => e.preventDefault()} onClick={onMenu}>
          <MoreHorizontal size={15} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

function Meta({ attrs, words, lang }: { attrs: MeetingAttrs; words: number; lang: string }) {
  const t = useT()
  if (!attrs.startedAt && !words) return null
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  const parts: string[] = []
  if (attrs.startedAt) {
    const d = new Date(attrs.startedAt)
    parts.push(new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d))
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    parts.push(attrs.endedAt && attrs.endedAt > attrs.startedAt ? `${time.format(d)}–${time.format(new Date(attrs.endedAt))}` : time.format(d))
  }
  if (attrs.duration >= 60_000) parts.push(t('features.meeting.minutes', { n: Math.round(attrs.duration / 60_000) }))
  if (words) parts.push(wordsLabel(t, words, lang))
  return <div className="mtg__meta label">{parts.join(' · ')}</div>
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

interface TransportProps {
  mode: DeckMode
  supported: boolean
  elapsed: number
  recordedBy: string | null
  words: string
  onRecord: () => void
  onPause: () => void
  onStop: () => void
  onCancelStart: () => void
  onSummarize: () => void
  onCancelSummary: () => void
  onPaste: () => void
}

function Transport(p: TransportProps) {
  const t = useT()
  const { mode } = p
  if (mode === 'done') return null
  if (mode === 'summarizing' || mode === 'remoteSummarizing') {
    return (
      <div className="mtg__work" role="status">
        <span className="mtg__scan" aria-hidden />
        <span className="label">{mode === 'summarizing' ? t('features.meeting.writingWords', { words: p.words }) : t('features.meeting.writingRemote')}</span>
        {mode === 'summarizing' && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={p.onCancelSummary}>
            {t('features.meeting.cancel')}
          </button>
        )}
      </div>
    )
  }
  if (mode === 'remote') {
    return (
      <div className="mtg__transport">
        <p className="mtg__note">{p.recordedBy ? t('features.meeting.recordingBy', { name: p.recordedBy }) : t('features.meeting.recordingBySomeone')}</p>
        {p.supported && <Key variant="ghost" label={t('features.meeting.takeOver')} onClick={p.onRecord} testId="takeover" />}
      </div>
    )
  }
  if (mode === 'ready') {
    return (
      <div className="mtg__transport">
        <Key variant="rec" icon={<NotebookPen size={15} strokeWidth={1.9} aria-hidden />} label={t('features.meeting.summarize')} title={t('features.meeting.summarizeHint')} onClick={p.onSummarize} testId="summarize" />
        {p.supported && <Key variant="ghost" led="off" label={t('features.meeting.continue')} onClick={p.onRecord} testId="record" />}
      </div>
    )
  }
  if (mode === 'blank') {
    if (!p.supported) return null
    return (
      <div className="mtg__transport">
        <Key variant="rec" big led="off" label={t('features.meeting.record')} title={t('features.meeting.recordHint')} onClick={p.onRecord} testId="record" />
        <button type="button" className="btn btn--sm btn--ghost mtg__alt" onClick={p.onPaste}>
          <ClipboardPaste size={13} strokeWidth={1.75} aria-hidden /> {t('features.meeting.paste')}
        </button>
      </div>
    )
  }
  // starting · listening · paused · interrupted · stopping
  const recording = mode === 'listening' || mode === 'starting'
  const paused = mode === 'paused' || mode === 'interrupted'
  return (
    <>
      <div className="mtg__transport">
        <div className="mtg__keys">
          <Key
            variant="rec"
            latched={recording}
            led={mode === 'listening' ? 'pulse' : mode === 'starting' ? 'blink' : 'off'}
            label={paused ? t('features.meeting.resume') : t('features.meeting.record')}
            disabled={recording || mode === 'stopping' || !p.supported}
            onClick={p.onRecord}
            testId="record"
          />
          <Key
            variant="ghost"
            latched={paused}
            icon={<Pause size={14} strokeWidth={2} aria-hidden />}
            label={mode === 'starting' ? t('features.meeting.cancel') : t('features.meeting.pause')}
            disabled={mode === 'stopping' || paused}
            onClick={mode === 'starting' ? p.onCancelStart : p.onPause}
            testId="pause"
          />
          <Key variant="ink" icon={<Square size={12} strokeWidth={2.4} aria-hidden />} label={t('features.meeting.stop')} title={t('features.meeting.stopHint')} disabled={mode === 'stopping' || mode === 'starting'} onClick={p.onStop} testId="stop" />
        </div>
        <div className="mtg__counter" aria-hidden>
          <span className="label">{t('features.meeting.elapsed')}</span>
          <span className="mtg__digits mono">{clock(p.elapsed)}</span>
        </div>
      </div>
      {mode === 'starting' && <p className="mtg__note">{t('features.meeting.waitingMic')}</p>}
      {mode === 'stopping' && <p className="mtg__note">{t('features.meeting.finishing')}</p>}
      {mode === 'interrupted' && <p className="mtg__note">{t('features.meeting.interrupted')}</p>}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Claude errors                                                       */
/* ------------------------------------------------------------------ */

function AINotice({ error, onRetry, onDismiss }: { error: NonNullable<MeetingRuntime['aiError']>; onRetry: () => void; onDismiss: () => void }) {
  const t = useT()
  const keyIssue = error.code === 'no_key' || error.code === 'invalid_key' || error.code === 'permission'
  return (
    <Notice
      code={error.code}
      title={error.code === 'no_key' ? t('features.meeting.nokeyTitle') : t('features.meeting.aiFailed')}
      actions={
        <>
          {keyIssue ? (
            <button type="button" className="btn btn--sm btn--ink" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
              <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.meeting.openSettings')}
            </button>
          ) : (
            <button type="button" className="btn btn--sm btn--ink" onClick={onRetry}>
              {t('features.meeting.retry')}
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={onDismiss}>
            {t('features.meeting.dismiss')}
          </button>
        </>
      }
    >
      {error.code === 'no_key' ? t('features.meeting.nokey') : error.message}
    </Notice>
  )
}
