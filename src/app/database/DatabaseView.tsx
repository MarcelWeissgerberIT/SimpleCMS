// STUB — replaced by the database area.
import type { ID } from '../store/types'
import { useRows } from '../store/selectors'

export interface DatabaseViewProps {
  databaseId: ID
  inline?: boolean
  viewId?: ID
}

export function DatabaseView({ databaseId }: DatabaseViewProps) {
  const rows = useRows(databaseId)
  return <div className="faint">[database stub] {rows.length} rows</div>
}
