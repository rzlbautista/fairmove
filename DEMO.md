# FairMove — golden demo path

Target: **2–3 minutes**, one continuous user journey, no dead air.

## Before you start

```bash
npm install
npm run reset     # clean slate
npm run dev       # http://localhost:3000
```

No API keys needed. The header shows **Simulated market** — say this out loud rather than hiding it; the brief permits built counter-agents, and pretending otherwise is exactly the kind of bluff it penalises.

Have a second terminal ready with `npm run demo` — the terminal output is the best backup if the browser misbehaves.

---

## The script

### 0:00 — Open on the number, not the product

> "Real quotes for one specific move — Rock Hill to Charlotte, 45 miles, a two-bedroom — ranged from **$1,158 to $6,506**. Same job. A 5.6x spread. The only way to find the fair price is to call eight companies and describe your apartment identically eight times. Almost nobody does that."

Point at the spread bar. The markers are live — the benchmark and every quote received sit on the real scale.

### 0:20 — Press "Run the full loop"

While it runs, keep talking:

> "One voice interview, one uploaded inventory, four calls, one negotiation."

### 0:30 — Step 01, the Estimator

> "The voice interview and the uploaded inventory produced **the same** specification — 21 inventory lines, stairs at both ends, a 90-foot carry at pickup, a treadmill that doesn't fold, and an elevator in Charlotte too small for the sofa."

Point at the **spec hash** chip:

> "That hash is a fingerprint of the job material. Every call is stamped with it, and the report verifies they all match. That's how 'reused verbatim' is actually enforced rather than just claimed. And nothing gets dialled until the customer confirms — the API returns a 409 if you try."

### 0:55 — Step 02, the Caller

Three distinct styles, plus a fourth company that refuses to quote at all.

> "Ironclad is the tough dispatcher — opens high, interrupts, and asks if I'm a robot. Queen City is the lowballer. Carolina Premier upsells a packing package. Piedmont won't quote over the phone at all."

**The key beat — open Queen City's transcript.** Point at the opening number, then at the total:

> "They opened at **$1,127**. The real total is **$1,475**. The difference only appeared because the agent asked one question: *is there anything that could be added on moving day that isn't in that number?* They said 'nah, you're good' — and the agent pushed once more with specifics: 'I've got stairs at both ends and a 90-foot carry.' Then the fees came out."

> "Every fee flagged with the orange marker was withheld until we pushed. That's the mechanism behind the 30%-plus inflated final bills the BBB logs 13,000 complaints a year about — and it's now itemised, on the record, with the transcript turn it was said on."

Point at Piedmont:

> "And this one never gave a price. It's recorded as a **callback commitment** with a name and a time — not a made-up number, and it's kept out of the price ranking entirely."

### 1:40 — Step 03, the Closer *(the money shot)*

> "Now the agent calls Carolina Premier back. Before it can cite anyone, it calls `get_competing_quotes` — a tool that reads the database. It can only say what that tool returns. **An invented competitor has no record to come from.**"

> "It got Ironclad's real itemised quote — $3,191 — and used it."

Point at the price move: **$3,394 → $3,191**, plus three terms won.

Open the negotiation transcript and read the counterparty's line aloud:

> *"Alright. Against a real itemised number I can go to $3,191. That's me giving up $203 of margin and I'm not going lower — below that I'm paying my crew out of pocket."*

Then the crucial framing:

> "That number is not in a script. It's computed from the leverage presented, bounded by a concession ceiling and a hard cost floor. Show it a **lower** competing quote and it concedes **more**. Show it a competitor with no itemisation and this style refuses to move at all. Show it nothing and the agent says on the call — *'I don't have a competing quote I'd be willing to hold you to, so I won't pretend I do.'* Those four behaviours are asserted in the test suite."

### 2:20 — Step 04, the Report

> "Cheapest does not win."

Point at the ranking. Queen City is cheapest at $1,475 and ranks **last**:

> "It's 48% below what this job costs to staff. That's not a bargain, it's a warning sign — non-binding, no USDOT number, a 25% deposit, and five fees it hid until we pushed. FairMove scores it as a risk, and it was also barred from being used as leverage: you can't credibly say 'I'll take theirs' about a bid you've flagged as a scam."

Scroll to Evidence:

> "Every claim resolves to a conversation id and a transcript turn. The test suite verifies each cited turn exists and matches the transcript verbatim."

### 2:45 — Close on the honesty section

> "Disclosure opens every call. Asked 'am I talking to a robot?', the agent says yes immediately and keeps the quote — there's a test asserting the disclosure doesn't cost us the price. And swapping this from movers to auto body shops is a JSON file, not a rewrite."

---

## Backup plan

| If this breaks | Do this |
|---|---|
| Browser will not load | `npm run demo` — same orchestrators, full output in the terminal |
| Store is in a weird state | `npm run reset`, re-run |
| Something looks wrong in the UI | `curl localhost:3000/api/jobs/job_daniel_rockhill/report` — the raw report is the source of truth |
| Asked "is this real voice?" | Be straight: built counter-agents, one of three setups the brief allows. Add `ELEVENLABS_API_KEY` and the same orchestrators dispatch live calls through the adapter. |

## Numbers worth memorising

| | |
|---|---|
| Market spread | $1,158 – $6,506 (5.6x) |
| FairMove benchmark for this job | $2,852 |
| Lowballer headline → real total | $1,127 → $1,475 |
| Negotiation | $3,394 → $3,191, −$203, plus 3 terms |
| Saved vs highest quote | $203 at the table; the lowball trap avoided entirely |
| Outcomes | 4 quotes, 1 callback, 0 vague |
