"""Focused JazzHR routing and complete-detail checks for the career crawler."""

from types import SimpleNamespace
import unittest
from unittest.mock import patch

import employer_career_ingest as crawler


BOARD = "https://example.applytojob.com/apply/"
DETAIL = BOARD + "aB12345/Field-Engineer"
LISTING = f"<div class='jobs-list'><h2>Current Openings</h2><ul><li class='list-group-item'><a href='{DETAIL}'>Field Engineer</a></li></ul></div>"


def response(url: str, text: str, status: int = 200) -> SimpleNamespace:
    return SimpleNamespace(url=url, text=text, status_code=status)


def source(url: str) -> dict:
    return {
        "url": url,
        "normalized_url": crawler.normalize_source_url(url),
        "source_urls": [url],
        "evidence_urls": [url],
        "employers": ["Example Employer"],
        "employer_keys": ["company_id:example"],
    }


def extracted(html: str, url: str, employer: str) -> list[dict]:
    if url != DETAIL:
        return []
    return [{"title": "Field Engineer", "company": employer, "source_url": url, "external_job_id": "old", "raw": {}}]


class JazzHrCrawlerIntegrationTests(unittest.TestCase):
    def test_direct_tenant_uses_public_listing_and_validates_detail(self):
        self.assertEqual(crawler._platform(DETAIL), ("jazzhr", "example"))

        def fetch(url: str, **kwargs):
            return response(url, LISTING if url == BOARD else "<script>JobPosting</script>")

        with patch.object(crawler, "_request", side_effect=fetch) as request, patch.object(crawler, "extract_postings", side_effect=extracted):
            result = crawler.scrape_source(source(DETAIL))
        self.assertEqual(result["status"], "scraped")
        self.assertTrue(result["complete"])
        self.assertEqual(result["method"], "public_board_listing:jazzhr-v1")
        self.assertEqual(result["jobs"][0]["external_job_id"], "aB12345")
        self.assertEqual(result["jobs"][0]["raw"]["career_source_board"], "jazzhr:example")
        self.assertEqual([call.args[0] for call in request.call_args_list], [BOARD, DETAIL])

    def test_missing_detail_posting_keeps_board_partial(self):
        with patch.object(crawler, "_request", side_effect=lambda url, **kwargs: response(url, LISTING if url == BOARD else "<html>No JobPosting</html>")), patch.object(crawler, "extract_postings", return_value=[]):
            result = crawler.scrape_source(source(BOARD))
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["complete"])
        self.assertEqual(result["job_count"], 0)
        self.assertIn("JazzHR detail failed", result["notes"][0])

    def test_redirected_and_explicitly_linked_boards_use_same_adapter(self):
        first_party = "https://company.example/careers"

        def redirected_fetch(url: str, **kwargs):
            if url == first_party:
                return response(BOARD, LISTING)
            return response(url, LISTING if url == BOARD else "<script>JobPosting</script>")

        with patch.object(crawler, "_request", side_effect=redirected_fetch), patch.object(crawler, "extract_postings", side_effect=extracted):
            jobs, method, complete, _ = crawler._crawl_generic(first_party, "Example Employer")
        self.assertEqual((len(jobs), method, complete), (1, "redirected_public_board_listing:jazzhr-v1", True))

        def linked_fetch(url: str, **kwargs):
            if url == first_party:
                return response(first_party, f"<a href='{BOARD}'>Open jobs</a>")
            return response(url, LISTING if url == BOARD else "<script>JobPosting</script>")

        with patch.object(crawler, "_request", side_effect=linked_fetch), patch.object(crawler, "extract_postings", side_effect=extracted):
            jobs, method, complete, _ = crawler._crawl_generic(first_party, "Example Employer")
        self.assertEqual((len(jobs), method, complete), (1, "linked_ats_api:jazzhr", True))


if __name__ == "__main__":
    unittest.main()
