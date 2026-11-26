"""Offline tests for the permission-gated NEOGOV RSS/Atom parser."""
import json
import os
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape

from neogov_customer_rss import (
    MAX_FEED_BYTES,
    MIN_INTEGRATION_DESCRIPTION_CHARS,
    NeogovCustomerRSSConfig,
    NeogovRSSConfigError,
    load_neogov_customer_rss_source_config,
    parse_neogov_customer_rss,
)


SOURCE_URL = "https://www.governmentjobs.com/careers/example"
SCHOOLJOBS_SOURCE_URL = "https://agency.schooljobs.com/careers/example"
FEED_URL = "https://feeds.example.test/customer/feed.xml?agency=example"
EMPLOYER_KEYS = ["company:101", "company:202"]
ALLOWED_FEED_HOSTS = ["feeds.example.test"]
ALLOWED_JOB_HOSTS = ["www.governmentjobs.com"]
DESCRIPTION = (
    "This is the full role description with responsibilities, qualifications, "
    "and working conditions. "
) * 5


def make_config(**changes):
    values = {
        "source_url": SOURCE_URL,
        "feed_url": FEED_URL,
        "employer": "Example Employer",
        "employer_keys": tuple(EMPLOYER_KEYS),
        "allowed_feed_hosts": tuple(ALLOWED_FEED_HOSTS),
        "allowed_job_hosts": tuple(ALLOWED_JOB_HOSTS),
        "feed_coverage_confirmed": True,
    }
    values.update(changes)
    return NeogovCustomerRSSConfig(**values)


def rss(items=""):
    return f'''<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>Jobs</title>{items}</channel></rss>'''


def rss_item(*, title="GIS Analyst", job_id="job-1", url="https://www.governmentjobs.com/careers/example/jobs/1", description=DESCRIPTION, extra="", guid_attributes=""):
    guid = f"<guid {guid_attributes}>{escape(job_id)}</guid>" if job_id is not None else ""
    link = f"<link>{escape(url)}</link>" if url is not None else ""
    title_xml = f"<title>{escape(title)}</title>" if title is not None else ""
    description_xml = f"<description>{escape(description)}</description>" if description is not None else ""
    return f"<item>{title_xml}{link}{guid}{description_xml}{extra}</item>"


def atom_entry(*, title="GIS Analyst", job_id="tag:example.test,2026:job-1", url="https://www.governmentjobs.com/careers/example/jobs/1", description=DESCRIPTION, links="", content=""):
    if links == "":
        links = f'<link rel="alternate" href="{escape(url, {"\"": "&quot;"})}" />' if url is not None else ""
    if content == "":
        content = f'<content type="html">{escape(description)}</content>' if description is not None else ""
    title_xml = f"<title>{escape(title)}</title>" if title is not None else ""
    id_xml = f"<id>{escape(job_id)}</id>" if job_id is not None else ""
    return f"<entry>{title_xml}{id_xml}{links}{content}<updated>2026-10-15T12:00:00Z</updated></entry>"


def atom(entries=""):
    return f'''<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><title>Jobs</title>{entries}</feed>'''


def config_entry(**changes):
    values = {
        "employer_keys": EMPLOYER_KEYS,
        "employer": "Example Employer",
        "authorization_confirmed": True,
        "talentos_reuse_confirmed": True,
        "written_permission_reference": "private-written-permission-ref",
        "talentos_reuse_grant_reference": "private-reuse-grant-ref",
        "feed_url": FEED_URL,
        "allowed_feed_hosts": ALLOWED_FEED_HOSTS,
        "allowed_job_hosts": ALLOWED_JOB_HOSTS,
        "sanitized_sample_confirmation": {
            "reference": "private-sanitized-sample-ref",
            "schema_confirmed": True,
            "full_description_confirmed": True,
            "full_feed_coverage_confirmed": True,
        },
    }
    values.update(changes)
    return values


def config_json(entry=None, *, mapping_key=SOURCE_URL):
    return json.dumps({mapping_key: entry if entry is not None else config_entry()})


class NeogovCustomerRSSTests(unittest.TestCase):
    def test_parses_standard_rss_item(self):
        result = parse_neogov_customer_rss(rss(rss_item()), make_config())
        self.assertTrue(result.complete)
        self.assertEqual(result.item_count, 1)
        self.assertEqual(result.notes, [])
        self.assertEqual(len(result.jobs), 1)
        job = result.jobs[0]
        self.assertEqual(job["title"], "GIS Analyst")
        self.assertEqual(job["external_job_id"], "job-1")
        self.assertEqual(job["company"], "Example Employer")
        self.assertEqual(job["source_url"], "https://www.governmentjobs.com/careers/example/jobs/1")
        self.assertEqual(job["raw"]["ats"], "neogov_customer_rss")
        self.assertEqual(job["raw"]["feed_format"], "rss")

    def test_rss_guid_permalink_can_supply_the_posting_url(self):
        item = rss_item(url=None, job_id="https://www.governmentjobs.com/careers/example/jobs/2")
        result = parse_neogov_customer_rss(rss(item), make_config())
        self.assertTrue(result.complete)
        self.assertEqual(result.jobs[0]["source_url"], "https://www.governmentjobs.com/careers/example/jobs/2")

    def test_non_permalink_guid_is_an_id_not_a_posting_url(self):
        item = rss_item(url=None, job_id="job:opaque:17", guid_attributes='isPermaLink="false"')
        result = parse_neogov_customer_rss(rss(item), make_config())
        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertIn("missing or invalid HTTPS posting URL", result.notes[0])

        https_but_non_permalink = rss_item(
            url=None,
            job_id="https://www.governmentjobs.com/careers/example/jobs/3",
            guid_attributes='isPermaLink="false"',
        )
        result = parse_neogov_customer_rss(rss(https_but_non_permalink), make_config())
        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertIn("missing or invalid HTTPS posting URL", result.notes[0])

    def test_parses_atom_entry(self):
        result = parse_neogov_customer_rss(atom(atom_entry()), make_config())
        self.assertTrue(result.complete)
        self.assertEqual(result.item_count, 1)
        self.assertEqual(result.jobs[0]["external_job_id"], "tag:example.test,2026:job-1")
        self.assertEqual(result.jobs[0]["raw"]["feed_format"], "atom")
        self.assertIn("responsibilities", result.jobs[0]["description_text"])

    def test_parses_atom_xhtml_content(self):
        xhtml = f'<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>{escape(DESCRIPTION)}</p><ul><li>Public service</li></ul></div></content>'
        result = parse_neogov_customer_rss(atom(atom_entry(content=xhtml)), make_config())
        self.assertTrue(result.complete)
        self.assertIn("Public service", result.jobs[0]["description_text"])

    def test_empty_feed_is_complete_only_with_coverage_confirmation(self):
        self.assertTrue(parse_neogov_customer_rss(rss(), make_config()).complete)
        result = parse_neogov_customer_rss(rss(), make_config(feed_coverage_confirmed=None))
        self.assertFalse(result.complete)
        self.assertIn("full feed coverage is not confirmed", result.notes[0])
        false_result = parse_neogov_customer_rss(rss(), make_config(feed_coverage_confirmed=False))
        self.assertFalse(false_result.complete)

    def test_unconfirmed_coverage_keeps_valid_jobs_but_never_marks_complete(self):
        result = parse_neogov_customer_rss(rss(rss_item()), make_config(feed_coverage_confirmed=None))
        self.assertFalse(result.complete)
        self.assertEqual(len(result.jobs), 1)

    def test_missing_required_fields_make_feed_incomplete(self):
        item = rss_item(title=None, job_id=None, url=None, description=None)
        result = parse_neogov_customer_rss(rss(item), make_config())
        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertIn("missing title", result.notes[0])
        self.assertIn("missing or invalid stable posting ID", result.notes[0])
        self.assertIn("missing or invalid HTTPS posting URL", result.notes[0])
        self.assertIn("missing description", result.notes[0])

    def test_short_descriptions_are_rejected(self):
        result = parse_neogov_customer_rss(
            rss(rss_item(description="Short role summary.")), make_config()
        )
        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertIn(str(MIN_INTEGRATION_DESCRIPTION_CHARS), result.notes[0])

    def test_posting_urls_must_be_https_and_on_exact_operator_allowlist(self):
        urls = (
            "http://www.governmentjobs.com/careers/example/jobs/1",
            "https://other.example.test/jobs/1",
            "https://www.governmentjobs.com:444/careers/example/jobs/1",
            "https://user@www.governmentjobs.com/careers/example/jobs/1",
        )
        for url in urls:
            with self.subTest(url=url):
                result = parse_neogov_customer_rss(rss(rss_item(url=url)), make_config())
                self.assertFalse(result.complete)
                self.assertEqual(result.jobs, [])
                self.assertIn("missing or invalid HTTPS posting URL", result.notes[0])

    def test_duplicate_ids_and_urls_reject_every_ambiguous_duplicate(self):
        first = rss_item(job_id="same-id", url="https://www.governmentjobs.com/jobs/same")
        second = rss_item(title="Second role", job_id="same-id", url="https://www.governmentjobs.com/jobs/other")
        result = parse_neogov_customer_rss(rss(first + second), make_config())
        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertEqual(sum("duplicate stable posting ID" in note for note in result.notes), 2)

        same_url_one = rss_item(job_id="id-one", url="https://www.governmentjobs.com/jobs/shared")
        same_url_two = rss_item(job_id="id-two", url="https://www.governmentjobs.com/jobs/shared")
        by_url = parse_neogov_customer_rss(rss(same_url_one + same_url_two), make_config())
        self.assertFalse(by_url.complete)
        self.assertEqual(by_url.jobs, [])
        self.assertEqual(sum("duplicate posting URL" in note for note in by_url.notes), 2)

    def test_duplicate_id_with_other_invalid_item_still_rejects_valid_peer(self):
        good = rss_item(job_id="shared-id")
        bad = rss_item(title=None, job_id="shared-id", url="https://www.governmentjobs.com/jobs/other")
        result = parse_neogov_customer_rss(rss(good + bad), make_config())
        self.assertFalse(result.complete)
        self.assertEqual(result.jobs, [])
        self.assertTrue(any("duplicate stable posting ID" in note for note in result.notes))

    def test_ambiguous_rss_fields_and_atom_links_are_rejected(self):
        duplicate_title = rss_item(extra="<title>Different title</title>")
        rss_result = parse_neogov_customer_rss(rss(duplicate_title), make_config())
        self.assertFalse(rss_result.complete)
        self.assertEqual(rss_result.jobs, [])
        self.assertIn("ambiguous", rss_result.notes[0])

        links = (
            '<link rel="alternate" href="https://www.governmentjobs.com/jobs/1" />'
            '<link rel="alternate" href="https://www.governmentjobs.com/jobs/2" />'
        )
        atom_result = parse_neogov_customer_rss(atom(atom_entry(links=links)), make_config())
        self.assertFalse(atom_result.complete)
        self.assertEqual(atom_result.jobs, [])
        self.assertIn("ambiguous", atom_result.notes[0])

    def test_atom_link_relation_iri_is_recognized(self):
        links = '<link rel="http://www.iana.org/assignments/relation/alternate" href="https://www.governmentjobs.com/jobs/1" />'
        result = parse_neogov_customer_rss(atom(atom_entry(links=links)), make_config())
        self.assertTrue(result.complete)

    def test_rejects_dtd_entities_malformed_and_wrong_root(self):
        dtd = '<!DOCTYPE rss [<!ENTITY x "expanded">]><rss><channel/></rss>'
        malformed = "<rss><channel>"
        wrong_root = "<html><body/></html>"
        for payload, expected in (
            (dtd, "prohibited DTD"),
            (malformed, "malformed"),
            (wrong_root, "neither RSS nor Atom"),
            ("<rss />", "channel is missing"),
        ):
            with self.subTest(expected=expected):
                result = parse_neogov_customer_rss(payload, make_config())
                self.assertFalse(result.complete)
                self.assertIn(expected, result.notes[0])

    def test_rejects_empty_oversized_and_wrong_type_payloads(self):
        for payload in (b"", b"x" * (MAX_FEED_BYTES + 1), object()):
            result = parse_neogov_customer_rss(payload, make_config())
            self.assertFalse(result.complete)
            self.assertIn("feed is empty" if payload == b"" else "feed payload" if not isinstance(payload, (str, bytes)) else "size limit", result.notes[0])

    def test_config_loader_matches_exact_normalized_source_and_key_set(self):
        config = load_neogov_customer_rss_source_config(
            "HTTPS://WWW.GOVERNMENTJOBS.COM/careers/example/#jobs",
            list(reversed(EMPLOYER_KEYS)),
            config_json(),
        )
        self.assertEqual(config.source_url, SOURCE_URL)
        self.assertEqual(config.feed_url, FEED_URL)
        self.assertEqual(set(config.employer_keys), set(EMPLOYER_KEYS))
        self.assertTrue(config.feed_coverage_confirmed)
        self.assertNotIn(FEED_URL, repr(config))
        self.assertNotIn("private-written-permission-ref", repr(config))

    def test_config_loader_accepts_schooljobs_source(self):
        raw = config_json(mapping_key=SCHOOLJOBS_SOURCE_URL)
        config = load_neogov_customer_rss_source_config(SCHOOLJOBS_SOURCE_URL, EMPLOYER_KEYS, raw)
        self.assertEqual(config.source_url, SCHOOLJOBS_SOURCE_URL)

    def test_config_loader_rejects_non_neogov_or_lookalike_source_hosts(self):
        for source in (
            "https://example.test/governmentjobs.com/careers",
            "https://governmentjobs.com.example.test/careers",
            "https://notgovernmentjobs.com/careers",
            "http://www.governmentjobs.com/careers/example",
        ):
            with self.subTest(source=source):
                with self.assertRaises(NeogovRSSConfigError):
                    load_neogov_customer_rss_source_config(source, EMPLOYER_KEYS, config_json())

    def test_config_loader_requires_exact_normalized_source_mapping(self):
        with self.assertRaisesRegex(NeogovRSSConfigError, "exact normalized"):
            load_neogov_customer_rss_source_config(
                SOURCE_URL, EMPLOYER_KEYS, config_json(mapping_key=SOURCE_URL + "/")
            )

    def test_config_loader_rejects_missing_or_mismatched_employer_keys(self):
        for keys in (None, [], ["company:101"], ["company:101", "company:303"], ["company:101", "company:101"]):
            with self.subTest(keys=keys):
                with self.assertRaisesRegex(NeogovRSSConfigError, "employer key set"):
                    load_neogov_customer_rss_source_config(
                        SOURCE_URL, EMPLOYER_KEYS, config_json(config_entry(employer_keys=keys))
                    )

    def test_config_loader_requires_written_permission_and_reuse_references(self):
        for entry in (
            config_entry(authorization_confirmed=False),
            config_entry(authorization_confirmed="true"),
            config_entry(talentos_reuse_confirmed=False),
            config_entry(talentos_reuse_confirmed=1),
            config_entry(written_permission_reference=" "),
            config_entry(talentos_reuse_grant_reference=None),
        ):
            with self.subTest(entry=entry):
                with self.assertRaises(NeogovRSSConfigError):
                    load_neogov_customer_rss_source_config(SOURCE_URL, EMPLOYER_KEYS, config_json(entry))

    def test_config_loader_requires_all_sanitized_sample_confirmations(self):
        for field in ("schema_confirmed", "full_description_confirmed", "full_feed_coverage_confirmed"):
            for value in (False, None, 1, "true"):
                sample = config_entry()["sanitized_sample_confirmation"] | {field: value}
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(NeogovRSSConfigError, "sanitized sample confirmation"):
                        load_neogov_customer_rss_source_config(
                            SOURCE_URL, EMPLOYER_KEYS, config_json(config_entry(sanitized_sample_confirmation=sample))
                        )

    def test_config_loader_requires_sample_reference(self):
        sample = config_entry()["sanitized_sample_confirmation"] | {"reference": " "}
        with self.assertRaisesRegex(NeogovRSSConfigError, "sample reference"):
            load_neogov_customer_rss_source_config(
                SOURCE_URL, EMPLOYER_KEYS, config_json(config_entry(sanitized_sample_confirmation=sample))
            )

    def test_config_loader_requires_exact_https_feed_and_allowlisted_feed_host(self):
        for entry in (
            config_entry(feed_url="http://feeds.example.test/feed.xml"),
            config_entry(feed_url="https://other.example.test/feed.xml"),
            config_entry(allowed_feed_hosts=[]),
            config_entry(allowed_feed_hosts=["*.example.test"]),
            config_entry(allowed_job_hosts=[]),
            config_entry(allowed_job_hosts=["*.governmentjobs.com"]),
        ):
            with self.subTest(entry=entry):
                with self.assertRaises(NeogovRSSConfigError):
                    load_neogov_customer_rss_source_config(SOURCE_URL, EMPLOYER_KEYS, config_json(entry))

    def test_config_loader_rejects_duplicate_json_keys_and_duplicate_allowlist_hosts(self):
        duplicate_json = f'{{"{SOURCE_URL}":{{}},"{SOURCE_URL}":{{}}}}'
        with self.assertRaisesRegex(NeogovRSSConfigError, "JSON is invalid"):
            load_neogov_customer_rss_source_config(SOURCE_URL, EMPLOYER_KEYS, duplicate_json)
        duplicate_hosts = config_entry(allowed_job_hosts=["www.governmentjobs.com", "WWW.GOVERNMENTJOBS.COM"])
        with self.assertRaisesRegex(NeogovRSSConfigError, "host config is invalid"):
            load_neogov_customer_rss_source_config(SOURCE_URL, EMPLOYER_KEYS, config_json(duplicate_hosts))

    def test_config_loader_reads_environment_and_rejects_missing_or_bad_json(self):
        with patch.dict(os.environ, {"TALENTOS_NEOGOV_RSS_CONFIG_JSON": config_json()}):
            config = load_neogov_customer_rss_source_config(SOURCE_URL, EMPLOYER_KEYS)
        self.assertTrue(config.feed_coverage_confirmed)
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(NeogovRSSConfigError, "configuration is missing"):
                load_neogov_customer_rss_source_config(SOURCE_URL, EMPLOYER_KEYS)
        with self.assertRaisesRegex(NeogovRSSConfigError, "JSON is invalid"):
            load_neogov_customer_rss_source_config(SOURCE_URL, EMPLOYER_KEYS, "bad-private-json")

    def test_config_loader_errors_never_echo_urls_or_private_evidence(self):
        bad = config_entry(talentos_reuse_grant_reference="private-reuse-grant-ref")
        with self.assertRaises(NeogovRSSConfigError) as caught:
            load_neogov_customer_rss_source_config(
                "https://other.example.test/careers", EMPLOYER_KEYS, config_json(bad)
            )
        self.assertNotIn(SOURCE_URL, str(caught.exception))
        self.assertNotIn(FEED_URL, str(caught.exception))
        self.assertNotIn("private-reuse-grant-ref", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
