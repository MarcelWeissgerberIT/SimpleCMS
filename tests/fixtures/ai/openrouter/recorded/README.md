# Recorded OpenRouter exchanges (spike transcripts)

Empty until the owner runs the manual check with a real key (s2-brief § 3). Every contract case that runs against a
doc-derived fixture has a recorded twin in `tests/e2e/ai-adapters-contract.spec.ts` that stays `fixme` until its file is
here.

| Spike | What it settles | File |
|---|---|---|
| SP-R1 | PKCE return (`code`, `state`, deny shape), `/auth/keys` answer and its 4xx bodies, CORS | `SP-R1.json` |
| SP-R2 | `provider.only` (tags) and strictness, the 404 "No endpoints found" body, `usage.cost` on streams, served `model` / `provider` | `SP-R2.json` |
| SP-R3 | `GET /api/v1/key` fields | `SP-R3.json` |
| SP-R5 | native-file PDFs (page limit, `file-parser` `native`) | `SP-R5.json` |
| SP-R6 | the three plugin switch-offs, account defaults | `SP-R6.json` |
| SP-J4 | the Jev Router: plugin lists, `only` pins, served model, `usage.cost`, 404 body | `SP-J4.json` |

## Shape

```json
{ "spike": "SP-R2", "date": "2026-10-20", "request": { "method": "POST", "path": "/api/v1/chat/completions", "headers": {}, "body": {} },
  "response": { "status": 200, "headers": { "content-type": "text/event-stream" }, "sse": "data: …\n\n" } }
```

`response` holds `sse` (a stream, verbatim) or `json` (a JSON body).

## Scrub before saving

- The key (`Authorization`, any `sk-or-…`), the OAuth `code`, `code_verifier`, `state`, `user_id`.
- Generation ids (`gen-…`), account, workspace and key labels, e-mail addresses, the app address (`HTTP-Referer`).
- Prompt text that is not the fictional test text.
