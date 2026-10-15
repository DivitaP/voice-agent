// POST /api/tts { text, phi, cache } -> audio/mpeg
// L1: Redis cache for non-PHI dynamic replies. PHI is never cached.
import { TTS_MODEL, normalize, audioKey } from "../lib/audio-key.js";
import { l1Enabled, l1Get, l1Set } from "../lib/l1.js";

function send(res, audio, headers) {
  res.setHeader("Content-Type", "audio/mpeg");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, String(v));
  res.end(audio);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const text = normalize(body.text || "");
  if (!text || text.length > 400) return res.status(400).json({ error: "bad text" });

  const phi = body.phi !== false;                       // fail closed
  const useCache = l1Enabled && !phi && body.cache !== "off";
  const key = audioKey(text);

  if (useCache) {
    const t = performance.now();
    try {
      const hit = await l1Get(key);
      if (hit) return send(res, hit, { "x-cache": "L1", "x-tts-ms": 0, "x-redis-ms": (performance.now() - t).toFixed(0) });
    } catch {}                                          // fail open: fall through to TTS
  }

  const t0 = performance.now();
  const dg = await fetch(`https://api.deepgram.com/v1/speak?model=${TTS_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!dg.ok) return res.status(502).json({ error: "tts failed", detail: (await dg.text()).slice(0, 200) });
  const audio = Buffer.from(await dg.arrayBuffer());
  const ttsMs = performance.now() - t0;

  if (useCache) { try { await l1Set(key, audio); } catch {} }

  send(res, audio, {
    "x-cache": phi ? "PHI" : "MISS",
    "x-tts-ms": ttsMs.toFixed(0),
    "x-audio-bytes": audio.length,
  });
}