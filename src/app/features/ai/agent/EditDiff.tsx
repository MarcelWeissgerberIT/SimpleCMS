/**
 * The review of an edit of existing content (edit_page): the page as a word-level diff — removed words
 * struck through on a red tint, new ones on the signal tint, unchanged blocks folded. A pending edit is
 * shown against the page as it is now (it follows the person's typing); one that changed since it was
 * staged says it will be skipped. Applied / discarded edits show what they did to their blocks.
 * Shared by the AI terminal and the custom agents' run history.
 */
import { useMemo } from 'react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { DocDiff } from '../../history/DiffDoc'
import { itemsWordCounts } from '../../history/docDiff'
import { previewEdit, stagedItems, type EditPreview } from './edit'
import type { StagedChange } from './types'

export function EditDiff({ change: c }: { change: StagedChange }) {
  const t = useT()
  const content = useWorkspace((s) => s.pages[c.pageId]?.content)
  const open = c.status === 'pending' || c.status === 'failed'
  const preview: EditPreview = useMemo(
    () => (open ? previewEdit(c) : { state: 'ready', items: stagedItems(c) }),
    // the page's content: a pending edit follows it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, open, content],
  )
  const counts = useMemo(() => itemsWordCounts(preview.items), [preview.items])
  return (
    <div className="agent-edit" data-state={preview.state} data-testid="edit-diff">
      <div className="agent-edit__meta">
        <span className="agent-edit__op">{t(`features.agent.edit.op.${c.edit?.op ?? 'replace'}`)}</span>
        <span className="agent-edit__refs">{c.edit?.op === 'replace_all' ? t('features.agent.edit.wholePage') : c.edit?.refs}</span>
        <span className="agent-spacer" />
        {counts.del > 0 && <span className="agent-edit__count" data-kind="del">−{t('features.agent.edit.words', { count: counts.del })}</span>}
        {counts.add > 0 && <span className="agent-edit__count" data-kind="add">+{t('features.agent.edit.words', { count: counts.add })}</span>}
      </div>
      {open && preview.state !== 'ready' && <p className="agent-edit__note">{t(preview.state === 'gone' ? 'features.agent.edit.goneNote' : 'features.agent.edit.changedNote')}</p>}
      <DocDiff items={preview.items} context={1} variant="plain" label={t('features.agent.edit.diff')} />
    </div>
  )
}
