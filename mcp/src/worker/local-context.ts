import type { taskPacket } from './local-packet.ts'

/** Fit optional bootstrap references, never the assigned task, policy, tools or project instructions. */
export function initialContext(system: string, task: string, tools: unknown[], project: Array<{path:string;text:string}>, original: Awaited<ReturnType<typeof taskPacket>>, limit: number, history: Array<{role:string;content:string}> = []) {
  const packet = structuredClone(original)
  const refs = [...project]
  const deferred: string[] = []
  let lazyMethods = false
  const messages = () => [{role:'system',content:system + '\nProject guidance and reference:\n' + refs.map(r=>r.text).join('')
    + (deferred.length ? '\nDeferred project excerpts (not read; retrieve relevant passages with read_file): '+deferred.join(', ') : '')
    + '\nPrepared task packet (bounded reference):\n' + JSON.stringify({...packet,...(lazyMethods?{methods:packet.methods.map(({text:_,...meta})=>meta),methodNote:'Method text deferred; use skill_read with the exact ID when needed.'}:{})})}, {role:'user',content:task}, ...history]
  const size = () => JSON.stringify({messages:messages(),tools}).length
  const before = size()
  while (size()>limit && packet.sourceMap.entries.length) { packet.sourceMap.entries.pop(); packet.sourceMap.incomplete=true }
  // Keep AGENTS/CLAUDE guidance intact. Other excerpts remain addressable through the same read-only file tools.
  for (let i=refs.length-1; i>=0 && size()>limit; i--) {
    if (['AGENTS.md','CLAUDE.md'].includes(refs[i]!.path)) continue
    deferred.push(refs[i]!.path); refs.splice(i,1)
  }
  if(size()>limit)lazyMethods=true
  return {messages:messages(),before,after:size(),deferred,sourcePointers:packet.sourceMap.entries.length,lazyMethods}
}
