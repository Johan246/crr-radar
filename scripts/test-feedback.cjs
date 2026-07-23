// Local smoke test for api/feedback.js — exercises chat + finalize(dryRun)
// against the real LLM without committing anything.
//   node scripts/test-feedback.cjs
const fs = require("fs");
const path = require("path");

// Load ANTHROPIC_API_KEY from the project .env (same key as ingestion).
const envPath = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.ALLOWED_ORIGIN = "*";

const handler = require("../api/feedback.js");

function fakeRes() {
  return {
    _status: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { return this; },
  };
}
async function call(body) {
  const req = { method: "POST", headers: { "x-forwarded-for": "127.0.0.1" }, body };
  const res = fakeRes();
  await handler(req, res);
  return { status: res._status, json: res._json };
}

(async () => {
  console.log("== chat turn 1 ==");
  const messages = [
    { role: "user", content: "The reference library is great but I can't tell which documents are most recent — there's no way to sort or see what changed." },
  ];
  let r = await call({ mode: "chat", messages });
  console.log("status", r.status);
  console.log("assistant:", r.json.reply, "\n");

  messages.push({ role: "assistant", content: r.json.reply });
  messages.push({ role: "user", content: "Mainly on the Reference library tab. I'd like to sort by date, and ideally a 'new' marker when a document was updated recently. It's fairly important for my daily scan." });

  console.log("== chat turn 2 ==");
  r = await call({ mode: "chat", messages });
  console.log("status", r.status);
  console.log("assistant:", r.json.reply, "\n");
  messages.push({ role: "assistant", content: r.json.reply });

  console.log("== finalize (dryRun) ==");
  r = await call({ mode: "finalize", messages, dryRun: true });
  console.log("status", r.status);
  if (r.json.error) { console.log("ERROR:", r.json.error); process.exit(1); }
  console.log("thank_you:", r.json.thank_you);
  console.log("id:", r.json.id);
  console.log("\n---- report markdown ----\n");
  console.log(r.json.report.markdown);
})();
