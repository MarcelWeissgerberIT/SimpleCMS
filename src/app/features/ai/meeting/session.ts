/**
 * Meeting runtime on this device: one recording / summary per meeting block (keyed by block id).
 * The block's attrs are the shared truth (status, transcript, times); this module owns what only
 * exists here — the recognizer, the interim phrase, the running clock, errors, the Claude request.
 *
 * Node views attach their editor while mounted. When a recording block disappears (the user left
 * the page) and no editor re-attaches shortly, the recording is paused and the user told so.
 */
import type { Editor } from '@tiptap/core'
import { create } from 'zustand'
import { docToMarkdown, type MeetingAttrs, type MeetingStatus } from '../../../editor'
import { useWorkspace } from '../../../store/store'
import { toast } from '../../../store/ui'
import { openPage } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { AIError, isAIConfigured, type AIErrorCode } from '../client'
import { Recognizer, type SpeechErrorCode } from './recognition'
import { requestMeetingSummary } from './summarize'
import { notesBlocks } from './notes'
import { editorPageId, patchMeeting, readMeeting, writeNotes, type MeetingTarget } from './write'

export type MeetingPhase = 'idle' | 'starting' | 'listening' | 'paused' | 'stopping' | 'summarizing'

export interface MeetingRuntime {
  phase: MeetingPhase
  /** the phrase being spoken right now */
  interim: string
  /** start of the current listening stretch (ms) */
  since: number | null
  /** recorded ms before `since` */
  base: number
  speechError: SpeechErrorCode | null
  aiError: { code: AIErrorCode; message: string } | null
}

const IDLE: MeetingRuntime = { phase: 'idle', interim: '', since: null, base: 0, speechError: null, aiError: null }

export const useMeetingRuntime = create<Record<string, MeetingRuntime>>(() => ({}))

export function runtimeOf(blockId: string): MeetingRuntime {
  return useMeetingRuntime.getState()[blockId] ?? IDLE
}

function setRuntime(blockId: string, patch: Partial<MeetingRuntime>) {
  useMeetingRuntime.setState((s) => ({ ...s, [blockId]: { ...(s[blockId] ?? IDLE), ...patch } }))
}

interface Live {
  target: MeetingTarget
  /** where a start that never got going returns to (cancelled, permission denied …) */
  before: MeetingPhase
  rec: Recognizer | null
  abort: AbortController | null
  detachTimer?: number
  onEnd?: () => void
}

const live = new Map<string, Live>()

function entry(blockId: string): Live {
  let l = live.get(blockId)
  if (!l) {
    l = { target: { blockId, pageId: null, editor: null }, before: 'idle', rec: null, abort: null }
    live.set(blockId, l)
  }
  return l
}

const recording = (p: MeetingPhase) => p === 'starting' || p === 'listening' || p === 'paused' || p === 'stopping'

/** Recorded time right now (ms). */
export function elapsedMs(rt: MeetingRuntime, now = Date.now()): number {
  return rt.base + (rt.since ? Math.max(0, now - rt.since) : 0)
}

function recorderName(): string | null {
  return useCloud.getState().user?.name?.trim() || useWorkspace.getState().settings.userName.trim() || null
}

/* ------------------------------------------------------------------ */
/* Attach / detach (node views)                                        */
/* ------------------------------------------------------------------ */

export function attachMeeting(blockId: string, editor: Editor): void {
  const l = entry(blockId)
  window.clearTimeout(l.detachTimer)
  l.target = { blockId, editor, pageId: editorPageId(editor) ?? l.target.pageId }
}

export function detachMeeting(blockId: string, editor: Editor): void {
  const l = live.get(blockId)
  if (!l || l.target.editor !== editor) return
  l.target = { ...l.target, editor: null }
  window.clearTimeout(l.detachTimer)
  l.detachTimer = window.setTimeout(() => {
    if (l.target.editor) return
    const phase = runtimeOf(blockId).phase
    if (phase !== 'starting' && phase !== 'listening') return
    const pageId = l.target.pageId
    if (!pauseRecording(blockId)) return dropRecording(blockId)
    toast({
      message: t('features.meeting.toast.leftPaused'),
      kind: 'info',
      action: pageId ? { label: t('features.meeting.toast.back'), run: () => openPage(pageId) } : undefined,
    })
  }, 1200)
}

/** Stop everything for a block that is gone (deleted while recording). */
function dropRecording(blockId: string) {
  const l = live.get(blockId)
  l?.rec?.abort()
  if (l) l.rec = null
  setRuntime(blockId, { ...IDLE })
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

function appendFinal(blockId: string, text: string) {
  const l = live.get(blockId)
  if (!l) return
  const at = elapsedMs(runtimeOf(blockId))
  const ok = patchMeeting(l.target, (a) => ({ transcript: [...a.transcript, { t: at, text }] }))
  if (!ok) dropRecording(blockId)
}

/**
 * Start (or resume) listening. The microphone permission is asked by the browser right here,
 * on the click; nothing is written to the block until the engine really listens.
 */
export function startRecording(blockId: string, opts: { language: string; resumeFrom?: number }): void {
  const l = entry(blockId)
  const rt = runtimeOf(blockId)
  if (rt.phase === 'starting' || rt.phase === 'listening' || rt.phase === 'stopping' || rt.phase === 'summarizing') return
  const base = rt.phase === 'paused' ? rt.base : (opts.resumeFrom ?? 0)
  l.before = rt.phase === 'paused' ? 'paused' : 'idle'
  l.onEnd = undefined
  setRuntime(blockId, { phase: 'starting', interim: '', since: null, base, speechError: null, aiError: null })
  const rec = new Recognizer(opts.language, {
    onStart: () => {
      const now = Date.now()
      setRuntime(blockId, { phase: 'listening', since: now })
      const ok = patchMeeting(l.target, (a) => ({
        status: 'recording',
        startedAt: a.startedAt ?? now,
        endedAt: null,
        language: opts.language,
        recordedBy: recorderName(),
      }))
      if (!ok) dropRecording(blockId)
    },
    onFinal: (text) => appendFinal(blockId, text),
    onInterim: (text) => {
      if (runtimeOf(blockId).interim !== text) setRuntime(blockId, { interim: text })
    },
    onEnd: (error) => {
      if (l.rec !== rec) return
      l.rec = null
      const cur = runtimeOf(blockId)
      const done = l.onEnd
      l.onEnd = undefined
      if (done) return done()
      if (!error) return
      // a fatal engine error: never started → back to where we were; while listening → paused
      if (cur.phase === 'starting') setRuntime(blockId, { phase: l.before, speechError: error, interim: '' })
      else {
        const ms = elapsedMs(cur)
        setRuntime(blockId, { phase: 'paused', since: null, base: ms, speechError: error, interim: '' })
        patchMeeting(l.target, { status: 'paused', duration: ms })
      }
    },
  })
  l.rec = rec
  rec.start()
}

/** Pause: the engine stops (phrases in flight still land). False when the block is gone. */
export function pauseRecording(blockId: string): boolean {
  const l = live.get(blockId)
  const rt = runtimeOf(blockId)
  if (!l || (rt.phase !== 'listening' && rt.phase !== 'starting')) return true
  const ms = elapsedMs(rt)
  setRuntime(blockId, { phase: rt.phase === 'starting' ? l.before : 'paused', since: null, base: ms, interim: '' })
  l.onEnd = () => undefined
  l.rec?.stop()
  if (rt.phase === 'starting') return true
  return patchMeeting(l.target, { status: 'paused', duration: ms, recordedBy: recorderName() })
}

/** Stop: wait for the last phrases, close the recording, then (optionally) summarise. */
export function stopRecording(blockId: string, opts: { summarize: boolean }): void {
  const l = entry(blockId)
  const rt = runtimeOf(blockId)
  if (rt.phase === 'stopping' || rt.phase === 'summarizing') return
  const ms = recording(rt.phase) ? elapsedMs(rt) : (readMeeting(l.target)?.attrs.duration ?? 0)
  const finish = () => {
    window.clearTimeout(timer)
    if (runtimeOf(blockId).phase !== 'stopping') return
    setRuntime(blockId, { phase: 'idle', since: null, base: ms, interim: '' })
    const ok = patchMeeting(l.target, { status: 'idle', endedAt: Date.now(), duration: ms, recordedBy: null })
    if (ok && opts.summarize) void summarizeMeeting(blockId)
  }
  setRuntime(blockId, { phase: 'stopping', since: null, base: ms, speechError: null })
  const timer = window.setTimeout(finish, 2500)
  if (l.rec) {
    l.onEnd = finish
    l.rec.stop()
  } else finish()
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export function clearMeetingError(blockId: string): void {
  setRuntime(blockId, { aiError: null, speechError: null })
}

export function cancelSummary(blockId: string): void {
  live.get(blockId)?.abort?.abort()
}

/** Notes area still empty (nothing or one empty paragraph)? */
function notesJsonBlank(notes: Array<{ type?: string; content?: unknown[] }>): boolean {
  return notes.length === 0 || (notes.length === 1 && notes[0].type === 'paragraph' && !notes[0].content?.length)
}

/** One Claude request → the notes, written into the block as one undo step. */
export async function summarizeMeeting(blockId: string): Promise<void> {
  const l = entry(blockId)
  if (runtimeOf(blockId).phase === 'summarizing') return
  const snap = readMeeting(l.target)
  if (!snap || !snap.attrs.transcript.length) return
  if (!isAIConfigured()) {
    setRuntime(blockId, { aiError: { code: 'no_key', message: new AIError('no_key').message } })
    return
  }
  const { attrs } = snap
  const prev: MeetingStatus = attrs.status === 'done' ? 'done' : 'idle'
  const blank = notesJsonBlank(snap.notes)
  const ws = useWorkspace.getState()
  const ac = new AbortController()
  l.abort = ac
  setRuntime(blockId, { phase: 'summarizing', aiError: null })
  patchMeeting(l.target, { status: 'summarizing' })
  try {
    const summary = await requestMeetingSummary(
      {
        transcript: attrs.transcript,
        language: attrs.language,
        title: attrs.title,
        startedAt: attrs.startedAt,
        people: ws.people.map((p) => p.name),
        notes: prev !== 'done' && !blank ? docToMarkdown({ type: 'doc', content: snap.notes }) : '',
      },
      ac.signal,
    )
    // the status goes back first, so undoing the notes returns to "ready to summarise"
    patchMeeting(l.target, { status: prev })
    const now = useWorkspace.getState()
    const patch: Partial<MeetingAttrs> = { status: 'done' }
    const fresh = readMeeting(l.target)?.attrs ?? attrs
    if (!fresh.title.trim() && summary.title) patch.title = summary.title
    if (!fresh.endedAt) patch.endedAt = Date.now()
    writeNotes(l.target, notesBlocks(summary, now.people, now.settings.language), patch, prev === 'done' || blank ? 'replace' : 'prepend')
  } catch (e) {
    patchMeeting(l.target, (a) => (a.status === 'summarizing' ? { status: prev } : null))
    const err = e instanceof AIError ? e : new AIError('unknown', e instanceof Error ? e.message : String(e))
    if (err.code !== 'aborted') setRuntime(blockId, { aiError: { code: err.code, message: err.message } })
  } finally {
    if (l.abort === ac) l.abort = null
    if (runtimeOf(blockId).phase === 'summarizing') setRuntime(blockId, { phase: 'idle' })
  }
}

/** For tests / debugging: is a block recording on this device? */
export function isRecordingHere(blockId: string): boolean {
  return recording(runtimeOf(blockId).phase)
}
