import type { WorkerFunction } from '@/shared/ai/worker'
import type { AgentTool } from './tools'
import { AIError } from '../core/errors'

/** Small-model discovery: expose only the schemas needed for the current step.
 * These wrappers grant no new tools; run.ts still enforces the original scope and staged writes. */
export const LOCAL_WORKSPACE_FUNCTIONS: WorkerFunction[] = [
  {name:'one_workspace_search',description:'Discover ONE workspace tools by keyword or exact name. Returns up to three permitted tool names, descriptions and argument schemas. Discover before calling.',parameters:{type:'object',properties:{query:{type:'string',maxLength:200}},required:['query'],additionalProperties:false}},
  {name:'one_workspace_call',description:'Call an exact ONE workspace tool discovered with one_workspace_search. Pass its exact name and arguments matching the returned schema. Writing tools stage proposals for review.',parameters:{type:'object',properties:{name:{type:'string'},arguments:{type:'object'}},required:['name','arguments'],additionalProperties:false}},
]
export const LOCAL_WORKSPACE_GUIDE = '\n\nFor ONE tools named in these instructions, first use one_workspace_search with their exact name or keywords, then one_workspace_call with the discovered name and arguments. Only these wrapper functions are directly callable. MCP uses the separate one_mcp_search / one_mcp_call wrappers. Never simulate a tool result.'
export function localWorkspaceTools(tools: AgentTool[]) {
  const seen = new Set<string>()
  return {
    search(input: Record<string,unknown>) {
      if(typeof input.query!=='string'||input.query.length>200)throw new AIError('capability','Invalid workspace discovery query.')
      const query=input.query.toLowerCase().trim(),terms=query.split(/\s+/).filter(Boolean)
      const found=tools.map(t=>({t,score:t.name===query?100:terms.reduce((n,w)=>n+(t.name.toLowerCase().includes(w)?3:t.description.toLowerCase().includes(w)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3)
      let size=0
      const result=found.map(({t})=>({name:t.name,description:t.description.slice(0,500),parameters:t.input_schema})).filter(t=>{const n=JSON.stringify(t).length;if(size+n>7500)return false;size+=n;return true})
      for(const t of result)seen.add(t.name)
      return JSON.stringify({tools:result})
    },
    resolve(input: Record<string,unknown>) {
      if(typeof input.name!=='string'||!seen.has(input.name)||!input.arguments||typeof input.arguments!=='object'||Array.isArray(input.arguments))throw new AIError('capability','features.ai.local.discovery')
      const tool=tools.find(t=>t.name===input.name)
      if(!tool)throw new AIError('capability')
      return {tool,input:input.arguments as Record<string,unknown>}
    },
  }
}
