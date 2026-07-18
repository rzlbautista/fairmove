# Enabling real phone calls

FairMove ships with real outbound calling implemented behind an adapter, but **switched off**. This document explains the gates and why they exist.

## The gates

Real PSTN dialling requires **all** of the following. Missing any one causes the orchestrator to log a warning and fall back to the simulated market — the loop stays closed rather than failing mid-demo.

```bash
ELEVENLABS_API_KEY=...            # account credential
ELEVENLABS_AGENT_ID_CALLER=...    # created once, reused
ELEVENLABS_AGENT_ID_CLOSER=...    # optional; falls back to the caller agent
ELEVENLABS_PHONE_NUMBER_ID=...    # provisioned Twilio/SIP number inside ElevenLabs
FAIRMOVE_ALLOW_REAL_CALLS=true    # explicit, deliberate opt-in
```

The last flag is deliberately separate. Having credentials in the environment is not consent to dial a real business — an outbound call is an irreversible, outward-facing action.

## Before you point this at real companies

Calling actual moving companies puts an AI on the phone with a small business that did not agree to be part of a hackathon demo. That is a real-world action with real-world consequences for them.

- **Have a real move.** The brief's strongest framing is "bring a problem you are actually facing". If you do not have one, do not manufacture calls to businesses who will spend ten minutes quoting a job that does not exist.
- **Disclosure is not optional.** It is the first thing said on every call and cannot be removed from the prompt.
- **Test against numbers you own first.** Point `verticals/moving.json` counterparty phone numbers at your own mobile and role-play the dispatcher before dialling a stranger.
- **Respect a refusal.** The caller prompt makes one graceful attempt at a range after a "we don't quote by phone", then converts to a callback. Do not tune that into badgering.
- **Check local law.** Recording consent and automated-calling rules vary by state; both endpoints here are in SC/NC.

## What happens on a real call

1. `dispatchRealCall` builds the system prompt from the confirmed `JobSpec` and the vertical config, then posts to `/v1/convai/twilio/outbound_call`. The job travels as `dynamic_variables`, so one agent serves every job.
2. ElevenLabs returns a `conversation_id`, which becomes the idempotency key for everything downstream.
3. The **post-call webhook** (`POST /api/webhooks/elevenlabs`) is the fast path — HMAC-verified, replay-windowed, deduplicated by conversation id.
4. **Polling** (`pollUntilComplete`) is the fallback and runs regardless, so a call still resolves if the webhook never lands. Both paths converge on the same record via `upsertCall`.
5. `extractQuoteFromTranscript` turns what was said into a structured outcome — preferring the agent's `log_quote_line_item` tool calls, falling back to a deterministic pass over the counterparty's speech. If no fee was priced, the result is a callback or a decline. **It never guesses a total.**

## Webhook setup

Point the ElevenLabs post-call webhook at:

```
https://<your-tunnel>/api/webhooks/elevenlabs
```

Set `ELEVENLABS_WEBHOOK_SECRET` to the shared secret. Without it, payloads are accepted unverified in development and **rejected outright in production**.

Signature format: `elevenlabs-signature: t=<unix_seconds>,v0=<hex_hmac_sha256>` computed over `${timestamp}.${rawBody}`. Verification is timing-safe with a 30-minute replay window.

## Agent tools to register

The prompts assume these client tools. Register them on the ElevenLabs agent:

| Tool | Purpose |
|---|---|
| `log_quote_line_item` | Log each fee as it is named — code, label, amount |
| `get_competing_quotes` | `GET /api/tools/competing-quotes?jobId=…` — the only source of competitor figures |
| `flag_red_flag` | Record a warning pattern observed mid-call |
| `end_call_with_outcome` | Mandatory once per call: `quote`, `callback`, or `decline` |
| `submit_job_spec` | Estimator only — `POST /api/intake/voice` |

`get_competing_quotes` must be a server-side tool hitting FairMove. That is what makes fabricating a competing bid structurally impossible rather than merely discouraged.
