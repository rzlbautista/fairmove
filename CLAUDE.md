# FairMove — Claude Code Instructions

## Mission

Build the FairMove MVP for HackNation Challenge 01, “The Negotiator.”

Read these files before implementation:

- `../PLAN.md`
- `../01-ElevenLabs-The-Negotiator.docx.pdf`

FairMove must demonstrate one complete residential-moving workflow:

1. ElevenLabs voice interview and document intake produce the same confirmed `JobSpec`.
2. A caller uses that identical specification with three distinct counterparties.
3. Every call produces an itemised quote, callback commitment, or documented decline.
4. A closer negotiates using only genuine stored competing quotes.
5. The final report ranks quotes and cites recordings and transcript evidence.

## Absolute Workspace Boundary

- Read and write project code only within `D:\HackNation\fairmove`.
- The two challenge files listed above are read-only references.
- Never access or modify `D:\HelloAlex_BE`, `D:\HelloAlex_FE`, `D:\HelloAlexAI`,
  `D:\sow-generator`, `D:\Rizelle`, or any unrelated directory.
- Do not copy or fork HelloAlex code. Implement only the architectural patterns
  documented in `../PLAN.md`.
- If work appears to require access outside this boundary, record the blocker in
  `PROGRESS.md` and continue with another in-scope task.

## Safety Rules

- Never run destructive commands such as `git reset --hard`, `git clean -fd`,
  force push, disk formatting, recursive deletion, or history rewriting.
- Never install global packages or modify OS, shell, editor, Git, network, or
  user-level configuration.
- Never print, commit, transmit, or copy secrets.
- Do not read `../.env`. Use only this project's `.env.local`.
- If an API key is absent, update `.env.example`, implement a mock/demo fallback,
  document the blocker, and continue.
- Never deploy, publish, purchase services, call real businesses, send messages,
  or create external resources without explicit user approval.
- Use simulated counterpart agents or user-owned test numbers until real calling
  is explicitly approved.
- Do not use Lovable credits or APIs. Build the MVP UI directly in Next.js.
- Keep all generated artifacts, recordings, fixtures, and temporary files inside
  this project.

## Implementation Priorities

Use this order:

1. Working closed loop
2. Reliable voice conversations
3. Structured outcomes and evidence
4. Demo resilience and mock fallback
5. Visual polish

Never cut:

- Confirmed `JobSpec` reused verbatim
- Three distinct negotiation styles
- One measurable price or terms change caused by genuine leverage
- AI disclosure and no fabricated quotes
- Ranked report with transcript/recording evidence

Cut first if time is short:

- Real PSTN calls
- Live business discovery
- Parallel execution
- Nonessential animation and analytics

## Technical Direction

- Next.js App Router with TypeScript
- ElevenLabs Conversational AI / Agents
- ElevenLabs post-call webhook with polling fallback
- Zod schemas for all provider and domain payloads
- SQLite or a small local persistence layer
- `verticals/moving.json` for benchmarks, fee taxonomy, red flags, and levers
- Deterministic demo fixtures when an external API is unavailable

Provider-specific code belongs behind small adapters. Domain logic must not
depend directly on raw ElevenLabs response shapes.

## Working Method

- Keep `PROGRESS.md` current with completed work, active blockers, test status,
  and the next concrete step.
- Keep `DEMO.md` current with a reproducible golden-path demonstration.
- Work in small, testable increments.
- Run relevant type checks, lint, and tests after substantive changes.
- Fix errors introduced by the current change before moving on.
- Prefer a reliable implementation over broad but unfinished features.
- Commit only working milestones, only in this repository, with clear messages.

## Definition of Done

- Voice and document intake converge on one editable, confirmed `JobSpec`.
- Three counterpart styles return structured, comparable outcomes.
- At least one closer call changes a price or term using a persisted real quote.
- The UI shows ranked quotes, red flags, recommendation rationale, transcripts,
  and recording links.
- Webhook ingestion is idempotent and polling recovers missed callbacks.
- The app has a documented mock mode for a dependable demo.
- `README.md`, `DEMO.md`, `PROGRESS.md`, and `.env.example` are complete.
- No secret or unrelated workspace file is tracked by Git.
