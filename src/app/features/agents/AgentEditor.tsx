/**
 * Custom agents — the editor (a dialog): job (name, icon, instructions + "Improve with Claude"),
 * trigger, access (scope, write mode, MCP servers), report page, engine (runner, model, effort,
 * budget) and the on/off switch. Works on a draft; "Save" validates and writes it with upsertAgent.
 * Team workspaces: it says whose browser runs it — saved by another member, a browser agent waits for
 * its creator's confirmation (confirm.ts); a server agent's changes count for everyone right away.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, PenLine, Plus, Undo2, X } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { AGENT_LIMITS, localTimeZone, isTimeZone } from '../../store/agents'
import type { AgentTrigger, CustomAgent, ID, Page } from '../../store/types'
import { useCloud } from '../../cloud'
import { Modal } from '../../ui/Modal'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { IconPicker } from '../../ui/IconPicker'
import { PageIcon } from '../../ui/PageIcon'
import { Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { AI_MODELS, AIError, runAI } from '../ai/client'
import { readServers } from '../ai/mcp-servers/config'
import { weekdayName } from './format'
import { isReadTool, testedTools } from './mcpTools'
import { placeholdersIn } from './mirror'
import { useServerUnlocked, useUnlocked } from './integrations/status'
import './mirror.css'
import { AGENT_PLACEHOLDERS, instructionTools, openPlaceholders } from './instructions'
import { CodeArea, lineColAt, lineStarts, markdownTokenizer, type CodeAreaHandle } from '../../ui/code'
import { createHook, deleteHook, getHook, serverErrorText, useServerAgents, type HookState } from './server'
import './agents.css'

type Errors = Partial<Record<'name' | 'instructions' | 'trigger' | 'scope' | 'output' | 'budget' | 'runner' | 'mcp', string>>
type T = ReturnType<typeof useT>

const EVERY = ['hour', 'day', 'weekday', 'week', 'month'] as const
const TZ_COMMON = ['UTC', 'Europe/Berlin', 'Europe/London', 'Europe/Paris', 'Europe/Zurich', 'Europe/Vienna', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney']

/** Pages and databases the pickers offer (templates and the trash left out). */
function useCandidates(kind: 'page' | 'database' | 'any'): Page[] {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(
    () =>
      Object.values(pages)
        .filter((p) => !p.trashed && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && !p.databaseId)
        .filter((p) => (kind === 'any' ? true : kind === 'database' ? p.kind === 'database' : p.kind === 'page'))
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [pages, kind],
  )
}

/** Field: label + hint + error (the control is named by the label, described by hint and error). */
function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; id?: string }) {
  return (
    <div className="agx-field" data-invalid={error ? '' : undefined}>
      {id ? (
        <label className="agx-field__label" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="agx-field__label">{label}</span>
      )}
      {children}
      {hint && !error && (
        <p className="agx-field__hint" id={id ? `${id}-hint` : undefined}>
          {hint}
        </p>
      )}
      {error && (
        <p className="agx-field__error" id={id ? `${id}-err` : undefined} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** A segmented single choice (radiogroup). */
function Seg<V extends string>({ value, options, onChange, label, disabled }: { value: V; options: Array<{ v: V; label: string; disabled?: boolean }>; onChange: (v: V) => void; label: string; disabled?: boolean }) {
  return (
    <div
      className="agx-seg"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || disabled) return
        e.preventDefault()
        const usable = options.filter((o) => !o.disabled)
        const i = usable.findIndex((o) => o.v === value)
        const next = usable[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + usable.length) % usable.length]
        if (!next) return
        onChange(next.v)
        const root = e.currentTarget
        requestAnimationFrame(() => root.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
      }}
    >
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} tabIndex={value === o.v ? 0 : -1} className="agx-seg__btn" disabled={disabled || o.disabled} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A field-like button opening a searchable menu of pages / databases. */
function PagePicker({ value, onPick, kind, label, placeholder, allowNone, id }: { value: ID | null; onPick: (id: ID | null) => void; kind: 'page' | 'database' | 'any'; label: string; placeholder: string; allowNone?: string; id?: string }) {
  const t = useT()
  const menu = useMenu()
  const pages = useWorkspace((s) => s.pages)
  const list = useCandidates(kind)
  const cur = value ? pages[value] : undefined
  const entries: MenuEntry[] = [
    ...(allowNone ? [{ label: allowNone, checked: !value, onSelect: () => onPick(null) } as MenuEntry] : []),
    ...list.map((p) => ({ label: p.title.trim() || t('common.untitled'), icon: <PageIcon icon={p.icon} kind={p.kind} size={15} />, checked: p.id === value, onSelect: () => onPick(p.id) })),
  ]
  return (
    <>
      <button type="button" id={id} className="agx-pick" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} aria-label={label}>
        {cur ? (
          <>
            <PageIcon icon={cur.icon} kind={cur.kind} size={15} />
            <span className="agx-pick__text">{cur.title.trim() || t('common.untitled')}</span>
          </>
        ) : (
          <span className="agx-pick__text faint">{placeholder}</span>
        )}
        <ChevronDown size={14} className="faint" aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} searchable searchPlaceholder={t('common.search')} emptyLabel={t('features.agents.ed.noneFound')} width={300} />
    </>
  )
}

export function validate(t: T, d: CustomAgent, ctx: { pages: Record<ID, Page>; serverOk: boolean; inCloud: boolean }): Errors {
  const e: Errors = {}
  if (!d.name.trim()) e.name = t('features.agents.err.name')
  if (!d.instructions.trim()) e.instructions = t('features.agents.err.instructions')
  else if (d.instructions.length > AGENT_LIMITS.instructions) e.instructions = t('features.agents.err.tooLong', { max: AGENT_LIMITS.instructions })
  else if (d.enabled && placeholdersIn(d.instructions).length) e.instructions = t('features.agents.mirror.err.placeholders', { count: placeholdersIn(d.instructions).length })
  const tr = d.trigger
  if ((tr.type === 'row_created' || tr.type === 'row_changed') && !(tr.databaseId && ctx.pages[tr.databaseId] && !ctx.pages[tr.databaseId].trashed)) e.trigger = t('features.agents.err.database')
  if (tr.type === 'schedule' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tr.at) || !isTimeZone(tr.tz))) e.trigger = t('features.agents.err.time')
  if (tr.type === 'webhook' && d.runner !== 'server') e.trigger = t('features.agents.err.webhook')
  if (!d.scope.everything && !d.scope.pages.length && !d.scope.databases.length) e.scope = t('features.agents.err.scope')
  if (d.output && d.output.pageId && !ctx.pages[d.output.pageId]) e.output = t('features.agents.err.output')
  if (!(d.maxRunUsd >= AGENT_LIMITS.minRunUsd && d.maxRunUsd <= AGENT_LIMITS.maxRunUsd)) e.budget = t('features.agents.err.budget', { max: AGENT_LIMITS.maxRunUsd })
  if (d.runner === 'server' && (!ctx.inCloud || !ctx.serverOk)) e.runner = t('features.agents.err.server')
  return e
}

/**
 * `intro`: a note on top (a recipe that set something up first says what it made), `introUndo` an Undo key in it
 * (what the recipe made goes again — in the note, never a toast over the footer); `writeHint`: the hint under
 * "Changes" instead of the write mode's own (the mirror recipe: proposals first, Apply once the runs look right).
 */
export function AgentEditor({
  initial,
  isNew,
  onClose,
  onSaved,
  intro,
  introUndo,
  writeHint,
}: {
  initial: CustomAgent
  isNew: boolean
  onClose: () => void
  onSaved: (id: ID) => void
  intro?: string
  introUndo?: { title?: string; run: () => void }
  writeHint?: string
}) {
  const t = useT()
  const lang = useLang()
  const [d, setD] = useState<CustomAgent>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [tried, setTried] = useState(false)
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const inCloud = useCloud((s) => s.active.kind === 'cloud')
  const me = useCloud((s) => s.user?.id ?? null)
  const people = useWorkspace((s) => s.people)
  const runtime = useServerAgents((s) => s.runtime)
  const serverOk = !!runtime?.enabled && runtime.available
  const uid = useId()
  // someone else's browser agent: saving it pauses it until its creator confirms
  const othersAgent = inCloud && !isNew && d.runner === 'browser' && !!initial.createdBy && initial.createdBy !== me
  const creatorName = othersAgent ? people.find((p) => p.id === initial.createdBy)?.name.trim() : ''
  const set = (patch: Partial<CustomAgent>) => setD((x) => ({ ...x, ...patch }))
  const ids = { name: `${uid}-name`, instr: `${uid}-instr`, budget: `${uid}-budget`, out: `${uid}-out`, db: `${uid}-db` }

  // errors follow the draft once a save was tried
  useEffect(() => {
    if (tried) setErrors(validate(t, d, { pages, serverOk, inCloud }))
  }, [d, tried, t, pages, serverOk, inCloud])

  const save = () => {
    setTried(true)
    const e = validate(t, d, { pages, serverOk, inCloud })
    setErrors(e)
    const first = Object.keys(e)[0]
    if (first) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.agx-editor [data-invalid] :is(input, textarea, button, select)`)?.focus())
      return
    }
    const clean: CustomAgent = { ...d, name: d.name.trim(), instructions: d.instructions.trim(), createdBy: d.createdBy ?? (inCloud ? (useCloud.getState().user?.id ?? null) : null) }
    useWorkspace.getState().upsertAgent(clean)
    onSaved(clean.id)
  }

  const errorList = Object.values(errors).filter(Boolean)

  return (
    <Modal
      open
      onClose={onClose}
      label="§ AG"
      title={isNew ? t('features.agents.ed.titleNew') : t('features.agents.ed.title', { name: initial.name })}
      width={760}
      className="agx-editor"
      footer={
        <div className="agx-editor__foot">
          {errorList.length > 0 && (
            <p className="agx-editor__errs" role="status">
              <span className="led agx-led--err" aria-hidden /> {t(errorList.length === 1 ? 'features.agents.err.count.one' : 'features.agents.err.count.other', { count: errorList.length })}
            </p>
          )}
          <span className="agx-spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            {isNew ? t('features.agents.ed.create') : t('features.agents.ed.save')}
          </button>
        </div>
      }
    >
      <form
        className="agx-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        noValidate
      >
        {intro && (
          <p className="agx-notice agx-editor__notice" role="note" data-testid="agx-editor-intro">
            <span className="led led--ok" aria-hidden />
            <span>{intro}</span>
            {introUndo && (
              <button type="button" className="btn btn--sm" title={introUndo.title} onClick={introUndo.run} data-testid="agx-editor-intro-undo">
                <Undo2 size={12} strokeWidth={1.8} aria-hidden /> {t('common.undo')}
              </button>
            )}
          </p>
        )}
        {othersAgent && (
          <p className="agx-notice agx-notice--wait agx-editor__notice" role="note">
            <span className="led led--on" aria-hidden />
            <span>{creatorName ? t('features.agents.ed.othersBrowser', { name: creatorName }) : t('features.agents.ed.othersBrowserAnon')}</span>
          </p>
        )}
        {inCloud && d.runner === 'server' && (
          <p className="agx-notice agx-editor__notice" role="note">
            <span className="led" aria-hidden />
            <span>{t('features.agents.ed.serverTeam')}</span>
          </p>
        )}
        {/* ---------------------------------------------------------- 01 job */}
        <Section n="01" title={t('features.agents.ed.job')}>
          <div className="agx-row">
            <IconButton icon={d.icon ?? null} onPick={(icon) => set({ icon })} />
            <Field label={t('features.agents.ed.name')} error={errors.name} id={ids.name}>
              <input
                id={ids.name}
                className="input"
                value={d.name}
                maxLength={AGENT_LIMITS.name}
                placeholder={t('features.agents.ed.namePh')}
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? `${ids.name}-err` : undefined}
                onChange={(e) => set({ name: e.target.value })}
                data-autofocus={isNew ? '' : undefined}
              />
            </Field>
          </div>
          <Instructions value={d.instructions} onChange={(instructions) => set({ instructions })} error={errors.instructions} id={ids.instr} agent={d} />
        </Section>

        {/* ---------------------------------------------------------- 02 trigger */}
        <Section n="02" title={t('features.agents.ed.trigger')}>
          <TriggerFields t={t} lang={lang} d={d} set={set} error={errors.trigger} dbId={ids.db} pages={pages} databases={databases} />
        </Section>

        {/* ---------------------------------------------------------- 03 access */}
        <Section n="03" title={t('features.agents.ed.access')}>
          <ScopeFields d={d} set={set} error={errors.scope} />
          <Field label={t('features.agents.ed.write')} hint={writeHint && d.write === 'stage' ? writeHint : t(`features.agents.write.${d.write}Hint`)}>
            <Seg
              label={t('features.agents.ed.write')}
              value={d.write}
              onChange={(write) => set({ write })}
              options={[
                { v: 'none', label: t('features.agents.write.none') },
                { v: 'stage', label: t('features.agents.write.stage') },
                { v: 'apply', label: t('features.agents.write.apply') },
              ]}
            />
          </Field>
          <McpFields d={d} set={set} />
        </Section>

        {/* ---------------------------------------------------------- 04 report */}
        <Section n="04" title={t('features.agents.ed.report')}>
          <Field label={t('features.agents.ed.reportPage')} hint={t('features.agents.ed.reportHint')} error={errors.output} id={ids.out}>
            <div className="agx-row agx-row--wrap">
              <PagePicker
                id={ids.out}
                kind="page"
                value={d.output?.pageId ?? null}
                onPick={(pageId) => set({ output: pageId ? { pageId, mode: d.output?.mode ?? 'append' } : null })}
                label={t('features.agents.ed.reportPage')}
                placeholder={t('features.agents.ed.reportNone')}
                allowNone={t('features.agents.ed.reportNone')}
              />
              {d.output?.pageId && (
                <Seg
                  label={t('features.agents.ed.reportMode')}
                  value={d.output.mode}
                  onChange={(mode) => set({ output: { pageId: d.output!.pageId, mode } })}
                  options={[
                    { v: 'append', label: t('features.agents.ed.append') },
                    { v: 'replace', label: t('features.agents.ed.replace') },
                  ]}
                />
              )}
            </div>
          </Field>
        </Section>

        {/* ---------------------------------------------------------- 05 engine */}
        <Section n="05" title={t('features.agents.ed.engine')}>
          <Field
            label={t('features.agents.ed.runner')}
            hint={d.runner === 'server' ? t('features.agents.runner.serverHint') : `${t('features.agents.runner.browserHint')}${inCloud ? ` ${t('features.agents.runner.browserTeam')}` : ''}`}
            error={errors.runner}
          >
            <Seg
              label={t('features.agents.ed.runner')}
              value={d.runner}
              onChange={(runner) => set({ runner, ...(runner === 'browser' && d.trigger.type === 'webhook' ? { trigger: { type: 'manual' } } : {}), mcpServers: [], mcpTools: undefined })}
              options={[
                { v: 'browser', label: t('features.agents.runner.browser') },
                { v: 'server', label: t('features.agents.runner.server'), disabled: !inCloud || !serverOk },
              ]}
            />
          </Field>
          {!inCloud && <p className="agx-note">{t('features.agents.runner.localOnly')}</p>}
          {inCloud && !serverOk && <p className="agx-note">{runtime && !runtime.available ? t('features.agents.server.off') : t('features.agents.runner.serverOff')}</p>}
          <div className="agx-grid2">
            <Field label={t('features.agents.ed.model')} id={`${uid}-model`}>
              <select id={`${uid}-model`} className="input" value={d.model ?? ''} onChange={(e) => set({ model: e.target.value || null })}>
                <option value="">{t('features.agents.ed.modelDefault')}</option>
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('features.agents.ed.effort')}>
              <Seg
                label={t('features.agents.ed.effort')}
                value={d.effort ?? 'default'}
                onChange={(v) => set({ effort: v === 'default' ? null : v })}
                options={[
                  { v: 'default', label: t('features.agents.effort.default') },
                  { v: 'low', label: t('features.agents.effort.low') },
                  { v: 'medium', label: t('features.agents.effort.medium') },
                  { v: 'high', label: t('features.agents.effort.high') },
                ]}
              />
            </Field>
          </div>
          <div className="agx-grid2">
            <Field label={t('features.agents.ed.budget')} hint={t('features.agents.ed.budgetHint')} error={errors.budget} id={ids.budget}>
              <div className="agx-money">
                <span className="agx-money__sign mono" aria-hidden>
                  $
                </span>
                <input
                  id={ids.budget}
                  className="input mono"
                  type="number"
                  inputMode="decimal"
                  min={AGENT_LIMITS.minRunUsd}
                  max={AGENT_LIMITS.maxRunUsd}
                  step={0.05}
                  value={Number.isFinite(d.maxRunUsd) ? d.maxRunUsd : ''}
                  aria-invalid={!!errors.budget || undefined}
                  onChange={(e) => set({ maxRunUsd: e.target.value === '' ? NaN : Number(e.target.value) })}
                />
              </div>
            </Field>
            <div className="agx-field">
              <span className="agx-field__label" id={`${uid}-on`}>
                {t('features.agents.ed.enabled')}
              </span>
              <div className="agx-row">
                <Switch checked={d.enabled} onChange={(enabled) => set({ enabled })} label={t('features.agents.ed.enabled')} />
                <span className="agx-field__hint">{d.enabled ? t('features.agents.ed.enabledOn') : t('features.agents.ed.enabledOff')}</span>
              </div>
            </div>
          </div>
        </Section>
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="agx-sec" aria-labelledby={id}>
      <h3 className="agx-sec__title label" id={id}>
        <span className="agx-sec__n">{n}</span> — {title}
      </h3>
      <div className="agx-sec__body">{children}</div>
    </section>
  )
}

function IconButton({ icon, onPick }: { icon: CustomAgent['icon']; onPick: (icon: CustomAgent['icon']) => void }) {
  const t = useT()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} type="button" className="agx-iconbtn" onClick={() => setOpen((o) => !o)} aria-label={t('features.agents.ed.icon')} title={t('features.agents.ed.icon')} aria-expanded={open}>
        <PageIcon icon={icon} size={26} />
      </button>
      <Popover open={open} anchor={ref.current} onClose={() => setOpen(false)} placement="bottom-start" bare>
        <IconPicker
          symbols
          onSelect={(i) => {
            onPick(i)
            setOpen(false)
          }}
          onRemove={() => {
            onPick(null)
            setOpen(false)
          }}
        />
      </Popover>
    </>
  )
}

/**
 * The job, with "Improve with Claude" (the previous text stays one click away): the shared code area with line
 * numbers, soft wrap, Markdown structure, the agent's tool names and open placeholders highlighted and counted.
 */
function Instructions({ value, onChange, error, id, agent }: { value: string; onChange: (v: string) => void; error?: string; id: string; agent: CustomAgent }) {
  const t = useT()
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const servers = useWorkspace((s) => s.settings.mcpServers)
  const [busy, setBusy] = useState(false)
  const [prev, setPrev] = useState<string | null>(null)
  const [open, setOpen] = useState(() => openPlaceholders(value))
  const ac = useRef<AbortController | null>(null)
  const area = useRef<CodeAreaHandle>(null)
  useEffect(() => () => ac.current?.abort(), [])
  // a recipe's placeholders still in the text (mirror.ts): a key selects one, so typing replaces it
  const holes = placeholdersIn(value)
  const selectHole = (ph: string) => {
    const at = value.indexOf(ph)
    if (at < 0) return
    const { line, col } = lineColAt(lineStarts(value), at)
    area.current?.reveal(line, col, ph.length)
  }
  const { scope, write, mcpServers, mcpTools } = agent
  const tools = useMemo(() => instructionTools({ scope, write, mcpServers, mcpTools }, { mcpServers: servers }), [scope, write, mcpServers, mcpTools, servers])
  const toolKey = [...tools.own, ...tools.mcp].join(' ')
  const tokenize = useMemo(() => markdownTokenizer({ tools: toolKey.split(' ').filter(Boolean) }), [toolKey])
  const improve = async () => {
    if (!value.trim() || busy) return
    ac.current?.abort()
    const ctl = new AbortController()
    ac.current = ctl
    setBusy(true)
    const before = value
    try {
      const out = await runAI({
        action: 'custom',
        input: value,
        instruction:
          'Rewrite these instructions for an autonomous AI agent that works in a Notion-like workspace without anyone watching. Make the job clear and step by step: what to look at, what to decide, what to change or propose, and what to put into the final report. Keep every fact, name and constraint, add nothing that is not implied, keep the language of the text. Keep every placeholder in square brackets exactly as written. Return only the improved instructions as plain text.',
        signal: ctl.signal,
        mcp: false,
      })
      if (out.trim()) {
        setPrev(before)
        onChange(out.trim().slice(0, AGENT_LIMITS.instructions))
      }
    } catch (e) {
      if (!(e instanceof AIError && e.code === 'aborted')) useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' })
    } finally {
      if (ac.current === ctl) ac.current = null
      setBusy(false)
    }
  }
  return (
    <Field label={t('features.agents.ed.instructions')} hint={t('features.agents.ed.instructionsHint')} error={error} id={id}>
      {holes.length > 0 && (
        <div className="agx-ph" role="group" aria-label={t('features.agents.mirror.toReplace')} data-testid="agx-placeholders">
          <span className="label agx-ph__label">
            {t('features.agents.mirror.toReplace')} · {holes.length}
          </span>
          <ul className="agx-ph__list">
            {holes.map((h) => (
              <li key={h.text} className="agx-ph__item">
                <button type="button" className="agx-ph__btn" onClick={() => selectHole(h.text)}>
                  {h.text}
                </button>
                <span className="agx-ph__hint">{h.key ? t(`features.agents.mirror.phHint.${h.key}`) : t('features.agents.mirror.phHint.generic')}</span>
              </li>
            ))}
          </ul>
          <p className="agx-ph__note">{t('features.agents.mirror.toReplaceHint')}</p>
        </div>
      )}
      <CodeArea
        ref={area}
        id={id}
        className="agx-job"
        value={value}
        onChange={(v) => {
          setPrev(null)
          onChange(v)
        }}
        tokenize={tokenize}
        placeholders={AGENT_PLACEHOLDERS}
        onPlaceholders={setOpen}
        wrap
        storageKey="agent.instructions"
        resizable
        minRows={holes.length ? 12 : 8}
        maxRows={20}
        enter="list"
        maxLength={AGENT_LIMITS.instructions}
        placeholder={t('features.agents.ed.instructionsPh')}
        describedBy={error ? `${id}-err` : `${id}-hint`}
        invalid={!!error}
        disabled={busy}
        testId="agx-job"
        bar={
          <span className="agx-count mono" aria-hidden>
            {value.length.toLocaleString()}/{AGENT_LIMITS.instructions.toLocaleString()}
          </span>
        }
      />
      {open > 0 && !holes.length && (
        <p className="agx-phnote" role="note" data-testid="agx-phnote">
          <span className="led led--on" aria-hidden />
          <span>{t(open === 1 ? 'features.agents.ed.phNote.one' : 'features.agents.ed.phNote.other', { count: open })}</span>
        </p>
      )}
      <div className="agx-row agx-row--tools">
        <button type="button" className="btn btn--sm" onClick={() => void improve()} disabled={!hasKey || busy || !value.trim()} title={hasKey ? undefined : t('features.agents.ed.needsKey')}>
          <PenLine size={13} strokeWidth={1.75} aria-hidden /> {busy ? t('features.agents.ed.improving') : t('features.agents.ed.improve')}
        </button>
        {prev !== null && !busy && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onChange(prev)
              setPrev(null)
            }}
          >
            <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('features.agents.ed.improveUndo')}
          </button>
        )}
        <span className="agx-spacer" />
        <span className="agx-legend" aria-hidden>
          <span className="syn-tool">{t('features.agents.ed.legendTool')}</span>
          <span className="syn-ph">[{t('features.agents.ed.legendPh')}]</span>
        </span>
      </div>
      {tools.mcp.length > 0 && <p className="agx-note">{t('features.agents.ed.toolsKnown', { own: tools.own.length, mcp: tools.mcp.length })}</p>}
    </Field>
  )
}

function TriggerFields({ t, lang, d, set, error, dbId, pages, databases }: { t: T; lang: string; d: CustomAgent; set: (p: Partial<CustomAgent>) => void; error?: string; dbId: string; pages: Record<ID, Page>; databases: ReturnType<typeof useWorkspace.getState>['databases'] }) {
  const uid = useId()
  const saved = useWorkspace((s) => !!s.agents?.[d.id])
  const tr = d.trigger
  const kind = tr.type
  const toKind = (k: AgentTrigger['type']) => {
    if (k === kind) return
    const db = tr.type === 'row_created' || tr.type === 'row_changed' ? tr.databaseId : ''
    const next: AgentTrigger =
      k === 'schedule'
        ? { type: 'schedule', every: 'day', at: '08:00', tz: localTimeZone() }
        : k === 'row_created'
          ? { type: 'row_created', databaseId: db }
          : k === 'row_changed'
            ? { type: 'row_changed', databaseId: db, propertyId: null }
            : k === 'webhook'
              ? { type: 'webhook' }
              : { type: 'manual' }
    set({ trigger: next })
  }
  const zones = useMemo(() => {
    const local = localTimeZone()
    const cur = tr.type === 'schedule' ? tr.tz : local
    return [...new Set([local, cur, ...TZ_COMMON])]
  }, [tr])
  const db = (tr.type === 'row_created' || tr.type === 'row_changed') && tr.databaseId ? databases[tr.databaseId] : undefined
  return (
    <>
      <Field label={t('features.agents.ed.when')} hint={t(`features.agents.trig.${kind}Hint`)} error={kind === 'manual' || kind === 'webhook' ? error : undefined}>
        <Seg
          label={t('features.agents.ed.when')}
          value={kind}
          onChange={toKind}
          options={[
            { v: 'manual', label: t('features.agents.trig.manual') },
            { v: 'schedule', label: t('features.agents.trig.schedule') },
            { v: 'row_created', label: t('features.agents.trig.row_created') },
            { v: 'row_changed', label: t('features.agents.trig.row_changed') },
            ...(d.runner === 'server' ? [{ v: 'webhook' as const, label: t('features.agents.trig.webhook') }] : []),
          ]}
        />
      </Field>
      {tr.type === 'schedule' && (
        <div className="agx-sched" data-invalid={error ? '' : undefined}>
          <label className="agx-mini">
            <span className="label">{t('features.agents.ed.every')}</span>
            <select className="input" value={tr.every} onChange={(e) => set({ trigger: { ...tr, every: e.target.value as (typeof EVERY)[number], ...(e.target.value === 'week' ? { weekday: tr.weekday ?? 1 } : {}), ...(e.target.value === 'month' ? { day: tr.day ?? 1 } : {}) } })}>
              {EVERY.map((v) => (
                <option key={v} value={v}>
                  {t(`features.agents.every.${v}`)}
                </option>
              ))}
            </select>
          </label>
          {tr.every === 'week' && (
            <label className="agx-mini">
              <span className="label">{t('features.agents.ed.weekday')}</span>
              <select className="input" value={tr.weekday ?? 1} onChange={(e) => set({ trigger: { ...tr, weekday: Number(e.target.value) } })}>
                {[1, 2, 3, 4, 5, 6, 0].map((n) => (
                  <option key={n} value={n}>
                    {weekdayName(n, lang)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tr.every === 'month' && (
            <label className="agx-mini">
              <span className="label">{t('features.agents.ed.day')}</span>
              <input className="input mono" type="number" min={1} max={31} value={tr.day ?? 1} onChange={(e) => set({ trigger: { ...tr, day: Math.min(31, Math.max(1, Math.round(Number(e.target.value) || 1))) } })} />
            </label>
          )}
          <label className="agx-mini">
            <span className="label">{tr.every === 'hour' ? t('features.agents.ed.minute') : t('features.agents.ed.time')}</span>
            <input className="input mono" type="time" value={tr.at} aria-invalid={!!error || undefined} onChange={(e) => set({ trigger: { ...tr, at: e.target.value } })} />
          </label>
          <label className="agx-mini agx-mini--wide">
            <span className="label">{t('features.agents.ed.tz')}</span>
            <select className="input" value={tr.tz} onChange={(e) => set({ trigger: { ...tr, tz: e.target.value } })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="agx-field__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {(tr.type === 'row_created' || tr.type === 'row_changed') && (
        <div className="agx-grid2">
          <Field label={t('features.agents.ed.database')} error={error} id={dbId}>
            <PagePicker
              id={dbId}
              kind="database"
              value={tr.databaseId || null}
              onPick={(id) => set({ trigger: tr.type === 'row_changed' ? { ...tr, databaseId: id ?? '', propertyId: null } : { ...tr, databaseId: id ?? '' } })}
              label={t('features.agents.ed.database')}
              placeholder={t('features.agents.ed.pickDatabase')}
            />
          </Field>
          {tr.type === 'row_changed' && (
            <Field label={t('features.agents.ed.property')} id={`${uid}-prop`}>
              <select id={`${uid}-prop`} className="input" value={tr.propertyId ?? ''} disabled={!db} onChange={(e) => set({ trigger: { ...tr, propertyId: e.target.value || null } })}>
                <option value="">{t('features.agents.ed.anyProperty')}</option>
                {(db?.properties ?? [])
                  .filter((p) => !['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'].includes(p.type))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </div>
      )}
      {tr.type === 'webhook' && <HookPanel agentId={d.id} saved={saved} />}
      {(tr.type === 'row_created' || tr.type === 'row_changed') && pages[tr.databaseId] && <p className="agx-note">{t('features.agents.trig.coalesce')}</p>}
    </>
  )
}

function ScopeFields({ d, set, error }: { d: CustomAgent; set: (p: Partial<CustomAgent>) => void; error?: string }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const menu = useMenu()
  const list = useCandidates('any')
  const inCloud = useCloud((s) => s.active.kind === 'cloud')
  const chosen = [...d.scope.pages, ...d.scope.databases]
  const add = (p: Page) => {
    if (chosen.includes(p.id)) return
    set({ scope: { ...d.scope, everything: false, ...(p.kind === 'database' ? { databases: [...d.scope.databases, p.id] } : { pages: [...d.scope.pages, p.id] }) } })
  }
  const remove = (id: ID) => set({ scope: { ...d.scope, pages: d.scope.pages.filter((x) => x !== id), databases: d.scope.databases.filter((x) => x !== id) } })
  const entries: MenuEntry[] = list.filter((p) => !chosen.includes(p.id)).map((p) => ({ label: p.title.trim() || t('common.untitled'), icon: <PageIcon icon={p.icon} kind={p.kind} size={15} />, hint: p.kind === 'database' ? t('features.agents.ed.db') : undefined, onSelect: () => add(p) }))
  return (
    <Field label={t('features.agents.ed.scope')} hint={inCloud ? `${t('features.agents.ed.scopeHint')} ${t('features.agents.ed.scopeHintTeam')}` : t('features.agents.ed.scopeHint')} error={error}>
      <Seg
        label={t('features.agents.ed.scope')}
        value={d.scope.everything ? 'all' : 'some'}
        onChange={(v) => set({ scope: { ...d.scope, everything: v === 'all' } })}
        options={[
          { v: 'all', label: t('features.agents.scope.all') },
          { v: 'some', label: t('features.agents.scope.some') },
        ]}
      />
      {!d.scope.everything && (
        <div className="agx-chips" aria-label={t('features.agents.ed.scope')}>
          {chosen.map((id) => (
            <span key={id} className="agx-chipx">
              <PageIcon icon={pages[id]?.icon} kind={pages[id]?.kind ?? 'page'} size={14} />
              <span className="agx-chipx__text">{pages[id] ? pages[id].title.trim() || t('common.untitled') : t('features.agents.ed.gone')}</span>
              <button type="button" className="icon-btn icon-btn--sm" onClick={() => remove(id)} aria-label={t('features.agents.ed.removeScope', { title: pages[id]?.title.trim() || t('common.untitled') })}>
                <X size={12} strokeWidth={1.8} />
              </button>
            </span>
          ))}
          <button type="button" className="btn btn--sm btn--ghost agx-chips__add" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open}>
            <Plus size={13} strokeWidth={1.8} aria-hidden /> {t('features.agents.ed.addScope')}
          </button>
          <Menu {...menu.props} entries={entries} searchable searchPlaceholder={t('common.search')} emptyLabel={t('features.agents.ed.noneFound')} width={300} />
        </div>
      )}
    </Field>
  )
}

/**
 * MCP servers by name: browser agents use Settings → Claude AI, server agents the server's list. The tool allow-list
 * per server only while an active integration profile unlocks it (this device's servers; for a server agent also the
 * runtime's, by name / host) — without one, a list the agent already has stays applied and is shown read-only.
 */
function McpFields({ d, set }: { d: CustomAgent; set: (p: Partial<CustomAgent>) => void }) {
  const t = useT()
  const settings = useWorkspace((s) => s.settings)
  const runtime = useServerAgents((s) => s.runtime)
  const here = useUnlocked('toolAllowList')
  const onServer = useServerUnlocked('toolAllowList')
  const allowList = here || (d.runner === 'server' && onServer)
  const names = d.runner === 'server' ? (runtime?.mcpServers ?? []).map((s) => s.name) : readServers(settings).map((s) => s.name)
  const all = [...new Set([...names, ...d.mcpServers])]
  const toggle = (name: string, on: boolean) => set({ mcpServers: on ? [...d.mcpServers, name] : d.mcpServers.filter((x) => x !== name) })
  return (
    <div className="agx-field">
      <span className="agx-field__label">{t('features.agents.ed.mcp')}</span>
      {all.length === 0 ? (
        <p className="agx-field__hint">
          {d.runner === 'server' ? t('features.agents.ed.mcpNoneServer') : t('features.agents.ed.mcpNone')}{' '}
          {d.runner !== 'server' && (
            <button type="button" className="agx-link" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
              {t('features.agents.ed.mcpSetup')}
            </button>
          )}
        </p>
      ) : (
        <div className="agx-checks" role="group" aria-label={t('features.agents.ed.mcp')}>
          {all.map((name) => (
            <label key={name} className="agx-check" data-missing={!names.includes(name) || undefined}>
              <input type="checkbox" checked={d.mcpServers.includes(name)} onChange={(e) => toggle(name, e.target.checked)} />
              <span className="mono">{name.toUpperCase()}</span>
              {!names.includes(name) && <span className="agx-check__note">{t('features.agents.ed.mcpMissing')}</span>}
            </label>
          ))}
        </div>
      )}
      <p className="agx-field__hint">{t('features.agents.ed.mcpHint')}</p>
      {!allowList &&
        d.mcpServers
          .filter((name) => d.mcpTools && Object.prototype.hasOwnProperty.call(d.mcpTools, name))
          .map((name) => (
            <p key={name} className="agx-tools-kept" data-testid="agx-tools-kept">
              <span className="label">{name.toUpperCase()}</span>
              <span>{t('features.agents.ed.toolsKept', { n: d.mcpTools![name].length })}</span>
            </p>
          ))}
      {allowList && d.mcpServers.map((name) => (
        <McpToolList
          key={name}
          server={name}
          tools={testedTools(name, readServers(settings), d.runner === 'server' ? (runtime?.mcpServers.find((s) => s.name === name) ?? null) : null)}
          allow={d.mcpTools && Object.prototype.hasOwnProperty.call(d.mcpTools, name) ? d.mcpTools[name] : undefined}
          onChange={(list) => {
            const next = { ...(d.mcpTools ?? {}) }
            if (list) next[name] = list
            else delete next[name]
            set({ mcpTools: Object.keys(next).length ? next : undefined })
          }}
        />
      ))}
    </div>
  )
}

/**
 * The tools an agent may use of one MCP server (CustomAgent.mcpTools): every tool of the last connection test as a
 * checkbox, "Read-only tools" (ticks the names that look like reads, unticks the rest) and "All" (no list: also
 * tools the server adds later). Untested: a pointer to Settings — the agent may use all its tools until then.
 */
function McpToolList({ server, tools, allow, onChange }: { server: string; tools: string[] | null; allow: string[] | undefined; onChange: (list: string[] | undefined) => void }) {
  const t = useT()
  const id = useId()
  const known = tools ?? []
  const shown = [...known, ...(allow ?? []).filter((x) => !known.includes(x))]
  const on = (tool: string) => allow === undefined || allow.includes(tool)
  const toggle = (tool: string, v: boolean) => {
    const base = allow ?? known
    const next = v ? [...base, tool] : base.filter((x) => x !== tool)
    onChange(shown.filter((x) => next.includes(x)))
  }
  const hint = allow === undefined ? t('features.agents.ed.toolsAllHint') : allow.length ? t('features.agents.ed.toolsSomeHint') : t('features.agents.ed.toolsNone')
  return (
    <div className="agx-tools" role="group" aria-labelledby={`${id}-h`} data-server={server} data-none={allow?.length === 0 || undefined}>
      <div className="agx-tools__head">
        <span className="label agx-tools__name">
          <span className="visually-hidden" id={`${id}-h`}>
            {t('features.agents.ed.toolsOf', { name: server.toUpperCase() })}
          </span>
          <span aria-hidden>
            {server.toUpperCase()} · {t('features.agents.ed.tools')}
          </span>
        </span>
        <span className="label agx-tools__count" data-testid="agx-tools-count">
          {allow === undefined ? t('features.agents.ed.toolsAllCount') : t('features.agents.ed.toolsCount', { n: allow.length, total: Math.max(known.length, shown.length) })}
        </span>
        <span className="agx-tools__acts">
          {known.length > 0 && (
            <button type="button" className="btn btn--sm" onClick={() => onChange(known.filter(isReadTool))}>
              {t('features.agents.ed.toolsRead')}
            </button>
          )}
          <button type="button" className="btn btn--sm" aria-pressed={allow === undefined} onClick={() => onChange(undefined)} disabled={allow === undefined}>
            {t('features.agents.ed.toolsAll')}
          </button>
        </span>
      </div>
      {shown.length > 0 && (
        <div className="agx-tools__list">
          {shown.map((tool) => (
            <label key={tool} className="agx-check agx-check--tool" data-missing={!known.includes(tool) || undefined}>
              <input type="checkbox" checked={on(tool)} onChange={(e) => toggle(tool, e.target.checked)} />
              <span className="mono agx-tools__tool" title={tool}>
                {tool}
              </span>
              {tools && !known.includes(tool) && <span className="agx-check__note">{t('features.agents.ed.toolsGone')}</span>}
            </label>
          ))}
        </div>
      )}
      {tools ? (
        <p className="agx-field__hint">{hint}</p>
      ) : (
        <p className="agx-field__hint">
          {t('features.agents.ed.toolsUntested')}{' '}
          <button type="button" className="agx-link" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
            {t('features.agents.ed.toolsTest')}
          </button>
        </p>
      )}
    </div>
  )
}

/** Server agents started by a webhook: the address (shown once when created), regenerate, delete. */
function HookPanel({ agentId, saved }: { agentId: ID; saved: boolean }) {
  const t = useT()
  const lang = useLang()
  const role = useCloud((s) => s.role)
  const admin = role === 'owner' || role === 'admin'
  const [hook, setHook] = useState<HookState | null>(null)
  const [url, setUrl] = useState('')
  const [confirm, setConfirm] = useState<'regen' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!saved) return
    let live = true
    getHook(agentId)
      .then((h) => live && setHook(h))
      .catch((e) => live && setError(serverErrorText(e)))
    return () => {
      live = false
    }
  }, [agentId, saved])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(serverErrorText(e))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }
  const create = () =>
    act(async () => {
      setUrl(await createHook(agentId))
      setHook(await getHook(agentId).catch(() => ({ set: true, createdAt: new Date().toISOString(), lastDeliveryAt: null, deliveries: 0 })))
    })
  const remove = () =>
    act(async () => {
      await deleteHook(agentId)
      setUrl('')
      setHook({ set: false, createdAt: null, lastDeliveryAt: null, deliveries: 0 })
    })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      useUI.getState().toast({ message: t('features.agents.hook.copied'), kind: 'success' })
    } catch {
      /* the field stays selectable */
    }
  }
  const when = hook?.createdAt ? new Date(hook.createdAt).toLocaleDateString(lang) : '—'
  return (
    <div className="agx-hook" role="group" aria-label={t('features.agents.hook.title')}>
      <span className="label agx-hook__title">{t('features.agents.hook.title')}</span>
      {!saved ? (
        <p className="agx-note">{t('features.agents.hook.saveFirst')}</p>
      ) : (
        <>
          <p className="agx-note">{hook?.set ? t('features.agents.hook.set', { when, n: hook.deliveries }) : t('features.agents.hook.none')}</p>
          {url && (
            <div className="agx-hook__url">
              <input className="input mono" readOnly value={url} aria-label={t('features.agents.hook.title')} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn btn--sm btn--ink" onClick={() => void copy()}>
                <Copy size={12} strokeWidth={1.8} aria-hidden /> {t('features.agents.hook.copy')}
              </button>
              <p className="agx-field__hint">{t('features.agents.hook.once')}</p>
            </div>
          )}
          {admin ? (
            confirm ? (
              <div className="agx-row agx-row--wrap agx-hook__confirm" role="alertdialog" aria-label={t(confirm === 'regen' ? 'features.agents.hook.regenTitle' : 'features.agents.hook.deleteTitle')}>
                <strong>{t(confirm === 'regen' ? 'features.agents.hook.regenTitle' : 'features.agents.hook.deleteTitle')}</strong>
                <span className="agx-field__hint">{t(confirm === 'regen' ? 'features.agents.hook.regenBody' : 'features.agents.hook.deleteBody')}</span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(null)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={() => void (confirm === 'regen' ? create() : remove())}>
                  {t(confirm === 'regen' ? 'features.agents.hook.regenerate' : 'features.agents.hook.delete')}
                </button>
              </div>
            ) : (
              <div className="agx-row agx-row--wrap">
                {hook?.set ? (
                  <>
                    <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setConfirm('regen')}>
                      {t('features.agents.hook.regenerate')}
                    </button>
                    <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => setConfirm('delete')}>
                      {t('features.agents.hook.delete')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--sm btn--ink" disabled={busy || !hook} onClick={() => void create()}>
                    {t('features.agents.hook.create')}
                  </button>
                )}
              </div>
            )
          ) : (
            <p className="agx-field__hint">{t('features.agents.hook.adminsOnly')}</p>
          )}
          {error && (
            <p className="agx-field__error" role="alert">
              {t('features.agents.hook.failed', { msg: error })}
            </p>
          )}
        </>
      )}
    </div>
  )
}
