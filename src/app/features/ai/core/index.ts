/**
 * The AI core (multi-provider): the gate in front of every request (prepare / settle), purposes and sources, status.
 * Call sites use the facades in features/ai/client.ts; other areas reach the core through features/index.ts.
 */
export { prepare, precheck, settle, registerAIOff, registerBeforeSend, type Prepared, type PrepareInput, type BeforeSend, type Applied } from './gate'
export { reservedUsd } from '../../governor'
export { PURPOSES, PAGE_DERIVED, purposeOf, isPurposeId, type PurposeId, type PurposeDecl, type Need } from './purposes'
export { classOfPage, classesOf, memberClassesOf, type SourceWorld } from './sources'
export { aiStatus, routeFor, shortOf, type AIStatus } from './status'
export { ROUTABLE, routable } from './routable'
export { AIError, aiErrorText, type AIErrorCode, type AIFix } from './errors'
export { setAIDemo, isAIDemo, onAIDemo, usesDemo } from './demoMode'
export type { SourceRef, DataClass, FeatureClass, Route, RouteRule, ProviderId } from '@/shared/ai/types'
export { addToLines, addToReceipt, readLines, tapSignal, type ModelLine, type Receipt } from './meter'
