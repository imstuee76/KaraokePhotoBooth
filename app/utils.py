from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_code(nbytes: int = 12) -> str:
    # URL-safe random token (~16 chars for 12 bytes).
    return secrets.token_urlsafe(nbytes)


def expires_at(hours: int) -> datetime:
    return utcnow() + timedelta(hours=hours)

