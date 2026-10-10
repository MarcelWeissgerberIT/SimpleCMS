/**
 * The task block (`workItem`, the app's editor/schema/workItem.ts) on the server until server parity (phase 4):
 * the public API, the team MCP and server agents print it as its plain blocks — the title line, then the notes —
 * and never drop it; its fields stay the app's (no `[!TODO]` form, no ids). A `> [!TODO]` written through the
 * server stays a quote. Block ids: the server's BLOCK_ID_TYPES knows the type.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import { appendBlocks, fragmentText, markdownToNodes, plainText } from '../src/api/content.ts'
import { fragmentMarkdown } from '../src/api/markdown.ts'

function paragraph(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  return p
}

/** A page document holding: an intro line, a task (title + a note + a list), a closing line. */
function pageWithTask(): Y.Doc {
  const doc = new Y.Doc()
  const item = new Y.XmlElement('workItem')
  item.setAttribute('itemId', 'wi_7f3a9c2d01')
  item.setAttribute('status', 'in_progress')
  item.setAttribute('due', '2031-10-17')
  item.setAttribute('people', ['u_alex'] as unknown as string)
  item.setAttribute('blockedBy', ['wi_1b2c3d4e5f'] as unknown as string)
  const list = new Y.XmlElement('bulletList')
  const li = new Y.XmlElement('listItem')
  li.insert(0, [paragraph('Shorten the small print')])
  list.insert(0, [li])
  item.insert(0, [paragraph('Ship the pricing page'), paragraph('The last draft is in the wiki.'), list])
  doc.getXmlFragment('default').insert(0, [paragraph('Before the launch.'), item, paragraph('After the tasks.')])
  return doc
}

test('MCP / agents Markdown: a task prints as its title and notes, in place — no fields, no ids', () => {
  const { markdown } = fragmentMarkdown(pageWithTask(), { title: () => null })
  assert.equal(markdown, ['Before the launch.', 'Ship the pricing page', 'The last draft is in the wiki.', '- Shorten the small print', 'After the tasks.'].join('\n\n'))
  assert.doesNotMatch(markdown, /wi_|\[!TODO\]|u_alex/)
})

test('public API text: the title and notes are there, in order', () => {
  const text = fragmentText(pageWithTask())
  assert.match(text, /Before the launch\.\nShip the pricing page\nThe last draft is in the wiki\.\nShorten the small print/)
  assert.match(text, /After the tasks\./)
  assert.doesNotMatch(text, /wi_/)
})

test('a `> [!TODO]` written through the server stays a quote (the server learns the form in phase 4)', () => {
  const nodes = markdownToNodes('> [!TODO] Call the printer {#wi_aaaaaaaaaa}\n> Status: done')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0]!.type, 'blockquote')
  assert.match(plainText(nodes), /\[!TODO\] Call the printer/)
})

test('block ids: a task block written into a document gets one, like every block type the editor knows', () => {
  const doc = new Y.Doc()
  appendBlocks(doc, [{ type: 'workItem', attrs: { itemId: 'wi_bbbbbbbbbb', status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A task' }] }] }])
  const el = doc.getXmlFragment('default').get(0) as Y.XmlElement
  assert.equal(el.nodeName, 'workItem')
  assert.match(String(el.getAttribute('id')), /^[0-9a-f-]{36}$/)
  assert.equal(el.getAttribute('itemId'), 'wi_bbbbbbbbbb')
})
