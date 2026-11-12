"""Offline concurrency check for per-root robots fetches."""

import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

import employer_career_ingest as scraper


class RobotsFetchLockTests(unittest.TestCase):
    def test_transient_dns_failure_preserves_cause_and_can_retry(self):
        root = "https://robots-dns.example"
        responses = [
            scraper.ScrapeFailure("DNS lookup failed: temporary resolver failure"),
            SimpleNamespace(status_code=200, text="User-agent: *\nDisallow: /private"),
        ]
        with patch.object(scraper, "_robots", {}), patch.object(scraper, "_request", side_effect=responses) as request:
            with self.assertRaisesRegex(scraper.RobotsFetchFailure, "DNS lookup failed: temporary resolver failure"):
                scraper._robots_parser(root)
            self.assertNotIn(root, scraper._robots)
            parser = scraper._robots_parser(root)
            self.assertEqual(request.call_count, 2)
            self.assertFalse(parser.can_fetch(scraper.UA, root + "/private"))

    def test_server_error_is_retryable_and_not_cached(self):
        root = "https://robots-server.example"
        with patch.object(scraper, "_robots", {}), patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=503)):
            with self.assertRaisesRegex(scraper.RobotsFetchFailure, "HTTP 503"):
                scraper._robots_parser(root)
            self.assertNotIn(root, scraper._robots)

    def test_transient_robots_failure_is_source_error(self):
        url = "https://robots-source.example/careers"
        source = {
            "url": url, "normalized_url": url, "source_urls": [url],
            "evidence_urls": [], "employers": ["Example"], "employer_keys": ["company_id:1"],
        }
        failure = scraper.RobotsFetchFailure("robots.txt fetch failed: DNS lookup failed")
        with patch.object(scraper, "_crawl_generic", side_effect=failure):
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "error")
        self.assertIn("DNS lookup failed", result["error"])

    def test_successful_policy_cannot_be_overwritten_by_late_failure(self):
        root = "https://robots-race.example"
        first_started = threading.Event()
        second_started = threading.Event()
        release = threading.Event()
        calls = []
        calls_lock = threading.Lock()

        def fetch(_url, **_kwargs):
            with calls_lock:
                calls.append(1)
                call_number = len(calls)
            if call_number == 1:
                first_started.set()
                self.assertTrue(release.wait(timeout=3))
                return SimpleNamespace(status_code=200, text="User-agent: *\nDisallow: /private")
            second_started.set()
            self.assertTrue(release.wait(timeout=3))
            time.sleep(0.05)
            raise scraper.ScrapeFailure("transient robots fetch failure")

        with patch.object(scraper, "_robots", {}), patch.object(scraper, "_request", side_effect=fetch):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(scraper._robots_parser, root)
                try:
                    self.assertTrue(first_started.wait(timeout=2))
                    second = pool.submit(scraper._robots_parser, root)
                    second_started.wait(timeout=0.2)
                finally:
                    release.set()
                first_result = first.result(timeout=3)
                second_result = second.result(timeout=3)

        self.assertEqual(len(calls), 1)
        self.assertIs(first_result, second_result)
        self.assertFalse(first_result.can_fetch(scraper.UA, root + "/private"))


if __name__ == "__main__":
    unittest.main()
