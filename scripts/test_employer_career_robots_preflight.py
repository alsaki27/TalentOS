import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

import employer_career_ingest as scraper
import employer_career_robots_preflight as preflight


class FakeResponse:
    def __init__(self, status_code, *, text="", headers=None):
        self.status_code = status_code
        self.headers = headers or {}
        self.is_redirect = status_code in (301, 302, 303, 307, 308)
        self.is_permanent_redirect = status_code in (301, 308)
        self._body = text.encode("utf-8")
        self.closed = False

    def iter_content(self, chunk_size=65536):
        for index in range(0, len(self._body), chunk_size):
            yield self._body[index:index + chunk_size]

    def close(self):
        self.closed = True


class EmployerCareerRobotsPreflightTests(unittest.TestCase):
    def setUp(self):
        temp_root = Path(__file__).resolve().parents[1] / "outputs" / "career-test-tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=temp_root)
        self.old_rate_dir = scraper._shared_host_rate_dir
        scraper._shared_host_rate_dir = Path(self.temp.name)
        preflight._policy_cache.clear()
        preflight._policy_fetch_locks.clear()
        preflight._session_local = __import__("threading").local()

    def tearDown(self):
        scraper._shared_host_rate_dir = self.old_rate_dir
        self.temp.cleanup()

    def _source(self, url="https://jobs.example.test/careers"):
        return {
            "url": url,
            "normalized_url": scraper.normalize_source_url(url),
            "source_urls": [url],
            "employers": ["Example Employer"],
            "employer_keys": ["company_id:example"],
        }

    def test_wildcard_disallow_is_not_overridden_by_bing_group(self):
        requested = []
        robots_text = "User-agent: *\nDisallow: /\nUser-agent: bing\nAllow: /\n"

        def fake_get(session, url, **kwargs):
            requested.append(url)
            return FakeResponse(200, text=robots_text)

        with patch.object(preflight.scraper, "_public_https_url", side_effect=lambda value: urllib.parse.urlparse(value)), \
             patch.object(preflight.requests.Session, "get", autospec=True, side_effect=fake_get):
            result = preflight.preflight_source(self._source())

        self.assertEqual(result["status"], "disallow")
        self.assertEqual(result["reason"], "robots_disallows_source_url")
        self.assertEqual(requested, ["https://jobs.example.test/robots.txt"])
        self.assertFalse(any("/careers" in url for url in requested))
        self.assertNotIn("bing", scraper.UA.casefold())

    def test_missing_robots_file_uses_explicit_unavailable_policy(self):
        requested = []

        def fake_get(session, url, **kwargs):
            requested.append(url)
            return FakeResponse(404)

        with patch.object(preflight.scraper, "_public_https_url", side_effect=lambda value: urllib.parse.urlparse(value)), \
             patch.object(preflight.requests.Session, "get", autospec=True, side_effect=fake_get):
            result = preflight.preflight_source(self._source())

        self.assertEqual(result["status"], "allow")
        self.assertEqual(result["reason"], "robots_file_missing_no_rules")
        self.assertEqual(result["robots_http_status"], 404)
        self.assertEqual(requested, ["https://jobs.example.test/robots.txt"])

    def test_non_robots_redirect_is_not_followed(self):
        requested = []

        def fake_get(session, url, **kwargs):
            requested.append(url)
            return FakeResponse(302, headers={"Location": "/careers"})

        with patch.object(preflight.scraper, "_public_https_url", side_effect=lambda value: urllib.parse.urlparse(value)), \
             patch.object(preflight.requests.Session, "get", autospec=True, side_effect=fake_get):
            result = preflight.preflight_source(self._source())

        self.assertEqual(result["status"], "unreachable")
        self.assertEqual(result["reason"], "robots_redirect_not_same_host_robots_txt")
        self.assertEqual(requested, ["https://jobs.example.test/robots.txt"])

    def test_checkpoint_selection_retries_only_when_requested(self):
        sources = [
            {"normalized_url": "https://example.test/allow"},
            {"normalized_url": "https://example.test/deny"},
            {"normalized_url": "https://example.test/unreachable"},
            {"normalized_url": "https://example.test/new"},
        ]
        checkpoint = {
            "https://example.test/allow": {"status": "allow"},
            "https://example.test/deny": {"status": "disallow"},
            "https://example.test/unreachable": {"status": "unreachable"},
        }
        default_pending = [
            row["normalized_url"] for row in sources
            if preflight._needs_attempt(row, checkpoint, retry_unreachable=False, retry_checked=False)
        ]
        retry_pending = [
            row["normalized_url"] for row in sources
            if preflight._needs_attempt(row, checkpoint, retry_unreachable=True, retry_checked=False)
        ]
        self.assertEqual(default_pending, ["https://example.test/new"])
        self.assertEqual(retry_pending, ["https://example.test/unreachable", "https://example.test/new"])

    def test_checkpoint_reader_uses_last_result_for_source(self):
        checkpoint = Path(self.temp.name) / "robots_results.jsonl"
        checkpoint.write_text(
            json.dumps({"normalized_url": "https://example.test/careers", "status": "unreachable"}) + "\n"
            + json.dumps({"normalized_url": "https://example.test/careers", "status": "disallow"}) + "\n",
            encoding="utf-8",
        )
        rows = preflight._read_checkpoint(checkpoint)
        self.assertEqual(rows["https://example.test/careers"]["status"], "disallow")


if __name__ == "__main__":
    unittest.main()
