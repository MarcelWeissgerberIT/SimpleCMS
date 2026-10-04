/**
 * Test bench: sample values per parameter → the live result of the draft (not the saved version),
 * with errors explained in plain words. A dataset parameter takes a list ("4; 9; 1").
 */
import { useMemo } from 'react'
import type { CustomFunction, FnParam, ID } from '../../../store/types'
import { useT, useLang } from '../../../i18n'
import { runFunction, type RunResult } from './engine'

export interface TestBenchProps {
  fn: CustomFunction | null
  params: FnParam[]
  /** the workspace's saved functions (a change re-runs the bench) */
  functions: Record<ID, CustomFunction> | undefined
  samples: Record<string, string>
  onSample: (name: string, value: string) => void
  holes: number
}

export function TestBench({ fn, params, functions, samples, onSample, holes }: TestBenchProps) {
  const t = useT()
  const lang = useLang()
  // `functions`: calls of other functions run their saved versions — when those change, run again
  // nothing to run until every input has a sample (an empty one would only show #DIV/0! or #VALUE!)
  const missing = params.filter((p) => (samples[p.name] ?? '').trim() === '').length
  const result: RunResult | null = useMemo(
    () =>
      fn && !missing
        ? runFunction(
            fn,
            params.map((p) => samples[p.name] ?? ''),
            lang,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, params, samples, functions, lang, missing],
  )

  return (
    <div className="fx-bench">
      <div className="fx-bench__inputs">
        {params.length === 0 && <span className="faint fx-bench__none">{t('features.fn.bench.noParams')}</span>}
        {params.map((p) => (
          <label key={p.name} className="fx-bench__in">
            <span className="fx-bench__name">
              {p.name}
              <span className="fx-bench__type">{t(`features.fn.typeShort.${p.type}`)}</span>
            </span>
            {p.type === 'bool' ? (
              <select className="input" value={samples[p.name] ?? ''} data-sample={p.name} onChange={(e) => onSample(p.name, e.target.value)}>
                <option value="">—</option>
                <option value="TRUE">{t('features.fn.yes')}</option>
                <option value="FALSE">{t('features.fn.no')}</option>
              </select>
            ) : (
              <input
                className="input"
                type={p.type === 'date' ? 'date' : 'text'}
                inputMode={p.type === 'number' ? 'decimal' : undefined}
                value={samples[p.name] ?? ''}
                data-sample={p.name}
                spellCheck={false}
                placeholder={t(`features.fn.bench.ph.${p.type}`)}
                onChange={(e) => onSample(p.name, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <div className="fx-bench__out" data-state={!fn || !result ? 'idle' : result.ok ? 'ok' : 'error'} aria-live="polite">
        <span className={`led${fn && result ? (result.ok ? ' led--ok' : ' led--on') : ''}`} aria-hidden />
        {!fn ? (
          <span className="faint">{holes ? t('features.fn.bench.fillFirst', { n: holes }) : t('features.fn.bench.fixFirst')}</span>
        ) : !result ? (
          <span className="faint">{t('features.fn.bench.samplesFirst')}</span>
        ) : result.ok ? (
          <>
            <span className="fx-bench__eq" aria-hidden>
              =
            </span>
            <output className="fx-bench__value" data-testid="fx-result">
              {result.text === '' ? <span className="faint">{t('features.fn.bench.empty')}</span> : result.text}
            </output>
            <span className="fx-bench__kind label">{t(`features.fn.result.${result.kind}`)}</span>
          </>
        ) : (
          result && (
            <>
              <output className="fx-bench__value fx-bench__value--err" data-testid="fx-result">
                {result.code}
              </output>
              <span className="fx-bench__why">{t(`features.fn.err.${errKey(result.code)}`)}</span>
            </>
          )
        )}
      </div>
    </div>
  )
}

const errKey = (code: string): string =>
  ({
    '#DIV/0!': 'div0',
    '#REF!': 'ref',
    '#NAME?': 'name',
    '#VALUE!': 'value',
    '#N/A': 'na',
    '#CYCLE!': 'cycle',
    '#NUM!': 'num',
  })[code] ?? 'other'
