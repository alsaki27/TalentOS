"""TalentBrew crawl integration must prove listing and detail completeness."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import employer_career_ingest as crawler


BASE = "https://jobs.example.com/en/search-jobs"


def detail_url(job_id: int) -> str:
    return f"https://jobs.example.com/en/job/city/role-{job_id}/123/{job_id}"


def listing(total: int, ids: list[int], *, current: int = 1, pages: int = 1, next_page: int | None = None) -> str:
    cards = "".join(
        f'<li><a data-job-id="{job_id}" href="{detail_url(job_id)}">Role {job_id}</a></li>'
        for job_id in ids
    )
    next_link = (f'<a class="next" href="/search-jobs&amp;p={next_page}">Next</a>'
                 if next_page else '<a class="next disabled" href="/search-jobs&amp;p=1">Next</a>')
    return (
        '<script src="https://tbcdn.talentbrew.com/assets/search.js"></script>'
        f'<h1>Search Results - {total} Jobs Found</h1>'
        f'<section id="search-results-list"><ul>{cards}</ul></section>'
        f'<input class="pagination-current" value="{current}" max="{pages}">'
        + next_link
    )


def detail(job_id: int, *, source_url: str | None = None, description: str | None = None) -> str:
    payload = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": f"Role {job_id}",
        "url": source_url or detail_url(job_id),
        "description": description or ("Specific duties and qualifications for this position. " * 6),
        "hiringOrganization": {"name": "Example"},
    }
    return '<script type="application/ld+json">' + json.dumps(payload) + "</script>"


def html_detail(job_id: int, *, title: str | None = None, marker_id: int | None = None) -> str:
    description = "Specific duties and qualifications for this position. " * 6
    return (
        "<h1>Job Description</h1>"
        f"<h2>{title or f'Role {job_id}'}</h2>"
        f'<section data-selector-name="jobdetails" data-job-id="{marker_id or job_id}" data-org-id="123">'
        f'<div class="ats-description"><p>{description}</p></div>'
        "</section>"
    )


def response(url: str, html: str, status: int = 200):
    return SimpleNamespace(url=url, text=html, status_code=status)


class TalentBrewCrawlerIntegrationTests(unittest.TestCase):
    def test_direct_board_fetches_every_detail_and_marks_complete(self):
        pages = {
            BASE: response(BASE, listing(3, [1001, 1002], pages=2, next_page=2)),
            BASE + "?p=2": response(BASE + "?p=2", listing(3, [1003], current=2, pages=2)),
            **{detail_url(i): response(detail_url(i), detail(i)) for i in (1001, 1002, 1003)},
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kw: pages[url]) as request, \
                patch.object(crawler, "_discover_sitemaps") as sitemaps:
            jobs, method, complete, notes = crawler._crawl_generic(BASE, "Example")
        self.assertTrue(complete, notes)
        self.assertEqual(method, "public_html_pagination:talentbrew-v1")
        self.assertEqual(len(jobs), 3)
        self.assertTrue(all(len(job["description_text"]) > 200 for job in jobs))
        self.assertTrue(all(job["raw"]["ats"] == "talentbrew" for job in jobs))
        self.assertEqual(request.call_count, 5)
        sitemaps.assert_not_called()

    def test_same_host_landing_page_uses_unfiltered_search_link(self):
        home = "https://jobs.example.com/"
        pages = {
            home: response(home, '<script src="https://tbcdn.talentbrew.com/assets/site.js"></script><a href="/en/search-jobs">Jobs</a>'),
            BASE: response(BASE, listing(1, [1001])),
            detail_url(1001): response(detail_url(1001), detail(1001)),
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kw: pages[url]):
            jobs, method, complete, notes = crawler._crawl_generic(home, "Example")
        self.assertTrue(complete, notes)
        self.assertEqual(method, "linked_public_html_pagination:talentbrew-v1")
        self.assertEqual(len(jobs), 1)

    def test_detail_missing_matching_jobposting_keeps_source_partial(self):
        pages = {
            BASE: response(BASE, listing(1, [1001])),
            detail_url(1001): response(detail_url(1001), detail(1001, source_url=detail_url(9999))),
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kw: pages[url]):
            jobs, _, complete, notes = crawler._crawl_generic(BASE, "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertTrue(any("matching JobPosting" in note for note in notes))

    def test_public_html_detail_without_jobposting_completes_source(self):
        pages = {
            BASE: response(BASE, listing(1, [1001])),
            detail_url(1001): response(detail_url(1001), html_detail(1001)),
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kw: pages[url]):
            jobs, _, complete, notes = crawler._crawl_generic(BASE, "Example")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["title"], "Role 1001")
        self.assertEqual(jobs[0]["source_url"], detail_url(1001))
        self.assertEqual(jobs[0]["raw"]["extractor"], "talentbrew_html_detail")
        self.assertGreater(len(jobs[0]["description_text"]), 200)

    def test_public_html_detail_with_mismatched_id_stays_partial(self):
        pages = {
            BASE: response(BASE, listing(1, [1001])),
            detail_url(1001): response(detail_url(1001), html_detail(1001, marker_id=9999)),
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kw: pages[url]):
            jobs, _, complete, notes = crawler._crawl_generic(BASE, "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertTrue(any("data-job-id" in note for note in notes))

    def test_filtered_search_is_partial_even_when_its_count_matches(self):
        filtered = BASE + "/engineering"
        pages = {
            filtered: response(filtered, listing(1, [1001])),
            detail_url(1001): response(detail_url(1001), detail(1001)),
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kw: pages[url]):
            jobs, _, complete, notes = crawler._crawl_generic(filtered, "Example")
        self.assertEqual(len(jobs), 1)
        self.assertFalse(complete)
        self.assertTrue(any("filtered search" in note for note in notes))

    def test_over_cap_board_never_fetches_job_details(self):
        pages = {BASE: response(BASE, listing(5001, [1001], pages=5001, next_page=2))}
        with patch.object(crawler, "_request", side_effect=lambda url, **_kw: pages[url]) as request:
            jobs, _, complete, notes = crawler._crawl_generic(BASE, "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertEqual(request.call_count, 1)
        self.assertTrue(any("exceeds posting cap" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
