"""Offline contract tests for the permission-gated Jobvite customer feed."""
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import urllib.parse

import employer_career_ingest as scraper
import jobvite_customer_feed as jobvite


SOURCE_URL = "https://jobs.jobvite.com/acme"
NORMALIZED_URL = scraper.normalize_source_url(SOURCE_URL)
EMPLOYER_KEYS = ["company_id:acme"]
DESCRIPTION = "Senior engineer. " + ("Design, build, and support reliable customer systems. " * 8)


def source_config(**overrides):
    config = {
        "career_site_name": "acme",
        "employer_keys": EMPLOYER_KEYS,
        "api_key": "offline-api-key",
        "api_secret": "offline-api-secret",
        "authorization_confirmed": True,
        "feed_contract_reference": "contract-ref-2026-01",
        "paid_feed_contract_confirmed": True,
        "talentos_reuse_grant_confirmed": True,
        "talentos_reuse_grant_reference": "reuse-grant-ref-2026-01",
        "all_matching_jobs_single_response_confirmed": True,
        "single_response_contract_reference": "feed-coverage-ref-2026-01",
        "full_description_field_confirmed": True,
        "full_description_contract_reference": "full-description-ref-2026-01",
    }
    config.update(overrides)
    return config


def config_map(**overrides):
    return json.dumps({NORMALIZED_URL: source_config(**overrides)})


def job_record(job_id="JV-100", *, description=DESCRIPTION, detail_url=None, apply_url=None, **overrides):
    row = {
        "title": "Senior Engineer",
        "description": description,
        "eId": job_id,
        "jobState": "Open",
        "postingType": "External",
        "distribution": True,
        "detailLink": detail_url or f"https://app.jobvite.com/CompanyJobs/Job.aspx?j={job_id}",
        "applyLink": apply_url or f"https://app.jobvite.com/CompanyJobs/Careers.aspx?k=Apply&j={job_id}",
        "location": "Austin, Texas",
        "lastUpdatedDate": 1795500000000,
    }
    row.update(overrides)
    return row


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self.encoding = "utf-8"
        self._body = json.dumps(payload).encode("utf-8")
        self.closed = False

    def iter_content(self, chunk_size):
        yield self._body

    def close(self):
        self.closed = True


class JobviteCustomerFeedTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.budget_db = str(Path(self.temp_dir.name) / "jobvite-budget.sqlite3")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_config_requires_exact_source_employer_set_and_all_authorization_evidence(self):
        config = jobvite.load_source_config(NORMALIZED_URL, EMPLOYER_KEYS, config_map(), self.budget_db)
        self.assertIsNotNone(config)
        self.assertEqual(config["career_site_name"], "acme")
        self.assertEqual(config["employer_keys"], EMPLOYER_KEYS)
        self.assertNotIn("api_secret", json.dumps({key: value for key, value in config.items() if key.endswith("reference")}))

        self.assertIsNone(jobvite.load_source_config(NORMALIZED_URL, ["company_id:other"], config_map(), self.budget_db))
        self.assertIsNone(jobvite.load_source_config("https://jobs.jobvite.com/acme/job/JV-100", EMPLOYER_KEYS, config_map(), self.budget_db))
        self.assertIsNone(jobvite.load_source_config(NORMALIZED_URL, EMPLOYER_KEYS, config_map(talentos_reuse_grant_confirmed=False), self.budget_db))
        self.assertIsNone(jobvite.load_source_config(NORMALIZED_URL, EMPLOYER_KEYS, config_map(paid_feed_contract_confirmed=False), self.budget_db))
        self.assertIsNone(jobvite.load_source_config(NORMALIZED_URL, EMPLOYER_KEYS, config_map(all_matching_jobs_single_response_confirmed=False), self.budget_db))
        self.assertIsNone(jobvite.load_source_config(NORMALIZED_URL, EMPLOYER_KEYS, config_map(full_description_field_confirmed=False), self.budget_db))
        self.assertIsNone(jobvite.load_source_config(NORMALIZED_URL, EMPLOYER_KEYS, config_map(career_site_name="other"), self.budget_db))
        self.assertIsNone(jobvite.load_source_config(NORMALIZED_URL, EMPLOYER_KEYS, config_map(), "relative/jobvite.sqlite3"))

    def test_unconfigured_public_jobvite_source_is_held_without_network_requests(self):
        source = {
            "url": SOURCE_URL,
            "normalized_url": NORMALIZED_URL,
            "source_urls": [SOURCE_URL],
            "evidence_urls": [],
            "employers": ["Acme"],
            "employer_keys": EMPLOYER_KEYS,
        }
        with patch.dict("os.environ", {
            "TALENTOS_JOBVITE_FEED_CONFIG_JSON": "",
            "TALENTOS_JOBVITE_CALL_BUDGET_DB": self.budget_db,
        }), patch.object(scraper, "_request") as page_request, patch.object(jobvite.requests, "get") as api_request:
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["method"], "policy_hold")
        self.assertFalse(result["complete"])
        self.assertIn("paid feed access", result["error"])
        page_request.assert_not_called()
        api_request.assert_not_called()

    def test_authorized_full_feed_uses_one_filtered_request_and_maps_jobs(self):
        source = {
            "url": SOURCE_URL,
            "normalized_url": NORMALIZED_URL,
            "source_urls": [SOURCE_URL],
            "evidence_urls": [],
            "employers": ["Acme Inc."],
            "employer_keys": EMPLOYER_KEYS,
        }
        response = FakeResponse([job_record()])
        with patch.dict("os.environ", {
            "TALENTOS_JOBVITE_FEED_CONFIG_JSON": config_map(),
            "TALENTOS_JOBVITE_CALL_BUDGET_DB": self.budget_db,
        }), patch.object(scraper, "_content_request_count", 0), patch.object(
            jobvite.requests, "get", return_value=response
        ) as api_request:
            result = scraper.scrape_source(source)
            content_fetch_started = scraper._content_request_count > 0
            self.assertEqual(scraper._content_request_count, 1)

        self.assertEqual(result["status"], "scraped")
        self.assertEqual(result["method"], "authorized_customer_api:jobvite-job-feed-v2")
        self.assertTrue(result["complete"], result["notes"])
        self.assertTrue(content_fetch_started)  # the run's content_fetch_started condition
        self.assertEqual(result["job_count"], 1)
        role = result["jobs"][0]
        self.assertEqual(role["external_job_id"], "JV-100")
        self.assertEqual(role["source_url"], "https://app.jobvite.com/CompanyJobs/Job.aspx?j=JV-100")
        self.assertEqual(role["raw"]["apply_url"], "https://app.jobvite.com/CompanyJobs/Careers.aspx?k=Apply&j=JV-100")
        self.assertNotIn("offline-api-key", json.dumps(result))
        self.assertNotIn("offline-api-secret", json.dumps(result))
        api_request.assert_called_once()
        args, kwargs = api_request.call_args
        self.assertEqual(args[0], jobvite.API_URL)
        self.assertEqual(kwargs["params"], {
            "api": "offline-api-key", "sc": "offline-api-secret",
            "jobStatus": "Open", "availableTo": "External",
        })
        self.assertFalse(kwargs["allow_redirects"])
        self.assertTrue(kwargs["stream"])
        self.assertTrue(response.closed)

    def test_content_request_callback_runs_after_budget_reservation_and_before_api_get(self):
        events = []

        def reserve(*_args, **_kwargs):
            events.append("reserve")
            return True

        def record_content_request():
            events.append("record")

        def fake_get(*_args, **_kwargs):
            events.append("get")
            return FakeResponse([job_record()])

        with patch.object(jobvite, "reserve_daily_call", side_effect=reserve), \
             patch.object(jobvite.requests, "get", side_effect=fake_get):
            jobs, complete, notes = jobvite.fetch_jobs(
                SOURCE_URL,
                "Acme Inc.",
                {**source_config(), "budget_db_path": self.budget_db},
                clean_description=scraper._clean_description,
                record_content_request=record_content_request,
            )
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(events, ["reserve", "record", "get"])

    def test_content_request_callback_is_not_called_for_exhausted_budget_or_fixture_payload(self):
        callback = Mock()
        with patch.object(jobvite, "reserve_daily_call", return_value=False), \
             patch.object(jobvite.requests, "get") as api_request:
            with self.assertRaisesRegex(jobvite.JobviteAdapterError, "budget exhausted"):
                jobvite.fetch_jobs(
                    SOURCE_URL,
                    "Acme Inc.",
                    {**source_config(), "budget_db_path": self.budget_db},
                    clean_description=scraper._clean_description,
                    record_content_request=callback,
                )
        callback.assert_not_called()
        api_request.assert_not_called()

        jobs, complete, notes = jobvite.fetch_jobs(
            SOURCE_URL,
            "Acme Inc.",
            {**source_config(), "budget_db_path": self.budget_db},
            clean_description=scraper._clean_description,
            feed_payload=[job_record()],
            record_content_request=callback,
        )
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        callback.assert_not_called()

    def test_feed_uses_documented_distribution_filter_and_requires_complete_valid_rows(self):
        payload = [
            job_record("JV-100"),
            job_record("JV-NOT-DISTRIBUTED", distribution=False),
        ]
        jobs, complete, notes = jobvite.fetch_jobs(
            SOURCE_URL,
            "Acme Inc.",
            {**source_config(), "budget_db_path": self.budget_db},
            clean_description=scraper._clean_description,
            feed_payload=payload,
        )
        self.assertTrue(complete, notes)
        self.assertEqual([job["external_job_id"] for job in jobs], ["JV-100"])

        incomplete_cases = [
            ([job_record(jobState="Filled")], "requested open external filter"),
            ([job_record(postingType="Internal")], "requested open external filter"),
            ([job_record(description="too short")], "full description"),
            ([job_record(detail_url="https://jobs.jobvite.com/acme/job/OTHER", apply_url="https://jobs.jobvite.com/acme/job/OTHER/apply")], "valid Jobvite detail/apply URL"),
            ([job_record("JV-DUP"), job_record("JV-DUP")], "duplicate job ID"),
            (["not a job row"], "not a job object"),
        ]
        for feed, expected_note in incomplete_cases:
            with self.subTest(expected_note=expected_note):
                jobs, complete, notes = jobvite.fetch_jobs(
                    SOURCE_URL,
                    "Acme Inc.",
                    {**source_config(), "budget_db_path": self.budget_db},
                    clean_description=scraper._clean_description,
                    feed_payload=feed,
                )
                self.assertFalse(complete)
                self.assertTrue(any(expected_note in note for note in notes), notes)

    def test_daily_call_budget_is_atomic_and_resets_by_utc_day(self):
        today = datetime(2026, 11, 26, 10, 0, tzinfo=timezone.utc)
        self.assertTrue(jobvite.reserve_daily_call(self.budget_db, "test-key", "test-secret", now=today, max_calls=2))
        self.assertTrue(jobvite.reserve_daily_call(self.budget_db, "test-key", "test-secret", now=today, max_calls=2))
        self.assertFalse(jobvite.reserve_daily_call(self.budget_db, "test-key", "test-secret", now=today, max_calls=2))
        next_day = datetime(2026, 11, 27, 0, 1, tzinfo=timezone.utc)
        self.assertTrue(jobvite.reserve_daily_call(self.budget_db, "test-key", "test-secret", now=next_day, max_calls=2))

    def test_budget_exhaustion_fails_before_api_request(self):
        today = datetime.now(timezone.utc)
        for _ in range(jobvite.MAX_CALLS_PER_UTC_DAY):
            self.assertTrue(jobvite.reserve_daily_call(
                self.budget_db, "offline-api-key", "offline-api-secret", now=today,
            ))
        with patch.object(jobvite.requests, "get") as api_request:
            with self.assertRaisesRegex(jobvite.JobviteAdapterError, "budget exhausted"):
                jobvite.fetch_jobs(
                    SOURCE_URL,
                    "Acme Inc.",
                    {**source_config(), "budget_db_path": self.budget_db},
                    clean_description=scraper._clean_description,
                )
        api_request.assert_not_called()

    def test_request_failure_does_not_leak_query_credentials(self):
        source = {
            "url": SOURCE_URL,
            "normalized_url": NORMALIZED_URL,
            "source_urls": [SOURCE_URL],
            "evidence_urls": [],
            "employers": ["Acme Inc."],
            "employer_keys": EMPLOYER_KEYS,
        }
        with patch.dict("os.environ", {
            "TALENTOS_JOBVITE_FEED_CONFIG_JSON": config_map(),
            "TALENTOS_JOBVITE_CALL_BUDGET_DB": self.budget_db,
        }), patch.object(jobvite.requests, "get", side_effect=jobvite.requests.RequestException(
            "request failed at https://api.jobvite.com/?sc=offline-api-secret"
        )):
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "error")
        self.assertNotIn("offline-api-key", result["error"])
        self.assertNotIn("offline-api-secret", result["error"])
        self.assertEqual(result["error"], "Jobvite Job Feed API request failed")

        with patch.dict("os.environ", {
            "TALENTOS_JOBVITE_FEED_CONFIG_JSON": config_map(),
            "TALENTOS_JOBVITE_CALL_BUDGET_DB": self.budget_db,
        }), patch.object(jobvite.requests, "get", return_value=FakeResponse({"error": "offline-api-secret"}, 500)):
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"], "Jobvite Job Feed API returned HTTP 500")
        self.assertNotIn("offline-api-secret", result["error"])


if __name__ == "__main__":
    unittest.main()
