import type {Editor} from '@tiptap/core'
import {ySyncPluginKey,yUndoPluginKey} from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import {dispatchAs,editAs} from './editAs'
import type {Writer} from '../../store/writer'

/** JSON-backed controls replace a complete value. A text CRDT would interleave two JSON strings.
 * Replace the Y element, preserving normal Markdown/codeBlock storage and the stable block link.
 * Concurrent replacements of the same ancestor survive as two complete blocks for human review.
 * Ordinary prose and editable source code continue to use character-level collaboration. */
export function replaceStructuredCode(editor:Editor,pos:number,expected:string,raw:string,writer:Writer):boolean{
  if(editor.isDestroyed||!editor.isEditable)return false
  const node=editor.state.doc.nodeAt(pos)
  if(node?.type.name!=='codeBlock'||!['code-change','code-analysis','atlas-code','ui-instructions'].includes(node.attrs.language)||node.textContent!==expected)return false
  if(raw===expected)return true
  const sync=ySyncPluginKey.getState(editor.state)
  if(!sync){
    const next=editor.schema.nodes.codeBlock.create(node.attrs,editor.schema.text(raw))
    dispatchAs(editor,writer,editor.state.tr.replaceWith(pos,pos+node.nodeSize,next))
    return true
  }
  if(sync.snapshot!=null||sync.prevSnapshot!=null)return false
  const binding=sync.binding as {doc:Y.Doc;mapping:Map<unknown,unknown>}|undefined
  if(!binding)return false
  const element=[...binding.mapping].find(([y,p])=>p===node&&y instanceof Y.XmlElement)?.[0]
  if(!(element instanceof Y.XmlElement)||!(element.parent instanceof Y.XmlFragment))return false
  const parent=element.parent,index=parent.toArray().indexOf(element)
  if(index<0)return false
  const replacement=new Y.XmlElement('codeBlock'),text=new Y.XmlText()
  for(const [key,value] of Object.entries(node.attrs))if(value!==null&&value!==undefined)replacement.setAttribute(key,value)
  text.insert(0,raw);replacement.insert(0,[text])
  const undo=yUndoPluginKey.getState(editor.state)?.undoManager as Y.UndoManager|undefined
  undo?.stopCapturing()
  editAs(editor,writer,()=>binding.doc.transact(()=>{parent.delete(index,1);parent.insert(index,[replacement])},ySyncPluginKey))
  undo?.stopCapturing()
  return true
}
