import { useWorkspace } from '../../store/store'
import { useEffect, useState } from 'react'
import { Eye, ArrowLeft, ShieldCheck } from 'lucide-react'
import { useLang } from '../../i18n'
import { useCloud, useCloudSync } from '../../cloud'
import { changeTestAccess, isTestAccess, testScope } from '../../cloud/testScope'
import { Modal } from '../../ui/Modal'
import { cloudApi } from './api'
import './test-access.css'

interface Target { id: string; name: string; email: string; workspaceId: string; workspaceName: string; role: string; guest: boolean; prepared: boolean }
interface Status { active: boolean; canReturn: boolean; actorName: string | null; name?: string; guest?: boolean; role?: string; workspaceId?: string; expiresAt?: number }
const path = (id: string) => `api/workspaces/${encodeURIComponent(id)}/test-access`

export function TestAccessSection({ wsId }: { wsId: string }) {
  const de = useLang() === 'de'
  const enabled = useCloud(s => s.supports?.includes('test-access:1') && !s.workspaces.find(w => w.id === wsId)?.personal)
  const online = useCloud(s => s.status === 'online')
  const pending = useCloudSync(s => s.unsynced || s.pendingUploads > 0)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Target[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const target = list.find(t => t.id === selected)
  if (!enabled || isTestAccess()) return null
  const load = async () => {
    setOpen(true); setBusy(true); setError('')
    try { const r = await cloudApi.cloudRequest<Target[]>('GET', `${path(wsId)}/targets`); setList(r); setSelected(r[0]?.id ?? '') }
    catch { setError(de ? 'Testzugänge konnten nicht geladen werden. Bitte erneut versuchen.' : 'Could not load test access. Please try again.') }
    finally { setBusy(false) }
  }
  const start = async () => {
    if (!target || pending || !online) return
    setBusy(true); setError('')
    try { const r = await cloudApi.cloudRequest<{workspaceId:string}>('POST', path(wsId), {target:target.id}); const {language, theme} = useWorkspace.getState().settings; changeTestAccess('test', r.workspaceId, {language, theme}) }
    catch { setError(de ? 'Der Testzugang konnte nicht gestartet werden. Lade die Liste erneut.' : 'Could not start test access. Please reload the list.'); setBusy(false) }
  }
  return <>
    <section className="test-access-plate" data-testid="test-access-section">
      <div className="test-access-plate__label">§ TEST · <ShieldCheck size={13} aria-hidden /> {de ? 'ZUGANG PRÜFEN' : 'CHECK ACCESS'}</div>
      <h3>{de ? 'ONE als Teilnehmer ansehen' : 'View ONE as a participant'}</h3>
      <p>{de ? 'Prüfe die freigegebenen Seiten aus Sicht eines Mitglieds oder vorbereiteten Gasts. Deine Sitzung bleibt für die Rückkehr erhalten.' : 'Check shared pages as a member or prepared guest. Your session is preserved so you can return.'}</p>
      <button className="btn" onClick={() => void load()} disabled={!online || pending}><Eye size={15} aria-hidden /> {de ? 'Zugang testen …' : 'Test access …'}</button>
      {pending && <p className="wsp-note">{de ? 'Warte, bis deine Änderungen synchronisiert sind.' : 'Wait until your changes are synced.'}</p>}
    </section>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false) }} title={de ? 'Zugang testen' : 'Test access'} label="§ TEST" width={620} footer={<><button className="btn" disabled={busy} onClick={() => setOpen(false)}>{de ? 'Abbrechen' : 'Cancel'}</button><button className="btn btn-primary" disabled={busy || !target || pending || !online} onClick={() => void start()}>{de ? 'Testansicht starten' : 'Start test view'}</button></>}>
      <div className="test-access-dialog">
        <label className="label" htmlFor="test-access-person">{de ? 'Person und Workspace' : 'Person and workspace'}</label>
        <select className="input" id="test-access-person" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>{list.map(t => <option key={t.id} value={t.id}>{t.name} · {t.guest ? (de ? 'Gast' : 'Guest') : t.role} · {t.workspaceName}</option>)}</select>
        {target && <p><strong>{target.name}</strong><br />{target.email}<br />{target.workspaceName} · {target.prepared ? (de ? 'Vorbereiteter Zugang, noch keine Anmeldung nötig' : 'Prepared access; no sign-in needed yet') : (de ? 'Registriertes Mitglied' : 'Registered member')}</p>}
        {!busy && !list.length && <p>{de ? 'Lege zuerst ein Mitglied oder einen Begrüßungsentwurf unter Personen an.' : 'Add a member or welcome draft under People first.'}</p>}
        <div className="test-access-note"><strong>{de ? '20 Minuten · nur lesen' : '20 minutes · read-only'}</strong><p>{de ? 'Die Testansicht gilt in allen ONE-Tabs dieses Browsers. Sie zeigt die gemeinsamen Inhalte, ohne private Seiten, persönliche Secrets oder Atlas-Zugangslinks der Person zu öffnen. Es werden keine Konten angelegt, Mails gesendet oder Arbeitsläufe gestartet.' : 'The test view applies to all ONE tabs in this browser. It shows shared content without opening the person’s private pages, personal secrets or Atlas access links. No accounts are created, emails sent or work runs started.'}</p><p>{de ? 'Bei Gästen entspricht dies dem lesenden Workspace-Zugang. Auch Teammitglieder werden hier nur lesend getestet; Schreibrechte und die echte Anmeldung prüfst du separat.' : 'For guests this matches read-only workspace access. Members are also tested read-only here; writing permissions and actual sign-in need a separate check.'}</p></div>
        {error && <p role="alert" className="cl-err">{error}</p>}
      </div>
    </Modal>
  </>
}

export function TestAccessBanner() {
  const de = useLang() === 'de'
  const supports = useCloud(s => s.supports?.includes('test-access:1'))
  const [status, setStatus] = useState<Status | null>(() => { const t = testScope(); return t ? {active:true, canReturn:true, ...t} : null })
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supports && !isTestAccess()) return
    let live = true
    void cloudApi.cloudRequest<Status>('GET', 'api/auth/test-access').then(s => { if (live) setStatus(s) }).catch(() => {})
    return () => { live = false }
  }, [supports])
  useEffect(() => {
    if (!status?.active) return
    const timer = setInterval(() => { if (status.expiresAt && Date.now() >= status.expiresAt) location.reload(); else setNow(Date.now()) }, 1000)
    return () => clearInterval(timer)
  }, [status?.active])
  if (!status?.canReturn && !isTestAccess()) return null
  const remaining = Math.max(0, Math.ceil(((status?.expiresAt ?? 0) - now) / 1000))
  const stop = async () => {
    setBusy(true); setError('')
    try { const r = await cloudApi.cloudRequest<{workspaceId?:string}>('POST', 'api/auth/test-access/stop'); changeTestAccess('owner', r.workspaceId) }
    catch { setError(de ? 'Rückkehr fehlgeschlagen. Verbindung prüfen oder erneut anmelden.' : 'Could not return. Check your connection or sign in again.'); setBusy(false) }
  }
  return <aside className="test-access-banner" role="region" aria-label={de ? 'Testansicht' : 'Test view'} data-testid="test-access-banner">
    <Eye size={18} aria-hidden /><div><strong>{de ? 'Testansicht' : 'Test view'}{status?.name ? ` · ${status.name}` : ''}</strong><span>{de ? 'Nur lesen' : 'Read-only'} · {remaining ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2,'0')}` : (de ? 'Beendet oder Verbindung prüfen' : 'Ended or check connection')}{status?.guest ? ` · ${de ? 'Gast' : 'Guest'}` : ''}</span>{error && <span role="alert">{error}</span>}</div>
    <button className="btn" disabled={busy} onClick={() => void stop()}><ArrowLeft size={15} aria-hidden />{de ? 'Zurück zu' : 'Return to'} {status?.actorName || (de ? 'meinem Konto' : 'my account')}</button>
  </aside>
}
