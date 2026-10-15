// Shared cache key for TTS audio.
// Used by the pre-render script and the server, so both always agree.
import { createHash } from "node:crypto";

export const TTS_MODEL = "aura-2-thalia-en";

export function normalize(text) {
  return text.trim().replace(/\s+/g, " ");
}

export function audioKey(text) {
  return createHash("sha256")
    .update(`${TTS_MODEL}|${normalize(text)}`)
    .digest("hex")
    .slice(0, 16);
}