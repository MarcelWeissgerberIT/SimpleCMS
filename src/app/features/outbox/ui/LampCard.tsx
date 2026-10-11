/**
 * The Outbox's own card body on Preflight's queue (the lamp's QueueSourceDef.Body, loaded on first use): the server
 * and route, the Outbox's seal (CLEAN / FOREIGN — never Preflight's own "clean"), the text exactly as it would go
 * (Payload, unclipped: shown = seen) and the slip's lamps. Read only: the slip is edited and sent in the Outbox.
 */
import { useT } from '../../../i18n'
import type { QueueItem } from '../../preflight/registry'
import { isForeign } from '../counts'
import { useSlip } from '../hooks'
import { Lamps } from './Lamps'
import { Payload } from './Payload'
import { ServerTag, ToolTarget } from './parts'

export default function SlipCardBody({ item }: { item: QueueItem; expanded: boolean }) {
  const t = useT()
  const slip = useSlip(item.refs.slipId)
  if (!slip) return null
  const foreign = isForeign(slip)
  return (
    <div className="obx-lampcard" data-testid="outbox-lampcard" data-slip={slip.id}>
      <div className="obx-lampcard__head">
        <ServerTag name={slip.target.serverName} />
        <ToolTarget slip={slip} />
        <span className="obx-lampcard__seal label" data-foreign={foreign || undefined}>
          {t(foreign ? 'features.outbox.strip.foreign' : 'features.outbox.strip.clean')}
        </span>
      </div>
      <Payload slip={slip} editing={false} onEditing={() => {}} />
      <Lamps slip={slip} />
    </div>
  )
}
