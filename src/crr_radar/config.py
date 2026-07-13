"""Load sources.yaml: seed sources, relevance keywords, topic vocabulary."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


def project_root() -> Path:
    override = os.getenv("CRR_RADAR_ROOT")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2]


@dataclass
class Source:
    key: str
    name: str
    org: str
    author_type: str  # regulatory | consumer
    fetch: str  # rss | html | sitemap
    url: str = ""
    urls: list[str] | None = None          # multiple listing URLs (e.g. per-year archives)
    url_template: str | None = None        # pagination: URL containing {page}
    max_pages: int = 1
    page_start: int = 1
    link_selector: str | None = None
    url_include: str | None = None         # regex a candidate URL must match
    title_exclude: str | None = None       # regex; matching items are dropped at fetch
    url_date_regex: str | None = None      # regex with one yymmdd capture group
    sitemap_include: str | None = None     # regex filter on sitemap <loc> URLs
    sitemap_index_include: str | None = None  # regex to select sub-sitemaps in an index
    max_items: int = 300                   # cap per crawl (sitemap sources)
    fetch_article_text: bool = True
    active: bool = True


@dataclass
class Config:
    sources: list[Source] = field(default_factory=list)
    relevance_keywords: list[str] = field(default_factory=list)
    topics: dict[str, str] = field(default_factory=dict)

    @property
    def active_sources(self) -> list[Source]:
        return [s for s in self.sources if s.active]


def load_config(path: Path | None = None) -> Config:
    path = path or project_root() / "config" / "sources.yaml"
    raw = yaml.safe_load(path.read_text())
    sources = [Source(**entry) for entry in raw.get("sources", [])]
    return Config(
        sources=sources,
        relevance_keywords=raw.get("relevance_keywords", []),
        topics=raw.get("topics", {}),
    )
