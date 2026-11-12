import {test,expect,email,signIn,createWorkspace,openApp,waitOnline} from './fixtures'
test('a cloud workspace restores its terminal after authentication and document hydration',async({page})=>{
 await signIn(page,email('terminal-reload'))
 const workspace=await createWorkspace(page,'Terminal reload cloud')
 await openApp(page,workspace);await waitOnline(page)
 await page.keyboard.press('Meta+j')
 const term=page.getByRole('region',{name:'AI terminal'}),input=term.getByRole('textbox',{name:'Task for the agent'})
 await expect(input).toBeVisible();await input.fill('Prepared cloud sync draft')
 await expect.poll(()=>page.evaluate(async()=>{if(!(await indexedDB.databases()).some(d=>d.name==='one-mcp-work'))return false;return new Promise<boolean>(resolve=>{const request=indexedDB.open('one-mcp-work');request.onsuccess=()=>{const db=request.result;const query=db.transaction('records').objectStore('records').get('rows');query.onsuccess=()=>{resolve((query.result??[]).some((r:any)=>r.key.startsWith('terminal-tab:')&&r.value.includes('Prepared cloud sync draft')));db.close()}}})})).toBe(true)
 await page.reload();await page.waitForFunction(()=>!!(window as any).__one);await waitOnline(page)
 await expect(term).toBeVisible();await expect(input).toHaveValue('Prepared cloud sync draft')
})
