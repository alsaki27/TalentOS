"""Offline integration checks for permission-gated NEOGOV customer feeds."""
from __future__ import annotations

import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import employer_career_ingest as crawler


SOURCE_URL = "https://www.governmentjobs.com/careers/example"
FEED_URL = "https://feeds.example.test/jobs/rss/123"
EMPLOYER_KEYS = ["company:101", "company:202"]
DESCRIPTION = (
    "Responsibilities include public service delivery, policy analysis, "
    "stakeholder coordination, careful records management, and clear written "
    "communication. Qualifications include relevant experience and strong "
    "judgment. "
) * 4


def source(url: str = SOURCE_URL) -> dict[str, object]:
    return {
        "url": url,
        "normalized_url": crawler.normalize_source_url(url),
        "source_urls": [url],
        "evidence_urls": [url],
        "employers": ["Example Agency"],
        "employer_keys": EMPLOYER_KEYS,
    }


def config_text(*, source_url: str = SOURCE_URL) -> str:
    entry = {
        "employer": "Example Agency",
        "employer_keys": EMPLOYER_KEYS,
        "authorization_confirmed": True,
        "talentos_reuse_confirmed": True,
        "written_permission_reference": "private-written-permission-ref",
        "talentos_reuse_grant_reference": "private-reuse-grant-ref",
        "sanitized_sample_confirmation": {
            "reference": "private-sanitized-sample-ref",
            "schema_confirmed": True,
            "full_description_confirmed": True,
            "full_feed_coverage_confirmed": True,
        },
        "feed_url": FEED_URL,
        "allowed_feed_hosts": ["feeds.example.test"],
        "allowed_job_hosts": ["www.governmentjobs.com"],
    }
    return json.dumps({crawler.normalize_source_url(source_url): entry})


def rss_payload() -> bytes:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>Customer Feed</title><item>
    <title>Public Works Analyst</title><link>https://www.governmentjobs.com/careers/example/jobs/42</link>
    <guid>req-42</guid><description><![CDATA[<p>{DESCRIPTION}</p>]]></description>
    </item></channel></rss>'''.encode("utf-8")


class NeogovCustomerRSSCrawlerTests(unittest.TestCase):
    def test_public_neogov_page_is_held_without_customer_feed_config(self):
        for url in (SOURCE_URL, "https://agency.schooljobs.com/careers/example"):
            with self.subTest(url=url), patch.dict(os.environ, {}, clear=False):
                os.environ.pop("TALENTOS_NEOGOV_RSS_CONFIG_JSON", None)
                with patch.object(crawler, "_request") as request:
                    result = crawler.scrape_source(source(url))
            request.assert_not_called()
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["method"], "policy_hold")
            self.assertFalse(result["complete"])
            self.assertEqual(result["jobs"], [])

    def test_customer_feed_is_fetched_only_from_configured_host(self):
        response = SimpleNamespace(status_code=200, content=rss_payload())
        with patch.dict(os.environ, {"TALENTOS_NEOGOV_RSS_CONFIG_JSON": config_text()}), patch.object(
            crawler, "_request", return_value=response,
        ) as request:
            result = crawler.scrape_source(source())

        request.assert_called_once_with(
            FEED_URL,
            check_robots=True,
            headers={"Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml"},
            allowed_hosts={"feeds.example.test"},
        )
        self.assertEqual(result["status"], "scraped")
        self.assertTrue(result["complete"])
        self.assertEqual(result["method"], "authorized_customer_rss:neogov-v1")
        self.assertEqual(result["job_count"], 1)
        job = result["jobs"][0]
        self.assertEqual(job["source_url"], "https://www.governmentjobs.com/careers/example/jobs/42")
        self.assertEqual(job["external_job_id"], "req-42")
        self.assertEqual(job["raw"]["career_source_url"], SOURCE_URL)

    def test_feed_failure_does_not_leak_private_feed_url(self):
        with patch.dict(os.environ, {"TALENTOS_NEOGOV_RSS_CONFIG_JSON": config_text()}), patch.object(
            crawler, "_request", side_effect=crawler.ScrapeFailure(f"feed fetch failed for {FEED_URL}"),
        ):
            result = crawler.scrape_source(source())

        self.assertEqual(result["status"], "error")
        self.assertNotIn(FEED_URL, result["error"])
        self.assertEqual(result["error"], "NEOGOV customer RSS request failed")


if __name__ == "__main__":
    unittest.main()
