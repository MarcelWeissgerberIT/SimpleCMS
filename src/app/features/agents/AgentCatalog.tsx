/** Starter catalog shared by the Agents page and New agent dialog. Picking only opens an unsaved draft. */
import { useMemo, useState } from 'react'
import type { AgentCategory } from '../../store/types'
import { AGENT_CATEGORIES } from '../../store/agents'
import { localized } from '../../store/integrations'
import { useLang, useT } from '../../i18n'
import { PageIcon } from '../../ui/PageIcon'
import { RECIPES, type RecipeId } from './recipes'
import type { RecipeSource } from './MirrorSetup'
import { useRecipeSources } from './integrations/status'

export type RecipePick = RecipeId | RecipeSource
export type CategoryFilter = AgentCategory | 'all'
const matches = (text: string, query: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())

/** Native search and select controls keep the full catalog usable on narrow screens and with a keyboard. */
export function AgentFilters({ query, category, counts, onQuery, onCategory, saved = false }: {
  query: string
  category: CategoryFilter
  counts: Record<CategoryFilter, number>
  onQuery: (query: string) => void
  onCategory: (category: CategoryFilter) => void
  saved?: boolean
}) {
  const t = useT()
  return (
    <div className="agx-filters">
      <input className="input" type="search" aria-label={t(`features.agents.catalog.${saved ? 'searchSaved' : 'search'}`)} placeholder={t('features.agents.catalog.searchPh')} value={query} onChange={(e) => onQuery(e.target.value)} />
      <select className="input" aria-label={t('features.agents.category.label')} value={category} onChange={(e) => onCategory(e.target.value as CategoryFilter)}>
        {(['all', ...AGENT_CATEGORIES] as const).map((c) => <option key={c} value={c}>{t(`features.agents.category.${c}`)} ({counts[c]})</option>)}
      </select>
    </div>
  )
}

export function categoryCounts(categories: AgentCategory[]): Record<CategoryFilter, number> {
  return Object.fromEntries([['all', categories.length], ...AGENT_CATEGORIES.map((c) => [c, categories.filter((v) => v === c).length])]) as Record<CategoryFilter, number>
}

export const matchesAgentText = matches

export function AgentCatalog({ onPick }: { onPick: (id: RecipePick) => void }) {
  const t = useT()
  const lang = useLang()
  const sources = useRecipeSources()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const entries = useMemo(() => [
    ...sources.flatMap(({ profile, servers }) => (profile.recipes ?? []).map((recipe) => ({
      id: `${profile.id}:${recipe.id}`,
      pick: { profile, recipe, servers } as RecipePick,
      category: 'integrations' as AgentCategory,
      name: localized(recipe.name, lang) || t('features.agents.recipe.mirror.name'),
      description: localized(recipe.description, lang) || t('features.agents.recipe.mirror.desc'),
      icon: { type: 'lucide' as const, value: recipe.icon ?? 'Layers', color: recipe.color ?? 'brown' as const },
      code: profile.name,
      needs: t('features.agents.catalog.needs.mcp'),
      from: t('features.integrations.recipeFrom', { name: profile.name }),
    }))),
    ...RECIPES.map((r) => ({
      ...r,
      pick: r.id as RecipePick,
      name: t(`features.agents.recipe.${r.id}.name`),
      description: t(`features.agents.recipe.${r.id}.desc`),
      needs: r.needs ? t(`features.agents.catalog.needs.${r.needs}`) : '',
      from: '',
    })),
  ], [sources, lang, t])
  const found = entries.filter((e) => (category === 'all' || e.category === category) && matches(`${e.name} ${e.description} ${e.code} ${t(`features.agents.category.${e.category}`)}`, query))
  return (
    <div className="agx-catalog" data-testid="agx-catalog">
      <p className="agx-note">{t('features.agents.catalog.lead')}</p>
      <AgentFilters query={query} category={category} counts={categoryCounts(entries.map((e) => e.category))} onQuery={setQuery} onCategory={setCategory} />
      {!found.length && (
        <p className="agx-note" role="status">
          {t('features.agents.catalog.none')}{' '}
          <button type="button" className="agx-link" onClick={() => { setQuery(''); setCategory('all') }}>{t('features.agents.catalog.clear')}</button>
        </p>
      )}
      {AGENT_CATEGORIES.map((c) => {
        const group = found.filter((e) => e.category === c)
        if (!group.length) return null
        return (
          <section key={c} className="agx-catalog__group" aria-label={t(`features.agents.category.${c}`)}>
            <h3 className="label agx-catalog__heading">{t(`features.agents.category.${c}`)} <span className="mono">{String(group.length).padStart(2, '0')}</span></h3>
            <ul className="agx-recipes">
              {group.map((r) => (
                <li key={r.id}>
                  <button type="button" className={`agx-recipe${r.from ? ' agx-recipe--int' : ''}`} onClick={() => onPick(r.pick)} data-recipe={r.id}>
                    <span className="agx-recipe__icon"><PageIcon icon={r.icon} size={22} /></span>
                    <span className="agx-recipe__text">
                      <span className="agx-recipe__name">{r.name}</span>
                      <span className="agx-recipe__desc">{r.description}</span>
                      {r.needs && <span className="agx-recipe__needs">{r.needs}</span>}
                    </span>
                    <span className="agx-recipe__code label" title={r.from || undefined}>
                      {r.from && <span className="led led--ok" aria-hidden />}
                      <span className={r.from ? 'agx-recipe__from' : undefined}>{r.code}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className="agx-note agx-catalog__hint">{t('features.agents.catalog.codingHint')}</p>
    </div>
  )
}
