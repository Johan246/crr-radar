# CRR Radar — Roadmap

## North star

**A one-stop-shop for credit risk specialists** — the single place a quant or a
regulatory specialist at a bank opens each day to stay current on CRR/CRR3 and
credit-risk regulation, understand it, and act on it. If a credit-risk
professional needs it daily, it should live here: news, primary sources, context,
deadlines, learning, and tools.

## How the daily improvement loop uses this file

The scheduled task `crr-radar-daily-improve` reads this roadmap each run, ships
**one small, complete, reviewable slice** toward the vision, and updates this file
(move the item to *Shipped*, add follow-ups, re-order as priorities change). Rules:

- **Ship complete slices, not half-features.** Better a small thing fully working
  than a big thing left broken.
- **Compounding, not thrash.** Build on what exists; keep this file honest so the
  next run has context.
- **One PR per run**, small and reviewable. Never merge; never push to `main`.
- Respect existing discipline: the quiz bank stays vetted (no invented article
  numbers/figures; industry material is a labelled lens, never the legal basis).
- Prefer user feedback and broken-source fixes over new features when they exist.

## Current state (shipped)

- Nightly ingestion of ~14 sources (EBA, ECB/SSM, BaFin, BoE/PRA, BCBS, Commission,
  Risk.net, PwC, EBF, ISDA, AFME, Oliver Wyman) with dedup and 2-year archive backfill.
- LLM classification: regulatory vs. commentary, CRR topic tags, document status,
  "why it matters", and a two-persona relevance review (PD/LGD quant + Nordic reg expert).
- Dashboard: filterable news feed, KPI strip, reference library (20 curated docs,
  topic cross-links), "new since last visit", light/dark, institutional design.
- Feedback loop: in-app widget → serverless clarifying-question chat → structured
  report in `feedback/reports/` + labeled GitHub issue.
- Learn: educational quiz (authority-status pedagogy; 29 vetted questions).
- Deploy: GitHub Pages + nightly GitHub Actions.

## Backlog (prioritized — the loop picks the highest-value next slice)

### Near-term (high value, well-scoped)
1. **Regulatory calendar / deadlines tracker.** Key CRR3 dates (output-floor phase-in
   ladder, transitional expiries), consultation deadlines, application dates. A dated
   timeline view + "upcoming" widget. Specialists live by deadlines.
2. **Consultations & Q&A coverage.** Track EBA/ECB consultations open for comment
   (with close dates) and surface them distinctly; explore an EBA Single Rulebook
   Q&A feed as a source.
3. **Saved items / watchlist.** localStorage bookmarks + a "saved" view; optional
   per-topic watch so returning users see what's new in their areas.
4. **"What changed this week" digest view.** A weekly rollup grouping the feed by
   topic with counts and the few highest-signal items.

### Growing depth
5. **Grow the Learn quiz toward ~150** using the research brief's schema and its 12
   case-study blueprints — strictly vetted, expanding module coverage.
6. **Glossary** of credit-risk terms (IRB, LGD, ELBE, output floor, MoC, …) linked
   to the reference library and to relevant feed topics.
7. **Expand source coverage** (e.g. ACPR and other NCAs; headless fetch for the
   currently-disabled JS-rendered sources ESRB/Deloitte/KPMG).

### Later / bigger
8. **Search & article-level navigation** (full-text search; jump from a CRR article
   number to related items and reference docs).
9. **Role-based personalization** (quant vs. regulatory specialist default views).
10. **Self-serve exports** (an RSS feed of classified items; shareable filtered views).
11. **Data-quality passes** (classification accuracy, summary quality, dedup review).

## Shipped by the loop

_(The daily loop appends entries here as it completes slices — newest first.)_
