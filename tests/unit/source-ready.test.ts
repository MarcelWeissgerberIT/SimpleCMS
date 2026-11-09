import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {waitForSource} from '../../src/app/shell/page/overview/sourceReady.ts'
class Provider extends EventEmitter {isSynced=false;sync(){this.isSynced=true;this.emit('synced')}}
test('cached local readiness waits for delayed server sync and cleans listeners',async()=>{
 const provider=new Provider();let done=false
 const waiting=waitForSource({ready:Promise.resolve(),provider},new AbortController().signal).then(()=>{done=true})
 await Promise.resolve();await Promise.resolve();assert.equal(done,false)
 provider.emit('synced');await Promise.resolve();assert.equal(done,false)
 provider.sync();await waiting;assert.equal(done,true);assert.equal(provider.listenerCount('synced'),0)
})
test('server sync before local readiness still waits for the local copy',async()=>{
 const provider=new Provider();provider.sync();let load!:()=>void,done=false
 const ready=new Promise<void>(r=>load=r)
 const waiting=waitForSource({ready,provider},new AbortController().signal).then(()=>{done=true})
 await Promise.resolve();assert.equal(done,false);load();await waiting;assert.equal(done,true)
})
test('cancellation and timeout release listeners, and a new attempt can succeed',async()=>{
 const provider=new Provider(),c=new AbortController()
 const waiting=waitForSource({ready:Promise.resolve(),provider},c.signal);c.abort()
 await assert.rejects(waiting,{name:'AbortError'});assert.equal(provider.listenerCount('synced'),0)
 await assert.rejects(waitForSource({ready:Promise.resolve(),provider},new AbortController().signal,5),/timed out/)
 assert.equal(provider.listenerCount('synced'),0)
 provider.sync();await waitForSource({ready:Promise.resolve(),provider},new AbortController().signal)
})
test('failed local loading never exposes a synced source',async()=>{
 const provider=new Provider();provider.sync()
 await assert.rejects(waitForSource({ready:Promise.reject(Error('Read failed')),provider},new AbortController().signal),/Read failed/)
 assert.equal(provider.listenerCount('synced'),0)
})
