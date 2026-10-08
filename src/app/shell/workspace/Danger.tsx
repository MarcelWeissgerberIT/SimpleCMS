/**
 * Workspace page § 06 — Danger zone. Local workspace: reset it on this device (asks first). Team workspace:
 * the owner deletes it (types its name), everyone else leaves it — the existing team actions, moved here.
 * Removing this browser's copy of a team workspace is a device matter: Settings → Data.
 */
import { useCloud } from '../../cloud'
import { navigate } from '../../lib/router'
import { useT } from '../../i18n'
import { useInCloud } from '../cloud/state'
import { TeamDanger, type TeamData } from '../cloud/Team'
import { ResetWorkspace } from '../settings/data'
import { SectionHead } from './parts'

export function DangerSection({ team }: { team: TeamData }) {
  const t = useT()
  const inCloud = useInCloud()
  const role = useCloud((c) => c.role)
  const myId = useCloud((c) => c.user?.id ?? null)
  return (
    <>
      <SectionHead n="07" title={t('shell.ws.sec.danger')} lead={inCloud ? (role === 'owner' ? t('shell.ws.danger.leadOwner') : t('shell.ws.danger.leadMember')) : t('shell.ws.danger.lead')} />
      <div className="wsp-danger">{inCloud ? team.wsId && <TeamDanger wsId={team.wsId} owner={role === 'owner'} myId={myId} onDone={() => navigate({ name: 'home' })} /> : <ResetWorkspace />}</div>
    </>
  )
}
