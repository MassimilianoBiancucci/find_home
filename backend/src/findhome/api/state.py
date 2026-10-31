"""Shared app state: active config bundle and the provider registry built from it."""
from __future__ import annotations

from findhome.config.loader import ConfigBundle
from findhome.config.store import get_store
from findhome.providers.registry import ProviderRegistry

_registry: tuple[str, ProviderRegistry] | None = None


def bundle() -> ConfigBundle:
    return get_store().get()


def registry() -> ProviderRegistry:
    """Rebuilt when providers.yaml changes (keyed by its content)."""
    global _registry
    b = bundle()
    key = repr(b.raw["providers"])
    if _registry is None or _registry[0] != key:
        _registry = (key, ProviderRegistry(b.providers))
    return _registry[1]
