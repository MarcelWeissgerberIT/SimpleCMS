import type { WorkerFunction } from '@/shared/ai/worker'
import type { AgentTool } from './tools'
import { AIError } from '../core/errors'

/** Small-model discovery: expose only the schemas needed for the current step.
 * These wrappers grant no new tools; run.ts still enforces the original scope and staged writes. */
export const LOCAL_WORKSPACE_FUNCTIONS: WorkerFunction[] = [
  {name:'one_workspace_search',description:'Discover ONE workspace tools by keyword or exact name. Returns up to three permitted tool names, descriptions and argument schemas. Discover before calling.',parameters:{type:'object',properties:{query:{type:'string',maxLength:200}},required:['query'],additionalProperties:false}},
  {name:'one_workspace_call',description:'Call an exact ONE workspace tool whose schema ONE has provided, either as a basic native reader or through one_workspace_search. Pass its exact name and arguments matching that schema. Writing tools require discovery and stage proposals for review.',parameters:{type:'object',properties:{name:{type:'string'},arguments:{type:'object'}},required:['name','arguments'],additionalProperties:false}},
]
export const LOCAL_WORKSPACE_GUIDE = '\n\nThe permitted basic ONE readers get_current_page, search_pages and read_page are directly callable when present in your native function list; their full schemas are already loaded. For other ONE tools, first use one_workspace_search, then one_workspace_call with the discovered name and arguments. MCP uses the separate one_mcp_search / one_mcp_call wrappers. Never simulate a tool result or ask the person to load tool descriptions.'
export const LOCAL_DISCOVERY_REPAIR = 'No tool was executed. Discover the permitted tool first: ONE workspace tools use one_workspace_search, then one_workspace_call with the exact discovered name and valid arguments. External Atlas/MCP tools use one_mcp_search, then one_mcp_call with the exact discovered server and name. These are separate tool catalogs. This is the only discovery-correction retry; do not invent tool results or bypass permissions.'
export function localWorkspaceTools(tools: AgentTool[]) {
  // These are already in the caller's permitted scope. Exposing their schemas is
  // not a read or a permission grant; normal dispatch/data/source checks still run.
  const basic = tools.filter(t=>!t.write&&['get_current_page','search_pages','read_page'].includes(t.name))
  const definition = (t:AgentTool) => ({name:t.name,description:t.description.slice(0,400),parameters:t.input_schema})
  const seen = new Set<string>(basic.map(t=>t.name))
  const repaired = new Set<string>()
  return {
    functions: basic.map(definition),
    direct(name:string) { return basic.find(t=>t.name===name) },
    correction(input:Record<string,unknown>) {
      const name=typeof input.name==='string'?input.name:''
      if(repaired.has(name)||repaired.size>=3)return null
      repaired.add(name)
      const tool=tools.find(t=>t.name===name)
      // Only supply a missing read schema automatically. Writes still require
      // explicit discovery, then the existing proposal/compiled task gates.
      if(tool&&!tool.write){seen.add(name);return JSON.stringify({notExecuted:true,tool:definition(tool),note:'ONE loaded the permitted read schema. No read has run yet. Call this exact tool through one_workspace_call with name and arguments matching the schema. Do not ask the person to install or enable tools.'})}
      return LOCAL_DISCOVERY_REPAIR
    },
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
