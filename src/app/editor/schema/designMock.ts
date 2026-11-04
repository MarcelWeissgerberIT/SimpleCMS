import { Node, mergeAttributes, type Editor, type Range, type JSONContent } from '@tiptap/core'
import { mockBlockData, mockBlocksAllowed } from '@/shared/ai/mockBlock'
import { t } from '../../i18n'
import { useCloud } from '../../cloud/state'
import { insertBlock } from '../lib/blocks'
import { escapeMarkdownText } from '../lib/mdText'
const blockTitle = (node: JSONContent) => (node.content ?? []).flatMap(p => p.content ?? []).map(n => n.text ?? '').join(' ').trim() || mockBlockData(node.attrs?.spec).preview?.title || 'UI mock'
export const DesignMockNode = Node.create({
 name: 'designMock', group: 'block', content: 'paragraph+', defining: true, selectable: true,
 addAttributes() { return { spec: { default: null, parseHTML: el => mockBlockData(el.getAttribute('data-mock')), renderHTML: attrs => ({'data-mock': JSON.stringify(mockBlockData(attrs.spec))}) } } },
 parseHTML() { return [{tag: 'figure[data-type="design-mock"]', contentElement:'[data-mock-title]'}] },
 renderHTML({node, HTMLAttributes}) { const s = mockBlockData(node.attrs?.spec); return ['figure', mergeAttributes(HTMLAttributes, {'data-type':'design-mock'}), ['div', {'data-mock-title':''}, 0], ['figcaption', {}, s.preview?.title || 'UI mock'], ['p',{},s.request], ['p',{},s.source]] },
 renderText({node}) { const s=mockBlockData(node.attrs?.spec); return [node.textContent.trim() || s.preview?.title || 'UI mock',s.request,s.source,s.requirement].filter(Boolean).join('\n') },
 renderMarkdown(node) { const s=mockBlockData(node.attrs?.spec); return `**${escapeMarkdownText(blockTitle(node))}**\n\n${escapeMarkdownText(s.request)}\n\n${s.source}\n\n${escapeMarkdownText(s.requirement)}\n` },
})

export const canInsertDesignMock = () => mockBlocksAllowed(useCloud.getState())
export function insertDesignMock(editor: Editor, range?: Range | null) {
 if (editor.isEditable && canInsertDesignMock()) insertBlock(editor, {type:'designMock',attrs:{spec:null},content:[{type:'paragraph',content:[{type:'text',text:t('editor.mock.title')}]}]}, range)
}
