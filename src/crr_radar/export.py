"""Export relevant items to site/data/items.json for the static dashboard."""

from __future__ import annotations

import json
from pathlib import Path

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
        "items": items,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"Exported {len(items)} items → {out_path}")
    return out_path
