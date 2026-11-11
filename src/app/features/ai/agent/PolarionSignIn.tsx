import { useLang } from '../../../i18n'
import type { AgentStep } from './types'

/** Visible independently of model prose and collapsed tool details. Never opens on mount/recovery. */
export function PolarionSignIn({ steps }: { steps: AgentStep[] }) {
  const de = useLang() === 'de'
  const last = [...steps].reverse().find(s => s.state === 'ok' && ['atlas_polarion_connect', 'atlas_polarion_status'].includes(s.mcp?.tool ?? ''))
  const url = last?.mcp?.receipt?.authentication?.url
  if (!url) return null
  return <aside className="term-sign-in" aria-label={de ? 'Polarion-Anmeldung' : 'Polarion sign-in'}>
    <div><strong>{de ? 'Polarion wartet auf deine Anmeldung' : 'Polarion is waiting for you to sign in'}</strong>
      <p>{de ? 'Falls sich kein Fenster geöffnet hat, öffne den geschützten Dialog hier. Zugangsdaten und MFA-Code gibst du dort ein.' : 'If no window opened, open the protected dialog here. Enter your credentials and MFA code there.'}</p></div>
    <a className="btn btn--primary" href={url} target="_blank" rel="noopener noreferrer">{de ? 'Anmeldung öffnen' : 'Open sign-in'} ↗</a>
    <small>{de ? 'Der Link ist kurz gültig. Ist er abgelaufen, bitte erneut bei Polarion anmelden. Nach dem Absenden setzt der Browser-Worker fort.' : 'The link expires shortly. If it has expired, request Polarion sign-in again. After submission the browser worker resumes.'}</small>
  </aside>
}
