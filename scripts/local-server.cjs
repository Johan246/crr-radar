// Local dev server for the feedback function (browser testing only).
//   node scripts/local-server.cjs   → http://localhost:8787/api/feedback
// Loads ANTHROPIC_API_KEY from ../.env; forces dryRun so nothing is committed.
const http = require("http");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.ALLOWED_ORIGIN = "*"; // local testing

const handler = require("../api/feedback.js");

http
  .createServer(async (req, res) => {
    if (req.url !== "/api/feedback") { res.statusCode = 404; return res.end(); }
    // Shim the Vercel-style res helpers on the raw Node response.
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
    // Force dryRun locally so we never commit test reports.
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {}
    body.dryRun = true;
    req.body = body;
    await handler(req, res);
  })
  .listen(8787, () => console.log("feedback dev server on http://localhost:8787/api/feedback (dryRun)"));
