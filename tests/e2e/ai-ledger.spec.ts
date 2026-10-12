/**
 * Multi-provider S1 in the browser: the no-real-host guard (aiNet), the contracts every reader keeps, the gate in
 * front of every AI request (policy generation, keys in typed text), the agent route block and the small safety fixes.
 * Every AI host is mocked or aborted — nothing reaches a real one. Test data is fictional.
 */
import { test, expect, openApp } from './fixtures'
import { mockClaudeScript, hostCounts, text } from './helpers/providers'

test.describe('aiNet: no real AI host', () => {
  test('an unmocked request is aborted and recorded; it counts for its host', async ({ page, aiNet, errors }) => {
    errors.allow(/Failed to load resource/)
    await openApp(page)
    const result = await page.evaluate(() =>
      fetch('https://api.openai.com/v1/models').then(
        (r) => `status ${r.status}`,
        (e) => `failed: ${e instanceof TypeError}`,
      ),
    )
    expect(result).toBe('failed: true')
    expect(aiNet.unmocked).toEqual(['GET https://api.openai.com/v1/models'])
    expect(aiNet.count('openai')).toBe(1)
    expect(aiNet.count('anthropic')).toBe(0)
    // the self-test is done: let the fixture pass
    aiNet.allowUnmocked()
    expect(aiNet.unmocked).toEqual([])
  })

  test('with allowUnmocked() the request is still aborted, but not reported', async ({ page, aiNet, errors }) => {
    errors.allow(/Failed to load resource/)
    aiNet.allowUnmocked()
    await openApp(page)
    const result = await page.evaluate(() => fetch('https://openrouter.ai/api/v1/key').then(() => 'answered', () => 'failed'))
    expect(result).toBe('failed')
    expect(aiNet.unmocked).toEqual([])
    expect(aiNet.count('openrouter')).toBe(1)
  })

  test("a spec's own mock wins over the guard (positive control)", async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [text('ok')])
    await openApp(page)
    const counts = hostCounts(page)
    const status = await page.evaluate(() =>
      fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 10, messages: [] }) }).then((r) => r.status),
    )
    expect(status).toBe(200)
    expect(requests).toHaveLength(1)
    expect(aiNet.unmocked).toEqual([])
    expect(aiNet.count('anthropic')).toBe(1)
    expect(counts).toEqual({ anthropic: 1, openai: 0, openrouter: 0 })
  })
})
