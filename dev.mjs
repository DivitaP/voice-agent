// Local dev server (no dependencies): serves /public and routes /api/turn.
// Usage: GROQ_API_KEY=... node dev.mjs   → http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import handler from "./api/turn.js";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/turn")) {
    let body = "";
    for await (const c of req) body += c;
    req.body = body;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  const path = join("public", req.url === "/" ? "index.html" : req.url.split("?")[0]);
  try {
    res.setHeader("Content-Type", TYPES[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404; res.end("not found");
  }
}).listen(3000, () => console.log("http://localhost:3000"));
