"""Process-wide holder of the active ConfigBundle with hot reload.

The last VALID bundle stays active when a file becomes invalid; the errors are kept in
`last_errors` and exposed by /health and /api/config/status.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from findhome.config.loader import ConfigBundle, ConfigError, load_all
from findhome.core.paths import config_dir, sites_dir

log = logging.getLogger(__name__)


class ConfigStore:
    def __init__(self, cdir: Path | None = None, sdir: Path | None = None):
        self.cdir = Path(cdir or config_dir())
        self.sdir = Path(sdir or sites_dir())
        self.bundle: ConfigBundle | None = None
        self.last_errors: list[str] = []
        self.listeners: list = []

    def reload(self) -> bool:
        try:
            bundle = load_all(self.cdir, self.sdir)
        except ConfigError as exc:
            self.last_errors = exc.errors
            log.warning("config invalid, keeping previous bundle:\n%s", "\n".join(exc.errors))
            return False
        changed = self.bundle is None or bundle.config_hash != self.bundle.config_hash or \
            bundle.site_hashes != self.bundle.site_hashes
        self.bundle, self.last_errors = bundle, []
        if changed:
            for cb in self.listeners:
                try:
                    cb(bundle)
                except Exception:  # noqa: BLE001
                    log.exception("config listener failed")
        return True

    def get(self) -> ConfigBundle:
        if self.bundle is None and not self.reload():
            raise ConfigError(self.last_errors)
        assert self.bundle is not None
        return self.bundle

    async def watch(self) -> None:
        from watchfiles import awatch

        async for _changes in awatch(self.cdir, self.sdir, recursive=True):
            log.info("config files changed, reloading")
            self.reload()
            await asyncio.sleep(0)


_store: ConfigStore | None = None


def get_store() -> ConfigStore:
    global _store
    if _store is None:
        _store = ConfigStore()
    return _store
