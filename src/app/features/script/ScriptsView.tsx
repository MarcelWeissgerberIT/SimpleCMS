/** #/scripts and #/scripts/<id> (loaded on first visit): the list, or one script's workbench. */
import { ScriptList } from './ui/ScriptList'
import { Workbench } from './ui/Workbench'
import './script.css'

export default function ScriptsView({ scriptId }: { scriptId?: string }) {
  return scriptId ? <Workbench key={scriptId} id={scriptId} /> : <ScriptList />
}
