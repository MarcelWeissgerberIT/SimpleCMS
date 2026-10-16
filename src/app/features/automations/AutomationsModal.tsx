/**
 * Automations for one database: channel list with status LEDs, editor (signal chain),
 * ready-made recipes, JSON payload reference and the live run log.
 *
 * Read through readAutomations (sanitized — an automation this build cannot read is neither shown nor run, and kept as
 * it is), written ONLY through saveAutomations as the person (`you~ui`; the delete toast's Undo `you~undo`). A locked
 * database shows the lock and offers only switching automations off and removing them (plan §1.14). Each automation on
 * an open fuse path carries the Patchbay's hint line ("On fuse F1 — show in the Patchbay", §1.20).
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, ClipboardCopy, Lock, Plus, Workflow, Zap } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useDatabase, usePage } from '../../store/selectors'
import { useWorkspace } from '../../store/store'
import { toast } from '../../store/ui'
import { resolveAssetUrl } from '../../lib/files'
import { newId } from '../../lib/ids'
import type { Automation, ID } from '../../store/types'
import { isDatabaseApiLoaded, loadDatabaseApi, samplePayload, useRunLog } from './engine'
import { blankAutomation, makeRecipe, problemOf, recipeHint, type RecipeId } from './recipes'
import { onRovingKey } from '../io/roving'
import { AutomationEditor } from './AutomationEditor'
import { readAutomations, unreadableCounts } from './read'
import { saveAutomations } from './model'
import { n8nWorkflow } from './n8n'
import { HelpLink } from '../../help'
import './automations.css'

const RECIPES: RecipeId[] = ['webhook_new', 'notify_done', 'stamp_done']

function useAgo() {
  const lang = useLang()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }), [lang])
  return (ms: number) => {
    const s = Math.round((ms - Date.now()) / 1000)
    if (Math.abs(s) < 60) return rtf.format(s, 'second')
    if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute')
    if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour')
    return rtf.format(Math.round(s / 86400), 'day')
  }
}

export function AutomationsModal({ databaseId, onClose }: { databaseId: ID; onClose: () => void }) {
  const t = useT()
  const db = useDatabase(databaseId)
  const page = usePage(databaseId)
  const list = useMemo(() => readAutomations(db?.automations), [db])
  const unread = useMemo(() => unreadableCounts(db?.automations), [db])
  const locked = !!db?.locked
  const [selected, setSelected] = useState<ID | null>(() => list[0]?.id ?? null)
  const ago = useAgo()
  const log = useRunLog().filter((e) => e.databaseId === databaseId)
  const current = list.find((a) => a.id === selected) ?? null

  useEffect(() => {
    if (selected && !list.some((a) => a.id === selected)) setSelected(list[0]?.id ?? null)
  }, [list, selected])

  if (!db || !page) {
    return (
      <Modal open onClose={onClose} label="§ AUTO" title={t('features.auto.title')}>
        <p className="muted">{t('features.auto.missing')}</p>
      </Modal>
    )
  }

  /** the stored list now (sanitized) — every write starts from it, not from the render's copy */
  const stored = () => readAutomations(useWorkspace.getState().databases[databaseId]?.automations)
  // the one writer, as the person; a locked database takes only switching off and removing (refused otherwise: said)
  const save = (next: Automation[]) => {
    const ok = saveAutomations(databaseId, next, { kind: 'you', via: 'ui' })
    if (!ok) toast({ message: t('features.auto.lockedRefused'), kind: 'error' })
    return ok
  }
  const update = (a: Automation) => save(stored().map((x) => (x.id === a.id ? a : x)))
  const add = (a: Automation | null) => {
    if (!a || locked) return
    if (save([...stored(), a])) setSelected(a.id)
  }
  const remove = (id: ID) => {
    const all = stored()
    const index = all.findIndex((x) => x.id === id)
    const removed = all[index]
    if (!removed || !save(all.filter((x) => x.id !== id))) return
    // deleting loses a webhook URL etc. → offer undo instead of a confirm dialog
    toast({
      message: t('features.auto.deleted', { name: removed.name.trim() || t('features.auto.untitled') }),
      action: {
        label: t('features.auto.undo'),
        undo: true,
        run: () => {
          const now = stored()
          if (now.some((x) => x.id === removed.id)) return
          const next = [...now]
          next.splice(Math.min(index, next.length), 0, removed)
          // putting it back adds an automation: a database locked meanwhile refuses that (§1.14)
          if (!saveAutomations(databaseId, next, { kind: 'you', via: 'undo' })) {
            toast({ message: t('features.auto.lockedUndo', { name: removed.name.trim() || t('features.auto.untitled') }), kind: 'error' })
            return
          }
          setSelected(removed.id)
        },
      },
    })
  }
  const duplicate = (a: Automation) => add({ ...JSON.parse(JSON.stringify(a)), id: newId(), name: `${a.name} (2)`, enabled: false, lastRunAt: null, lastStatus: null, lastMessage: null })

  const dbTitle = page.title.trim() || t('common.untitled')

  return (
    <Modal
      open
      onClose={onClose}
      label="§ AUTO"
      title={
        <>
          {t('features.auto.titleFor', { db: dbTitle })}
          <HelpLink id="automations" />
        </>
      }
      width={1040}
      className="auto-modal"
    >
      <div className="auto">
        {/* ------------ rail ------------ */}
        <aside className="auto-rail">
          <div className="auto-rail__head">
            <span className="label">{t('features.auto.channels')}</span>
            <span className="label auto-rail__count">{String(list.length).padStart(2, '0')}</span>
            <button type="button" className="btn btn--sm" disabled={locked} onClick={() => add(blankAutomation(db))}>
              <Plus size={13} /> {t('common.new')}
            </button>
          </div>
          {unread.newer > 0 && <p className="auto-newer faint">{t(unread.newer === 1 ? 'features.auto.newer.one' : 'features.auto.newer', { n: unread.newer })}</p>}
          {unread.limits > 0 && (
            <p className="auto-newer faint" data-testid="auto-over-limits">
              {t(unread.limits === 1 ? 'features.auto.overLimits.one' : 'features.auto.overLimits', { n: unread.limits })}
            </p>
          )}
          {list.length === 0 && (
            <div className="auto-empty">
              <img src={resolveAssetUrl('assets/icons/automation.webp')} alt="" width={72} height={72} draggable={false} />
              <p>{t('features.auto.empty')}</p>
            </div>
          )}
          <ul className="auto-list" role="listbox" aria-label={t('features.auto.channels')} onKeyDown={(e) => onRovingKey(e)}>
            {list.map((a, i) => {
              const problem = problemOf(a, db)
              const state = !a.enabled ? 'off' : a.lastStatus === 'error' ? 'on' : 'ok'
              return (
                <li key={a.id}>
                  <button type="button" role="option" aria-selected={a.id === selected} tabIndex={a.id === selected || (!current && i === 0) ? 0 : -1} className="auto-item" onClick={() => setSelected(a.id)}>
                    <span className="auto-item__n mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="auto-item__main">
                      <span className="auto-item__name">{a.name.trim() || t('features.auto.untitled')}</span>
                      <span className="auto-item__meta mono">
                        {!a.enabled
                          ? problem
                            ? t('features.auto.status.setup')
                            : t('features.auto.status.off')
                          : a.lastRunAt
                            ? `${a.lastStatus === 'error' ? 'ERR' : 'OK'} · ${ago(a.lastRunAt)}`
                            : t('features.auto.status.armed')}
                      </span>
                    </span>
                    <Led state={state} title={t(`features.auto.led.${state}`)} />
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="auto-rail__head auto-rail__head--recipes">
            <span className="label">{t('features.auto.recipes')}</span>
          </div>
          <ul className="auto-recipes">
            {RECIPES.map((r) => {
              const hint = recipeHint(db, r)
              return (
                <li key={r}>
                  <button type="button" className="auto-recipe" disabled={!!hint || locked} onClick={() => add(makeRecipe(databaseId, r))} title={hint ?? undefined}>
                    <Zap size={13} />
                    <span className="auto-recipe__text">
                      <span className="auto-recipe__name">{t(`features.auto.recipe.${r}`)}</span>
                      <span className="auto-recipe__desc faint">{hint ?? t(`features.auto.recipe.${r}Desc`)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        {/* ------------ main ------------ */}
        <section className="auto-main">
          {locked && (
            <p className="auto-lock" role="note">
              <Lock size={13} aria-hidden /> <span className="label">{t('features.auto.lockedLabel')}</span> {t('features.auto.locked')}
            </p>
          )}
          {current ? (
            <AutomationEditor key={current.id} db={db} automation={current} locked={locked} onChange={update} onDelete={() => remove(current.id)} onDuplicate={() => duplicate(current)} onOpenPatchbay={onClose} />
          ) : (
            <div className="auto-intro">
              <div className="label">{t('features.auto.introLabel')}</div>
              <h3 className="display auto-intro__title">{t('features.auto.introTitle')}</h3>
              <p className="muted">{t('features.auto.introBody')}</p>
            </div>
          )}
          <PayloadPanel databaseId={databaseId} automation={current} />
          <section className="auto-log" aria-live="polite">
            <div className="auto-section-label label">
              <b>{t('features.auto.log')}</b>
              <span>{t('features.auto.logHint')}</span>
            </div>
            {log.length === 0 ? (
              <p className="auto-log__empty faint mono">{t('features.auto.logEmpty')}</p>
            ) : (
              <ol className="auto-log__list">
                {log.map((e) => (
                  <li key={e.id} className="auto-log__row" data-status={e.status}>
                    <span className="mono auto-log__time">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</span>
                    <Led state={e.status === 'ok' ? 'ok' : 'on'} />
                    <span className="auto-log__ev mono">{t(`features.auto.ev.${e.event}`)}</span>
                    <span className="auto-log__what">
                      <b>{e.automationName}</b> · {e.rowTitle || t('common.untitled')}
                    </span>
                    <span className="auto-log__msg mono">{e.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </section>
      </div>
    </Modal>
  )
}

/** The JSON body webhooks receive — highlighted, copyable. */
function PayloadPanel({ databaseId, automation }: { databaseId: ID; automation: Automation | null }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [apiReady, setApiReady] = useState(isDatabaseApiLoaded)
  useEffect(() => {
    if (!apiReady) void loadDatabaseApi().then(() => setApiReady(true))
  }, [apiReady])
  const method = automation?.actions.find((a) => a.type === 'webhook')?.method ?? 'POST'
  // re-read when the db / rows change so the example stays real
  const pages = useWorkspace((s) => s.pages)
  const json = useMemo(() => {
    try {
      const sample = samplePayload(databaseId, automation ?? { id: 'automation_id', name: t('features.auto.untitled'), trigger: { type: 'property_changed', propertyId: null } })
      return JSON.stringify(sample, null, 2)
    } catch {
      return '{}'
    }
  }, [databaseId, automation, pages, t, apiReady])
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(id)
  }, [copied])
  return (
    <section className="auto-payload">
      <div className="auto-section-label label">
        <b>{t('features.auto.payload')}</b>
        <span>{method} · application/json</span>
        <span className="auto-payload__keys">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            data-copy-n8n=""
            title={t('features.auto.copyN8nHint')}
            onClick={() => {
              const text = JSON.stringify(n8nWorkflow(databaseId), null, 2)
              void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(
                () => toast({ message: t('features.auto.n8nCopied'), kind: 'success', timeout: 7000 }),
                () => toast({ message: t('features.auto.copyFailed'), kind: 'error' }),
              )
            }}
          >
            <Workflow size={13} /> {t('features.auto.copyN8n')}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(json).then(() => setCopied(true))
            }}
          >
            {copied ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied ? t('common.copied') : t('features.auto.copyJson')}
          </button>
        </span>
      </div>
      <pre className="auto-code" tabIndex={0} aria-label={t('features.auto.payload')}>
        <code>{highlight(json)}</code>
      </pre>
      <p className="auto-hint faint">{t('features.auto.payloadHint')}</p>
    </section>
  )
}

function highlight(json: string) {
  const out: React.ReactNode[] = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(json))) {
    if (m.index > last) out.push(json.slice(last, m.index))
    if (m[1]) {
      out.push(
        <span key={i++} className={m[2] ? 'j-key' : 'j-str'}>
          {m[1]}
        </span>,
      )
      if (m[2]) out.push(m[2])
    } else if (m[3]) out.push(<span key={i++} className="j-lit">{m[3]}</span>)
    else if (m[4]) out.push(<span key={i++} className="j-num">{m[4]}</span>)
    last = re.lastIndex
  }
  out.push(json.slice(last))
  return out
}
