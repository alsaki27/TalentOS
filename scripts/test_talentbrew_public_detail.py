"""Synthetic, offline tests for the bounded TalentBrew public detail parser."""

import unittest

from talentbrew_public_detail import parse_public_detail


URL = "https://careers.example.com/job/city/role-name/123/456"
TITLE = "Principal Technical Business Analyst - Retail Strategy"
DESCRIPTION = (
    "Build systems for store teams and work with product and engineering partners. "
    "Document business requirements, review data flows, and test releases with users. "
    "Explain risks, agree on priorities, and support a clear rollout plan across regions. "
    "Bring careful analysis, practical communication, and relevant technical experience."
)


def detail(*, hero="Explore careers", job_title=TITLE, markers=1, descriptions=1,
           description=DESCRIPTION, job_id="456", org_id="123", heading_tag="h1"):
    heading = f"<{heading_tag}>{job_title}</{heading_tag}>"
    sections = "".join(
        f'<section data-selector-name="jobdetails" data-job-id="{job_id}" data-org-id="{org_id}">'
        + (f'<div class="ajd-job-details__ats-description ats-description"><p>{description}</p></div>'
           if index < descriptions else "")
        + "</section>"
        for index in range(markers)
    )
    return f"<html><h1>{hero}</h1>{heading}{sections}</html>"


class TalentBrewDetailTests(unittest.TestCase):
    def test_consor_style_header_and_one_description(self):
        html = detail(markers=2, descriptions=1, hero="Expand your")
        result = parse_public_detail(html, URL, URL, TITLE)
        self.assertTrue(result.complete, result.reason)
        self.assertEqual(result.external_job_id, "456")
        self.assertEqual(result.title, TITLE)
        self.assertEqual(result.source_url, URL)
        self.assertGreater(len(result.description_text or ""), 200)

    def test_sharkninja_style_duplicate_mobile_title(self):
        html = detail(markers=2, descriptions=1, hero="WHEN YOU...")
        html = html.replace(f"<h1>{TITLE}</h1>", f'<h1 class="job-title-heading mobile-jd-title">{TITLE}</h1><h1>{TITLE}</h1>')
        self.assertTrue(parse_public_detail(html, URL, URL, TITLE).complete)

    def test_toshiba_style_generic_h1_and_exact_h2(self):
        result = parse_public_detail(detail(hero="Job Description", heading_tag="h2"), URL, URL, TITLE)
        self.assertTrue(result.complete, result.reason)

    def test_rejects_generic_heading_and_title_mismatch(self):
        for html in (detail(job_title="Job Description"), detail(job_title="Different Role")):
            with self.subTest(html=html[:80]):
                self.assertIn("heading did not match", parse_public_detail(html, URL, URL, TITLE).reason)

    def test_rejects_mismatched_host_id_org_and_application_path(self):
        cases = (
            (URL.replace("careers.example.com", "other.example.com"), URL, detail()),
            (URL.replace("/456", "/457"), URL, detail()),
            (URL, URL, detail(job_id="457")),
            (URL, URL, detail(org_id="124")),
            (URL.replace("/job/", "/apply/"), URL, detail()),
            (URL, URL.replace("/job/", "/application/"), detail()),
        )
        for page_url, listed_url, html in cases:
            with self.subTest(page_url=page_url, listed_url=listed_url, html=html[-100:]):
                self.assertFalse(parse_public_detail(html, page_url, listed_url, TITLE).complete)

    def test_rejects_duplicate_missing_short_and_unclosed_description(self):
        cases = (
            detail(markers=2, descriptions=2),
            detail(markers=1, descriptions=0),
            detail(description="A brief note."),
            detail().replace("</div>", ""),
        )
        for html in cases:
            with self.subTest(html=html[-100:]):
                self.assertFalse(parse_public_detail(html, URL, URL, TITLE).complete)

    def test_rejects_missing_title_and_oversized_html(self):
        self.assertFalse(parse_public_detail(detail(), URL, URL, "").complete)
        self.assertFalse(parse_public_detail(detail() + " " * 8_000_000, URL, URL, TITLE).complete)

    def test_rejects_oversized_description_and_conflicting_marker(self):
        self.assertIn("exceeds the size limit", parse_public_detail(
            detail(description="x" * 100_001), URL, URL, TITLE,
        ).reason)
        html = detail() + '<section data-selector-name="jobdetails" data-job-id="999" data-org-id="123"></section>'
        self.assertIn("data-job-id", parse_public_detail(html, URL, URL, TITLE).reason)


if __name__ == "__main__":
    unittest.main()
