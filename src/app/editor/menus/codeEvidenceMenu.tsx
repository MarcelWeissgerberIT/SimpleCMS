import type {Editor} from '@tiptap/core'
import {FileSearch} from 'lucide-react'
import type {Translate} from '@/shared/i18n'
import type {MenuEntry} from '../../ui/Menu'
import {requestCodeEvidence} from '../../features'

/** Capture the menu's explicit block range after focus returns, never the restored caret. */
export function codeEvidenceMenuEntry(editor:Editor,t:Translate,range:()=>{from:number;to:number}|null):MenuEntry{
 return {label:t('editor.bubble.codeEvidence'),icon:<FileSearch size={15}/>,keywords:'atlas repo repository code evidence source verify prüfen quellcode belege abgleich ki',onSelect:()=>{
  requestAnimationFrame(()=>{if(editor.isDestroyed)return;const at=range();if(at)requestCodeEvidence(editor,at)})
 }}
}
