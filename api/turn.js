// POST /api/turn  { state, text }  ->  { state, say, audio?, cache, nlu, source, timings }
import { extract } from "../lib/nlu.js";
import { step, initialState, GREETING } from "../lib/flow.js";
import { audioKey } from "../lib/audio-key.js";
import manifest from "../lib/l0-manifest.json" with { type: "json" };

// L0 lookup: if this exact reply was pre-rendered, point the browser at the CDN file.
function withAudio(say) {
  const key = audioKey(say);
  return manifest[key]
    ? { audio: `/audio/${key}.mp3`, cache: "L0" }
    : { cache: null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  if (body.start) {
    return res.status(200).json({
      state: initialState(),
      say: GREETING,
      ...withAudio(GREETING),
      timings: {},
    });
  }

  const t0 = performance.now();
  const { nlu, source } = await extract(body.text || "");
  const t1 = performance.now();
  const { state, say } = step(body.state || initialState(), body.text || "", nlu);
  const t2 = performance.now();

  res.status(200).json({
    state, say, nlu, source,
    ...withAudio(say),
    timings: { nlu_ms: +(t1 - t0).toFixed(1), flow_ms: +(t2 - t1).toFixed(1) },
  });
}