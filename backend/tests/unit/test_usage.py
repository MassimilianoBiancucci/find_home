"""Token usage from the stream: once per message id, split by cache TTL; exact figures from the result event;
estimates only from the price table."""
from __future__ import annotations

import json

from findhome.agentrun import usage as u


def _assistant(mid: str, model: str = "claude-opus-5-5", **usage) -> str:
    return json.dumps({"type": "assistant", "message": {"id": mid, "model": model, "usage": usage}})


def test_counts_each_message_once_and_splits_cache_writes():
    acc = u.Usage()
    line = _assistant("m1", input_tokens=2, output_tokens=10, cache_read_input_tokens=100,
                      cache_creation_input_tokens=50, cache_creation={"ephemeral_1h_input_tokens": 30})
    assert acc.add_line(_assistant("m1", input_tokens=2, output_tokens=1, cache_read_input_tokens=100,
                                   cache_creation_input_tokens=50, cache_creation={"ephemeral_1h_input_tokens": 30}))
    assert acc.add_line(line) and acc.add_line(line)                      # one message, several events: largest kept
    acc.add_line(_assistant("m2", "claude-sonnet-5-5", input_tokens=1, output_tokens=5))
    acc.add_line('{"type":"user","message":{}}')
    assert acc.totals() == {
        "claude-opus-5-5": {"input": 2, "output": 10, "cache_read": 100, "cache_write_5m": 20, "cache_write_1h": 30},
        "claude-sonnet-5-5": {"input": 1, "output": 5, "cache_read": 0, "cache_write_5m": 0, "cache_write_1h": 0}}


def test_result_event_figures_and_estimates():
    totals, cost = u.from_model_usage({"claude-opus-5-5": {"inputTokens": 146, "outputTokens": 37153,
        "cacheReadInputTokens": 6508495, "cacheCreationInputTokens": 156012,
        "cacheCreationEphemeral1hInputTokens": 156012, "costUSD": 3.293439}})
    assert cost == 3.293439 and totals["claude-opus-5-5"]["cache_write_1h"] == 156012
    prices = {"claude-opus-5-5": {"input": 4, "output": 20, "cache_read": 0.2, "cache_write_5m": 5, "cache_write_1h": 8}}
    est = u.estimate_cost(totals, prices)
    assert 3.0 < est < 3.6                                                 # the price table lands near the exact cost
    assert u.estimate_cost({"unknown-model": totals["claude-opus-5-5"]}, prices) is None   # no price: no guess


def test_delta_between_marks():
    a = {"m": {"input": 10, "output": 5, "cache_read": 0, "cache_write_5m": 0, "cache_write_1h": 0}}
    b = {"m": {"input": 15, "output": 9, "cache_read": 100, "cache_write_5m": 0, "cache_write_1h": 0}}
    assert u.delta(b, a) == {"m": {"input": 5, "output": 4, "cache_read": 100, "cache_write_5m": 0, "cache_write_1h": 0}}
    assert u.delta(a, a) == {} and u.delta(a, None) == a
    assert u.short(u.delta(b, a), 0.05) == "5 in, 4 out, 100 cache read, 0 cache write · ≈$0.05"
