# 📡 CRR Radar

One-stop dashboard for credit risk professionals tracking regulatory news and
developments under the EU Capital Requirements Regulation (CRR/CRR3) and
related credit risk frameworks.

Every night a crawler pulls from ~13 seed sources (EBA, ECB/SSM, BaFin,
BoE/PRA, BCBS, Commission, Risk.net, PwC, EBF, ISDA, AFME, …), deduplicates,
and uses an LLM to:

- **summarize** each item (2–4 sentences, English, regardless of source language)
- **classify** it: regulatory body vs. consumer reflection, CRR topic areas,
  and document status (consultation / proposed change / final rule / commentary)
- write a one-line **"why it matters"** for fast scanning
- run a **persona verification layer**: two simulated reviewers — a quant
  building PD/LGD models for corporates and a regulatory expert covering
  corporate exposures at a major Scandinavian bank — each rate the item's
  relevance and give a one-line verdict

The dashboard (static site, `site/`) offers filtering by author type, source,
topic, status and reviewer relevance, a "new since your last visit" view,
daily grouping, and expandable detail per item.

**History**: the crawl covers the last 2 years. Shallow RSS feeds are
supplemented by archive crawling — sitemap ingestion (BoE/PRA, BIS yearly
document sitemaps), the ECB's static per-year press fragments, and WordPress
feed pagination (ISDA, EBF) — all configured per source in `sources.yaml`.

**Reference library**: a curated, URL-verified set of the ~20 core reference
documents (CRR/CRR3/CRD on EUR-Lex, EBA IRB and NPL guidelines, ECB guides,
Basel framework, PRA Basel 3.1 rules) lives in
[config/references.yaml](config/references.yaml). It gets its own dashboard
tab, and every news item links to the reference documents sharing its topics.

## Architecture

```
config/sources.yaml ─► crr-radar ingest ─► SQLite (data/crr_radar.db)
                          │                     │
                    Anthropic API         crr-radar export
                    (Haiku, JSON)         site/data/items.json
                                                │
                              static dashboard on GitHub Pages
GitHub Actions: nightly cron crawls, commits data, redeploys Pages
```

## Quick start (local)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && pip install -e .

cp .env.example .env   # add your ANTHROPIC_API_KEY

crr-radar ingest       # crawl, classify, store, export JSON
crr-radar stats        # database counts per source
python -m http.server -d site 8000   # open http://localhost:8000
```

Without an `ANTHROPIC_API_KEY`, ingestion still runs with rule-based fallback
tagging (no summaries/reviews). A full nightly run costs a few cents on
Claude Haiku; token usage and approximate cost are printed after each run.

Useful flags: `crr-radar ingest --source eba --limit 5 --max-age-days 30 --no-export`

## Deployment (GitHub Actions + Pages)

1. Push this repo to GitHub.
2. Repo **Settings → Secrets and variables → Actions**: add `ANTHROPIC_API_KEY`.
3. Repo **Settings → Pages**: set Source to **GitHub Actions**.
4. Done. `nightly.yml` crawls at 03:00 UTC and commits updated data;
   `pages.yml` redeploys the dashboard on every push. Both can be run
   manually from the Actions tab (`workflow_dispatch`).

## Managing sources

Everything lives in [config/sources.yaml](config/sources.yaml): the seed list
(RSS or HTML+CSS-selector per source), the keyword prefilter that gates LLM
calls, and the controlled topic vocabulary. To add a source, append an entry;
to retire one, set `active: false`. Sources that are JS-rendered (ESRB,
Deloitte, KPMG) are present but disabled, with notes.

## Learn (educational quiz)

The **Learn** tab is a static, client-side quiz that builds regulatory judgement.
Its pedagogy (from a research brief) is **regulatory-status discrimination** — the
hardest professional mistakes are authority-status errors ("I treated a guideline
like binding law", "IFRS 9 ECL = regulatory EL", "the output floor is an
exposure-level minimum risk weight"), so every question shows the rule, its
**legal basis**, its **status** (binding law / guideline / transitional /
persuasive expectation), and the **common trap** it targets. It opens with an
"authority ladder" and groups questions into Foundation → Practitioner → Expert
modules; progress is saved in `localStorage` on the device only.

Question content lives in [config/quiz.yaml](config/quiz.yaml) and is exported to
`site/data/quiz.json` by `crr-radar export` (also refreshed on each nightly run).
The current bank is a **vetted seed** grounded strictly in the research brief; the
schema mirrors the brief's so it can grow toward its 150-item target — but keep the
same discipline: **no invented article numbers or figures**, and treat industry
material (e.g. the GCD guide) as a labelled lens, never the legal basis. It is an
educational tool, not legal advice.

## Feedback loop

The dashboard has a feedback widget (bottom-right). A user's message goes to a
small **Vercel serverless function** ([api/feedback.js](api/feedback.js)) that
holds the API key and drives a polite, thankful **clarifying-question chat**
(the browser keeps the transcript and posts it back each turn — the function is
stateless). On submit, the function synthesises a **structured, developer-actionable
report**, commits it to [`feedback/reports/`](feedback/README.md), and mirrors
it as a **labeled GitHub Issue** (`user-feedback`, `severity:*`, `area:*`,
`category:*`) that links back to the report. The markdown report is the source
of truth a coding agent reads; the issue is a triage/browse surface — both share
the report `id`. The format and agent workflow are in
[feedback/README.md](feedback/README.md). (Set `FEEDBACK_ISSUES=false` to skip
the issue mirror; the report is still committed.)

### Deploying the feedback function (Vercel)

1. Create a Vercel account and **import this GitHub repo** (New Project → import).
   Vercel auto-detects `api/feedback.js`; there's no build step.
2. In the Vercel project's **Environment Variables**, set (see
   [api/.env.example](api/.env.example)):
   - `ANTHROPIC_API_KEY`
   - `GITHUB_TOKEN` — a fine-grained PAT on this repo only, with **Contents: read & write**
     (commit the report) and **Issues: read & write** (mirror the issue)
   - `GITHUB_REPO` = `Johan246/crr-radar`, `GITHUB_BRANCH` = `main`
   - `ALLOWED_ORIGIN` = `https://johan246.github.io` (locks the endpoint to the dashboard)
3. Deploy, then paste the function URL into
   [site/feedback-config.js](site/feedback-config.js):
   `window.CRR_FEEDBACK = { endpoint: "https://<your-app>.vercel.app/api/feedback" };`
   and push — GitHub Pages redeploys and the widget goes live. Until then the
   widget opens but stays inert.

Basic abuse protection is built in (per-IP throttle, transcript/length caps, a
honeypot). Local testing without deploying: `node scripts/local-server.cjs`
(runs the function on `localhost:8787` in dry-run — no commits), point
`feedback-config.js` at it, and serve `site/`.

## Data model

`items` — one row per crawled URL (normalized-URL hash is the dedup key).
Relevant items carry summary, why-it-matters, doc status, topics, and the two
persona reviews as JSON. Irrelevant items are stored with `relevant=0` so
re-crawls skip them cheaply. `crawl_runs` — per-run stats and errors.

## Future work (deliberately out of scope for the MVP)

- User authentication / multi-user accounts
- Email digest delivery
- Saved searches & alerts
- Admin UI for managing sources
- Headless fetching for JS-rendered sources (ESRB, Deloitte, KPMG)
- EBA Single Rulebook Q&A tracker as a dedicated source
- Durable rate-limiting / captcha for the public feedback endpoint (currently best-effort per-instance)
