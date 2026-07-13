"""Ingestion pipeline: fetch → dedupe → keyword prefilter → LLM classify →
persona review → store.

Items that fail the prefilter or LLM relevance check are stored with
relevant=0 so re-crawls skip them without refetching or re-classifying.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import llm
from .classify import classify, keyword_match
from .config import Config
from .fetch import fetch_article, fetch_source, make_client
from .review import review
from .store import Store, url_hash, utcnow


def run_ingest(
    cfg: Config,
    store: Store,
    only_sources: list[str] | None = None,
    limit: int | None = None,
    max_age_days: int = 120,
) -> dict:
    client = make_client()
    known = store.known_hashes()
    run_id = store.start_run()
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=max_age_days)
    ).isoformat(timespec="seconds")
    stats: dict[str, dict] = {}
    errors: list[dict] = []

    sources = cfg.active_sources
    if only_sources:
        sources = [s for s in sources if s.key in only_sources]

    for source in sources:
        s = stats[source.key] = {
            "fetched": 0, "new": 0, "duplicate": 0, "too_old": 0,
            "prefilter_skip": 0, "llm_skip": 0, "stored": 0,
        }
        try:
            raws = fetch_source(client, source)
        except Exception as exc:
            errors.append({"source": source.key, "error": f"{type(exc).__name__}: {exc}"})
            print(f"  ✗ {source.key}: fetch failed — {exc}")
            continue
        s["fetched"] = len(raws)

        for raw in raws:
            if limit is not None and s["new"] >= limit:
                break
            h = url_hash(raw.url)
            if h in known:
                s["duplicate"] += 1
                continue
            if raw.published_at and raw.published_at < cutoff:
                s["too_old"] += 1
                continue
            known.add(h)
            s["new"] += 1

            # Stage 1 prefilter on cheap text; fetch the article only if needed.
            article_text = ""
            matched = keyword_match(cfg, f"{raw.title} {raw.feed_summary}")
            if not matched and source.fetch_article_text:
                article_text, date = fetch_article(client, raw.url)
                if date and not raw.published_at:
                    raw.published_at = date
                matched = keyword_match(cfg, article_text)
            if not matched:
                _store_skipped(store, source, raw, h, article_text)
                s["prefilter_skip"] += 1
                continue
            if source.fetch_article_text and not article_text:
                article_text, date = fetch_article(client, raw.url)
                if date and not raw.published_at:
                    raw.published_at = date

            cls = classify(cfg, source, raw, article_text)
            row = {
                "url": raw.url,
                "url_hash": h,
                "guid": raw.guid,
                "title": raw.title,
                "source_key": source.key,
                "source_name": source.name,
                "source_org": source.org,
                "author_type": source.author_type,
                "published_at": raw.published_at,
                "first_seen_at": utcnow(),
                "summary": cls["summary"],
                "why_it_matters": cls["why_it_matters"],
                "doc_status": cls["doc_status"],
                "topics": cls["topics"],
                "relevant": 1 if cls["relevant"] else 0,
                "raw_excerpt": (article_text or raw.feed_summary)[:800],
                "llm_model": cls["llm_model"],
                "classified_at": utcnow(),
            }
            if not cls["relevant"]:
                store.insert_item(row)
                s["llm_skip"] += 1
                continue
            row["reviews"] = review(raw.title, cls["summary"], cls["why_it_matters"])
            store.insert_item(row)
            s["stored"] += 1
            print(f"  + [{source.key}] {raw.title[:80]}")

        print(
            f"  ✓ {source.key}: {s['fetched']} fetched, {s['new']} new, "
            f"{s['stored']} stored, {s['duplicate']} dupes"
        )

    usage = llm.usage_summary()
    stats["_llm_usage"] = usage
    store.finish_run(run_id, stats, errors)
    print(
        f"\nLLM usage: {usage['calls']} calls, "
        f"{usage['input_tokens']} in / {usage['output_tokens']} out tokens, "
        f"~${usage['approx_cost_usd']}"
    )
    if errors:
        print(f"{len(errors)} source(s) failed: {[e['source'] for e in errors]}")
    return {"stats": stats, "errors": errors}


def _store_skipped(store: Store, source, raw, h: str, article_text: str) -> None:
    store.insert_item(
        {
            "url": raw.url,
            "url_hash": h,
            "guid": raw.guid,
            "title": raw.title,
            "source_key": source.key,
            "source_name": source.name,
            "source_org": source.org,
            "author_type": source.author_type,
            "published_at": raw.published_at,
            "first_seen_at": utcnow(),
            "relevant": 0,
            "raw_excerpt": (article_text or raw.feed_summary)[:400],
        }
    )
