import { isTestAccess } from '../../cloud/testScope'
import { useLang } from '../../i18n'
import { Modal } from '../../ui/Modal'
import { useUI, type ModalState } from '../../store/ui'
import { HistoryModal, ShareModal, ImportModal, ExportModal, AutomationsModal, TemplatesModal, SaveTemplateModal, AgentPanel, FunctionsModal, RecorderHost } from '../../features'
import { ExampleDialog, CommandsEditor, AISetupModal, AgentDialogsHost, OrderNoteModal } from '../../features'
import { Suspense } from 'react'
import { SettingsModal } from '../settings/SettingsModal'
import { ConfirmModal } from './ConfirmModal'
import { MoveModal } from './MoveModal'
import { ShortcutList, ShortcutsModal } from './ShortcutsModal'
import { HelpHost } from '../../help'
import './modals.css'

/** Renders the single active modal from useUI.modal (and the docks and side sheets: the AI terminal, the flight recorder, Help; the agents' dialogs over any route). */
export function ModalHost() {
  const modal = useUI((s) => s.modal)
  const close = useUI((s) => s.closeModal)
  return (
    <>
      {!isTestAccess() && <AgentPanel />}
      {!isTestAccess() && <RecorderHost />}
      <HelpHost shortcuts={<ShortcutList />} />
      {/* MirrorSetup / the agent editor over any route (the Patchbay's setup lamps) — a lazy chunk, only while asked */}
      {!isTestAccess() && <AgentDialogsHost />}
      {modal && <ModalSwitch modal={modal} onClose={close} />}
    </>
  )
}

/** A key per modal object (each `openModal` call hands over a new one). */
const modalKeys = new WeakMap<object, number>()
let modalCount = 0
function modalKey(m: object): number {
  let k = modalKeys.get(m)
  if (k === undefined) modalKeys.set(m, (k = ++modalCount))
  return k
}

function ModalSwitch({ modal, onClose }: { modal: ModalState; onClose: () => void }) {
  if (isTestAccess() && !['export', 'shortcuts'].includes(modal.type)) return <TestViewNotice onClose={onClose} />
  switch (modal.type) {
    case 'settings':
      return <SettingsModal initialTab={modal.tab} section={modal.section} server={modal.server} add={modal.add} onClose={onClose} />
    case 'aiSetup':
      return (
        <Suspense fallback={null}>
          <AISetupModal modal={modal} onClose={onClose} />
        </Suspense>
      )
    case 'shortcuts':
      return <ShortcutsModal onClose={onClose} />
    case 'move':
      return <MoveModal pageId={modal.pageId} onClose={onClose} />
    case 'confirm':
      // its own instance per dialog: a confirm opened in place of another unmounts that one, so its `onCancel` runs
      return <ConfirmModal key={modalKey(modal)} {...modal} onClose={onClose} />
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
    case 'dbCommands':
      return <CommandsEditor databaseId={modal.databaseId} onClose={onClose} />
    case 'templates':
      return <TemplatesModal parentId={modal.parentId} tab={modal.tab} select={modal.select} onClose={onClose} />
    case 'saveTemplate':
      return <SaveTemplateModal pageId={modal.pageId} onClose={onClose} />
    case 'functions':
      return <FunctionsModal initialId={modal.id} onClose={onClose} />
    case 'orderNote':
      return <OrderNoteModal pageId={modal.pageId} onClose={onClose} />
    case 'memoryExample':
      return <ExampleDialog pageId={modal.pageId} tag={modal.tag} blocks={modal.blocks} onClose={onClose} />
    default:
      return null
  }
}

function TestViewNotice({onClose}: {onClose:()=>void}) {
  const de = useLang() === 'de'
  return <Modal open onClose={onClose} label="§ TEST" title={de ? 'Testansicht · nur lesen' : 'Test view · read-only'} footer={<button className="btn" onClick={onClose}>{de ? 'Schließen' : 'Close'}</button>}><p style={{padding:20}}>{de ? 'Persönliche Einstellungen und Arbeitsläufe sind in der Testansicht gesperrt. Nutze den Testbalken, um zu deinem Konto zurückzukehren.' : 'Personal settings and work runs are disabled in the test view. Use the test banner to return to your account.'}</p></Modal>
}
