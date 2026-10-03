import { useUI, type ModalState } from '../../store/ui'
import { HistoryModal, ShareModal, ImportModal, ExportModal, AutomationsModal, TemplatesModal, AgentPanel } from '../../features'
import { SettingsModal } from '../settings/SettingsModal'
import { ConfirmModal } from './ConfirmModal'
import { MoveModal } from './MoveModal'
import { ShortcutsModal } from './ShortcutsModal'
import './modals.css'

/** Renders the single active modal from useUI.modal (and the workspace agent's side sheet). */
export function ModalHost() {
  const modal = useUI((s) => s.modal)
  const close = useUI((s) => s.closeModal)
  return (
    <>
      <AgentPanel />
      {modal && <ModalSwitch modal={modal} onClose={close} />}
    </>
  )
}

function ModalSwitch({ modal, onClose }: { modal: ModalState; onClose: () => void }) {
  switch (modal.type) {
    case 'settings':
      return <SettingsModal initialTab={modal.tab} onClose={onClose} />
    case 'shortcuts':
      return <ShortcutsModal onClose={onClose} />
    case 'move':
      return <MoveModal pageId={modal.pageId} onClose={onClose} />
    case 'confirm':
      return <ConfirmModal {...modal} onClose={onClose} />
    case 'history':
      return <HistoryModal pageId={modal.pageId} onClose={onClose} />
    case 'share':
      return <ShareModal pageId={modal.pageId} onClose={onClose} />
    case 'import':
      return <ImportModal onClose={onClose} />
    case 'export':
      return <ExportModal pageId={modal.pageId} onClose={onClose} />
    case 'automations':
      return <AutomationsModal databaseId={modal.databaseId} onClose={onClose} />
    case 'templates':
      return <TemplatesModal parentId={modal.parentId} onClose={onClose} />
    default:
      return null
  }
}
