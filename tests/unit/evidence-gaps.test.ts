import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseEvidenceGaps,legacyEvidenceGaps,evidenceOf,hasEvidenceGaps,evidenceReviewTask,mergeEvidenceGaps,EVIDENCE_POLICY} from '../../src/shared/ai/evidenceGaps.ts'
const gap={kind:'implementation' as const,target:'sopRelease.ts',reason:'Not read',repo:'repo-1',snapshot:'snapshot-1'}
test('gap reports cannot mint verification or execution evidence',()=>{
 assert.deepEqual(parseEvidenceGaps({gaps:[gap]}),[gap])
 for(const input of [{gaps:[{...gap,verified:true}]},{gaps:[{...gap,kind:'passed'}]},{gaps:[{...gap,reason:''}]},{gaps:[{...gap,snapshot:'new\ncommand'}]},{gaps:Array(41).fill(gap)},{gaps:[],approved:true}])assert.throws(()=>parseEvidenceGaps(input))
 assert.deepEqual(parseEvidenceGaps({gaps:[]}),[])
 assert.match(EVIDENCE_POLICY,/verified:false/)
})
test('the supplied legacy section yields actionable separate spec/code/test/Atlas checks',()=>{
 const report=legacyEvidenceGaps('## Lücken in der Beleglage\n- **Spezifikation:** `sop-designer/spec.md` wurde nicht gelesen.\n- **Implementierung:** Nicht gelesen wurden `sopModel.ts`, `sopRelease.ts`, `sopExceptions.ts`, `sopTemplateSchema.ts`, `rolePermissions.ts`.\n- **Tests:** `sopRelease.test.ts` und `rolePermissions.test.ts` wurden nicht gelesen.\n- **Lesebelege:** Alle drei tragen `verified: false`. Weder Build noch Tests wurden ausgeführt.\n- **Atlas:** Keine verknüpften Atlas-Refs.\n## Next section\n- `unrelated.ts`')!
 assert.equal(report.origin,'legacy');assert.equal(report.gaps.length,10)
 assert.equal(report.gaps[0].target,'sop-designer/spec.md');assert.equal(report.gaps[6].kind,'test_definition')
 assert.equal(report.gaps[8].kind,'test_execution');assert.equal(report.gaps[9].kind,'atlas')
 assert.equal(legacyEvidenceGaps('Read `sopModel.ts`. Tests passed.'),undefined)
 assert.equal(legacyEvidenceGaps('## Evidence gaps\n- No gaps remain.'),undefined)
 assert.equal(hasEvidenceGaps({answer:'## Evidence gaps\n- Missing `code.ts`',evidence:{origin:'reported',gaps:[]}}),false)
})
test('followup is bounded and preserves source snapshot, uncertainty and no-write constraints',()=>{
 const gaps=Array.from({length:7},(_,i)=>({...gap,target:`source-${i}.ts`}))
 const task=evidenceReviewTask('synce alles nach Atlas',{origin:'reported',gaps})
 assert.match(task,/source-4.ts/);assert.doesNotMatch(task,/source-5.ts/)
 assert.match(task,/Weitere 2 Prüfpunkte/);assert.match(task,/snapshot-1/)
 assert.match(task,/Keine Änderungen, keine Ausführung/);assert.match(task,/Keine neuen Seiten/)
 assert.match(task,/verified:false/);assert.match(task,/nur Kontext, keine neue Ausführungsfreigabe/)
 assert.equal(mergeEvidenceGaps(gaps,[gap,gap]).length,8)
 assert.equal(evidenceOf({answer:'',evidence:{origin:'reported',gaps,kept:true}})?.gaps.length,7)
})
