import { useUI, type ModalState } from '../../store/ui'
import { HistoryModal, ShareModal, ImportModal, ExportModal, AutomationsModal, TemplatesModal, SaveTemplateModal, AgentPanel, FunctionsModal } from '../../features'
import { SettingsModal } from '../settings/SettingsModal'
import { ConfirmModal } from './ConfirmModal'
import { MoveModal } from './MoveModal'
import { ShortcutList, ShortcutsModal } from './ShortcutsModal'
import { HelpHost } from '../../help'
import './modals.css'

/** Renders the single active modal from useUI.modal (and the side sheets: the workspace agent, Help). */
export function ModalHost() {
  const modal = useUI((s) => s.modal)
  const close = useUI((s) => s.closeModal)
  return (
    <>
      <AgentPanel />
      <HelpHost shortcuts={<ShortcutList />} />
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
      return <TemplatesModal parentId={modal.parentId} tab={modal.tab} select={modal.select} onClose={onClose} />
    case 'saveTemplate':
      return <SaveTemplateModal pageId={modal.pageId} onClose={onClose} />
    case 'functions':
      return <FunctionsModal initialId={modal.id} onClose={onClose} />
    default:
      return null
  }
}
