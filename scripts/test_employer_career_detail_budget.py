"""Stop a denied generic detail batch without claiming the source is complete."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import employer_career_ingest as crawler


START = "https://example.com/careers"


def response(url: str, status: int, html: str = "") -> SimpleNamespace:
    return SimpleNamespace(url=url, status_code=status, text=html)


def job_html(url: str) -> str:
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Infrastructure Engineer",
        "url": url,
        "description": "Plan and deliver infrastructure with an experienced project team. " * 5,
    }
    return '<script type="application/ld+json">' + json.dumps(posting) + "</script>"


class GenericDetailBudgetTests(unittest.TestCase):
    def test_ten_consecutive_403s_stop_before_unvisited_jobs_and_preserve_earlier_job(self):
        urls = [f"https://example.com/jobs/{number}" for number in range(13)]
        requested: list[str] = []

        def request(url: str, **_kwargs: object) -> SimpleNamespace:
            requested.append(url)
            if url == START:
                return response(url, 200, "<html>Public careers</html>")
            if url == urls[0]:
                return response(url, 200, job_html(url))
            if url in urls[1:11]:
                return response(url, 403)
            raise AssertionError(f"unvisited candidate was requested: {url}")

        with patch.object(crawler, "_request", side_effect=request), \
                patch.object(crawler, "_discover_sitemaps", return_value=(urls, True, [])):
            jobs, method, complete, notes = crawler._crawl_generic(START, "Example")
        self.assertEqual(method, "sitemap_structured_data")
        self.assertFalse(complete)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["source_url"], urls[0])
        self.assertEqual(requested, [START, *urls[:11]])
        self.assertTrue(any("10 consecutive detail HTTP 403" in note
                            and "2 candidate URLs were not visited" in note for note in notes))

    def test_successful_detail_resets_denial_streak(self):
        urls = [f"https://example.com/jobs/{number}" for number in range(19)]
        requested: list[str] = []

        def request(url: str, **_kwargs: object) -> SimpleNamespace:
            requested.append(url)
            if url == START:
                return response(url, 200, "<html>Public careers</html>")
            if url == urls[9]:
                return response(url, 200, job_html(url))
            return response(url, 403)

        with patch.object(crawler, "_request", side_effect=request), \
                patch.object(crawler, "_discover_sitemaps", return_value=(urls, True, [])):
            jobs, _, complete, notes = crawler._crawl_generic(START, "Example")
        self.assertFalse(complete)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(requested, [START, *urls])
        self.assertFalse(any("consecutive detail HTTP 403" in note for note in notes))

    def test_twenty_empty_public_details_stop_before_unvisited_candidates(self):
        urls = [f"https://example.com/jobs/{number}" for number in range(22)]
        requested: list[str] = []

        def request(url: str, **_kwargs: object) -> SimpleNamespace:
            requested.append(url)
            return response(url, 200, "<html><h1>Careers</h1></html>")

        with patch.object(crawler, "_request", side_effect=request), \
                patch.object(crawler, "_discover_sitemaps", return_value=(urls, True, [])):
            jobs, _, complete, notes = crawler._crawl_generic(START, "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertEqual(requested, [START, *urls[:20]])
        self.assertTrue(any("20 consecutive detail pages without an extractable job posting" in note
                            and "2 candidate URLs were not visited" in note for note in notes))

    def test_valid_job_resets_empty_detail_streak(self):
        urls = [f"https://example.com/jobs/{number}" for number in range(25)]
        requested: list[str] = []

        def request(url: str, **_kwargs: object) -> SimpleNamespace:
            requested.append(url)
            html = job_html(url) if url == urls[19] else "<html><h1>Careers</h1></html>"
            return response(url, 200, html)

        with patch.object(crawler, "_request", side_effect=request), \
                patch.object(crawler, "_discover_sitemaps", return_value=(urls, True, [])):
            jobs, _, complete, notes = crawler._crawl_generic(START, "Example")
        self.assertFalse(complete)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(requested, [START, *urls])
        self.assertFalse(any("consecutive detail pages without" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
