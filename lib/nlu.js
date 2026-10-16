// NLU: turn what the caller said into structured fields.
// LLM (Groq) when available, rules as fallback. The LLM only extracts;
// the flow decides what to say. Every field is validated and filtered
// by the current step before the flow sees it.

const MEDS = ["metformin", "lisinopril", "atorvastatin", "levothyroxine"];
const INTENTS = ["schedule", "refill"];
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const LLM_TIMEOUT_MS = 1500;

// Which fields each step is allowed to use. Anything else is ignored.
const ALLOWED = {
  name:           ["name", "intent", "medication"],
  dob:            ["dob"],
  intent:         ["intent", "medication"],
  medication:     ["medication"],
  confirm_refill: ["yes", "no"],
  slot:           ["choice", "no"],
  confirm_slot:   ["yes", "no"],
  wrap:           ["intent", "medication", "yes", "no"],
};

function forStep(nlu, step) {
  const keep = ALLOWED[step];
  if (!keep) return nlu;
  return Object.fromEntries(Object.entries(nlu).filter(([k]) => keep.includes(k)));
}

export function ruleNLU(text) {
  const t = text.toLowerCase();
  const out = {};
  if (/\b(refill|prescription|renew)\b/.test(t)) out.intent = "refill";
  else if (/\b(schedule|book|appointment|checkup|visit)\b/.test(t)) out.intent = "schedule";
  const med = MEDS.find((m) => t.includes(m));
  if (med) { out.medication = med; out.intent ??= "refill"; }
  if (/\b(yes|yeah|yep|sure|correct|go ahead|book it|please do)\b/.test(t)) out.yes = true;
  if (/\b(no|nope|that's all|nothing else|i'm good)\b/.test(t)) out.no = true;
  const ord = [/\b(first|1st|number one|option one)\b/, /\b(second|2nd|number two|option two)\b/, /\b(third|3rd|last|number three|option three)\b/].findIndex((r) => r.test(t));
  if (ord !== -1) out.choice = ord;

  const num = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const mon = MONTHS.findIndex((m) => t.includes(m));
  if (num) out.dob = `${num[3]}-${num[1].padStart(2, "0")}-${num[2].padStart(2, "0")}`;
  else if (mon !== -1) {
    const d = t.match(new RegExp(`${MONTHS[mon]}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`));
    if (d) out.dob = `${d[2]}-${String(mon + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}`;
  }
  const n = t.match(/(?:my name is|this is|i'm|i am|it's)\s+([a-z]+\s+[a-z]+)/) || t.match(/^([a-z]+\s+[a-z]+)$/);
  if (n) out.name = n[1];
  return out;
}

const STEP_HINTS = {
  name: "The agent just asked for the caller's first and last name.",
  dob: "The agent just asked for the caller's date of birth.",
  intent: "The agent just asked whether they want to schedule an appointment or refill a medication.",
  medication: "The agent just asked which medication they need refilled.",
  confirm_refill: "The agent just asked a yes/no question: should it send the refill?",
  slot: "The agent just offered three appointment times and asked which one works (first, second, or third).",
  confirm_slot: "The agent just asked a yes/no question: should it book this time?",
  wrap: "The agent just asked if there is anything else.",
};

function systemPrompt(step) {
  return `You extract fields from what a patient said on a clinic phone call.
${STEP_HINTS[step] || ""}
Reply with JSON only, using exactly these keys:
{"intent": "schedule"|"refill"|null, "name": "first last"|null, "dob": "YYYY-MM-DD"|null,
 "medication": string|null, "yes": boolean, "no": boolean, "choice": 0|1|2|null}
Rules:
- medication must be one of: ${MEDS.join(", ")}. Otherwise null.
- choice is 0 for the first option, 1 for second, 2 for third.
- A two-digit birth year means 19xx.
- Never guess. If something wasn't said, use null or false.`;
}

// Only accept values we can trust. Anything else is dropped.
function validate(raw) {
  const out = {};
  if (INTENTS.includes(raw.intent)) out.intent = raw.intent;
  if (typeof raw.name === "string" && /^[a-z]+ [a-z]+$/i.test(raw.name.trim())) out.name = raw.name.trim().toLowerCase();
  if (typeof raw.dob === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.dob)) out.dob = raw.dob;
  const med = typeof raw.medication === "string" ? raw.medication.toLowerCase() : null;
  if (MEDS.includes(med)) out.medication = med;
  if (raw.yes === true) out.yes = true;
  if (raw.no === true) out.no = true;
  if ([0, 1, 2].includes(raw.choice)) out.choice = raw.choice;
  return out;
}

export async function llmNLU(text, step) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemPrompt(step) }, { role: "user", content: text }],
      }),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const j = await res.json();
    return validate(JSON.parse(j.choices[0].message.content));
  } finally {
    clearTimeout(timer);
  }
}

export async function extract(text, step) {
  if (!process.env.GROQ_API_KEY) return { nlu: forStep(ruleNLU(text), step), source: "rules" };
  try {
    return { nlu: forStep(await llmNLU(text, step), step), source: "llm" };
  } catch (e) {
    const why = e.name === "AbortError" ? "timeout" : e.message;
    return { nlu: forStep(ruleNLU(text), step), source: `rules (llm ${why})` };
  }
}