import {test,expect,openApp,createPage,doc,para,wsEval,MOD} from './fixtures'
import {DEFAULT_CLAUDE_MODEL} from '../../src/shared/ai/models'

test('compiled tasks offer schema-owned fields, explicit null/false and a zero-inference missing-input check',async({page,aiNet},info)=>{
 await openApp(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-test-key'}));await page.evaluate(async model=>(await (window as any).__oneAI.rules()).setDeviceDefault([{p:'anthropic',m:model}]),DEFAULT_CLAUDE_MODEL)
 const source=await createPage(page,{title:'Workshop source',content:doc(para('When a measurement starts, the logger records its original start time.'))})
 await page.keyboard.press(`${MOD}+j`);await page.getByRole('button',{name:'Saved compiled programs',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:'New program',exact:true}).click()
 const editor=dialog.getByRole('textbox',{name:'Executable JSON definition'}),spec=JSON.parse(await editor.inputValue())
 spec.parameters={source:{schema:{type:'string',minLength:1},default:source},audience:{schema:{type:'string',minLength:3}},language:{schema:{type:'string',enum:['de','en']},default:'de'},include_questions:{schema:{type:'boolean'}},options:{schema:{type:'object',properties:{ref:{type:'integer',minimum:1},note:{type:'string'}},required:['ref','note'],additionalProperties:false},default:{ref:42,note:'Keep the original source'}}}
 spec.steps[0].args.object.id.input='source'
 await editor.fill(JSON.stringify(spec,null,2));await dialog.getByLabel('Name',{exact:true}).fill('Guided source briefing');await dialog.getByRole('button',{name:'Compile and save',exact:true}).click()
 await expect(dialog.getByLabel('Source page',{exact:true})).toHaveValue(source);await expect(dialog.getByRole('button',{name:'Run this version',exact:true})).toBeDisabled()
 await expect(dialog.getByLabel('audience',{exact:true})).toHaveAccessibleDescription('At least 3 characters · Required')
 await dialog.getByRole('button',{name:'Check what is still missing',exact:true}).click();await expect(dialog.getByRole('region',{name:'Readiness check for this run'})).toContainText('audience: required input is missing.');await expect(dialog.getByRole('region',{name:'Readiness check for this run'})).toContainText('include_questions: required input is missing.')
 await dialog.getByLabel('audience',{exact:true}).fill('Kai and Kristin');await dialog.getByLabel('include_questions',{exact:true}).selectOption('false');await dialog.getByLabel('language',{exact:true}).selectOption('en')
 await dialog.getByLabel('options.ref',{exact:true}).fill('-');await expect(dialog.getByLabel('options.ref',{exact:true})).toHaveValue('-');await expect(dialog.getByLabel('options.note',{exact:true})).toHaveValue('Keep the original source');await expect(dialog.getByRole('button',{name:'Run this version',exact:true})).toBeDisabled()
 await dialog.getByLabel('options.ref',{exact:true}).fill('43');await expect(dialog.getByRole('button',{name:'Run this version',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Check what is still missing',exact:true}).click();await expect(dialog.getByRole('region',{name:'Readiness check for this run'})).toContainText('Local checks passed')
 await dialog.getByRole('button',{name:'Edit as JSON',exact:true}).click();expect(JSON.parse(await dialog.getByLabel('audience',{exact:true}).inputValue())).toBe('Kai and Kristin');expect(JSON.parse(await dialog.getByLabel('include_questions',{exact:true}).inputValue())).toBe(false);expect(JSON.parse(await dialog.getByLabel('options',{exact:true}).inputValue())).toEqual({ref:43,note:'Keep the original source'})
 await dialog.getByRole('button',{name:'Show input fields',exact:true}).click();await dialog.getByLabel('audience',{exact:true}).fill('x');await expect(dialog.getByRole('button',{name:'Run this version',exact:true})).toBeDisabled();await expect(dialog.getByRole('region',{name:'Readiness check for this run'})).toContainText('Inputs or settings changed')
 await expect(dialog.getByLabel('audience',{exact:true})).toHaveAttribute('aria-invalid','true')
 for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[390,844]]){await page.setViewportSize({width,height});await wsEval(page,(s,theme)=>s.updateSettings({theme}),theme);await dialog.getByRole('region',{name:'Inputs for this run',exact:true}).scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`inputs-${theme}-${width}.png`),animations:'disabled'})}
 expect(aiNet.count('anthropic')).toBe(0);expect(aiNet.count('openai')).toBe(0)
})


test('a BA / PO recipe can be created from a real heading without JSON or starting a model request',async({page,aiNet})=>{
 await openApp(page)
 const source=await createPage(page,{title:'Measurement requirements',content:doc({type:'heading',attrs:{level:2},content:[{type:'text',text:'S9 · Measurement start'}]},para('When a measurement starts, the logger records the original start time.'))})
 await page.keyboard.press(`${MOD}+j`);await page.getByRole('button',{name:'Saved compiled programs',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:'New BA / PO task',exact:true}).click()
 const recipe=dialog.getByRole('region',{name:'Prepare a BA / PO analysis'});await recipe.getByLabel('Source page',{exact:true}).selectOption(source)
 const focus=recipe.getByLabel('Section or topic · optional',{exact:true});await focus.press('Alt+ArrowDown');await page.getByRole('option',{name:'S9 · Measurement start',exact:true}).click()
 await recipe.getByRole('button',{name:'PO · critique requirements',exact:true}).click();await recipe.getByLabel('Name',{exact:true}).fill('Kai · bounded PO review');await recipe.getByRole('button',{name:'Save recipe and review start',exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Kai · bounded PO review',exact:true})).toBeVisible();await expect(dialog.getByLabel('Source page',{exact:true})).toHaveValue(source);await expect(dialog).toContainText('/po S9 · Measurement start')
 await expect(dialog.getByRole('button',{name:'Run this version',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Quantum space',exact:true}).click();await expect(dialog).toContainText('No run evidence yet');await expect(dialog.locator('.quantum-cube [data-status=verified]')).toHaveCount(0)
 expect(aiNet.count('anthropic')).toBe(0)
})
