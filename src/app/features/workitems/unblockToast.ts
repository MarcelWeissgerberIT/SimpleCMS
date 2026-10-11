/** The unblock toast (unblock.ts says who a finish frees). */
import { openPage } from '../../lib/router'
import { t } from '../../i18n'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import type { ItemEntry } from './itemIndex'

const untitled = () => t('features.workItems.untitled')

/** The toast for tasks a person's finish freed (none: nothing). Open → the first one's page at its block. */
export function toastUnblocked(entries: readonly ItemEntry[]): void {
  if (!entries.length) return
  const first = entries[0]
  let message: string
  if (entries.length === 1) {
    const who = first.attrs.people.map((id) => useWorkspace.getState().people.find((p) => p.id === id)?.name).find((n) => !!n)
    message = who ? t('features.workItems.unblocked.oneWho', { title: first.title || untitled(), name: who }) : t('features.workItems.unblocked.one', { title: first.title || untitled() })
  } else {
    const shown = entries.slice(0, 2).map((e) => e.title || untitled())
    const rest = entries.length - shown.length
    const titles = rest > 0 ? `${shown.join(', ')} ${t('features.workItems.unblocked.more', { n: rest })}` : shown.join(', ')
    message = t('features.workItems.unblocked.many', { n: entries.length, titles })
  }
  useUI.getState().toast({
    message,
    kind: 'success',
    action: { label: t('features.workItems.unblocked.open'), run: () => openPage(first.pageId, first.blockId ?? undefined) },
  })
}
