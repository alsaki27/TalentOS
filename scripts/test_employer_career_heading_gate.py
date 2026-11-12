"""Reject generic portal headings that do not contain a usable job detail."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import employer_career_ingest as crawler


class HeadingFallbackGateTests(unittest.TestCase):
    def test_linked_workday_board_does_not_keep_landing_heading_as_a_job(self):
        start = "https://example.test/careers/our-people"
        landing = SimpleNamespace(
            status_code=200, url=start,
            text="<main><h1>Making a Difference</h1></main>",
        )
        job = {
            "title": "Registered Nurse", "company": "Example", "location": "Remote",
            "source_url": "https://tenant.wd1.myworkdayjobs.com/site/job/role_1",
            "external_job_id": "1", "description_text": "Real job duties. " * 20,
            "raw": {"ats": "workday"},
        }
        board = "https://tenant.wd1.myworkdayjobs.com/site"
        with patch.object(crawler, "_request", return_value=landing), \
                patch.object(crawler, "_linked_ats_boards", return_value=[(board, ("workday", "tenant|site"))]), \
                patch.object(crawler, "_workday_jobs", return_value=([job], True, [])):
            jobs, method, complete, _notes = crawler._crawl_generic(start, "Example")
        self.assertEqual(method, "linked_ats_api:workday")
        self.assertTrue(complete)
        self.assertEqual(jobs, [job])

    def test_sitemap_shell_heading_is_not_counted_as_a_job(self):
        start = "https://example.test/careers"
        detail_url = "https://example.test/jobs/123"
        landing = SimpleNamespace(status_code=200, url=start, text="<h1>Careers</h1>")
        detail = SimpleNamespace(status_code=200, url=detail_url, text="<h1>Primary Location</h1>")
        with patch.object(crawler, "_request", side_effect=[landing, detail]), \
                patch.object(crawler, "_linked_ats_boards", return_value=[]), \
                patch.object(crawler, "_discover_sitemaps", return_value=([detail_url], True, [])):
            jobs, _method, complete, notes = crawler._crawl_generic(start, "Example")
        self.assertEqual(jobs, [])
        self.assertFalse(complete)
        self.assertTrue(any("no extractable" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
