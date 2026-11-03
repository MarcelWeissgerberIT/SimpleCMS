import {test} from 'node:test'
import assert from 'node:assert/strict'
import {matchingSuggestions,similarSpelling} from '../../src/app/ui/valueSuggestionModel.ts'
import {changeTypedRecipe} from '../../src/app/features/ai/profiles/typedRecipe.ts'
import {typedTemplate,resolveTypedAI,type TypedSource} from '../../src/shared/quandprofile/typed-ai.ts'
const rule:TypedSource={kind:'rule',server:'atlas',origin:'https://atlas.example.org',tenant:'aj',project:'lab',ref:42,hash:'a'.repeat(64),stateHash:'b'.repeat(64),quote:'Laboratory rule version five applies.',binding:'rule:lab-rules@5'}
test('choices rank alternatives before current value and spelling matches before others, without normalising the stored input',()=>{
 const options=[{value:'Backend'},{value:'Frontend'},{value:'frontend '}]
 assert.deepEqual(matchingSuggestions(options,'frontend ').map(o=>o.value),['Frontend','Backend','frontend '])
 assert.equal(similarSpelling({value:'Frontend'},' frontend '),true)
 assert.equal(matchingSuggestions(options,'front')[0]?.value,'Frontend')
 assert.equal(matchingSuggestions(options,'Unknown').length,0)
})
test('BA to PO preserves exact versioned rule bindings in the same domain and remains structurally resolvable',()=>{
 const old=typedTemplate('ba');old.tags.push({kind:'rule',value:'lab-rules',version:'5'});old.sources.push(rule)
 const {next,kept}=changeTypedRecipe(old,'po')
 assert.equal(next.tags.find(t=>t.kind==='operation')?.value,'po');assert.deepEqual(next.sources,[rule]);assert.deepEqual(kept,['rule:lab-rules@5']);assert.equal(resolveTypedAI(next).status,'ready');assert.equal(old.tags.find(t=>t.kind==='operation')?.value,'ba')
})
test('a preset domain change drops bindings of uncertain applicability and names them; a custom domain stays explicit',()=>{
 const old=typedTemplate('ba');old.tags.push({kind:'rule',value:'lab-rules',version:'5'});old.sources=[rule]
 const changed=changeTypedRecipe(old,'mock');assert.equal(changed.next.sources.length,0);assert.ok(changed.removed.includes(rule.binding))
 old.tags[0]!.value='laboratory';const custom=changeTypedRecipe(old,'mock');assert.equal(custom.next.tags[0]!.value,'laboratory');assert.deepEqual(custom.next.sources,[rule])
})
test('a compatible custom shadow is retained; incompatible shadow bindings are removed explicitly',()=>{
 const old=typedTemplate('ba');old.shadows[0]!.id='aj.ba';old.sources=[{...rule,kind:'shadow',binding:'aj.ba@1'}]
 assert.equal(changeTypedRecipe(old,'ba').next.sources[0]?.binding,'aj.ba@1')
 const result=changeTypedRecipe(old,'pm');assert.equal(result.next.sources.length,0);assert.ok(result.removed.includes('aj.ba@1'));assert.equal(resolveTypedAI(result.next).status,'ready')
})
