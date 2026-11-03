# Optional value suggestions

ONE keeps free input and adds a small arrow where useful existing values are available. Press the arrow or **Alt + Down** to open suggestions. Type to filter, use arrows and Enter to choose, or continue with a custom value. Tab never silently accepts a suggestion. Escape first dismisses suggestions, then keeps the enclosing editor's normal behaviour. Opening suggestions performs no network request and changes no value.

For database **text properties**, suggestions come from short, single-line values already stored in that exact database column. Saving a new value extends the available set automatically, without a creation question or schema conversion. This is a view of current data, not a permanent history: removing the last occurrence removes the suggestion. Long notes remain free prose, including Shift + Enter line breaks. Unique keys, custom property types, numeric fields and secret inputs retain their existing editors. Hidden, trashed and template rows are excluded. Private values never enter suggestions for a shared target. Public submission forms do not enumerate existing responses.

Technical fields use explicit contextual sources rather than a workspace-wide value history:

- Typed AI: editable domain, operation, input and output fields offer values from the current versioned tags and shadows. The raw tag chain remains available. Changed selections still require the existing compatibility check and a saved profile version.
- Atlas rule import: configured personal connections, known tenant bindings, search result refs and current shadow identifiers. Search results are only candidates; selecting one neither reads it nor grants access. Reading and binding still use the existing explicit actions and source checks.
- Work-order handoff: projects from that database's Atlas configuration and the exact existing handoff ref. Normal verification remains mandatory.

`ui/ValueSuggestions.tsx` provides the shared keyboard, accessibility and optional popup behaviour. Each caller supplies its own values and keeps validation/persistence. It never records field contents globally, scans arbitrary input elements, inserts guessed values or turns unknown text into trusted configuration. Existing select/status/list editors keep their defined option semantics.
