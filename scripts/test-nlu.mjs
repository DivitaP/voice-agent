// Usage: node --env-file=.env.local scripts/test-nlu.mjs
import { extract, ruleNLU } from "../lib/nlu.js";

const cases = [
  ["name",           "yeah hi it's maria alvarez"],
  ["dob",            "march fourth nineteen fifty eight"],
  ["dob",            "3/4/1958"],
  ["intent",         "I'm running low on my metformin"],
  ["intent",         "can I come in to see the doctor"],
  ["confirm_refill", "sure go for it"],
  ["slot",           "the second one works"],
  ["wrap",           "nope that's everything"],
];

for (const [step, text] of cases) {
  const t = performance.now();
  const { nlu, source } = await extract(text, step);
  const ms = (performance.now() - t).toFixed(0);
  console.log(`\n[${step}] "${text}"`);
  console.log(`  llm   (${source}, ${ms} ms):`, JSON.stringify(nlu));
  console.log(`  rules:`, JSON.stringify(ruleNLU(text)));
}