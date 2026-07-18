# FairMove

**Voice agents that call, compare and haggle — so you never overpay for a move.**

HackNation Challenge 01 · *The Negotiator* · powered by ElevenLabs.

---

## The problem

Real quotes collected for one specific move — Rock Hill → Charlotte, 45 miles, standard 2-bedroom service — ranged from **$1,158 to $6,506**. A 5.6x spread for identical work.

Finding the fair price means calling five to eight companies, describing the same apartment identically every time, sitting through hold music, comparing fee structures that are deliberately hard to compare, and negotiating. Almost nobody does this. So people take a sight-unseen phone quote from the friendliest voice and hope — and FMCSA data says those estimates are 40% more likely to blow up on moving day.

## What FairMove does

```
Voice interview  ─┐
                  ├─→  ONE confirmed JobSpec  ─→  identical call to every company
Document intake  ─┘                                        │
                                                           ▼
                                          itemised quote | callback | decline
                                                           │
                                                           ▼
                              negotiation using only REAL stored competing quotes
                                                           │
                                                           ▼
                          ranked report · red flags · transcript + recording evidence
```

## Quick start

```bash
npm install
npm run demo          # full loop in the terminal
npm run dev           # then open http://localhost:3000 and press "Run the full loop"
npm test              # 32 tests covering the guarantees below
```

**No API keys are required.** With no credentials, FairMove runs against its built counter-agents — one of the three counterparty setups the brief explicitly allows. Add `ELEVENLABS_API_KEY` and it switches to live ElevenLabs voice; see [`.env.example`](.env.example).

---

## The three modules

### 01 The Estimator — intake by interview *or* documents

Two paths, one schema. The ElevenLabs voice interview asks what a professional estimator asks — rooms, large items, stairs at both ends, truck-to-door distance, packing, coverage, access constraints. Document intake parses an inventory list or an existing written quote into the **same** `JobSpec`.

The parser never invents a field. Anything it cannot read stays `undefined` so the confirmation screen asks the user, rather than letting a plausible guess reach a phone call.

The user confirms the spec **before any call is placed** — the API returns `409` if you try to call first — and every call records a fingerprint of the spec material it used. The report verifies all fingerprints match, which is what "reused verbatim" means in practice.

*Code: [`src/lib/domain/jobspec.ts`](src/lib/domain/jobspec.ts), [`src/lib/extract/documentIntake.ts`](src/lib/extract/documentIntake.ts)*

### 02 The Caller — parallel quote gathering

Every company hears the identical job description. Each call must end in one of exactly three structured outcomes — **itemised quote**, **callback commitment**, or **documented decline**. Never "they said around two thousand".

The single most valuable question the agent asks is: *"Is there anything that could be added on moving day that isn't in that number?"* Fees named only after that push are tagged `disclosedOnlyWhenAsked` — which is how the report can prove a company was hiding the difference between its headline and its real total.

Friction is handled, not avoided: interruptions (the agent picks up where it was cut off rather than restarting), evasion (one firm re-ask with specifics, then move on), "we don't quote over the phone" (one graceful attempt at a range, then convert to a named callback commitment), and "am I talking to a robot?" (answered immediately and plainly — see below).

*Code: [`src/lib/orchestrator/caller.ts`](src/lib/orchestrator/caller.ts), [`src/lib/agents/prompts.ts`](src/lib/agents/prompts.ts)*

### 03 The Closer — negotiate, then report

The closer calls `get_competing_quotes`, which reads the store, and may cite **only** what comes back. It picks the cheapest quote it would actually stand behind — a bid flagged as a 30%-below-market risk is not honest leverage, because you cannot credibly say "I'll take theirs" about an offer you have flagged as a scam — and negotiates against the most expensive legitimate quote, because that is where the customer's money is.

The final report ranks every quote, and **cheapest does not win**: price is scored against proximity to the benchmark, and a quote far below what the job costs to staff is penalised as a risk. Every claim resolves to a conversation id and a transcript turn.

*Code: [`src/lib/orchestrator/closer.ts`](src/lib/orchestrator/closer.ts), [`src/lib/domain/report.ts`](src/lib/domain/report.ts)*

---

## Why the price actually moves

This is the part that separates a negotiation from a text-to-speech demo, so it is worth being precise.

**No price in this system is a literal in a script.** Every number is computed by [`pricing.ts`](src/lib/domain/pricing.ts) from the confirmed `JobSpec` and the counterparty's configured posture. Two companies quoting the same job differ only by their config multipliers.

Concessions are computed by [`computeConcession`](src/lib/providers/simulation.ts) as a function of the leverage actually presented:

| Input | Result |
|---|---|
| No competing quote | ~0% movement — bounded by `concessionWithoutEvidencePct` |
| Competitor named but not itemised, against a style that demands itemisation | **Not eligible.** No movement |
| Verified itemised competing quote | Real reduction, bounded by a concession ceiling **and** a hard cost floor |
| A *lower* competing quote | A *larger* concession |
| An absurd competing quote | Floor holds. The company would rather lose the booking |

Change the leverage and the transcript changes. That relationship is asserted directly in the tests — `a lower competing quote produces a larger concession` and `no counterparty can be pushed below its cost floor`.

## Where the honesty line sits

The constraint is structural, not just prompt text. The closer cannot obtain a competitor's figure by any route other than `get_competing_quotes`, which only returns rows that exist in the store, are complete, and carry no high-severity flag. **An invented bid has no record to come from.**

Reinforced by:

- Only one live price per company — a negotiated quote supersedes that company's earlier one, so a stale higher figure can never be re-cited as if it still stood
- The citation attached to a negotiation call carries the `conversationId` of the quote it came from, and the report verifies every cited turn exists and matches the transcript verbatim
- With no leverage available, the agent says so on the call — *"I don't have a competing quote I'd be willing to hold you to, so I won't pretend I do"* — and negotiates on fees and terms instead
- The agent may never claim a quote is binding unless the counterparty said so

**AI disclosure** opens every call, before anything else is said. Asked "am I talking to a robot?", the agent answers immediately, names itself as an AI, and keeps going — the test `disclosure must not cost the quote` asserts the call still ends in a quote.

## Config, not code

Everything vertical-specific lives in [`verticals/moving.json`](verticals/moving.json): the job-spec taxonomy and interview questions, the price model, the fee taxonomy, the red-flag rules, the negotiation levers, the call policy, and the counterparty roster with each style's pricing and behaviour.

Switching FairMove from movers to auto body shops means adding `verticals/autobody.json` and setting `FAIRMOVE_VERTICAL` — not rewriting the agents. Red-flag rules are declarative (`totalBelowBenchmarkPct`, `lineItemPctOfTotal`, `missingField`, …) and evaluated by a generic engine.

## Reliability

- **Webhook + polling.** The ElevenLabs post-call webhook is the fast path; `pollUntilComplete` guarantees a call still resolves if the webhook never lands. Both converge on the same record.
- **Idempotent persistence.** Correlation is by `conversationId`. Replaying a webhook, or having the poller arrive after it, updates one record rather than creating a second — and a completed call is never regressed by a late delivery.
- **Signed webhooks.** HMAC-SHA256 over `${timestamp}.${body}`, timing-safe compare, replay window. Unverified payloads are rejected outright in production.
- **A failed call is still a recorded call**, with a `decline` outcome and the error attached — never a silent gap in the comparison.
- **Real dialling is opt-in.** PSTN calls require `FAIRMOVE_ALLOW_REAL_CALLS=true` *and* full provisioning; otherwise the orchestrator falls back to the simulated market rather than failing.

## Architecture

```
src/lib/
  domain/       jobspec · quote · pricing · scoring · report      (no provider types)
  config/       vertical config loader + zod schema
  agents/       system prompts for estimator / caller / closer / counterparties
  providers/    elevenlabs adapter · simulation engine
  extract/      transcript → quote · document → jobspec
  orchestrator/ caller · closer · real-call dispatch
  store/        atomic JSON store, idempotent by conversationId
  webhook/      HMAC verification
src/app/        Mission Control UI + API routes
```

Provider-specific shapes are parsed and normalised in `providers/`. Domain logic never sees a raw ElevenLabs payload, so swapping the voice provider means writing a sibling adapter, not touching the orchestrators.

## API

| Route | Purpose |
|---|---|
| `POST /api/demo/run` | The whole loop, one call |
| `POST /api/jobs` · `PATCH /api/jobs/:id` | Create a job; edit and confirm the spec |
| `POST /api/intake/document` | Document → JobSpec draft, with provenance and gaps |
| `GET·POST /api/intake/voice` | Signed URL for the widget; `submit_job_spec` tool sink |
| `POST /api/jobs/:id/calls` | Quote-gathering round (409 until confirmed) |
| `POST /api/jobs/:id/close` | Negotiation pass |
| `GET /api/jobs/:id/report` | Ranked report with evidence |
| `GET /api/tools/competing-quotes` | The anti-bluffing agent tool |
| `POST /api/webhooks/elevenlabs` | Signed, idempotent post-call ingestion |

## Documentation

- [`DEMO.md`](DEMO.md) — the golden path, step by step
- [`PROGRESS.md`](PROGRESS.md) — what works, what is stubbed, what is next
- [`docs/REAL_CALLS.md`](docs/REAL_CALLS.md) — enabling live PSTN calls, and the safety gates
