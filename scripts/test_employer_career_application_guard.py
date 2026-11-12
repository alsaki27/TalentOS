"""Keep scrape-only crawls away from application forms."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import urlparse

import employer_career_ingest as crawler


class ApplicationGuardTests(unittest.TestCase):
    def test_application_routes_and_encoded_routes_are_identified(self):
        for url in (
            "https://example.test/jobs/123/apps/new",
            "https://example.test/jobs/123/apply",
            "https://example.test/jobs/123/application",
            "https://example.test/jobs/123/%61pply",
            "https://example.test/job/123?apply=true",
        ):
            with self.subTest(url=url):
                self.assertTrue(crawler._application_form_target(url))
        self.assertFalse(crawler._application_form_target("https://example.test/jobs/123"))

    def test_jazzhr_public_listing_and_detail_are_allowed(self):
        self.assertFalse(crawler._application_form_target("https://example.applytojob.com/apply/"))
        self.assertFalse(crawler._application_form_target("https://example.applytojob.com/apply/Abc123"))
        self.assertFalse(crawler._application_form_target("https://example.applytojob.com/apply/Abc123/job-title"))
        self.assertTrue(crawler._application_form_target("https://example.applytojob.com/apply/Abc123/application"))
        self.assertTrue(crawler._application_form_target("https://example.applytojob.com/apply/Abc123/job-title/application"))

    def test_redirect_to_application_form_is_not_fetched(self):
        source = "https://example.test/jobs/123"
        first_response = SimpleNamespace(
            status_code=302,
            is_redirect=True,
            is_permanent_redirect=False,
            headers={"Location": "/jobs/123/apps/new"},
            close=Mock(),
        )
        session = SimpleNamespace(get=Mock(return_value=first_response))
        rules = SimpleNamespace(can_fetch=lambda *_args: True)
        with patch.object(crawler, "_public_https_url", side_effect=urlparse), \
                patch.object(crawler, "_robots_parser", return_value=rules), \
                patch.object(crawler, "_shared_host_rate_dir", None):
            with self.assertRaisesRegex(crawler.ScrapeFailure, "redirect to application form refused"):
                crawler._request(source, session=session)
        self.assertEqual(session.get.call_count, 1)
        self.assertEqual(session.get.call_args.args[0], source)

    def test_direct_application_form_is_not_fetched(self):
        session = SimpleNamespace(get=Mock())
        with self.assertRaisesRegex(crawler.ScrapeFailure, "application form target refused"):
            crawler._request("https://example.test/jobs/123/apply", session=session)
        session.get.assert_not_called()

    def test_generic_candidate_application_form_is_skipped(self):
        source = "https://example.test/careers"
        candidate = "https://example.test/jobs/123/apply"
        listing = SimpleNamespace(
            status_code=200,
            url=source,
            text='<a href="/jobs/123/apply">Apply for this job</a>',
        )
        with patch.object(crawler, "_request", return_value=listing) as request, \
                patch.object(crawler, "_discover_sitemaps", return_value=([], False, [])):
            jobs, _method, complete, notes = crawler._crawl_generic(source, "Example")
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], source)
        self.assertEqual(jobs, [])
        self.assertFalse(complete)
        self.assertTrue(any(candidate in note and "skipped" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
