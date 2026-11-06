import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readUIProject,editUIComponent,componentPackage} from '../../src/shared/uiInstructions/project.ts'
import {parseSpecification} from '../../src/shared/uiInstructions/spec.js'
const manifest={version:1,definitions:[{id:'C001',name:'Panel',kind:'Panel'},{id:'C002',name:'Button',kind:'Button'}],trees:[{id:'T1',name:'Main',width:1440,nodes:[{id:'N1',componentId:'C001',parentId:null},{id:'N2',componentId:'C002',parentId:'N1'}]}]}
const md=(m:any=manifest)=>['C001','C002'].map(id=>`<!-- ui-component:${id}:start -->\n# ${id}\nKomponenten-ID: ${id}\nOriginal contract.\n<!-- ui-component:${id}:end -->`).join('\n\n')+'\n<!-- ui-manifest:start -->\n```json\n'+JSON.stringify(m)+'\n```\n<!-- ui-manifest:end -->'
test('project import preserves supported settings and contracts but excludes credentials',()=>{
 const project=readUIProject(JSON.stringify({format:'component-studio-project',version:1,settings:{project:'UI',token:'SECRET','build-stack':'React'},markdown:md()}))
 assert.equal(project.settings['build-stack'],'React');assert.ok(!JSON.stringify(project).includes('SECRET'))
 const changed=editUIComponent(project,'C002','# Button\nKomponenten-ID: C002\nUpdated contract.')
 assert.match(changed.markdown,/Updated contract/);assert.match(changed.markdown,/Original contract/)
 assert.match(componentPackage(changed,'C001'),/Updated contract/)
 assert.throws(()=>editUIComponent(changed,'C002','<!-- ui-manifest:start -->'))
})
test('invalid trees and unsafe thumbnails are rejected before rendering',()=>{
 const bad=structuredClone(manifest);bad.trees[0].nodes[0].parentId='N2' as any;assert.equal(parseSpecification(md(bad)).valid,false)
 const label=structuredClone(manifest);Object.assign(label.trees[0].nodes[0],{label:{bad:true}});assert.equal(parseSpecification(md(label)).valid,false)
 const image=structuredClone(manifest);Object.assign(image.definitions[0],{thumbnail:{dataUrl:'data:image/svg+xml;base64,abc',width:1,height:1}});assert.equal(parseSpecification(md(image)).valid,false)
 assert.throws(()=>readUIProject(md().replace('Komponenten-ID: C001','Komponenten-ID: WRONG')))
})
