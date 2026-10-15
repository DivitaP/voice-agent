// Pre-render every static reply to public/audio/<key>.mp3 (L0 cache).
// Idempotent: existing files are skipped, so re-runs only pay for new lines.
// Usage: node --env-file=.env.local scripts/prerender.mjs
import { mkdir, writeFile, access } from "node:fs/promises";
import { STATIC } from "../lib/flow.js";
import { audioKey, normalize, TTS_MODEL } from "../lib/audio-key.js";

const OUT = "public/audio";
await mkdir(OUT, { recursive: true });

const manifest = {};
let made = 0, skipped = 0, chars = 0;

for (const [name, text] of Object.entries(STATIC)) {
  const key = audioKey(text);
  const file = `${OUT}/${key}.mp3`;
  manifest[key] = name;

  try { await access(file); skipped++; continue; } catch {}

  const r = await fetch(`https://api.deepgram.com/v1/speak?model=${TTS_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: normalize(text) }),
  });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);

  await writeFile(file, Buffer.from(await r.arrayBuffer()));
  made++; chars += normalize(text).length;
  console.log(`✓ ${name.padEnd(12)} → ${key}.mp3`);
}

await writeFile("lib/l0-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`\ndone: ${made} rendered, ${skipped} already existed, ${chars} chars billed`);