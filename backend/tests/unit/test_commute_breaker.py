"""Circuit breaker and dry-run dedupe in compute_listing, with a fake DB connection."""
import pytest

from findhome.config.loader import load_all
from findhome.domain.commute import RunBudget, compute_listing
from findhome.providers.base import LatLon
from findhome.providers.registry import ProviderRegistry


class FakeCursor:
    async def fetchone(self):
        return None


class FakeConn:
    def __init__(self):
        self.writes = 0

    async def execute(self, sql, params=None):
        if not sql.lstrip().upper().startswith("SELECT"):
            self.writes += 1
        return FakeCursor()


class Failing:
    name = "flaky"
    modes = {"transit"}
    time_dependent = True

    def __init__(self):
        self.calls = 0

    async def travel(self, *a, **k):
        self.calls += 1
        raise RuntimeError("boom")


@pytest.fixture
def setup(repo_root):
    b = load_all(repo_root / "config", repo_root / "sites")
    reg = ProviderRegistry(b.providers)
    flaky = Failing()
    reg.routing["flaky"] = flaky
    b.providers.mode_priority["transit"] = ["flaky", "haversine"]
    listing = {"id": "x", "lat": 59.3176, "lon": 18.0586}
    coords = {"stockholm-central": LatLon(59.3303, 18.0586)}
    return b, reg, flaky, listing, coords


@pytest.mark.asyncio
async def test_breaker_stops_after_three_errors(setup):
    b, reg, flaky, listing, coords = setup
    res = await compute_listing(FakeConn(), reg, b, listing, coords, RunBudget(1000))
    assert flaky.calls == 3 and res["errors"] == 3 and res["fallback"] > 0
    assert res["windows_stored"] > 0


@pytest.mark.asyncio
async def test_dry_run_counts_unique_calls(setup):
    b, reg, flaky, listing, coords = setup
    res = await compute_listing(FakeConn(), reg, b, listing, coords, RunBudget(1000), dry_run=True)
    # central: both directions x 3 day types x 27 slots for transit; walk is haversine (estimated)
    assert res["by_provider"] == {"flaky": 2 * 3 * 27} and flaky.calls == 0
