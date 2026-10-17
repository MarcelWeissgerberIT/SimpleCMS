/**
 * The work orders' settings (spec §1.1 "Prüfaufträge-Einstellungen", `resizable="orders"`): a popover from the plate's ⚙
 * and from Settings › Coding worker § Work orders. Everything is written with saveOrderConfig (the only writer of
 * `Database.orders`; refused on a locked database, for a viewer and over a config a later build wrote).
 *  - Kontext · MCP-Server (optional): "Ohne Server" (the default) or one of this device's enabled servers, by the names
 *    the person gave them — none preselected. Each says whether it was tested here, the tools the planner may call
 *    ("liest") and the ones left out with their reason ("nicht dabei"), with a key to the matching integration profile;
 *    one never tested offers "Server testen". One names no service — only the person's own server names.
 *  - Pipelines (BA · Coding · QA), Projekte per kind ("wie #/coding" or one pinned project) — "Felder der Zeile gehen vor".
 *  - Nach der Analyse anhalten (glass rocker, on), Budget je Kette (the UI's number format).
 * "Ohne Bestätigung starten" is not here yet (B11: per device, local only, budget required).
 */
import { useId, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { Popover } from '../../../ui/Popover'
import { Switch } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { fmtAmount, parseAmount } from '../../../lib/money'
import { useCloud } from '../../../cloud'
import { HelpLink } from '../../../help'
import { pipelineDbIdsOf } from '../schema'
import { ORDER_KINDS, readOrderConfig } from './config'
import { saveOrderConfig } from './db'
import { serverRows } from './serverTools'
import type { OrderConfig, OrderKind } from './types'

const O = 'features.coding.order'
const P = 'features.coding.order.planner'

export function OrderSettingsPanel({ dbId }: { dbId: ID }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const db = useWorkspace((s) => s.databases[dbId])
  // the server list follows this device's settings (a test elsewhere, a server switched off)
  useWorkspace((s) => s.settings.mcpServers)
  useWorkspace((s) => s.integrations)
  const viewer = useCloud((s) => s.readOnly)
  const read = readOrderConfig(db)
  const config = read.kind === 'ok' ? read.config : null
  const locked = !!db?.locked
  const disabled = viewer || locked || !config
  const [budget, setBudget] = useState(config?.budgetUsd !== undefined ? fmtAmount(config.budgetUsd, lang) : '')
  const [bad, setBad] = useState(false)
  const save = (fn: (c: OrderConfig) => OrderConfig) => {
    if (!disabled) saveOrderConfig(dbId, fn)
  }
  const rows = serverRows()
  const picked = config?.server?.name ?? null
  // a picked server no longer here: still named (switched off / gone), never silently dropped
  const missing = picked && !rows.some((r) => r.name === picked) ? picked : null
  const commitBudget = (text: string) => {
    const v = text.trim()
    if (!v) {
      setBad(false)
      return save((c) => {
        const { budgetUsd: _b, ...rest } = c
        return rest
      })
    }
    const usd = parseAmount(v, lang)
    if (usd === null || !(usd > 0)) return setBad(true)
    setBad(false)
    save((c) => ({ ...c, budgetUsd: usd }))
  }
  return (
    <div className="ors" data-testid="order-settings">
      <p className="label ors__title">
        § {t(`${O}.settings.title`)}
        <HelpLink id="coding-pipeline" />
      </p>
      {(viewer || locked || read.kind === 'unreadable') && (
        <p className="orc-line orc-line--warn" data-testid="order-settings-why">
          {viewer ? t('features.coding.setup.readOnly') : locked ? t(`${O}.settings.locked`) : t(`${P}.why.config`)}
        </p>
      )}
      <fieldset className="ors__group" disabled={disabled}>
        <legend className="label">{t(`${O}.settings.server`)}</legend>
        <label className="ors__radio">
          <input type="radio" name={`${uid}-server`} checked={!picked} onChange={() => save((c) => ({ ...c, server: null }))} data-testid="order-server-none" />
          <span>{t(`${O}.settings.noServer`)}</span>
        </label>
        {rows.map((r) => (
          <label key={r.id} className="ors__radio" data-testid="order-server-row">
            <input type="radio" name={`${uid}-server`} checked={picked === r.name} onChange={() => save((c) => ({ ...c, server: { name: r.name } }))} data-testid={`order-server-${r.name}`} />
            <span className="ors__server">
              <span className="ors__name">
                <strong>{r.name}</strong> <span className="label">{t(r.tested ? `${O}.settings.tested` : `${O}.settings.untested`)}</span>
              </span>
              {r.tested ? (
                <>
                  <span className="ors__tools">{t(`${O}.settings.reads`, { list: r.reads.join(', ') || '—' })}</span>
                  {r.left.length > 0 && <span className="ors__tools ors__tools--left">{t(`${O}.settings.left`, { list: r.left.map((l) => `${l.tool} (${t(`${P}.left.${l.why}`)})`).join(', ') })}</span>}
                </>
              ) : (
                <span className="ors__tools ors__tools--left">{t(`${O}.settings.left`, { list: t(`${P}.left.untested`) })}</span>
              )}
              <span className="ors__links">
                {!r.tested && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void import('../../mcp').then((m) => m.openMcpConnections({ server: r.id, focus: 'test' }))}>
                    {t(`${O}.plan.testServer`)}
                  </button>
                )}
                {r.profile && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate({ name: 'workspace', section: 'integrations' })}>
                    {t(`${O}.settings.profile`)}
                  </button>
                )}
              </span>
            </span>
          </label>
        ))}
        {missing && <p className="orc-line orc-line--warn">{t(`${P}.skip.missing`, { server: missing })}</p>}
        <p className="orc-line orc-line--quiet">{t(`${O}.settings.serverHint`)}</p>
      </fieldset>
      <fieldset className="ors__group" disabled={disabled}>
        <legend className="label">{t('features.coding.pipe.label')}</legend>
        <div className="ors__kinds">
          {ORDER_KINDS.map((k: OrderKind) => {
            const on = !!config?.kinds.includes(k)
            return (
              <label key={k} className="ors__check">
                <input
                  type="checkbox"
                  checked={on}
                  // at least one kind stays
                  disabled={on && config?.kinds.length === 1}
                  onChange={() => save((c) => ({ ...c, kinds: on ? c.kinds.filter((x) => x !== k) : ORDER_KINDS.filter((x) => x === k || c.kinds.includes(x)) }))}
                  data-testid={`order-kind-${k}`}
                />
                {t(`features.coding.pipe.${k}`)}
              </label>
            )
          })}
        </div>
      </fieldset>
      <fieldset className="ors__group" disabled={disabled}>
        <legend className="label">{t(`${O}.settings.projects`)}</legend>
        {ORDER_KINDS.map((k: OrderKind) => {
          const ids = pipelineDbIdsOf(k)
          const pinned = config?.projects?.[k] ?? ''
          return (
            <label key={k} className="ors__project">
              <span>{t(`features.coding.pipe.${k}`)}</span>
              <select
                className="input"
                value={pinned}
                onChange={(e) =>
                  save((c) => {
                    const projects = { ...(c.projects ?? {}) }
                    if (e.target.value) projects[k] = e.target.value
                    else delete projects[k]
                    return { ...c, projects }
                  })
                }
              >
                <option value="">{t(`${O}.settings.projectLike`)}</option>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {useWorkspace.getState().pages[id]?.title.trim() || t('common.untitled')}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
        <p className="orc-line orc-line--quiet">{t(`${O}.settings.rowWins`)}</p>
      </fieldset>
      <div className="ors__switch">
        <span id={`${uid}-cp`}>{t(`${O}.settings.checkpoint`)}</span>
        <Switch size="sm" checked={config?.checkpoint ?? true} disabled={disabled} seed={`${dbId}-checkpoint`} label={t(`${O}.settings.checkpoint`)} describedBy={`${uid}-cph`} onChange={(v) => save((c) => ({ ...c, checkpoint: v }))} />
      </div>
      <p className="orc-line orc-line--quiet" id={`${uid}-cph`}>
        {t(`${O}.settings.checkpointHint`)}
      </p>
      <label className="ors__budget">
        <span>{t(`${O}.budget.label`)}</span>
        <span className="orc-budget__field">
          <input
            className="input orc-budget__input"
            inputMode="decimal"
            value={budget}
            disabled={disabled}
            placeholder={t(`${O}.budget.none`)}
            aria-invalid={bad || undefined}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={(e) => commitBudget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitBudget((e.target as HTMLInputElement).value)
              }
            }}
            data-testid="order-settings-budget"
          />
          <span className="label" aria-hidden>
            $
          </span>
        </span>
      </label>
      <p className="orc-line orc-line--quiet">{bad ? t(`${O}.budget.bad`) : t(`${O}.settings.budgetHint`)}</p>
    </div>
  )
}

/** ⚙ — opens the work orders' settings beside it (the plate's keys row, Settings › Coding worker). */
export function OrderSettingsKey({ rowId, dbId, label }: { rowId?: ID; dbId?: ID; label?: boolean }) {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const target = useWorkspace((s) => dbId ?? (rowId ? s.pages[rowId]?.databaseId : undefined) ?? null)
  if (!target) return null
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="btn btn--sm btn--ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? undefined : t(`${O}.settings.key`)}
        title={label ? undefined : t(`${O}.settings.key`)}
        onClick={() => setOpen((v) => !v)}
        data-testid="order-settings-key"
      >
        <Settings2 size={14} strokeWidth={1.75} aria-hidden />
        {label && t(`${O}.settings.key`)}
      </button>
      {open && (
        <Popover
          open
          anchor={ref.current}
          onClose={() => {
            setOpen(false)
            ref.current?.focus()
          }}
          placement="top-start"
          className="ors-pop"
          resizable="orders"
          role="dialog"
          aria-label={t(`${O}.settings.title`)}
        >
          <OrderSettingsPanel dbId={target} />
        </Popover>
      )}
    </>
  )
}
