/**
 * "Connect to …" (plan §1.13, §3.9; P4, B16): the picker a click or tap on a jack opens, and J on a jack — while the
 * Patching switch is on. A cmdk list in a Popover anchored at the jack, in groups:
 *   Connect to / Connect from — the other ends the matrix allows (patchPick.ts choicesOf: modules on the rack and folded,
 *     § 01 net flags, a database's commands, a row event nobody listens to yet);
 *   Lock a tool (OUT) — a server's WRITE? tools, per profile that matches the server (owners / admins);
 *   Unplug — every cable at the jack (and a locked tool's unlock on the OUT jack).
 * Each choice is planned while the list shows (a few per frame — the first rows first): a refused one stays listed,
 * `aria-disabled`, with its reason ("Ways out are made in their editor.", "Only owners and admins lock a tool: …");
 * one that would open a fuse says "opens F2", one that asks first says so. ↵ / a click on a choice closes the picker and
 * patches (patchRun.ts pickChoice — planned again, asked at the target jack where it asks). Esc closes; the keyboard
 * goes back to the jack (the page does that).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { Popover } from '../../../ui/Popover'
import { planOn, planRefused } from '../patching'
import { choicesOf, jackOf, type Choice, type ChoiceGroup } from '../patchPick'
import type { Model, ModelInput, PatchPlan } from '../types'
import type { PlateWords } from './plateParts'
import { endJack, endKind, endName } from './patchRun'
import { pickerFilter } from './JackPicker'

const P = 'features.patchbay'
const GROUPS: ChoiceGroup[] = ['to', 'from', 'lock', 'unplug']
/** Planning budget per frame (ms): the list stays responsive while every choice is checked. */
const SLICE_MS = 8

interface Row {
  c: Choice
  name: string
  kind: string
  jack: string
}

export function ConnectPicker({ anchor, jack, only, model, input, pw, onPick, onClose }: { anchor: HTMLElement; jack: string; only?: 'unplug'; model: Model; input: ModelInput; pw: PlateWords; onPick: (c: Choice) => void; onClose: (why: 'escape' | 'outside') => void }) {
  const w = pw.w
  const t = w.t
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const j = jackOf(model, jack)
  const mod = j ? model.modules.find((m) => m.key === j.module) : undefined
  // the choices are taken when the picker opens (a rebuild under it keeps the rows; each is planned again when picked)
  const [rows] = useState<Row[]>(() =>
    j
      ? choicesOf(j, model, input)
          .filter((c) => !only || c.group === only)
          .map((c) => ({ c, name: endName(c.other, model, input, w), kind: endKind(c.other, model, w), jack: c.tool ?? endJack(c.other, model, w) }))
      : [],
  )
  const [plans, setPlans] = useState<Record<string, PatchPlan>>({})

  // plan every choice, a slice per frame
  useEffect(() => {
    let i = 0
    let frame = 0
    const found: Record<string, PatchPlan> = {}
    const step = () => {
      const start = performance.now()
      while (i < rows.length && performance.now() - start < SLICE_MS) {
        const r = rows[i++]
        try {
          found[r.c.id] = planOn(r.c.patch)
        } catch {
          /* not plannable: picked, it says why */
        }
      }
      setPlans({ ...found })
      if (i < rows.length) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [rows])

  // Esc closes the picker only (the page's Esc would clear the selection) — taken before the popover's own listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current('escape')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const byId = useMemo(() => new Map(rows.map((r) => [r.c.id, r])), [rows])
  const head = j && mod ? `${w.name(mod)} · ${endJack({ module: j.module, role: j.role }, model, w)}` : ''
  const title = only === 'unplug' ? t(`${P}.patch.group.unplug`) : t(`${P}.patch.connect.title`)
  return (
    <Popover open anchor={anchor} onClose={() => closeRef.current('outside')} placement="bottom-start" className="pb-pick-pop pb-conn-pop" aria-label={title}>
      <Command label={title} loop filter={pickerFilter} className="pb-pick pb-conn" data-testid="pb-connect">
        <div className="pb-conn__head">
          <span className="label">{title}</span>
          <span className="pb-conn__jack">{head}</span>
        </div>
        <Command.Input className="pb-pick__input" placeholder={t(`${P}.patch.connect.search`)} data-autofocus="" />
        <Command.List className="pb-pick__list">
          <Command.Empty className="pb-pick__empty">{t(`${P}.patch.connect.empty`)}</Command.Empty>
          {GROUPS.map((g) => {
            const list = rows.filter((r) => r.c.group === g)
            if (!list.length) return null
            return (
              <Command.Group key={g} heading={t(`${P}.patch.group.${g}`)} className="pb-conn__group">
                {list.map((r) => {
                  const plan = plans[r.c.id]
                  const no = plan && planRefused(plan) ? plan : null
                  const opens = plan && !planRefused(plan) ? (plan.opens ?? []) : []
                  const asks = plan && !planRefused(plan) && !!plan.asks?.length
                  const label = r.c.group === 'unplug' && r.c.tool !== undefined ? t(`${P}.patch.row.unlock`, { tool: r.c.tool }) : r.jack
                  return (
                    <Command.Item
                      key={r.c.id}
                      value={r.c.id}
                      keywords={[r.name, r.kind, r.jack, ...(r.c.tool ? [r.c.tool] : [])]}
                      disabled={!!no}
                      className="pb-pick__row pb-conn__row"
                      data-choice={r.c.id}
                      data-group={g}
                      data-state={!plan ? 'reading' : no ? (no.info ? 'info' : 'refused') : opens.length ? 'opens' : asks ? 'asks' : 'ok'}
                      onSelect={(v) => {
                        const row = byId.get(v) ?? r
                        const p = plans[row.c.id]
                        if (p && planRefused(p)) return
                        onPick(row.c)
                      }}
                    >
                      <span className="pb-pick__k label">{r.kind}</span>
                      {r.c.tool !== undefined ? (
                        // a server tool: the tool's own name (never upper-cased) → the profile's Outbox
                        <span className="pb-pick__n" title={r.c.group === 'unplug' ? label : undefined}>
                          <code className="pb-conn__tool">{r.c.tool}</code> → {r.name}
                        </span>
                      ) : (
                        <span className="pb-pick__n">
                          {r.name} · <b>{label}</b>
                        </span>
                      )}
                      <span className="pb-conn__st">
                        {!plan ? (
                          <span className="pb-conn__reading">{t(`${P}.patch.connect.reading`)}</span>
                        ) : no ? (
                          <span className="pb-conn__why" data-testid="pb-connect-why">
                            {pw.say(no.refused)}
                          </span>
                        ) : opens.length ? (
                          <span className="pb-tag pb-tag--f" title={t(`${P}.patch.row.opens`, { f: opens.map((o) => o.label).join(' · ') })}>
                            {`+${opens.map((o) => o.label).join(' +')}`}
                          </span>
                        ) : asks ? (
                          <span className="pb-conn__asks label">{t(`${P}.patch.row.asks`)}</span>
                        ) : null}
                      </span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )
          })}
        </Command.List>
      </Command>
    </Popover>
  )
}
