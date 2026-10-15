// Client: push-to-talk STT (Web Speech API) → /api/turn → speechSynthesis TTS.
// Each turn records: stt_ms, nlu_ms, network_ms, tts_start_ms, ttfa_ms.

const $ = (id) => document.getElementById(id);
const log = $("log"), statusEl = $("status");
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const player = new Audio();

let callState = null;
let ended = false;
const metrics = [];

function bubble(text, who, cls = "") {
  const el = document.createElement("div");
  el.className = `msg ${who} ${cls}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function setStatus(s) { statusEl.textContent = s; }

async function speak(text) {
  const t = performance.now();
  const r = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    player.onplaying = () => {
      const startedAt = performance.now();
      setStatus("agent speaking");
      resolve({
        startedAt,
        tts_start_ms: startedAt - t,
        server_tts_ms: +r.headers.get("x-tts-ms"),
        cache: r.headers.get("x-cache"),
      });
    };
    player.onended = () => { URL.revokeObjectURL(url); setStatus(ended ? "call ended" : "your turn"); };
    player.src = url;
    player.play();
  });
}

async function api(body) {
  const t = performance.now();
  const r = await fetch("/api/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  return { ...j, network_ms: performance.now() - t };
}

async function startCall() {
  ended = false;
  log.innerHTML = "";
  const r = await api({ start: true });
  callState = r.state;
  bubble(r.say, "agent");
  $("mic").disabled = !SR;
  $("text").disabled = false;
  $("typed").querySelector("button").disabled = false;
  if (!SR) setStatus("speech recognition not supported in this browser — type instead");
  await speak(r.say);
}

async function turn(text, endOfSpeech, stt_ms) {
  if (ended || !text.trim()) return;
  bubble(text, "caller");
  setStatus("thinking");
  const r = await api({ state: callState, text });
  callState = r.state;
  ended = !!r.state.ended;
  bubble(r.say, "agent");
  const tts = await speak(r.say);
  const m = {
    turn: metrics.length + 1,
    stt_ms: stt_ms ?? null,
    nlu_ms: r.timings?.nlu_ms ?? null,
    network_ms: r.network_ms,
    tts_start_ms: tts.tts_start_ms,
    ttfa_ms: tts.startedAt - endOfSpeech,
    source: r.source,
    text,
    cache: tts.cache, 
    server_tts_ms: tts.server_tts_ms,
  };
  metrics.push(m);
  render();
  if (ended) {
    $("mic").disabled = true; $("text").disabled = true;
    $("typed").querySelector("button").disabled = true;
  }
}

// ---- push-to-talk ----
let rec = null, interimEl = null, releasedAt = 0;

function startListening() {
  if (!SR || ended) return;
  // speechSynthesis.cancel(); // caller can talk over the agent
  player.pause()
  rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  interimEl = bubble("…", "caller", "interim");
  rec.onresult = (e) => {
    const res = e.results[e.results.length - 1];
    interimEl.textContent = res[0].transcript;
    if (res.isFinal) {
      const finalAt = performance.now();
      const text = res[0].transcript;
      interimEl.remove(); interimEl = null;
      turn(text, releasedAt || finalAt, releasedAt ? finalAt - releasedAt : null);
    }
  };
  rec.onend = () => { if (interimEl) { interimEl.remove(); interimEl = null; } $("mic").classList.remove("live"); };
  rec.onerror = (e) => setStatus(`mic: ${e.error}`);
  releasedAt = 0;
  rec.start();
  $("mic").classList.add("live");
  setStatus("listening");
}

function stopListening() {
  if (!rec) return;
  releasedAt = performance.now();
  rec.stop();
}

const mic = $("mic");
mic.addEventListener("pointerdown", startListening);
mic.addEventListener("pointerup", stopListening);
mic.addEventListener("pointerleave", () => rec && $("mic").classList.contains("live") && stopListening());

$("start").onclick = startCall;
$("typed").onsubmit = (e) => {
  e.preventDefault();
  const v = $("text").value;
  $("text").value = "";
  turn(v, performance.now(), null);
};

// ---- metrics ----
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
const fmt = (v) => (v == null ? "–" : Math.round(v));

function render() {
  const ttfa = metrics.map((m) => m.ttfa_ms);
  $("p50").textContent = fmt(pct(ttfa, 50));
  $("p95").textContent = fmt(pct(ttfa, 95));
  $("turns").textContent = metrics.length;
  $("rows").innerHTML = metrics.map((m) =>
    `<tr><td>${m.turn}</td><td>${fmt(m.stt_ms)}</td><td>${fmt(m.nlu_ms)}</td><td>${fmt(m.network_ms)}</td><td>${fmt(m.tts_start_ms)}</td><td><b>${fmt(m.ttfa_ms)}</b></td><td>${m.source || ""}</td><td>${m.server_tts_ms || ""}</td><td>${m.cache || ""}</td></tr>`
  ).join("");
}

$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(metrics, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "metrics.json" });
  a.click();
};
