export const SOURCE_DRAG='application/x-one-desk-source'
export const CARD_DRAG='application/x-one-desk-card'
export const QUESTION_DRAG='application/x-one-desk-question'
export type Point={x:number;y:number}
// A source drag contains an opaque token. Only this mounted picker's callback can collect it.
export type SourceDrag={token:string;collect:(point:Point)=>void}
