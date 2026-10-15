// POST /api/turn  { state, text }  ->  { state, say, nlu, source, timings }
import { extract } from "../lib/nlu.js";
import { step, initialState, GREETING } from "../lib/flow.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  if (body.start) {
    return res.status(200).json({ state: initialState(), say: GREETING, timings: {} });
  }

  const t0 = performance.now();
  const { nlu, source } = await extract(body.text || "");
  const t1 = performance.now();
  const { state, say } = step(body.state || initialState(), body.text || "", nlu);
  const t2 = performance.now();

  res.status(200).json({
    state, say, nlu, source,
    timings: { nlu_ms: +(t1 - t0).toFixed(1), flow_ms: +(t2 - t1).toFixed(1) },
  });
}
