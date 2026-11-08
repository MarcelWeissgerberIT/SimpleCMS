/** A persisted pre-translation failure, as seen after reopening an older BA run. No model call. */
export async function seedFailedAnalysis(page, id, extra = {}) {
  await page.evaluate(async ({ id, extra }) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('one-coding')
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    try {
      const key = 'local:local|task|' + id
      const value = await new Promise(resolve => {
        const r = db.transaction('kv').objectStore('kv').get(key)
        r.onsuccess = () => resolve(r.result)
      })
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite')
        tx.objectStore('kv').put({ ...value, execution: 'one', state: 'failed', runNow: false,
          error: 'Etwas ist schiefgelaufen: Compiled result check blocked: task_sources_observed',
          analysisMissing: [id], at: Date.now(), ...extra }, key)
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
      })
      await window.__one.flushSave()
    } finally { db.close() }
  }, { id, extra })
  await page.reload()
  await page.locator('.ctk-box--err').waitFor()
  // Release the column's mount-time scroll hold just as a reader's first key does.
  await page.keyboard.press('Shift')
}
