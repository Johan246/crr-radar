"""Anthropic client wrapper. Structured JSON output via forced tool use.

Requires ANTHROPIC_API_KEY. Degrades gracefully: available() returns False and
callers fall back to rule-based tagging (same pattern as portfolio-pulse).
Tracks token usage per process for the nightly cost log.
"""

from __future__ import annotations

import os
from typing import Any

import anthropic

MODEL = "claude-haiku-4-5-20251001"

_client: anthropic.Anthropic | None = None
_usage = {"calls": 0, "input_tokens": 0, "output_tokens": 0}


def available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def generate_json(
    system: str,
    user: str,
    tool_name: str,
    tool_description: str,
    schema: dict,
    max_tokens: int = 1024,
) -> dict[str, Any] | None:
    """One structured call; returns the tool input dict, or None on failure."""
    if not available():
        return None
    try:
        resp = _get_client().messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            tools=[
                {
                    "name": tool_name,
                    "description": tool_description,
                    "input_schema": schema,
                }
            ],
            tool_choice={"type": "tool", "name": tool_name},
        )
    except anthropic.APIError as exc:
        print(f"    ! LLM call failed: {exc}")
        return None
    _usage["calls"] += 1
    _usage["input_tokens"] += resp.usage.input_tokens
    _usage["output_tokens"] += resp.usage.output_tokens
    for block in resp.content:
        if block.type == "tool_use":
            return dict(block.input)
    return None


def usage_summary() -> dict:
    # Haiku 4.5 pricing: $1 / MTok in, $5 / MTok out.
    cost = _usage["input_tokens"] * 1e-6 * 1.0 + _usage["output_tokens"] * 1e-6 * 5.0
    return {**_usage, "approx_cost_usd": round(cost, 4)}
