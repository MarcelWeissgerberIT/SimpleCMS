/**
 * The generate half of the AI panel (AIMenu.tsx): the setup card (`/generate image` · `/generate video` · an empty
 * image block's "Generate…") — server, prompt, aspect ratio, count, "use this page as context", the credits note —
 * and, for a generation run, its body (the results as cards to pick) and keys (Insert selected, Try again, Change
 * prompt, Discard). Picked results are saved like any media card (save.ts) and inserted at the target in one step.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ArrowDownToLine, CircleAlert, PenLine, RotateCcw, Settings2, Trash2, type LucideIcon } from 'lucide-react'
import { Kbd } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { readServers } from '../mcp-servers/config'
import { MarkdownLite } from '../MarkdownLite'
import type { AIRun, RunRequest } from '../runs'
import { MediaCards } from './MediaCards'
import { saveCards } from './actions'
import { mediaNode, pagePrivate } from './blocks'
import { useMediaCards, setPicked } from './state'
import { ASPECTS, MAX_COUNT, PROMPT_MAX, generateRequest, generateServers, rememberServer, rememberedServer, type GenerateKind, type GenerateRunRequest } from './generate'
import type { SavedMedia } from './types'
import './generate.css'

/** What the card holds (kept when it comes back for "Change prompt"). */
export interface GenerateDraft {
  kind: GenerateKind
  prompt: string
  aspect: string
  count: number
  context: boolean
  serverId: string | null
}

export const draftOf = (kind: GenerateKind, from?: GenerateRunRequest | null): GenerateDraft =>
  from ? { kind: from.media, prompt: from.prompt, aspect: from.aspect, count: from.count, context: from.context, serverId: from.serverId } : { kind, prompt: '', aspect: '', count: kind === 'image' ? 2 : 1, context: false, serverId: null }

export interface GenerateSetupProps {
  draft: GenerateDraft
  onDraft: (d: GenerateDraft) => void
  onRun: (req: RunRequest) => void
  onCancel: () => void
  /** no key yet: the panel's key card */
  hasKey: boolean
}

export function GenerateSetup({ draft, onDraft, onRun, onCancel, hasKey }: GenerateSetupProps) {
  const t = useT()
  const uid = useId()
  const raw = useWorkspace((s) => s.settings.mcpServers)
  const servers = useMemo(() => generateServers(draft.kind, readServers({ mcpServers: raw })), [draft.kind, raw])
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const set = (patch: Partial<GenerateDraft>) => onDraft({ ...draft, ...patch })
  // the remembered server for this kind (else the first that fits)
  const chosen = servers.find((x) => x.server.id === (draft.serverId ?? rememberedServer(draft.kind))) ?? servers[0] ?? null

  useEffect(() => {
    const id = requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [draft.kind])

  const run = () => {
    if (!chosen || !draft.prompt.trim()) return
    rememberServer(draft.kind, chosen.server.id)
    onRun(generateRequest({ media: draft.kind, prompt: draft.prompt, serverId: chosen.server.id, server: chosen.server.name, aspect: draft.aspect, count: draft.count, context: draft.context }))
  }

  const openSettings = () => {
    onCancel()
    useUI.getState().openModal({ type: 'settings', tab: 'ai' })
  }

  return (
    <div className="gen-card" role="group" aria-label={t(`features.ai.gen.label.${draft.kind}`)} data-testid="gen-setup">
      <div className="gen-card__head">
        <span className="label gen-card__code">§ GEN — {t(`features.ai.gen.kind.${draft.kind}`).toUpperCase()}</span>
        <div className="gen-seg" role="radiogroup" aria-label={t('features.ai.gen.kindLabel')}>
          {(['image', 'video'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={draft.kind === k} className="gen-seg__opt" onClick={() => set({ kind: k, serverId: null, count: draft.kind === k ? draft.count : k === 'image' ? 2 : 1 })}>
              {t(`features.ai.gen.kind.${k}`)}
            </button>
          ))}
        </div>
      </div>

      {!servers.length ? (
        <div className="gen-card__empty" role="note" data-testid="gen-noserver">
          <p>{t(`features.ai.gen.noServer.${draft.kind}`)}</p>
          <button type="button" className="btn btn--sm" onClick={openSettings}>
            <Settings2 size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.openSettings')}
          </button>
        </div>
      ) : (
        <form
          className="gen-card__form"
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
        >
          <div className="gen-field">
            <label className="gen-field__label label" htmlFor={`${uid}-server`}>
              {t('features.ai.gen.server')}
            </label>
            <select id={`${uid}-server`} className="input gen-select" value={chosen?.server.id ?? ''} onChange={(e) => set({ serverId: e.target.value })} data-testid="gen-server">
              {servers.map((x) => (
                <option key={x.server.id} value={x.server.id}>
                  {x.server.name.toUpperCase()}
                  {x.known ? ` · ${t(`features.ai.gen.tools.${x.tools.length === 1 ? 'one' : 'other'}`, { count: x.tools.length })}` : ` · ${t('features.ai.gen.unchecked')}`}
                </option>
              ))}
            </select>
          </div>
          <div className="gen-field gen-field--wide">
            <label className="gen-field__label label" htmlFor={`${uid}-prompt`}>
              {t('features.ai.gen.prompt')}
            </label>
            <textarea
              id={`${uid}-prompt`}
              ref={promptRef}
              className="input gen-prompt"
              rows={3}
              value={draft.prompt}
              maxLength={PROMPT_MAX}
              placeholder={t(`features.ai.gen.promptPh.${draft.kind}`)}
              onChange={(e) => set({ prompt: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  run()
                }
              }}
              data-testid="gen-prompt"
            />
          </div>
          <div className="gen-field">
            <span className="gen-field__label label" id={`${uid}-aspect`}>
              {t('features.ai.gen.aspect')}
            </span>
            <div className="gen-seg gen-seg--wrap" role="radiogroup" aria-labelledby={`${uid}-aspect`}>
              {['', ...ASPECTS].map((a) => (
                <button key={a || 'auto'} type="button" role="radio" aria-checked={draft.aspect === a} className="gen-seg__opt" onClick={() => set({ aspect: a })}>
                  {a || t('features.ai.gen.auto')}
                </button>
              ))}
            </div>
          </div>
          <div className="gen-field">
            <span className="gen-field__label label" id={`${uid}-count`}>
              {t('features.ai.gen.count')}
            </span>
            <div className="gen-seg" role="radiogroup" aria-labelledby={`${uid}-count`}>
              {Array.from({ length: MAX_COUNT }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={draft.count === n} className="gen-seg__opt gen-seg__opt--num" onClick={() => set({ count: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label className="gen-check gen-field--wide">
            <input type="checkbox" checked={draft.context} onChange={(e) => set({ context: e.target.checked })} data-testid="gen-context" />
            <span>{t('features.ai.gen.context')}</span>
          </label>
          <p className="gen-cost gen-field--wide" role="note">
            <CircleAlert size={13} strokeWidth={1.75} aria-hidden />
            <span>{t('features.ai.gen.cost', { server: chosen ? chosen.server.name.toUpperCase() : '' })}</span>
          </p>
          <div className="gen-card__keys gen-field--wide">
            <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--sm btn--primary" disabled={!draft.prompt.trim() || !chosen || !hasKey} data-testid="gen-run">
              {t('features.ai.gen.run')} <Kbd>↵</Kbd>
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/** A row of the panel's list (the shape AIMenu renders). */
export interface GenerateRow {
  id: string
  label: ReactNode
  code?: string
  icon?: LucideIcon
  run: () => void
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
}

export interface GeneratePanelOptions {
  pageId: string
  /** the panel's run when it is a generation */
  run: AIRun | null
  phase: 'idle' | 'streaming' | 'done' | 'error'
  start: (req: RunRequest) => void
  /** the saved results go into the page at the target (one undo step) */
  insert: (nodes: JSONContent[]) => Promise<void>
  /** every result is in the page: the run is done with, the panel closes */
  finish: () => void
  /** the setup card again, with this run's values */
  edit: (req: GenerateRunRequest) => void
  discard: () => void
}

export interface GeneratePanel {
  body: ReactNode
  rows: GenerateRow[] | null
}

/** The generation part of the panel for its run (nothing for other runs). */
export function useGeneratePanel({ pageId, run, phase, start, insert, finish, edit, discard }: GeneratePanelOptions): GeneratePanel {
  const t = useT()
  const picked = useMediaCards((s) => s.picked)
  const cards = useMediaCards((s) => s.cards)
  const req = run?.req.kind === 'generate' ? run.req : null
  const media = useMemo(() => (req ? (run?.media ?? []) : []), [req, run?.media])
  const priv = pagePrivate(pageId)

  // one result: picked already
  const single = media.length === 1 ? media[0].id : null
  useEffect(() => {
    if (single && phase === 'done' && useMediaCards.getState().picked[single] === undefined) setPicked(single, true)
  }, [single, phase])

  if (!req || !run) return { body: null, rows: null }

  const onSaved = async (saved: SavedMedia[]) => {
    await insert(saved.map(mediaNode))
    // all results are in the page now: nothing left to pick
    const cardsNow = useMediaCards.getState().cards
    if (phase === 'done' && media.every((m) => cardsNow[m.id]?.state === 'saved')) finish()
  }
  const chosen = media.filter((x) => picked[x.id] && cards[x.id]?.state !== 'saved')
  const insertPicked = async () => {
    const saved = await saveCards(chosen, { privateTarget: priv, all: media })
    for (const s of saved) setPicked(s.itemId, false)
    if (saved.length) await onSaved(saved)
  }

  const waiting = phase === 'streaming'
  const body = (
    <div className="ai-out__body gen-out" data-testid="gen-out">
      {waiting && (
        <div className="ai-wait label">
          {media.length ? t(`features.ai.gen.found.${media.length === 1 ? 'one' : 'other'}`, { count: media.length, server: req.server.toUpperCase() }) : t('features.ai.gen.working', { server: req.server.toUpperCase() })}
          <span className="ai-wait__dots" aria-hidden />
        </div>
      )}
      <p className="gen-out__prompt" title={req.prompt}>
        “{req.prompt}”{req.aspect ? <span className="label"> · {req.aspect}</span> : null}
      </p>
      {media.length > 0 && <MediaCards items={media} pick onSaved={onSaved} privateTarget={priv} where={t('features.ai.gen.where')} />}
      {phase === 'done' && !media.length && (
        <div className="gen-out__none" role="note" data-testid="gen-none">
          <p>{t('features.ai.gen.none')}</p>
          {run.output.trim() && <MarkdownLite source={run.output} />}
        </div>
      )}
    </div>
  )

  if (phase !== 'done' && phase !== 'error') return { body, rows: null }
  const rows: GenerateRow[] = []
  if (phase === 'done' && media.length)
    rows.push({
      id: 'gen-insert',
      label: t('features.ai.gen.insert', { count: chosen.length }),
      code: String(chosen.length),
      icon: ArrowDownToLine,
      run: () => void insertPicked(),
      hint: <Kbd>↵</Kbd>,
      disabled: !chosen.length,
    })
  rows.push({ id: 'gen-again', label: t('features.ai.gen.again'), icon: RotateCcw, run: () => start(req) })
  rows.push({ id: 'gen-edit', label: t('features.ai.gen.edit'), icon: PenLine, run: () => edit(req) })
  rows.push({ id: 'discard', label: t('features.ai.res.discard'), icon: Trash2, run: discard, hint: <Kbd>esc</Kbd>, danger: true })
  return { body, rows }
}
