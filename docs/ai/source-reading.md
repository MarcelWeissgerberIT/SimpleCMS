# Bounded source reading

One page reads use a shared, run-local coverage ledger in the terminal, document pipelines and fixed compiled programs. A successful tool response alone is not a complete source receipt. Host metadata identifies the exact page, rendered source hash, permitted selection and interval; document prose cannot change pagination. Equal overlapping intervals merge. Gaps, conflicting text and different versions cannot be presented as one complete source. Source content and title are checked again before accepting the result. Document pipelines additionally pin their task, referenced pages and permission context.

## Budgets

A page that fits within 36,000 characters and the estimated 12,000-token read budget is supplied as one contiguous source. Larger pages use smaller portions (at most 12,000 characters / estimated 4,000 tokens), with explicit continuation offsets. Routes with context below 64,000 tokens and local routes use at most 5,000 characters / estimated 1,700 tokens. The estimate is UTF-8 bytes / 3, a planning heuristic, not a provider tokenizer, billing amount or guarantee. Existing model-context and spending gates remain in force.

Splits prefer paragraphs/headings outside fenced code. Oversized blocks still have hard bounds. Unicode surrogate pairs are not split. A second generic tool-result truncation must not cut page content after its coverage was registered. Selected blocks are labelled as a complete selection, never a complete unrestricted page.

This bounds each response; it does not automatically fetch arbitrary related pages or claim that the model has understood every supplied sentence. Oversized required sources remain incomplete until subsequent permitted windows cover the source. In the BA pipeline this prevents advancing the stage.

## Parallel reads and caching

MCP read requests have a per-run concurrency limit of three. Fixed programs group only adjacent, declared read steps whose expressions do not depend on another member of the group. They never reorder across model generation, decisions or effects. All started reads settle before the next group; cancellation is checked before queued work starts. The program's model input remains ordered by its saved expressions, independent of completion order.

The existing task-local MCP result reuse still checks permission/session identity and bypasses reuse for explicit fresh-state requests. Code, identity and job-status reads retain their existing freshness rules. Prompt caching remains automatic; parallel source acquisition does not create parallel model requests. No new paid model call is introduced to manage source portions.

## Measurements

The terminal / pipeline log reports unique provided characters, repeated characters, complete source versions, read calls, model response count, elapsed time, observed cost (unpriced responses explicitly marked), provider cache-read/cache-write tokens and successful/reused MCP reads. These are run-local observations, not predictions of savings. Source delivery is distinct from quotation checking and semantic verification. Existing finding checks remain responsible for quotation evidence.

Validation includes a 30k page whose final sentence reaches the next model request, a larger incomplete required page that cannot advance, conflicting/overlapping/out-of-order windows, Unicode limits, cancelled queued reads and fixed-program dependency barriers. Provider-independent batching tests compare the same sources; quality/cost comparisons on real tasks must use the same sources, model and acceptance checks.
