import { onlyServer, attachMcp } from '../mcp-servers/config'
import { workerMcpSession } from '../core/workerMcp'
import { loadQuandProfile } from '../core/quandprofile'
import { cloudAtlasMcpReady } from '../../coding'
import { codeAccessScope } from '../../code-evidence'
import { atlasData } from '@/shared/mcp/facts'
import { sha256Hex } from '@/shared/mcp/sha256'
import { validateValue } from '@/shared/quandprofile/program'
import { packageText, type CodeChange, type Proposal, type Delivery } from '@/shared/codeChange/model'
import { verifyChangeSources } from './run'
import { t } from '../../../i18n'
/** Human-triggered attachment to an existing record. Never a repository mutation or a requirement draft. */
export async function attachCodeChange(o: {
  change: CodeChange
  proposal: Proposal
  ref: number
  signal: AbortSignal
  valid: () => boolean
  activity: (s: string) => void
  save: (d: Delivery) => void
}) {
  const a = o.change,
    p = o.proposal,
    server = a.files[0].reference.server!,
    scope = codeAccessScope()
  const check = () => {
    o.signal.throwIfAborted()
    if (scope !== codeAccessScope() || !o.valid()) throw Error(t('codeChange.changed'))
  }
  if (a.accepted !== p.id || !Number.isSafeInteger(o.ref) || o.ref < 1) throw Error(t('codeChange.acceptFirst'))
  if (a.deliveries.some((d) => d.proposal === p.id && d.ref === o.ref && d.server === server))
    throw Error(t('codeChange.deliveryExists'))
  const text = packageText(a, p),
    bytes = new TextEncoder().encode(text),
    hash = sha256Hex(bytes)
  if (bytes.length > 600000) throw Error(t('codeChange.format'))
  const selected = onlyServer(server, ['atlas_get', 'atlas_attach'])
  if (!selected) throw Error(t('codeChange.connection'))
  const attached = await attachMcp(selected.setup, 'fixed', { forced: selected.forced, allow: selected.allow })
  check()
  if (!attached?.worker?.length || !cloudAtlasMcpReady(attached.worker)) throw Error(t('codeChange.connection'))
  await loadQuandProfile()
  check()
  const remote = workerMcpSession(attached.worker, o.signal, () => {}, 30000)
  for (const name of ['atlas_get', 'atlas_attach']) {
    await remote('one_mcp_search', { query: name }, crypto.randomUUID())
    check()
    if (!remote.schema(server, name)) throw Error(t('codeChange.connection'))
  }
  const read = atlasData(
    remote.materializeResult(
      await remote(
        'one_mcp_call',
        { server, name: 'atlas_get', arguments: { ref: o.ref, parts: [], includeConstraints: 'none' } },
        crypto.randomUUID(),
      ),
    ),
  )
  check()
  const record = read?.item ?? read?.record ?? read
  if (record?.ref !== o.ref) throw Error(t('codeChange.destination'))
  await verifyChangeSources(
    a,
    o.signal,
    () => {
      check()
      return true
    },
    o.activity,
  )
  check()
  const delivery: Delivery = {
    proposal: p.id,
    ref: o.ref,
    server,
    hash,
    filename: 'one-code-change-' + a.id + '-' + p.id + '.json',
    at: Date.now(),
    state: 'pending',
    url: '',
  }
  const args = { ref: o.ref, filename: delivery.filename, mime: 'application/json', text }
  validateValue(args, remote.schema(server, 'atlas_attach')!.inputSchema, 'atlas_attach')
  o.save(delivery)
  check()
  o.activity(t('codeChange.uploading'))
  try {
    const raw = remote.materializeResult(
      await remote('one_mcp_call', { server, name: 'atlas_attach', arguments: args }, crypto.randomUUID()),
    )
    check()
    const data = atlasData(raw),
      receipt = data?.attachment
    if (
      data?.ok !== true ||
      receipt?.sha256 !== hash ||
      receipt?.bytes !== bytes.length ||
      typeof receipt?.url !== 'string'
    )
      throw Error(t('codeChange.uncertain'))
    const connection = selected.setup.servers.find((s) => s.name === server)!,
      url = new URL(receipt.url, connection.url)
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== new URL(connection.url).origin)
      throw Error(t('codeChange.uncertain'))
    o.save({ ...delivery, state: 'confirmed', url: url.href })
  } catch (e) {
    if (scope === codeAccessScope() && o.valid()) o.save({ ...delivery, state: 'uncertain' })
    throw e
  }
}

/** Native proposal storage and human-only publication use the versioned Atlas code-change contract. */
export async function nativeCodeChange(o: {
  change: CodeChange
  proposal: Proposal
  action: 'save' | 'get' | 'publish'
  remote?: import('@/shared/codeChange/model').RemoteChange
  signal: AbortSignal
  valid: () => boolean
  activity: (s: string) => void
}) {
  const a = o.change,
    p = o.proposal,
    server = a.files[0].reference.server!,
    scope = codeAccessScope()
  const check = () => {
    o.signal.throwIfAborted()
    if (scope !== codeAccessScope() || !o.valid()) throw Error(t('codeChange.changed'))
  }
  const text = packageText(a, p),
    hash = sha256Hex(text),
    repo = a.files[0].reference.citation.repo
  if (a.accepted !== p.id || (o.action !== 'save' && (!o.remote || o.remote.hash !== hash)))
    throw Error(t('codeChange.acceptFirst'))
  await verifyChangeSources(
    a,
    o.signal,
    () => {
      check()
      return true
    },
    o.activity,
  )
  const tool = 'atlas_code_change_' + o.action,
    selected = onlyServer(server, ['atlas_code_repos', tool])
  if (!selected) throw Error(t('codeChange.connection'))
  const attached = await attachMcp(selected.setup, 'fixed', { forced: selected.forced, allow: selected.allow })
  check()
  if (!attached?.worker?.length || !cloudAtlasMcpReady(attached.worker)) throw Error(t('codeChange.connection'))
  const args =
    o.action === 'save'
      ? { repo, package: text }
      : o.action === 'get'
        ? { repo, change: o.remote!.id }
        : { repo, change: o.remote!.id, hash, targetHash: o.remote!.target?.hash }
  const { requestWorkerMcp } = await import('../../coding')
  let response: { result?: string }
  if (o.action === 'publish') {
    const { cloudRequest, useCloud } = await import('../../../cloud')
    const cloud = useCloud.getState()
    if (cloud.active.kind !== 'cloud') throw Error(t('codeChange.connection'))
    response = await cloudRequest(
      'POST',
      `api/workspaces/${cloud.active.id}/atlas-code-change-publish`,
      { action: 'call', servers: attached.worker, server, name: tool, arguments: args },
      { signal: o.signal },
    )
  } else
    response = (await requestWorkerMcp(
      { action: 'call', servers: attached.worker, server, name: tool, arguments: args },
      o.signal,
    )) as { result?: string }
  check()
  const data = atlasData(response.result ?? '')
  if (data?.ok !== true || data.hash !== hash || typeof data.change !== 'string')
    throw Error(typeof data?.error === 'string' ? data.error : t('codeChange.nativeUnavailable'))
  return {
    proposal: p.id,
    id: data.change,
    hash,
    state: String(data.state),
    publishConfigured: data.publishConfigured === true,
    target: data.target ?? undefined,
    url: typeof data.receipt?.url === 'string' ? data.receipt.url : '',
  }
}
