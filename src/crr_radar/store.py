"""SQLite storage. URLs are normalized and hashed for deduplication."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .config import project_root

_TRACKING_PREFIXES = ("utm_", "mc_", "mkt_", "fbclid", "gclid", "ref", "cmpid")

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL UNIQUE,
    guid TEXT,
    title TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_org TEXT NOT NULL,
    author_type TEXT NOT NULL CHECK (author_type IN ('regulatory', 'consumer')),
    published_at TEXT,
    first_seen_at TEXT NOT NULL,
    summary TEXT,
    why_it_matters TEXT,
    doc_status TEXT CHECK (doc_status IN
        ('proposed_change', 'final_rule', 'consultation', 'commentary')),
    topics TEXT,
    reviews TEXT,
    relevant INTEGER NOT NULL DEFAULT 1,
    raw_excerpt TEXT,
    llm_model TEXT,
    classified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_published ON items (published_at DESC);
CREATE TABLE IF NOT EXISTS crawl_runs (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    stats_json TEXT,
    errors_json TEXT
);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_url(url: str) -> str:
    parts = urlparse(url.strip())
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith(_TRACKING_PREFIXES)
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunparse(
        (parts.scheme.lower(), parts.netloc.lower(), path, "", urlencode(query), "")
    )


def url_hash(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode()).hexdigest()[:20]


class Store:
    def __init__(self, path: Path | None = None):
        path = path or project_root() / "data" / "crr_radar.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    def known_hashes(self) -> set[str]:
        return {r[0] for r in self.conn.execute("SELECT url_hash FROM items")}

    def insert_item(self, item: dict) -> None:
        item = dict(item)
        for key in ("topics", "reviews"):
            if isinstance(item.get(key), (list, dict)):
                item[key] = json.dumps(item[key])
        cols = ", ".join(item)
        placeholders = ", ".join(f":{k}" for k in item)
        self.conn.execute(f"INSERT INTO items ({cols}) VALUES ({placeholders})", item)
        self.conn.commit()

    def relevant_items(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT * FROM items WHERE relevant = 1
               ORDER BY COALESCE(published_at, first_seen_at) DESC"""
        ).fetchall()
        out = []
        for row in rows:
            d = dict(row)
            d["topics"] = json.loads(d["topics"]) if d["topics"] else []
            d["reviews"] = json.loads(d["reviews"]) if d["reviews"] else None
            out.append(d)
        return out

    def start_run(self) -> int:
        cur = self.conn.execute(
            "INSERT INTO crawl_runs (started_at) VALUES (?)", (utcnow(),)
        )
        self.conn.commit()
        return cur.lastrowid

    def finish_run(self, run_id: int, stats: dict, errors: list) -> None:
        self.conn.execute(
            "UPDATE crawl_runs SET finished_at = ?, stats_json = ?, errors_json = ? WHERE id = ?",
            (utcnow(), json.dumps(stats), json.dumps(errors), run_id),
        )
        self.conn.commit()

    def stats(self) -> dict:
        total, relevant = self.conn.execute(
            "SELECT COUNT(*), SUM(relevant) FROM items"
        ).fetchone()
        by_source = self.conn.execute(
            "SELECT source_key, COUNT(*), SUM(relevant) FROM items GROUP BY source_key"
        ).fetchall()
        return {
            "total": total,
            "relevant": relevant or 0,
            "by_source": {r[0]: {"total": r[1], "relevant": r[2] or 0} for r in by_source},
        }
