/**
 * Menu entries that open the sub-items / dependencies / colour rules panels
 * (shared by the toolbar "…" menu and the view tab menu).
 */
import type { ReactNode } from 'react'
import type { MenuEntry } from '../../ui/Menu'
import type { Translate } from '@/shared/i18n'
import type { DbModel } from '../hooks'
import { dependenciesOf, subItemsOf } from '../model/hierarchy'
import { activeRules } from '../model/colors'

export type StructurePanel = 'sub' | 'dep' | 'rc'

export function structureEntries(t: Translate, m: DbModel, open: (kind: StructurePanel) => void, icons: Record<StructurePanel, ReactNode>): MenuEntry[] {
  const onOff = (on: boolean) => (on ? t('database.struct.on') : t('database.struct.off'))
  const rules = activeRules(m.view, m.propMap).length
  if (m.view.type === 'form') return []
  const paints = m.view.type !== 'chart'
  return [
    { kind: 'separator' },
    { label: t('database.sub.title'), icon: icons.sub, hint: onOff(!!subItemsOf(m.db)), keepOpen: true, keywords: 'sub-items subitems unterelemente nested', onSelect: () => open('sub') },
    { label: t('database.dep.title'), icon: icons.dep, hint: onOff(!!dependenciesOf(m.db)), keepOpen: true, keywords: 'dependencies blocked abhängigkeiten', onSelect: () => open('dep') },
    ...(paints ? [{ label: t('database.rc.menu'), icon: icons.rc, hint: rules ? String(rules) : undefined, keepOpen: true, keywords: 'colour color conditional farbe', onSelect: () => open('rc') }] : []),
  ]
}
