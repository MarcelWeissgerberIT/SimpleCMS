import type {AtlasFacts} from '@/shared/mcp/facts'
import {t} from '../../../i18n'
export const atlasFactsFallback=(facts:AtlasFacts)=>facts.fallback({heading:t('features.ai.facts.fallback'),failed:t('features.ai.facts.failed')})
