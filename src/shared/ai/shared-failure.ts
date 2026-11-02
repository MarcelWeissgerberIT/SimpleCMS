/** Only fixed, non-sensitive host failures cross the encrypted inference queue. */
export const SHARED_FAILURE_CODES = ['tool_output','context','unavailable','invalid_request','timeout','host_error'] as const
export type SharedFailureCode = typeof SHARED_FAILURE_CODES[number]
export const isSharedFailure = (v:unknown):v is SharedFailureCode => typeof v==='string' && (SHARED_FAILURE_CODES as readonly string[]).includes(v)
export class SharedInferenceError extends Error {
  readonly code:SharedFailureCode
  constructor(code:SharedFailureCode){super(code);this.name='SharedInferenceError';this.code=code}
}
