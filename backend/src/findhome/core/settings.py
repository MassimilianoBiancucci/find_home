"""Process settings from config/backend.env and config/providers.env (dotenv, gitignored)."""
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

from findhome.core.paths import config_dir


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FINDHOME_", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5434/findhome"
    api_host: str = "127.0.0.1"
    api_port: int = 8200
    log_level: str = "INFO"

    @property
    def api_base(self) -> str:
        return os.environ.get("FINDHOME_API", f"http://{self.api_host}:{self.api_port}")


def _load_env_files() -> None:
    """Load backend.env and providers.env into os.environ without overriding real env vars."""
    for name in ("backend.env", "providers.env"):
        path = config_dir() / name
        if path.exists():
            for key, value in dotenv_values(path).items():
                if value is not None and key not in os.environ:
                    os.environ[key] = value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    try:
        _load_env_files()
    except RuntimeError:
        pass  # outside the repo (e.g. packaged use): rely on real env vars
    return Settings()


def secret(name: str | None) -> str | None:
    """Read a provider key by env var name; empty strings count as missing."""
    if not name:
        return None
    get_settings()
    value = os.environ.get(name, "").strip()
    return value or None
