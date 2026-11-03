import {test,expect,openApp,wsEval,MOD} from './fixtures'
import {mockClaudeScript,text} from './helpers/providers'
test('ordinary completed and failed terminal tasks survive reload as private receipts, not executable programs',async({page,errors})=>{
 errors.allow(/console.error: Failed to load resource:.*400/u)
 await openApp(page);await wsEval(page,s=>s.updateSettings({aiApiKey:'sk-ant-e2e-receipt'}))
 await page.getByRole('button',{name:'My compiled tasks',exact:true}).click();await page.getByRole('button',{name:'Run receipts',exact:true}).click()
 await mockClaudeScript(page,[text('First answer retained.'),{status:400,json:{type:'error',error:{type:'invalid_request_error',message:'Synthetic request failure'}}}])
 await page.keyboard.press(`${MOD}+j`);const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
 await input.fill('Say hello to the team.');await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Done');await expect(term).toContainText('Personal run receipt saved.');await expect(page.locator('.programs__history > details')).toHaveCount(1)
 await input.fill('Give me one more greeting.');await input.press('Enter');await expect(term.locator('.term-head__status')).toHaveText('Error');await expect(term.locator('.term-turn').last()).toContainText('Personal run receipt saved.');await expect(page.locator('.programs__history > details')).toHaveCount(2)
 await term.getByRole('button',{name:'Saved compiled programs'}).click();let dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:'Run receipts',exact:true}).click();await expect(dialog.locator('.programs__history > details')).toHaveCount(2)
 await dialog.locator('.programs__history > details > summary').first().click();await expect(dialog).toContainText('Synthetic request failure');await expect(dialog).toContainText('Terminal receipt')
 await page.reload();await expect(page.getByRole('main')).toBeVisible();await page.keyboard.press(`${MOD}+j`);await page.getByRole('region',{name:'AI terminal'}).getByRole('button',{name:'Saved compiled programs'}).click();dialog=page.getByRole('dialog',{name:'Saved compiled programs'});await dialog.getByRole('button',{name:'Run receipts',exact:true}).click();await expect(dialog.locator('.programs__history > details')).toHaveCount(2);await dialog.locator('.programs__history > details > summary').last().click();await expect(dialog).toContainText('First answer retained.')
})
