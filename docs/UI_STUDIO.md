# UI Instructions in One

Insert `/ui-studio` on a One page. The native block uses One fonts, controls,
colors and layout tokens, and stores its project through normal editor/history/
workspace synchronization. Its portable representation is a `ui-instructions`
fenced code block containing a version-1 `component-studio-project` JSON object.
Older clients retain the ordinary code block without a schema migration.

## Available

- Import an existing `.ui-project.json` or indexed UI-INSTRUCTIONS Markdown.
- Import a collection ZIP or Atlas UI package. Only metadata and contract MDs are
  unpacked; collection hashes are verified before selecting a part. One part per
  block keeps component IDs scoped. Embedded thumbnails survive.
- Component hierarchy, view/viewport selection, search, gallery, imported reference
  images, editable individual contracts, complete MD and project export.
- Export a selected component's contract plus transitive children as a work order.
  Existing One components and tokens take precedence in implementation.
- Analyze pasted or uploaded standalone HTML locally at 1440/768/390 px. Sanitized
  HTML runs in a script-disabled, network-disabled iframe; computed initial styles
  and semantic nesting become a checked component manifest. The frame is removed
  on completion, failure or cancellation. No model or local worker is involved.
- Analyze a new image/PDF/text/Markdown through the existing One terminal: the
  reference becomes a normal image/file block on the page and a terminal reference.
  The prepared task uses the selected model, existing data rules and review flow.
  No model call occurs until Start. Image-derived values are explicitly estimates.

## Boundaries

This is a native integration of the project/contract workflow, not an embedded
copy of the old localhost application. Standalone HTML analysis does not load
external styles/fonts/images, execute application scripts, authenticate to URLs,
click interactions, or claim behavioral verification. Dynamic URL crawling and
original HTML/asset ZIP rendering remain in the local analyzer; its generated
projects can be imported. AI output must pass the same manifest validation when
saved. Direct Atlas publishing is not triggered by import or analysis; the existing
reviewed Atlas tools remain the route for a separate explicit transfer.

Imports are bounded to 32 MB (expanded selected ZIP metadata/MD total too), each
specification to 12 MB, and static HTML to 2 MB / 2,000 candidate elements per view.
Oversized sources fail visibly without replacing the old block. The imported
format parser is adapted from `ui-instructions/public/spec.js` and `behavior.js`;
reserved markers, IDs, parent relationships, cycles, images and behavior contracts
are checked. Original source payloads are data, not instructions. Settings are
allowlisted; credentials are not imported. Read-only and locked pages reject edits.
