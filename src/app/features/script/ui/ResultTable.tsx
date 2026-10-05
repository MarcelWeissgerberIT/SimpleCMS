/** A result table (query tester, printed lists of rows): mono header, hairline rows, links to rows. */
import { openPage } from '../../../lib/router'
import { useT } from '../../../i18n'
import type { ResultTable as Table } from '../runtime/types'

export function ResultTable({ table, compact }: { table: Table; compact?: boolean }) {
  const t = useT()
  return (
    <div className={`sc-table${compact ? ' sc-table--compact' : ''}`}>
      <div className="sc-table__scroll" tabIndex={0} role="region" aria-label={t('features.script.result.table', { n: table.total })}>
        <table>
          <thead>
            <tr>
              <th className="sc-table__n" scope="col">
                #
              </th>
              {table.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={`${r.pageId ?? ''}${i}`}>
                <td className="sc-table__n">{String(i + 1).padStart(2, '0')}</td>
                {r.cells.map((c, j) => (
                  <td key={j}>
                    {typeof c === 'string' ? (
                      c || <span className="sc-table__empty">—</span>
                    ) : (
                      <a
                        href={`#/p/${c.pageId}`}
                        className="sc-table__link"
                        onClick={(e) => {
                          e.preventDefault()
                          openPage(c.pageId)
                        }}
                      >
                        {c.text || t('common.untitled')}
                      </a>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.total > table.rows.length && <p className="sc-table__more label">{t('features.script.result.more', { n: table.total - table.rows.length })}</p>}
    </div>
  )
}
