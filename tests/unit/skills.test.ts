import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bindSkill,readSkill,parseSkillFile,parseSkillMarkdown,skillMarkdown,skillRequest,resolveSkills,pinSkillRequest,skillReceipt} from '../../src/shared/ai/skills.ts'
import {parseCodewords} from '../../src/app/features/ai/mcp-servers/codeword.ts'
import {taskBoundaries} from '../../src/shared/quandprofile/task.ts'
const spec={name:'requirements',description:'Review requirements',tags:['BA'],instructions:'Separate sources, assumptions and open questions.'}
test('Markdown instructions round-trip, preserve multiline descriptions and keep tool metadata inert',()=>{
 assert.deepEqual(parseSkillMarkdown(skillMarkdown(spec)),spec)
 const s=parseSkillMarkdown('---\nname: requirements\ndescription: >\n  Review current\n  requirements\nallowed-tools: shell\nmetadata:\n  name: ignored\n---\n\nNever automatically run scripts.\n')
 assert.equal(s.description,'Review current requirements');assert.equal(s.name,'requirements');assert(!('allowed-tools' in s));assert.equal(s.instructions,'Never automatically run scripts.')
 for(const md of ['# no metadata','---\nname: requirements\nname: other\ndescription: test\n---\nBody','---\nname: ../bad\ndescription: test\n---\nBody'])assert.throws(()=>parseSkillMarkdown(md))
})
test('exact versions are frozen and unknown versions cannot silently pick the latest',()=>{
 const a=bindSkill('skill-1',1,spec),b=bindSkill('skill-1',2,{...spec,instructions:'New guidance'})
 assert.equal(resolveSkills('$requirements@1 task',[b,a])[0].hash,a.hash)
 assert.equal(resolveSkills('$requirements task',[b,a])[0].hash,b.hash)
 assert.throws(()=>resolveSkills('$requirements@3 task',[b,a]));assert.throws(()=>readSkill({...a,spec:{...spec,instructions:'Modified'}}))
 assert.deepEqual(resolveSkills('Calculate $amount without changing data',[b,a]),[])
 assert.equal(pinSkillRequest('Review $requirements',[skillReceipt(a)]),'Review $requirements@1~'+a.hash)
})
test('selectors never derive permission from skill instructions or quoted examples',()=>{
 assert.deepEqual(skillRequest('Explain "$requirements" and `$requirements@1`').names,[])
 const raw='$requirements@1 atlas:comment einfügen',clean=skillRequest(raw)
 const parsed=parseCodewords(raw,[{name:'knowledge',codeword:'atlas',enabled:true}] as any)
 assert.equal(parsed.text,'comment einfügen');assert.equal(parsed.servers[0].name,'knowledge')
 assert.equal(taskBoundaries(parseCodewords(clean.text,[{name:'knowledge',codeword:'atlas',enabled:true}] as any).text).externalWrite,true)
 assert.equal(taskBoundaries(skillRequest('$requirements@1 Nur lesen.').text).externalWrite,false)
})

test('portable ONE exports preserve immutable versions and recipe hashes reject different guidance',()=>{
 const a=bindSkill('portable',2,spec),other=bindSkill('other',2,{...spec,instructions:'Different guidance'})
 assert.deepEqual(parseSkillFile(skillMarkdown(spec,a)).snapshot,a)
 assert.equal(pinSkillRequest('Explain `'+ '$requirements@2' +'`',[skillReceipt(a)]),'Explain `$requirements@2`')
 assert.throws(()=>skillMarkdown({...spec,instructions:'Changed'},a))
 const pinned=pinSkillRequest('$requirements@2 task',[skillReceipt(a)])
 assert.equal(resolveSkills(pinned,[a])[0].hash,a.hash)
 assert.throws(()=>resolveSkills(pinned,[other]))
 assert.throws(()=>parseSkillFile(skillMarkdown(spec,a).replace(a.hash,'0'.repeat(64))))
})
