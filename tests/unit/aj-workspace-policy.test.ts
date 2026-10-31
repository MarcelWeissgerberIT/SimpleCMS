import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sanitizeWorkspaceAI,allowedFor} from '../../src/shared/ai/policy.ts'

const onboarding={startPageId:'ajStart',mcpUrl:'https://aj-atlas.com/api/atlas/mcp',mcpName:'aj-atlas',project:'CNSx',skipIntro:true}
test('team onboarding carries no credentials and accepts only the reviewed AJ endpoint',()=>{
 const clean=sanitizeWorkspaceAI({onboarding:{...onboarding,token:'do-not-copy',apiKey:'secret'},sharedMemberContext:true})!
 assert.deepEqual(clean.onboarding,onboarding)
 assert.equal(clean.sharedMemberContext,true)
 for(const mcpUrl of ['https://eh-atlas.com/api/atlas/mcp','https://aj-atlas.com/api/mcp','https://aj-atlas.com/api/atlas/mcp?token=secret','http://127.0.0.1'])assert.equal(sanitizeWorkspaceAI({onboarding:{...onboarding,mcpUrl}})?.onboarding,undefined)
 assert.equal(sanitizeWorkspaceAI({onboarding:{...onboarding,startPageId:'../escape'}})?.onboarding,undefined)
})
test('shared member-context permission never substitutes for the member’s own consent',()=>{
 const ws=sanitizeWorkspaceAI({onboarding,sharedMemberContext:true,policy:{providers:{local:{allow:['page','rows','files']}},restricted:[]}})!
 assert.equal(allowedFor('local','page',ws),true)
 assert.equal(allowedFor('local','mcp',ws),false)
 assert.equal(allowedFor('local','private',ws),false)
 assert.equal(allowedFor('local','mcp',ws,{allow:{local:['mcp']}}),true)
 assert.equal(allowedFor('local','mcp',ws,{allow:{local:['mcp']},narrow:{local:['mcp']}}),false)
 assert.equal(allowedFor('local','mcp',{...ws,policy:{providers:{local:{allow:['page'],forbid:['mcp']}},restricted:[]}},{allow:{local:['mcp']}}),false)
})
