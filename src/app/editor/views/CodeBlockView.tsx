import { useMemo, useState } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'

/** [value, label] — values are lowlight/highlight.js names or aliases. */
export const LANGUAGES: Array<[string, string]> = [
  ['', 'Plain text'],
  ['bash', 'Bash'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['css', 'CSS'],
  ['diff', 'Diff'],
  ['go', 'Go'],
  ['graphql', 'GraphQL'],
  ['xml', 'HTML / XML'],
  ['ini', 'INI / TOML'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['kotlin', 'Kotlin'],
  ['less', 'Less'],
  ['lua', 'Lua'],
  ['makefile', 'Makefile'],
  ['markdown', 'Markdown'],
  ['objectivec', 'Objective-C'],
  ['perl', 'Perl'],
  ['php', 'PHP'],
  ['python', 'Python'],
  ['r', 'R'],
  ['ruby', 'Ruby'],
  ['rust', 'Rust'],
  ['scss', 'SCSS'],
  ['shell', 'Shell session'],
  ['sql', 'SQL'],
  ['swift', 'Swift'],
  ['typescript', 'TypeScript'],
  ['yaml', 'YAML'],
]

const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  html: 'xml',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  rb: 'ruby',
  'c++': 'cpp',
  cs: 'csharp',
  toml: 'ini',
  golang: 'go',
}

export function languageLabel(lang: string | null | undefined, plain = 'Plain text'): string {
  if (!lang || lang === 'plaintext' || lang === 'text') return plain
  const key = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()
  return LANGUAGES.find(([v]) => v === key)?.[1] ?? lang
}

export function CodeBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const menu = useMenu()
  const [copied, setCopied] = useState(false)
  const lang = (node.attrs.language as string | null) ?? ''
  const current = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()

  const entries = useMemo<MenuEntry[]>(
    () => [
      ...LANGUAGES.map(([value, label]) => ({
        label: value ? label : t('editor.code.plain'),
        keywords: value,
        checked: value === current,
        onSelect: () => {
          updateAttributes({ language: value || null })
          editor.commands.focus()
        },
      })),
      { kind: 'separator' as const },
      {
        label: t('editor.code.toMermaid'),
        keywords: 'mermaid diagram',
        onSelect: () => {
          const pos = getPos()
          if (typeof pos !== 'number') return
          editor
            .chain()
            .focus()
            .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'mermaid', attrs: { code: node.textContent } })
            .run()
        },
      },
    ],
    [current, t, updateAttributes, editor, getPos, node],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <NodeViewWrapper className="code-block" data-language={current || 'plain'}>
      <div className="code-block__bar" contentEditable={false}>
        <button
          type="button"
          className="code-block__lang"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => editor.isEditable && menu.toggle(e)}
          aria-haspopup="menu"
          disabled={!editor.isEditable}
        >
          {languageLabel(lang, t('editor.code.plain'))}
          {editor.isEditable && <ChevronDown size={12} />}
        </button>
        <span className="code-block__lines">{t('editor.code.lines', { count: node.textContent.split('\n').length })}</span>
        <button type="button" className="code-block__copy" onMouseDown={(e) => e.preventDefault()} onClick={copy} aria-label={t('editor.code.copy')}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? t('editor.code.copied') : t('editor.code.copy')}</span>
        </button>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent<'code'> as="code" className={current ? `hljs language-${current}` : 'hljs'} />
      </pre>
      <Menu {...menu.props} entries={entries} searchable searchPlaceholder={t('editor.code.searchLang')} width={220} />
    </NodeViewWrapper>
  )
}
