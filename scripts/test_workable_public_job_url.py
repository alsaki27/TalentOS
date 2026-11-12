"""Regression checks for Workable job URLs that avoid application routes."""

import unittest

from workable_public_job_url import job_page_from_application_url


class WorkablePublicJobUrlTests(unittest.TestCase):
    def test_derives_matching_public_job_page(self):
        self.assertEqual(
            job_page_from_application_url("https://apply.workable.com/j/8D299972BB/apply", "8D299972BB"),
            "https://apply.workable.com/j/8D299972BB",
        )
        self.assertEqual(
            job_page_from_application_url("https://apply.workable.com/j/8D299972BB/apply/", "8d299972bb"),
            "https://apply.workable.com/j/8D299972BB",
        )

    def test_rejects_mismatched_or_non_application_paths(self):
        for url, job_id in (
            ("https://apply.workable.com/j/8D299972BB/apply", "DIFFERENT"),
            ("https://apply.workable.com/j/8D299972BB", "8D299972BB"),
            ("https://apply.workable.com/other/j/8D299972BB/apply", "8D299972BB"),
            ("https://apply.workable.com/j/8D299972BB/apply/start", "8D299972BB"),
            ("https://apply.workable.com/j/8D299972BB/%61pply", "8D299972BB"),
        ):
            with self.subTest(url=url):
                self.assertIsNone(job_page_from_application_url(url, job_id))

    def test_rejects_external_or_ambiguous_urls(self):
        for url in (
            "http://apply.workable.com/j/8D299972BB/apply",
            "https://apply.workable.com.evil.example/j/8D299972BB/apply",
            "https://evil.example/j/8D299972BB/apply",
            "https://user:pass@apply.workable.com/j/8D299972BB/apply",
            "https://apply.workable.com:444/j/8D299972BB/apply",
            "https://apply.workable.com/j/8D299972BB/apply?next=/form",
            "https://apply.workable.com/j/8D299972BB/apply#form",
        ):
            with self.subTest(url=url):
                self.assertIsNone(job_page_from_application_url(url, "8D299972BB"))


if __name__ == "__main__":
    unittest.main()
