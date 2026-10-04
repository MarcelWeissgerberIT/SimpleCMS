/**
 * Sidebar header, renaming: the workspace name turns into a field in place (from the header menu's
 * "Rename workspace", a double click on the name, or F2 on the header). ↵ saves, Esc cancels, leaving
 * the field saves a valid name. A team workspace is renamed on the server (admins) — every member
 * sees the new name at once; elsewhere the name is read-only.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useT } from '../../i18n'
import { useUI } from '../../store/ui'
import { logoMarkSvg } from '@/shared/logo'
import { errorText } from '../cloud/errors'
import { cleanWorkspaceName, renameOpenWorkspace, workspaceNameProblem, WORKSPACE_NAME_MAX } from '../lib/workspaceName'

export function WorkspaceRename({ current, onDone }: { current: string; onDone: () => void }) {
  const t = useT()
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const done = useRef(false)
  const name = cleanWorkspaceName(value)
  const problem = workspaceNameProblem(name)

  useEffect(() => {
    // after the header menu has closed (and handed focus back to its trigger)
    const raf = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  const finish = () => {
    done.current = true
    onDone()
  }

  const commit = async (fromBlur = false) => {
    if (done.current || busy) return
    if (problem) {
      // leaving the field with nothing valid in it keeps the old name
      if (fromBlur) return finish()
      setTried(true)
      return
    }
    if (name === current) return finish()
    setBusy(true)
    try {
      await renameOpenWorkspace(name)
      finish()
    } catch (e) {
      setBusy(false)
      useUI.getState().toast({ message: t('shell.wsname.failed', { error: errorText(e, t) }), kind: 'error' })
      if (fromBlur) finish()
      else ref.current?.focus()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish()
    }
  }

  const showProblem = tried && problem
  const count = [...value].length
  return (
    <div className="sb-head__edit" data-busy={busy || undefined}>
      <span className="sb-head__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(24) }} />
      <span className="sb-head__text">
        <input
          ref={ref}
          className="sb-head__input"
          value={value}
          maxLength={WORKSPACE_NAME_MAX}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('shell.wsname.label')}
          aria-invalid={showProblem ? true : undefined}
          aria-describedby={`${id}-sub`}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value.replace(/[\r\n\t]/g, ' '))
            setTried(false)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit(true)}
        />
        <span className="sb-head__sub" id={`${id}-sub`} data-problem={showProblem || undefined} role={showProblem ? 'alert' : undefined}>
          {showProblem
            ? problem === 'empty'
              ? t('shell.wsname.empty')
              : t('shell.wsname.long', { n: WORKSPACE_NAME_MAX })
            : `${String(count).padStart(2, '0')}/${WORKSPACE_NAME_MAX} · ${t('shell.wsname.keys')}`}
        </span>
      </span>
    </div>
  )
}
