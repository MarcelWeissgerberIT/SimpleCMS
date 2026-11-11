import {test} from 'node:test'
import assert from 'node:assert/strict'
import {connectionProblem,mcpConnectionMessage} from '../../src/shared/ai/connection-problem.ts'
test('authentication, permissions, TLS, schema and size failures remain distinct without exposing input',()=>{
 for(const [error,expected] of [[new Error('HTTP 401 token secret'),'auth'],[{status:403,message:'Forbidden secret'},'permission'],['Attachment permission refused by Atlas. secret','permission'],['AJ-Atlas hat diesen persönlichen Token abgelehnt.','auth'],[{code:'mcp_arguments_invalid',message:'secret'},'schema'],[new Error('Program: unsupported schema propertyNames'),'schema'],[new Error('MCP result exceeds the bounded source cache'),'limit'],[new Error('self signed certificate'),'tls'],[{message:'fetch failed',cause:{code:'ENOTFOUND'}},'network'],[new Error('Connection timed out.'),'timeout']] as const){
  assert.equal(connectionProblem(error),expected)
  assert.ok(!mcpConnectionMessage(error).includes('secret'))
 }
 assert.notEqual(connectionProblem({status:403}),'auth')
 assert.equal(connectionProblem('worker'),'worker')
 assert.equal(connectionProblem('not a known error'),'unknown')
})
test('safe diagnostic text keeps its category when the UI classifies it again',()=>{
 const cases=[{status:401},{status:403},{status:429},{status:503},'invalid_query: unknown operator','TLS certificate failed','Connection timed out','fetch failed','worker','identity','policy','tools','mcp_arguments_invalid','Invalid MCP tool response','response_limit','unclassified']
 for(const error of cases) {
  assert.equal(connectionProblem(mcpConnectionMessage(error)),connectionProblem(error),JSON.stringify(error))
  assert.equal(connectionProblem('MCP connection atlas: '+mcpConnectionMessage(error)),connectionProblem(error),JSON.stringify(error))
 }
 assert.equal(connectionProblem({status:401,message:'permission denied'}),'auth')
 assert.equal(connectionProblem({status:403,message:'invalid token'}),'permission')
 for(const error of ['token expired','expired token','authentication failed'])assert.equal(connectionProblem(error),'auth')
})
test('search syntax, provider limits and server failures give bounded remedies without exposing raw secrets',()=>{
 for(const [error,expected] of [["Error: Invalid AQL: operator '=' is not valid for field 'tags' (array)",'query'],['invalid_query: token-secret unsupported operator','query'],['Could not parse AQL query token-secret','query'],[{status:429,message:'token-secret'},'rate'],[{status:503,message:'token-secret'},'server'],[{status:502,message:'Authentication rejected by this endpoint token-secret'},'auth'],['MCP error -32602 invalid params token-secret','schema']] as const){
  assert.equal(connectionProblem(error),expected)
  assert.ok(!mcpConnectionMessage(error,'call').includes('token-secret'))
 }
 assert.ok(!mcpConnectionMessage('unclassified','call').includes('personal worker'))
})

test('a missing snapshot path is a source gap, not an authentication or worker failure',()=>{
 const raw=JSON.stringify({content:[{type:'text',text:'Error: Path not found in this snapshot. private-path-secret'}],isError:true})
 assert.equal(connectionProblem(raw),'source_missing')
 const safe=mcpConnectionMessage(raw,'call')
 assert.equal(connectionProblem(safe),'source_missing')
 assert.match(safe,/same repository and snapshot/)
 assert.doesNotMatch(safe,/private-path-secret|token|sign-in|worker unavailable/i)
 assert.equal(connectionProblem({status:403,message:raw}),'permission')
})

test('pre-dispatch task restrictions are distinct from provider policy and authentication',()=>{
 assert.equal(connectionProblem('Compiled task blocked this action. Read-only bounds, an unresolved decision prevent dispatch.'),'task_boundary')
 assert.equal(connectionProblem('A data policy blocks the selected MCP destination or tool.'),'policy')
 assert.match(mcpConnectionMessage('Compiled task blocked this action.'),/no external request was sent/)
})
