import {test} from 'node:test'
import assert from 'node:assert/strict'
import {connectionProblem,mcpConnectionMessage} from '../../src/shared/ai/connection-problem.ts'
test('authentication, permissions, TLS, schema and size failures remain distinct without exposing input',()=>{
 for(const [error,expected] of [[new Error('HTTP 401 token secret'),'auth'],[{status:403,message:'Forbidden secret'},'permission'],['AJ-Atlas hat diesen persönlichen Token abgelehnt.','auth'],[{code:'mcp_arguments_invalid',message:'secret'},'schema'],[new Error('Program: unsupported schema propertyNames'),'schema'],[new Error('MCP result exceeds the bounded source cache'),'limit'],[new Error('self signed certificate'),'tls'],[{message:'fetch failed',cause:{code:'ENOTFOUND'}},'network'],[new Error('Connection timed out.'),'timeout']] as const){
  assert.equal(connectionProblem(error),expected)
  assert.ok(!mcpConnectionMessage(error).includes('secret'))
 }
 assert.notEqual(connectionProblem({status:403}),'auth')
 assert.equal(connectionProblem('worker'),'worker')
 assert.equal(connectionProblem('not a known error'),'unknown')
})
test('safe diagnostic text keeps its category when the UI classifies it again',()=>{
 const cases=[{status:401},{status:403},'TLS certificate failed','Connection timed out','fetch failed','worker','identity','policy','tools','mcp_arguments_invalid','Invalid MCP tool response','response_limit','unclassified']
 for(const error of cases) {
  assert.equal(connectionProblem(mcpConnectionMessage(error)),connectionProblem(error),JSON.stringify(error))
  assert.equal(connectionProblem('MCP connection atlas: '+mcpConnectionMessage(error)),connectionProblem(error),JSON.stringify(error))
 }
 assert.equal(connectionProblem({status:401,message:'permission denied'}),'auth')
 assert.equal(connectionProblem({status:403,message:'invalid token'}),'permission')
 for(const error of ['token expired','expired token','authentication failed'])assert.equal(connectionProblem(error),'auth')
})
