// POST /api/tts  { text }  ->  audio/mpeg
// Baseline: synthesizes every request (no cache yet).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const text = (body.text || "").trim();
  if (!text || text.length > 400) return res.status(400).json({ error: "bad text" });

  const t0 = performance.now();
  const dg = await fetch("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en", {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  

  if (!dg.ok) {
    const err = await dg.text();
    return res.status(502).json({ error: "tts failed", detail: err.slice(0, 200) });
  }

  const audio = Buffer.from(await dg.arrayBuffer());
  const ttsMs = performance.now() - t0;
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("x-tts-ms", ttsMs.toFixed(0));
  res.setHeader("x-cache", "MISS");
  res.end(audio);
}