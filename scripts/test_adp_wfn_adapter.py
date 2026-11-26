"""Offline contract tests for the permission-gated ADP WFN adapter."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import urllib.parse

import adp_wfn_adapter as adp
import employer_career_ingest as scraper


SOURCE_URL = "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=acme"
NORMALIZED_SOURCE_URL = scraper.normalize_source_url(SOURCE_URL)
EMPLOYER_KEYS = ["company_id:acme"]
# This synthetic long description only exercises parsing and completeness gates.
# It is not evidence of the WFN field semantics; production config must cite an
# independently reviewed, authorized sanitized tenant sample for confirmation.
DESCRIPTION = "Senior GIS Engineer. " + ("Design and maintain public mapping systems. " * 8)


def source_config(**overrides):
    config = {
        "product": "workforce_now",
        "employer_keys": EMPLOYER_KEYS,
        "authorization_confirmed": True,
        "authorization_reference": "approved-integration-record-123",
        "granted_scopes": [adp.READ_SCOPE],
        "job_description_field_confirmed": True,
        "candidate_url_field_confirmed": True,
        "tenant_client": "acme",
        "client_id": "test-client-id",
        "client_secret": "test-client-secret",
        "certificate_file": "C:/private/adp-client.pem",
        "private_key_file": "C:/private/adp-client.key",
        "candidate_hosts": ["workforcenow.adp.com"],
    }
    config.update(overrides)
    return config


def requisition(
    number: int,
    description: str = DESCRIPTION,
    *,
    host: str = "workforcenow.adp.com",
    query: str | None = None,
):
    candidate_query = query or f"client=acme&jobId={number}&source=CC3"
    return {
        "itemID": f"REQ-{number}",
        "clientRequisitionID": str(number),
        "visibleToJobSeekerIndicator": True,
        "externalIndicator": True,
        "job": {"jobTitle": f"GIS Engineer {number}"},
        "requisitionLocations": [{
            "address": {
                "cityName": "Austin",
                "countrySubdivisionLevel1": {"codeValue": "TX"},
                "countryCode": "US",
            },
        }],
        "postingInstructions": [{
            "externalIndicator": True,
            "postingChannel": {
                "nameCode": {"codeValue": "CC3", "shortName": "Default External Career Center"},
                "internetAddress": {"uri": f"https://{host}/jobs/apply/posting.html?{candidate_query}"},
                "externalIndicator": True,
                "defaultIndicator": True,
            },
            "nameCode": {"longName": f"<div><p>{description}</p></div>" if description is not None else None},
            "postDate": "2026-11-24T08:30:00Z",
        }],
    }


def response(rows, total):
    return SimpleNamespace(
        status_code=200,
        json=lambda: {"meta": {"totalNumber": total}, "jobRequisitions": rows},
    )


class AdpWfnAdapterTests(unittest.TestCase):
    def test_config_requires_exact_url_employer_set_and_authorization(self):
        serialized = json.dumps({NORMALIZED_SOURCE_URL: source_config()})
        valid = adp.load_source_config(NORMALIZED_SOURCE_URL, EMPLOYER_KEYS, serialized)
        self.assertIsNotNone(valid)
        self.assertEqual(valid["candidate_hosts"], ["workforcenow.adp.com"])
        external_host = json.dumps({NORMALIZED_SOURCE_URL: source_config(candidate_hosts=["careers.acme.example"])})
        external_config = adp.load_source_config(NORMALIZED_SOURCE_URL, EMPLOYER_KEYS, external_host)
        self.assertEqual(external_config["candidate_hosts"], ["careers.acme.example"])

        self.assertIsNone(adp.load_source_config(SOURCE_URL + "&other=1", EMPLOYER_KEYS, serialized))
        self.assertIsNone(adp.load_source_config(NORMALIZED_SOURCE_URL, ["company_id:other"], serialized))
        for overrides in (
            {"authorization_confirmed": False},
            {"granted_scopes": ["jobRequisition.read"]},
            {"granted_scopes": []},
            {"job_description_field_confirmed": False},
            {"candidate_url_field_confirmed": False},
            {"authorization_reference": ""},
            {"candidate_hosts": ["*.adp.com"]},
        ):
            with self.subTest(overrides=overrides):
                raw = json.dumps({NORMALIZED_SOURCE_URL: source_config(**overrides)})
                self.assertIsNone(adp.load_source_config(NORMALIZED_SOURCE_URL, EMPLOYER_KEYS, raw))

    def test_only_known_wfn_source_route_forms_are_configurable(self):
        self.assertTrue(adp.is_wfn_source_url(SOURCE_URL))
        for unsupported in (
            "https://jobs.adp.com/mascsr/default/mdf/recruitment/recruitment.html",
            "https://workforcenow.adp.com/careers",
            "http://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html",
        ):
            with self.subTest(unsupported=unsupported):
                raw = json.dumps({unsupported: source_config()})
                self.assertIsNone(adp.load_source_config(unsupported, EMPLOYER_KEYS, raw))

    def test_scrape_source_holds_adp_without_exact_authorized_configuration(self):
        source = {
            "url": SOURCE_URL,
            "normalized_url": NORMALIZED_SOURCE_URL,
            "source_urls": [SOURCE_URL],
            "evidence_urls": [],
            "employers": ["Acme Inc."],
            "employer_keys": EMPLOYER_KEYS,
        }
        with patch.dict("os.environ", {"TALENTOS_ADP_WFN_CONFIG_JSON": "{}"}), patch.object(scraper, "_request") as request:
            result = scraper.scrape_source(source)
        request.assert_not_called()
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["method"], "policy_hold")
        self.assertFalse(result["complete"])

    def test_scrape_source_dispatches_only_after_exact_authorized_configuration(self):
        source = {
            "url": SOURCE_URL,
            "normalized_url": NORMALIZED_SOURCE_URL,
            "source_urls": [SOURCE_URL],
            "evidence_urls": [],
            "employers": ["Acme Inc."],
            "employer_keys": EMPLOYER_KEYS,
        }
        serialized = json.dumps({NORMALIZED_SOURCE_URL: source_config()})
        with patch.dict("os.environ", {"TALENTOS_ADP_WFN_CONFIG_JSON": serialized}), patch.object(
            scraper, "fetch_adp_wfn_jobs", return_value=([{"title": "GIS Engineer"}], True, [])
        ) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once()
        self.assertEqual(adapter.call_args.args[:2], (SOURCE_URL, "Acme Inc."))
        self.assertEqual(result["method"], "authorized_customer_api:adp-wfn-job-requisitions-v1")
        self.assertTrue(result["complete"])

    def test_pages_at_twenty_and_verifies_total_and_public_job_details(self):
        first_page = [requisition(number) for number in range(1, 21)]
        second_page = [requisition(21)]
        session = SimpleNamespace(
            cert=None,
            post=Mock(return_value=SimpleNamespace(status_code=200, json=lambda: {"access_token": "offline-test-token"})),
            close=Mock(),
        )
        get_request = Mock(side_effect=[response(first_page, 21), response(second_page, 21)])
        with patch.object(adp.requests, "Session", return_value=session):
            jobs, complete, notes = adp.fetch_jobs(
                SOURCE_URL,
                "Acme Inc.",
                source_config(),
                request_get=get_request,
                clean_description=scraper._clean_description,
            )

        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 21)
        self.assertEqual(jobs[0]["external_job_id"], "REQ-1")
        self.assertEqual(jobs[0]["company"], "Acme Inc.")
        self.assertEqual(jobs[0]["location"], "Austin, TX, US")
        self.assertGreater(len(jobs[0]["description_text"]), 200)
        self.assertEqual(jobs[-1]["source_url"], "https://workforcenow.adp.com/jobs/apply/posting.html?client=acme&jobId=21&source=CC3")
        self.assertEqual(session.cert, ("C:/private/adp-client.pem", "C:/private/adp-client.key"))

        offsets = []
        for call in get_request.call_args_list:
            query = urllib.parse.parse_qs(urllib.parse.urlparse(call.args[0]).query)
            self.assertFalse(call.kwargs["check_robots"])
            self.assertTrue(call.kwargs["count_content_request"])
            self.assertEqual(query["$top"], ["20"])
            self.assertIn("visibleToJobSeekerIndicator eq true", query["$filter"][0])
            self.assertIn("externalIndicator eq true", query["$filter"][0])
            offsets.append(query["$skip"][0])
        self.assertEqual(offsets, ["0", "20"])
        session.close.assert_called_once()

    def test_short_description_keeps_source_incomplete(self):
        session = SimpleNamespace(
            cert=None,
            post=Mock(return_value=SimpleNamespace(status_code=200, json=lambda: {"access_token": "offline-test-token"})),
            close=Mock(),
        )
        get_request = Mock(return_value=response([requisition(1, "Short text")], 1))
        with patch.object(adp.requests, "Session", return_value=session):
            jobs, complete, notes = adp.fetch_jobs(
                SOURCE_URL,
                "Acme Inc.",
                source_config(),
                request_get=get_request,
                clean_description=scraper._clean_description,
            )
        self.assertFalse(complete)
        self.assertEqual(len(jobs), 1)
        self.assertTrue(any("full description" in note for note in notes))

    def test_unapproved_candidate_host_is_not_emitted(self):
        session = SimpleNamespace(
            cert=None,
            post=Mock(return_value=SimpleNamespace(status_code=200, json=lambda: {"access_token": "offline-test-token"})),
            close=Mock(),
        )
        get_request = Mock(return_value=response([requisition(1, host="other.adp.com")], 1))
        with patch.object(adp.requests, "Session", return_value=session):
            jobs, complete, notes = adp.fetch_jobs(
                SOURCE_URL,
                "Acme Inc.",
                source_config(),
                request_get=get_request,
                clean_description=scraper._clean_description,
            )
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertTrue(any("allowlisted external job URL" in note for note in notes))

    def test_duplicate_or_ambiguous_client_and_job_id_query_keys_are_rejected(self):
        for query in (
            "client=acme&client=other&jobId=1&source=CC3",
            "client=acme&jobId=1&JOBID=2&source=CC3",
        ):
            with self.subTest(query=query):
                session = SimpleNamespace(
                    cert=None,
                    post=Mock(return_value=SimpleNamespace(status_code=200, json=lambda: {"access_token": "offline-test-token"})),
                    close=Mock(),
                )
                get_request = Mock(return_value=response([requisition(1, query=query)], 1))
                with patch.object(adp.requests, "Session", return_value=session):
                    jobs, complete, notes = adp.fetch_jobs(
                        SOURCE_URL,
                        "Acme Inc.",
                        source_config(),
                        request_get=get_request,
                        clean_description=scraper._clean_description,
                    )
                self.assertFalse(complete)
                self.assertEqual(jobs, [])
                self.assertTrue(any("allowlisted external job URL" in note for note in notes))

    def test_authorized_data_get_marks_adp_run_as_content_fetch_started(self):
        payload = {"meta": {"totalNumber": 1}, "jobRequisitions": [requisition(1)]}
        body = json.dumps(payload).encode("utf-8")

        class RawBody:
            def read(self, _size, *, decode_content=True):
                return body

        class ApiResponse:
            status_code = 200
            headers = {}
            is_redirect = False
            is_permanent_redirect = False
            raw = RawBody()

            def __init__(self):
                self.closed = False

            def json(self):
                return payload

            def close(self):
                self.closed = True

        class Session:
            cert = None

            def __init__(self):
                self.post_calls = []
                self.get_calls = []
                self.response = ApiResponse()

            def post(self, url, **kwargs):
                self.post_calls.append((url, kwargs))
                return SimpleNamespace(status_code=200, json=lambda: {"access_token": "offline-test-token"})

            def get(self, url, **kwargs):
                self.get_calls.append((url, kwargs))
                return self.response

            def close(self):
                pass

        source = {
            "url": SOURCE_URL,
            "normalized_url": NORMALIZED_SOURCE_URL,
            "source_urls": [SOURCE_URL],
            "evidence_urls": [],
            "employers": ["Acme Inc."],
            "employer_keys": EMPLOYER_KEYS,
        }
        session = Session()
        serialized = json.dumps({NORMALIZED_SOURCE_URL: source_config()})
        with patch.dict("os.environ", {"TALENTOS_ADP_WFN_CONFIG_JSON": serialized}), \
             patch.object(adp.requests, "Session", return_value=session), \
             patch.object(scraper, "_public_https_url", side_effect=lambda value: urllib.parse.urlparse(value)), \
             patch.object(scraper, "_minimum_host_gap", return_value=0), \
             patch.object(scraper, "_shared_host_rate_dir", None), \
             patch.object(scraper, "_content_request_count", 0), \
             patch.dict(scraper._last_host_request, {}, clear=True), \
             patch.object(scraper.time, "sleep"):
            result = scraper.scrape_source(source)
            content_request_count = scraper._content_request_count
            content_fetch_started = content_request_count > 0

        self.assertEqual(result["status"], "scraped")
        self.assertEqual(result["job_count"], 1)
        self.assertEqual(content_request_count, 1)
        self.assertTrue(content_fetch_started)
        self.assertEqual(len(session.post_calls), 1)  # OAuth does not increment the data-fetch counter.
        self.assertEqual(len(session.get_calls), 1)
        self.assertTrue(session.response.closed)


if __name__ == "__main__":
    unittest.main()
