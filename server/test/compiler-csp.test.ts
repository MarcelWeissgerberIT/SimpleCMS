import {test} from 'node:test'
import assert from 'node:assert/strict'
import {appCsp} from '../src/http/security.ts'
test('embedded compiler permits WASM compilation without enabling JavaScript eval',()=>{
 const csp=appCsp({publicUrl:'https://one.test'} as any),script=csp.split(';').find(s=>s.trim().startsWith('script-src'))!
 assert.ok(script.includes("'wasm-unsafe-eval'"));assert.ok(!script.includes("'unsafe-eval'"));assert.ok(!script.includes("'unsafe-inline'"))
})
