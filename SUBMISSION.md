# FairMove — "The Negotiator"

**HackNation AI Hackathon · Challenge 01 (ElevenLabs: The Negotiator)**
Voice AI agents that **Call, Compare, and Haggle** in the residential moving market.
Solo build · Project Team ID **HN-1705** · Videos **max 60 seconds** each.

**GitHub:** https://github.com/rzlbautista/fairmove

---

## 1. Project Summary (paste as Short Description + long pitch)

Moving quotes for one identical job — Rock Hill to Charlotte, 45 miles, a two-bedroom — range from **$1,158 to $6,506**. That's a **5.6x spread** for the same work, and consumers overpay because the only way to find the fair price is to call a dozen companies and describe your apartment identically every time. Almost nobody does.

FairMove closes that loop with three voice agents. The **Estimator** — an ElevenLabs conversational agent in the browser, plus photo/document OCR — interviews the customer and builds one structured, user-confirmed **JobSpec**. The **Caller** injects that *identical* spec into calls to three counterparties with distinct negotiation styles: a tough highballer who resists discounts, a lowballer whose cheap base hides stairs, long-carry and fuel add-ons, and an upseller pushing packing and insurance. Each call ends as an itemized quote, a callback, or a documented decline. The **Closer** then negotiates with real leverage — *"I have a binding itemized quote for $3,191 from Ironclad; match or beat it?"* — and the price actually **moves on the recording**, bounded by a computed cost floor rather than a scripted line.

The proof point is honesty. The agent discloses it's AI the moment it's asked, never invents inventory, and can only cite quotes that exist in the store — an invented competitor has no record to come from. FairMove then produces a ranked report where cheapest doesn't win, citing transcript snippets and playable audio for every claim. Swapping movers for auto-body shops or contractors is a single JSON config file, not a rewrite.

*(Word count: 247 — within the 150–300 range.)*

### Short Description (form field)

> Voice AI agents that interview once, call movers with an identical JobSpec, compare itemized quotes, and negotiate with real competing leverage — so consumers stop overpaying on a 5.6x quote spread.

### Numbers to memorize

| Metric | Value |
|---|---|
| Market spread | **$1,158 – $6,506 (5.6x)** |
| Benchmark | **$2,852** |
| Lowballer | **$1,127 → $1,475** |
| Closer | **$3,394 → $3,191** (−$203) |
| Leverage | Ironclad **$3,191** |

---

## 2. Demo Video Script (max 60 sec)

**UI/UX showcase.** Must show a **price move**. Setup: live URL or `npm run dev` → Overview.

| Time | On screen | Say |
|---|---|---|
| 0–8s | Overview / 5.6x | “Same move: quotes from **$1,158 to $6,506**. FairMove calls, compares, and haggles so you don’t overpay.” |
| 8–20s | New move → Talk to estimator + live transcript | “Voice intake builds one JobSpec. Confirm before any outbound.” |
| 20–28s | Load demo scenario → launch | “Daniel’s Rock Hill → Charlotte — identical spec on every call.” |
| 28–42s | Call cards / Watch Queen City | “Three styles. Lowballer opens **$1,127** — real total **$1,475** after hidden fees.” |
| 42–55s | Closer / Results | “Closer cites a real stored quote. Price moves **$3,394 → $3,191** on the recording.” |
| 55–60s | Ranked report | “Cheapest ranks last. Recommendation with transcript evidence. That’s FairMove.” |

**Editing:** H.264 MP4. Caption the two price moves. Freeze-frame **$3,394 → $3,191**.

---

## 3. Tech Video Script (max 60 sec)

**Stack / architecture / implementation** — not a second UI tour.

| Time | On screen | Say |
|---|---|---|
| 0–10s | Repo tree / architecture | “Next.js + TypeScript. Closed loop: Estimator → JobSpec → Caller → Closer → ranked report.” |
| 10–22s | `elevenlabs.ts` outbound body | “One ElevenLabs template agent. Per-call context via `dynamic_variables` and prompt override.” |
| 22–35s | Voice signed URL / OCR | “Browser Estimator: signed URL WebRTC. Document OCR → same Zod JobSpec. User must confirm.” |
| 35–50s | `get_competing_quotes` / closer | “Honesty is code. Closer only cites quotes in the store. Concession is computed — price actually moves.” |
| 50–60s | `verticals/moving.json` | “Vertical is config-not-code. Simulation or live PSTN through the same orchestrators.” |

---

## 4. Team Video Script (max 60 sec)

On camera (solo):

> “I’m a solo builder. I designed and shipped FairMove end-to-end for Challenge 1. I work on production voice AI — HelloAlex with Bland, Twilio, and ElevenLabs — so I reused those patterns, not a fork. I picked moving because of the documented 5.6x quote spread. The differentiator is honesty: disclose AI, no fake bids, only cite real quotes. I wanted a demo where the price moves on the recording — not a scripted win.”

---

## 5. Structured form answers (paste)

**1. Problem & Challenge**  
Residential movers quote wildly different prices for the same job — Rock Hill → Charlotte examples range about **$1,158–$6,506 (5.6x)**. Consumers can’t easily gather comparable itemized quotes or negotiate with real leverage, so they overpay or fall for lowballs with hidden add-ons.

**2. Target Audience**  
People planning a local/residential move who want fair, comparable quotes without spending hours on the phone; also partners who want an honest, auditable negotiation trail (transcripts + citations).

**3. Solution & Core Features**  
**Estimator:** ElevenLabs browser voice interview (+ optional document OCR) → one user-confirmed JobSpec.  
**Caller:** identical JobSpec to 3 counterparties with distinct styles (tough / lowball / upsell); each call ends as quote, callback, or decline.  
**Closer:** negotiates using only stored competing quotes; price/terms can move on the recording.  
**Mission Control:** call logs, ranked report, red flags, transcript evidence.

**4. USP**  
Closed loop with **proof**: price moves from real leverage, not scripted TTS. Anti-bluff tooling — agents can only cite quotes that exist in the store. Cheapest doesn’t win if it’s a red-flag lowball. Vertical swaps via `verticals/moving.json` (config, not a rewrite).

**5. Implementation & Technology**  
Next.js (App Router) + TypeScript + Zod. ElevenLabs Conversational AI (signed URL WebRTC intake; outbound via ConvAI/Twilio when provisioned). OpenAI Vision for document intake. Local JSON store for jobs/calls (seeded demo on deploy). Orchestrators for Caller/Closer; simulation mode for reliable demos; same path for live PSTN when keys + phone ID are set.

**6. Results & Impact**  
End-to-end demo: confirmed JobSpec reused across calls; Queen City lowball exposed (**$1,127 → $1,475**); Closer concession (**$3,394 → $3,191**) citing Ironclad’s real quote; ranked report with transcript citations. Honesty constraints enforced in code.

**Most fun moment**  
When the Estimator finally talked back after the ElevenLabs tool-schema 422s, and I watched the live transcript fill in while I described a real move — then later saw the Closer drop the price **$3,394 → $3,191** using a quote that actually existed in the store. That closed-loop “it worked” moment was the high of the hackathon.

**Technologies/Tags**  
`Next.js` `TypeScript` `ElevenLabs` `Zod` `OpenAI` `Voice AI` `Conversational AI`

**Additional Tags**  
`negotiation` `JobSpec` `hackathon` `The Negotiator`

---

## 6. Submission checklist

- [ ] Short description + structured fields (above)
- [ ] Demo video ≤60s H.264 MP4
- [ ] Tech video ≤60s H.264 MP4
- [ ] Team video ≤60s H.264 MP4
- [ ] Team picture
- [ ] Live project URL (Vercel)
- [ ] GitHub: https://github.com/rzlbautista/fairmove
- [ ] Project Team ID HN-1705 + your Account ID in Manage Team
- [ ] Most fun moment
- [ ] Dataset: **N/A**
- [ ] Submit before **Jul 19, 9:00 AM ET**
