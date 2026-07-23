// CRR Radar — feedback endpoint (Vercel serverless, Node).
//
// Stateless: the browser holds the conversation and posts the full transcript
// each turn. Two modes:
//   { mode: "chat",     messages: [...] }            -> polite clarifying reply
//   { mode: "finalize", messages: [...], contact? }  -> structured report,
//                                                        committed to the repo
//
// Env (set in the Vercel dashboard):
//   ANTHROPIC_API_KEY  (required)
//   GITHUB_TOKEN       (fine-grained PAT, contents:write on the repo)
//   GITHUB_REPO        e.g. "Johan246/crr-radar"   (required for finalize)
//   GITHUB_BRANCH      default "main"
//   ALLOWED_ORIGIN     default "https://johan246.github.io"
//   FEEDBACK_MODEL     default "claude-haiku-4-5-20251001"

const MODEL = process.env.FEEDBACK_MODEL || "claude-haiku-4-5-20251001";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://johan246.github.io";
const MAX_TURNS = 24;              // hard cap on transcript length
const MAX_CHARS_PER_MSG = 4000;    // hard cap per user message
const RATE_MAX = 12;               // requests per window per IP (best-effort)
const RATE_WINDOW_MS = 60_000;

const CLARIFIER_SYSTEM = `You are the feedback assistant for CRR Radar, a dashboard \
that helps credit-risk professionals track EU CRR/CRR3 regulatory developments \
(a news feed classified as regulatory vs. commentary, topic and status tags, a \
two-persona relevance review, and a curated reference library).

Your job is to warmly and gratefully collect actionable product feedback. Always:
- Open by thanking the person sincerely and specifically for the point they raised.
- Ask ONE clarifying question at a time (occasionally two if tightly related), and \
only when it would materially help a developer act — e.g. which view or source, \
what they expected vs. saw, how important it is, a concrete example.
- Keep replies short (2-4 sentences), plain, and appreciative. Never defensive.
- Do not promise specific fixes or timelines. Do not invent features that exist.
- After you have enough to write a clear, actionable report (usually 1-3 exchanges), \
thank them again and let them know they can submit it with the button.

You are collecting feedback, not providing regulatory advice.`;

const REPORT_TOOL = {
  name: "record_feedback_report",
  description: "Produce a structured, developer-actionable report from the feedback conversation.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short imperative title, e.g. 'Add PDF export to item detail'." },
      category: { type: "string", enum: ["bug", "feature-request", "content", "data-source", "ux", "performance", "other"] },
      severity: { type: "string", enum: ["low", "medium", "high"] },
      area: { type: "string", enum: ["dashboard-frontend", "ingestion-pipeline", "sources", "reference-library", "feedback", "other"] },
      summary: { type: "string", description: "2-4 sentence neutral summary of the request/problem." },
      user_points: { type: "array", items: { type: "string" }, description: "Key verbatim-ish points the user made." },
      reproduction: { type: "string", description: "Steps to reproduce, if a bug; else empty." },
      suggested_changes: { type: "array", items: { type: "string" }, description: "Concrete, developer-actionable changes." },
      acceptance_criteria: { type: "array", items: { type: "string" }, description: "How to know the change is done." },
      affected_files_hint: { type: "array", items: { type: "string" }, description: "Optional likely files/dirs, e.g. 'site/app.js', 'config/sources.yaml'." },
      thank_you: { type: "string", description: "A warm, specific closing thank-you message shown to the user." }
    },
    required: ["title", "category", "severity", "area", "summary", "user_points", "suggested_changes", "acceptance_criteria", "thank_you"]
  }
};

const _hits = new Map(); // ip -> [timestamps]  (best-effort, per-instance)

function rateLimited(ip) {
  const now = Date.now();
  const arr = (_hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  _hits.set(ip, arr);
  return arr.length > RATE_MAX;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_MSG) }));
}

async function anthropic(payload) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

function slugify(s) {
  return (s || "feedback").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "feedback";
}

function buildReportMarkdown(report, transcript, id, createdAt) {
  const list = (arr) => (arr && arr.length ? arr.map((x) => `- ${x}`).join("\n") : "- (none provided)");
  const checks = (arr) => (arr && arr.length ? arr.map((x) => `- [ ] ${x}`).join("\n") : "- [ ] (none provided)");
  const convo = transcript
    .map((m) => `**${m.role === "user" ? "User" : "Assistant"}:** ${m.content}`)
    .join("\n\n");
  return `---
id: ${id}
created: ${createdAt}
status: open
category: ${report.category}
severity: ${report.severity}
area: ${report.area}
---

# ${report.title}

## Summary
${report.summary}

## What the user reported
${list(report.user_points)}
${report.reproduction ? `\n## Reproduction\n${report.reproduction}\n` : ""}
## Suggested changes (developer-actionable)
${checks(report.suggested_changes)}

## Acceptance criteria
${list(report.acceptance_criteria)}

## Likely affected files
${list(report.affected_files_hint)}

## Full conversation
${convo}
`;
}

async function commitReport(path, markdown, message) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!repo || !process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_REPO / GITHUB_TOKEN not configured");
  }
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "crr-radar-feedback",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(markdown, "utf8").toString("base64"),
      branch,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data.content && data.content.html_url;
}

const LABEL_COLORS = {
  "user-feedback": "1f6feb",
  "severity:high": "b60205",
  "severity:medium": "d4a72c",
  "severity:low": "0e8a16",
  category: "5319e7",
  area: "0052cc",
};

function issueLabels(report) {
  const labels = ["user-feedback"];
  if (["low", "medium", "high"].includes(report.severity)) labels.push(`severity:${report.severity}`);
  if (report.category) labels.push(`category:${report.category}`);
  if (report.area) labels.push(`area:${report.area}`);
  return labels;
}

function labelColor(name) {
  return LABEL_COLORS[name] || LABEL_COLORS[name.split(":")[0]] || "ededed";
}

function buildIssue(report, id, reportUrl) {
  const list = (arr) => (arr && arr.length ? arr.map((x) => `- ${x}`).join("\n") : "- (none)");
  const checks = (arr) => (arr && arr.length ? arr.map((x) => `- [ ] ${x}`).join("\n") : "- [ ] (none)");
  const body = [
    `**Report:** [\`feedback/reports/${id}.md\`](${reportUrl || "#"})`,
    `**Category:** ${report.category} · **Severity:** ${report.severity} · **Area:** ${report.area}`,
    ``,
    `## Summary`,
    report.summary,
    ``,
    `## Suggested changes`,
    checks(report.suggested_changes),
    ``,
    `## Acceptance criteria`,
    list(report.acceptance_criteria),
    ``,
    `<sub>Filed automatically from CRR Radar user feedback. Full transcript in the linked report.</sub>`,
  ].join("\n");
  return { title: `[feedback] ${report.title}`, body, labels: issueLabels(report) };
}

async function ghApi(method, endpoint, payload) {
  const resp = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "crr-radar-feedback",
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return resp;
}

async function ensureLabels(labels) {
  // Idempotent: create each label, ignore "already exists" (422).
  await Promise.all(
    labels.map((name) =>
      ghApi("POST", "labels", { name, color: labelColor(name) }).catch(() => {})
    )
  );
}

async function createIssue(report, id, reportUrl) {
  const issue = buildIssue(report, id, reportUrl);
  await ensureLabels(issue.labels);
  const resp = await ghApi("POST", "issues", issue);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub issue ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.html_url;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "Too many requests — please slow down." });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const mode = body.mode === "finalize" ? "finalize" : "chat";
  const messages = sanitizeMessages(body.messages);
  if (body.hp) return res.status(200).json({ reply: "Thank you!" }); // honeypot
  if (!messages.length) return res.status(400).json({ error: "No messages provided" });

  try {
    if (mode === "chat") {
      const data = await anthropic({
        model: MODEL,
        max_tokens: 400,
        system: CLARIFIER_SYSTEM,
        messages,
      });
      const reply = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return res.status(200).json({ reply: reply || "Thank you for sharing that." });
    }

    // finalize
    const data = await anthropic({
      model: MODEL,
      max_tokens: 1200,
      system:
        "Synthesize the following feedback conversation into a structured, " +
        "developer-actionable report for the CRR Radar dashboard using the tool. " +
        "Be concrete and specific; base everything on what the user actually said.",
      messages: [
        {
          role: "user",
          content:
            "Feedback conversation:\n\n" +
            messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n") +
            (body.contact ? `\n\nContact (optional): ${String(body.contact).slice(0, 200)}` : ""),
        },
      ],
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: "record_feedback_report" },
    });
    const tool = (data.content || []).find((b) => b.type === "tool_use");
    if (!tool) throw new Error("No structured report produced");
    const report = tool.input;

    const createdAt = new Date().toISOString();
    const id = `${createdAt.slice(0, 10)}-${slugify(report.title)}-${Math.random().toString(36).slice(2, 6)}`;
    const path = `feedback/reports/${id}.md`;
    const markdown = buildReportMarkdown(report, messages, id, createdAt);

    let committed = null;
    let issueUrl = null;
    const wantIssue = (process.env.FEEDBACK_ISSUES || "true") !== "false";
    if (!body.dryRun) {
      committed = await commitReport(path, markdown, `feedback: ${report.title}`);
      if (wantIssue) {
        // Best-effort: the report is already saved, so never fail the request on this.
        try {
          issueUrl = await createIssue(report, id, committed);
        } catch (e) {
          console.error("issue mirror failed:", e.message);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      id,
      path,
      url: committed,
      issue_url: issueUrl,
      thank_you: report.thank_you || "Thank you so much for your feedback — it has been recorded.",
      report: body.dryRun
        ? { markdown, report, issue: wantIssue ? buildIssue(report, id, null) : null }
        : undefined,
    });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
};
