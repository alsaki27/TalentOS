"""Offline tests for permission-gated scheduled employer crawls."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

import employer_career_ingest as crawler
import employer_career_scheduled_run as scheduled


class ScheduledEmployerCareerRunTests(unittest.TestCase):
    @staticmethod
    def _tracker(path: Path) -> Path:
        path.write_text(
            "employer_key,employer_name,career_page_status,career_page_url,evidence_url\n"
            "company_id:1,Example One,verified_official,https://one.example/careers/,https://one.example/about\n"
            "company_id:2,Example Two,verified_official,https://two.example/jobs,https://two.example/about\n"
            "company_id:3,Unverified,unresolved,https://three.example/careers,https://three.example\n",
            encoding="utf-8",
        )
        return path

    @staticmethod
    def _policy(path: Path, rows: list[dict[str, str]]) -> Path:
        fields = [
            "normalized_url", "permission_status", "collection_scope",
            "permission_evidence_ref", "reviewed_at_utc", "reviewed_by", "expires_at_utc",
        ]
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        return path

    @staticmethod
    def _approved(url: str, *, expiry: str = "") -> dict[str, str]:
        return {
            "normalized_url": url,
            "permission_status": "approved",
            "collection_scope": scheduled.APPROVED_SCOPE,
            "permission_evidence_ref": "private-ticket:CAREER-123",
            "reviewed_at_utc": "2026-11-13T12:00:00Z",
            "reviewed_by": "reviewer@example.test",
            "expires_at_utc": expiry,
        }

    @staticmethod
    def _successful_child_run(command: list[str], **_kwargs: object) -> CompletedProcess:
        input_path = Path(command[command.index("--input") + 1])
        output_path = Path(command[command.index("--output-dir") + 1]) / "run_summary.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        child_summary = {
            "started_at_utc": datetime.now(timezone.utc).isoformat(),
            "adapter_version": crawler.ADAPTER_VERSION,
            "tracker_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
            "status_counts_by_source_group": {"scraped": 1},
            "unique_source_groups_with_result": 1,
            "content_request_count": 1,
            "content_fetch_started": True,
            "ingest_post_phase_invoked": False,
            "jobs_staged": 0,
            "jobs_skipped": 0,
        }
        output_path.write_text(json.dumps(child_summary), encoding="utf-8")
        return CompletedProcess(args=command, returncode=0)

    def test_policy_approves_only_complete_unexpired_exact_url_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "permissions.csv"
            self._policy(path, [
                self._approved("https://one.example/careers"),
                {
                    "normalized_url": "https://two.example/jobs",
                    "permission_status": "pending",
                    "collection_scope": "",
                    "permission_evidence_ref": "",
                    "reviewed_at_utc": "",
                    "reviewed_by": "",
                    "expires_at_utc": "",
                },
                self._approved("https://expired.example/careers", expiry="2026-11-13T00:00:00Z"),
            ])
            approved, summary = scheduled.load_collection_policy(
                path,
                now=datetime(2026, 11, 14, tzinfo=timezone.utc),
            )
        self.assertEqual(approved, {"https://one.example/careers"})
        self.assertEqual(summary["approved_url_count"], 1)
        self.assertEqual(summary["expired_rows"], 1)

    def test_approved_row_without_scope_or_evidence_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "permissions.csv"
            row = self._approved("https://one.example/careers")
            row["permission_evidence_ref"] = ""
            self._policy(path, [row])
            with self.assertRaisesRegex(scheduled.PolicyManifestError, "permission_evidence_ref"):
                scheduled.load_collection_policy(path)

    def test_duplicate_normalized_policy_urls_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "permissions.csv"
            self._policy(path, [
                self._approved("https://one.example/careers/"),
                self._approved("https://one.example/careers"),
            ])
            with self.assertRaisesRegex(scheduled.PolicyManifestError, "duplicate normalized_url") as raised:
                scheduled.load_collection_policy(path)
            self.assertNotIn("https://one.example/careers", str(raised.exception))

    def test_filter_tracker_keeps_only_approved_verified_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root / "tracker.csv")
            filtered = root / "private-output" / "authorized.csv"
            summary = scheduled.filter_tracker_by_permission(
                tracker,
                {"https://one.example/careers"},
                filtered,
            )
            loaded = crawler.load_sources(filtered)
        self.assertEqual(summary["selected_source_groups"], 1)
        self.assertEqual(summary["selected_employer_key_count"], 1)
        self.assertEqual([source["employers"] for source in loaded], [["Example One"]])

    def test_pending_only_schedule_makes_no_content_requests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root / "tracker.csv")
            policy = self._policy(root / "permissions.csv", [{
                "normalized_url": "https://one.example/careers",
                "permission_status": "pending",
                "collection_scope": "",
                "permission_evidence_ref": "",
                "reviewed_at_utc": "",
                "reviewed_by": "",
                "expires_at_utc": "",
            }])
            output = root / "scheduled-output"
            argv = [
                "employer_career_scheduled_run.py",
                "--input", str(tracker),
                "--permission-manifest", str(policy),
                "--output-dir", str(output),
            ]
            with patch("sys.argv", argv), patch.object(scheduled.subprocess, "run") as run:
                self.assertEqual(scheduled.main(), 0)
                run.assert_not_called()
            summary = json.loads((output / "scheduled_run_summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["selected_sources"]["selected_source_groups"], 0)
        self.assertFalse(summary["content_fetch_started"])
        self.assertFalse(summary["ingest_post_phase_invoked"])

    def test_approved_schedule_invokes_checkpointed_crawler_without_ingest_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root / "tracker.csv")
            policy = self._policy(root / "permissions.csv", [self._approved("https://one.example/careers")])
            output = root / "scheduled-output"
            argv = [
                "employer_career_scheduled_run.py",
                "--input", str(tracker),
                "--permission-manifest", str(policy),
                "--output-dir", str(output),
            ]
            with patch("sys.argv", argv), patch.object(
                scheduled.subprocess,
                "run",
                side_effect=self._successful_child_run,
            ) as run:
                self.assertEqual(scheduled.main(), 0)
            command = run.call_args.args[0]
            summary = json.loads((output / "scheduled_run_summary.json").read_text(encoding="utf-8"))
        self.assertIn("--refresh-completed-after-hours", command)
        self.assertNotIn("--ingest", command)
        self.assertTrue(summary["crawler_invoked"])
        self.assertTrue(summary["crawler_summary_valid"])
        self.assertTrue(summary["content_fetch_started"])
        self.assertEqual(summary["content_request_count"], 1)
        self.assertFalse(summary["ingest_post_phase_invoked"])

    def test_zero_exit_without_current_crawler_summary_is_not_reported_as_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root / "tracker.csv")
            policy = self._policy(root / "permissions.csv", [self._approved("https://one.example/careers")])
            output = root / "scheduled-output"
            argv = [
                "employer_career_scheduled_run.py", "--input", str(tracker),
                "--permission-manifest", str(policy), "--output-dir", str(output),
            ]
            with patch("sys.argv", argv), patch.object(
                scheduled.subprocess, "run", return_value=CompletedProcess(args=[], returncode=0),
            ):
                self.assertEqual(scheduled.main(), 2)
            summary = json.loads((output / "scheduled_run_summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["result"], "crawler summary missing or invalid; inspect private log")
        self.assertFalse(summary["crawler_summary_valid"])
        self.assertIsNone(summary["content_fetch_started"])
        self.assertIsNone(summary["ingest_post_phase_invoked"])

    def test_lock_permission_error_is_not_reported_as_an_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root / "tracker.csv")
            policy = self._policy(root / "permissions.csv", [])
            argv = [
                "employer_career_scheduled_run.py", "--input", str(tracker),
                "--permission-manifest", str(policy), "--output-dir", str(root / "output"),
            ]
            with patch("sys.argv", argv), patch.object(
                scheduled, "exclusive_lock", side_effect=PermissionError("lock path denied"),
            ):
                with self.assertRaises(PermissionError):
                    scheduled.main()

    def test_malformed_child_summary_counts_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root / "tracker.csv")
            filtered = self._tracker(root / "filtered.csv")
            summary_path = root / "run_summary.json"
            base = {
                "started_at_utc": datetime.now(timezone.utc).isoformat(),
                "adapter_version": crawler.ADAPTER_VERSION,
                "tracker_sha256": hashlib.sha256(filtered.read_bytes()).hexdigest(),
                "status_counts_by_source_group": {"scraped": 1},
                "unique_source_groups_with_result": 1,
                "content_request_count": 1,
                "content_fetch_started": True,
                "ingest_post_phase_invoked": False,
                "jobs_staged": 0,
                "jobs_skipped": 0,
            }
            invalid_cases = [
                {"status_counts_by_source_group": {"scraped": True}},
                {"status_counts_by_source_group": {"scraped": -1}},
                {"unique_source_groups_with_result": True},
                {"content_request_count": -1},
                {"content_fetch_started": False},
                {"jobs_staged": "0"},
            ]
            for invalid in invalid_cases:
                summary_path.write_text(json.dumps({**base, **invalid}), encoding="utf-8")
                self.assertIsNone(scheduled._current_crawler_summary(
                    summary_path, filtered, datetime(2026, 11, 14, tzinfo=timezone.utc),
                ))

    def test_overlapping_scheduled_runs_are_rejected_by_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "scheduled_run.lock"
            first_lock = scheduled.exclusive_lock(lock)
            try:
                first_lock.__enter__()
            except PermissionError as exc:
                if os.name == "nt" and not scheduled._is_lock_contention(exc):
                    self.skipTest("the sandbox does not allow Windows file locking")
                raise
            try:
                with self.assertRaises(scheduled.RunLockBusy):
                    with scheduled.exclusive_lock(lock):
                        pass
            finally:
                first_lock.__exit__(None, None, None)

    def test_only_actual_windows_lock_violation_is_classified_as_contention(self):
        crt_lock_conflict = OSError(13, "Permission denied")
        conflict = OSError(13, "Permission denied")
        conflict.winerror = 33
        access_denied = OSError(13, "Permission denied")
        access_denied.winerror = 5
        with patch.object(scheduled.os, "name", "nt"):
            self.assertTrue(scheduled._is_lock_contention(crt_lock_conflict))
            self.assertTrue(scheduled._is_lock_contention(conflict))
            self.assertFalse(scheduled._is_lock_contention(access_denied))


class CompletedSourceRefreshTests(unittest.TestCase):
    def test_ttl_requeues_expired_and_legacy_complete_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source_results.jsonl"
            now = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
            rows = [
                {"url": "https://fresh.example/jobs", "status": "scraped", "complete": True,
                 "adapter_version": crawler.ADAPTER_VERSION, "completed_at_utc": "2026-11-14T11:00:00Z"},
                {"url": "https://stale.example/jobs", "status": "scraped", "complete": True,
                 "adapter_version": crawler.ADAPTER_VERSION, "completed_at_utc": "2026-11-13T00:00:00Z"},
                {"url": "https://legacy.example/jobs", "status": "no_jobs", "complete": True,
                 "adapter_version": crawler.ADAPTER_VERSION},
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            done = crawler._read_done(path, refresh_completed_after_hours=24, now=now)
        self.assertEqual(set(done), {"https://fresh.example/jobs"})


if __name__ == "__main__":
    unittest.main()
