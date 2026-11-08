import { useEffect, useMemo, useRef, useState } from 'react'
import {
  readChange,
  readProposal,
  validateFiles,
  lineDiff,
  packageText,
  type CodeChange as Change,
  type Delivery,
} from '@/shared/codeChange/model'
import { codeAccessScope, codeConnections, loadCodeEvidence } from '../code-evidence'
import { generateCodeChange, verifyChangeSources, attachCodeChange, nativeCodeChange } from '../index'
import type { Writer } from '../../store/writer'
import {ResultProgress} from '../ai/workflow/ResultProgress'
import {useLang} from '../../i18n'
import { useT } from '../../i18n'
import './code-change.css'
export function CodeChange({
  raw,
  pageId,
  editable,
  canRead,
  onSave,
  onCurrent,
}: {
  raw: string
  pageId: string
  editable: boolean
  canRead: boolean
  onSave: (raw: string, expected: string, writer: Writer) => boolean
  onCurrent: () => string | null
}) {
  const de=useLang()==='de'
  const t = useT(),
    k = (s: string) => t('codeChange.' + s)
  const a = useMemo(() => {
    try {
      return readChange(raw)
    } catch {
      return null
    }
  }, [raw])
  const [chosen, setChosen] = useState<number[]>([]),
    [server, setServer] = useState(''),
    [selected, setSelected] = useState(''),
    [instruction, setInstruction] = useState(''),
    [budget, setBudget] = useState(3),
    [target, setTarget] = useState(''),
    [busy, setBusy] = useState(false),
    [activity, setActivity] = useState(''),
    [error, setError] = useState(''),
    [draft, setDraft] = useState<Record<string, string>>({})
  const refs = useRef({ raw, onSave, onCurrent, editable, canRead })
  refs.current = { raw, onSave, onCurrent, editable, canRead }
  const expected = useRef<string | null>(null)
  const abort = useRef<AbortController | null>(null),
    scope = codeAccessScope(),
    connections = codeConnections()
  useEffect(() => () => abort.current?.abort(), [scope])
  useEffect(() => {
    if (!editable || !canRead) abort.current?.abort()
  }, [editable, canRead])
  const savedProposal = a?.proposals.find((p) => p.id === selected) ?? a?.proposals.at(-1)
  const p =
    savedProposal ??
    (a?.files.length
      ? {
          id: 'editing',
          at: Date.now(),
          instruction: '',
          reason: k('manual'),
          checks: [],
          edits: a.files.map((f) => ({ file: f.id, after: f.before })),
          author: 'you' as const,
        }
      : undefined)
  useEffect(() => {
    setDraft(Object.fromEntries(p?.edits.map((e) => [e.file, e.after.join('\n')]) ?? []))
    setInstruction(p?.instruction ?? '')
  }, [p?.id])
  const dirty = !!p && p.edits.some((e) => draft[e.file] !== undefined && draft[e.file] !== e.after.join('\n'))
  const save = (next: Change, writer: Writer = { kind: 'you', via: 'form' }) => {
    const value = JSON.stringify(readChange(JSON.stringify(next)))
    if (!refs.current.editable || !refs.current.onSave(value, expected.current ?? refs.current.raw, writer))
      throw Error(k('changed'))
    refs.current.raw = value
    if (expected.current !== null) expected.current = value
  }
  const work = async (fn: (signal: AbortSignal, valid: () => boolean) => Promise<void>) => {
    if (busy || !editable || !canRead || !a) return
    expected.current = raw
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    setError('')
    const valid = () =>
      !controller.signal.aborted &&
      scope === codeAccessScope() &&
      refs.current.editable &&
      refs.current.canRead &&
      refs.current.onCurrent() === expected.current
    try {
      if (!valid()) throw Error(k('changed'))
      if (!navigator.locks) throw Error(k('changed'))
      await navigator.locks.request('one-code-change:' + scope + ':' + a.id, { ifAvailable: true }, async (lock) => {
        if (!lock) throw Error(k('changed'))
        await fn(controller.signal, valid)
      })
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? kMap(e.message) : String(e))
    } finally {
      expected.current = null
      setBusy(false)
      setActivity('')
    }
  }
  const kMap = (s: string) =>
    ['changeFormat', 'sourceMismatch', 'noChange'].includes(s) ? k(s === 'noChange' ? 'noChange' : 'format') : s
  const load = () =>
    work(async (signal, valid) => {
      const files = []
      for (const [i, index] of chosen.entries()) {
        const ref = a!.references[index],
          connection = ref.server || server
        if (!connection) throw Error(k('connection'))
        setActivity(k('verifying') + ' · ' + ref.citation.path)
        const loaded = await loadCodeEvidence(ref, connection, false, signal, () => {})
        if (!valid()) throw Error(k('changed'))
        files.push({
          id: 'file-' + i,
          reference: { ...ref, server: connection },
          before: loaded.lines,
          checkedAt: loaded.checkedAt,
        })
      }
      validateFiles(files)
      save({ ...a!, files })
    })
  const propose = () =>
    work(async (signal, valid) => {
      if (a!.proposals.length >= 10) throw Error(k('historyFull'))
      const proposal = await generateCodeChange({
        change: a!,
        instruction,
        pageId,
        budget,
        signal,
        valid,
        activity: setActivity,
      })
      if (!valid()) throw Error(k('changed'))
      save({ ...a!, proposals: [...a!.proposals, proposal] }, { kind: 'ai', run: proposal.id, action: 'code_change' })
      setSelected(proposal.id)
    })
  const manual = () => {
    if (!a || !p || busy || !editable) return
    try {
      if (a.proposals.length >= 10) throw Error(k('historyFull'))
      const proposal = readProposal(
        {
          ...p,
          id: crypto.randomUUID(),
          at: Date.now(),
          instruction,
          author: 'you',
          reason: k('manual'),
          edits: p.edits.map((e) => ({ ...e, after: (draft[e.file] ?? e.after.join('\n')).split('\n') })),
        },
        a.files,
      )
      save({ ...a, proposals: [...a.proposals, proposal] })
      setSelected(proposal.id)
    } catch (e) {
      setError(kMap((e as Error).message))
    }
  }
  const accept = () =>
    work(async (signal, valid) => {
      await verifyChangeSources(a!, signal, valid, setActivity)
      if (!valid()) throw Error(k('changed'))
      save({ ...a!, accepted: p!.id })
    })
  const upload = () =>
    work(async (signal, valid) => {
      let next = a!
      await attachCodeChange({
        change: next,
        proposal: p!,
        ref: Number(target),
        signal,
        valid,
        activity: setActivity,
        save: (d: Delivery) => {
          if (!valid()) throw Error(k('changed'))
          next = {
            ...next,
            deliveries: [
              ...next.deliveries.filter(
                (x) => !(x.proposal === d.proposal && x.ref === d.ref && x.server === d.server),
              ),
              d,
            ],
          }
          save(next)
        },
      })
    })
  const native = async (action: 'save' | 'get' | 'publish') =>
    work(async (signal, valid) => {
      const remote = a!.remote.find((r) => r.proposal === p!.id),
        next = await nativeCodeChange({
          change: a!,
          proposal: p!,
          action,
          remote,
          signal,
          valid,
          activity: setActivity,
        })
      if (!valid()) throw Error(k('changed'))
      save({ ...a!, remote: [...a!.remote.filter((r) => r.proposal !== p!.id), next] })
    })
  const download = () => {
    if (!a || !p || dirty) return
    const url = URL.createObjectURL(new Blob([packageText(a, p)], { type: 'application/json' })),
      link = document.createElement('a')
    link.href = url
    link.download = 'one-code-change-' + a.id + '.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!a)
    return (
      <section className="code-change">
        <p role="alert">{k('format')}</p>
      </section>
    )
  return (
    <section className="code-change" aria-label={k('title')}>
      <header>
        <strong>
          {k('title')} · {a.origin.title}
        </strong>
        <span className="label">ONE · ATLAS</span>
      </header>
      <ResultProgress phase={busy?'working':savedProposal&&a.accepted===savedProposal.id?'adopted':savedProposal?'review':'request'} blocked={!!error} saved={savedProposal?(de?'Patch-Vorschlag auf dieser One-Seite. Annahme in One und Übernahme ins Repository sind getrennt.':'Patch proposal on this One page. Acceptance in One and delivery to the repository are separate.'):(de?'Quellcode-Verweise; noch kein gespeicherter Patch.':'Source references; no saved patch yet.')} next={busy?(de?'Aktuelle Aktion abwarten.':'Wait for the current action.'):savedProposal&&a.accepted===savedProposal.id?(de?'Atlas-Übernahme und Repository-Status unten prüfen.':'Check Atlas delivery and repository status below.'):(de?'Änderungen je Datei vergleichen und den gewünschten Patch annehmen.':'Compare changes per file and accept the intended patch.')}/>
      {!a.files.length && (
        <>
          <h4>{k('scope')}</h4>
          <p className="faint">{k('storage')}</p>
          {!a.references.length && <p>{k('empty')}</p>}
          {a.references.map((ref, i) => (
            <label className="code-change__source" key={i}>
              <input
                type="checkbox"
                checked={chosen.includes(i)}
                disabled={
                  busy ||
                  !editable ||
                  (!chosen.includes(i) && chosen.length >= 3) ||
                  ref.citation.lines[1] - ref.citation.lines[0] >= 120
                }
                onChange={(e) => setChosen(e.target.checked ? [...chosen, i] : chosen.filter((x) => x !== i))}
              />
              <span>
                {ref.repoName} · {ref.citation.path}:{ref.citation.lines.join('–')}
                <small>{ref.citation.commit.slice(0, 12)}</small>
              </span>
            </label>
          ))}
          {a.references.some((r) => !r.server) && (
            <label>
              {k('server')}
              <select className="input" value={server} onChange={(e) => setServer(e.target.value)}>
                <option value="">—</option>
                {connections.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <button
            className="btn btn--primary"
            disabled={!chosen.length || busy || !editable || !canRead}
            onClick={() => void load()}
          >
            {k('load')}
          </button>
        </>
      )}
      {!!a.files.length && (
        <>
          <div className="code-change__form">
            <label>
              {k('instruction')}
              <textarea
                className="input"
                maxLength={8000}
                value={instruction}
                disabled={busy || !editable}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </label>
            <label>
              {k('budget')}
              <input
                className="input"
                type="number"
                min="0.1"
                max="20"
                step="0.5"
                value={budget}
                disabled={busy}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="code-change__actions">
            <button
              className="btn btn--primary"
              disabled={!editable || !canRead || busy || !instruction.trim() || a.proposals.length >= 10 || dirty}
              onClick={() => void propose()}
            >
              {k('generate')}
            </button>
            {busy && (
              <button className="btn" onClick={() => abort.current?.abort()}>
                {k('stop')}
              </button>
            )}
          </div>
          <p className="faint">{k('noExecution')}</p>
          {!!a.proposals.length && (
            <nav className="code-change__actions" aria-label={k('versions')}>
              {a.proposals.map((x, i) => (
                <button
                  key={x.id}
                  className="btn btn--sm"
                  disabled={busy || dirty}
                  aria-pressed={p?.id === x.id}
                  onClick={() => setSelected(x.id)}
                >
                  V{i + 1}
                  {a.accepted === x.id ? ' ✓' : ''}
                </button>
              ))}
            </nav>
          )}
          {p ? (
            <>
              <p className="label">
                {k(a.accepted === p.id ? 'accepted' : 'draft')} · {new Date(p.at).toLocaleString()}
              </p>
              <p>{p.reason}</p>
              {p.edits.map((e) => {
                const f = a.files.find((f) => f.id === e.file)!,
                  after = draft[e.file] ?? e.after.join('\n')
                return (
                  <article key={f.id}>
                    <h4>
                      {f.reference.citation.path} · {f.reference.citation.lines.join('–')}
                    </h4>
                    <div className="code-change__pair">
                      <div>
                        <strong>{k('before')}</strong>
                        <pre>{f.before.join('\n')}</pre>
                      </div>
                      <label>
                        {k('after')}
                        <textarea
                          spellCheck={false}
                          className="input"
                          value={after}
                          maxLength={20000}
                          disabled={!editable || busy}
                          onChange={(event) => setDraft({ ...draft, [f.id]: event.target.value })}
                        />
                      </label>
                    </div>
                    <details open>
                      <summary>{k('diff')}</summary>
                      <div className="code-change__diff">
                        {lineDiff(f.before, after.split('\n').slice(0, 160)).map((line, i) => (
                          <div key={i} data-kind={line.kind}>
                            <span>
                              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}{' '}
                              {line.old === null ? '' : line.old + f.reference.citation.lines[0]}
                            </span>
                            <code>{line.text || ' '}</code>
                          </div>
                        ))}
                      </div>
                    </details>
                  </article>
                )
              })}
              <h4>{k('checks')}</h4>
              <ul>
                {p.checks.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              {dirty && <p role="status">{k('unsaved')}</p>}
              <div className="code-change__actions">
                <button className="btn" disabled={!dirty || busy || !editable} onClick={manual}>
                  {k('save')}
                </button>
                <button
                  className="btn btn--primary"
                  disabled={dirty || busy || !editable || !canRead || !savedProposal || a.accepted === p.id}
                  onClick={() => void accept()}
                >
                  {k('accept')}
                </button>
                <button className="btn" disabled={dirty || !savedProposal} onClick={download}>
                  {k('export')}
                </button>
              </div>
              <div className="code-change__actions">
                <button
                  className="btn"
                  disabled={dirty || busy || !editable || !canRead || a.accepted !== p.id}
                  onClick={() => void native('save')}
                >
                  {k('nativeSave')}
                </button>
                {a.remote
                  .filter((r) => r.proposal === p.id)
                  .map((r) => (
                    <div key={r.id}>
                      <span>
                        {k(
                          r.state === 'draft'
                            ? 'draft'
                            : r.state === 'published'
                              ? 'published'
                              : r.state === 'publishing'
                                ? 'publishing'
                                : 'uncertain',
                        )}
                      </span>
                      {r.target && (
                        <p>
                          {k('publishTarget')}: {r.target.url} · {k('project')} {r.target.project} · {r.target.branch}
                        </p>
                      )}{' '}
                      <button
                        className="btn btn--sm"
                        disabled={dirty || busy || !editable || !canRead || a.accepted !== p.id}
                        onClick={() => void native('get')}
                      >
                        {k('nativeGet')}
                      </button>{' '}
                      <button
                        className="btn btn--primary"
                        disabled={
                          dirty ||
                          busy ||
                          !editable ||
                          !canRead ||
                          a.accepted !== p.id ||
                          !r.publishConfigured ||
                          !r.target ||
                          r.state === 'published'
                        }
                        onClick={() => void native('publish')}
                      >
                        {k('publish')}
                      </button>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noopener noreferrer">
                          Merge Request
                        </a>
                      )}
                    </div>
                  ))}
              </div>
              <p className="faint">{k('nativeHint')}</p>
              <div className="code-change__actions">
                <label>
                  {k('destination')}
                  <input
                    className="input"
                    inputMode="numeric"
                    value={target}
                    disabled={busy}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  disabled={dirty || busy || !editable || !canRead || a.accepted !== p.id || !/^\d+$/.test(target)}
                  onClick={() => void upload()}
                >
                  {k('atlas')}
                </button>
              </div>
              <p className="faint">{k('repository')}</p>
            </>
          ) : (
            a.files.map((f) => (
              <details key={f.id}>
                <summary>
                  {f.reference.citation.path}:{f.reference.citation.lines.join('–')}
                </summary>
                <pre>{f.before.join('\n')}</pre>
              </details>
            ))
          )}
          {!!a.deliveries.length && (
            <>
              <h4>{k('delivery')}</h4>
              {a.deliveries.map((d, i) => (
                <p key={i}>
                  {d.server} · #{d.ref} · {k(d.state)}
                  {d.url && (
                    <>
                      {' '}
                      ·{' '}
                      <a href={d.url} target="_blank" rel="noopener noreferrer">
                        {d.filename}
                      </a>
                    </>
                  )}
                </p>
              ))}
            </>
          )}
        </>
      )}
      <p role="status">{activity}</p>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
