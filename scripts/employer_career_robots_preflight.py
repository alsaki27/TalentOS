"""Checkpointed robots.txt-only preflight for verified employer career URLs.

This tool never requests a career page, feed, ATS endpoint, application route,
or job detail. It only reads each source host's /robots.txt and records whether
the v26 crawler user-agent may fetch the tracker's career_page_url.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.robotparser
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

import employer_career_ingest as scraper


ROBOTS_MAX_BYTES = 1_000_000
MAX_ROBOTS_REDIRECTS = 3
_policy_cache: dict[str, dict[str, Any]] = {}
_policy_cache_lock = threading.Lock()
_policy_fetch_locks: dict[str, threading.Lock] = {}
_policy_fetch_locks_lock = threading.Lock()
_session_local = threading.local()


def _session() -> requests.Session:
    session = getattr(_session_local, "session", None)
    if session is None:
        session = requests.Session()
        _session_local.session = session
    return session


def _root_for_source(url: str) -> tuple[str, str]:
    """Validate the source URL without requesting it; return origin and host."""
    parsed = scraper._public_https_url(url)
    host = parsed.hostname or ""
    if not host:
        raise scraper.ScrapeFailure("source URL has no hostname")
    return f"https://{parsed.netloc}", host


def _valid_robots_redirect(current_url: str, location: str, original_host: str) -> str | None:
    if not location.strip():
        return None
    target = urllib.parse.urljoin(current_url, location)
    parsed = urllib.parse.urlsplit(target)
    if (
        parsed.scheme.casefold() != "https"
        or not parsed.hostname
        or parsed.hostname.casefold() != original_host.casefold()
        or parsed.username
        or parsed.password
        or parsed.path.casefold() != "/robots.txt"
        or parsed.query
        or parsed.fragment
    ):
        return None
    return target


def _fetch_policy(root: str, host: str, source_url: str) -> dict[str, Any]:
    """Fetch only same-host /robots.txt, then evaluate one source URL."""
    with _policy_fetch_locks_lock:
        fetch_lock = _policy_fetch_locks.setdefault(root, threading.Lock())
    with fetch_lock:
        with _policy_cache_lock:
            cached = _policy_cache.get(root)
        if cached is None:
            cached = _read_robots(root, host)
            with _policy_cache_lock:
                _policy_cache[root] = cached

    result = dict(cached)
    result["source_url"] = source_url
    if result.get("status") != "unreachable":
        rules = result.pop("_rules", None)
        if rules is not None:
            allowed = rules.can_fetch(scraper.UA, source_url)
            result["status"] = "allow" if allowed else "disallow"
            result["reason"] = "robots_allows_source_url" if allowed else "robots_disallows_source_url"
            result["crawl_delay_seconds"] = rules.crawl_delay(scraper.UA)
        else:
            # A 404/410 robots file is unavailable under REP and the TalentOS
            # crawler's explicit policy; no directives apply.
            result["status"] = "allow"
            result["reason"] = "robots_file_missing_no_rules"
            result["crawl_delay_seconds"] = None
    else:
        result.pop("_rules", None)
        result["crawl_delay_seconds"] = None
    return result


def _read_robots(root: str, host: str) -> dict[str, Any]:
    """Request /robots.txt only; redirects to non-robots paths are not followed."""
    current = root + "/robots.txt"
    session = _session()
    http_status: int | None = None
    try:
        # DNS/public-address validation applies to the initial host. No source
        # page is requested by this function.
        for _ in range(MAX_ROBOTS_REDIRECTS + 1):
            parsed = urllib.parse.urlsplit(current)
            if (
                parsed.scheme.casefold() != "https"
                or not parsed.hostname
                or parsed.hostname.casefold() != host.casefold()
                or parsed.path.casefold() != "/robots.txt"
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
            ):
                return {
                    "status": "unreachable",
                    "reason": "robots_redirect_outside_same_host_robots_path",
                    "robots_url": current,
                    "robots_http_status": http_status,
                    "robots_host": host,
                }
            # Revalidate every redirect target. A same-host redirect can still
            # change ports or resolve differently between requests.
            scraper._public_https_url(current)

            def send() -> requests.Response:
                return session.get(
                    current,
                    headers={"User-Agent": scraper.UA, "Accept": "text/plain,*/*;q=0.1"},
                    timeout=10,
                    allow_redirects=False,
                    stream=True,
                )

            with scraper._host_lock(host):
                response = scraper._shared_host_request(host, None, send)
            http_status = response.status_code
            if response.is_redirect or response.is_permanent_redirect:
                location = response.headers.get("Location", "")
                response.close()
                target = _valid_robots_redirect(current, location, host)
                if target is None:
                    return {
                        "status": "unreachable",
                        "reason": "robots_redirect_not_same_host_robots_txt",
                        "robots_url": current,
                        "robots_http_status": http_status,
                        "robots_host": host,
                    }
                current = target
                continue
            if http_status in (404, 410):
                response.close()
                return {
                    "status": "allow",
                    "reason": "robots_file_missing_no_rules",
                    "robots_url": current,
                    "robots_http_status": http_status,
                    "robots_host": host,
                    "_rules": None,
                }
            if http_status != 200:
                response.close()
                return {
                    "status": "unreachable",
                    "reason": f"robots_http_{http_status}_policy_unavailable",
                    "robots_url": current,
                    "robots_http_status": http_status,
                    "robots_host": host,
                }

            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                size += len(chunk)
                if size > ROBOTS_MAX_BYTES:
                    response.close()
                    return {
                        "status": "unreachable",
                        "reason": f"robots_body_exceeds_{ROBOTS_MAX_BYTES}_bytes",
                        "robots_url": current,
                        "robots_http_status": http_status,
                        "robots_host": host,
                    }
                chunks.append(chunk)
            response.close()
            text = b"".join(chunks).decode("utf-8", errors="replace")
            rules = urllib.robotparser.RobotFileParser(current)
            rules.parse(text.splitlines())
            return {
                "status": "allow",
                "reason": "robots_file_parsed",
                "robots_url": current,
                "robots_http_status": http_status,
                "robots_host": host,
                "_rules": rules,
            }

        return {
            "status": "unreachable",
            "reason": "robots_redirect_limit_exceeded",
            "robots_url": current,
            "robots_http_status": http_status,
            "robots_host": host,
        }
    except (requests.RequestException, scraper.ScrapeFailure, OSError, ValueError) as exc:
        return {
            "status": "unreachable",
            "reason": f"robots_fetch_failed: {str(exc)[:400]}",
            "robots_url": current,
            "robots_http_status": http_status,
            "robots_host": host,
        }


def preflight_source(source: dict[str, Any]) -> dict[str, Any]:
    """Preflight one source; network access is limited to its robots.txt."""
    url = str(source.get("url") or "").strip()
    try:
        root, host = _root_for_source(url)
        policy = _fetch_policy(root, host, url)
    except (scraper.ScrapeFailure, ValueError, OSError) as exc:
        policy = {
            "status": "unreachable",
            "reason": f"invalid_or_unresolvable_source: {str(exc)[:400]}",
            "robots_url": None,
            "robots_http_status": None,
            "robots_host": urllib.parse.urlsplit(url).hostname,
            "source_url": url,
            "crawl_delay_seconds": None,
        }
    return {
        "adapter_version": scraper.ADAPTER_VERSION,
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
        "normalized_url": source.get("normalized_url") or scraper.normalize_source_url(url),
        "url": url,
        "source_urls": source.get("source_urls") or [url],
        "employers": source.get("employers") or [],
        "employer_keys": source.get("employer_keys") or [],
        **policy,
    }


def _read_checkpoint(path: Path) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return latest
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and isinstance(row.get("normalized_url"), str):
                latest[row["normalized_url"]] = row
    return latest


def _needs_attempt(source: dict[str, Any], checkpoint: dict[str, dict[str, Any]], *, retry_unreachable: bool, retry_checked: bool) -> bool:
    previous = checkpoint.get(source["normalized_url"])
    if previous is None or retry_checked:
        return True
    if previous.get("status") == "unreachable":
        return retry_unreachable
    return False


def _summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for row in rows:
        status = str(row.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return {
        "adapter_version": scraper.ADAPTER_VERSION,
        "user_agent": scraper.UA,
        "result_count_by_status": counts,
        "source_groups": len(rows),
        "robots_only": True,
        "career_pages_fetched": False,
        "jobs_ingested": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=scraper.DEFAULT_TRACKER)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--shared-host-rate-dir", type=Path, required=True)
    parser.add_argument("--retry-unreachable", action="store_true", help="retry robots-host failures already present in the checkpoint")
    parser.add_argument("--retry-checked", action="store_true", help="recheck allow/disallow results as well as failures")
    args = parser.parse_args(argv)
    if not 1 <= args.workers <= 64:
        parser.error("--workers must be between 1 and 64")
    if not args.input.is_file():
        parser.error(f"tracker file does not exist: {args.input}")

    scraper._shared_host_rate_dir = args.shared_host_rate_dir.resolve()
    scraper._shared_host_rate_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = args.output_dir / "robots_results.jsonl"
    sources = scraper.load_sources(args.input)
    tracker_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
    checkpoint = _read_checkpoint(checkpoint_path)
    pending = [
        source for source in sources
        if _needs_attempt(source, checkpoint, retry_unreachable=args.retry_unreachable, retry_checked=args.retry_checked)
    ]

    manifest = {
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "adapter_version": scraper.ADAPTER_VERSION,
        "user_agent": scraper.UA,
        "tracker_path": str(args.input.resolve()),
        "tracker_sha256": tracker_hash,
        "normalized_source_groups": len(sources),
        "queued_source_groups": len(pending),
        "workers": args.workers,
        "shared_host_rate_dir": str(scraper._shared_host_rate_dir),
        "request_scope": "GET same-host https://<source-host>/robots.txt only; same-host redirects allowed only to /robots.txt",
        "career_pages_fetched": False,
        "feeds_apis_forms_job_details_fetched": False,
        "jobs_ingested": False,
    }
    (args.output_dir / "robots_run_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"verified crawl sources={len(sources)}; queued={len(pending)}; UA={scraper.UA}; robots-only=true")

    try:
        with checkpoint_path.open("a", encoding="utf-8") as out:
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures = {pool.submit(preflight_source, source): source for source in pending}
                for future in as_completed(futures):
                    row = future.result()
                    row["checkpoint_attempt_id"] = uuid.uuid4().hex
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                    checkpoint[row["normalized_url"]] = row
                    print(f"[{row['status']}] robots | {row['url']} | {row['reason']}")
    except KeyboardInterrupt:
        print("interrupted; completed source outcomes remain checkpointed", file=sys.stderr)

    latest_rows = [checkpoint[source["normalized_url"]] for source in sources if source["normalized_url"] in checkpoint]
    summary = {
        **_summary(latest_rows),
        "completed_at_utc": datetime.now(timezone.utc).isoformat(),
        "tracker_sha256": tracker_hash,
        "pending_source_groups": len(sources) - len(latest_rows),
    }
    (args.output_dir / "robots_run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary["result_count_by_status"], sort_keys=True))
    return 0 if not summary["pending_source_groups"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
