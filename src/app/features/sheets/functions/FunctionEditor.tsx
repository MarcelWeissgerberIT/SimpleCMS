/**
 * One function: name + description, parameters, the body tree with its formula preview, the
 * test bench and the checks. Edits go to the draft (FunctionsModal saves it).
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import type { CustomFunction, FnParam, ID } from '../../../store/types'
import { useT } from '../../../i18n'
import { Kbd, MOD } from '../../../ui/controls'
import type { Catalog } from './catalog'
import { ExprTree } from './ExprTree'
import { NodeMenu, type NodeAction } from './NodeMenu'
import { NodePicker, type Choice } from './NodePicker'
import { ParamsEditor } from './ParamsEditor'
import { TestBench } from './TestBench'
import type { Usage } from './usage'
import {
  addArgAt,
  canAddArg,
  canRemoveArg,
  countNodes,
  deleteAt,
  flatten,
  fromDraft,
  isBlocking,
  isHole,
  newCall,
  nextParamName,
  nodeAt,
  normalizeFnName,
  pathKey,
  previewParts,
  remapParam,
  removeArgAt,
  renameCalls,
  replaceAt,
  replaceWithCall,
  samePath,
  selfSpec,
  signature,
  unwrapAt,
  wrapAt,
  type DNode,
  type Draft,
  type Issue,
  type Path,
  type SpecLookup,
} from './model'
import { FN_NAME_RE } from '../../../store/functions'

type Pop =
  | {
      type: 'pick'
      path: Path
      el: HTMLElement
      mode: 'fill' | 'wrap'
      query?: string
    }
  | { type: 'menu'; path: Path; el: HTMLElement }
  | null

export interface FunctionEditorProps {
  draft: Draft
  stored: CustomFunction | undefined
  catalog: Catalog
  functions: Record<ID, CustomFunction> | undefined
  issues: Issue[]
  readOnly: boolean
  dirty: boolean
  /** where the saved name is used (a rename updates them) */
  usage: Usage | null
  samples: Record<string, string>
  nameRef: RefObject<HTMLInputElement | null>
  canUndo: boolean
  canRedo: boolean
  onChange: (d: Draft) => void
  onSample: (name: string, value: string) => void
  onUndo: () => void
  onRedo: () => void
}

export function FunctionEditor(props: FunctionEditorProps) {
  const { draft, stored, catalog, functions, issues, readOnly, dirty, usage, samples, nameRef, onChange } = props
  const t = useT()
  const [focus, setFocus] = useState<Path>([])
  const [pop, setPop] = useState<Pop>(null)
  const [focusToken, setFocusToken] = useState(0)
  /** after the next render: open the value editor of this node (a fresh number / text) */
  const pendingMenu = useRef<Path | null>(null)
  const treeWrap = useRef<HTMLDivElement>(null)
  const [nameText, setNameText] = useState<string | null>(null)

  // another function: start at its root
  useEffect(() => {
    setFocus([])
    setPop(null)
    setNameText(null)
  }, [draft.id])

  const lookup: SpecLookup = useMemo(() => {
    const self = draft.name ? selfSpec(draft) : null
    return (n) => (self && n === self.name ? self : catalog.lookup(n))
  }, [catalog, draft])

  useEffect(() => {
    if (!pendingMenu.current) return
    const p = pendingMenu.current
    pendingMenu.current = null
    const el = treeWrap.current?.querySelector<HTMLElement>(`[data-path="${pathKey(p)}"]`)
    if (el) setPop({ type: 'menu', path: p, el })
  })

  const setBody = (body: DNode, nextFocus?: Path) => {
    onChange({ ...draft, body })
    if (nextFocus) {
      setFocus(nextFocus)
      setFocusToken((n) => n + 1)
    }
  }

  /** the next empty slot in reading order (a fresh call's own slots come first), wrapping around */
  const holeAfter = (body: DNode, path: Path): Path => {
    const list = flatten(body)
    const at = list.findIndex((x) => samePath(x.path, path))
    const next = list.slice(at + 1).find((x) => x.node.k === 'hole') ?? list.find((x) => x.node.k === 'hole')
    return next?.path ?? path
  }

  const pick = (c: Choice) => {
    if (!pop || pop.type !== 'pick') return
    const { path, mode } = pop
    setPop(null)
    if (mode === 'wrap') {
      if (c.k !== 'call') return
      const body = wrapAt(draft.body, path, c.spec)
      return setBody(body, holeAfter(body, path))
    }
    const cur = nodeAt(draft.body, path)
    let node: DNode
    if (c.k === 'param') node = { k: 'param', name: c.name }
    else if (c.k === 'num') node = { k: 'num', v: c.v ?? 0 }
    else if (c.k === 'str') node = { k: 'str', v: c.v ?? '' }
    else if (c.k === 'bool') node = { k: 'bool', v: c.v }
    else node = cur?.k === 'call' ? replaceWithCall(cur, c.spec) : newCall(c.spec)
    const body = replaceAt(draft.body, path, node)
    if ((c.k === 'num' || c.k === 'str') && c.v === null) {
      pendingMenu.current = path
      return setBody(body, path)
    }
    setBody(body, holeAfter(body, path))
  }

  const act = (a: NodeAction) => {
    if (!pop) return
    const { path, el } = pop
    switch (a) {
      case 'replace':
        return setPop({ type: 'pick', path, el, mode: 'fill' })
      case 'wrap':
        return setPop({ type: 'pick', path, el, mode: 'wrap' })
    }
    setPop(null)
    if (a === 'unwrap') return setBody(unwrapAt(draft.body, path), path)
    if (a === 'addArg') {
      const r = addArgAt(draft.body, path)
      return setBody(r.root, r.added)
    }
    if (a === 'removeArg') return setBody(removeArgAt(draft.body, path), path.slice(0, -1))
    if (a === 'delete') remove(path)
  }

  const remove = (path: Path) => {
    const r = deleteAt(draft.body, path, lookup)
    if (!r.removed) return setBody(r.root, path)
    const i = path[path.length - 1]
    setBody(r.root, i > 0 ? [...path.slice(0, -1), i - 1] : path.slice(0, -1))
  }

  const open = (path: Path, el: HTMLElement, query?: string) => {
    const node = nodeAt(draft.body, path)
    if (readOnly) {
      if (node && !isHole(node)) setPop({ type: 'menu', path, el })
      return
    }
    if (isHole(node) || query) setPop({ type: 'pick', path, el, mode: 'fill', query })
    else setPop({ type: 'menu', path, el })
  }

  const closePop = () => {
    setPop(null)
    setFocusToken((n) => n + 1)
  }

  /* -------------------------------------------------------------- parameters */

  const addParam = () => {
    const p: FnParam = { name: nextParamName(draft.params), type: 'number' }
    onChange({ ...draft, params: [...draft.params, p] })
  }
  const renameParam = (i: number, name: string) => {
    const from = draft.params[i].name
    onChange({
      ...draft,
      params: draft.params.map((p, j) => (j === i ? { ...p, name } : p)),
      body: remapParam(draft.body, from, name),
    })
  }
  const changeParam = (i: number, patch: Partial<FnParam>) =>
    onChange({
      ...draft,
      params: draft.params.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    })
  const moveParam = (i: number, dir: -1 | 1) => {
    const params = draft.params.slice()
    const [p] = params.splice(i, 1)
    params.splice(i + dir, 0, p)
    onChange({ ...draft, params })
  }
  const removeParam = (i: number) => {
    const name = draft.params[i].name
    onChange({
      ...draft,
      params: draft.params.filter((_, j) => j !== i),
      body: remapParam(draft.body, name, null),
    })
  }

  /* -------------------------------------------------------------- name */

  const nameIssue =
    nameText !== null && nameText !== draft.name ? (nameText ? 'format' : 'empty') : (issues.find((i) => i.kind === 'name') as Extract<Issue, { kind: 'name' }> | undefined)?.code
  const setName = (raw: string) => {
    const next = normalizeFnName(raw)
    setNameText(next)
    if (next === draft.name || !FN_NAME_RE.test(next)) return
    // calls of itself follow the name
    onChange({
      ...draft,
      name: next,
      body: draft.name ? renameCalls(draft.body, draft.name, next) : draft.body,
    })
  }

  /* -------------------------------------------------------------- derived */

  const complete = useMemo(() => {
    if (issues.some((i) => isBlocking(i) && i.kind !== 'name')) return null
    return fromDraft(draft)
  }, [draft, issues])
  const holes = countNodes(draft.body).holes
  const marks = useMemo(() => {
    const s = new Set<string>()
    for (const i of issues) if (i.kind === 'type' || i.kind === 'unknown' || i.kind === 'paramMissing' || i.kind === 'arity') s.add(pathKey(i.path))
    return s
  }, [issues])
  const parts = useMemo(() => previewParts(draft.body), [draft.body])
  const focusKey = pathKey(focus)
  const inFocus = (p: Path) => {
    const k = pathKey(p)
    return focusKey === 'root' || k === focusKey || k.startsWith(`${focusKey}.`)
  }
  const renamed = stored && stored.name !== draft.name && FN_NAME_RE.test(draft.name)
  const popNode = pop ? nodeAt(draft.body, pop.path) : undefined
  const popParent = pop && pop.path.length ? nodeAt(draft.body, pop.path.slice(0, -1)) : undefined

  return (
    <div className="fx-ed">
      <header className="fx-ed__head">
        <div className="fx-ed__nameline">
          <span className="fx-ed__glyph" aria-hidden>
            ƒ
          </span>
          <input
            ref={nameRef}
            className="fx-ed__name"
            value={nameText ?? draft.name}
            disabled={readOnly}
            spellCheck={false}
            autoCapitalize="characters"
            maxLength={40}
            aria-label={t('features.fn.name')}
            aria-invalid={!!nameIssue || undefined}
            aria-describedby="fx-name-note"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setNameText(null)}
          />
          <span className="fx-ed__sig mono" aria-hidden>
            {signature('', draft.params)}
          </span>
          {dirty && !readOnly && (
            <span className="fx-ed__dirty label">
              <span className="led led--on" /> {t('features.fn.unsaved')}
            </span>
          )}
        </div>
        <div id="fx-name-note" className="fx-ed__note" role={nameIssue ? 'alert' : undefined}>
          {nameIssue ? (
            <span className="fx-ed__err">
              {t(`features.fn.nameIssue.${nameIssue}`, {
                name: nameText ?? draft.name,
              })}
            </span>
          ) : renamed && usage && usage.total > 0 ? (
            <span>
              {t('features.fn.renameNote', {
                old: stored!.name,
                name: draft.name,
                n: usage.total,
              })}
            </span>
          ) : (
            <span className="faint">{t('features.fn.nameHelp')}</span>
          )}
        </div>
        <textarea
          className="input fx-ed__desc"
          rows={1}
          value={draft.description}
          disabled={readOnly}
          maxLength={2000}
          placeholder={t('features.fn.descPh')}
          aria-label={t('features.fn.desc')}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </header>

      <section className="fx-sec" aria-labelledby="fx-sec-params">
        <h3 className="fx-sec__head label" id="fx-sec-params">
          <span>§ 01</span> {t('features.fn.params')}
          <span className="fx-sec__rule" />
          <span className="fx-sec__n">{String(draft.params.length).padStart(2, '0')}</span>
        </h3>
        <ParamsEditor
          params={draft.params}
          body={draft.body}
          readOnly={readOnly}
          onAdd={addParam}
          onRename={renameParam}
          onChange={changeParam}
          onMove={moveParam}
          onRemove={removeParam}
        />
      </section>

      <div className="fx-ed__work">
        <section className="fx-sec" aria-labelledby="fx-sec-body">
          <h3 className="fx-sec__head label" id="fx-sec-body">
            <span>§ 02</span> {t('features.fn.body')}
            <span className="fx-sec__rule" />
            {!readOnly && (
              <span className="fx-sec__tools">
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  disabled={!props.canUndo}
                  onClick={props.onUndo}
                  aria-label={t('features.fn.undo')}
                  title={`${t('features.fn.undo')} · ${MOD}Z`}
                >
                  <Undo2 size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  disabled={!props.canRedo}
                  onClick={props.onRedo}
                  aria-label={t('features.fn.redo')}
                  title={`${t('features.fn.redo')} · ${MOD}⇧Z`}
                >
                  <Redo2 size={13} />
                </button>
              </span>
            )}
          </h3>
          <div className="fx-strip" aria-label={t('features.fn.preview')}>
            <span className="fx-strip__fx" aria-hidden>
              fx
            </span>
            <code className="fx-strip__code" data-testid="fx-preview">
              <span className="fx-strip__eq">=</span>
              {parts.map((p, i) => (
                <span
                  key={i}
                  className={`fx-tok fx-tok--${p.kind}`}
                  data-on={inFocus(p.path) && focusKey !== 'root' ? '' : undefined}
                  onClick={() => {
                    setFocus(p.path)
                    setFocusToken((n) => n + 1)
                  }}
                >
                  {p.text}
                </span>
              ))}
            </code>
          </div>
          <div ref={treeWrap} className="fx-tree-wrap">
            <ExprTree
              root={draft.body}
              params={draft.params}
              lookup={lookup}
              focus={focus}
              marks={marks}
              readOnly={readOnly}
              focusToken={focusToken}
              onFocus={setFocus}
              onOpen={open}
              onDelete={remove}
              onAddArg={(p) => {
                const r = addArgAt(draft.body, p)
                setBody(r.root, r.added)
              }}
            />
          </div>
          {!readOnly && (
            <p className="fx-keys faint" aria-hidden>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> {t('features.fn.keys.move')} · <Kbd>←</Kbd>
              <Kbd>→</Kbd> {t('features.fn.keys.level')} · <Kbd>⏎</Kbd> {t('features.fn.keys.open')} · <Kbd>⌫</Kbd> {t('features.fn.keys.delete')} · {t('features.fn.keys.type')}
            </p>
          )}
        </section>

        <div className="fx-ed__side">
          <section className="fx-sec" aria-labelledby="fx-sec-bench">
            <h3 className="fx-sec__head label" id="fx-sec-bench">
              <span>§ 03</span> {t('features.fn.bench')}
              <span className="fx-sec__rule" />
            </h3>
            <TestBench fn={complete} params={draft.params} functions={functions} samples={samples} onSample={props.onSample} holes={holes} />
          </section>

          <Checks issues={issues} draft={draft} onGo={(p) => (setFocus(p), setFocusToken((n) => n + 1))} />
        </div>
      </div>

      {pop?.type === 'pick' && (
        <NodePicker
          anchor={pop.el}
          mode={pop.mode}
          params={draft.params}
          catalog={catalog}
          self={draft.name ? selfSpec(draft) : null}
          initialQuery={pop.query}
          onPick={pick}
          onClose={closePop}
        />
      )}
      {pop?.type === 'menu' && popNode && !isHole(popNode) && (
        <NodeMenu
          anchor={pop.el}
          node={popNode}
          spec={popNode.k === 'call' ? lookup(popNode.fn) : undefined}
          canAdd={popNode.k === 'call' && canAddArg(lookup(popNode.fn), popNode.args.length)}
          canRemove={popParent?.k === 'call' && canRemoveArg(lookup(popParent.fn), popParent.args.length, pop.path[pop.path.length - 1])}
          readOnly={readOnly}
          onValue={(n) => {
            const path = pop.path
            setPop(null)
            setBody(replaceAt(draft.body, path, n), n.k === 'num' || n.k === 'str' ? holeAfter(replaceAt(draft.body, path, n), path) : path)
          }}
          onAction={act}
          onClose={closePop}
        />
      )}
    </div>
  )
}

/** Blocking problems first (LED on), hints after (LED off). */
function Checks({ issues, draft, onGo }: { issues: Issue[]; draft: Draft; onGo: (p: Path) => void }) {
  const t = useT()
  const list = issues.filter((i) => i.kind !== 'name' && i.kind !== 'param')
  if (!list.length)
    return (
      <div className="fx-checks fx-checks--ok" role="status">
        <span className="led led--ok" aria-hidden /> {t('features.fn.checks.ok')}
      </div>
    )
  return (
    <ul className="fx-checks" aria-label={t('features.fn.checks')}>
      {list.map((i, n) => {
        const path = 'path' in i ? i.path : i.kind === 'holes' ? i.first : null
        return (
          <li key={n} className="fx-check" data-blocking={isBlocking(i) || undefined}>
            <span className={`led${isBlocking(i) ? ' led--on' : ''}`} aria-hidden />
            <span>{issueText(i, draft, t)}</span>
            {path && (
              <button type="button" className="btn btn--sm btn--ghost fx-check__go" onClick={() => onGo(path)}>
                {t('features.fn.checks.show')}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function issueText(i: Issue, draft: Draft, t: (k: string, v?: Record<string, string | number>) => string): string {
  switch (i.kind) {
    case 'holes':
      return t(i.count === 1 ? 'features.fn.issue.holes.one' : 'features.fn.issue.holes.other', { n: i.count })
    case 'unknown':
      return t('features.fn.issue.unknown', { name: i.name })
    case 'paramMissing':
      return t('features.fn.issue.paramMissing', { name: i.name })
    case 'arity':
      return t('features.fn.issue.arity', { name: i.name })
    case 'type':
      return t('features.fn.issue.type', {
        expected: t(`features.fn.typeShort.${i.expected}`),
        got: t(`features.fn.typeShort.${i.got}`),
      })
    case 'recursion':
      return t(i.chain.length <= 2 ? 'features.fn.issue.recursionSelf' : 'features.fn.issue.recursion', { name: draft.name, chain: i.chain.join(' → ') })
    case 'size':
      return t('features.fn.issue.size')
    default:
      return ''
  }
}
