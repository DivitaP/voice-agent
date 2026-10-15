// L1 cache: TTS audio in Upstash Redis (REST API, no client library).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24; // 1 day: slot times change daily

export const l1Enabled = Boolean(URL_ && TOKEN);

export async function l1Get(key) {
  const r = await fetch(`${URL_}/get/tts:${key}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) return null;
  const { result } = await r.json();
  return result ? Buffer.from(result, "base64") : null;
}

export async function l1Set(key, audio) {
  await fetch(`${URL_}/set/tts:${key}?EX=${TTL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: audio.toString("base64"),
  });
}