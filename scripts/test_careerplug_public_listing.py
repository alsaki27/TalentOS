"""Offline CareerPlug listing extraction and completeness gates."""

import json
import unittest

from careerplug_public_listing import board_url_for, parse_board_listing


BOARD = "https://sample.careerplug.com/jobs?locale=en-US"


def listing(job_ids=("101", "102"), *, page_links="", structured_ids=None):
    structured_ids = tuple(job_ids if structured_ids is None else structured_ids)
    items = [
        {
            "@type": "ListItem", "position": index,
            "item": {
                "@type": "JobPosting", "title": f"Technician {job_id}",
                "description": f"Install, inspect, and repair equipment for posting {job_id}.",
                "identifier": {"@type": "PropertyValue", "value": job_id},
            },
        }
        for index, job_id in enumerate(structured_ids, start=1)
    ]
    data = {"@type": "ItemList", "numberOfItems": len(items), "itemListElement": items}
    cards = "".join(f'<a href="/jobs/{job_id}">Technician {job_id}</a>' for job_id in job_ids)
    return f'<html><script type="application/ld+json">{json.dumps(data)}</script>{cards}{page_links}</html>'


class CareerPlugListingTests(unittest.TestCase):
    def test_canonical_public_listing_and_tenant_validation(self):
        self.assertEqual(board_url_for("https://sample.careerplug.com/account"), BOARD)
        for invalid in (
            "http://sample.careerplug.com/jobs",
            "https://careerplug.com/jobs",
            "https://sample.careerplug.com.evil.test/jobs",
            "https://sample.careerplug.com:8443/jobs",
        ):
            with self.subTest(url=invalid), self.assertRaises(ValueError):
                board_url_for(invalid)

    def test_single_page_has_full_listing_but_is_not_integration_ready(self):
        result = parse_board_listing(listing(), BOARD)
        self.assertEqual(len(result.posting_nodes), 2)
        self.assertTrue(result.listing_complete)
        self.assertFalse(result.integration_complete)
        self.assertEqual(result.page_count, 1)
        self.assertEqual(
            [job["url"] for job in result.posting_nodes],
            ["https://sample.careerplug.com/jobs/101", "https://sample.careerplug.com/jobs/102"],
        )
        self.assertIn("application forms", result.reason)

    def test_pagination_keeps_first_page_jobs_partial(self):
        pages = '<a rel="next" class="next_page" href="/jobs?locale=en-US&amp;page=2">next</a><a href="/jobs?locale=en-US&amp;page=9">9</a>'
        result = parse_board_listing(listing(page_links=pages), BOARD)
        self.assertEqual(len(result.posting_nodes), 2)
        self.assertFalse(result.listing_complete)
        self.assertFalse(result.integration_complete)
        self.assertEqual(result.page_count, 9)
        self.assertIn("later listing pages", result.reason)

    def test_structured_jobs_must_match_visible_cards(self):
        result = parse_board_listing(listing(structured_ids=("101", "999")), BOARD)
        self.assertFalse(result.listing_complete)
        self.assertIn("did not match", result.reason)

    def test_non_listing_html_cannot_be_treated_as_full_board(self):
        with self.assertRaisesRegex(ValueError, "requires the public /jobs page"):
            parse_board_listing(listing(), "https://sample.careerplug.com/account")


if __name__ == "__main__":
    unittest.main()
