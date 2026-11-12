"""Pure SmartRecruiters public-detail validation tests."""

from __future__ import annotations

import unittest

from smartrecruiters_public_detail import merge_public_job_detail, public_job_url_from_card


URL = "https://jobs.smartrecruiters.com/Acme/96484926-material-handler"
DESC = "Move equipment safely and maintain inventory records. " * 8


def card() -> dict:
    return {"title": "Material Handler", "company": "Acme", "location": None,
            "source_url": URL, "external_job_id": "96484926-material-handler",
            "description_text": None, "raw": {"ats": "smartrecruiters"}}


def posting(**changes: object) -> dict:
    row = {"title": "Material Handler", "location": "Springfield, IL",
           "source_url": URL, "description_text": DESC}
    row.update(changes)
    return row


class SmartRecruitersPublicDetailTests(unittest.TestCase):
    def test_only_uuid_tracking_query_is_removed_from_public_card(self):
        tracked = URL + "?trid=9efb9c01-c797-443f-8be7-a145b6fb7194"
        self.assertEqual(public_job_url_from_card(tracked), URL)
        self.assertEqual(public_job_url_from_card(URL), URL)
        for url in (
            URL + "?apply=true",
            tracked + "&apply=true",
            URL + "?trid=invalid",
            tracked + "#apply",
            URL + "/apply?trid=9efb9c01-c797-443f-8be7-a145b6fb7194",
            URL.replace("/Acme/", "/%61pply/"),
        ):
            with self.subTest(url=url):
                self.assertIsNone(public_job_url_from_card(url))

    def test_one_matching_public_jobposting_enriches_card(self):
        original = card()
        result = merge_public_job_detail(original, 200, URL, [posting()])
        self.assertTrue(result.complete)
        self.assertEqual(result.job["description_text"], DESC.strip())
        self.assertEqual(result.job["location"], "Springfield, IL")
        self.assertTrue(result.job["raw"]["smartrecruiters_detail_complete"])
        self.assertIsNone(original["description_text"])

    def test_stale_404_keeps_card_but_marks_incomplete(self):
        result = merge_public_job_detail(card(), 404, URL, [])
        self.assertFalse(result.complete)
        self.assertIn("HTTP 404", result.reason or "")
        self.assertIsNone(result.job["description_text"])

    def test_redirect_to_application_route_is_incomplete(self):
        result = merge_public_job_detail(card(), 200, URL + "/apply", [posting()])
        self.assertFalse(result.complete)
        self.assertIn("redirected", result.reason or "")

    def test_mismatched_jobposting_and_duplicate_jobpostings_are_incomplete(self):
        wrong = posting(source_url="https://jobs.smartrecruiters.com/Acme/other")
        self.assertFalse(merge_public_job_detail(card(), 200, URL, [wrong]).complete)
        self.assertFalse(merge_public_job_detail(card(), 200, URL, [posting(), posting()]).complete)

    def test_title_or_description_mismatch_is_incomplete(self):
        self.assertFalse(merge_public_job_detail(card(), 200, URL, [posting(title="Other role")]).complete)
        self.assertFalse(merge_public_job_detail(card(), 200, URL, [posting(description_text="Thin")]).complete)

    def test_cross_host_and_query_urls_are_rejected(self):
        for url in ("https://evil.example/Acme/96484926-material-handler",
                    URL + "?apply=true", "http://jobs.smartrecruiters.com/Acme/96484926-material-handler"):
            with self.subTest(url=url):
                listed = card(); listed["source_url"] = url
                self.assertFalse(merge_public_job_detail(listed, 200, url, [posting()]).complete)


if __name__ == "__main__":
    unittest.main()
