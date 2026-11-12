"""Focused checks for JazzHR's public, server-rendered listing parser."""

import unittest

from jazzhr_public_board import board_url_for, parse_board_listing


HOST = "https://example.applytojob.com"


class JazzHrPublicBoardTests(unittest.TestCase):
    def test_board_url_uses_tenant_listing_even_from_detail_or_tracking_url(self):
        self.assertEqual(board_url_for(HOST + "/apply/aB12345/Engineer?recruiter=abc"), HOST + "/apply/")
        for value in ("http://example.applytojob.com/apply", "https://applytojob.com/apply", "https://other.test/apply", "https://user:pass@example.applytojob.com/apply"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                board_url_for(value)

    def test_recognized_unpaginated_list_with_nested_location_items_is_complete(self):
        html = """
        <div class='col jobs-list'><h2>Current Openings</h2><ul class='list-group'>
          <li class='list-group-item'><h3><a href='/apply/aB12345/Field-Engineer'>Field Engineer</a></h3>
            <ul class='list-inline list-group-item-text'><li>Denver</li></ul></li>
          <li class='list-group-item'><h3><a href='https://example.applytojob.com/apply/cD67890/GIS-Analyst?source=board'>GIS Analyst</a></h3></li>
        </ul></div>
        """
        result = parse_board_listing(html, HOST + "/apply/jobs/")
        self.assertTrue(result.complete)
        self.assertEqual(result.posting_urls, (HOST + "/apply/aB12345/Field-Engineer", HOST + "/apply/cD67890/GIS-Analyst"))

    def test_explicit_empty_board_is_complete(self):
        result = parse_board_listing("<div class='jobs-list'><p>There are no open positions at this time.</p></div>", HOST)
        self.assertTrue(result.complete)
        self.assertEqual(result.posting_urls, ())

    def test_missing_posting_link_duplicate_and_pagination_fail_closed(self):
        good_item = "<li class='list-group-item'><a href='/apply/aB12345/Engineer'>Engineer</a></li>"
        cases = {
            "missing link": "<li class='list-group-item'>Engineer</li>",
            "duplicate": good_item,
            "next page": "<a rel='next' href='?page=2'>Next</a>",
            "load more": "<button class='load-more'>More</button>",
        }
        for label, extra in cases.items():
            html = f"<div class='jobs-list'>{good_item}{extra}</div>"
            with self.subTest(label=label):
                self.assertFalse(parse_board_listing(html, HOST).complete)

    def test_unknown_or_inactive_layout_is_not_complete(self):
        for html in ("<div>Loading jobs...</div>", "<div class='jobs-list'></div>", "<div class='jobs-list'>JazzHR - Inactive Career Page</div>"):
            with self.subTest(html=html):
                self.assertFalse(parse_board_listing(html, HOST).complete)


if __name__ == "__main__":
    unittest.main()
