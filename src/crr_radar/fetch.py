"""Fetch layer: RSS feeds via feedparser, listing pages via CSS selectors,
sitemap crawling for deep archives, article text via trafilatura.

A source can span multiple listing URLs (`urls`, e.g. per-year archive
fragments) or paginate (`url_template` with {page} + `max_pages`); pagination
stops early at the first empty page.
"""

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
MAX_LINKS_PER_HTML_PAGE = 60
MAX_SUB_SITEMAPS = 6

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
    title_is_slug: bool = False  # placeholder title; replace with page title


def make_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=25,
        follow_redirects=True,
    )


def fetch_source(client: httpx.Client, source: Source) -> list[RawItem]:
    if source.fetch == "sitemap":
        items = _fetch_sitemap(client, source)
    else:
        items = []
        seen: set[str] = set()
        for url in _listing_urls(source):
            if source.fetch == "rss":
                page_items = _fetch_rss(client, source, url)
            elif source.fetch == "html":
                page_items = _fetch_html(client, source, url)
            else:
                raise ValueError(f"unknown fetch type {source.fetch!r} for {source.key}")
            fresh = [i for i in page_items if i.url not in seen]
            seen.update(i.url for i in fresh)
            items.extend(fresh)
            if source.url_template and not fresh:
                break  # ran past the last page
    if source.title_exclude:
        pattern = re.compile(source.title_exclude, re.IGNORECASE)
        items = [i for i in items if not pattern.search(i.title)]
    if source.url_date_regex:
        for item in items:
            if not item.published_at:
                item.published_at = _date_from_url(source.url_date_regex, item.url)
    return items


def _listing_urls(source: Source) -> list[str]:
    if source.urls:
        return source.urls
    if source.url_template:
        return [
            source.url_template.format(page=p)
            for p in range(source.page_start, source.page_start + source.max_pages)
        ]
    return [source.url]


# Accepted URL-date capture formats. %b is avoided (locale-dependent); month
# abbreviations are mapped explicitly below.
_URL_DATE_FORMATS = ("%y%m%d", "%Y%m%d", "%Y-%m-%d")
_MONTH_ABBR = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun",
         "jul", "aug", "sep", "oct", "nov", "dec"], start=1
    )
}


def _date_from_url(pattern: str, url: str) -> str | None:
    m = re.search(pattern, url)
    if not m:
        return None
    raw = m.group(1)
    # Year + month-abbreviation, e.g. "2025/mar" → first of that month.
    ym = re.fullmatch(r"(\d{4})[/-]([a-z]{3})", raw, re.IGNORECASE)
    if ym and ym.group(2).lower() in _MONTH_ABBR:
        return datetime(
            int(ym.group(1)), _MONTH_ABBR[ym.group(2).lower()], 1, tzinfo=timezone.utc
        ).isoformat(timespec="seconds")
    for fmt in _URL_DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(
                tzinfo=timezone.utc
            ).isoformat(timespec="seconds")
        except ValueError:
            continue
    return None


def _fetch_rss(client: httpx.Client, source: Source, url: str) -> list[RawItem]:
    resp = client.get(url)
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


def _fetch_html(client: httpx.Client, source: Source, url: str) -> list[RawItem]:
    resp = client.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    seen: set[str] = set()
    items: list[RawItem] = []
    for a in soup.select(source.link_selector or "a"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript:", "mailto:")):
            continue
        item_url = urljoin(url, href)
        if source.url_include and not re.search(source.url_include, item_url):
            continue
        if item_url.rstrip("/") == url.rstrip("/") or item_url in seen:
            continue
        title = clean_text(a.get_text(" ", strip=True) or a.get("title", ""))
        if len(title) < 15:  # nav links, "Read more" stubs, language links
            continue
        seen.add(item_url)
        items.append(RawItem(title=title[:300], url=item_url))
        if len(items) >= MAX_LINKS_PER_HTML_PAGE:
            break
    return items


def _fetch_sitemap(client: httpx.Client, source: Source) -> list[RawItem]:
    """Crawl sitemap.xml (or a sitemap index) and turn matching <loc> entries
    into items, newest lastmod first. Titles start as URL slugs and are
    replaced with the page title once the article is fetched."""
    entries: list[tuple[str, str | None]] = []
    for sitemap_url in _sitemap_urls(client, source):
        try:
            resp = client.get(sitemap_url)
            resp.raise_for_status()
        except Exception:
            continue
        soup = BeautifulSoup(resp.content, "xml")
        for node in soup.find_all("url"):
            loc = node.find("loc")
            if loc is None:
                continue
            loc_url = loc.get_text(strip=True)
            if loc_url.lower().endswith(".pdf"):
                continue
            if source.sitemap_include and not re.search(source.sitemap_include, loc_url):
                continue
            lastmod = node.find("lastmod")
            entries.append(
                (loc_url, lastmod.get_text(strip=True) if lastmod else None)
            )
    entries.sort(key=lambda e: e[1] or "", reverse=True)
    return [
        RawItem(
            title=_slug_title(loc_url),
            url=loc_url,
            published_at=_iso_date(lastmod),
            title_is_slug=True,
        )
        for loc_url, lastmod in entries[: source.max_items]
    ]


def _sitemap_urls(client: httpx.Client, source: Source) -> list[str]:
    resp = client.get(source.url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.content, "xml")
    index = soup.find("sitemapindex")
    if index is None:
        return [source.url]
    subs = [
        loc.get_text(strip=True)
        for loc in index.find_all("loc")
        if not source.sitemap_index_include
        or re.search(source.sitemap_index_include, loc.get_text(strip=True))
    ]
    return subs[-MAX_SUB_SITEMAPS:]  # indexes are usually chronological


def _slug_title(url: str) -> str:
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    slug = re.sub(r"\.(html?|en|de|fr)\b|~[0-9a-f]+", "", slug)
    return re.sub(r"[-_.]+", " ", slug).strip()[:200] or url


def _iso_date(lastmod: str | None) -> str | None:
    if not lastmod:
        return None
    lastmod = lastmod.strip()
    if len(lastmod) == 10:  # bare date
        return f"{lastmod}T00:00:00+00:00"
    return lastmod


def fetch_article(client: httpx.Client, url: str) -> tuple[str, str | None, str | None]:
    """Return (extracted_text, published_date, page_title) for an article page."""
    try:
        resp = client.get(url)
        resp.raise_for_status()
        html = resp.text
    except Exception:
        return "", None, None
    text = ""
    date = None
    title = None
    try:
        text = trafilatura.extract(html, include_comments=False, url=url) or ""
    except Exception:
        pass
    try:
        meta = trafilatura.extract_metadata(html, default_url=url)
        if meta:
            if meta.date:
                date = f"{meta.date}T00:00:00+00:00"
            if meta.title:
                title = clean_text(meta.title)[:300]
    except Exception:
        pass
    return text, date, title
