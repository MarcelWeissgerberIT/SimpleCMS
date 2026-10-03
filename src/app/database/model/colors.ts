/**
 * Conditional colours: a view's ordered rules (filter + colour + target), first match wins.
 */
import type { CSSProperties } from 'react'
import type { ColorName, ColorRule, Database, ID, Page, PropertyDef, View } from '../../store/types'
import { countFilters, testGroup } from './query'
import type { Resolver } from './resolve'

/** Rules that can match: at least one condition on an existing property. */
export function activeRules(view: View, props: Map<ID, PropertyDef>): ColorRule[] {
  return (view.colorRules ?? []).filter((r) => r.color !== 'default' && countFilters(r.filter, props) > 0)
}

/** A per-render lookup: row → the first rule it matches (cached per row id). */
export function ruleMatcher(r: Resolver, db: Database, rules: ColorRule[], props: Map<ID, PropertyDef>): (row: Page) => ColorRule | null {
  if (!rules.length) return () => null
  const cache = new Map<ID, ColorRule | null>()
  return (row) => {
    let hit = cache.get(row.id)
    if (hit === undefined) {
      hit = rules.find((rule) => testGroup(r, db, rule.filter, row, props)) ?? null
      cache.set(row.id, hit)
    }
    return hit
  }
}

/** CSS custom properties carrying a rule's colour (consumed by `.db-rc[data-rc=…]` styles). */
export function ruleStyle(color: ColorName): CSSProperties {
  return { ['--rc-text' as string]: `var(--c-${color}-text)`, ['--rc-bg' as string]: `var(--c-${color}-bg)` }
}

/** Attributes for a coloured row / card element. */
export function ruleAttrs(rule: ColorRule | null): { 'data-rc'?: ColorRule['target']; 'data-rc-color'?: ColorName; style?: CSSProperties } {
  return rule ? { 'data-rc': rule.target, 'data-rc-color': rule.color, style: ruleStyle(rule.color) } : {}
}

export const RULE_COLORS: ColorName[] = ['green', 'red', 'yellow', 'blue', 'purple', 'pink', 'orange', 'brown', 'gray']
