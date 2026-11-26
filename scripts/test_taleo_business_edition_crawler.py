"""Offline dispatch and request-safety tests for the TBE crawler integration."""
import json
import os
import unittest
from unittest.mock import patch

import employer_career_ingest as crawler


SOURCE_URL = "https://pod.tbe.taleo.net/pod/ats/careers/v2/searchResults?org=ORG&cws=42"
FEED_URL = "https://feeds.example.test/customer-provided-feed.xml?org=ORG&cws=42"
JOB_URL = "https://jobs.example.test/taleo/viewRequisition?org=ORG&rid=321"
DESCRIPTION = "This role includes a detailed summary of responsibilities, required qualifications, work conditions, and benefits. " * 4
EMPLOYER_KEYS = ["company:101"]


def config_json(*, coverage=True):
    return json.dumps({
        crawler.normalize_source_url(SOURCE_URL): {
            "employer_keys": EMPLOYER_KEYS,
            "employer": "Example Company",
            "authorization_confirmed": True,
            "third_party_aggregator_use_confirmed": True,
            "authorization_reference": "private-authorization-reference",
            "feed_url": FEED_URL,
            "allowed_job_hosts": ["jobs.example.test"],
            "feed_coverage_confirmed": coverage,
        }
    })


def rss_fixture():
    return f'''<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:taleo="urn:oracle:taleo"><channel>
      <item>
        <title>GIS Analyst</title>
        <link>{JOB_URL.replace("&", "&amp;")}</link>
        <guid>{JOB_URL.replace("&", "&amp;")}</guid>
        <description>Example summary</description>
        <pubDate>Thu, 21 Jan 2026 01:19:40 GMT</pubDate>
        <taleo:reqId>321</taleo:reqId>
        <taleo:location>Boston</taleo:location>
        <taleo:department>Engineering</taleo:department>
        <taleo:html-description>&lt;p&gt;{DESCRIPTION}&lt;/p&gt;</taleo:html-description>
      </item>
    </channel></rss>'''.encode("utf-8")


def source_record():
    return {
        "url": SOURCE_URL,
        "normalized_url": crawler.normalize_source_url(SOURCE_URL),
        "source_urls": [SOURCE_URL],
        "evidence_urls": [SOURCE_URL],
        "employers": ["Example Company"],
        "employer_keys": EMPLOYER_KEYS,
    }


class _Rules:
    def __init__(self):
        self.fetches = []

    def can_fetch(self, user_agent, url):
        self.fetches.append((user_agent, url))
        return True

    def crawl_delay(self, user_agent):
        return None


class _Raw:
    def __init__(self, body):
        self.body = body

    def read(self, _limit, decode_content=True):
        return self.body


class _Response:
    def __init__(self, body=b"", status_code=200, *, headers=None, redirect=False):
        self.status_code = status_code
        self.headers = headers or {}
        self.is_redirect = redirect
        self.is_permanent_redirect = False
        self.raw = _Raw(body)
        self._content = b""

    @property
    def content(self):
        return self._content

    def close(self):
        return None


class _Session:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if not self.responses:
            raise AssertionError("unexpected extra network request")
        return self.responses.pop(0)


class TaleoBusinessEditionCrawlerTests(unittest.TestCase):
    def setUp(self):
        self.previous_request_count = crawler._content_request_count
        self.previous_last_host_request = dict(crawler._last_host_request)
        self.previous_shared_rate_dir = crawler._shared_host_rate_dir
        crawler._content_request_count = 0
        crawler._last_host_request.clear()
        crawler._shared_host_rate_dir = None

    def tearDown(self):
        crawler._content_request_count = self.previous_request_count
        crawler._last_host_request.clear()
        crawler._last_host_request.update(self.previous_last_host_request)
        crawler._shared_host_rate_dir = self.previous_shared_rate_dir

    def _actual_request_patches(self, session, rules):
        return (
            patch.object(crawler, "_robots_parser", return_value=rules),
            patch.object(crawler, "_thread_session", return_value=session),
            patch.object(
                crawler.socket,
                "getaddrinfo",
                return_value=[(None, None, None, None, ("93.184.216.34", 443))],
            ),
            patch.object(crawler.time, "sleep"),
        )

    def test_tbe_host_dispatch_is_separate_from_taleo_enterprise(self):
        self.assertEqual(
            crawler._platform(SOURCE_URL),
            ("taleo_tbe", crawler.normalize_source_url(SOURCE_URL)),
        )
        self.assertEqual(
            crawler._platform("https://hdr.taleo.net/careersection/ex/jobsearch.ftl"),
            ("taleo", "ex"),
        )
        self.assertIsNone(crawler._platform("https://fake-tbe.taleo.net/pod/ats/careers/v2/searchResults"))
        self.assertEqual(crawler.ADAPTER_VERSION, "employer-career-ingest-v34")

    def test_missing_config_is_held_before_any_request(self):
        with patch.dict(os.environ, {"TALENTOS_TALEO_TBE_CONFIG_JSON": ""}), \
             patch.object(crawler, "_request") as request:
            result = crawler.scrape_source(source_record())

        request.assert_not_called()
        self.assertEqual(crawler._content_request_count, 0)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["method"], "policy_hold")
        self.assertFalse(result["complete"])
        self.assertIn("Taleo Business Edition", result["error"])

    def test_mismatched_or_unapproved_config_is_held_before_any_request(self):
        base = json.loads(config_json())
        invalid_entries = []
        wrong_employer_set = json.loads(json.dumps(base))
        wrong_employer_set[crawler.normalize_source_url(SOURCE_URL)]["employer_keys"] = ["company:999"]
        invalid_entries.append(wrong_employer_set)
        no_authorization = json.loads(json.dumps(base))
        no_authorization[crawler.normalize_source_url(SOURCE_URL)]["authorization_confirmed"] = False
        invalid_entries.append(no_authorization)
        no_aggregator_grant = json.loads(json.dumps(base))
        no_aggregator_grant[crawler.normalize_source_url(SOURCE_URL)]["third_party_aggregator_use_confirmed"] = False
        invalid_entries.append(no_aggregator_grant)

        for index, invalid_config in enumerate(invalid_entries):
            with self.subTest(index=index), \
                 patch.dict(os.environ, {"TALENTOS_TALEO_TBE_CONFIG_JSON": json.dumps(invalid_config)}), \
                 patch.object(crawler, "_request") as request:
                result = crawler.scrape_source(source_record())
                request.assert_not_called()
                self.assertEqual(result["status"], "blocked")
                self.assertFalse(result["complete"])
        self.assertEqual(crawler._content_request_count, 0)

    def test_authorized_feed_is_fetched_once_and_job_links_are_not_opened(self):
        session = _Session([_Response(rss_fixture())])
        rules = _Rules()
        patches = self._actual_request_patches(session, rules)
        with patch.dict(os.environ, {"TALENTOS_TALEO_TBE_CONFIG_JSON": config_json()}), patches[0], patches[1], patches[2], patches[3]:
            result = crawler.scrape_source(source_record())

        self.assertEqual(result["status"], "scraped")
        self.assertTrue(result["complete"])
        self.assertEqual(result["method"], "authorized_customer_rss:taleo-business-edition-v1")
        self.assertEqual(result["job_count"], 1)
        self.assertEqual(result["jobs"][0]["source_url"], JOB_URL)
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(session.calls[0][0], FEED_URL)
        self.assertFalse(session.calls[0][1]["allow_redirects"])
        self.assertEqual([url for _, url in rules.fetches], [FEED_URL])
        self.assertEqual(crawler._content_request_count, 1)
        self.assertNotIn(JOB_URL, [url for url, _ in session.calls])
        self.assertNotIn(FEED_URL, json.dumps(result))
        self.assertNotIn("private-authorization-reference", json.dumps(result))

    def test_unconfirmed_coverage_remains_partial_after_successful_parse(self):
        session = _Session([_Response(rss_fixture())])
        rules = _Rules()
        patches = self._actual_request_patches(session, rules)
        with patch.dict(os.environ, {"TALENTOS_TALEO_TBE_CONFIG_JSON": config_json(coverage=False)}), patches[0], patches[1], patches[2], patches[3]:
            result = crawler.scrape_source(source_record())

        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["complete"])
        self.assertEqual(result["job_count"], 1)
        self.assertTrue(any("full feed coverage is not confirmed" in note for note in result["notes"]))
        self.assertEqual(crawler._content_request_count, 1)

    def test_feed_redirects_cannot_escape_exact_feed_host_allowlist(self):
        session = _Session([_Response(status_code=302, headers={"Location": "https://other.example.test/feed.xml"}, redirect=True)])
        rules = _Rules()
        patches = self._actual_request_patches(session, rules)
        with patch.dict(os.environ, {"TALENTOS_TALEO_TBE_CONFIG_JSON": config_json()}), patches[0], patches[1], patches[2], patches[3]:
            result = crawler.scrape_source(source_record())

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["complete"])
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(crawler._content_request_count, 1)
        self.assertNotIn(FEED_URL, json.dumps(result))

    def test_feed_request_exception_is_sanitized_from_results(self):
        with patch.dict(os.environ, {"TALENTOS_TALEO_TBE_CONFIG_JSON": config_json()}), \
             patch.object(crawler, "_request", side_effect=RuntimeError(f"failed at {FEED_URL}; credential=private-secret-value")):
            result = crawler.scrape_source(source_record())

        serialized = json.dumps(result)
        self.assertEqual(result["status"], "error")
        self.assertNotIn(FEED_URL, serialized)
        self.assertNotIn("private-secret-value", serialized)
        self.assertNotIn("private-authorization-reference", serialized)


if __name__ == "__main__":
    unittest.main()
