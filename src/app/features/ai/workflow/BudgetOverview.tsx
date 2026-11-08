import {useT} from '../../../i18n'
import {useCentralAI,centralAI} from '../core/centralAI'
import {ReglerRestLine} from '../../governor'
/** Server totals are shared; local governor totals are intentionally a separate line. */
export function BudgetOverview(){
 const t=useT();useCentralAI();const c=centralAI()
 const money=(n:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(n)
 return <section className="work-summary__card" aria-label={t('workflow.budgetTitle')}><h3>{t('workflow.budgetTitle')}</h3>
 {c?.assigned?(c.manage&&typeof c.budgetUsd==='number'&&typeof c.spentUsd==='number'&&typeof c.heldUsd==='number'?<>
 <p>{c.label} · {c.month}</p><dl className="workflow-budget">{[[t('workflow.budgetTotal'),c.budgetUsd],[t('workflow.budgetSpent'),c.spentUsd],[t('workflow.budgetHeld'),c.heldUsd],[t('workflow.budgetAvailable'),Math.max(0,c.budgetUsd-c.spentUsd-c.heldUsd)]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{money(Number(value))}</dd></div>)}</dl>
 <p>{t('workflow.budgetShared')} {c.workspaces?.map(w=>w.name).join(' · ')}</p><p>{t('workflow.budgetHeldHint')}</p></>:<p>{t('workflow.budgetPrivate')}</p>):<p>{t('workflow.budgetLocal')}</p>}
 <ReglerRestLine/>
 </section>
}
