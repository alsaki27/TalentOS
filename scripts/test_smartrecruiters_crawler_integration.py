"""Offline SmartRecruiters board-to-public-detail adapter tests."""

from __future__ import annotations

import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import employer_career_ingest as ingest


JOB_URL = "https://jobs.smartrecruiters.com/Acme/96484926-material-handler"
BOARD_URL = "https://careers.smartrecruiters.com/Acme"
DESCRIPTION = "Move equipment safely and maintain inventory records. " * 8


def board(job_url: str = JOB_URL) -> str:
    return (
        '<div class="js-openings-load" data-groups-pages="1" data-page="0" data-more="/Acme?page=1">'
        '<section class="js-group" data-qty="1"><h3 class="opening-title">Springfield, IL</h3>'
        f'<a class="js-job-ad-link" href="{job_url}"><h4 class="job-title">Material Handler</h4></a>'
        "</section></div>"
    )


def detail_html() -> str:
    posting = {"@context": "https://schema.org", "@type": "JobPosting",
               "title": "Material Handler", "url": JOB_URL, "description": DESCRIPTION}
    return f'<script type="application/ld+json">{json.dumps(posting)}</script>'


def response(url: str, status: int, html: str = "") -> SimpleNamespace:
    return SimpleNamespace(url=url, status_code=status, text=html)


class SmartRecruitersCrawlerIntegrationTests(unittest.TestCase):
    def test_complete_board_and_public_detail_are_ready(self):
        with patch.object(ingest, "_request", side_effect=[response(BOARD_URL, 200, board()),
                                                         response(JOB_URL, 200, detail_html())]) as request:
            jobs, complete, notes = ingest._smartrecruiters_jobs(BOARD_URL, "Acme", "Acme")
        self.assertTrue(complete)
        self.assertEqual(notes, [])
        self.assertEqual(request.call_count, 2)
        self.assertEqual(jobs[0]["external_job_id"], "96484926-material-handler")
        self.assertGreater(len(jobs[0]["description_text"]), 200)
        self.assertTrue(jobs[0]["raw"]["smartrecruiters_detail_complete"])

    def test_stale_detail_keeps_card_and_marks_source_partial(self):
        with patch.object(ingest, "_request", side_effect=[response(BOARD_URL, 200, board()),
                                                         response(JOB_URL, 404)]) as request:
            jobs, complete, notes = ingest._smartrecruiters_jobs(BOARD_URL, "Acme", "Acme")
        self.assertFalse(complete)
        self.assertEqual(request.call_count, 2)
        self.assertIsNone(jobs[0]["description_text"])
        self.assertIn("HTTP 404", jobs[0]["raw"]["smartrecruiters_detail_error"])
        self.assertTrue(any("incomplete for 1 of 1" in note for note in notes))

    def test_non_public_card_url_is_never_requested(self):
        form_url = JOB_URL + "/apply"
        with patch.object(ingest, "_request", return_value=response(BOARD_URL, 200, board(form_url))) as request:
            jobs, complete, notes = ingest._smartrecruiters_jobs(BOARD_URL, "Acme", "Acme")
        self.assertFalse(complete)
        self.assertEqual(request.call_count, 1)
        self.assertIsNone(jobs[0]["description_text"])
        self.assertTrue(any("incomplete for 1 of 1" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
