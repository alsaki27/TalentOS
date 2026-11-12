"""Focused checks for conservative unstructured career-page discovery."""

import unittest

from open_position_links import detail_matches_open_position, discover_open_position_links


PAGE = "https://example.com/careers/"
TITLE = "Mechanical Project Engineer I - 0-3 Years Experience"


class OpenPositionLinkTests(unittest.TestCase):
    def test_only_same_host_title_link_inside_openings_section_is_candidate(self):
        html = f"""
        <a href='/about/'>About the team</a>
        <h2>Open Positions</h2>
        <h3>Current Employment Opportunities</h3>
        <ul><li><a href='/elementor-3554/'><span>{TITLE}</span></a></li></ul>
        <a href='https://external.example/apply/123'>Another Engineer</a>
        <a href='/jobs/'>Apply Now</a>
        <h2>Our Location</h2>
        <a href='/benefits/'>Excellent Benefits</a>
        """
        links = discover_open_position_links(html, PAGE)
        self.assertEqual([(item.url, item.title) for item in links], [("https://example.com/elementor-3554/", TITLE)])

    def test_no_explicit_heading_or_unbounded_links_yields_no_completeness_claim(self):
        self.assertEqual(discover_open_position_links("<a href='/role/123'>Field Engineer</a>", PAGE), ())
        html = "<h2>Open Positions</h2>" + "".join(f"<a href='/role/{n}'>Field Engineer {n}</a>" for n in range(5))
        self.assertEqual(len(discover_open_position_links(html, PAGE, max_links=2)), 2)

    def test_detail_requires_matching_title_substantial_text_and_apply_cue(self):
        body = "You will design systems and work with experienced project engineers. " * 10
        html = f"<h1>Mechanical Project Engineer I – 0-3 Years Experience</h1><p>{body}</p><p>Apply Now</p>"
        self.assertTrue(detail_matches_open_position(html, TITLE))
        self.assertFalse(detail_matches_open_position(html.replace("Apply Now", "Contact us"), TITLE))
        self.assertFalse(detail_matches_open_position(html.replace("Mechanical Project Engineer I", "Other Position"), TITLE))
        self.assertFalse(detail_matches_open_position("<h1>Mechanical Project Engineer I – 0-3 Years Experience</h1><p>Apply Now</p>", TITLE))


if __name__ == "__main__":
    unittest.main()
