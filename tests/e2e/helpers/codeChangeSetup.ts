import { test, expect, openApp, createPage, gotoPage, wsEval, doc, para } from '../fixtures'
import { mockAgent, call, say, setKey } from './terminal'
import { analysisFixture, analysisReport, citation } from './codeAnalysisStory.mjs'
import type { Page } from '@playwright/test'
const envelope = (data: any) => ({
  result: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
})
export async function setup(page: Page, ready = false) {
  await page.route('**/api/config', (r) =>
    r.fulfill({
      json: {
        version: 'fixture',
        signup: { mode: 'open', domains: [] },
        max_upload_mb: 20,
        dev_mode: false,
        source_url: '',
        schema_min: 6,
        supports: ['ai', 'providers'],
      },
    }),
  )
  await page.route('**/api/session', (r) => r.fulfill({ json: { user: null, workspaces: [] } }))
  await page.route('**/api/workspaces/*/model-shares', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/workspaces/*/central-ai', (r) => r.fulfill({ json: { assigned: false, ready: false } }))
  await openApp(page)
  await setKey(page)
  const id = await createPage(page, {
    title: 'Protocol analysis',
    content: doc(
      para('Investigation with pinned evidence.'),
      {
        type: 'codeBlock',
        attrs: { language: 'code-analysis' },
        content: [{ type: 'text', text: JSON.stringify(analysisFixture(ready)) }],
      },
      para(''),
    ),
  })
  await wsEval(page, (s) => {
    s.setWorkspaceAI({
      onboarding: {
        startPageId: 'fixture',
        mcpName: 'aj-atlas',
        mcpUrl: 'https://aj-atlas.com/api/atlas/mcp',
        project: 'FeliX',
        tenant: 'analytik-jena',
        skipIntro: true,
      },
    })
    s.updateSettings({
      workspaceMcpServers: [
        {
          id: 'code-fixture',
          name: 'aj-atlas',
          url: 'https://aj-atlas.com/api/atlas/mcp',
          token: 'test-token',
          enabled: true,
          prompt: '',
          tools: ['atlas_code_repos', 'atlas_code_read', 'atlas_code_verify'],
        },
      ],
    })
  })
  await gotoPage(page, id)
  await page.evaluate(() =>
    (window as any).__oneCloud.set({
      active: { kind: 'cloud', id: 'analysis-fixture' },
      user: { id: 'member-fixture', email: 'test@example.test', name: 'Test' },
      role: 'owner',
      readOnly: false,
      supports: ['atlas-mcp:1'],
    }),
  )
  await setKey(page)
  const calls: any[] = []
  await page.route('**/api/workspaces/*/atlas-mcp', (r) => {
    const b = r.request().postDataJSON()
    calls.push(b)
    if (b.action === 'search')
      return r.fulfill({
        json: {
          tools: [
            {
              server: 'aj-atlas',
              name: 'atlas_code_read',
              description: 'Read a pinned code excerpt.',
              readOnly: true,
              inputSchema: {
                type: 'object',
                properties: {
                  repo: { type: 'string' },
                  snapshot: { type: 'string' },
                  path: { type: 'string' },
                  startLine: { type: 'number' },
                  endLine: { type: 'number' },
                },
                required: ['repo', 'snapshot', 'path', 'startLine', 'endLine'],
                additionalProperties: false,
              },
            },
          ],
        },
      })
    if (b.name === 'atlas_code_repos')
      return r.fulfill({
        json: envelope({ items: [{ id: 'repo-a', name: 'protocol-service', modelProcessing: true }], next: null }),
      })
    if (b.name === 'atlas_code_verify')
      return r.fulfill({ json: envelope({ valid: true, citation: b.arguments.citation }) })
    return r.fulfill({ json: envelope({ citation, text: 'Validate(request);\nInvokeDevice(request);' }) })
  })
  return { id, calls, block: page.getByRole('region', { name: 'Code analysis', exact: true }) }
}
