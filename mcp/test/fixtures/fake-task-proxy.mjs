#!/usr/bin/env node
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js'
const server=new Server({name:'one-task-proxy-fixture',version:'1'},{capabilities:{tools:{}}})
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[
 {name:'one_task_mcp_search',description:'Discover the selected personal Atlas tools',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
 {name:'one_task_mcp_call',description:'Call only the selected personal Atlas tool',inputSchema:{type:'object',properties:{server:{type:'string'},name:{type:'string'},arguments:{type:'object'}},required:['server','name','arguments']}}
]}))
server.setRequestHandler(CallToolRequestSchema,r=>{
 const a=r.params.arguments||{}
 if(r.params.name==='one_task_mcp_search')return {content:[{type:'text',text:JSON.stringify([{server:'atlas-my-agent',name:'atlas_get',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']},readOnly:true}])}]}
 if(r.params.name==='one_task_mcp_call'&&a.server==='atlas-my-agent'&&a.name==='atlas_get'&&a.arguments?.ref===43)return {content:[{type:'text',text:'Actual proxy result: Atlas record 43 is the approved requirement.'}]}
 return {isError:true,content:[{type:'text',text:'Tool not granted.'}]}
})
await server.connect(new StdioServerTransport())
