/**
 * The integration profile editor (a dialog): the profile's JSON in a code area (JsonCodeArea) with live validation —
 * a parse error with line:col, schema problems with their JSON path and line, each recipe built as it would be — a
 * status line ("Valid · active here · unlocks … · 1 recipe"), the problem list (a click puts the caret there), Format,
 * and for an import "Load a .json file". Save writes it with upsertIntegration (an id that changed replaces the old
 * profile). View mode (team members): read only.
 */
import { useDeferredValue, useId, useMemo, useRef, useState } from 'react'
import { Braces, FileUp } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { profileStatus } from '../../../store/integrations'
import { Modal } from '../../../ui/Modal'
import { useLang, useT } from '../../../i18n'
import { JsonCodeArea, type CodeMarker } from './JsonCodeArea'
import { parseJson, stringify } from './json'
import { validateProfileText, type Problem } from './validate'
import { deviceServers } from './status'
import { featureList, statusText } from './text'

export type EditorMode = 'new' | 'edit' | 'import' | 'view'

/** Characters of a file the import reads at most. */
const MAX_FILE = 400_000

export function IntegrationEditor({ mode, initial, originalId, onClose }: { mode: EditorMode; initial: string; originalId?: string; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const [text, setText] = useState(initial)
  const [jump, setJump] = useState<{ line: number; col: number; n: number } | null>(null)
  const [failed, setFailed] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const profiles = useWorkspace((s) => s.integrations)
  const settings = useWorkspace((s) => s.settings)
  const readOnly = mode === 'view'
  const deferred = useDeferredValue(text)
  const v = useMemo(() => validateProfileText(deferred, t, lang), [deferred, t, lang])

  // the id against the workspace: a new / imported profile with a known id replaces it; an edit may not take another's
  const clash = v.profile ? (profiles ?? []).find((p) => p.id === v.profile!.id && p.id !== originalId) : undefined
  const blocked = !!clash && mode === 'edit'
  // nothing typed yet (an import): no problems to show, just the hint
  const empty = !text.trim()
  const problems: Problem[] = empty ? [] : blocked ? [{ severity: 'error', message: t('features.integrations.err.idTaken', { id: clash!.id, name: clash!.name }), path: '$.id', line: 1, col: 1 }, ...v.problems] : v.problems
  const errors = empty ? 0 : v.errors + (blocked ? 1 : 0)
  const markers: CodeMarker[] = problems.map((p) => ({ line: p.line, col: p.col, endCol: p.endCol, severity: p.severity, message: p.message }))
  const st = v.profile ? profileStatus(v.profile, deviceServers(settings)) : null
  const pending = deferred !== text

  const save = () => {
    setFailed('')
    if (readOnly || errors || empty || !v.profile || pending) return
    const ws = useWorkspace.getState()
    const before = ws.integrations ?? []
    if (!ws.upsertIntegration(v.profile)) return setFailed(t('features.integrations.err.refused'))
    if (mode === 'edit' && originalId && originalId !== v.profile.id) ws.deleteIntegration(originalId)
    const replaced = mode !== 'edit' && before.some((p) => p.id === v.profile!.id)
    useUI.getState().toast({ message: t(replaced ? 'features.integrations.replaced' : mode === 'edit' ? 'features.integrations.saved' : 'features.integrations.added', { name: v.profile.name }), kind: 'success' })
    onClose()
  }

  const format = () => {
    const parsed = parseJson(text)
    if (!parsed.error) setText(stringify(parsed.value))
  }

  const load = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_FILE) return setFailed(t('features.integrations.err.fileTooBig'))
    try {
      setText(await f.text())
      setFailed('')
    } catch {
      setFailed(t('features.integrations.err.fileRead'))
    }
  }

  const title = mode === 'new' ? t('features.integrations.titleNew') : mode === 'import' ? t('features.integrations.titleImport') : mode === 'view' ? t('features.integrations.titleView') : t('features.integrations.titleEdit')
  const statusId = `${uid}-status`
  const summary = errors
    ? t(errors === 1 ? 'features.integrations.errors.one' : 'features.integrations.errors.other', { n: errors }) + (v.warnings ? ` · ${t(v.warnings === 1 ? 'features.integrations.warnings.one' : 'features.integrations.warnings.other', { n: v.warnings })}` : '')
    : !text.trim()
      ? t('features.integrations.pasteHint')
      : [
          t('features.integrations.valid'),
          st ? (st.active ? t('features.integrations.activeHere', { server: st.server.toUpperCase() }) : t('features.integrations.inactiveHere')) : '',
          v.profile?.unlocks.length ? t('features.integrations.unlocksList', { list: featureList(t, v.profile.unlocks) }) : t('features.integrations.unlocksNothing'),
          t(v.profile?.recipes?.length === 1 ? 'features.integrations.recipes.one' : 'features.integrations.recipes.other', { n: v.profile?.recipes?.length ?? 0 }),
          ...(v.warnings ? [t(v.warnings === 1 ? 'features.integrations.warnings.one' : 'features.integrations.warnings.other', { n: v.warnings })] : []),
          ...(clash && !blocked ? [t('features.integrations.replaces', { name: clash.name })] : []),
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <Modal
      open
      onClose={onClose}
      label="§ IN"
      title={title}
      width={880}
      className="int-editor"
      footer={
        <div className="int-editor__foot">
          {failed && (
            <p className="int-editor__fail" role="alert">
              <span className="led int-led--err" aria-hidden /> {failed}
            </p>
          )}
          <span className="int-spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {readOnly ? t('common.close') : t('common.cancel')}
          </button>
          {!readOnly && (
            <button type="button" className="btn btn--primary" onClick={save} disabled={!!errors || empty || !v.profile || pending} data-testid="int-save">
              {mode === 'edit' ? t('features.integrations.save') : t('features.integrations.add')}
            </button>
          )}
        </div>
      }
    >
      <div className="int-editor__body">
        <div className="int-editor__tools">
          <span className="label int-editor__schema">one.integration/1</span>
          <span className="int-spacer" />
          {mode === 'import' && (
            <>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void load(e.target.files?.[0])} data-testid="int-file" />
              <button type="button" className="btn btn--sm" onClick={() => file.current?.click()}>
                <FileUp size={13} strokeWidth={1.75} aria-hidden /> {t('features.integrations.loadFile')}
              </button>
            </>
          )}
          {!readOnly && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={format} disabled={!text.trim()}>
              <Braces size={13} strokeWidth={1.75} aria-hidden /> {t('features.integrations.format')}
            </button>
          )}
        </div>
        <JsonCodeArea value={text} onChange={readOnly ? undefined : (x) => setText(x)} markers={markers} readOnly={readOnly} ariaLabel={t('features.integrations.jsonLabel')} describedBy={statusId} jump={jump} />
        <p className="int-editor__status" id={statusId} role="status" data-state={errors ? 'error' : !text.trim() ? 'empty' : v.warnings ? 'warning' : 'ok'} data-testid="int-editor-status">
          <span className={errors ? 'led int-led--err' : text.trim() ? 'led led--ok' : 'led'} aria-hidden />
          <span>{summary}</span>
        </p>
        {problems.length > 0 && (
          <ol className="int-problems" aria-label={t('features.integrations.problems')} data-testid="int-problems">
            {problems.slice(0, 60).map((p, i) => (
              <li key={i} className="int-problem" data-severity={p.severity}>
                <button type="button" className="int-problem__btn" onClick={() => setJump({ line: p.line, col: p.col, n: Date.now() })}>
                  <span className="int-problem__pos mono">
                    {p.line}:{p.col}
                  </span>
                  {p.path && <span className="int-problem__path mono">{p.path}</span>}
                  <span className="int-problem__msg">{p.message}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {mode === 'import' && !text.trim() && <p className="int-editor__hint">{t('features.integrations.importHint')}</p>}
        {st && !st.active && !errors && <p className="int-editor__hint">{statusText(t, st)}</p>}
      </div>
    </Modal>
  )
}
