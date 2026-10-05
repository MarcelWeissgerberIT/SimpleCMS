/**
 * The Gmail sync read-out: LED + "GMAIL · 14:05" (running: "GMAIL · 12/50", failed: "GMAIL · ERROR").
 *  - MailSyncLed { databaseId }: for the Mails database's header — opens Settings → Mail; in the header of
 *    Contacts / Companies (people.ts markers) also "Merge…"; renders nothing for any other database.
 *  - useMailReadout(): the same state + text for the settings tab's panel head.
 */
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { openMailSettings, useMail } from './service'
import { peopleKindOf } from './people'
import { MergeKey } from './PeopleUI'
import './mail.css'

export type ReadoutState = 'off' | 'running' | 'ok' | 'error' | 'reconnect'

export function fmtTime(at: number | null, lang: string): string | null {
  if (!at) return null
  const d = new Date(at)
  const locale = lang === 'de' ? 'de-DE' : 'en-US'
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (new Date().toDateString() === d.toDateString()) return time
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }).toUpperCase()} ${time}`
}

export function useMailReadout(): { state: ReadoutState; text: string } {
  const t = useT()
  const lang = useLang()
  const phase = useMail((s) => s.phase)
  const progress = useMail((s) => s.progress)
  const error = useMail((s) => (s.errorAt === 'sync' ? s.error : null))
  const reconnect = useMail((s) => s.reconnect)
  const lastAt = useMail((s) => s.lastAt)
  const dbId = useWorkspace((s) => s.settings.mail?.databaseId ?? null)
  if (phase === 'running' || phase === 'linking' || phase === 'organising') {
    const n = progress && progress.total ? `${progress.done}/${progress.total}` : ''
    return { state: 'running', text: t(`features.mail.status.${phase}`, { n }).trim() }
  }
  if (error) return { state: 'error', text: t('features.mail.status.error') }
  if (reconnect) return { state: 'reconnect', text: t('features.mail.status.reconnect') }
  const time = fmtTime(lastAt, lang)
  if (time) return { state: 'ok', text: t('features.mail.status.synced', { time }) }
  return { state: 'off', text: dbId ? t('features.mail.status.idle') : t('features.mail.status.off') }
}

export function MailSyncLed({ databaseId }: { databaseId: ID }) {
  const t = useT()
  const mine = useWorkspace((s) => s.settings.mail?.databaseId === databaseId)
  // Contacts / Companies / Conversations: filled by the same sync — the LED, and "Merge…" for two rows
  const kind = useWorkspace((s) => peopleKindOf(s.databases[databaseId]))
  const { state, text } = useMailReadout()
  if (!mine && !kind) return null
  return (
    <>
      <button type="button" className="ml-led" data-state={state} onClick={openMailSettings} title={t('features.mail.status.title')} aria-label={`${text} — ${t('features.mail.status.title')}`} data-testid="mail-led">
        <Led state={state === 'ok' ? 'ok' : state === 'running' || state === 'reconnect' ? 'on' : 'off'} />
        <span>{text}</span>
      </button>
      {kind && kind !== 'conversations' && <MergeKey dbId={databaseId} kind={kind} compact />}
    </>
  )
}
