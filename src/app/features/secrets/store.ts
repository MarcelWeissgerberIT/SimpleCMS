/** Not workspace state: credentials never enter Yjs, backups, drafts, prompts or the flight recorder. */
import { create } from 'zustand'
import { createStore, get, set } from 'idb-keyval'
import { useCloud } from '../../cloud/state'
import { request, onUnauthenticated } from '../../cloud/api'
import { useCoding } from '../coding/state'
import { useWorkspace } from '../../store/store'
import { decryptConnections, deriveVaultKey, encryptConnections, vaultSalt, validConnection, type PersonalConnection, type VaultEnvelope } from '../../../shared/personalVault'

interface VaultState { status: 'closed' | 'locked' | 'empty' | 'open'; entries: Array<Omit<PersonalConnection, 'token'>> }
export const usePersonalVault = create<VaultState>(() => ({ status: 'closed', entries: [] }))
const local = createStore('one-personal-secrets', 'vault')
const TIMEOUT = 10 * 60_000
let owner = '', revision = 0, salt = '', key: CryptoKey | null = null, entries: PersonalConnection[] = [], expires = 0
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let saving = false
let currentEnvelope: VaultEnvelope | null = null
const grants = new Map<string, { ids: string[]; receiver: string }>()
let receiverGeneration = 0
const receiver = () => { const c = useCoding.getState();return JSON.stringify([receiverGeneration, c.conn, c.worker?.name, c.worker?.worker, c.relay?.token]) }
useCoding.subscribe((state, previous) => { if (state.conn !== previous.conn || state.relay?.token !== previous.relay?.token) receiverGeneration++ })
function account(): { id: string; cloud: boolean } {
  const c = useCloud.getState()
  if (c.user && !c.available) throw new Error('Team-Server nicht erreichbar. / Team server unavailable.')
  if (c.available && !c.user) throw new Error('Bitte zuerst bei One anmelden. / Sign in to One first.')
  return { id: location.origin + (c.user ? '/user/' + c.user.id : '/device'), cloud: !!c.user && c.available }
}
const grantKey = (taskId: string) => `${account().id}\n${useWorkspace.getState().epoch}\n${taskId}`
export function lockPersonalVault(): void {
  generation++;clearTimeout(timer);key = null;entries = [];expires = 0
  usePersonalVault.setState({ status: 'locked', entries: [] })
}
function requireOpen() {
  if (!key || account().id !== owner || Date.now() >= expires) { lockPersonalVault();throw new Error('Persönlichen Secrets-Tresor entsperren. / Unlock your personal secrets vault.') }
  return key
}
function touch() { expires = Date.now() + TIMEOUT;clearTimeout(timer);timer = setTimeout(lockPersonalVault, TIMEOUT) }
const publish = () => usePersonalVault.setState({ status: 'open', entries: entries.map(({ token: _token, ...metadata }) => metadata) })
export async function loadPersonalVault(): Promise<void> {
  lockPersonalVault()
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB || !globalThis.isSecureContext) throw new Error('Der Tresor benötigt HTTPS oder localhost. / The vault requires HTTPS or localhost.')
  const a = account(), op = generation
  const row = a.cloud ? await request<{ envelope: VaultEnvelope | null; version: number }>('GET', 'api/me/secrets') : (await get<{ envelope: VaultEnvelope; version: number }>(a.id, local) ?? { envelope: null, version: 0 })
  if (generation !== op || account().id !== a.id) return
  owner = a.id;revision = row.version;currentEnvelope = row.envelope
  usePersonalVault.setState({ status: row.envelope ? 'locked' : 'empty', entries: [] })
}
export async function unlockPersonalVault(passphrase: string): Promise<void> {
  const a = account(), op = generation
  if (a.id !== owner || !['empty', 'locked'].includes(usePersonalVault.getState().status)) throw new Error('Tresor zuerst laden. / Load the vault first.')
  if (!currentEnvelope && passphrase.length < 14) throw new Error('Mindestens 14 Zeichen verwenden. / Use at least 14 characters.')
  const chosenSalt = currentEnvelope?.salt ?? vaultSalt()
  const derived = await deriveVaultKey(passphrase, chosenSalt)
  let opened: PersonalConnection[] = []
  try { if (currentEnvelope) opened = await decryptConnections(derived, currentEnvelope, a.id) } catch { throw new Error('Tresor konnte nicht entsperrt werden. Passphrase prüfen. / Could not unlock the vault. Check the passphrase.') }
  if (generation !== op || account().id !== a.id) throw new Error('Anmeldung geändert. / Account changed.')
  key = derived;salt = chosenSalt;entries = opened;touch();publish()
  if (!currentEnvelope) await save([])
}
async function save(next: PersonalConnection[]) {
  if (saving) throw new Error('Speichern läuft bereits. / A save is already in progress.')
  const k = requireOpen(), a = account(), op = generation
  saving = true
  try {
    const envelope = await encryptConnections(k, salt, a.id, next)
    if (op !== generation || account().id !== a.id) throw new Error('Tresor gesperrt. / Vault locked.')
    if (a.cloud) {
      const result = await request<{ version: number }>('PUT', 'api/me/secrets', { version: revision, envelope })
      if (op !== generation || account().id !== a.id) return
      revision = result.version
    } else {
      const write = async () => {
        const previous = await get<{ version: number }>(a.id, local)
        if ((previous?.version ?? 0) !== revision) throw new Error('Tresor in einem anderen Tab geändert. Neu laden. / Vault changed in another tab. Reload it.')
        if (op !== generation || account().id !== a.id) throw new Error('Vault locked.')
        await set(a.id, { version: revision + 1, envelope }, local)
      }
      if (navigator.locks) await navigator.locks.request('one-personal-secrets:' + a.id, write)
      else await write()
      revision++
    }
    if (op !== generation || account().id !== a.id) return
    entries = next;currentEnvelope = envelope;touch();publish()
  } catch (e) { lockPersonalVault();throw e } finally { saving = false }
}
export async function savePersonalConnection(input: Omit<PersonalConnection, 'id'> & { id?: string }): Promise<void> {
  requireOpen()
  const old = entries.find(e => e.id === input.id)
  const row = { ...input, id: old?.id ?? crypto.randomUUID(), token: input.token || old?.token || '' }
  if (!validConnection(row)) throw new Error('Name, HTTPS-Adresse, Token und Werkzeugliste prüfen. / Check name, HTTPS address, token and tool list.')
  await save([...entries.filter(e => e.id !== row.id), row])
}
export async function removePersonalConnection(id: string): Promise<void> { requireOpen();await save(entries.filter(e => e.id !== id)) }
export function personalSelection(taskId: string): string[] { try { return grants.get(grantKey(taskId))?.ids ?? [] } catch { return [] } }
export function selectPersonalConnections(taskId: string, ids: string[]): void {
  requireOpen()
  if (ids.length > 8 || ids.some(id => !entries.some(e => e.id === id))) throw new Error('Unknown connection')
  grants.set(grantKey(taskId), { ids: [...new Set(ids)], receiver: receiver() });touch()
}
export function personalGrantCurrent(taskId: string): boolean { return !personalSelection(taskId).length || grants.get(grantKey(taskId))?.receiver === receiver() }
export function personalConnectionsForTask(taskId: string): PersonalConnection[] {
  const ids = personalSelection(taskId)
  if (!ids.length) return []
  requireOpen()
  if (!personalGrantCurrent(taskId)) throw new Error('Worker-Verbindung geändert. Secrets-Auswahl erneut bestätigen. / Worker connection changed. Confirm the secrets selection again.')
  const selected = ids.map(id => entries.find(e => e.id === id))
  if (selected.some(e => !e)) throw new Error('Ausgewählte Verbindung fehlt. / A selected connection is missing.')
  touch();return selected.map(e => ({ ...e!, tools: [...e!.tools] }))
}
onUnauthenticated(() => { lockPersonalVault();grants.clear();owner = '';currentEnvelope = null })
useCloud.subscribe((state, previous) => { if (state.user?.id !== previous.user?.id || state.available !== previous.available) { lockPersonalVault();grants.clear();owner = '';currentEnvelope = null } })
if (typeof window !== 'undefined') window.addEventListener('pagehide', lockPersonalVault)
