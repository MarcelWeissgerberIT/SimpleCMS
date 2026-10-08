/**
 * The code diff of a task (GitInfo.files from the worker): per file, unified, with syntax colours (lowlight,
 * line by line), large files folded. Read-only — what changed in the task's worktree against its base.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { createLowlight, common } from 'lowlight'
import { useT } from '../../i18n'
import type { GitFile } from './protocol'
import '../../ui/code/syntax.css'

const lowlight = createLowlight(common)

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', json: 'json',
  md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', graphql: 'graphql', lua: 'lua',
  r: 'r', pl: 'perl', dockerfile: 'dockerfile', makefile: 'makefile',
}

export function langOf(path: string): string | null {
  const base = path.split('/').pop()!.toLowerCase()
  const ext = base.includes('.') ? base.split('.').pop()! : base
  const lang = EXT[ext]
  return lang && lowlight.registered(lang) ? lang : null
}

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

function render(nodes: HastNode[] | undefined, key = 'n'): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === 'text') return n.value ?? ''
    if (n.type === 'element') return <span key={`${key}${i}`} className={(n.properties?.className ?? []).join(' ')}>{render(n.children, `${key}${i}-`)}</span>
    return null
  })
}

export function code(line: string, lang: string | null): ReactNode {
  if (!lang || !line || line.length > 1000) return line
  try {
    return render(lowlight.highlight(lang, line).children as HastNode[])
  } catch {
    return line
  }
}

/** Unified diff lines with old / new line numbers. */
interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  text: string
  a: number | null
  b: number | null
}

export function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = []
  let a = 0
  let b = 0
  let inHunk = false
  for (const raw of diff.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (m) {
      a = Number(m[1])
      b = Number(m[2])
      inHunk = true
      out.push({ kind: 'hunk', text: raw, a: null, b: null })
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith('+')) out.push({ kind: 'add', text: raw.slice(1), a: null, b: b++ })
    else if (raw.startsWith('-')) out.push({ kind: 'del', text: raw.slice(1), a: a++, b: null })
    else if (raw.startsWith('\\')) out.push({ kind: 'meta', text: raw, a: null, b: null })
    else if (raw.startsWith(' ')) out.push({ kind: 'ctx', text: raw.slice(1), a: a++, b: b++ })
  }
  return out
}

const FOLD_LINES = 400

function FileDiff({ file, open: initial }: { file: GitFile; open: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(initial)
  const [all, setAll] = useState(false)
  const lines = useMemo(() => (open && file.diff ? parseDiff(file.diff) : []), [open, file.diff])
  const lang = useMemo(() => langOf(file.path), [file.path])
  const shown = all ? lines : lines.slice(0, FOLD_LINES)
  const id = `cd-${file.path.replace(/[^a-z0-9]/gi, '-')}`
  return (
    <section className="cd-file" data-status={file.status}>
      <button type="button" className="cd-file__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={13} strokeWidth={1.75} className="cd-file__chev" aria-hidden />
        <span className="cd-file__st" title={t(`features.coding.diff.st.${file.status === '?' ? 'new' : file.status}`)}>
          {file.status === '?' ? 'N' : file.status}
        </span>
        <span className="cd-file__path">{file.path}</span>
        <span className="cd-file__n">
          {file.binary ? (
            t('features.coding.diff.binary')
          ) : (
            <>
              <span className="cd-add">+{file.add}</span> <span className="cd-del">−{file.del}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="cd-file__body" id={id}>
          {file.binary ? (
            <p className="cd-note">{t('features.coding.diff.binaryNote')}</p>
          ) : !file.diff ? (
            <p className="cd-note">{t('features.coding.diff.left')}</p>
          ) : (
            <table className="cd-table syn-hl">
              <tbody>
                {shown.map((l, i) =>
                  l.kind === 'hunk' || l.kind === 'meta' ? (
                    <tr key={i} className="cd-row cd-row--hunk">
                      <td className="cd-ln" />
                      <td className="cd-ln" />
                      <td className="cd-code">{l.text}</td>
                    </tr>
                  ) : (
                    <tr key={i} className={`cd-row cd-row--${l.kind}`}>
                      <td className="cd-ln">{l.a ?? ''}</td>
                      <td className="cd-ln">{l.b ?? ''}</td>
                      <td className="cd-code">
                        <span className="cd-sign" aria-hidden>
                          {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                        </span>
                        {code(l.text, lang)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
          {!all && lines.length > FOLD_LINES && (
            <button type="button" className="btn btn--sm btn--ghost cd-more" onClick={() => setAll(true)}>
              {t('features.coding.diff.more', { n: lines.length - FOLD_LINES })}
            </button>
          )}
          {file.truncated && <p className="cd-note">{t('features.coding.diff.truncated')}</p>}
        </div>
      )}
    </section>
  )
}

export function DiffView({ files }: { files: GitFile[] }) {
  const t = useT()
  if (!files.length) return <p className="ctk-empty">{t('features.coding.diff.none')}</p>
  const add = files.reduce((s, f) => s + f.add, 0)
  const del = files.reduce((s, f) => s + f.del, 0)
  return (
    <div className="cd" data-testid="coding-diff">
      <p className="cd-sum label">
        {t(files.length === 1 ? 'features.coding.diff.sum.one' : 'features.coding.diff.sum.other', { n: files.length })} · <span className="cd-add">+{add}</span> <span className="cd-del">−{del}</span>
      </p>
      {files.map((f) => (
        // small diffs open, big ones folded
        <FileDiff key={f.path} file={f} open={files.length <= 8 && f.add + f.del <= 300} />
      ))}
    </div>
  )
}
