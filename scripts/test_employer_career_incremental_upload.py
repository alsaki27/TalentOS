"""Offline checks for the permission-gated employer job uploader."""
import csv
import json
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

import requests

import employer_career_incremental_upload as uploader


SOURCE_URL = "https://careers.example.test/careers"
RUN_ID = "69b9b723-b772-4b9e-b42f-710f3ac9b731"


def write_manifest(path: Path, *, status: str = "approved", url: str = SOURCE_URL) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=[
            "normalized_url", "permission_status", "collection_scope", "permission_evidence_ref",
            "reviewed_at_utc", "reviewed_by", "expires_at_utc",
        ])
        writer.writeheader()
        writer.writerow({
            "normalized_url": url,
            "permission_status": status,
            "collection_scope": "job_listings_and_details" if status == "approved" else "",
            "permission_evidence_ref": "private:approval-record" if status == "approved" else "",
            "reviewed_at_utc": "2026-01-01T00:00:00Z" if status == "approved" else "",
            "reviewed_by": "reviewer" if status == "approved" else "",
            "expires_at_utc": "2099-01-01T00:00:00Z" if status == "approved" else "",
        })


def make_job(index: int) -> dict:
    return {
        "title": f"Engineer {index}",
        "company": "Example Company",
        "location": "Boston, MA",
        "source_url": f"https://careers.example.test/jobs/{index}",
        "external_job_id": f"career:example:{index}",
        "description_text": "A complete job description with responsibilities, qualifications, work conditions and benefits. " * 4,
        "raw": {
            "source": uploader.SOURCE,
            "career_source_url": SOURCE_URL,
            "employer_keys": ["company:example-1"],
            "adapter_version": uploader.CURRENT_ADAPTER_VERSION,
        },
    }


def write_jobs(path: Path, jobs: list[dict]) -> None:
    path.write_text("".join(json.dumps(job) + "\n" for job in jobs), encoding="utf-8")


class FakeResponse:
    def __init__(self, body: dict, status_code: int = 200):
        self.body = body
        self.status_code = status_code
        self.text = ""

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self.body


class FakeSession:
    def __init__(self, *, seen=None, fail_post_at=None, fail_dispatch=False, run_status="completed"):
        self.seen = set(seen or [])
        self.fail_post_at = fail_post_at
        self.fail_dispatch = fail_dispatch
        self.run_status = run_status
        self.get_calls = []
        self.post_calls = []

    def get(self, url, *, params=None, headers=None, timeout=None):
        self.get_calls.append((url, params, headers))
        if url.endswith("/seen-external-ids"):
            return FakeResponse({"source": uploader.SOURCE, "external_job_ids": sorted(self.seen), "count": len(self.seen)})
        if "/runs/" in url:
            return FakeResponse({
                "run": {"id": RUN_ID, "status": self.run_status, "logged_count": 1, "last_error": None},
                "stages": [{"stage": "logged", "count": "1"}],
                "needsDispatch": self.run_status != "completed",
            })
        raise AssertionError(f"unexpected GET path: {url}")

    def post(self, url, *, json=None, params=None, headers=None, timeout=None):
        self.post_calls.append((url, json, params, headers))
        if url.endswith("/api/job-ceo/dispatch"):
            if self.fail_dispatch:
                raise requests.Timeout("fixture dispatch timeout")
            return FakeResponse({"runId": RUN_ID, "needsDispatch": False, "stage": "completed", "count": 0})
        if url.endswith("/api/job-ceo/ingest"):
            call_index = len([call for call in self.post_calls if call[0].endswith("/api/job-ceo/ingest")])
            if self.fail_post_at is not None and call_index >= self.fail_post_at:
                raise requests.Timeout("fixture timeout")
            jobs = json["jobs"]
            return FakeResponse({"runId": RUN_ID, "staged": len(jobs), "skipped": 0, "total_received": len(jobs), "dispatch_deferred": json["deferDispatch"]})
        raise AssertionError(f"unexpected POST path: {url}")


class IncrementalUploaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest = self.root / "permissions.csv"
        self.jobs_path = self.root / "ready_jobs.jsonl"
        self.state_path = self.root / "upload-state.json"
        write_manifest(self.manifest)
        write_jobs(self.jobs_path, [make_job(1), make_job(2)])

    def tearDown(self):
        self.temp.cleanup()

    def test_load_ready_jobs_requires_exact_approved_source_and_quality_fields(self):
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(plan["approved_source_url_count"], 1)
        self.assertEqual(plan["unique_job_rows"], 2)

    def test_ingest_response_must_account_for_every_batch_row(self):
        for staged, skipped in ((0, 0), (0, 1), (3, 0)):
            with self.subTest(staged=staged, skipped=skipped):
                response = FakeResponse({
                    "runId": RUN_ID,
                    "staged": staged,
                    "skipped": skipped,
                    "total_received": 2,
                    "dispatch_deferred": True,
                })
                with self.assertRaisesRegex(uploader.UploadError, "invalid staged/skipped counts"):
                    uploader._validate_response(response, 2)

    def test_rejects_readiness_payload_from_previous_adapter_version(self):
        version_prefix, separator, current_number = uploader.CURRENT_ADAPTER_VERSION.rpartition("v")
        self.assertEqual(separator, "v")
        self.assertTrue(current_number.isdigit())
        previous_version = f"{version_prefix}v{int(current_number) - 1}"
        jobs = [make_job(1)]
        jobs[0]["raw"]["adapter_version"] = previous_version
        write_jobs(self.jobs_path, jobs)
        with self.assertRaisesRegex(uploader.UploadError, f"expected {uploader.CURRENT_ADAPTER_VERSION}"):
            uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)

    def test_unapproved_source_stops_before_any_upload(self):
        write_manifest(self.manifest, status="pending")
        with self.assertRaisesRegex(uploader.UploadError, "exact-source permission"):
            uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)

    def test_ready_payload_from_unapproved_url_fails_closed(self):
        jobs = [make_job(1)]
        jobs[0]["raw"]["career_source_url"] = "https://other.example.test/careers"
        write_jobs(self.jobs_path, jobs)
        with self.assertRaisesRegex(uploader.UploadError, "exact-source permission"):
            uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)

    def test_historical_ready_payload_on_held_aggregator_is_rejected_even_with_manifest_approval(self):
        aggregator = "https://www.indeed.com/career/example"
        write_manifest(self.manifest, url=aggregator)
        jobs = [make_job(1)]
        jobs[0]["source_url"] = "https://www.indeed.com/viewjob?jk=123"
        jobs[0]["raw"]["career_source_url"] = aggregator
        write_jobs(self.jobs_path, jobs)
        with self.assertRaisesRegex(uploader.UploadError, "policy-held"):
            uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)

    def test_dry_run_makes_no_requests_and_writes_no_state(self):
        with patch("sys.stdout.write"):
            result = uploader.run_cli([
                "--jobs", str(self.jobs_path), "--permission-manifest", str(self.manifest),
                "--state", str(self.state_path),
            ])
        self.assertEqual(result, 0)
        self.assertFalse(self.state_path.exists())

    def test_upload_checks_seen_ids_and_only_posts_unseen_jobs(self):
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        session = FakeSession(seen={"career:example:1"})
        result = uploader.upload_ready_jobs(jobs, plan, base_url="https://talentos.example", secret="test-secret", state_path=self.state_path, session=session)
        ingest_calls = [call for call in session.post_calls if call[0].endswith("/api/job-ceo/ingest")]
        self.assertEqual(len(ingest_calls), 1)
        self.assertIs(ingest_calls[0][1]["deferDispatch"], True)
        self.assertEqual([job["external_job_id"] for job in ingest_calls[0][1]["jobs"]], ["career:example:2"])
        self.assertEqual(result["status"], "staged")
        self.assertEqual(result["staged_count"], 1)
        self.assertEqual(result["run_id"], RUN_ID)
        self.assertNotIn("Example Company", self.state_path.read_text(encoding="utf-8"))

    def test_upload_batches_and_reuses_same_run_id(self):
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        jobs = [make_job(i) for i in range(1, 102)]
        write_jobs(self.jobs_path, jobs)
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        session = FakeSession()
        with patch.object(uploader, "BATCH_SIZE", 100):
            result = uploader.upload_ready_jobs(jobs, plan, base_url="https://talentos.example", secret="test-secret", state_path=self.state_path, session=session)
        calls = [call for call in session.post_calls if call[0].endswith("/api/job-ceo/ingest")]
        self.assertEqual([len(call[1]["jobs"]) for call in calls], [100, 1])
        self.assertNotIn("runId", calls[0][1])
        self.assertEqual(calls[1][1]["runId"], RUN_ID)
        self.assertTrue(all(call[1]["deferDispatch"] is True for call in calls))
        self.assertFalse(any(call[0].endswith("/api/job-ceo/dispatch") for call in session.post_calls))
        self.assertEqual(result["batch_count"], 2)
        self.assertEqual(result["next_batch_index"], 2)

        resumed_before_dispatch = FakeSession()
        staged_resume = uploader.upload_ready_jobs(
            jobs, plan, base_url="https://talentos.example", secret="test-secret",
            state_path=self.state_path, session=resumed_before_dispatch,
        )
        self.assertEqual(staged_resume["status"], "staged")
        self.assertEqual(resumed_before_dispatch.get_calls, [])
        self.assertEqual(resumed_before_dispatch.post_calls, [])

        dispatched = uploader.dispatch_run_once(
            RUN_ID, base_url="https://talentos.example", cron_secret="cron-test",
            state_path=self.state_path, session=session,
        )
        self.assertEqual(dispatched["status"], "dispatched")
        dispatch_calls = [call for call in session.post_calls if call[0].endswith("/api/job-ceo/dispatch")]
        self.assertEqual(len(dispatch_calls), 1)
        self.assertEqual(dispatch_calls[0][2], {"runId": RUN_ID})

        # A resume after a confirmed dispatch is idempotent and cannot dispatch twice.
        resumed = uploader.dispatch_run_once(
            RUN_ID, base_url="https://talentos.example", cron_secret="cron-test",
            state_path=self.state_path, session=session,
        )
        self.assertEqual(resumed["status"], "dispatched")
        self.assertEqual(len([call for call in session.post_calls if call[0].endswith("/api/job-ceo/dispatch")]), 1)

    def test_known_run_resumes_failed_batch_without_restarting_first_batch(self):
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        jobs = [make_job(i) for i in range(1, 102)]
        write_jobs(self.jobs_path, jobs)
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        failing = FakeSession(fail_post_at=2)
        with patch.object(uploader, "BATCH_SIZE", 100), patch.object(uploader.time, "sleep"):
            with self.assertRaisesRegex(uploader.UploadError, "batch failed after retries"):
                uploader.upload_ready_jobs(jobs, plan, base_url="https://talentos.example", secret="test-secret", state_path=self.state_path, session=failing)
        state = uploader.load_state(self.state_path)
        self.assertEqual(state["active_run"]["run_id"], RUN_ID)
        self.assertEqual(state["active_run"]["next_batch_index"], 1)
        self.assertEqual(state["active_run"]["status"], "upload_error")

        resumed = FakeSession()
        with patch.object(uploader, "BATCH_SIZE", 100):
            result = uploader.upload_ready_jobs(jobs, plan, base_url="https://talentos.example", secret="test-secret", state_path=self.state_path, session=resumed)
        calls = [call for call in resumed.post_calls if call[0].endswith("/api/job-ceo/ingest")]
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(calls[0][1]["jobs"]), 1)
        self.assertEqual(calls[0][1]["runId"], RUN_ID)
        self.assertEqual(result["status"], "staged")
        self.assertFalse(any(call[0].endswith("/api/job-ceo/dispatch") for call in failing.post_calls))

    def test_dispatch_ambiguity_is_checkpointed_and_never_retried_blindly(self):
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        staged_session = FakeSession()
        staged = uploader.upload_ready_jobs(
            jobs, plan, base_url="https://talentos.example", secret="test-secret",
            state_path=self.state_path, session=staged_session,
        )
        self.assertEqual(staged["status"], "staged")

        failed_dispatch = FakeSession(fail_dispatch=True)
        with self.assertRaisesRegex(uploader.UploadError, "dispatch response is ambiguous"):
            uploader.dispatch_run_once(
                RUN_ID, base_url="https://talentos.example", cron_secret="cron-test",
                state_path=self.state_path, session=failed_dispatch,
            )
        self.assertEqual(uploader.load_state(self.state_path)["active_run"]["status"], "dispatch_ambiguous")

        resumed = FakeSession()
        with self.assertRaisesRegex(uploader.UploadError, "may already have been sent"):
            uploader.dispatch_run_once(
                RUN_ID, base_url="https://talentos.example", cron_secret="cron-test",
                state_path=self.state_path, session=resumed,
            )
        self.assertEqual(resumed.post_calls, [])

    def test_ambiguous_first_batch_response_is_checkpointed_without_retry(self):
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        session = FakeSession(fail_post_at=1)
        with self.assertRaisesRegex(uploader.UploadError, "response is ambiguous"):
            uploader.upload_ready_jobs(jobs, plan, base_url="https://talentos.example", secret="test-secret", state_path=self.state_path, session=session)
        state = uploader.load_state(self.state_path)
        self.assertEqual(state["active_run"]["status"], "ambiguous")
        self.assertIsNone(state["active_run"]["run_id"])
        self.assertEqual(len(session.post_calls), 1)

    def test_interrupted_first_batch_checkpoint_never_retries_blindly(self):
        jobs, plan = uploader.load_approved_ready_jobs(self.jobs_path, self.manifest)
        state = {
            "version": uploader.STATE_VERSION,
            "source": uploader.SOURCE,
            "active_run": {
                "ready_jobs_sha256": plan["ready_jobs_sha256"],
                "permission_manifest_sha256": plan["permission_manifest_sha256"],
                "candidate_external_ids": [job["external_job_id"] for job in jobs],
                "ready_count": len(jobs),
                "candidate_count": len(jobs),
                "next_batch_index": 0,
                "batch_count": 1,
                "run_id": None,
                "staged_count": 0,
                "server_skipped_count": 0,
                "status": "uploading",
            },
        }
        uploader.save_state(self.state_path, state)
        session = FakeSession()
        with self.assertRaisesRegex(uploader.UploadError, "may have been accepted"):
            uploader.upload_ready_jobs(jobs, plan, base_url="https://talentos.example", secret="test-secret", state_path=self.state_path, session=session)
        saved = uploader.load_state(self.state_path)
        self.assertEqual(saved["active_run"]["status"], "ambiguous")
        self.assertEqual(session.get_calls, [])
        self.assertEqual(session.post_calls, [])

    def test_drive_and_verify_reports_logged_count_for_exact_run(self):
        session = FakeSession()
        result = uploader.drive_and_verify_run(RUN_ID, base_url="https://talentos.example", cron_secret="cron-test", timeout_seconds=1, poll_seconds=0, session=session)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["logged_count"], 1)
        self.assertEqual(session.post_calls, [])
        self.assertEqual(session.get_calls[-1][0], f"https://talentos.example/api/job-ceo/runs/{RUN_ID}")


if __name__ == "__main__":
    unittest.main()
