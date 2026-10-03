/**
 * "Save as template…" (page "…" menu): name, description, category — then the page and
 * everything below it is copied into the Templates area (own.ts saveAsTemplate). The page itself
 * stays as it is. Team workspaces: "Only me" keeps the template in my Private section.
 */
import { useMemo, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { usePage } from '../../store/selectors'
import { toast } from '../../store/ui'
import { usePrivateMode } from '../../cloud'
import type { ID, TemplateCategory } from '../../store/types'
import { countList } from '../io/count'
import { subtreeOf } from './copy'
import { editTemplate, saveAsTemplate } from './own'
import { CategoryChips } from './parts'
import './templates.css'

export function SaveTemplateModal({ pageId, onClose }: { pageId: ID; onClose: () => void }) {
  const t = useT()
  const page = usePage(pageId)
  const [name, setName] = useState(() => page?.title.trim() ?? '')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TemplateCategory | null>(null)
  const privateMode = usePrivateMode()
  const [priv, setPriv] = useState(() => !!page?.private)
  const [busy, setBusy] = useState(false)

  const includes = useMemo(() => {
    const pages = useWorkspace.getState().pages
    const list = subtreeOf(pages, pageId)
    const n = { page: 0, db: 0, row: 0 }
    for (const p of list) {
      if (p.kind === 'database') n.db++
      else if (p.databaseId && p.id !== pageId) n.row++
      else n.page++
    }
    return countList(t, [
      ['page', n.page],
      ['db', n.db],
      ['row', n.row],
    ])
  }, [pageId, t])

  if (!page) return null
  const fallback = page.title.trim() || t('features.tpl.untitled')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const meta = { name: name.trim() || fallback, ...(description.trim() ? { description: description.trim() } : {}), category }
    try {
      const id = saveAsTemplate(pageId, meta, { private: privateMode === 'write' && priv })
      if (!id) throw new Error('page is gone')
      onClose()
      toast({ message: t('features.tpl.save.done', { name: meta.name }), kind: 'success', action: { label: t('features.tpl.edit'), run: () => editTemplate(id) } })
    } catch (err) {
      console.error('[templates] save failed', err)
      toast({ message: t('features.tpl.save.failed'), kind: 'error' })
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} label="§ TPL" title={t('features.tpl.save.title')} width={500} className="tpl-save">
      <form className="tpl-form" onSubmit={submit}>
        <label className="tpl-form__field">
          <span className="label">{t('features.tpl.save.name')}</span>
          <input className="input" value={name} placeholder={fallback} onChange={(e) => setName(e.target.value)} data-autofocus="" maxLength={120} />
        </label>
        <label className="tpl-form__field">
          <span className="label">{t('features.tpl.save.description')}</span>
          <textarea className="input" rows={2} value={description} placeholder={t('features.tpl.save.descriptionPh')} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
        </label>
        <div className="tpl-form__field">
          <span className="label">{t('features.tpl.save.category')}</span>
          <CategoryChips value={category} onChange={setCategory} label={t('features.tpl.save.category')} />
        </div>
        <div className="tpl-form__spec">
          <span className="label">{t('features.tpl.save.includes')}</span>
          <span className="tpl-form__count mono">{includes}</span>
        </div>
        {privateMode === 'write' && (
          <div className="tpl-form__private">
            <span className="tpl-form__privtext">
              <span>{t('features.tpl.save.private')}</span>
              <span className="faint">{t('features.tpl.save.privateHint')}</span>
            </span>
            <Switch checked={priv} onChange={setPriv} label={t('features.tpl.save.private')} />
          </div>
        )}
        <p className="tpl-form__note faint">{t('features.tpl.save.note')}</p>
        <div className="tpl-form__foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('features.tpl.save.submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
