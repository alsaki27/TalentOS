"""Offline Workday listing-to-detail checks across all crawler entry paths."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import employer_career_ingest as scraper


BOARD = "https://mercy.wd1.myworkdayjobs.com/en-US/mercycareers"
PATH = "/job/Mercy-Hospital-Ada/New-Grad-RN_JR277249"
CANONICAL = "https://mercy.wd1.myworkdayjobs.com/mercycareers" + PATH


def source(url: str) -> dict[str, object]:
    return {
        "url": url,
        "normalized_url": url,
        "source_urls": [url],
        "evidence_urls": [url],
        "employers": ["Mercy"],
        "employer_keys": ["company_id:test-mercy"],
    }


def listing(rows: list[dict[str, object]] | None = None) -> SimpleNamespace:
    return SimpleNamespace(json=lambda: {
        "total": 1,
        "jobPostings": rows if rows is not None else [{
            "title": "New Grad RN",
            "externalPath": PATH,
            "bulletFields": ["JR277249"],
            "locationsText": "Ada, OK",
        }],
    })


def two_duplicate_rows() -> SimpleNamespace:
    row = {"title": "New Grad RN", "externalPath": PATH, "bulletFields": ["JR277249"]}
    return SimpleNamespace(json=lambda: {"total": 2, "jobPostings": [row, dict(row)]})


def detail(status: int = 200, *, description: str | None = "<p>Care for patients on the medical surgical unit.</p>") -> SimpleNamespace:
    return SimpleNamespace(status_code=status, json=lambda: {
        "jobPostingInfo": {
            "title": "New Grad RN",
            "jobDescription": description,
            "externalUrl": CANONICAL,
            "jobReqId": "JR277249",
            "location": "Ada, OK",
            "postedOn": "Posted Yesterday",
            "timeType": "Full time",
        },
    })


class WorkdayDetailIntegrationTests(unittest.TestCase):
    def test_workday_host_requires_domain_boundary(self):
        self.assertIsNone(scraper._platform("https://evilmyworkdayjobs.com/External"))

    def test_direct_workday_requires_and_uses_public_detail(self):
        with patch.object(scraper, "_request_post", return_value=listing()), patch.object(scraper, "_request", return_value=detail()) as fetch:
            result = scraper.scrape_source(source(BOARD))
        self.assertEqual(result["status"], "scraped")
        self.assertTrue(result["complete"])
        self.assertEqual(result["method"], "public_cxs_listing_and_detail:workday-v2")
        self.assertEqual(result["job_count"], 1)
        job = result["jobs"][0]
        self.assertEqual(job["source_url"], CANONICAL)
        self.assertIn("Care for patients", job["description_text"])
        self.assertTrue(job["raw"]["workday_detail_complete"])
        self.assertEqual(fetch.call_args.args[0], "https://mercy.wd1.myworkdayjobs.com/wday/cxs/mercy/mercycareers" + PATH)

    def test_missing_detail_keeps_listing_job_but_source_is_partial(self):
        with patch.object(scraper, "_request_post", return_value=listing()), patch.object(scraper, "_request", return_value=detail(403)):
            result = scraper.scrape_source(source(BOARD))
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["complete"])
        self.assertEqual(result["job_count"], 1)
        self.assertEqual(result["jobs"][0]["source_url"], BOARD + PATH)
        self.assertFalse(result["jobs"][0]["raw"]["workday_detail_complete"])
        self.assertIn("public details unavailable", result["notes"][0])

    def test_detail_without_description_is_partial(self):
        with patch.object(scraper, "_request_post", return_value=listing()), patch.object(scraper, "_request", return_value=detail(description=None)):
            result = scraper.scrape_source(source(BOARD))
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["jobs"][0]["description_text"])

    def test_linked_workday_board_uses_detail_completeness(self):
        official = "https://careers.mercy.net/"
        html = f'<a href="{BOARD}">Search jobs</a>'
        page = SimpleNamespace(status_code=200, url=official, text=html)
        with patch.object(scraper, "_request_post", return_value=listing()), patch.object(scraper, "_request", side_effect=[page, detail()]) as fetch:
            result = scraper.scrape_source(source(official))
        self.assertEqual(result["status"], "scraped")
        self.assertEqual(result["method"], "linked_ats_api:workday")
        self.assertEqual(result["jobs"][0]["source_url"], CANONICAL)
        self.assertEqual(fetch.call_count, 2)

    def test_redirected_workday_board_uses_detail_completeness(self):
        official = "https://example-hospital.com/careers"
        page = SimpleNamespace(status_code=200, url=BOARD, text="")
        with patch.object(scraper, "_request_post", return_value=listing()), patch.object(scraper, "_request", side_effect=[page, detail(description=None)]):
            result = scraper.scrape_source(source(official))
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["method"], "redirected_public_cxs_listing_and_detail:workday-v2")
        self.assertFalse(result["jobs"][0]["raw"]["workday_detail_complete"])

    def test_detail_recovers_missing_listing_title(self):
        with patch.object(scraper, "_request_post", return_value=listing([{"externalPath": PATH}])), patch.object(scraper, "_request", return_value=detail()):
            result = scraper.scrape_source(source(BOARD))
        self.assertEqual(result["status"], "scraped")
        self.assertTrue(result["complete"])
        self.assertEqual(result["job_count"], 1)
        self.assertEqual(result["jobs"][0]["title"], "New Grad RN")
        self.assertEqual(result["jobs"][0]["source_url"], CANONICAL)

    def test_unrecoverable_missing_listing_title_remains_partial(self):
        with patch.object(scraper, "_request_post", return_value=listing([{"externalPath": PATH}])), patch.object(scraper, "_request", return_value=detail(403)):
            result = scraper.scrape_source(source(BOARD))
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["complete"])
        self.assertEqual(result["job_count"], 0)
        self.assertTrue(any("omitted titles" in note for note in result["notes"]))

    def test_duplicate_job_path_is_partial_and_not_refetched(self):
        with patch.object(scraper, "_request_post", return_value=two_duplicate_rows()), patch.object(scraper, "_request", return_value=detail()) as fetch:
            result = scraper.scrape_source(source(BOARD))
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["job_count"], 2)
        self.assertEqual(fetch.call_count, 1)
        self.assertTrue(any("repeated" in note for note in result["notes"]))


if __name__ == "__main__":
    unittest.main()
