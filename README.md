# Clinic Voice Agent (baseline)

A minimal voice agent for a clinic phone line: identity verification, then scheduling or a medication refill. It runs entirely on free tiers and is instrumented so every turn's latency is measured.

> The baseline scaffold was generated with Claude. The optimization work is mine (see below).

## How it works

```
Caller speech ─► Web Speech API (STT, in browser)
             ─► POST /api/turn ─► NLU (Groq LLM if key set, else rules)
                                ─► deterministic flow (state machine picks every word)
             ◄─ reply text
             ─► speechSynthesis (TTS, in browser)
```

- **The LLM only extracts fields** (intent, name, DOB, medication, yes/no). It never writes what the agent says.
- **The flow is a pure function** `step(state, text, nlu) → { state, say }` in `lib/flow.js`.
- **Global rules** (emergency language, asking for a human) are regex checks evaluated before the flow on every turn.
- **Metrics per turn:** STT finalization, NLU, network round-trip, TTS start, and **TTFA** (end of caller speech → agent audio starts), with p50/p95 and JSON export.

## Run locally

```bash
node dev.mjs                      # rules-only NLU, no keys needed
GROQ_API_KEY=gsk_... node dev.mjs # LLM extraction via Groq free tier
```

Open http://localhost:3000 in Chrome or Edge (Web Speech STT support). Typing works in any browser.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, choose **Add New → Project** and import the repo. Leave the framework preset as **Other**.
3. Optional: add `GROQ_API_KEY` under **Settings → Environment Variables**.
4. Deploy. `public/` is served statically and `api/turn.js` becomes a serverless function.

## Demo patients (synthetic)

| Name | DOB | Meds | PCP |
|---|---|---|---|
| Maria Alvarez | March 4, 1958 | metformin, lisinopril | Dr. Patel |
| James Okafor | November 22, 1971 | atorvastatin, levothyroxine | Dr. Nguyen |

## Baseline numbers

| Metric | p50 | p95 |
|---|---|---|
| TTFA (rules NLU) | _ms_ | _ms_ |
| TTFA (Groq NLU) | _ms_ | _ms_ |

## Optimization

_TODO: problem, approach, before/after._
