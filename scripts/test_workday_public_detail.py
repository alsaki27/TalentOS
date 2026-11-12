"""Offline checks for Workday public job-detail URL and JSON validation."""

from __future__ import annotations

import re
import unittest

from workday_public_detail import fallback_source_url, parse_public_detail, public_detail_url


BOARD = "https://mercy.wd1.myworkdayjobs.com/en-US/mercycareers/introduceYourself"
PATH = "/job/Mercy-Hospital-Ada/New-Grad-RN---Med-Surg---Nights_JR277249"
EXTERNAL_URL = "https://mercy.wd1.myworkdayjobs.com/mercycareers" + PATH


def clean(value: object) -> str | None:
    result = re.sub(r"<[^>]+>", " ", str(value or ""))
    result = re.sub(r"\s+", " ", result).strip()
    return result or None


def payload(**changes: object) -> dict[str, object]:
    info: dict[str, object] = {
        "title": "New Grad RN - Med Surg - Nights",
        "jobDescription": "<p>Care for patients on the medical surgical unit.</p>",
        "externalUrl": EXTERNAL_URL,
        "jobReqId": "JR277249",
        "location": "Mercy Hospital Ada",
        "postedOn": "Posted 2 Days Ago",
        "timeType": "Full time",
    }
    info.update(changes)
    return {"jobPostingInfo": info}


class WorkdayPublicDetailTests(unittest.TestCase):
    def test_cxs_detail_url_keeps_same_host_and_job_path(self):
        self.assertEqual(
            public_detail_url(BOARD, "mercy", "mercycareers", PATH),
            "https://mercy.wd1.myworkdayjobs.com/wday/cxs/mercy/mercycareers" + PATH,
        )

    def test_fallback_public_url_preserves_locale_and_site(self):
        self.assertEqual(
            fallback_source_url(BOARD, "mercycareers", PATH),
            "https://mercy.wd1.myworkdayjobs.com/en-US/mercycareers" + PATH,
        )

    def test_rejects_absolute_application_and_traversal_paths(self):
        for bad in (
            "https://evil.example/job/Location/Title_ID",
            "//evil.example/job/Location/Title_ID",
            "/jobs/Location/Title_ID",
            "/job/Location/../apply",
            "/job/Location/Title_ID/apps/new",
            "/job/Location/Title_ID#fragment",
            "/job/Location/Title_ID?apply=true",
            "/job/Location/Title%2Fapps%2Fnew",
        ):
            with self.subTest(path=bad), self.assertRaises(ValueError):
                public_detail_url(BOARD, "mercy", "mercycareers", bad)

    def test_rejects_non_workday_host_or_bad_site(self):
        with self.assertRaises(ValueError):
            public_detail_url("https://example.com/mercycareers", "mercy", "mercycareers", PATH)
        with self.assertRaises(ValueError):
            public_detail_url(BOARD, "mercy", "../private", PATH)

    def test_parses_nested_detail_and_canonical_public_url(self):
        result = parse_public_detail(payload(), BOARD, "mercycareers", PATH, clean)
        self.assertTrue(result.complete)
        self.assertIsNone(result.reason)
        self.assertEqual(result.source_url, EXTERNAL_URL)
        self.assertEqual(result.external_job_id, "JR277249")
        self.assertEqual(result.description_text, "Care for patients on the medical surgical unit.")
        self.assertEqual(result.location, "Mercy Hospital Ada")
        self.assertEqual(result.employment_type, "Full time")

    def test_missing_description_marks_detail_incomplete(self):
        result = parse_public_detail(payload(jobDescription=None), BOARD, "mercycareers", PATH, clean)
        self.assertFalse(result.complete)
        self.assertIn("jobDescription", result.reason or "")
        self.assertEqual(result.source_url, EXTERNAL_URL)

    def test_accepts_matching_public_myworkdaysite_canonical_url(self):
        canonical = "https://wd1.myworkdaysite.com/recruiting/mercy/MercyCareers" + PATH
        result = parse_public_detail(payload(externalUrl=canonical), BOARD, "mercycareers", PATH, clean)
        self.assertTrue(result.complete)
        self.assertEqual(result.source_url, canonical)
        mismatched = "https://wd1.myworkdaysite.com/recruiting/other/MercyCareers" + PATH
        self.assertFalse(parse_public_detail(payload(externalUrl=mismatched), BOARD, "mercycareers", PATH, clean).complete)

    def test_cross_host_or_mismatched_external_url_is_not_accepted(self):
        for url in (
            "https://evil.example/mercycareers" + PATH,
            "https://mercy.wd1.myworkdayjobs.com/mercycareers/job/Other/Other_JR1",
            "https://mercy.wd1.myworkdayjobs.com/mercycareers/apply/New-Grad-RN---Med-Surg---Nights_JR277249",
        ):
            with self.subTest(url=url):
                result = parse_public_detail(payload(externalUrl=url), BOARD, "mercycareers", PATH, clean)
                self.assertFalse(result.complete)
                self.assertIsNone(result.source_url)

    def test_missing_job_posting_info_is_incomplete(self):
        result = parse_public_detail({"userAuthenticated": False}, BOARD, "mercycareers", PATH, clean)
        self.assertFalse(result.complete)
        self.assertIsNone(result.source_url)


if __name__ == "__main__":
    unittest.main()
