import { useEffect, useState } from 'react'
import { useLang } from '../../i18n'
import { loadPersonalVault, unlockPersonalVault, lockPersonalVault, savePersonalConnection, removePersonalConnection, usePersonalVault } from './store'
import './secrets.css'
import { HelpLink } from '../../help'

export function PersonalSecrets() {
  const de = useLang() === 'de', tr = (a: string, b: string) => de ? a : b
  const { status, entries } = usePersonalVault()
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [id, setId] = useState<string>(), [name, setName] = useState('atlas-me'), [url, setUrl] = useState('https://eh-atlas.com/mcp'), [token, setToken] = useState(''), [tools, setTools] = useState('atlas_whoami, atlas_search, atlas_get, atlas_context')
  const act = async (fn: () => Promise<void>) => { setBusy(true);setError('');try { await fn() } catch (e) { setError(e instanceof Error ? e.message : tr('Aktion fehlgeschlagen.', 'Action failed.')) } finally { setBusy(false) } }
  useEffect(() => { void act(loadPersonalVault) }, [])
  useEffect(() => { if (status !== 'open') { setToken('');setPassword('');setConfirmation('') } }, [status])
  return <section className="personal-secrets" data-testid="personal-secrets">
    <HelpLink id="personal-secrets" />
    <h2>{tr('Meine Secrets', 'My secrets')}</h2>
    <p>{tr('Dein persönlicher Tresor für Atlas- und Agenten-Tokens. Er gehört zu deinem Konto, nicht zum Team-Workspace. Eine eigene Passphrase verschlüsselt den Inhalt bereits im Browser; der Team-Server erhält nur den verschlüsselten Tresor.', 'Your personal vault for Atlas and agent tokens. It belongs to your account, not to the team workspace. A separate passphrase encrypts its content in your browser; the team server receives only the encrypted vault.')}</p>
    <p>{tr('Automatische Sperre nach 10 Minuten; bereits gestartete Läufe werden dadurch nicht beendet. Die Passphrase wird nicht gespeichert und kann nicht wiederhergestellt werden. Ohne Anmeldung auf einem lokalen Gerät bleibt der Tresor nur in diesem Browserprofil.', 'Locks automatically after 10 minutes; this does not stop runs already started. The passphrase is not saved and cannot be recovered. Without an account on a local device, the vault stays in this browser profile only.')}</p>
    {error && <p role="alert">{error}</p>}
    {status !== 'open' ? <form onSubmit={e => { e.preventDefault();void act(async () => { if (status === 'empty' && password !== confirmation) throw new Error(tr('Die Passphrasen stimmen nicht überein.', 'Passphrases do not match.'));const p = password;setPassword('');setConfirmation('');await unlockPersonalVault(p) }) }}>
      <label>{status === 'empty' ? tr('Neue Tresor-Passphrase · mindestens 14 Zeichen', 'New vault passphrase · at least 14 characters') : tr('Tresor-Passphrase', 'Vault passphrase')}<input type="password" autoComplete={status === 'empty' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      {status === 'empty' && <label>{tr('Passphrase wiederholen', 'Repeat passphrase')}<input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>}
      <button className="btn btn--primary" disabled={busy || status === 'closed'}>{status === 'empty' ? tr('Tresor anlegen', 'Create vault') : tr('Entsperren', 'Unlock')}</button>
      <button className="btn" type="button" disabled={busy} onClick={() => void act(loadPersonalVault)}>{tr('Neu laden', 'Reload')}</button>
    </form> : <>
      <button className="btn" onClick={lockPersonalVault}>{tr('Jetzt sperren', 'Lock now')}</button>
      <ul>{entries.map(e => <li key={e.id}><strong>{e.name}</strong> · {new URL(e.url).host} · {e.tools.length} {tr('Werkzeuge', 'tools')} <button className="btn" onClick={() => { setId(e.id);setName(e.name);setUrl(e.url);setToken('');setTools(e.tools.join(', ')) }}>{tr('Bearbeiten', 'Edit')}</button> <button className="btn" disabled={busy} onClick={() => void act(() => removePersonalConnection(e.id))}>{tr('Aus Tresor entfernen', 'Remove from vault')}</button></li>)}</ul>
      <form onSubmit={e => { e.preventDefault();void act(async () => { await savePersonalConnection({ id, name: name.trim(), url: url.trim(), token: token.trim(), tools: [...new Set(tools.split(/[\s,]+/).filter(Boolean))] });setToken('');setId(undefined) }) }}>
        <h3>{id ? tr('Verbindung bearbeiten', 'Edit connection') : tr('Verbindung hinzufügen', 'Add connection')}</h3>
        <label>{tr('Name · z. B. atlas-me oder atlas-ba', 'Name · e.g. atlas-me or atlas-ba')}<input value={name} onChange={e => setName(e.target.value)} maxLength={32} required /></label>
        <label>{tr('Genaue MCP-Adresse · HTTPS', 'Exact MCP address · HTTPS')}<input type="url" value={url} onChange={e => setUrl(e.target.value)} maxLength={500} required /></label>
        <label>{tr('Token', 'Token')}<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" maxLength={8192} required={!id} placeholder={id ? tr('Leer lassen, um das gespeicherte Token zu behalten', 'Leave blank to keep the saved token') : ''} /></label>
        <label>{tr('Erlaubte MCP-Werkzeuge · Namen mit Komma trennen', 'Allowed MCP tools · separate names with commas')}<textarea value={tools} onChange={e => setTools(e.target.value)} required /></label>
        <p>{tr('Nur benötigte Werkzeuge freigeben. Schreibwerkzeuge können sofort externe Änderungen ausführen. Das Token muss zusätzlich in Atlas passend eingeschränkt sein. Das Speichern sendet keine Anfrage an Atlas.', 'Allow only the tools needed. Write tools can change external data immediately. The token must also be suitably restricted in Atlas. Saving does not contact Atlas.')}</p>
        <button className="btn btn--primary" disabled={busy}>{tr('Verschlüsselt speichern', 'Save encrypted')}</button>
      </form>
      <p>{tr('In der Coding-Aufgabe wählst du unter „Meine Secrets“ ausdrücklich die Verbindungen für diese Aufgabe aus. Sie werden nur für die Laufzeit an deinen gekoppelten Worker übergeben. Claude Code nutzt sie über dessen MCP-Proxy; der Tokenwert gehört nicht in den Auftrag.', 'In the coding task, explicitly select connections under “My secrets” for that task. They are handed to your paired worker for the run only. Claude Code uses them through its MCP proxy; the token value does not belong in the prompt.')}</p>
    </>}
    <p>{tr('Entfernen löscht nur den Tresoreintrag; ein Token widerrufst du bei Atlas. Entsperrte Daten sind für die One-Anwendung und den ausgewählten Worker nutzbar. Verwende einen vertrauenswürdigen Rechner und schütze das Browserprofil.', 'Removing an entry does not revoke its token; revoke it in Atlas. Unlocked data can be used by the One application and the selected worker. Use a trusted computer and protect your browser profile.')}</p>
  </section>
}
