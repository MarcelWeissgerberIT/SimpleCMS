import type {ProgramRun} from './program.ts'
export type ProgramRunPreview=ProgramRun&{summary?:true;hasInspection?:boolean}
/** List metadata only. Original private bodies stay available through the single-receipt endpoint. */
export function summarizeProgramRun(run:ProgramRun):ProgramRunPreview{
 const {answer:_,inspection,steps:__,terminal,...metadata}=run
 return {...metadata,steps:[],...(terminal?{terminal:{task:terminal.task.slice(0,240),tools:[]}}:{}),summary:true,hasInspection:!!inspection}
}
