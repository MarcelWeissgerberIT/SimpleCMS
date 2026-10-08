/**
 * Workspace page § 02 — Look (#/workspace/look): the workspace's colours (signal, paper, ink; Carbon derived or
 * its own), type (interface, page text, headings) and corners. Edits are a draft previewed in this tab only
 * (the whole app + a Paper / Carbon plate), then saved for everyone (team: owners and admins) or discarded;
 * Undo in the save toast. "Use the standard look on this device" is per device and always available.
 * Colour rules, contrast and the stylesheet: lib/look. The store keeps only sanitized looks (setLook).
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LookColors, LookCorners, LookHeadings, LookPresetId, LookTextFont, LookUiFont, WorkspaceLook } from '../../store/types'
import { LOOK_CORNERS, LOOK_HEADINGS, LOOK_PRESET_IDS, LOOK_TEXT_FONTS, LOOK_UI_FONTS } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { useLang, useT } from '../../i18n'
import { Led, Switch, SwitchFace } from '../../ui/controls'
import { onRovingKey } from '../../ui/roving'
import {
  defaultLook,
  deriveLook,
  HEADING_SPECIMENS,
  headWordSpacing,
  isDefaultLook,
  LOOK_PRESETS,
  normalizeHex,
  sameAppearance,
  sameLook,
  setLookPreview,
  setStandardHere,
  SWATCHES,
  TEXT_FONT_STACKS,
  toOklab,
  UI_FONT_STACKS,
  useStandardHere,
  type Derived,
  type Swatch,
} from '../../lib/look'
import { stockTokenTable } from '../../lib/look/stock'
import { fmtDate } from '../lib/format'
import { useInCloud } from '../cloud/state'
import type { TeamData } from '../cloud/Team'
import { Field } from '../settings/SettingsModal'
import { SectionHead, Spec, SubHead } from './parts'
import './look.css'

const asDraft = (look: WorkspaceLook | null): WorkspaceLook => look ?? defaultLook()

/** The open workspace's scope for per-device choices ('local' or the team workspace id). */
export function useLookScope(): string {
  return useCloud((s) => (s.active.kind === 'cloud' ? s.active.id : 'local'))
}

export function LookSection({ team }: { team: TeamData }) {
  const t = useT()
  const lang = useLang()
  const inCloud = useInCloud()
  const { readOnly } = useCloud(useShallow((s) => ({ readOnly: s.readOnly })))
  const canEdit = !inCloud || (team.admin && !readOnly)
  const scope = useLookScope()
  const stored = useWorkspace((s) => s.look ?? null)

  // the draft and the saved look it started from (a change of the saved look elsewhere is noticed against it)
  const [base, setBase] = useState<WorkspaceLook | null>(stored)
  const [draft, setDraft] = useState<WorkspaceLook>(() => asDraft(stored))
  const [remote, setRemote] = useState(false)
  const dirty = !sameLook(draft, asDraft(base))
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    if (sameLook(stored, base, { meta: true })) return
    if (!dirtyRef.current) {
      setBase(stored)
      setDraft(asDraft(stored))
      setRemote(false)
    } else setRemote(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  // the whole tab previews the draft; leaving the section drops it
  useEffect(() => {
    setLookPreview(dirty && canEdit ? (isDefaultLook(draft) ? null : draft) : undefined)
  }, [dirty, draft, canEdit])
  useEffect(
    () => () => {
      setLookPreview(undefined)
      if (dirtyRef.current) useUI.getState().toast({ message: t('shell.ws.look.discarded') })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const commit = (next: WorkspaceLook | null, message: string) => {
    const prev = useWorkspace.getState().look ?? null
    if (!useWorkspace.getState().setLook(next)) {
      useUI.getState().toast({ message: t('shell.ws.look.refused'), kind: 'error' })
      return
    }
    const saved = useWorkspace.getState().look ?? null
    setBase(saved)
    setDraft(asDraft(saved))
    setRemote(false)
    setLookPreview(undefined)
    useUI.getState().toast({ message, action: { label: t('shell.ws.look.undo'), run: () => void useWorkspace.getState().setLook(prev) } })
  }
  const save = () => commit(isDefaultLook(draft) ? null : draft, t(inCloud ? 'shell.ws.look.savedTeam' : 'shell.ws.look.saved'))
  const reset = () => commit(null, t('shell.ws.look.resetDone'))
  /** Back to the saved look as it is now (also after it changed elsewhere while this draft was open). */
  const loadRemote = () => {
    setBase(stored)
    setDraft(asDraft(stored))
    setRemote(false)
  }
  const discard = loadRemote

  const set = (patch: Partial<WorkspaceLook>) => setDraft((d) => ({ ...d, ...patch }))
  const setColor = (key: keyof LookColors, hex: string) => setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: hex } }))
  const setDark = (key: keyof LookColors, hex: string) => setDraft((d) => ({ ...d, dark: { ...(d.dark ?? deriveLook(d).darkInputs), [key]: hex } }))
  const setFonts = (patch: Partial<WorkspaceLook['fonts']>) => setDraft((d) => ({ ...d, fonts: { ...d.fonts, ...patch } }))

  const derived = deriveLook(draft)
  const presetName = (id: LookPresetId) => t(`shell.ws.look.preset.${id}`).toUpperCase()
  const state = !stored ? t('shell.ws.look.state.standard') : sameAppearance(stored, { ...LOOK_PRESETS[stored.preset], updatedAt: 0 }) ? presetName(stored.preset) : t('shell.ws.look.state.modified', { name: presetName(stored.preset) })
  const setter = inCloud && stored?.updatedBy ? team.members?.find((m) => m.user.id === stored.updatedBy) : undefined
  const setterName = setter ? setter.user.name.trim() || setter.user.email.split('@')[0] : null

  return (
    <div className="look" data-testid="look-section">
      <SectionHead n="02" title={t('shell.ws.sec.look')} lead={t('shell.ws.look.lead')} help="workspace-look">
        <div className="look-head">
          <span className="look-state label" data-testid="look-state" aria-label={`${t('shell.ws.look.state.label')}: ${state}`}>
            <Led state={stored ? 'on' : 'ok'} />
            {state}
            {setterName && stored && <span className="look-state__by">{t('shell.ws.look.setBy', { name: setterName.toUpperCase(), date: fmtDate(stored.updatedAt, lang).toUpperCase() })}</span>}
          </span>
          <button type="button" className="btn btn--sm btn--ghost" data-testid="look-reset" disabled={!canEdit || (!stored && isDefaultLook(draft))} onClick={reset}>
            {t('shell.ws.look.reset')}
          </button>
        </div>
      </SectionHead>

      {!canEdit && (
        <p className="look-note" data-testid="look-readonly">
          {t('shell.ws.look.readOnly')}
        </p>
      )}
      {remote && (
        <p className="look-note look-note--remote" role="status" data-testid="look-remote">
          {t('shell.ws.look.remote')}
          <button type="button" className="btn btn--sm" onClick={loadRemote}>
            {t('shell.ws.look.loadRemote')}
          </button>
        </p>
      )}

      <fieldset className="look-edit" disabled={!canEdit} data-testid="look-edit">
        <SubHead label={t('shell.ws.look.presets')} />
        <div className="look-presets" role="radiogroup" aria-label={t('shell.ws.look.presetsLabel')} data-testid="look-presets" onKeyDown={(e) => onRovingKey(e)}>
          {LOOK_PRESET_IDS.map((id, i) => {
            const checked = sameAppearance(draft, { ...LOOK_PRESETS[id], updatedAt: 0 })
            const anyChecked = LOOK_PRESET_IDS.some((p) => sameAppearance(draft, { ...LOOK_PRESETS[p], updatedAt: 0 }))
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked || (!anyChecked && i === 0) ? 0 : -1}
                className="look-preset"
                data-testid={`look-preset-${id}`}
                onClick={() => setDraft({ ...LOOK_PRESETS[id], updatedAt: draft.updatedAt, updatedBy: draft.updatedBy ?? null })}
              >
                <PresetMini id={id} />
                <span className="look-preset__row">
                  <span className="look-preset__radio" aria-hidden />
                  <span className="look-preset__name">{t(`shell.ws.look.preset.${id}`)}</span>
                  <span className="look-preset__code">{id.toUpperCase()}</span>
                </span>
                <span className="look-preset__note">{t(`shell.ws.look.presetNote.${id}`)}</span>
              </button>
            )
          })}
        </div>

        <SubHead label={t('shell.ws.look.colours')} />
        <ColorRow
          name="signal"
          label={t('shell.ws.look.signal')}
          hint={t('shell.ws.look.signalHint')}
          value={draft.colors.signal}
          swatches={SWATCHES.signal}
          derived={derived.light}
          onChange={(hex) => setColor('signal', hex)}
          warn={near(derived.light.full.signal, derived.light.full.ink) ? t('shell.ws.look.closeToInk') : null}
        />
        <ColorRow name="paper" label={t('shell.ws.look.paper')} hint={t('shell.ws.look.paperHint')} value={draft.colors.paper} swatches={SWATCHES.paper} derived={derived.light} onChange={(hex) => setColor('paper', hex)} />
        <ColorRow name="ink" label={t('shell.ws.look.ink')} hint={t('shell.ws.look.inkHint')} value={draft.colors.ink} swatches={SWATCHES.ink} derived={derived.light} onChange={(hex) => setColor('ink', hex)} />
        <Field label={t('shell.ws.look.carbon')} hint={t(draft.dark ? 'shell.ws.look.carbonOwnHint' : 'shell.ws.look.carbonDerived')} inline>
          <Switch
            seed="carbonOwn"
            checked={!!draft.dark}
            label={t('shell.ws.look.carbonOwn')}
            onChange={(on) =>
              setDraft((d) => {
                if (on) return { ...d, dark: { ...deriveLook(d).darkInputs } }
                const { dark: _drop, ...rest } = d
                return rest
              })
            }
          />
        </Field>
        {draft.dark && (
          <div className="look-carbon" data-testid="look-carbon">
            <ColorRow name="carbon-signal" label={t('shell.ws.look.carbonSignal')} hint={t('shell.ws.look.signalHint')} value={draft.dark.signal} swatches={SWATCHES.signal} derived={derived.dark} usedKey="signal" onChange={(hex) => setDark('signal', hex)} />
            <ColorRow name="carbon-paper" label={t('shell.ws.look.carbonPaper')} hint={t('shell.ws.look.paperHint')} value={draft.dark.paper} swatches={SWATCHES.carbonPaper} derived={derived.dark} usedKey="paper" onChange={(hex) => setDark('paper', hex)} />
            <ColorRow name="carbon-ink" label={t('shell.ws.look.carbonInk')} hint={t('shell.ws.look.inkHint')} value={draft.dark.ink} swatches={SWATCHES.carbonInk} derived={derived.dark} usedKey="ink" onChange={(hex) => setDark('ink', hex)} />
          </div>
        )}

        <SubHead label={t('shell.ws.look.contrast')} />
        <ContrastGrid mode="paper" d={derived.light} />
        <ContrastGrid mode="carbon" d={derived.dark} />
        <p className="st-field__hint look-contrast-hint">{t('shell.ws.look.c.hint')}</p>

        <SubHead label={t('shell.ws.look.type')} />
        <Field label={t('shell.ws.look.font.ui')} hint={t('shell.ws.look.font.uiHint')}>
          <div className="seg look-seg" role="radiogroup" onKeyDown={(e) => onRovingKey(e)} data-testid="look-font-ui">
            {LOOK_UI_FONTS.map((id) => (
              <SegButton key={id} checked={draft.fonts.ui === id} onClick={() => setFonts({ ui: id as LookUiFont })} style={{ fontFamily: UI_FONT_STACKS[id] }} testId={`look-ui-${id}`}>
                {t(`shell.ws.look.font.${id}`)}
              </SegButton>
            ))}
          </div>
        </Field>
        {draft.fonts.ui !== 'archivo' && <p className="st-field__hint look-font-note">{t('shell.ws.look.font.systemNote')}</p>}
        <Field label={t('shell.ws.look.font.text')} hint={t('shell.ws.look.font.textHint')}>
          <div className="seg look-seg" role="radiogroup" onKeyDown={(e) => onRovingKey(e)} data-testid="look-font-text">
            {LOOK_TEXT_FONTS.map((id) => (
              <SegButton key={id} checked={draft.fonts.text === id} onClick={() => setFonts({ text: id as LookTextFont })} style={{ fontFamily: TEXT_FONT_STACKS[id] ?? UI_FONT_STACKS[draft.fonts.ui] }} testId={`look-text-${id}`}>
                {t(`shell.ws.look.text.${id}`)}
              </SegButton>
            ))}
          </div>
        </Field>
        <Field label={t('shell.ws.look.font.headings')} hint={t('shell.ws.look.font.headingsHint')}>
          <div className="look-heads" role="radiogroup" onKeyDown={(e) => onRovingKey(e)} data-testid="look-headings">
            {LOOK_HEADINGS.map((id) => {
              const sp = HEADING_SPECIMENS[id]
              const checked = draft.fonts.headings === id
              const style: CSSProperties = {
                fontFamily: sp.family ?? UI_FONT_STACKS[draft.fonts.ui],
                fontStretch: sp.stretch,
                fontVariationSettings: `'wdth' ${sp.wdth}`,
                fontWeight: sp.weight,
                letterSpacing: sp.tracking,
              }
              return (
                <button key={id} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} className="look-head-opt" data-testid={`look-head-${id}`} onClick={() => setFonts({ headings: id as LookHeadings })}>
                  <span className="look-head-opt__ag" style={style} aria-hidden>
                    Ag
                  </span>
                  <span className="look-head-opt__name">{t(`shell.ws.look.h.${id}`)}</span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label={t('shell.ws.look.corners')} hint={t('shell.ws.look.cornersHint')}>
          <div className="seg look-seg" role="radiogroup" onKeyDown={(e) => onRovingKey(e)} data-testid="look-corners">
            {LOOK_CORNERS.map((id) => (
              <SegButton key={id} checked={draft.corners === id} onClick={() => set({ corners: id as LookCorners })} testId={`look-corners-${id}`}>
                {t(`shell.ws.look.corners.${id}`)}
                <span className="seg__code">{id === 'square' ? '0 · 0 · 2' : '2 · 4 · 8'}</span>
              </SegButton>
            ))}
          </div>
        </Field>

        <SubHead label={t('shell.ws.look.preview')} />
        <div className="look-plates" data-testid="look-preview" aria-hidden="true" inert>
          <PreviewPlate mode="light" draft={draft} d={derived.light} />
          <PreviewPlate mode="dark" draft={draft} d={derived.dark} />
        </div>
      </fieldset>

      <SubHead label={t('shell.ws.look.device')} />
      <StandardHereField scope={scope} />

      {dirty && canEdit && (
        <div className="look-bar" data-testid="look-bar">
          <span className="look-bar__state">
            <Led state="on" />
            <span className="label look-bar__text">{t('shell.ws.look.unsaved')}</span>
          </span>
          <span className="look-bar__gap" />
          <button type="button" className="btn btn--ghost" data-testid="look-discard" onClick={discard}>
            {t('shell.ws.look.discard')}
          </button>
          <button type="button" className="btn btn--primary" data-testid="look-save" onClick={save}>
            {t(inCloud ? 'shell.ws.look.saveTeam' : 'shell.ws.look.save')}
          </button>
        </div>
      )}
    </div>
  )
}

/** "Use the standard look on this device" — per device, also in Settings → Appearance; viewers too. */
export function StandardHereField({ scope }: { scope: string }) {
  const t = useT()
  const on = useStandardHere(scope)
  return (
    <div data-testid="look-standard-here">
      <Field label={t('shell.ws.look.standardHere')} hint={t('shell.ws.look.standardHereHint')} inline>
        <Switch seed="standardHere" checked={on} onChange={(v) => setStandardHere(scope, v)} label={t('shell.ws.look.standardHere')} />
      </Field>
    </div>
  )
}

/** The signal sits too close to the ink to stand out (OKLab distance < 0.08). */
function near(a: string, b: string): boolean {
  const x = toOklab(a)
  const y = toOklab(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 0.08
}

function SegButton({ checked, onClick, children, style, testId }: { checked: boolean; onClick: () => void; children: ReactNode; style?: CSSProperties; testId?: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} className="seg__btn" style={style} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ colours */

function ColorRow({
  name,
  label,
  hint,
  value,
  swatches,
  derived,
  onChange,
  warn,
  usedKey,
}: {
  name: string
  label: string
  hint: string
  value: string
  swatches: Swatch[]
  derived: Derived
  onChange: (hex: string) => void
  warn?: string | null
  usedKey?: keyof LookColors
}) {
  const t = useT()
  const uid = useId()
  const hexId = `${uid}-hex`
  const hintId = `${uid}-hint`
  const badId = `${uid}-bad`
  const [text, setText] = useState(value)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(value)
    setBad(false)
  }, [value])
  const key = usedKey ?? (name as keyof LookColors)
  const used = derived.report.used[key]
  const adjusted = key === 'paper' ? derived.report.adjusted.paper : key === 'ink' ? derived.report.adjusted.ink : derived.report.adjusted.signal
  const checkedIndex = swatches.findIndex((s) => s.hex === value)
  const commitText = () => {
    const hex = normalizeHex(text)
    if (!hex) {
      setBad(text.trim() !== '' && text.trim() !== value)
      if (!text.trim()) setText(value)
      return
    }
    setBad(false)
    setText(hex)
    if (hex !== value) onChange(hex)
  }
  const onHexKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitText()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setText(value)
      setBad(false)
    }
  }
  return (
    <div className="st-field look-field" data-testid={`look-${name}`}>
      <div className="st-field__text">
        <label className="st-field__label" htmlFor={hexId}>
          {label}
        </label>
        <div className="st-field__hint" id={hintId}>
          {hint}
        </div>
      </div>
      <div className="look-colors">
        <div className="look-swatches" role="radiogroup" aria-label={label} aria-describedby={hintId} onKeyDown={(e) => onRovingKey(e)}>
          {swatches.map((s, i) => {
            const checked = i === checkedIndex
            const sw = t(`shell.ws.look.sw.${s.id}`)
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked || (checkedIndex < 0 && i === 0) ? 0 : -1}
                className="look-chip"
                style={{ ['--chip' as string]: s.hex }}
                aria-label={t('shell.ws.look.swatch', { name: sw, hex: s.hex })}
                title={`${sw} · ${s.hex}`}
                data-hex={s.hex}
                onClick={() => onChange(s.hex)}
              />
            )
          })}
        </div>
        <span className="look-custom">
          <span className="look-picker" style={{ ['--chip' as string]: value }}>
            <input type="color" value={value} aria-label={t('shell.ws.look.pick', { name: label })} onChange={(e) => onChange(normalizeHex(e.target.value) ?? value)} />
          </span>
          <input
            id={hexId}
            className="input look-hex"
            value={text}
            maxLength={9}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('shell.ws.look.hex', { name: label })}
            aria-invalid={bad || undefined}
            aria-describedby={bad ? badId : hintId}
            onChange={(e) => {
              setText(e.target.value)
              if (bad) setBad(false)
            }}
            onBlur={commitText}
            onKeyDown={onHexKey}
          />
        </span>
        {bad && (
          <p className="look-bad" id={badId} role="alert">
            {t('shell.ws.look.hexBad')}
          </p>
        )}
        <p className="label look-used" data-testid={`look-used-${name}`}>
          <span className="look-used__chip" style={{ ['--chip' as string]: used }} aria-hidden />
          {t('shell.ws.look.used', { hex: used.toUpperCase() })}
          {adjusted && (
            <span className="look-used__adj">
              <Led state="on" />
              {t(key === 'paper' ? 'shell.ws.look.calmed' : 'shell.ws.look.adjusted')}
            </span>
          )}
        </p>
        {warn && <p className="look-warn">{warn}</p>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ contrast */

function ContrastGrid({ mode, d }: { mode: 'paper' | 'carbon'; d: Derived }) {
  const t = useT()
  const lang = useLang()
  const r = d.report.ratios
  const fmt = (n: number) => t('shell.ws.look.c.ratio', { n: n.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
  return (
    <div className="look-contrast">
      <span className="label look-contrast__mode">{t(`shell.ws.look.mode.${mode}`)}</span>
      <Spec
        testId={`look-contrast-${mode === 'paper' ? 'light' : 'dark'}`}
        items={[
          { label: t('shell.ws.look.c.text'), value: fmt(r.text) },
          { label: t('shell.ws.look.c.quiet'), value: fmt(r.quiet) },
          { label: t('shell.ws.look.c.signal'), value: fmt(r.signal) },
          { label: t('shell.ws.look.c.onSignal'), value: fmt(r.onSignal) },
          { label: t('shell.ws.look.c.signalText'), value: fmt(r.signalText) },
        ]}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ previews */

/** Every token of a theme on an element (tokens.css as shipped + the look's derived colours). */
function themeVars(mode: 'light' | 'dark', d: Derived): CSSProperties {
  const out: Record<string, string> = { ...stockTokenTable(mode) }
  for (const [k, v] of Object.entries(d.tokens)) out[`--${k}`] = v
  out.colorScheme = mode
  return out as CSSProperties
}

function fontVars(draft: WorkspaceLook): CSSProperties {
  const sp = HEADING_SPECIMENS[draft.fonts.headings]
  const ui = UI_FONT_STACKS[draft.fonts.ui]
  return {
    ['--font-sans' as string]: ui,
    ['--font-doc' as string]: TEXT_FONT_STACKS[draft.fonts.text] ?? ui,
    ['--font-head' as string]: sp.family ?? ui,
    ['--head-stretch' as string]: sp.stretch,
    ['--head-wdth' as string]: String(sp.wdth),
    ['--head-tracking' as string]: sp.tracking,
    ['--head-word-spacing' as string]: headWordSpacing(draft.fonts.headings, draft.fonts.ui),
    ['--head-weight' as string]: String(sp.weight),
    ...(draft.corners === 'square' ? { ['--radius-1' as string]: '0px', ['--radius-2' as string]: '0px', ['--radius-3' as string]: '2px' } : {}),
  }
}

/** A small instrument per preset: Paper | Carbon halves in its colours, a heading "Aa", ink bars, a key and an LED. */
function PresetMini({ id }: { id: LookPresetId }) {
  const p = LOOK_PRESETS[id]
  const d = useMemo(() => deriveLook(p), [p])
  const sp = HEADING_SPECIMENS[p.fonts.headings]
  const head: CSSProperties = { fontFamily: sp.family ?? UI_FONT_STACKS[p.fonts.ui], fontStretch: sp.stretch, fontVariationSettings: `'wdth' ${sp.wdth}`, fontWeight: sp.weight }
  return (
    <span className="look-mini" aria-hidden data-square={p.corners === 'square' || undefined}>
      {(['light', 'dark'] as const).map((m) => (
        <span key={m} className="look-mini__half" style={themeVars(m, d[m])}>
          <span className="look-mini__side" />
          <span className="look-mini__main">
            <span className="look-mini__aa" style={head}>
              Aa
            </span>
            <span className="look-mini__bar" />
            <span className="look-mini__bar look-mini__bar--short" />
            <span className="look-mini__foot">
              <span className="look-mini__key" />
              <span className="led led--on" />
            </span>
          </span>
        </span>
      ))}
    </span>
  )
}

function PreviewPlate({ mode, draft, d }: { mode: 'light' | 'dark'; draft: WorkspaceLook; d: Derived }) {
  const t = useT()
  const style = { ...themeVars(mode, d), ...fontVars(draft) }
  return (
    <div className="look-plate" data-mode={mode} style={style}>
      <div className="look-plate__side">
        <span>{t('shell.ws.look.pv.side1')}</span>
        <span data-active>{t('shell.ws.look.pv.side2')}</span>
        <span>{t('shell.ws.look.pv.side3')}</span>
      </div>
      <div className="look-plate__main">
        <span className="label look-plate__code">{t(`shell.ws.look.mode.${mode === 'light' ? 'paper' : 'carbon'}`)}</span>
        <span className="look-plate__title">{t('shell.ws.look.pv.title')}</span>
        <p className="look-plate__text">
          {t('shell.ws.look.pv.body')} <span className="look-plate__link">{t('shell.ws.look.pv.link')}</span> · <mark>{t('shell.ws.look.pv.mark')}</mark>
        </p>
        <div className="look-plate__row">
          <span className="btn btn--sm btn--primary">{t('shell.ws.look.pv.key')}</span>
          <span className="btn btn--sm">{t('shell.ws.look.pv.ghost')}</span>
          <span className="look-plate__focus">{t('shell.ws.look.pv.link')}</span>
        </div>
        <div className="look-plate__row">
          <SwitchFace checked seed={`preview-${mode}`} />
          <span className="label">{t('shell.ws.look.pv.switch')}</span>
          <span className="led led--on" />
          <span className="led led--ok" />
        </div>
      </div>
    </div>
  )
}
