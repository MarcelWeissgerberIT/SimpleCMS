/**
 * View only: viewers of a team workspace (and a revoked membership) read databases but change
 * nothing — no cell edits, rows, properties, views, drags, form building, templates, automations or
 * AI autofill. The cloud area decides (useCloud().readOnly); in the local workspace it is never set.
 * The UI hides every write affordance; the model actions refuse as well (and the cloud binding would
 * revert a viewer's local change anyway).
 */
import { createContext, useContext } from 'react'
import { useContentLanguage } from '../lib/contentLanguage'
import { useWorkspace } from '../store/store'
import { useCloud } from '../cloud'

export const TranslationReadOnly = createContext(false)
export const useDbReadOnly = (): boolean => { const cloud = useCloud(s => s.readOnly); const translated = useContext(TranslationReadOnly); return cloud || translated }
export function useDatabaseTranslated(id: string): boolean { const { lang } = useContentLanguage(); return useWorkspace(s => !!lang && Object.values(s.pages).some(p => (p.id === id || p.databaseId === id) && !p.trashed && !!p.localization && p.localization.source !== lang)) }
export const isDbReadOnly = (): boolean => useCloud.getState().readOnly
