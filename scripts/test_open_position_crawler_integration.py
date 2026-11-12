"""The unstructured openings fallback extracts candidates without claiming completeness."""

import unittest
from unittest.mock import patch

import employer_career_ingest as crawler


PAGE = "https://example.com/careers/"
DETAIL = "https://example.com/elementor-3554/"
TITLE = "Mechanical Project Engineer I"
LISTING_HTML = f"<h2>Open Positions</h2><a href='/elementor-3554/'>{TITLE}</a>"
BODY = "Design mechanical systems and coordinate project engineering with a diverse team. " * 8


class Response:
    def __init__(self, url: str, html: str):
        self.url = url
        self.text = html
        self.status_code = 200


class OpenPositionCrawlerIntegrationTests(unittest.TestCase):
    def run_crawl(self, detail_html: str):
        requested: list[str] = []

        def fake_request(url: str, **_kwargs):
            requested.append(url)
            if url == PAGE:
                return Response(PAGE, LISTING_HTML)
            if url == DETAIL:
                return Response(DETAIL, detail_html)
            raise AssertionError(f"unexpected request: {url}")

        with patch.object(crawler, "_request", side_effect=fake_request), patch.object(crawler, "_discover_sitemaps", return_value=([], False, [])):
            result = crawler._crawl_generic(PAGE, "Example")
        return result, requested

    def test_valid_same_host_opening_is_partial(self):
        detail_html = f"<main><h1>{TITLE}</h1><p>{BODY}</p><p>Apply Now</p></main>"
        (jobs, method, complete, _notes), requested = self.run_crawl(detail_html)
        self.assertEqual(requested, [PAGE, DETAIL])
        self.assertEqual(method, "linked_pages_structured_data")
        self.assertFalse(complete)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["title"], TITLE)
        self.assertEqual(jobs[0]["source_url"], DETAIL)
        self.assertEqual(jobs[0]["raw"]["extractor"], "same_host_open_position_link")

    def test_missing_apply_evidence_is_rejected(self):
        detail_html = f"<main><h1>{TITLE}</h1><p>{BODY}</p><p>Contact us</p></main>"
        (jobs, _method, complete, notes), _requested = self.run_crawl(detail_html)
        self.assertEqual(jobs, [])
        self.assertFalse(complete)
        self.assertTrue(any("no extractable" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
