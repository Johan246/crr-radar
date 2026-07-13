"""Persona verification layer: two simulated credit risk professionals review
each relevant item and rate it from their professional seat."""

from __future__ import annotations

from . import llm, prompts


def review(title: str, summary: str, why_it_matters: str) -> dict | None:
    """Return {"quant": {...}, "regulatory": {...}} or None when LLM unavailable."""
    if not llm.available():
        return None
    bundle = (
        f"Title: {title}\n\nSummary: {summary}\n\nWhy it matters: {why_it_matters}"
    )
    reviews = {}
    for persona_key, system in prompts.PERSONAS.items():
        result = llm.generate_json(
            system=system,
            user=bundle,
            tool_name="record_review",
            tool_description=prompts.REVIEWER_TOOL_DESCRIPTION,
            schema=prompts.REVIEWER_SCHEMA,
            max_tokens=256,
        )
        if result is None:
            continue
        relevance = result.get("relevance")
        reviews[persona_key] = {
            "relevance": relevance if relevance in ("high", "medium", "low") else "medium",
            "verdict": (result.get("verdict") or "").strip(),
        }
    return reviews or None
