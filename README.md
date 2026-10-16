# Clinic Voice Agent: caching the voice, not just the data

Live demo: https://voice-agent-two-ivory.vercel.app

Same thing with caching turned off: https://voice-agent-two-ivory.vercel.app/?cache=off

Demo video: https://github.com/user-attachments/assets/d8be2d91-0ce5-4f60-bcde-6f5b41fc565c

## What this is

A small voice agent for a clinic phone line. It checks who you are (name + date of birth), then helps you book an appointment or refill a medication.

I used Claude to generate the base app quickly. The part I actually worked on is the latency problem below: finding it, measuring it, and fixing it.

## The problem I noticed

Once I moved text-to-speech to the server (which is how real phone agents work), I timed every turn. The agent took about **2 seconds** on a normal reply and almost **7 seconds** on the long ones before it started talking.

When I broke the time down, almost all of it (~97%) was the TTS step, i.e. turning the reply text into audio. The logic and the network were basically nothing.

Then I noticed something else. The agent says the same sentences over and over. "What's your date of birth?" gets said on every single call, and we were paying to generate that audio from scratch every time.

## My idea

This agent is deterministic. The code decides exactly what the agent says, not an LLM making up new sentences. So most replies are predictable, which means we can generate the audio once and reuse it.

I split replies into three buckets:

| Type | Example | What I do |
|---|---|---|
| Always the same | "What's your date of birth?" | Generate once before deploying, serve as a static file (**L0**) |
| Changes, but is the same for everyone | "Dr. Patel has openings on Tuesday…" | Generate the first time, save in Redis, reuse for every caller after that (**L1**) |
| Has the patient's personal info | "Thanks, Maria, you're verified." | **Never saved.** Generate fresh every time |

That last row matters a lot in healthcare (see PHI below). I'd rather pay 2 seconds on that one line than store a patient's name in a shared cache.

## Where the AI is

| Step | What it does | What runs it |
|---|---|---|
| Speech to text | Turns the caller's voice into text | Browser speech recognition (ML model) |
| Understanding (NLU) | Turns messy text into clean fields like `{intent: "refill", medication: "metformin"}` | LLM (`gpt-oss-20b` on Groq), with simple rules as a backup |
| Deciding the reply | Picks exactly what the agent says next | Plain code (a state machine), on purpose |
| Text to speech | Turns the reply into a natural voice | Deepgram Aura (neural TTS) |

The idea is: **the AI understands, the code decides what to say.** The LLM never writes the reply. It only pulls out the fields, and the code picks the sentence.

That's also the reason the cache works at all. If an LLM wrote every reply, no two replies would match word for word and there would be nothing to reuse. Because the code controls the wording, 84% of replies are reusable.

### Why I added the LLM

I first used simple keyword rules for understanding. They work if you say things the "expected" way, but break pretty fast with how people actually talk. I tested the same phrases on both:

| What the caller said | Rules got | LLM got |
|---|---|---|
| "march fourth nineteen fifty eight" | nothing | `dob: 1958-03-04` |
| "can I come in to see the doctor" | nothing | `intent: schedule` |
| "yeah hi it's maria alvarez" | name, plus a wrong `yes` (from "yeah") | name only |
| "I'm running low on my metformin" | refill, plus a wrong name ("running low") | refill + metformin |
| "3/4/1958", "the second one works" | correct | correct |

So rules either miss natural phrasing or pick up things that aren't there.

### Keeping the LLM in check

I don't trust the LLM output directly. Three guards:

- **Validation:** only known intents, known medications, and a proper `YYYY-MM-DD` date are accepted. Anything else gets dropped.
- **Step filter:** each step only accepts the fields that make sense there. At the "should I book it?" step, only yes/no counts. Early on, the LLM kept adding extra fields (like an intent when the caller just said "sure"), and this removed them.
- **Timeout + fallback:** if the LLM takes more than 1.5 s or errors out, it falls back to the rules, so a call never gets stuck.

The LLM adds about 200–600 ms per turn (around 320 ms typical) compared to ~1 ms for rules. That's a real cost, but a TTS miss was ~2 s, so caching still matters more. With the LLM on, a cached turn is roughly 320 ms + ~250 ms instead of 320 ms + ~2 s.

## Terms, in plain words

- **TTS (text-to-speech):** turns the agent's text into spoken audio. I use Deepgram for this.
- **TTFA (time to first audio):** how long the caller waits between finishing speaking and hearing the agent start talking. This is the number that makes a voice agent feel fast or slow, so it's what I measured.
- **p50 / p95:** p50 is the typical turn (half the turns are faster than this). p95 is the slow end (only 5% of turns are slower).
- **Cache hit / miss:** a hit means we already had the audio saved. A miss means we had to generate it.
- **L0:** audio files I generate before deploying. They're served straight from Vercel's CDN, so a hit doesn't even touch my server.
- **L1:** audio saved in Redis (a fast key-value store, I'm using Upstash) the first time it's generated. Every caller after that gets the saved copy.
- **NLU (natural language understanding):** the step that figures out what the caller means and turns it into fields the code can use.
- **LLM (large language model):** the AI model that does the understanding here. It's good with messy, natural phrasing, but slower than rules.
- **PHI (Protected Health Information):** anything that ties a real person to their healthcare, like their name and DOB on a clinic call. HIPAA has strict rules about storing it. By never caching anything that contains PHI, the cache stays out of that problem completely.

## How it works

1. The caller speaks (or types). The server figures out what they want and decides the reply.
2. The server hashes the reply text (plus the voice model name) to get a key.
3. If that key is a pre-generated file, the browser plays it from the CDN. **(L0)**
4. Otherwise the browser asks `/api/tts`. If the reply has no personal info, it checks Redis first. **(L1)**
5. If nothing is cached, it calls Deepgram, plays the audio, and saves it to Redis for next time (unless it's PHI).

A few decisions I made on purpose:

- **The voice model is part of the key.** If I change the voice, all the old audio stops matching automatically, so it can never play the wrong voice.
- **If unsure, treat it as PHI.** If a request doesn't explicitly say "this has no personal info", it doesn't get cached.
- **If Redis is down, the call still works.** It just falls back to generating audio normally. The cache should make things faster, never break them.
- **Saved audio expires after a day,** because things like appointment slots change daily.

## How I benchmarked

I typed the calls instead of speaking them, so every run has the exact same input and the only thing that changes is the cache. Speaking would add speech-recognition time and mistakes, which makes the numbers noisy.

These are the 3 calls I ran every time (19 turns total):

**Call A: Maria, medication refill**
1. `my name is Maria Alvarez`
2. `March 4th, 1958`
3. `I need a refill on my metformin`
4. `yes`
5. `no thanks`

**Call B: James, booking an appointment**
1. `my name is James Okafor`
2. `11/22/1971`
3. `book an appointment`
4. `the second one`
5. `yes`
6. `that's all`

**Call C: wrong DOB first, then a booking**
1. `my name is Maria Alvarez`
2. `January 1st, 1990`
3. `my name is Maria Alvarez`
4. `March 4th, 1958`
5. `book an appointment`
6. `the first one`
7. `yes`
8. `no`

Steps:
1. **No cache:** open `/?cache=off`, run A → B → C, export metrics.
2. **With cache:** open `/`, run A → B → C once to warm it up, refresh the page, run A → B → C again, export metrics.

Both runs were on the live Vercel site, so they're on the same infrastructure.

These runs used the rules for understanding (not the LLM), so the numbers only show the TTS change. With the LLM on, add roughly 320 ms to every turn in both columns.

## Results

Same 3 calls (19 turns), live site, cached run done after one warm-up pass.

| | No cache | With cache | Change |
|---|---|---|---|
| Typical turn (p50 TTFA) | 2,166 ms | **245 ms** | ~9× faster |
| Average turn | 2,799 ms | **600 ms** | −79% |
| Total waiting across 3 calls | 53.2 s | **11.4 s** | |
| Longest reply (slot list) | 6,840 ms | **256 ms** | ~26× faster |
| TTS API calls | 19 | **3** | −84% |
| Cache hit rate | 0% | **84%** (8 L0, 8 L1) | |

The only 3 turns that weren't cached were the "you're verified" lines with the patient's name. That's on purpose, and it's also why the p95 is still high (3.6 s): the slowest turns left are exactly the PHI ones.

Raw numbers are in `bench/live-baseline.json` and `bench/live-cached.json`.

## Things I ran into

- **The cache silently didn't work on Vercel at first.** Vercel added a prefix to the Redis env variable names, so my code couldn't find them. Because the cache is designed to fail safely, nothing broke; it was just slower. That's good behavior, but it also means you need a way to see it. I'd add a health check for this next.
- **My first timing was wrong.** I stopped the timer when Deepgram's response headers arrived, but the audio was still being generated after that. Moving the timer to after the full audio download changed the TTS number from ~300 ms to ~2 s, which is what showed me where the real problem was.

## What I'd do next

1. **Cache part of the PHI lines.** "Thanks, Maria, you're verified…" is mostly the same sentence. I could cache everything except the name and stitch the pieces together, so even those turns would be fast.
2. **Pre-warm the cache overnight,** e.g. generate tomorrow's appointment slot audio at night so the first caller of the day gets a hit too.
3. **Stream the audio** instead of waiting for the whole file, so misses start playing sooner.
4. **Don't make misses wait on the Redis write** (Vercel's `waitUntil`).
5. **Swap browser speech recognition for Whisper** (also on Groq) for better accuracy on drug names and dates.
6. **Let the LLM understand day names** for slots ("the Friday one"), not just first/second/third.

## Run it yourself

```bash
# .env.local
DEEPGRAM_API_KEY=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
GROQ_API_KEY=...            # optional; without it, rules are used
GROQ_MODEL=openai/gpt-oss-20b

npm run prerender   # generate the L0 audio files once
npm run dev         # http://localhost:3000
```

Demo patients (fake data):

| Name | DOB | Meds | Doctor |
|---|---|---|---|
| Maria Alvarez | March 4, 1958 | metformin, lisinopril | Dr. Patel |
| James Okafor | November 22, 1971 | atorvastatin, levothyroxine | Dr. Nguyen |

Try: "my name is Maria Alvarez" → "March 4th, 1958" → "I need a refill on my metformin".

Or talk more naturally: "yeah hi it's maria alvarez" → "march fourth nineteen fifty eight" → "I'm running low on my metformin".

To compare rules vs the LLM yourself: `node --env-file=.env.local scripts/test-nlu.mjs`