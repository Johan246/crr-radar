"""Fetch layer: RSS feeds via feedparser, listing pages via CSS selectors,
article text via trafilatura."""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin

import feedparser
import httpx
import trafilatura
from bs4 import BeautifulSoup

from .config import Source

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 CRRRadar/0.1"
)
MAX_LINKS_PER_HTML_SOURCE = 30


_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍﻿"))


def clean_text(s: str) -> str:
    return s.translate(_ZERO_WIDTH).strip()


@dataclass
class RawItem:
    title: str
    url: str
    guid: str | None = None
    published_at: str | None = None  # ISO 8601, UTC
    feed_summary: str = ""


def make_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=20,
        follow_redirects=True,
    )


def fetch_source(client: httpx.Client, source: Source) -> list[RawItem]:
    if source.fetch == "rss":
        items = _fetch_rss(client, source)
    elif source.fetch == "html":
        items = _fetch_html(client, source)
    else:
        raise ValueError(f"unknown fetch type {source.fetch!r} for {source.key}")
    if source.title_exclude:
        pattern = re.compile(source.title_exclude, re.IGNORECASE)
        items = [i for i in items if not pattern.search(i.title)]
    return items


def _fetch_rss(client: httpx.Client, source: Source) -> list[RawItem]:
    resp = client.get(source.url)
    resp.raise_for_status()
    feed = feedparser.parse(resp.content)
    items = []
    for entry in feed.entries:
        link = (entry.get("link") or "").strip()
        title = clean_text(entry.get("title") or "")
        if not link or not title:
            continue
        published = None
        parsed = entry.get("published_parsed") or entry.get("updated_parsed")
        if parsed:
            published = datetime.fromtimestamp(
                calendar.timegm(parsed), tz=timezone.utc
            ).isoformat(timespec="seconds")
        summary_html = entry.get("summary", "") or ""
        summary = BeautifulSoup(summary_html, "lxml").get_text(" ", strip=True)
        items.append(
            RawItem(
                title=title,
                url=link,
                guid=entry.get("id"),
                published_at=published,
                feed_summary=summary[:2000],
            )
        )
    return items


def _fetch_html(client: httpx.Client, source: Source) -> list[RawItem]:
    resp = client.get(source.url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    seen: set[str] = set()
    items: list[RawItem] = []
    for a in soup.select(source.link_selector or "a"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript:", "mailto:")):
            continue
        url = urljoin(source.url, href)
        if source.url_include and source.url_include not in url:
            continue
        if url.rstrip("/") == source.url.rstrip("/") or url in seen:
            continue
        title = clean_text(a.get_text(" ", strip=True) or a.get("title", ""))
        if len(title) < 15:  # nav links, "Read more" stubs
            continue
        seen.add(url)
        items.append(RawItem(title=title[:300], url=url))
        if len(items) >= MAX_LINKS_PER_HTML_SOURCE:
            break
    return items


def fetch_article(client: httpx.Client, url: str) -> tuple[str, str | None]:
    """Return (extracted_text, published_date_iso_or_None) for an article page."""
    try:
        resp = client.get(url)
        resp.raise_for_status()
        html = resp.text
    except Exception:
        return "", None
    text = ""
    date = None
    try:
        text = trafilatura.extract(html, include_comments=False, url=url) or ""
    except Exception:
        pass
    try:
        meta = trafilatura.extract_metadata(html, default_url=url)
        if meta and meta.date:
            date = f"{meta.date}T00:00:00+00:00"
    except Exception:
        pass
    return text, date
