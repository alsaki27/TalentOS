"""Exact-source permission manifest validation shared by the crawler and scheduler."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
from pathlib import Path
from typing import Any
import urllib.parse


REQUIRED_POLICY_COLUMNS = {
    "normalized_url",
    "permission_status",
    "collection_scope",
    "permission_evidence_ref",
    "reviewed_at_utc",
    "reviewed_by",
    "expires_at_utc",
}
APPROVED_SCOPE = "job_listings_and_details"


class PolicyManifestError(ValueError):
    """The private per-source permission manifest is invalid or incomplete."""


def normalize_source_url(url: str) -> str:
    """Dedup routing only: lower host, drop fragment/trailing slash, keep query."""
    parsed = urllib.parse.urlparse(url.strip())
    path = parsed.path.rstrip("/") or "/"
    return urllib.parse.urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.params, parsed.query, ""))


def _parse_datetime(value: str, field: str, row_number: int) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise PolicyManifestError(f"policy row {row_number}: invalid {field}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_collection_policy(
    path: Path,
    *,
    now: datetime | None = None,
) -> tuple[set[str], dict[str, Any]]:
    """Load exact URL approvals; incomplete or expired rows remain held."""
    if not path.is_file():
        raise PolicyManifestError(f"permission manifest does not exist: {path}")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)

    approved: set[str] = set()
    seen: set[str] = set()
    status_counts: dict[str, int] = {}
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        fieldnames = set(reader.fieldnames or [])
        missing = REQUIRED_POLICY_COLUMNS - fieldnames
        if missing:
            raise PolicyManifestError("permission manifest is missing columns: " + ", ".join(sorted(missing)))
        for row_number, row in enumerate(reader, start=2):
            raw_url = (row.get("normalized_url") or "").strip()
            if not raw_url:
                raise PolicyManifestError(f"policy row {row_number}: normalized_url is required")
            normalized = normalize_source_url(raw_url)
            if normalized in seen:
                raise PolicyManifestError(f"policy row {row_number}: duplicate normalized_url")
            seen.add(normalized)

            status = (row.get("permission_status") or "").strip().casefold()
            if status not in {"approved", "pending", "hold", "revoked"}:
                raise PolicyManifestError(f"policy row {row_number}: permission_status must be approved, pending, hold, or revoked")
            if status != "approved":
                status_counts[status] = status_counts.get(status, 0) + 1
                continue

            if (row.get("collection_scope") or "").strip() != APPROVED_SCOPE:
                raise PolicyManifestError(f"policy row {row_number}: approved rows require collection_scope={APPROVED_SCOPE}")
            if not (row.get("permission_evidence_ref") or "").strip():
                raise PolicyManifestError(f"policy row {row_number}: approved rows require permission_evidence_ref")
            if not (row.get("reviewed_by") or "").strip():
                raise PolicyManifestError(f"policy row {row_number}: approved rows require reviewed_by")
            reviewed_at = _parse_datetime(row.get("reviewed_at_utc") or "", "reviewed_at_utc", row_number)
            if reviewed_at > current:
                raise PolicyManifestError(f"policy row {row_number}: reviewed_at_utc cannot be in the future")
            expiry_text = (row.get("expires_at_utc") or "").strip()
            if expiry_text and _parse_datetime(expiry_text, "expires_at_utc", row_number) <= current:
                status_counts["expired"] = status_counts.get("expired", 0) + 1
                continue
            status_counts["approved"] = status_counts.get("approved", 0) + 1
            approved.add(normalized)

    return approved, {
        "manifest_rows": sum(status_counts.values()),
        "status_counts": status_counts,
        "approved_url_count": len(approved),
        "expired_rows": status_counts.get("expired", 0),
        "manifest_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
