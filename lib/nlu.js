// NLU: extract structured fields from a caller utterance.
// Uses Groq (free tier) when GROQ_API_KEY is set, otherwise simple rules.

const MEDS = ["metformin", "lisinopril", "atorvastatin", "levothyroxine"];
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

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

const SYSTEM = `Extract fields from a patient's phone utterance. Reply with JSON only:
{"intent": "schedule"|"refill"|null, "name": string|null, "dob": "YYYY-MM-DD"|null,
 "medication": string|null, "yes": boolean, "no": boolean, "choice": 0|1|2|null}
Known medications: ${MEDS.join(", ")}. Never invent values.`;

export async function llmNLU(text) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const j = await res.json();
  const raw = JSON.parse(j.choices[0].message.content);
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (v !== null && v !== false) out[k] = v;
  if (out.medication) out.medication = String(out.medication).toLowerCase();
  if (out.name) out.name = String(out.name).toLowerCase();
  return out;
}

export async function extract(text) {
  if (!process.env.GROQ_API_KEY) return { nlu: ruleNLU(text), source: "rules" };
  try {
    return { nlu: await llmNLU(text), source: "llm" };
  } catch (e) {
    return { nlu: ruleNLU(text), source: `rules (llm failed: ${e.message})` };
  }
}
