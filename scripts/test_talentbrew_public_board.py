"""Offline fixtures for TalentBrew's public server-rendered listing pattern."""

import unittest

from talentbrew_public_board import discover_same_host_search_links, enumerate_search_pages, parse_search_page


BASE = "https://jobs.example.com/en/search-jobs"


def page(total, current, last, ids, *, next_number=None, asset=True, extra=""):
    cards = "".join(
        f'<li><a href="/en/job/city/role-{job_id}/123/{job_id}" data-job-id="{job_id}">'
        f"<h2>Role {job_id}</h2></a></li>"
        for job_id in ids
    )
    marker = '<script src="https://tbcdn.talentbrew.com/assets/search.js"></script>' if asset else ""
    next_link = f'<a class="next" href="/search-jobs&amp;p={next_number}">Next</a>' if next_number else '<a class="next disabled" href="/search-jobs&amp;p=1">Next</a>'
    return (
        f"<html>{marker}<h1>Search Results - {total:,} Jobs Found</h1>"
        f'<section id="search-results-list"><ul>{cards}</ul></section>'
        f'<input class="pagination-current" value="{current}" max="{last}">'
        f"{next_link}{extra}</html>"
    )


class TalentBrewBoardTests(unittest.TestCase):
    def test_enumerates_exact_total_from_visible_next_control(self):
        requested = []

        def fetch(url):
            requested.append(url)
            return page(3, 2, 2, [1003]), url

        first = page(3, 1, 2, [1001, 1002], next_number=2,
                     extra='<a href="/en/job/elsewhere/related/123/9999" data-job-id="9999">Related</a>')
        result = enumerate_search_pages(first, BASE, fetch)
        self.assertTrue(result.complete)
        self.assertEqual(result.declared_total, 3)
        self.assertEqual(result.pages_fetched, 2)
        self.assertEqual(requested, [BASE + "?p=2"])
        self.assertEqual(len(result.posting_urls), 3)
        self.assertEqual(dict(result.posting_titles), {
            "https://jobs.example.com/en/job/city/role-1001/123/1001": "Role 1001",
            "https://jobs.example.com/en/job/city/role-1002/123/1002": "Role 1002",
            "https://jobs.example.com/en/job/city/role-1003/123/1003": "Role 1003",
        })
        self.assertNotIn("9999", " ".join(result.posting_urls))

    def test_total_drift_withholds_completeness(self):
        result = enumerate_search_pages(
            page(3, 1, 2, [1001, 1002], next_number=2), BASE,
            lambda url: (page(4, 2, 2, [1003]), url),
        )
        self.assertFalse(result.complete)
        self.assertIn("total or pagination changed", result.reason)
        self.assertEqual(len(result.posting_urls), 3)

    def test_repeated_job_across_pages_withholds_completeness(self):
        result = enumerate_search_pages(
            page(3, 1, 2, [1001, 1002], next_number=2), BASE,
            lambda url: (page(3, 2, 2, [1002]), url),
        )
        self.assertFalse(result.complete)
        self.assertIn("repeated a job", result.reason)

    def test_missing_or_external_next_link_withholds_completeness(self):
        result = enumerate_search_pages(page(3, 1, 2, [1001, 1002]), BASE, lambda _: self.fail("must not fetch"))
        self.assertFalse(result.complete)
        self.assertIn("Next link", result.reason)
        external = page(3, 1, 2, [1001, 1002], next_number=2).replace(
            'href="/search-jobs&amp;p=2"', 'href="https://other.example.com/search-jobs?p=2"'
        )
        result = enumerate_search_pages(external, BASE, lambda _: self.fail("must not fetch"))
        self.assertFalse(result.complete)
        self.assertIn("Next link", result.reason)

    def test_unrecognized_template_and_invalid_card_are_partial(self):
        self.assertIn("layout was not verified", parse_search_page(page(1, 1, 1, [1001], asset=False), BASE).issue)
        invalid = page(1, 1, 1, [1001]).replace(
            'href="/en/job/city/role-1001/123/1001"',
            'href="https://other.example.com/en/job/city/role-1001/123/1001"',
        )
        parsed = parse_search_page(invalid, BASE)
        self.assertIn("invalid job cards", parsed.issue)
        self.assertEqual(parsed.posting_urls, ())

    def test_empty_board_requires_explicit_zero_total(self):
        result = enumerate_search_pages(page(0, 1, 1, []), BASE, lambda _: self.fail("must not fetch"))
        self.assertTrue(result.complete)
        self.assertEqual(result.posting_urls, ())
        self.assertEqual(result.declared_total, 0)

    def test_results_heading_variant(self):
        html = page(593, 1, 40, [1001], next_number=2).replace(
            "Search Results - 593 Jobs Found", "593 Results"
        )
        parsed = parse_search_page(html, BASE)
        self.assertEqual(parsed.total, 593)
        self.assertIsNone(parsed.issue)

    def test_displayed_jobs_heading_selects_matching_pagination_control(self):
        html = page(206, 1, 14, list(range(1001, 1016)), next_number=2).replace(
            "Search Results - 206 Jobs Found", "Jobs - 206 jobs displayed"
        ).replace("</html>", '<input class="pagination-current" value="1" max="3"></html>')
        parsed = parse_search_page(html, BASE)
        self.assertEqual((parsed.total, parsed.page_count), (206, 14))
        self.assertIsNone(parsed.issue)

    def test_we_found_heading_and_job_link_without_data_id(self):
        html = page(376, 1, 26, [1001], next_number=2).replace(
            "Search Results - 376 Jobs Found", "We found 376 jobs"
        ).replace(' data-job-id="1001"', "")
        parsed = parse_search_page(html, BASE)
        self.assertEqual(parsed.total, 376)
        self.assertEqual(len(parsed.posting_urls), 1)
        self.assertIsNone(parsed.issue)

    def test_public_result_count_attribute_and_radancy_asset(self):
        html = page(227, 1, 16, [1001], next_number=2).replace(
            "Search Results - 227 Jobs Found", "Filter Results"
        ).replace('<ul>', '<ul id="search-results-jobs" data-results-count="227">').replace(
            "https://tbcdn.talentbrew.com/assets/search.js", "https://cdn.radancy.eu/assets/search.js"
        )
        parsed = parse_search_page(html, BASE)
        self.assertTrue(parsed.recognized)
        self.assertEqual(parsed.total, 227)
        self.assertIsNone(parsed.issue)

    def test_duplicate_job_card_is_partial_even_if_title_agrees(self):
        html = page(1, 1, 1, [1001, 1001])
        result = enumerate_search_pages(html, BASE, lambda _: self.fail("must not fetch"))
        self.assertFalse(result.complete)
        self.assertIn("duplicate job card URLs", result.reason)
        self.assertEqual(len(result.posting_urls), 1)

    def test_card_title_prefers_visible_heading_over_location(self):
        html = page(1, 1, 1, [1001]).replace(
            "<h2>Role 1001</h2>",
            "<h2>Water &amp; Wastewater Engineer</h2><span class=job-location>Boston, MA</span>",
        )
        parsed = parse_search_page(html, BASE)
        self.assertIsNone(parsed.issue)
        self.assertEqual(dict(parsed.posting_titles)[parsed.posting_urls[0]], "Water & Wastewater Engineer")

    def test_card_title_can_be_direct_anchor_text(self):
        html = page(1, 1, 1, [1001]).replace("<h2>Role 1001</h2>", "Role 1001")
        parsed = parse_search_page(html, BASE)
        self.assertIsNone(parsed.issue)
        self.assertEqual(dict(parsed.posting_titles)[parsed.posting_urls[0]], "Role 1001")

    def test_card_title_span_ignores_brand_category_and_location(self):
        html = page(1, 1, 1, [1001]).replace(
            "<h2>Role 1001</h2>",
            '<span class="job-brand"><span>Example Brand</span></span>'
            '<span class="job-title"><em>Role 1001</em></span>'
            '<span class="job-category">Production</span>'
            '<span class="job-location">Beatrice, NE</span>',
        )
        parsed = parse_search_page(html, BASE)
        self.assertIsNone(parsed.issue)
        self.assertEqual(dict(parsed.posting_titles)[parsed.posting_urls[0]], "Role 1001")

    def test_conflicting_card_title_spans_stay_partial(self):
        html = page(1, 1, 1, [1001]).replace(
            "<h2>Role 1001</h2>",
            '<span class="job-title">Role 1001</span>'
            '<span class="job-title">Different Role</span>',
        )
        parsed = parse_search_page(html, BASE)
        self.assertIn("missing or ambiguous job card titles", parsed.issue)
        self.assertEqual(parsed.posting_titles, ())

    def test_missing_or_ambiguous_card_title_is_partial(self):
        for replacement in (
            '<span class="job-location">Boston, MA</span>',
            "<h2>Role 1001</h2><h2>Unrelated Role</h2>",
        ):
            with self.subTest(replacement=replacement):
                html = page(1, 1, 1, [1001]).replace("<h2>Role 1001</h2>", replacement)
                parsed = parse_search_page(html, BASE)
                self.assertIn("missing or ambiguous job card titles", parsed.issue)
                self.assertEqual(parsed.posting_titles, ())

    def test_conflicting_duplicate_title_is_partial(self):
        html = page(2, 1, 1, [1001, 1001]).replace(
            "<h2>Role 1001</h2></a></li>",
            "<h2>Role 1001</h2></a></li>", 1,
        )
        html = html.replace("<h2>Role 1001</h2></a></li>", "<h2>Other Role</h2></a></li>", 1)
        parsed = parse_search_page(html, BASE)
        self.assertIn("duplicate job card URLs", parsed.issue)

    def test_showing_job_listings_heading(self):
        html = page(96, 1, 7, [1001], next_number=2).replace(
            "Search Results - 96 Jobs Found", "Showing 96 Job Listings"
        )
        parsed = parse_search_page(html, BASE)
        self.assertEqual(parsed.total, 96)
        self.assertIsNone(parsed.issue)

    def test_last_page_ignores_unrelated_smaller_pager(self):
        first = page(3, 1, 2, [1001, 1002], next_number=2)
        second = page(3, 2, 2, [1003]).replace(
            "</html>", '<input class="pagination-current" value="1" max="3"></html>'
        )
        result = enumerate_search_pages(first, BASE, lambda url: (second, url))
        self.assertTrue(result.complete)
        self.assertEqual(len(result.posting_urls), 3)

    def test_redirected_next_page_is_partial(self):
        first = page(3, 1, 2, [1001, 1002], next_number=2)
        result = enumerate_search_pages(first, BASE, lambda url: (page(3, 2, 2, [1003]), "https://jobs.example.com/"))
        self.assertFalse(result.complete)
        self.assertIn("left the original HTTPS path", result.reason)

    def test_main_result_job_count_excludes_other_search_hits(self):
        html = page(1419, 1, 95, list(range(1001, 1016)), next_number=2).replace(
            "Search Results - 1,419 Jobs Found", "Filter Results"
        ).replace(
            "<html>", '<html><section id="search-results" data-total-results="1444" data-total-job-results="1419"></section>'
        )
        parsed = parse_search_page(html, BASE)
        self.assertEqual(parsed.total, 1419)
        self.assertIsNone(parsed.issue)

    def test_landing_discovery_only_returns_same_host_public_search_pages(self):
        html = (
            '<script src="https://tbcdn.talentbrew.com/assets/site.js"></script>'
            '<a href="/search-jobs/engineering">Filtered</a>'
            '<a href="https://jobs.example.com/search-jobs">All jobs</a>'
            '<a href="https://other.example.com/search-jobs">Other host</a>'
            '<a href="/apply/search-jobs">Application</a>'
            '<a href="/search-jobs">Duplicate</a>'
        )
        self.assertEqual(
            discover_same_host_search_links(html, "https://jobs.example.com/"),
            ("https://jobs.example.com/search-jobs", "https://jobs.example.com/search-jobs/engineering"),
        )
        self.assertEqual(discover_same_host_search_links('<a href="/search-jobs">Jobs</a>', "https://jobs.example.com/"), ())


if __name__ == "__main__":
    unittest.main()
