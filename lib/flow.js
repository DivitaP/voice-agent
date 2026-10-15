// Minimal deterministic call flow for a clinic phone line.
// The LLM (optional) only extracts structured fields; this state machine
// decides every transition and every word the agent says.

export const CLINIC = "Riverside Family Medicine";

// Synthetic patients only. No real PHI.
const PATIENTS = [
  { id: "P-1001", name: "maria alvarez", first: "Maria", dob: "1958-03-04", pcp: "Dr. Patel",
    meds: ["metformin", "lisinopril"], pharmacy: "Walgreens on Main Street" },
  { id: "P-1002", name: "james okafor", first: "James", dob: "1971-11-22", pcp: "Dr. Nguyen",
    meds: ["atorvastatin", "levothyroxine"], pharmacy: "CVS on Elm Avenue" },
];

const SLOTS = {
  "Dr. Patel": ["Tuesday, October 20 at 9:30 AM", "Wednesday, October 21 at 2:00 PM", "Friday, October 23 at 11:15 AM"],
  "Dr. Nguyen": ["Wednesday, October 21 at 10:00 AM", "Thursday, October 22 at 1:15 PM", "Monday, October 26 at 4:00 PM"],
};

export function initialState() {
  return { node: "name", fields: {}, attempts: 0, patientId: null, ended: false };
}

export const GREETING = `Thank you for calling ${CLINIC}. You're speaking with an automated assistant, and this call may be recorded. Can I have your first and last name?`;

const EMERGENCY = /\b(chest pain|can'?t breathe|trouble breathing|stroke|heart attack|unconscious|overdose)\b/i;
const HUMAN = /\b(human|real person|representative|operator|front desk)\b/i;

export function step(state, text, nlu) {
  const s = structuredClone(state);
  const p = PATIENTS.find((x) => x.id === s.patientId);

  if (EMERGENCY.test(text)) {
    s.ended = true; s.node = "end";
    return { state: s, say: "If this is a medical emergency, please hang up and call 911. I'm connecting you to our on-call nurse now." };
  }
  if (HUMAN.test(text)) {
    s.ended = true; s.node = "end";
    return { state: s, say: "Of course, transferring you to our front desk now." };
  }

  switch (s.node) {
    case "name":
      if (!nlu.name) return { state: s, say: "Sorry, could you tell me your first and last name?" };
      s.fields.name = nlu.name.toLowerCase();
      s.node = "dob";
      return { state: s, say: `Thanks. To verify your identity, what's your date of birth?` };

    case "dob": {
      if (!nlu.dob) return { state: s, say: "Sorry, what's your date of birth, including the year?" };
      const match = PATIENTS.find((x) => x.name === s.fields.name && x.dob === nlu.dob);
      if (!match) {
        s.attempts += 1;
        if (s.attempts >= 3) { s.ended = true; s.node = "end"; return { state: s, say: "I wasn't able to verify you. Transferring you to the front desk." }; }
        s.node = "name";
        return { state: s, say: "I couldn't match that to our records. Let's try again. What's your first and last name?" };
      }
      s.patientId = match.id; s.node = "intent";
      return { state: s, say: `Thanks, ${match.first}, you're verified. I can schedule an appointment or refill a medication. What do you need today?` };
    }

    case "intent":
      if (nlu.intent === "schedule") {
        s.node = "slot";
        const slots = SLOTS[p.pcp];
        return { state: s, say: `${p.pcp} has openings on ${slots.join("; ")}. Which works best?` };
      }
      if (nlu.intent === "refill") {
        if (nlu.medication && p.meds.includes(nlu.medication)) {
          s.fields.medication = nlu.medication; s.node = "confirm_refill";
          return { state: s, say: `I can send your ${nlu.medication} refill to ${p.pharmacy}. Should I go ahead?` };
        }
        s.node = "medication";
        return { state: s, say: "Which medication do you need refilled?" };
      }
      return { state: s, say: "I can schedule an appointment or refill a medication. Which would you like?" };

    case "medication":
      if (!nlu.medication || !p.meds.includes(nlu.medication)) {
        return { state: s, say: "I don't see that on your medication list. Could you say the name again?" };
      }
      s.fields.medication = nlu.medication; s.node = "confirm_refill";
      return { state: s, say: `I can send your ${nlu.medication} refill to ${p.pharmacy}. Should I go ahead?` };

    case "confirm_refill":
      if (nlu.yes) { s.node = "wrap"; return { state: s, say: `Done, your ${s.fields.medication} refill was sent to ${p.pharmacy}. Anything else?` }; }
      s.node = "intent";
      return { state: s, say: "Okay, I won't send it. What else can I help with?" };

    case "slot": {
      const slots = SLOTS[p.pcp];
      const i = nlu.choice ?? -1;
      if (!slots[i]) return { state: s, say: "Which one works best: the first, second, or third?" };
      s.fields.slot = slots[i]; s.node = "confirm_slot";
      return { state: s, say: `To confirm, ${slots[i]} with ${p.pcp}. Should I book it?` };
    }

    case "confirm_slot":
      if (nlu.yes) { s.node = "wrap"; return { state: s, say: `You're booked for ${s.fields.slot}. Anything else?` }; }
      s.node = "slot";
      return { state: s, say: "No problem. Which of the other times works?" };

    case "wrap":
      if (nlu.intent) { s.node = "intent"; return step(s, text, nlu); }
      s.ended = true; s.node = "end";
      return { state: s, say: `Thanks for calling ${CLINIC}. Take care!` };

    default:
      s.ended = true;
      return { state: s, say: "Goodbye." };
  }
}
