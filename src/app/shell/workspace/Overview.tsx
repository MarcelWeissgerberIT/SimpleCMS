/**
 * Workspace page § 01 — Overview: the name (the one source of truth: settings.workspaceName here, the
 * server's name in a team workspace), the mark, when it began, its numbers, what this device stores, and
 * when this device last saved a full backup.
 */
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useLastBackup } from '../../features'
import { listFileRefs, getLocalFile } from '../../lib/files'
import { useLang, useT } from '../../i18n'
import { fmtBytes, fmtDate, fmtNumber, fmtStamp } from '../lib/format'
import { cleanWorkspaceName, WORKSPACE_NAME_MAX } from '../lib/workspaceName'
import { useInCloud } from '../cloud/state'
import { WorkspaceNameField, type TeamData } from '../cloud/Team'
import { Field } from '../settings/SettingsModal'
import { StorageGauge, type StorageEstimate } from '../settings/data'
import { useTrashCount, useWorkspaceStats } from './stats'
import { SectionHead, Spec, SubHead } from './parts'

export function Overview({ team, est }: { team: TeamData; est: StorageEstimate | null }) {
  const t = useT()
  const lang = useLang()
  const stats = useWorkspaceStats()
  const trash = useTrashCount()
  const people = useWorkspace((s) => s.people.length)
  const n = (v: number) => fmtNumber(v, lang)
  return (
    <>
      <SectionHead n="01" title={t('shell.ws.sec.overview')} lead={t('shell.ws.overview.lead')} help="workspace" />
      <NameAndMark team={team} />
      <SubHead label={t('shell.ws.overview.numbers')} />
      <Spec
        testId="ws-counts"
        items={[
          { label: t('shell.ws.count.pages'), value: n(stats.pages) },
          { label: t('shell.ws.count.databases'), value: n(stats.databases) },
          { label: t('shell.ws.count.entries'), value: n(stats.entries) },
          { label: t('shell.ws.count.words'), value: n(stats.words) },
          { label: t('shell.ws.count.people'), value: n(team.members && team.members.length > people ? team.members.length : people) },
          { label: t('shell.ws.count.templates'), value: n(stats.templates) },
          { label: t('shell.ws.count.trash'), value: n(trash) },
          { label: t('shell.ws.count.created'), value: stats.created ? fmtDate(stats.created, lang) : '—', hint: t('shell.ws.count.createdHint') },
        ]}
      />
      <SubHead label={t('shell.ws.overview.device')} />
      <StorageGauge est={est} label={t('shell.ws.settings.deviceStorage')} />
      <DeviceFiles />
      <LastBackupLine />
    </>
  )
}

/** The name field — local: this browser's setting; team: the server's (admins rename it, others read it). */
function NameAndMark({ team }: { team: TeamData }) {
  const t = useT()
  const inCloud = useInCloud()
  const name = useWorkspace((s) => s.settings.workspaceName)
  const set = useWorkspace.getState().updateSettings
  return (
    <div className="wsp-name">
      {inCloud ? (
        team.wsId && <WorkspaceNameField wsId={team.wsId} admin={team.admin} />
      ) : (
        <Field label={t('shell.settings.workspaceName')} hint={t('shell.settings.workspaceNameHint')}>
          <input
            className="input"
            value={name}
            maxLength={WORKSPACE_NAME_MAX}
            onChange={(e) => set({ workspaceName: e.target.value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ') })}
            onBlur={(e) => set({ workspaceName: cleanWorkspaceName(e.target.value) || 'One' })}
          />
        </Field>
      )}
    </div>
  )
}

/** Files stored on this device (IndexedDB "one-files", every workspace of this browser). */
function DeviceFiles() {
  const t = useT()
  const lang = useLang()
  const [files, setFiles] = useState<{ n: number; bytes: number } | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const refs = await listFileRefs()
        let bytes = 0
        // sizes from the records (the blobs stay on disk); a very large store is counted, not weighed
        for (const ref of refs.slice(0, 2000)) bytes += (await getLocalFile(ref))?.size ?? 0
        if (alive) setFiles({ n: refs.length, bytes })
      } catch {
        if (alive) setFiles({ n: 0, bytes: 0 })
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return (
    <p className="wsp-line" data-testid="ws-files">
      <span className="label">{t('shell.ws.overview.files')}</span>
      <span className="wsp-line__val">{files ? t('shell.ws.overview.filesVal', { n: fmtNumber(files.n, lang), size: fmtBytes(files.bytes, lang) }) : '—'}</span>
    </p>
  )
}

/** When this device last saved a full backup of this workspace, and a key to make one. */
export function LastBackupLine() {
  const t = useT()
  const lang = useLang()
  const last = useLastBackup()
  return (
    <p className="wsp-line" data-testid="ws-last-backup">
      <span className="label">{t('shell.ws.overview.lastBackup')}</span>
      <span className="wsp-line__val">{last ? t('shell.ws.overview.lastBackupVal', { at: fmtStamp(last.at, lang), size: fmtBytes(last.size, lang) }) : t('shell.ws.overview.noBackup')}</span>
      <button type="button" className="btn btn--sm wsp-line__key" onClick={() => useUI.getState().openModal({ type: 'export', pageId: null })}>
        <Download size={13} aria-hidden />
        {t('shell.ws.overview.backupNow')}
      </button>
    </p>
  )
}
