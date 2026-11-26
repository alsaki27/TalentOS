"""Offline tests for the explicitly configured Taleo Business Edition RSS parser."""
import json
import os
import unittest
from unittest.mock import patch

from taleo_business_edition_rss import (
    MIN_INTEGRATION_DESCRIPTION_CHARS,
    TaleoBusinessEditionConfigError,
    TaleoBusinessEditionRSSConfig,
    load_taleo_business_edition_source_config,
    parse_taleo_business_edition_rss,
)


SOURCE_URL = "https://customer.example.test/careers"
FEED_URL = "https://feeds.example.test/customer-provided-feed.xml"
ALLOWED_HOSTS = ("jobs.example.test",)
DESCRIPTION = "This is a detailed role description with responsibilities, qualifications, and working conditions. " * 4


def make_config(**changes):
    values = {
        "source_url": SOURCE_URL,
        "feed_url": FEED_URL,
        "employer": "Example Company",
        "allowed_job_hosts": ALLOWED_HOSTS,
        "feed_coverage_confirmed": True,
    }
    values.update(changes)
    return TaleoBusinessEditionRSSConfig(**values)


def rss(items: str = "") -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:taleo="urn:oracle:taleo">
      <channel><title>Career Center</title>{items}</channel>
    </rss>'''


EMPLOYER_KEYS = ["company:101", "company:202"]


def source_config_entry(**changes):
    values = {
        "employer_keys": EMPLOYER_KEYS,
        "employer": "Example Company",
        "authorization_confirmed": True,
        "third_party_aggregator_use_confirmed": True,
        "authorization_reference": "private-evidence-reference",
        "feed_url": FEED_URL,
        "allowed_job_hosts": list(ALLOWED_HOSTS),
        "feed_coverage_confirmed": True,
    }
    values.update(changes)
    return values


def source_config_json(entry=None, *, mapping_key=SOURCE_URL):
    return json.dumps({mapping_key: entry if entry is not None else source_config_entry()})


class TaleoBusinessEditionRSSTests(unittest.TestCase):
    def test_parses_documented_namespaced_fields_and_html_description(self):
        xml = rss(f'''<item>
          <title>GIS Analyst</title>
          <link>https://jobs.example.test/taleo/viewRequisition?org=PCG&amp;rid=123</link>
          <guid>https://jobs.example.test/taleo/viewRequisition?org=PCG&amp;rid=123</guid>
          <description>Fallback description</description>
          <pubDate>Thu, 21 Jan 2026 01:19:40 GMT</pubDate>
          <taleo:reqId>123</taleo:reqId>
          <taleo:location>Headquarters - EN</taleo:location>
          <taleo:locationCountry>US</taleo:locationCountry>
          <taleo:locationState>CA</taleo:locationState>
          <taleo:locationCity>San Francisco</taleo:locationCity>
          <taleo:department>Communication</taleo:department>
          <taleo:html-description>&lt;p&gt;{DESCRIPTION}&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Build maps&lt;/li&gt;&lt;/ul&gt;</taleo:html-description>
        </item>''')

        result = parse_taleo_business_edition_rss(xml, make_config())

        self.assertTrue(result.complete)
        self.assertEqual(result.item_count, 1)
        self.assertEqual(result.notes, [])
        self.assertEqual(len(result.jobs), 1)
        job = result.jobs[0]
        self.assertEqual(job["title"], "GIS Analyst")
        self.assertEqual(job["company"], "Example Company")
        self.assertEqual(job["location"], "Headquarters - EN")
        self.assertEqual(job["external_job_id"], "123")
        self.assertTrue(str(job["source_url"]).endswith("rid=123"))
        self.assertIn("Build maps", job["description_text"])
        self.assertEqual(job["raw"]["ats"], "taleo_business_edition_rss")
        self.assertEqual(job["raw"]["posted_at"], "Thu, 21 Jan 2026 01:19:40 GMT")

    def test_uses_documented_description_and_guid_fallback(self):
        xml = rss(f'''<item>
          <title>Project Manager</title>
          <guid>https://jobs.example.test/taleo/viewRequisition?org=PCG&amp;rid=456</guid>
          <description>&lt;p&gt;{DESCRIPTION}&lt;/p&gt;</description>
          <taleo:reqId>456</taleo:reqId>
          <taleo:locationCity>Boston</taleo:locationCity>
          <taleo:locationState>MA</taleo:locationState>
          <taleo:locationCountry>US</taleo:locationCountry>
        </item>''')

        result = parse_taleo_business_edition_rss(xml, make_config())

        self.assertTrue(result.complete)
        self.assertEqual(result.jobs[0]["external_job_id"], "456")
        self.assertEqual(result.jobs[0]["location"], "Boston, MA, US")

    def test_skips_item_with_missing_required_fields_and_marks_incomplete(self):
        xml = rss("<item><title> </title><description> </description><link>http://bad.example/job</link></item>")

        result = parse_taleo_business_edition_rss(xml, make_config())

        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertEqual(result.item_count, 1)
        self.assertIn("missing title", result.notes[0])
        self.assertIn("missing description", result.notes[0])
        self.assertIn("missing Taleo requisition ID", result.notes[0])
        self.assertIn("missing or invalid HTTPS posting URL", result.notes[0])

    def test_skips_description_below_integration_readiness_threshold(self):
        xml = rss(f'''<item><title>Analyst</title>
          <link>https://jobs.example.test/jobs/789</link>
          <taleo:reqId>789</taleo:reqId>
          <description>short description</description></item>''')

        result = parse_taleo_business_edition_rss(xml, make_config())

        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertIn(str(MIN_INTEGRATION_DESCRIPTION_CHARS), result.notes[0])

    def test_rejects_cross_host_or_non_https_posting_links(self):
        for url in ("http://jobs.example.test/jobs/1", "https://other.example.test/jobs/1", "https://jobs.example.test:444/jobs/1"):
            with self.subTest(url=url):
                xml = rss(f'''<item><title>Engineer</title><link>{url}</link>
                  <taleo:reqId>1</taleo:reqId><description>{DESCRIPTION}</description></item>''')
                result = parse_taleo_business_edition_rss(xml, make_config())
                self.assertFalse(result.complete)
                self.assertEqual(result.jobs, [])
                self.assertIn("invalid HTTPS posting URL", result.notes[0])

    def test_duplicate_id_and_posting_url_make_result_incomplete(self):
        item = f'''<item><title>Engineer</title><link>https://jobs.example.test/jobs/1</link>
          <taleo:reqId>1</taleo:reqId><description>{DESCRIPTION}</description></item>'''

        result = parse_taleo_business_edition_rss(rss(item + item), make_config())

        self.assertFalse(result.complete)
        self.assertEqual(len(result.jobs), 1)
        self.assertIn("duplicate Taleo requisition ID", result.notes[0])
        self.assertIn("duplicate posting URL", result.notes[0])

    def test_valid_empty_rss_is_a_complete_empty_parse(self):
        result = parse_taleo_business_edition_rss(rss(), make_config())
        self.assertTrue(result.complete)
        self.assertEqual(result.item_count, 0)
        self.assertEqual(result.jobs, [])

    def test_requires_explicit_full_feed_coverage_before_reporting_complete(self):
        xml = rss()
        for coverage in (False, None, "confirmed"):
            with self.subTest(coverage=coverage):
                result = parse_taleo_business_edition_rss(
                    xml,
                    make_config(feed_coverage_confirmed=coverage),
                )
                self.assertFalse(result.complete)
                self.assertTrue(any("full feed coverage is not confirmed" in note for note in result.notes))

        # Omitting the config field has the same fail-closed behavior.
        config = TaleoBusinessEditionRSSConfig(
            source_url=SOURCE_URL,
            feed_url=FEED_URL,
            employer="Example Company",
            allowed_job_hosts=ALLOWED_HOSTS,
        )
        result = parse_taleo_business_edition_rss(xml, config)
        self.assertFalse(result.complete)
        self.assertTrue(any("full feed coverage is not confirmed" in note for note in result.notes))

    def test_malformed_xml_and_non_rss_root_are_incomplete(self):
        malformed = parse_taleo_business_edition_rss("<rss><channel>", make_config())
        not_rss = parse_taleo_business_edition_rss("<feed><channel/></feed>", make_config())
        self.assertFalse(malformed.complete)
        self.assertIn("malformed", malformed.notes[0])
        self.assertFalse(not_rss.complete)
        self.assertIn("root is not RSS", not_rss.notes[0])

    def test_rejects_dtd_and_entity_declarations(self):
        payload = '<!DOCTYPE rss [<!ENTITY x "expanded">]><rss><channel/></rss>'
        result = parse_taleo_business_edition_rss(payload, make_config())
        self.assertFalse(result.complete)
        self.assertIn("prohibited DTD", result.notes[0])

    def test_config_requires_exact_https_feed_and_source_urls(self):
        with self.assertRaisesRegex(ValueError, "feed_url must be supplied explicitly"):
            make_config(feed_url="")
        with self.assertRaisesRegex(ValueError, "HTTPS URL"):
            make_config(source_url="http://customer.example.test/careers")
        with self.assertRaisesRegex(ValueError, "exact hostnames"):
            make_config(allowed_job_hosts=("*.taleo.net",))

    def test_any_invalid_item_makes_overall_result_incomplete_but_keeps_valid_jobs(self):
        good = f'''<item><title>Engineer</title><link>https://jobs.example.test/jobs/1</link>
          <taleo:reqId>1</taleo:reqId><description>{DESCRIPTION}</description></item>'''
        bad = "<item><title>Missing data</title></item>"
        result = parse_taleo_business_edition_rss(rss(good + bad), make_config())
        self.assertFalse(result.complete)
        self.assertEqual(len(result.jobs), 1)
        self.assertEqual(result.item_count, 2)

    def test_config_loader_accepts_exact_normalized_source_and_matching_employer_keys(self):
        config = load_taleo_business_edition_source_config(
            "HTTPS://CUSTOMER.EXAMPLE.TEST/careers/#jobs",
            EMPLOYER_KEYS,
            source_config_json(),
        )
        self.assertEqual(config.source_url, SOURCE_URL)
        self.assertEqual(config.feed_url, FEED_URL)
        self.assertEqual(config.allowed_job_hosts, ALLOWED_HOSTS)
        self.assertTrue(config.feed_coverage_confirmed)
        self.assertNotIn(FEED_URL, repr(config))
        self.assertNotIn("private-evidence-reference", repr(config))

    def test_config_loader_reads_environment_when_raw_json_is_not_injected(self):
        with patch.dict(os.environ, {"TALENTOS_TALEO_TBE_CONFIG_JSON": source_config_json()}):
            config = load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS)
        self.assertTrue(config.feed_coverage_confirmed)

    def test_config_loader_requires_exact_normalized_source_url_key(self):
        raw = source_config_json(mapping_key=SOURCE_URL + "/")
        with self.assertRaisesRegex(TaleoBusinessEditionConfigError, "exact normalized"):
            load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, raw)

    def test_config_loader_rejects_missing_or_nonmatching_employer_key_sets(self):
        for keys in (None, [], ["company:101"], ["company:101", "company:202", "company:303"], ["company:101", "company:101"]):
            with self.subTest(keys=keys):
                raw = source_config_json(source_config_entry(employer_keys=keys))
                with self.assertRaisesRegex(TaleoBusinessEditionConfigError, "employer key set"):
                    load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, raw)

    def test_config_loader_requires_explicit_authorization_and_aggregator_use(self):
        for field in ("authorization_confirmed", "third_party_aggregator_use_confirmed"):
            for value in (False, None, 1, "true"):
                with self.subTest(field=field, value=value):
                    entry = source_config_entry(**{field: value})
                    raw = source_config_json(entry)
                    with self.assertRaises(TaleoBusinessEditionConfigError):
                        load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, raw)

    def test_config_loader_requires_nonempty_authorization_reference(self):
        for reference in (None, "", "   "):
            with self.subTest(reference=reference):
                raw = source_config_json(source_config_entry(authorization_reference=reference))
                with self.assertRaisesRegex(TaleoBusinessEditionConfigError, "authorization reference") as caught:
                    load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, raw)
                self.assertNotIn(FEED_URL, str(caught.exception))
                self.assertNotIn("private-evidence-reference", str(caught.exception))

    def test_config_loader_requires_exact_https_feed_and_host_allowlist(self):
        for entry in (
            source_config_entry(feed_url="http://feeds.example.test/feed.xml"),
            source_config_entry(feed_url=""),
            source_config_entry(allowed_job_hosts=[]),
            source_config_entry(allowed_job_hosts=["*.example.test"]),
            source_config_entry(allowed_job_hosts="jobs.example.test"),
        ):
            with self.subTest(entry=entry):
                with self.assertRaises(TaleoBusinessEditionConfigError):
                    load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, source_config_json(entry))

    def test_optional_feed_coverage_value_flows_through_fail_closed(self):
        for entry, expected in (
            (source_config_entry(feed_coverage_confirmed=False), False),
            (source_config_entry(feed_coverage_confirmed=None), None),
        ):
            config = load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, source_config_json(entry))
            self.assertIs(config.feed_coverage_confirmed, expected)
            result = parse_taleo_business_edition_rss(rss(), config)
            self.assertFalse(result.complete)
            self.assertTrue(any("full feed coverage is not confirmed" in note for note in result.notes))

        missing_coverage = source_config_entry()
        del missing_coverage["feed_coverage_confirmed"]
        config = load_taleo_business_edition_source_config(
            SOURCE_URL, EMPLOYER_KEYS, source_config_json(missing_coverage)
        )
        self.assertIsNone(config.feed_coverage_confirmed)
        self.assertFalse(parse_taleo_business_edition_rss(rss(), config).complete)

    def test_config_loader_does_not_echo_urls_or_values_on_failure(self):
        raw = source_config_json(source_config_entry(authorization_reference="private-evidence-reference"))
        with self.assertRaises(TaleoBusinessEditionConfigError) as caught:
            load_taleo_business_edition_source_config("https://other.example.test/careers", EMPLOYER_KEYS, raw)
        self.assertNotIn(FEED_URL, str(caught.exception))
        self.assertNotIn("private-evidence-reference", str(caught.exception))
        self.assertNotIn(SOURCE_URL, str(caught.exception))

    def test_config_loader_rejects_missing_environment_config_and_invalid_json_safely(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(TaleoBusinessEditionConfigError, "configuration is missing"):
                load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS)
        with self.assertRaisesRegex(TaleoBusinessEditionConfigError, "JSON is invalid"):
            load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, "not-json-private-value")

    def test_config_loader_rejects_duplicate_json_keys_without_echoing_values(self):
        raw = '{"https://customer.example.test/careers":{},"https://customer.example.test/careers":{}}'
        with self.assertRaisesRegex(TaleoBusinessEditionConfigError, "JSON is invalid") as caught:
            load_taleo_business_edition_source_config(SOURCE_URL, EMPLOYER_KEYS, raw)
        self.assertNotIn(SOURCE_URL, str(caught.exception))
        self.assertNotIn(FEED_URL, str(caught.exception))


if __name__ == "__main__":
    unittest.main()
