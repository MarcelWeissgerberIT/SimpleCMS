import {canonicalJson} from './duplicates.ts'
/** Native inference schemas for tools discovered on the person's selected MCP connections.
 * This registry grants no access: execution still uses the authenticated MCP path and schema checks. */
export interface DiscoveredMcpTool {server:string;name:string;description?:string;inputSchema:Record<string,any>}

export function selectMcpSchemas<T>(tools:T[],budget:number):T[] {
  let size=0
  return tools.filter((tool,index)=>{
    const length=JSON.stringify(tool).length
    // The first, best match must survive even if its schema exceeds the soft discovery budget.
    if(index>0&&size+length>budget)return false
    size+=length
    return true
  })
}

export class McpBindings {
  private bindings=new Map<string,{tool:DiscoveredMcpTool;native:string}>()
  private active:string[]=[]
  private priority:string[]=[]
  expose(tools:DiscoveredMcpTool[]) {
    const latest=tools.map(tool=>JSON.stringify([tool.server,tool.name]))
    this.priority=[...latest,...this.priority.filter(key=>!latest.includes(key))].slice(0,6)
    for(const tool of tools){
      const key=JSON.stringify([tool.server,tool.name])
      if(!this.bindings.has(key))this.bindings.set(key,{tool,native:'one_remote_'+(this.bindings.size+1)})
      else this.bindings.get(key)!.tool=tool
      this.active=this.active.filter(k=>k!==key)
      this.active.push(key)
      if(this.active.length>6)this.active.shift()
    }
  }
  functionName(server:string,name:string){return this.bindings.get(JSON.stringify([server,name]))?.native}
  functions(budget?:number){
    const keys=budget===undefined?this.active:this.priority.filter(key=>this.active.includes(key))
    const functions=keys.map(key=>{const {tool,native}=this.bindings.get(key)!;return {name:native,description:`[${tool.server} / ${tool.name}] ${tool.description??''}`,parameters:tool.inputSchema}})
    return budget===undefined?functions:selectMcpSchemas(functions,budget)
  }
  has(name:string){return [...this.bindings.values()].some(b=>b.native===name)}
  invocation(name:string,args:Record<string,unknown>){
    if(this.has(name))return this.resolve(name,args)
    if(name==='one_mcp_call'&&typeof args.server==='string'&&typeof args.name==='string'&&args.arguments&&typeof args.arguments==='object'&&!Array.isArray(args.arguments))return {server:args.server,name:args.name,arguments:args.arguments as Record<string,unknown>}
    return null
  }
  callKey(name:string,args:Record<string,unknown>){return canonicalJson(this.invocation(name,args)??[name,args])}
  resolve(name:string,args:Record<string,unknown>){
    const binding=[...this.bindings.values()].find(b=>b.native===name)
    if(!binding)throw new Error('Use a discovered MCP function.')
    return {server:binding.tool.server,name:binding.tool.name,arguments:args}
  }
}
