/** Remote MCP for browser-owned tool loops. No model, launcher, environment or credential files. */
import { connectionUrl } from '../../../src/shared/personalVault.ts'
import type { WorkerMcpRequest, WorkerMcpTool } from '../../../src/shared/ai/worker.ts'
import { LocalMcp } from './local-mcp.ts'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 600 && v.every(n => typeof n === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(n))
export function checkModelMcp(raw: unknown): WorkerMcpRequest {
  if (!object(raw) || !['list','search','call'].includes(raw.action) || Object.keys(raw).some(k => !['servers','action','server','name','arguments','query'].includes(k)) || !Array.isArray(raw.servers) || !raw.servers.length || raw.servers.length > 12) throw new Error('Invalid MCP request.')
  for (const s of raw.servers) {
    if (!object(s) || Object.keys(s).some(k => !['name','url','token','allow','deny'].includes(k)) || typeof s.name !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(s.name) || ['one','one-task'].includes(s.name) || typeof s.url !== 'string' || s.url.length > 500 || !connectionUrl(s.url) || typeof s.token !== 'string' || s.token.length > 8192 || /[\r\n]/.test(s.token) || s.allow !== null && !names(s.allow) || !names(s.deny)) throw new Error('Invalid selected MCP connection.')
  }
  if (new Set(raw.servers.map(s => s.name)).size !== raw.servers.length) throw new Error('Duplicate MCP connection.')
  if (raw.action === 'search' && (typeof raw.query !== 'string' || raw.query.length > 200)) throw new Error('Invalid MCP search.')
  if (raw.action === 'call' && (typeof raw.server !== 'string' || typeof raw.name !== 'string' || !object(raw.arguments) || JSON.stringify(raw.arguments).length > 20000)) throw new Error('Invalid MCP call.')
  return raw as WorkerMcpRequest
}
export async function modelMcp(raw: unknown, signal: AbortSignal):Promise<{tools?:Array<WorkerMcpTool|ReturnType<LocalMcp['catalog']>[number]>;result?:string;unavailable?:string[]}> {
  const r = checkModelMcp(raw), client = new LocalMcp(false)
  try {
    const config = Object.fromEntries(r.servers.map(s => [s.name, { type: 'http', url: s.url, headers: s.token ? { Authorization: 'Bearer ' + s.token } : {}, ...(s.allow ? { oneAllowedTools: s.allow } : {}), oneDeniedTools: s.deny }]))
    await client.connect(r.servers.map(s => s.name), {}, signal, undefined, config)
    const failed=r.servers.filter(s => !client.probe(s.name, []).connected)
    const unavailable=failed.map(s=>`MCP connection ${s.name}: ${client.failureReason(s.name)}`)
    if (failed.length===r.servers.length) throw new Error(unavailable[0])
    if (r.action === 'search') {
      let chars=0
      const tools=client.search(r.query).filter(t => { const size=JSON.stringify(t).length; if(chars+size>12000)return false;chars+=size;return true })
      return { tools: JSON.parse(client.redact(JSON.stringify(tools))),...(unavailable.length?{unavailable}: {}) }
    }
    if (r.action === 'call') {
      if(failed.some(s=>s.name===r.server))throw new Error(`MCP connection ${r.server}: ${client.failureReason(r.server)}`)
      const tool = client.catalog().find(t => t.server === r.server && t.name === r.name)
      if (!tool || !new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(r.arguments).valid) throw new Error('MCP tool is unavailable or arguments do not match its schema.')
      return { result: await client.call(r.server, r.name, r.arguments, signal) }
    }
    const tools: WorkerMcpTool[] = client.catalog().slice(0, 120).map((t, i) => ({ name: 'remote_mcp_' + i, server: t.server, tool: t.name, description: `[${t.server} / ${t.name}] ${t.description ?? ''}`, parameters: t.inputSchema }))
    return { tools: JSON.parse(client.redact(JSON.stringify(tools))),...(unavailable.length?{unavailable}: {}) }
  } finally { await client.close() }
}
