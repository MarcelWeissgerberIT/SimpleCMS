/**
 * Workspace page § 05 — Data: backup / export / import (the same keys Settings had: BackupKeys), when this
 * device last saved a full backup, the trash (count + open it), and where the workspace is copied to — the
 * team server (team workspaces) and the folder / GitHub sync of this device (settings: Settings → Sync).
 */
import { useRef, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useCloud, useCloudSync } from '../../cloud'
import { openSyncSettings, useSync } from '../../features'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import type { Translate } from '@/shared/i18n'
import { fmtNumber, fmtStamp } from '../lib/format'
import { useIsMobile } from '../lib/hooks'
import { useInCloud } from '../cloud/state'
import { TrashPopover } from '../sidebar/TrashPopover'
import { BackupKeys } from '../settings/data'
import { LastBackupLine } from './Overview'
import { useTrashCount } from './stats'
import { GoKey, SectionHead, SubHead } from './parts'

type LedState = 'ok' | 'on' | 'off'

export function DataSection() {
  const t = useT()
  const inCloud = useInCloud()
  return (
    <>
      <SectionHead n="06" title={t('shell.ws.sec.data')} lead={inCloud ? t('shell.ws.data.leadTeam') : t('shell.ws.data.lead')} help="export" />
      <SubHead label={t('shell.ws.data.backup')} />
      <BackupKeys />
      <LastBackupLine />
      <SubHead label={t('shell.ws.data.trash')} />
      <TrashLine />
      <SubHead label={t('shell.ws.data.copies')} />
      <ul className="wsp-copies" data-testid="ws-copies">
        {inCloud && <ServerCopy />}
        <SyncCopies />
      </ul>
    </>
  )
}

function TrashLine() {
  const t = useT()
  const lang = useLang()
  const n = useTrashCount()
  const mobile = useIsMobile()
  const btn = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <p className="wsp-line" data-testid="ws-trash">
      <span className="label">{t('shell.ws.data.inTrash')}</span>
      <span className="wsp-line__val">{n ? t(n === 1 ? 'shell.ws.data.trashOne' : 'shell.ws.data.trashN', { n: fmtNumber(n, lang) }) : t('shell.ws.data.trashEmpty')}</span>
      <button ref={btn} type="button" className="btn btn--sm wsp-line__key" aria-haspopup="dialog" aria-expanded={!!anchor} onClick={() => setAnchor((a) => (a ? null : btn.current))}>
        <Trash2 size={13} aria-hidden />
        {t('shell.ws.data.openTrash')}
      </button>
      <TrashPopover anchor={anchor} onClose={() => setAnchor(null)} placement={mobile ? 'top' : 'bottom-end'} />
    </p>
  )
}

function Copy({ name, state, led, detail, action, testId }: { name: string; state: string; led: LedState; detail?: string | null; action?: ReactNode; testId: string }) {
  return (
    <li className="wsp-copy" data-testid={testId}>
      <Led state={led} />
      <span className="wsp-copy__who">
        <span className="wsp-copy__name">{name}</span>
        <span className="wsp-copy__state">
          {state}
          {detail ? ` · ${detail}` : ''}
        </span>
      </span>
      {action}
    </li>
  )
}

/** The team server: in sync, changes waiting, files to upload, refused uploads. */
function ServerCopy() {
  const t = useT()
  const status = useCloud((c) => c.status)
  const sync = useCloudSync(useShallow((s) => ({ unsynced: s.unsynced, pending: s.pendingUploads, failed: s.failedUploads.length })))
  const led: LedState = status === 'online' && !sync.unsynced && !sync.pending ? 'ok' : status === 'online' || status === 'connecting' ? 'on' : 'off'
  const state = status === 'online' ? (sync.unsynced || sync.pending ? t('shell.ws.data.serverSending') : t('shell.ws.data.serverSynced')) : status === 'offline' ? t('shell.ws.data.serverOffline') : t('shell.ws.data.serverConnecting')
  const detail = [sync.pending ? t('shell.ws.data.uploads', { n: sync.pending }) : null, sync.failed ? t('shell.ws.data.refused', { n: sync.failed }) : null].filter(Boolean).join(' · ')
  return <Copy testId="ws-copy-server" name={t('shell.ws.data.server')} state={state} led={led} detail={detail || null} />
}

const folderText = (t: Translate, s: string) => t(`shell.ws.data.folder.${s}`)

/** Folder and GitHub sync of this device (a live Markdown copy), with the way to their settings. */
function SyncCopies() {
  const t = useT()
  const lang = useLang()
  const folder = useSync((s) => s.folder)
  const github = useSync((s) => s.github)
  const when = (at: number | null) => (at ? t('shell.ws.data.lastSync', { at: fmtStamp(at, lang) }) : null)
  const settings = <GoKey label={t('shell.ws.data.syncSettings')} onClick={openSyncSettings} />
  const folderLed: LedState = folder.state === 'ready' ? 'ok' : folder.state === 'running' || folder.state === 'permission' ? 'on' : 'off'
  const githubLed: LedState = github.state === 'ready' ? 'ok' : github.state === 'running' ? 'on' : 'off'
  return (
    <>
      <Copy
        testId="ws-copy-folder"
        name={folder.name ? t('shell.ws.data.folderNamed', { name: folder.name }) : t('shell.ws.data.folderName')}
        state={folderText(t, folder.state)}
        led={folderLed}
        detail={folder.state !== 'off' && folder.state !== 'unsupported' ? when(folder.lastAt) : null}
        action={settings}
      />
      <Copy
        testId="ws-copy-github"
        name={github.config.repo ? t('shell.ws.data.githubNamed', { repo: github.config.repo }) : t('shell.ws.data.githubName')}
        state={t(`shell.ws.data.github.${github.state}`)}
        led={githubLed}
        detail={github.state !== 'off' ? [when(github.lastAt), github.pending ? t('shell.ws.data.pending', { n: github.pending }) : null].filter(Boolean).join(' · ') : null}
        action={settings}
      />
    </>
  )
}
