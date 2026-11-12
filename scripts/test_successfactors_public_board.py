"""Synthetic offline checks for the public SuccessFactors All-Jobs layout."""

import unittest

from successfactors_public_board import (
    discover_all_jobs_link, enumerate_go_pages, is_public_all_jobs_url, parse_go_page, validate_detail,
)


BASE = "https://careers.example.com/go/All-Jobs/123/"
SECOND = "https://careers.example.com/go/All-Jobs/123/2/?q=&sortColumn=referencedate"
JOB1 = "https://careers.example.com/job/City-Engineer/1001/"
JOB2 = "https://careers.example.com/job/Town-Analyst/1002/"
JOB3 = "https://careers.example.com/job/State-Designer/1003/"
DESCRIPTION = "Build and test public infrastructure with a multidisciplinary team. " * 5


def page(number: int, *, total: int = 3, titles: tuple[tuple[str, str], ...] | None = None,
         next_href: str | None = None, page_count: int = 2) -> str:
    cards = titles if titles is not None else ((JOB1, "Engineer"), (JOB2, "Analyst")) if number == 1 else ((JOB3, "Designer"),)
    first = 1 if number == 1 else 3
    last = 2 if number == 1 else 3
    card_html = "".join(
        f'<tr><td><a class="jobTitle-link" href="{url}">{title}</a>'
        f'<a class="jobTitle-link" href="{url}">{title}</a></td></tr>'
        for url, title in cards
    )
    next_link = f'<a title="Page {number + 1}" href="{next_href}">{number + 1}</a>' if next_href else ""
    return (
        f'<div class="pagination"><span>Page {number} of {page_count}</span>{next_link}</div>'
        f'<table id="searchresults" aria-label="Search results for . Page {number} of {page_count}, Results {first} to {last} of {total}">'
        f"{card_html}</table>"
    )


class SuccessFactorsPublicBoardTests(unittest.TestCase):
    def test_discovers_one_explicit_same_host_branded_all_jobs_link(self):
        html = '<script src="/platform/js/j2w/core.js"></script><a href="/go/All-Jobs/123/">All Jobs</a>'
        self.assertEqual(discover_all_jobs_link(html, "https://careers.example.com/?locale=en_US"), BASE)
        self.assertIsNone(discover_all_jobs_link(html.replace("j2w", "other"), "https://careers.example.com/"))
        self.assertIsNone(discover_all_jobs_link(html.replace("/go/All-Jobs/123/", "https://other.example.com/go/All-Jobs/123/"), "https://careers.example.com/"))

    def test_prefers_unfiltered_board_over_locale_alias_and_rejects_search_filters(self):
        html = ('<script src="/platform/js/j2w/core.js"></script>'
                '<a href="/go/All-Jobs/123/?locale=en_US">All Jobs</a>'
                '<a href="/go/All-Jobs/123/">View all jobs</a>')
        self.assertEqual(discover_all_jobs_link(html, "https://careers.example.com/"), BASE)
        self.assertTrue(is_public_all_jobs_url(BASE + '?locale=en_US'))
        self.assertFalse(is_public_all_jobs_url(BASE + '?q=engineer'))
        self.assertIsNone(discover_all_jobs_link(html.replace('locale=en_US', 'q=engineer').replace(
            '<a href="/go/All-Jobs/123/">View all jobs</a>', ''), "https://careers.example.com/"))

    def test_paginates_visible_total_and_dedupes_mobile_card(self):
        first = page(1, next_href="/go/All-Jobs/123/2/?q=&sortColumn=referencedate")
        second = page(2)
        parsed = parse_go_page(first, BASE)
        self.assertIsNone(parsed.issue)
        self.assertEqual(parsed.next_url, SECOND)
        self.assertEqual(parsed.posting_titles, ((JOB1, "Engineer"), (JOB2, "Analyst")))
        fetched = []
        result = enumerate_go_pages(first, BASE, lambda url: (fetched.append(url) or second, url))
        self.assertTrue(result.complete, result.reason)
        self.assertEqual(result.declared_total, 3)
        self.assertEqual(result.pages_fetched, 2)
        self.assertEqual(len(result.posting_titles), 3)
        self.assertEqual(fetched, [SECOND])

    def test_missing_or_external_next_link_and_bad_card_count_are_partial(self):
        for html in (
            page(1),
            page(1, next_href="https://evil.example.com/go/All-Jobs/123/2/"),
            page(1, titles=((JOB1, "Engineer"),), next_href="/go/All-Jobs/123/2/"),
        ):
            with self.subTest(html=html[:100]):
                self.assertIsNotNone(parse_go_page(html, BASE).issue)

    def test_repeated_job_across_pages_and_cap_are_partial(self):
        first = page(1, next_href="/go/All-Jobs/123/2/?q=&sortColumn=referencedate")
        second = page(2, titles=((JOB1, "Engineer"),))
        result = enumerate_go_pages(first, BASE, lambda url: (second, url))
        self.assertFalse(result.complete)
        self.assertIn("repeated", result.reason)
        capped = enumerate_go_pages(first, BASE, lambda url: (second, url), max_postings=2)
        self.assertFalse(capped.complete)
        self.assertIn("cap", capped.reason)

    def test_detail_requires_exact_id_title_description_and_public_url(self):
        posting = {"title": "Engineer", "source_url": JOB1, "description_text": DESCRIPTION,
                   "external_job_id": "old-hash", "company": "Example"}
        good = validate_detail(JOB1, JOB1, 200, "Engineer", [posting])
        self.assertTrue(good.complete, good.reason)
        self.assertEqual(good.job["external_job_id"], "1001")
        bad_cases = (
            (JOB1, JOB1, 404, "Engineer", [posting]),
            (JOB1, JOB1 + "apply", 200, "Engineer", [posting]),
            (JOB1, JOB1, 200, "Analyst", [posting]),
            (JOB1, JOB1, 200, "Engineer", [{**posting, "description_text": "thin"}]),
            (JOB1, JOB1, 200, "Engineer", [posting, posting]),
        )
        for case in bad_cases:
            with self.subTest(case=case[:4]):
                self.assertFalse(validate_detail(*case).complete)


if __name__ == "__main__":
    unittest.main()
