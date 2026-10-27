import { connectionProblem } from '@/shared/ai/connection-problem'
import { useLang, useT } from '../../../i18n'
import { useState } from 'react'
import { changeRepositories } from '../../coding/SetupCard'
import { openCodingSettings } from '../../coding/open'
import './connection-help.css'

/** The same concrete repair path in onboarding, the terminal and page AI. Never handles secrets. */
export function WorkerConnectionHelp({ error }: { error: unknown }) {
  const lang = useLang(), t = useT(), [opening, setOpening] = useState(false)
  const tr = (de: string, en: string) => lang === 'de' ? de : en
  if (connectionProblem(error) !== 'tls') return null
  return <div className="worker-connection-help" data-testid="worker-tls-help">
    <strong>{tr('Sichere Verbindung blockiert · Firmenzertifikat', 'Secure connection blocked · company certificate')}</strong>
    <p>{tr('Die Zertifikatsprüfung scheitert vor der Anmeldung. Dieser Fehler sagt nicht, dass dein Atlas-Token falsch ist.', 'Certificate verification fails before sign-in. This error does not mean your Atlas token is wrong.')}</p>
    <ol>
      <li>{tr('Worker auf 1.34.3 aktualisieren. Bereits im Betriebssystem freigegebene Firmen-CAs werden automatisch genutzt.', 'Update the worker to 1.34.3. Company CAs already approved by the operating system are used automatically.')}</li>
      <li>{tr('Falls nötig: Auf der lokalen Zertifikatsseite „Bereitgestelltes E+H-Zertifikat prüfen“ wählen, Fingerabdruck prüfen und Vertrauen bestätigen. Für andere Firmen die von der IT bereitgestellte CA auswählen.', 'If needed: on the local certificate page choose “Check provided E+H certificate”, check its fingerprint and confirm trust. For other companies, select the CA supplied by IT.')}</li>
      <li>{tr('Laufende Arbeit beenden, Worker vollständig stoppen und über den bisherigen Starter neu starten. Danach denselben Atlas-Test erneut prüfen.', 'Finish running work, fully stop and restart the worker through its existing starter. Then retry the same Atlas check.')}</li>
    </ol>
    <div className="worker-connection-help__actions"><button className="btn btn--sm" onClick={openCodingSettings}>{tr('Worker aktualisieren', 'Update worker')}</button><button className="btn btn--sm" disabled={opening} onClick={() => { setOpening(true); void changeRepositories(t).finally(() => setOpening(false)) }}>{tr('Lokale Zertifikatsseite öffnen', 'Open local certificate setup')}</button></div>
  </div>
}
