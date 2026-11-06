import type {ProgramRun} from '@/shared/quandprofile/program'
import {useT} from '../../../i18n'
import {MarkdownLite} from '../MarkdownLite'
/** Show a failure even when an interrupted run also has a partial answer. */
export function ProgramRunResult({run}:{run:ProgramRun}){
 const t=useT(),duration=Math.max(0,run.finishedAt-run.startedAt)
 return <section className="program-run-result" aria-label={t('features.ai.program.inspection.result')}>
  <dl className="program-run-result__meta"><div><dt>{t('features.ai.program.input.model')}</dt><dd>{run.route.provider} · {run.route.model||'—'}</dd></div><div><dt>{t('features.ai.program.duration')}</dt><dd>{(duration/1000).toLocaleString(undefined,{maximumFractionDigits:1})} s</dd></div><div><dt>{t('features.ai.program.outcome')}</dt><dd>{t('features.ai.program.status.'+run.status)}</dd></div></dl>
  {run.terminal&&<><p>{t('features.ai.program.terminal.receiptHelp')}</p><h4>{t('features.ai.program.terminal.request')}</h4><p>{run.terminal.task}</p><details><summary>{t('features.ai.program.terminal.tools')} · {run.terminal.tools.length}</summary><ol>{run.terminal.tools.map(tool=><li key={tool.id}><strong>{tool.server?tool.server+' · ':''}{tool.name}</strong> · {t('features.ai.program.terminal.toolStatus.'+tool.status)}<p>{tool.argument}</p>{tool.error&&<p>{tool.error}</p>}{tool.refs?.length? <p>Ref: {tool.refs.join(', ')}</p>:null}{tool.verification&&<p>{t('features.ai.facts.'+tool.verification)}</p>}</li>)}</ol></details></>}
  {run.error&&<p role="alert" className="programs__error">{run.error}</p>}
  {run.answer?<MarkdownLite source={run.answer} className="program-inspection__answer"/>:!run.error?<p>{t('features.ai.program.noAnswer')}</p>:null}
 </section>
}
