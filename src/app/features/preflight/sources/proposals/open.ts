/**
 * Proposals queue — open-only cards (§6.1): AI-menu results waiting on their page (this device) and autofill reviews
 * (this tab). Their review lives in the editor / the database's panel: the card's only key opens it (VON HAND "needs
 * its editor"), and the card ends when its id leaves the reading.
 */
import { navigate, openPage } from '../../../../lib/router'
import { t } from '../../../../i18n'
import { useAutofill } from '../../../../database'
import { currentScope, useAIRuns } from '../../../ai/runs'
import type { CardAction, QueueItem } from '../../registry'
import { openAutofill } from '../../queue/calls'
import { titleOf } from './common'
import { AIRUN_PREFIX, isMemoryRun } from './memory'

export const FILL_PREFIX = 'fill:'

/** autofill jobs carry no time: when each review was first listed in this tab */
const firstSeen = new Map<string, number>()

export function openItems(): QueueItem[] {
  const out: QueueItem[] = []
  const scope = currentScope()
  for (const r of Object.values(useAIRuns.getState().runs)) {
    if (r.scope !== scope || r.status !== 'done' || r.req.kind === 'memory' || isMemoryRun(r)) continue
    out.push({
      id: `${AIRUN_PREFIX}${r.id}`,
      lamp: 'proposals',
      kind: 'open',
      tag: t('features.preflight.src.aimenu'),
      refs: { pageId: r.pageId, runId: r.id },
      at: r.finishedAt ?? r.startedAt,
      hand: ['editor'],
      bulk: false,
      resolveBy: 'reading',
      title: titleOf(r.pageId) || t('common.untitled'),
      detail: t(`features.preflight.open.aimenu`),
      sub: 5,
    })
  }
  for (const job of Object.values(useAutofill.getState().jobs)) {
    if (job.phase !== 'review' || job.cancelled) continue
    for (const [rowId, p] of Object.entries(job.results)) {
      if (p.status !== 'pending') continue
      const id = `${FILL_PREFIX}${job.dbId}:${job.propId}:${rowId}`
      if (!firstSeen.has(id)) firstSeen.set(id, Date.now())
      out.push({
        id,
        lamp: 'proposals',
        kind: 'open',
        tag: t('features.preflight.src.autofill'),
        refs: { pageId: rowId, dbId: job.dbId },
        at: firstSeen.get(id) ?? Date.now(),
        hand: ['editor'],
        bulk: false,
        resolveBy: 'reading',
        title: titleOf(rowId) || t('common.untitled'),
        detail: t('features.preflight.open.autofill', { db: titleOf(job.dbId) }),
        sub: 6,
      })
    }
  }
  return out
}

export function openActions(item: QueueItem): CardAction[] {
  if (item.id.startsWith(FILL_PREFIX)) {
    const [dbId, propId] = item.id.slice(FILL_PREFIX.length).split(':')
    return [
      {
        key: 'o',
        label: t('features.preflight.card.openReview'),
        outcome: 'hand',
        run: () => {
          navigate({ name: 'page', id: dbId })
          openAutofill(dbId, propId)
          return { ok: true, resolve: 'reading' }
        },
      },
    ]
  }
  const runId = item.refs.runId
  return [
    {
      key: 'o',
      label: t('features.preflight.card.openResult'),
      outcome: 'hand',
      run: () => {
        if (runId) useAIRuns.setState({ openRequest: runId })
        if (item.refs.pageId) openPage(item.refs.pageId)
        return { ok: true, resolve: 'reading' }
      },
    },
  ]
}
