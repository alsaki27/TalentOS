"""Offline Workable integration checks that never request application forms."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import employer_career_ingest as crawler


BOARD = "https://apply.workable.com/acme"
API = "https://www.workable.com/api/accounts/acme?details=true"
APPLICATION = "https://apply.workable.com/j/8D299972BB/apply"
JOB_PAGE = "https://apply.workable.com/j/8D299972BB"


def api_payload(application_url=APPLICATION, description=None):
    return {
        "name": "Acme",
        "jobs": [{
            "title": "GIS Analyst",
            "shortcode": "8D299972BB",
            "application_url": application_url,
            "url": APPLICATION,
            "description": description if description is not None else "Build and maintain geographic data systems. " * 10,
            "city": "Boston", "state": "MA", "country": "US",
        }],
    }


def source(url=BOARD):
    return {
        "url": url, "normalized_url": url, "source_urls": [url],
        "evidence_urls": [url], "employers": ["Acme"], "employer_keys": ["company_id:1"],
    }


class WorkableCrawlerIntegrationTests(unittest.TestCase):
    def test_direct_board_uses_job_page_and_full_description(self):
        response = SimpleNamespace(json=lambda: api_payload())
        with patch.object(crawler, "_request", return_value=response) as request:
            result = crawler.scrape_source(source())
        self.assertEqual(result["status"], "scraped")
        self.assertTrue(result["complete"])
        self.assertEqual(result["method"], "public_job_board_api:workable-v2")
        self.assertEqual(result["jobs"][0]["source_url"], JOB_PAGE)
        self.assertGreater(len(result["jobs"][0]["description_text"]), 200)
        self.assertTrue(result["jobs"][0]["raw"]["workable_job_page_verified"])
        request.assert_called_once_with(API)

    def test_unverified_job_page_keeps_source_partial(self):
        response = SimpleNamespace(json=lambda: api_payload("https://apply.workable.com/j/DIFFERENT/apply"))
        with patch.object(crawler, "_request", return_value=response):
            result = crawler.scrape_source(source())
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["complete"])
        self.assertEqual(result["jobs"][0]["source_url"], BOARD)
        self.assertFalse(result["jobs"][0]["raw"]["workable_job_page_verified"])
        self.assertTrue(any("job-page URL unavailable" in note for note in result["notes"]))

    def test_short_description_keeps_source_partial(self):
        response = SimpleNamespace(json=lambda: api_payload(description="Short description"))
        with patch.object(crawler, "_request", return_value=response):
            result = crawler.scrape_source(source())
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["jobs"][0]["source_url"], JOB_PAGE)
        self.assertFalse(result["jobs"][0]["raw"]["workable_description_complete"])

    def test_equivalent_location_rows_are_one_complete_posting(self):
        payload = api_payload()
        first = payload["jobs"][0]
        second = {**first, "city": "Chicago", "state": "IL"}
        payload["jobs"] = [first, second, dict(first)]
        with patch.object(crawler, "_request", return_value=SimpleNamespace(json=lambda: payload)) as request:
            result = crawler.scrape_source(source())
        self.assertTrue(result["complete"], result["notes"])
        self.assertEqual(result["job_count"], 1)
        self.assertEqual(result["jobs"][0]["raw"]["workable_locations"], ["Boston, MA, US", "Chicago, IL, US"])
        self.assertEqual(result["jobs"][0]["raw"]["workable_listing_rows"], 3)
        self.assertTrue(any("collapsed 2 equivalent location rows" in note for note in result["notes"]))
        request.assert_called_once_with(API)

    def test_conflicting_rows_with_same_public_job_url_are_partial(self):
        for change in ({"title": "Different role"}, {"description": "Different duties. " * 20},
                       {"employment_type": "Contract"}, {"published_on": "2026-11-12"}):
            with self.subTest(change=change):
                payload = api_payload()
                payload["jobs"].append({**payload["jobs"][0], **change, "city": "Chicago"})
                with patch.object(crawler, "_request", return_value=SimpleNamespace(json=lambda: payload)):
                    result = crawler.scrape_source(source())
                self.assertFalse(result["complete"])
                self.assertEqual(result["job_count"], 1)
                self.assertTrue(any("conflicting rows" in note for note in result["notes"]))

    def test_unverified_job_urls_are_not_collapsed(self):
        payload = api_payload(application_url="https://apply.workable.com/j/DIFFERENT/apply")
        payload["jobs"].append({**payload["jobs"][0], "city": "Chicago"})
        with patch.object(crawler, "_request", return_value=SimpleNamespace(json=lambda: payload)):
            result = crawler.scrape_source(source())
        self.assertFalse(result["complete"])
        self.assertEqual(result["job_count"], 2)
        self.assertFalse(any("collapsed" in note for note in result["notes"]))

    def test_linked_board_uses_the_same_safe_job_url(self):
        career = "https://example.org/careers"
        landing = SimpleNamespace(
            url=career, status_code=200,
            text=f'<html><a href="{BOARD}">Current jobs</a></html>',
        )
        api = SimpleNamespace(json=lambda: api_payload())
        def request(url, **_kwargs):
            if url == career:
                return landing
            if url == API:
                return api
            raise AssertionError(f"unexpected fetch: {url}")
        with patch.object(crawler, "_request", side_effect=request) as fetch:
            result = crawler.scrape_source(source(career))
        self.assertEqual(result["status"], "scraped")
        self.assertEqual(result["method"], "linked_ats_api:workable")
        self.assertEqual(result["jobs"][0]["source_url"], JOB_PAGE)
        self.assertEqual(fetch.call_count, 2)

    def test_redirected_board_uses_the_same_safe_job_url(self):
        career = "https://example.org/careers"
        landing = SimpleNamespace(url=BOARD, status_code=200, text="<html></html>")
        api = SimpleNamespace(json=lambda: api_payload())
        def request(url, **_kwargs):
            if url == career:
                return landing
            if url == API:
                return api
            raise AssertionError(f"unexpected fetch: {url}")
        with patch.object(crawler, "_request", side_effect=request):
            result = crawler.scrape_source(source(career))
        self.assertEqual(result["status"], "scraped")
        self.assertEqual(result["method"], "redirected_public_job_board_api:workable-v2")
        self.assertEqual(result["jobs"][0]["source_url"], JOB_PAGE)

    def test_missing_jobs_array_is_not_confirmed_empty(self):
        response = SimpleNamespace(json=lambda: {"name": "Acme"})
        with patch.object(crawler, "_request", return_value=response):
            with self.assertRaisesRegex(crawler.ScrapeFailure, "omitted its jobs array"):
                crawler._workable_jobs(BOARD, "acme", "Acme")


if __name__ == "__main__":
    unittest.main()
