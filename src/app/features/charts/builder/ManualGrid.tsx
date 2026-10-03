/**
 * "Enter data": a small grid. First row = series names, first column = labels. Paste a block
 * from any spreadsheet into a cell and it fills the grid from there (TSV / CSV).
 */
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useT } from '../../../i18n'
import { rowsFromText } from '../table'
import { MANUAL_MAX_COLS, MANUAL_MAX_ROWS } from '../spec'

export function ManualGrid({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const t = useT()
  const ref = useRef<HTMLTableElement>(null)
  const width = Math.max(1, ...rows.map((r) => r.length))
  const grid = rows.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? ''))
  const set = (r: number, c: number, v: string) => onChange(grid.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)))
  const focus = (r: number, c: number) => requestAnimationFrame(() => ref.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`)?.focus())

  const onPaste = (r: number, c: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.trim())) return
    e.preventDefault()
    const block = rowsFromText(text, MANUAL_MAX_ROWS, MANUAL_MAX_COLS)
    const h = Math.min(MANUAL_MAX_ROWS, Math.max(grid.length, r + block.length))
    const w = Math.min(MANUAL_MAX_COLS, Math.max(width, c + Math.max(...block.map((b) => b.length))))
    const next = Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => grid[i]?.[j] ?? ''))
    block.forEach((line, i) => line.forEach((v, j) => r + i < h && c + j < w && (next[r + i][c + j] = v)))
    onChange(next)
  }
  const onKey = (r: number, c: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (r + 1 >= grid.length && grid.length < MANUAL_MAX_ROWS) onChange([...grid, Array.from({ length: width }, () => '')])
      focus(r + 1, c)
    } else if (e.key === 'ArrowDown' && r + 1 < grid.length) {
      e.preventDefault()
      focus(r + 1, c)
    } else if (e.key === 'ArrowUp' && r > 0) {
      e.preventDefault()
      focus(r - 1, c)
    }
  }
  const addRow = () => grid.length < MANUAL_MAX_ROWS && onChange([...grid, Array.from({ length: width }, () => '')])
  const addCol = () => width < MANUAL_MAX_COLS && onChange(grid.map((r) => [...r, '']))
  const delRow = (i: number) => grid.length > 2 && onChange(grid.filter((_, k) => k !== i))
  const delCol = (j: number) => width > 1 && onChange(grid.map((r) => r.filter((_, k) => k !== j)))

  return (
    <div className="chb-manual">
      <p className="chb-hint">{t('charts.manual.hint')}</p>
      <div className="chb-manual__scroll">
        <table ref={ref} className="chb-manual__grid">
          <thead>
            <tr>
              <th aria-hidden />
              {grid[0].map((_, j) => (
                <th key={j} scope="col">
                  <span className="chb-manual__col">{String.fromCharCode(65 + j)}</span>
                  {width > 1 && (
                    <button type="button" className="chb-manual__del" aria-label={t('charts.manual.removeCol', { n: j + 1 })} onClick={() => delCol(j)}>
                      <Minus size={11} strokeWidth={2} />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={i} className={i === 0 ? 'is-head' : undefined}>
                <th scope="row">
                  <span className="chb-manual__row">{i + 1}</span>
                  {i > 0 && grid.length > 2 && (
                    <button type="button" className="chb-manual__del" aria-label={t('charts.manual.removeRow', { n: i + 1 })} onClick={() => delRow(i)}>
                      <Minus size={11} strokeWidth={2} />
                    </button>
                  )}
                </th>
                {row.map((v, j) => (
                  <td key={j}>
                    <input
                      className={`chb-manual__cell${j > 0 && i > 0 ? ' is-num' : ''}`}
                      value={v}
                      data-cell={`${i}:${j}`}
                      aria-label={t('charts.manual.cell', { r: i + 1, c: j + 1 })}
                      spellCheck={false}
                      onChange={(e) => set(i, j, e.target.value)}
                      onPaste={onPaste(i, j)}
                      onKeyDown={onKey(i, j)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chb-manual__tools">
        <button type="button" className="btn btn--sm btn--ghost" onClick={addRow} disabled={grid.length >= MANUAL_MAX_ROWS}>
          <Plus size={13} /> {t('charts.manual.addRow')}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={addCol} disabled={width >= MANUAL_MAX_COLS}>
          <Plus size={13} /> {t('charts.manual.addCol')}
        </button>
      </div>
    </div>
  )
}
