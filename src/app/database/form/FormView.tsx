/**
 * Form view: BUILD the questions, FILL (preview) the real form — every response here becomes a
 * row of this database — read the RESPONSES, and SHARE a link whose responses go to the owner's
 * webhook.
 */
import { useId, useMemo, useState } from 'react'
import { ArrowUpRight, BarChart3, ClipboardPen, PencilRuler, Share2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { useLocalState, useModel, type DbModel } from '../hooks'
import { Segmented } from '../parts'
import { openRow, writeValue } from '../model/actions'
import { uploadFiles } from '../model/files'
import { answersToRow, fieldsOf, formConfig, isValidWebhookUrl, type Answers, type Field } from './fields'
import { FormFill, type SubmitOutcome } from './FormFill'
import { FormBuilder } from './FormBuilder'
import { ShareFormModal, closingOf, formTitle } from './ShareForm'
import { markerOf, responseRows } from './responses'
import { pagesOf } from './logic'
import { Responses } from './Responses'
import { hostOf } from './webhook'
import './form.css'

type Mode = 'build' | 'fill' | 'responses'

export default function FormView() {
  const t = useT()
  const m = useModel()
  const [chosen, setMode] = useLocalState<Mode>(`one.db.form.${m.view.id}`, 'build')
  // view only: the form can be looked at (fill mode) but not built, shared or answered;
  // locked: answered (rows stay editable) but not built or shared (its settings are view settings)
  const mode: Mode = m.fixed && chosen === 'build' ? 'fill' : chosen
  const [sharing, setSharing] = useState(false)
  const fields = useMemo(() => fieldsOf(m.db, m.view), [m.db, m.view])
  const hook = (formConfig(m.view).webhookUrl ?? '').trim()
  const connected = isValidWebhookUrl(hook)
  const required = fields.filter((f) => f.required).length
  const pages = pagesOf(fields).length
  const marker = useMemo(() => markerOf(m.db, m.view), [m.db, m.view])
  const count = useMemo(() => (marker ? responseRows(m.allRows, marker).length : null), [m.allRows, marker])

  return (
    <div className="dbf" data-mode={mode}>
      <div className="dbf-bar">
        <Segmented
          value={mode}
          ariaLabel={t('database.form.mode')}
          items={[
            { value: 'build', label: t('database.form.build'), icon: <PencilRuler size={13} aria-hidden /> },
            { value: 'fill', label: t('database.form.fill'), icon: <ClipboardPen size={13} aria-hidden /> },
            { value: 'responses', label: count === null ? t('database.form.responsesTab') : t('database.form.responsesCount', { count }), icon: <BarChart3 size={13} aria-hidden /> },
          ]}
          onChange={(v) => setMode(v)}
          disabled={m.fixed ? ['build'] : undefined}
        />
        <span className="label dbf-bar__spec">
          {t(fields.length === 1 ? 'database.form.spec.one' : 'database.form.spec.other', { count: fields.length })} · {t('database.form.specReq', { count: required })}
          {pages > 1 && ` · ${t('database.form.page.count', { count: pages })}`}
        </span>
        <span className="dbf-bar__spacer" />
        <span className="label dbf-bar__hook" title={connected ? hook : undefined}>
          <span className={`led${connected ? ' led--ok' : ''}`} aria-hidden /> {connected ? hostOf(hook) : t('database.form.hook.noneShort')}
        </span>
        {!m.fixed && (
          <button type="button" className="btn btn--sm dbf-bar__share" onClick={() => setSharing(true)}>
            <Share2 size={13} /> <span className="dbf-bar__shareText">{t('database.form.share.button')}</span>
          </button>
        )}
      </div>
      {mode === 'build' ? (
        <FormBuilder m={m} fields={fields} onShare={() => setSharing(true)} onResponses={() => setMode('responses')} />
      ) : mode === 'fill' ? (
        <LocalFill m={m} fields={fields} />
      ) : (
        <Responses m={m} fields={fields} />
      )}
      {sharing && !m.fixed && <ShareFormModal m={m} onClose={() => setSharing(false)} />}
    </div>
  )
}

/** The form inside the workspace: each response becomes a row (marked, when the form tracks responses). */
function LocalFill({ m, fields }: { m: DbModel; fields: Field[] }) {
  const t = useT()
  const lang = useLang()
  const uid = useId().replace(/:/g, '')
  const cfg = formConfig(m.view)
  const dbName = m.dbPage.title.trim() || t('common.untitled')
  const dbId = m.db.id
  const view = m.view
  const marker = markerOf(m.db, m.view)

  const onSubmit = async (answers: Answers, visible: Set<string>): Promise<SubmitOutcome> => {
    if (m.readOnly) return { ok: false, message: t('database.form.viewOnly', { db: dbName }) }
    // hidden questions (logic) are never saved
    const draft = answersToRow(
      fields.filter((f) => visible.has(f.key)),
      answers,
      lang,
    )
    const properties = { ...draft.properties }
    for (const { propId, files } of draft.files) properties[propId] = await uploadFiles(files)
    if (marker) properties[marker.prop.id] = marker.option.id
    const s = useWorkspace.getState()
    if (!s.databases[dbId]) return { ok: false, message: t('database.missing.gone') }
    const id = s.createRow(dbId, { title: draft.title, properties })
    for (const { prop, ids } of draft.relations) writeValue(dbId, prop, id, ids)
    return { ok: true, rowId: id }
  }

  return (
    <div className="dbf-sheet">
      <FormFill
        fields={fields}
        title={formTitle(m, t('common.untitled'))}
        description={cfg.description ?? ''}
        submitLabel={cfg.submitLabel ?? ''}
        onSubmit={onSubmit}
        idBase={`fm${uid}`}
        kicker={`§ ${t('database.form.kicker')}`}
        blocked={m.readOnly ? t('database.form.viewOnly', { db: dbName }) : undefined}
        closing={closingOf(cfg)}
        footnote={
          <>
            <span className="led led--ok" aria-hidden /> {t('database.form.localNote', { db: dbName })}
          </>
        }
        doneActions={(o) =>
          o.ok && o.rowId ? (
            <button type="button" className="btn" onClick={() => openRow(o.rowId!, view)}>
              <ArrowUpRight size={14} /> {t('database.form.done.open')}
            </button>
          ) : null
        }
      />
    </div>
  )
}
