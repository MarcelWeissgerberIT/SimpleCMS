/**
 * The setup band (plan §3.7, mock-2) — the visit where a profile was dropped or "Set up in the Patchbay" was pressed
 * (§6 U3; later visits get the one-line strip, SetupStrip.tsx). On the rack (Rack.tsx draws the band's grid):
 *  - the band's tab "PROFILE DROPPED · tracker-cnsx.integration.json · IN-01" and, on its right edge, "Ctrl+Z Undo" —
 *    only until the first lamp write (§6 U4), then "Close setup" (the profile stays; Integrations removes it);
 *  - inside, the profile's modules (real ones as they are, ghosts dotted with their lamps' step chips, planned cables
 *    dotted), then § 00 "SET UP · 7 LAMPS · IN THIS ORDER" (Lamps.tsx) with the recipe tabs when the profile has two or
 *    more recipes, and the foot: "A dark lamp says in one sentence what is missing. ↵ opens exactly that step." and the
 *    ghost key "What does 04 create?" (a popover: the recipe's fields and views, read from the recipe — nothing made).
 * Below the band the rack folds what the profile does not touch (Rack.tsx); the phone shows the lamps as a vertical
 * row (SetupCard). Orange stays a fuse's: the band is ink — the next lamp's key is the page's one primary key.
 */
import { useMemo, useRef, useState } from 'react'
import { Eye, FileJson, FileText, X } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { localized } from '../../../store/integrations'
import { Popover } from '../../../ui/Popover'
import { shortcutLabel } from '../../../ui/controls'
import { useLang } from '../../../i18n'
import { focusLost, restoreFocus } from '../../../ui/focus'
import type { Translate } from '@/shared/i18n'
import { resolveRecipe } from '../../agents'
import type { LampSet } from '../setup/lamps'
import type { RecipeSetup } from '../setup/lamps'
import { lampNo } from '../setup/keys'
import { Lamps, useVertical } from './Lamps'

const P = 'features.patchbay'

export interface BandInfo {
  profileId: string
  profileName: string
  /** the drop's file (none: "Set up in the Patchbay") */
  file?: string
  /** the drop's Undo is still offered (null: no drop in this visit) */
  undo: { open: boolean; team: boolean; replaced: string | null } | null
}

/** The band's tab and its key on the right edge (Undo until the first lamp write, then "Close setup"). */
export function BandHead({ t, info, onUndo, onClose }: { t: Translate; info: BandInfo; onUndo: () => void; onClose: () => void }) {
  const canUndo = !!info.undo?.open
  return (
    <>
      <span className="pb-band__tab" data-testid="pb-band-tab">
        <FileJson size={12} strokeWidth={1.8} aria-hidden="true" />
        <span>{t(info.file ? `${P}.band.dropped` : `${P}.band.setUp`)}</span>
        <span className="pb-band__tabdim">
          {info.file ?? info.profileName} · {info.profileId.toUpperCase()}
        </span>
      </span>
      {canUndo ? (
        <button
          type="button"
          className="pb-band__undo"
          title={[info.undo!.replaced ? t(`${P}.band.undoReplaced`, { name: info.undo!.replaced }) : t(`${P}.band.undoTitle`), info.undo!.team ? t(`${P}.band.removesForAll`) : ''].filter(Boolean).join(' — ')}
          aria-keyshortcuts="Control+Z Meta+Z"
          onClick={onUndo}
          data-testid="pb-band-undo"
        >
          <span className="kbd" aria-hidden="true">
            {shortcutLabel('Mod+Z')}
          </span>
          {t('common.undo')}
        </button>
      ) : (
        <button type="button" className="pb-band__undo" onClick={onClose} data-testid="pb-band-close">
          <X size={13} strokeWidth={1.8} aria-hidden="true" />
          {t(`${P}.setup.close`)}
        </button>
      )}
    </>
  )
}

/** The recipe tabs of a profile with two or more recipes (each its own 04–06; the readout counts the one shown). */
function RecipeTabs({ t, sets, recipes, current, onPick }: { t: Translate; sets: LampSet[]; recipes: RecipeSetup[]; current: string | null; onPick: (id: string) => void }) {
  const tabs = useRef<HTMLDivElement>(null)
  const move = (dir: number) => {
    const list = [...(tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
    const at = list.findIndex((b) => b === document.activeElement)
    const next = list[(at + dir + list.length) % list.length]
    next?.focus()
    next?.click()
  }
  return (
    <div className="pb-rtabs" role="tablist" aria-label={t(`${P}.band.recipes`)} ref={tabs} onKeyDown={(e) => (e.key === 'ArrowRight' ? (e.preventDefault(), move(1)) : e.key === 'ArrowLeft' ? (e.preventDefault(), move(-1)) : undefined)}>
      {sets.map((s) => {
        const r = recipes.find((x) => x.recipeId === s.recipe)
        const on = s.recipe === current
        return (
          <button key={s.recipe ?? '-'} type="button" role="tab" className="pb-rtab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => s.recipe && onPick(s.recipe)} data-testid="pb-recipe-tab">
            {r?.name ?? s.recipe}
            <span className="pb-rtab__n">
              {s.done}/{s.lamps.length}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** "What does 04 create?": the recipe's database (fields, views) and report page — read from the recipe, nothing made. */
function WhatPopover({ t, profileId, recipe, anchor, onClose }: { t: Translate; profileId: string; recipe: RecipeSetup; anchor: HTMLElement | null; onClose: () => void }) {
  const lang = useLang() as 'en' | 'de'
  const profile = useWorkspace((s) => (s.integrations ?? []).find((p) => p.id === profileId))
  const resolved = useMemo(() => {
    const cfg = profile?.recipes?.find((r) => (r.id ?? 'mirror') === recipe.recipeId) ?? profile?.recipes?.[0]
    return profile && cfg ? resolveRecipe(profile, cfg, lang) : null
  }, [profile, recipe.recipeId, lang])
  const typeOf = (k: string) => {
    const s = t(`database.type.${k}`)
    return s === `database.type.${k}` ? k : s
  }
  const viewOf = (k: string) => {
    const s = t(`database.view.${k}`)
    return s === `database.view.${k}` ? k : s
  }
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="top-end" className="pb-what" role="dialog" aria-label={t(`${P}.setup.what`, { n: lampNo(4) })}>
      <div className="pb-what__in" data-testid="pb-what">
        <p className="label pb-what__h">{t(`${P}.setup.what`, { n: lampNo(4) })}</p>
        <p className="pb-what__line">
          <b>{t(`${P}.setup.whatDb`, { name: recipe.database.name })}</b>
        </p>
        {resolved && (
          <>
            <p className="label pb-what__sub">
              {t(`${P}.setup.whatFields`)} · {resolved.properties.length}
            </p>
            <ul className="pb-what__list" data-testid="pb-what-fields">
              {resolved.properties.map((p) => (
                <li key={p.name}>
                  <span className="pb-what__n">{p.name}</span>
                  <span className="pb-what__t">
                    {typeOf(p.type)}
                    {p.key ? ` · ${t(`${P}.setup.whatKey`)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {resolved.views.length > 0 && (
              <>
                <p className="label pb-what__sub">
                  {t(`${P}.setup.whatViews`)} · {resolved.views.length}
                </p>
                <ul className="pb-what__list">
                  {resolved.views.map((v, i) => (
                    <li key={i}>
                      <span className="pb-what__n">{localized(v.name, lang)}</span>
                      <span className="pb-what__t">{viewOf(v.type)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <p className="pb-what__line">
          <b>{t(`${P}.setup.whatPage`, { title: recipe.report.title })}</b>
        </p>
        <p className="pb-what__foot">{t(`${P}.setup.whatWhere`, { n: lampNo(4) })}</p>
      </div>
    </Popover>
  )
}

/** § 00 — the lamps plate (inside the band; the strands view puts the same lamps in its card). */
export function SetupPlate({ t, lang, profileId, sets, set, recipes, onPick, vertical }: { t: Translate; lang: string; profileId: string; sets: LampSet[]; set: LampSet; recipes: RecipeSetup[]; onPick: (id: string) => void; vertical?: boolean }) {
  const box = useRef<HTMLElement>(null)
  const v = useVertical(box, vertical)
  const [what, setWhat] = useState<HTMLElement | null>(null)
  const recipe = recipes.find((r) => r.recipeId === set.recipe) ?? null
  // a dialog popover: Esc or a press outside closes it — the keyboard lost with it goes back to its key
  const closeWhat = () => {
    const from = what
    setWhat(null)
    requestAnimationFrame(() => {
      if (from?.isConnected && focusLost()) restoreFocus(from)
    })
  }
  return (
    <section className="pb-setup" ref={box} aria-labelledby="pb-setup-h" data-testid="pb-setup">
      <div className="pb-setup__h">
        <span className="label pb-setup__n">§ 00</span>
        <h2 className="label pb-setup__title" id="pb-setup-h">
          {t(`${P}.setup.head`, { n: set.lamps.length })}
        </h2>
        <span className="pb-colh__rule" aria-hidden="true" />
        <span className="label pb-setup__count" data-testid="pb-setup-count">
          {t(`${P}.setup.count`, { n: set.done, m: set.lamps.length })}
        </span>
        <span className="label pb-setup__each">{t(`${P}.setup.each`)}</span>
      </div>
      {sets.length > 1 && <RecipeTabs t={t} sets={sets} recipes={recipes} current={set.recipe} onPick={onPick} />}
      <Lamps set={set} profileId={profileId} t={t} lang={lang} vertical={v} />
      <div className="pb-setup__foot">
        <FileText size={15} strokeWidth={1.6} aria-hidden="true" className="pb-setup__ficon" />
        <p>{t(`${P}.setup.foot`)}</p>
        <span className="pb-setup__sp" />
        {recipe && (
          <button type="button" className="btn btn--ghost pb-setup__what" aria-haspopup="dialog" aria-expanded={!!what} onClick={(e) => setWhat(what ? null : e.currentTarget)} data-testid="pb-what-key">
            <Eye size={14} strokeWidth={1.7} aria-hidden="true" />
            {t(`${P}.setup.what`, { n: lampNo(4) })}
          </button>
        )}
      </div>
      {recipe && what && <WhatPopover t={t} profileId={profileId} recipe={recipe} anchor={what} onClose={closeWhat} />}
    </section>
  )
}

/**
 * The phone's band (plan §3.8, mock-2): the card "PROFILE DROPPED", "TRACKER-CNSX · IN-01 … 4/7 GREEN", the lamps as a
 * vertical row (the same `<ol>`), the next lamp's key full width; the band's Undo / "Close setup" in its head.
 */
export function SetupCard({ t, lang, info, sets, set, recipes, onPick, onUndo, onClose }: { t: Translate; lang: string; info: BandInfo; sets: LampSet[]; set: LampSet; recipes: RecipeSetup[]; onPick: (id: string) => void; onUndo: () => void; onClose: () => void }) {
  return (
    <section className="pb-scard" aria-labelledby="pb-scard-h" data-testid="pb-setup-card">
      <div className="pb-scard__top">
        <BandHead t={t} info={info} onUndo={onUndo} onClose={onClose} />
      </div>
      <div className="pb-scard__h">
        <h2 className="label pb-scard__id" id="pb-scard-h">
          {info.profileName} · {info.profileId.toUpperCase()}
        </h2>
        <span className="pb-scard__sp" />
        <span className="label pb-scard__count" data-testid="pb-setup-count">
          <b>
            {set.done}/{set.lamps.length}
          </b>{' '}
          {t(`${P}.setup.greenWord`)}
        </span>
      </div>
      {sets.length > 1 && <RecipeTabs t={t} sets={sets} recipes={recipes} current={set.recipe} onPick={onPick} />}
      <Lamps set={set} profileId={info.profileId} t={t} lang={lang} vertical />
    </section>
  )
}
