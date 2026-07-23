# Feedback reports

User feedback collected through the dashboard's feedback widget. Each conversation
is analysed by an LLM (polite, thankful clarifying questions) and committed here as
a structured Markdown report under `reports/`.

**This directory is written for a coding agent.** When asked to "act on user
feedback" or "improve the app based on feedback", read the open reports in
`reports/`, treat each `## Suggested changes` item as a task, and implement the
ones that fit — verifying against the `## Acceptance criteria`.

Each report is also mirrored as a **GitHub Issue** labeled `user-feedback` plus
`severity:*`, `area:*`, and `category:*`, linking back to the report by `id`.
The markdown here is the source of truth; the issue is for browsing/triage. When
you finish a report, close its issue and set the report's `status:` accordingly.

## Report format

Each file is `reports/<date>-<slug>-<rand>.md` with YAML frontmatter:

```yaml
---
id: 2026-07-23-add-date-sorting-to-reference-library-a1b2
created: 2026-07-23T04:10:49Z
status: open            # open | in-progress | done | wontfix
category: ux           # bug | feature-request | content | data-source | ux | performance | other
severity: medium       # low | medium | high
area: reference-library  # dashboard-frontend | ingestion-pipeline | sources | reference-library | feedback | other
---
```

Body sections:

- **Summary** — neutral 2-4 sentence description.
- **What the user reported** — the key points, close to the user's words.
- **Reproduction** — steps, when it's a bug.
- **Suggested changes (developer-actionable)** — a checklist; each item is a concrete task.
- **Acceptance criteria** — how to confirm the change is done.
- **Likely affected files** — hints such as `site/app.js`, `config/sources.yaml`.
- **Full conversation** — the verbatim transcript for context.

## Workflow for the coding agent

1. List `reports/*.md` where `status: open`, highest `severity` first.
2. For each, implement the `Suggested changes` that are in scope.
3. Verify against `Acceptance criteria` (drive the app / run tests).
4. Set the report's `status:` to `in-progress` or `done` in the same PR/commit,
   referencing the report `id` in the commit message.

## Areas map (where changes usually land)

| area | code |
|---|---|
| dashboard-frontend | `site/index.html`, `site/app.js`, `site/styles.css` |
| ingestion-pipeline | `src/crr_radar/*.py` |
| sources | `config/sources.yaml` |
| reference-library | `config/references.yaml`, `site/app.js` (refs view) |
| feedback | `api/feedback.js`, `site/feedback.js` |
