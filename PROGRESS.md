# FairMove — progress

Last updated: 2026-07-19

## Status: the loop is closed and demoable end to end

`npm run demo` and the Mission Control UI both run intake → three quote calls → negotiation → ranked report with evidence. Build is clean, 32/32 tests pass.

---

## What works

### Intake
- [x] `JobSpec` zod schema with a content fingerprint that proves verbatim reuse across calls
- [x] Document intake — inventory lists and written quotes → `JobSpec` draft, with per-field provenance, an explicit list of what is missing, and warnings for anything inferred
- [x] Voice intake endpoints — signed URL for the ElevenLabs widget, `submit_job_spec` tool sink, same draft shape
- [x] Merge of the two paths, recording both as provenance
- [x] Confirmation gate — `POST /api/jobs/:id/calls` returns 409 until the user confirms; edits bump `specVersion`

### Calls
- [x] Three distinct counterparty styles (ToughNegotiator / Lowballer / Upseller) plus a Stonewaller for the refusal path
- [x] All prices computed from the `JobSpec` × config posture — no literals in dialogue
- [x] Structured outcome on every call: quote / callback / decline. Failed calls are recorded as declines with the error, never silent gaps
- [x] Withheld-fee mechanic — fees appear only after the agent's disclosure question, tagged with the turn they were named on
- [x] Friction: interruption without restarting, evasion needing a second specific push, "we don't quote by phone" → named callback, "are you a robot?" → immediate disclosure without losing the quote
- [x] Concurrent dispatch (`Promise.allSettled`), identical orchestration path in both modes

### Negotiation
- [x] `get_competing_quotes` reads the store and is the only source of competitor figures
- [x] Leverage restricted to quotes with no high-severity flag; one live price per company (a negotiated quote supersedes the earlier one)
- [x] `computeConcession` — movement is a function of the leverage presented, bounded by a concession ceiling and a hard cost floor
- [x] Citations carry `conversationId`; the report verifies every cited turn exists and matches verbatim
- [x] Terms concessions when price will not move further

### Report
- [x] Ranking where cheapest does not win — below-benchmark outliers penalised as risks
- [x] Declarative red-flag engine driven by config
- [x] Evidence list: claim → conversation → turn → quoted text → recording link
- [x] Savings vs highest quote and vs the negotiation opening

### Platform
- [x] Signed, idempotent post-call webhook + polling fallback converging on one record
- [x] Atomic JSON store, serialised transactions, no regression of completed calls on late delivery
- [x] ElevenLabs adapter isolating all provider shapes from domain logic
- [x] Real-call path implemented behind a hard opt-in gate with graceful fallback
- [x] Mission Control UI — spread bar, spec, call cards with itemised fees and flags, negotiation before/after with the proof quote, ranked table, evidence, conversation-design section
- [x] 32 tests; `README.md`, `DEMO.md`, `docs/REAL_CALLS.md`, `.env.example`

---

## Deliberately stubbed

| Area | Current state | Why |
|---|---|---|
| **Live PSTN calls** | Implemented, gated off behind `FAIRMOVE_ALLOW_REAL_CALLS` | No provisioned number, and calling real businesses is an outward-facing action needing explicit approval and a genuine move |
| **Photo / PDF document intake** | Returns 415 with a clear message | Needs a vision model; the endpoint says what is missing rather than faking OCR |
| **Live business discovery** | Call list from config, in the Places response shape | Cut-list item; the schema mirrors `places:searchText` so the swap is a fetch |
| **LLM-driven counterparty dialogue** | Rule-driven simulation engine | Deliberate: it makes concessions a verifiable function of leverage. With `ELEVENLABS_API_KEY` set, real agents replace it via the same orchestrators |
| **Audio for simulated calls** | Endpoint returns a JSON explanation | There is no PSTN recording for an agent-to-agent call. Serving silence dressed up as a recording would be dishonest; the transcript is the evidence |

## Known limitations

- Ranking weights (price falloff, severity penalties, terms bonus) are hand-tuned, not learned
- The document parser is regex-based — robust on the fixture and on typed inventories, not on arbitrary layouts
- The store is a single JSON file; fine for one user, not for concurrent tenants
- The demo path uses a fixed seed, so conversation ids are stable across runs

## Next steps, in order

1. Provision an ElevenLabs phone number and run the caller against a user-owned test number end to end
2. Register the four client tools on the live agents and confirm `log_quote_line_item` populates line items from a real call
3. Wire vision/OCR so a photographed written quote parses into the same `JobSpec`
4. Add a second vertical config (auto body) to demonstrate the config-not-code claim concretely
5. Record the demo, tech and team videos; write the 150–300 word summary

## Blockers

- **No ElevenLabs credentials in this environment.** `.env` is empty. Handled: `.env.example` documents everything, and the simulated market keeps the loop closed and demoable. Every code path for live calls is written and typechecked, just not exercised against the live API.
