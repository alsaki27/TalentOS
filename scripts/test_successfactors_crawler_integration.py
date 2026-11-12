"""Public SuccessFactors listing and detail integration remains fail closed."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import employer_career_ingest as crawler


HOME = "https://careers.example.com/?locale=en_US"
BOARD = "https://careers.example.com/go/All-Jobs/123/"
PAGE2 = "https://careers.example.com/go/All-Jobs/123/2/?q=&sortColumn=referencedate"
JOBS = tuple(f"https://careers.example.com/job/City-Role-{index}/{1000 + index}/" for index in range(1, 4))


def listing(page: int, *, wrong_total: bool = False) -> str:
    ids = (0, 1) if page == 1 else (2,)
    first, last = (1, 3 if wrong_total else 2) if page == 1 else (3, 3)
    total = 4 if wrong_total else 3
    next_link = '<a title="Page 2" href="/go/All-Jobs/123/2/?q=&amp;sortColumn=referencedate">2</a>' if page == 1 else ""
    cards = "".join(
        f'<tr><td><a class="jobTitle-link" href="{JOBS[index]}">Role {index + 1}</a></td></tr>'
        for index in ids
    )
    return (
        f'{next_link}<table id="searchresults" aria-label="Search results for . Page {page} of 2, '
        f'Results {first} to {last} of {total}">{cards}</table>'
    )


def detail(index: int, *, title: str | None = None) -> str:
    data = {
        "@context": "https://schema.org", "@type": "JobPosting",
        "title": title or f"Role {index + 1}", "url": JOBS[index],
        "description": "Complete responsibilities and experience requirements. " * 7,
    }
    return '<script type="application/ld+json">' + json.dumps(data) + "</script>"


def response(url: str, body: str, status: int = 200) -> SimpleNamespace:
    return SimpleNamespace(url=url, text=body, status_code=status)


class SuccessFactorsCrawlerIntegrationTests(unittest.TestCase):
    def test_linked_all_jobs_board_fetches_every_public_detail(self):
        pages = {
            HOME: response(HOME, '<script src="/platform/js/j2w/core.js"></script><a href="/go/All-Jobs/123/">All Jobs</a>'),
            BOARD: response(BOARD, listing(1)),
            PAGE2: response(PAGE2, listing(2)),
            **{job_url: response(job_url, detail(index)) for index, job_url in enumerate(JOBS)},
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kwargs: pages[url]) as request, \
                patch.object(crawler, "_discover_sitemaps") as sitemaps:
            jobs, method, complete, notes = crawler._crawl_generic(HOME, "Example")
        self.assertTrue(complete, notes)
        self.assertEqual(method, "linked_public_html_pagination:successfactors-v1")
        self.assertEqual([job["external_job_id"] for job in jobs], ["1001", "1002", "1003"])
        self.assertTrue(all(job["raw"]["ats"] == "successfactors" and len(job["description_text"]) > 200 for job in jobs))
        self.assertEqual(request.call_count, 6)
        sitemaps.assert_not_called()

    def test_direct_board_and_missing_detail_are_different_completeness_states(self):
        direct_listing = (
            '<table id="searchresults" aria-label="Search results for . Page 1 of 1, Results 1 to 1 of 1">'
            f'<tr><td><a class="jobTitle-link" href="{JOBS[0]}">Role 1</a></td></tr></table>'
        )
        pages = {BOARD: response(BOARD, direct_listing), JOBS[0]: response(JOBS[0], detail(0))}
        with patch.object(crawler, "_request", side_effect=lambda url, **_kwargs: pages[url]):
            jobs, method, complete, notes = crawler._crawl_generic(BOARD, "Example")
        self.assertTrue(complete, notes)
        self.assertEqual(method, "public_html_pagination:successfactors-v1")
        self.assertEqual(len(jobs), 1)

        pages[JOBS[0]] = response(JOBS[0], detail(0, title="Other Role"))
        with patch.object(crawler, "_request", side_effect=lambda url, **_kwargs: pages[url]):
            jobs, _, complete, notes = crawler._crawl_generic(BOARD, "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertTrue(any("title did not match" in note for note in notes))

    def test_js_only_variant_and_inconsistent_total_stay_partial(self):
        js_only = response(HOME, '<script src="/platform/js/j2w/core.js"></script><div id="jobs-root"></div>')
        with patch.object(crawler, "_request", return_value=js_only) as request, \
                patch.object(crawler, "_discover_sitemaps", return_value=([], False, [])):
            jobs, _, complete, _ = crawler._crawl_generic(HOME, "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertEqual(request.call_count, 1)

        pages = {
            HOME: response(HOME, '<script src="/platform/js/j2w/core.js"></script><a href="/go/All-Jobs/123/">All Jobs</a>'),
            BOARD: response(BOARD, listing(1, wrong_total=True)),
        }
        with patch.object(crawler, "_request", side_effect=lambda url, **_kwargs: pages[url]) as request:
            jobs, _, complete, notes = crawler._crawl_generic(HOME, "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertEqual(request.call_count, 2)
        self.assertTrue(any("job card count" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
