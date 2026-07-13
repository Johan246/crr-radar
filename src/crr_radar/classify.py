"""Classification: LLM-based with a rule-based fallback when no API key is set."""

from __future__ import annotations

import re

from . import llm, prompts
from .config import Config, Source
from .fetch import RawItem

MAX_TEXT_CHARS = 6000

_FALLBACK_STATUS_RULES = [
    ("consultation", r"consultation|call for (evidence|advice|input)|comment period"),
    ("proposed_change", r"\bdraft\b|proposal|proposes|legislative"),
    ("final_rule", r"final|adopt(s|ed)|publishes|published|enters into force|decision"),
]

_FALLBACK_TOPIC_RULES = {
    "irb-approach": r"\bIRB\b|internal ratings|internal model|PD model|\bLGD\b",
    "standardised-approach": r"standardi[sz]ed approach",
    "credit-risk-mitigation": r"credit risk mitigation|collateral|guarantee",
    "npl-provisioning": r"\bNPL\b|non-performing|provisioning|expected credit loss",
    "large-exposures": r"large exposure",
    "output-floor": r"output floor",
    "securitisation": r"securiti[sz]ation",
    "counterparty-credit-risk": r"counterparty credit|\bCVA\b",
    "crr3-implementation": r"CRR\s?3|CRR III|banking package",
    "reporting-disclosure": r"reporting|disclosure|pillar 3|COREP|FINREP",
}


def keyword_match(cfg: Config, text: str) -> bool:
    lowered = text.lower()
    return any(kw.lower() in lowered for kw in cfg.relevance_keywords)


def build_content(raw: RawItem, article_text: str) -> str:
    parts = [f"Title: {raw.title}"]
    if raw.feed_summary:
        parts.append(f"Feed summary: {raw.feed_summary}")
    if article_text:
        parts.append(f"Article text:\n{article_text[:MAX_TEXT_CHARS]}")
    return "\n\n".join(parts)


def classify(cfg: Config, source: Source, raw: RawItem, article_text: str) -> dict:
    """Return dict: relevant, summary, why_it_matters, doc_status, topics, llm_model."""
    content = build_content(raw, article_text)
    slugs = list(cfg.topics)
    user = (
        f"Source: {source.name} ({source.author_type} source)\n"
        f"URL: {raw.url}\n\n{content}"
    )
    result = llm.generate_json(
        system=prompts.CLASSIFIER_SYSTEM,
        user=user,
        tool_name="record_screening",
        tool_description=prompts.CLASSIFIER_TOOL_DESCRIPTION,
        schema=prompts.classifier_schema(slugs),
    )
    if result is not None:
        topics = ([t for t in result.get("topics", []) if t in cfg.topics] or ["other"])[:3]
        return {
            "relevant": bool(result.get("relevant")),
            "summary": (result.get("summary") or "").strip(),
            "why_it_matters": (result.get("why_it_matters") or "").strip(),
            "doc_status": result.get("doc_status") or _fallback_status(source, content),
            "topics": topics,
            "llm_model": llm.MODEL,
        }
    return _fallback_classify(cfg, source, raw, article_text, content)


def _fallback_status(source: Source, content: str) -> str:
    if source.author_type == "consumer":
        return "commentary"
    for status, pattern in _FALLBACK_STATUS_RULES:
        if re.search(pattern, content, re.IGNORECASE):
            return status
    return "commentary"


def _fallback_classify(
    cfg: Config, source: Source, raw: RawItem, article_text: str, content: str
) -> dict:
    text = article_text or raw.feed_summary or raw.title
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    topics = [
        slug
        for slug, pattern in _FALLBACK_TOPIC_RULES.items()
        if re.search(pattern, content, re.IGNORECASE)
    ] or ["other"]
    return {
        "relevant": True,  # already passed the keyword prefilter
        "summary": " ".join(sentences[:3])[:600],
        "why_it_matters": "",
        "doc_status": _fallback_status(source, content),
        "topics": topics[:3],
        "llm_model": None,
    }
