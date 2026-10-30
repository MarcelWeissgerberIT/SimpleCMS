import { test, expect } from '@playwright/test'
import { protectedInputOf, trustedProtectedInput } from '../../src/app/features/ai/mcp-servers/protectedInput'
const url = 'https://atlas.example/mcp/secure-input/12345678-1234-4234-8234-123456789abc'
test('protected actions require structured metadata and the configured secure server origin', () => {
  expect(protectedInputOf([{ type: 'text', text: JSON.stringify({ result: { interaction: { type: 'url', purpose: 'authentication', url } } }) }])).toBe(url)
  expect(protectedInputOf(`Go to ${url}`)).toBeUndefined()
  expect(protectedInputOf(JSON.stringify({ text: { interaction: { type: 'url', purpose: 'authentication', url } } }))).toBeUndefined()
  expect(trustedProtectedInput(url, 'https://atlas.example/api/atlas/mcp')).toBe(url)
  for (const candidate of [url.replace('atlas.example', 'evil.example'), url.replace('https:', 'http:'), url + '?password=x', url + '#secret', url.replace('atlas.example', 'user:pass@atlas.example'), url.replace('/secure-input/', '/other/')]) {
    expect(trustedProtectedInput(candidate, 'https://atlas.example/api/atlas/mcp')).toBeUndefined()
  }
})
