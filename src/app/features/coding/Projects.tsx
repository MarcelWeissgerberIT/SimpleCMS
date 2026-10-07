/**
 * Projects of a pipeline kind: each its own database (e.g. the stories of one epic) — pick the one #/coding shows on
 * this device, make a new one (a copy of this project's pipeline or a template), or move one to the trash with Undo.
 * The worker takes tasks from every project.
 */
import { useState } from 'react'
import { FolderPlus, Trash2 } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import { KIND_TEMPLATES, chooseProject, createProject, pipelineDbIdsOf, trashProject, type PipelineKind, type PipelineTemplate } from './schema'
import { useCoding } from './state'

export function ProjectBar({ kind, dbId, readOnly }: { kind: PipelineKind; dbId: string; readOnly: boolean }) {
  const t = useT()
  useCoding((s) => s.projectRev)
  const pages = useWorkspace((s) => s.pages)
  const locked = useWorkspace((s) => !!s.databases[dbId]?.locked)
  const ids = pipelineDbIdsOf(kind)
  const [dialog, setDialog] = useState<'new' | 'delete' | null>(null)
  const title = (id: string) => pages[id]?.title.trim() || t('common.untitled')

  const remove = () => {
    setDialog(null)
    const name = title(dbId)
    if (!trashProject(dbId)) {
      useUI.getState().toast({ message: t('features.coding.project.cannotDelete'), kind: 'error' })
      return
    }
    useUI.getState().toast({
      message: t('features.coding.project.deleted', { name }),
      kind: 'success',
      action: {
        label: t('common.undo'),
        run: () => {
          useWorkspace.getState().restorePage(dbId)
          chooseProject(dbId)
        },
      },
    })
  }

  return (
    <div className="cv-projects" role="group" aria-label={t('features.coding.project.label')} data-testid="coding-projects">
      <span className="label">{t('features.coding.project.label')}</span>
      {ids.length > 1 ? (
        <select className="input cv-projects__pick" value={dbId} onChange={(e) => chooseProject(e.target.value)} aria-label={t('features.coding.project.pick')} data-testid="coding-project-select">
          {ids.map((id) => (
            <option key={id} value={id}>
              {title(id)}
            </option>
          ))}
        </select>
      ) : (
        <span className="cv-projects__name" title={title(dbId)}>
          {title(dbId)}
        </span>
      )}
      {!readOnly && (
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDialog('new')} data-testid="coding-project-new">
            <FolderPlus size={13} strokeWidth={1.75} aria-hidden />
            {t('features.coding.project.new')}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={locked} title={locked ? t('features.coding.project.locked') : undefined} onClick={() => setDialog('delete')} data-testid="coding-project-delete">
            <Trash2 size={13} strokeWidth={1.75} aria-hidden />
            {t('features.coding.project.delete')}
          </button>
        </>
      )}
      {dialog === 'new' && <NewProject kind={kind} from={title(dbId)} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <Modal
          open
          onClose={() => setDialog(null)}
          label="§ CD — PROJECT"
          title={t('features.coding.project.deleteTitle', { name: title(dbId) })}
          width={460}
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn--danger" onClick={remove} data-autofocus data-testid="coding-project-delete-confirm">
                {t('features.coding.project.delete')}
              </button>
            </>
          }
        >
          <p className="cg-confirm">{t('features.coding.project.deleteBody')}</p>
        </Modal>
      )}
    </div>
  )
}

function NewProject({ kind, from, onClose }: { kind: PipelineKind; from: string; onClose: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<PipelineTemplate | ''>('')
  const create = () => {
    const n = name.trim()
    if (!n) return
    try {
      createProject(kind, n, template || undefined)
      useUI.getState().toast({ message: t('features.coding.project.created', { name: n }), kind: 'success' })
      onClose()
    } catch {
      useUI.getState().toast({ message: t('features.coding.setup.readOnly'), kind: 'error' })
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      label="§ CD — PROJECT"
      title={t('features.coding.project.newTitle')}
      width={480}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!name.trim()} onClick={create} data-testid="coding-project-create">
            {t('features.coding.project.create')}
          </button>
        </>
      }
    >
      <form
        className="cv-projform"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <label>
          <span className="label">{t('features.coding.project.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('features.coding.project.namePh')} autoFocus data-testid="coding-project-name" />
        </label>
        <label>
          <span className="label">{t('features.coding.project.pipeline')}</span>
          <select className="input" value={template} onChange={(e) => setTemplate(e.target.value as PipelineTemplate | '')} data-testid="coding-project-template">
            <option value="">{t('features.coding.project.copyFrom', { name: from })}</option>
            {KIND_TEMPLATES[kind].map((w) => (
              <option key={w} value={w}>
                {t(`features.coding.template.${w}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="cv-projform__hint">{t('features.coding.project.hint')}</p>
      </form>
    </Modal>
  )
}
