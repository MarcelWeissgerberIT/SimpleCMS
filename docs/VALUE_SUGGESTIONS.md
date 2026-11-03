# Optional value suggestions

ONE keeps free input and adds a small arrow where useful existing values are available. Press the arrow or **Alt + Down** to open suggestions. Type to filter, use arrows and Enter to choose, or continue with a custom value. Tab never silently accepts a suggestion. Escape first dismisses suggestions; a second Escape cancels a database text draft. Enter, Tab and outside click save normally. Plain scalar database edits show a short Saved toast with Undo; Undo refuses if the row, schema, workspace or member has changed since the edit. Opening suggestions performs no network request and changes no value.

For database **text properties**, suggestions come from short, single-line values already stored in that exact database column. Saving a new value extends the available set automatically, without a creation question or schema conversion. This is a view of current data, not a permanent history: removing the last occurrence removes the suggestion. Long notes remain free prose, including Shift + Enter line breaks. Unique keys, custom property types, numeric fields and secret inputs retain their existing editors. Hidden, trashed and template rows are excluded. Private values never enter suggestions for a shared target. Public submission forms do not enumerate existing responses.

Technical fields use explicit contextual sources rather than a workspace-wide value history:

- Typed AI: editable domain, operation, input and output fields offer values from the current versioned tags and shadows. The raw tag chain remains available. Changed selections still require the existing compatibility check and a saved profile version.
- Atlas rule import: configured personal connections, known tenant bindings, search result refs and current shadow identifiers. Search results are only candidates; selecting one neither reads it nor grants access. Reading and binding still use the existing explicit actions and source checks.
- Work-order handoff: projects from that database's Atlas configuration and the exact existing handoff ref. Normal verification remains mandatory.

`ui/ValueSuggestions.tsx` provides the shared keyboard, accessibility and optional popup behaviour. Each caller supplies its own values and keeps validation/persistence. It never records field contents globally, scans arbitrary input elements, inserts guessed values or turns unknown text into trusted configuration. Existing select/status/list editors keep their defined option semantics.


## Input UX refinements

- A list containing only the current value has no suggestion arrow. Alternatives precede the current value; database suggestions show usage in the current visible column.
- A free value is marked quietly. Case, whitespace and Unicode spelling comparisons can suggest an existing value, but never normalize, merge or persist the person's input. Choosing a suggestion is explicit.
- AI task preparation buttons show the actual route pinned by that action and its selection origin. Legacy provider-specific captions become a neutral Prepare AI task. Model/Modell text metadata on such pages is marked descriptive; it does not select a model. The terminal also shows the route origin. The normal gate still checks capabilities, policies and scope at Start.
- Typed AI renders the current draft, including parsing failures, with a saved/draft/checked label. Edits and recipe changes require Check before Save; checking is structural and is not domain acceptance.
- Recipe changes retain versioned rules only within the declared domain. A matching custom shadow is retained only if its declared input/output, operation, read-only and source requirements still match. Removed bindings/shadows are named inline. Direct Undo restores the prior draft; unrelated edits or loading another profile clear that short-lived Undo. Atlas source freshness is still checked before execution.
