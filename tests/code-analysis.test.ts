import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readAnalysis,readReport,emptyReport,newAnalysis,newRevision,changes} from '../src/shared/codeAnalysis/model.ts'
const citation={repo:'r',snapshot:'s',commit:'a'.repeat(40),path:'src/handler.ts',lines:[1,2],digest:'b'.repeat(64)}
const report=()=>({...emptyReport(),evidence:[{id:'e',reference:{citation},checkedAt:1}],findings:[{id:'f',title:'Finding',claim:'Observed behavior',impact:'Effect',severity:'high' as const,verdict:'supported' as const,support:['e'],against:[],countercheck:'Configuration remains open',status:'open' as const}]})
test('complete portable reports preserve exact citations',()=>{assert.deepEqual(readReport(report()),report())})
test('unsupported conclusion and unknown evidence links are refused',()=>{const r=report();r.findings[0].support=[];assert.throws(()=>readReport(r));r.findings[0].support=['unknown'];assert.throws(()=>readReport(r))})
test('duplicate finding identities are refused',()=>{const r=report();r.findings.push(r.findings[0]);assert.throws(()=>readReport(r))})
test('sources are bounded and malformed highlights are refused',()=>{const r=report();(r.evidence[0].reference as any).highlight=[0,999];assert.throws(()=>readReport(r));assert.throws(()=>readReport({...emptyReport(),evidence:Array(25).fill(report().evidence[0])}))})
test('ready and accepted require all phases in order',()=>{const a=newAnalysis('a'),r=newRevision(a,'r');a.revisions=[r];assert.deepEqual(readAnalysis(JSON.stringify(a)),a);r.state='ready';assert.throws(()=>readAnalysis(JSON.stringify(a)));r.completed=['challenge'];assert.throws(()=>readAnalysis(JSON.stringify(a)))})
test('active result must exist and be accepted',()=>{const a=newAnalysis('a');a.active='missing';assert.throws(()=>readAnalysis(JSON.stringify(a)))})
test('invalid budgets cannot bypass governor',()=>{for(const budget of [0,-1,101,NaN])assert.throws(()=>readAnalysis(JSON.stringify({...newAnalysis('a'),budget})))})
test('finding comparison tracks citation changes but ignores verification timestamp and human status',()=>{const a=report(),b=report();b.evidence[0].checkedAt=999;(b.findings[0] as any).status='reviewed';assert.equal(changes(a,b)[0].kind,'unchanged');b.evidence[0].reference.citation={...citation,snapshot:'s2'};assert.equal(changes(a,b)[0].kind,'unchanged');b.evidence[0].reference.citation.digest='e'.repeat(64);assert.equal(changes(a,b)[0].kind,'changed')})
test('new revision pins its question and target independent from later settings',()=>{const a=newAnalysis('a');a.question='Original';a.target='old';const r=newRevision(a,'r');a.question='New';a.target='new';assert.equal(r.question,'Original');assert.equal(r.target,'old')})

test('requirements cannot claim support without implementation evidence',()=>{assert.throws(()=>readReport({...emptyReport(),requirements:[{id:'r',text:'Validate',verdict:'supported',implementation:[],tests:[],gap:''}]}))})
