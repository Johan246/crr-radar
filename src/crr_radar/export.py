"""Export relevant items + the curated reference library to
site/data/items.json for the static dashboard."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from .config import Config, project_root
from .store import Store, utcnow

ITEM_FIELDS = (
    "id", "url", "title", "source_key", "source_name", "source_org",
    "author_type", "published_at", "first_seen_at", "summary",
    "why_it_matters", "doc_status", "topics", "reviews",
)


def run_export(cfg: Config, store: Store, out_path: Path | None = None) -> Path:
    out_path = out_path or project_root() / "site" / "data" / "items.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    items = [
        {k: item[k] for k in ITEM_FIELDS} for item in store.relevant_items()
    ]
    payload = {
        "generated_at": utcnow(),
        "topics": cfg.topics,
        "sources": [
            {"key": s.key, "name": s.name, "org": s.org, "author_type": s.author_type}
            for s in cfg.active_sources
        ],
        "references": _load_references(),
        "items": items,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"Exported {len(items)} items → {out_path}")
    export_quiz()
    return out_path


def _load_references() -> list[dict]:
    path = project_root() / "config" / "references.yaml"
    if not path.exists():
        return []
    refs = yaml.safe_load(path.read_text()).get("references", [])
    for ref in refs:
        ref["description"] = " ".join(str(ref.get("description", "")).split())
    return refs


def _clean_multiline(value) -> str:
    return " ".join(str(value or "").split())


def export_quiz(out_path: Path | None = None) -> Path | None:
    """Write site/data/quiz.json from config/quiz.yaml (static educational
    content — independent of the crawl database)."""
    src = project_root() / "config" / "quiz.yaml"
    if not src.exists():
        return None
    raw = yaml.safe_load(src.read_text())
    meta = raw.get("meta", {})
    for key in ("intro", "subtitle", "disclaimer"):
        if key in meta:
            meta[key] = _clean_multiline(meta[key])
    questions = raw.get("questions", [])
    for q in questions:
        for key in ("prompt", "explanation"):
            if key in q:
                q[key] = _clean_multiline(q[key])
    payload = {
        "generated_at": utcnow(),
        "meta": meta,
        "authority_ladder": raw.get("authority_ladder", []),
        "modules": raw.get("modules", []),
        "questions": questions,
    }
    out_path = out_path or project_root() / "site" / "data" / "quiz.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"Exported {len(questions)} quiz questions → {out_path}")
    return out_path
