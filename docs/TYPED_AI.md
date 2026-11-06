# Typed AI in ONE

Typed AI adds an optional, versioned selection to the private cube review profile. It applies to interactive terminal work (BA, PO, PM, research, test analysis, mocks, coding proposals and custom task types) through the shared task compiler and the native Claude / local / Copilot runners. It does not enroll unattended agents, grant Atlas permissions, or run production coding tools just because a tag says `coding`.

Open **AI terminal → Edit cube profiles → Typed AI**. Choose a recipe, name the profile, inspect its selection, then save and activate a version. Without an additional profile, existing task behavior remains unchanged. Current profiles are private to the account/workspace on this device; saved executable programs also retain their exact profile snapshot in the existing private program database.

## Selection and resolution

A selection contains one `domain`, `operation`, `input` and `output` tag, plus optional versioned `rule` tags. Values are stable IDs, not fuzzy labels. `rule:flux-design@5` is different from `rule:flux-design@6`. Tags are independent of display language.

A shadow matches a subset of those tags. Exactly one shadow must match, and its declared input/output types must equal the selected types. There is no model ranking or implicit “newest version” fallback. Missing, conflicting or incompatible selections cannot activate and cannot run. Different definitions can extend the system beyond the seven starting recipes.

A shadow is bounded JSON data, never code, a signature, an access token or an approval. Its checks can restrict actions, require actual source bodies, check JSON output/key presence, and require literal terms. Guidance expresses human-authored review criteria; it is not a semantic verifier.

## Atlas rule and shadow sources

The editor offers a bounded, personal Atlas catalogue search (`atlas_search`) and explicit source reads (`atlas_get`). Search hits are candidates only. Choose a record, read its body, select an exact version/applicability quote, and bind it. No model request or Atlas write is involved in import. The complete original remains in Atlas; the profile holds the binding, hashes, short quote, and any selected shadow definition.

A normal Atlas document can supply a rule such as `rule:flux-design@5`. A reusable shadow document uses the JSON protocol below, either as its entire body or in one fenced `json` block. This is an explicit document interchange format over the existing Atlas MCP tools; no unverified `atlas_shadow_*` API is assumed.

```json
{
  "protocol": "one.typed-shadow.v1",
  "id": "example.requirement-review",
  "version": 1,
  "match": [{"kind": "operation", "value": "ba"}],
  "input": "source-text",
  "output": "requirements",
  "readOnly": true,
  "requiresSources": true,
  "format": "inherit",
  "requiredTerms": [],
  "requiredKeys": [],
  "guidance": "Separate evidenced requirements, contradictions and open questions. Leave acceptance to a person."
}
```

The source binding includes server name, exact HTTPS origin, tenant, project, global record ref, body SHA-256, stable lifecycle-state SHA-256 and the exact quote. Shadow imports also check that the actual definition equals the selected ID/version/definition, not just its title. A status, relevant metadata or body change invalidates the binding. Imports and execution use the person's existing MCP allow/deny lists and own credential; credentials do not enter definitions or model context.

## Execution and receipts

Before model inference, the host resolves the selection and re-reads every bound Atlas source. The host checks source identity, scope, full body/hash, lifecycle metadata and quote. No model may self-certify this preflight. A changed or unavailable source stops before a paid model request. Review and bind a new profile version to adopt changes; no automatic retry or write occurs.

The host passes a bounded exact source excerpt, the selected shadow, typed tags and remaining task rules into the Rust/WASM-generated packet. Large source fragments are marked partial. Search results and identity calls do not satisfy the typed task's actual input-body requirement. ONE, Atlas record and explicit URL body reads can supply input evidence.

The Rust result/dispatch gate emits four additional findings and corresponding dependency-bound evidence quanta:

- `typed_selection`: unique compatible tag/shadow resolution;
- `typed_sources`: actual required input bodies and current, exact Atlas bindings;
- `typed_effects`: the shadow's restrictive effect boundary;
- `typed_output`: requested JSON/key/literal checks.

Atlas preflight evidence expires after five minutes; a delayed dependent effect or final result is then held. Checks use the current actor/workspace/provider policy. A fresh run has no previous evidence, decisions or acceptance. No shadow can override a read-only instruction, grant a tool, or approve an external action.

Saved executable programs include the profile snapshot in their compiled hash. Replay checks the saved definition and current source versions, while current permissions remain authoritative. Legacy artifacts without a profile retain their previous current-profile behavior. This does not create a historical Atlas archive or guarantee identical prose or pixels across models.

Mechanical checks prove their stated properties, not the truth or completeness of an analysis. The human acceptance dimension remains open. Mock rendering, BA/PO domain checks, repository tooling and existing write/read-back guards continue to apply independently.
