/**
 * Private pages in team workspaces (docs/CLOUD.md § Private pages) — the shell side: moving a page
 * between Private and the workspace with the confirmation it needs (going public: everyone sees it)
 * and the progress / result toasts. Used by the sidebar (drag & drop, row menu) and "Move to".
 */
import { CloudError, createPrivateDatabase, createPrivatePage, movePagePrivacy } from '../../cloud'
import { t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { goToPage, requestTitleFocus } from '../lib/actions'

const titleOf = (id: ID) => useWorkspace.getState().pages[id]?.title.trim() || t('common.untitled')
const workspaceName = () => useWorkspace.getState().settings.workspaceName.trim() || 'One'

/**
 * Move `pageId` into Private (`toPrivate`) or into the workspace — at `target` (a page of that scope,
 * or its root). Asks first either way: who can see the page changes (going public: everyone sees it;
 * going private: everyone else loses it). Resolves true when the page moved.
 */
export function requestPrivacyMove(pageId: ID, toPrivate: boolean, target?: { parentId?: ID | null; index?: number }): Promise<boolean> {
  const ui = useUI.getState()
  const title = titleOf(pageId)
  const run = async () => {
    const progress = ui.toast({ message: t('shell.private.moving', { title }), timeout: 0 })
    try {
      await movePagePrivacy(pageId, toPrivate, target)
      ui.dismissToast(progress)
      ui.toast({ message: toPrivate ? t('shell.private.movedPrivate', { title }) : t('shell.private.movedShared', { title, workspace: workspaceName() }), kind: 'success' })
      return true
    } catch (e) {
      ui.dismissToast(progress)
      const code = e instanceof CloudError ? e.code : ''
      const message = code === 'offline' ? t('shell.private.offline') : code === 'busy' ? t('shell.private.busy') : t('shell.private.failed')
      ui.toast({ message, kind: 'error', timeout: 5000 })
      if (!(e instanceof CloudError)) console.error('[one] moving a page between Private and the workspace failed', e)
      return false
    }
  }
  const workspace = workspaceName()
  return new Promise((resolve) => {
    ui.openModal({
      type: 'confirm',
      title: toPrivate ? t('shell.private.confirmPrivateTitle', { title }) : t('shell.private.confirmTitle', { title, workspace }),
      body: toPrivate ? t('shell.private.confirmPrivateBody', { workspace }) : t('shell.private.confirmBody', { workspace }),
      confirmLabel: toPrivate ? t('shell.private.confirmPrivateLabel') : t('shell.private.confirmLabel'),
      onConfirm: () => void run().then(resolve),
    })
  })
}

/** A new page in my Private section, opened with its title focused. */
export function createPrivatePageAndOpen(parentId: ID | null = null): ID {
  const id = createPrivatePage({ parentId, title: '' })
  requestTitleFocus(id)
  goToPage(id)
  return id
}

export function createPrivateDatabaseAndOpen(): ID {
  const id = createPrivateDatabase({ title: '' })
  requestTitleFocus(id)
  goToPage(id)
  return id
}
