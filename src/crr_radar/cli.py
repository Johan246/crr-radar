"""CLI: crr-radar ingest | export | stats"""

from __future__ import annotations

import argparse
import json

from dotenv import load_dotenv

from . import llm
from .config import load_config, project_root
from .export import run_export
from .pipeline import run_ingest
from .store import Store


def main() -> None:
    load_dotenv(project_root() / ".env")
    parser = argparse.ArgumentParser(prog="crr-radar")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest", help="Crawl sources, classify and store new items")
    p_ingest.add_argument("--source", action="append", help="Only these source keys")
    p_ingest.add_argument("--limit", type=int, help="Max new items per source")
    p_ingest.add_argument("--max-age-days", type=int, default=730)
    p_ingest.add_argument("--no-export", action="store_true",
                          help="Skip the JSON export after ingesting")

    sub.add_parser("export", help="Write site/data/items.json from the database")
    sub.add_parser("stats", help="Print database statistics")

    args = parser.parse_args()
    cfg = load_config()
    store = Store()

    if args.command == "ingest":
        if not llm.available():
            print("⚠ ANTHROPIC_API_KEY not set — using rule-based fallback tagging.\n")
        run_ingest(
            cfg, store,
            only_sources=args.source,
            limit=args.limit,
            max_age_days=args.max_age_days,
        )
        if not args.no_export:
            run_export(cfg, store)
    elif args.command == "export":
        run_export(cfg, store)
    elif args.command == "stats":
        print(json.dumps(store.stats(), indent=2))


if __name__ == "__main__":
    main()
