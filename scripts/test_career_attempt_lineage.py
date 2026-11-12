"""Offline regressions for crawl-attempt provenance in readiness handoffs."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import employer_career_ingest as crawler
import report_employer_career_ingest as reporter


class CrawlAttemptLineageTests(unittest.TestCase):
    @staticmethod
    def _tracker(root: Path) -> Path:
        tracker = root / "tracker.csv"
        tracker.write_text(
            "career_page_status,career_page_url,evidence_url,employer_name,employer_key\n"
            "verified_official,https://example.com/careers,,Example,company_id:1\n",
            encoding="utf-8",
        )
        return tracker

    @staticmethod
    def _job(title: str, description: str, *, version: str, attempt_id: str | None = None) -> dict:
        raw = {"career_source_url": "https://example.com/careers", "adapter_version": version}
        if attempt_id:
            raw["crawl_attempt_id"] = attempt_id
        return {
            "title": title, "company": "Example", "source_url": "https://example.com/jobs/1",
            "external_job_id": "1", "description_text": description, "raw": raw,
        }

    def test_retry_writes_new_job_row_and_report_uses_selected_complete_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root)
            output = root / "crawl"
            attempts = iter((
                (False, "Old partial title", "Old stale description. " * 25),
                (True, "Current title", "Current verified description. " * 8),
            ))

            def fake_scrape(source):
                complete, title, description = next(attempts)
                return {
                    **source, "adapter_version": crawler.ADAPTER_VERSION,
                    "status": "scraped" if complete else "partial", "method": "fixture",
                    "complete": complete, "notes": [], "job_count": 1, "error": None,
                    "jobs": [self._job(title, description, version=crawler.ADAPTER_VERSION)],
                }

            argv = ["employer_career_ingest.py", "--input", str(tracker), "--output-dir", str(output), "--workers", "1"]
            with patch.object(crawler, "scrape_source", side_effect=fake_scrape), patch("sys.argv", argv):
                self.assertEqual(crawler.main(), 0)
                self.assertEqual(crawler.main(), 0)

            results = [json.loads(line) for line in (output / "source_results.jsonl").read_text(encoding="utf-8").splitlines()]
            jobs = [json.loads(line) for line in (output / "jobs.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(results), 2)
            self.assertEqual(len(jobs), 2)
            self.assertNotEqual(results[0]["crawl_attempt_id"], results[1]["crawl_attempt_id"])
            self.assertEqual([job["raw"]["crawl_attempt_id"] for job in jobs], [result["crawl_attempt_id"] for result in results])

            summary = reporter.build_report(tracker, output / "source_results.jsonl", output / "jobs.jsonl", root / "readiness")
            ready = [json.loads(line) for line in Path(summary["ready_jobs_path"]).read_text(encoding="utf-8").splitlines()]
            self.assertEqual([job["title"] for job in ready], ["Current title"])
            self.assertEqual(summary["lineage_hold_counts_by_reason"], {"mismatched_crawl_attempt": 1})

    def test_legacy_same_version_attempts_in_two_run_dirs_hold_all_payloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root)
            paths = []
            for run_number in (1, 2):
                run = root / f"run-{run_number}"
                run.mkdir()
                result_path = run / "source_results.jsonl"
                jobs_path = run / "jobs.jsonl"
                result_path.write_text(json.dumps({
                    "url": "https://example.com/careers", "adapter_version": "v15",
                    "status": "scraped", "complete": True, "method": "fixture", "job_count": 1,
                }) + "\n", encoding="utf-8")
                jobs_path.write_text(json.dumps(self._job(
                    f"Title {run_number}", "Full description. " * 20, version="v15",
                )) + "\n", encoding="utf-8")
                paths.append((result_path, jobs_path))

            summary = reporter.build_report(
                tracker, [result for result, _ in paths], [jobs for _, jobs in paths],
                root / "readiness", "v15",
            )
            self.assertEqual(summary["complete_source_groups"], 0)
            self.assertEqual(summary["source_groups_with_ambiguous_legacy_attempts"], 1)
            self.assertEqual(summary["lineage_hold_counts_by_reason"], {"ambiguous_legacy_crawl_attempt": 2})
            self.assertEqual(summary["unique_integration_ready_job_payloads"], 0)

    def test_tagged_payload_from_another_run_is_held(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root)
            result_paths = []
            job_paths = []
            for run_number in (1, 2):
                run = root / f"run-{run_number}"
                run.mkdir()
                result_path = run / "source_results.jsonl"
                jobs_path = run / "jobs.jsonl"
                result_path.write_text(json.dumps({
                    "url": "https://example.com/careers", "adapter_version": "v19",
                    "crawl_attempt_id": f"attempt-{run_number}",
                    "status": "scraped" if run_number == 1 else "partial",
                    "complete": run_number == 1, "method": "fixture", "job_count": 1,
                }) + "\n", encoding="utf-8")
                jobs_path.write_text(json.dumps(self._job(
                    f"Title {run_number}", "Full description. " * 20,
                    version="v19", attempt_id=f"attempt-{run_number}",
                )) + "\n", encoding="utf-8")
                result_paths.append(result_path)
                job_paths.append(jobs_path)

            summary = reporter.build_report(tracker, result_paths, job_paths, root / "readiness", "v19")
            ready = [json.loads(line) for line in Path(summary["ready_jobs_path"]).read_text(encoding="utf-8").splitlines()]
            self.assertEqual([job["title"] for job in ready], ["Title 1"])
            self.assertEqual(summary["lineage_hold_counts_by_reason"], {"mismatched_crawl_attempt": 1})

    def test_complete_result_with_missing_payload_rows_is_not_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root)
            result_path = root / "source_results.jsonl"
            jobs_path = root / "jobs.jsonl"
            result_path.write_text(json.dumps({
                "url": "https://example.com/careers", "adapter_version": "v15",
                "status": "scraped", "complete": True, "method": "fixture", "job_count": 2,
            }) + "\n", encoding="utf-8")
            jobs_path.write_text(json.dumps(self._job(
                "One surviving role", "Full description. " * 20, version="v15",
            )) + "\n", encoding="utf-8")

            summary = reporter.build_report(tracker, result_path, jobs_path, root / "readiness", "v15")
            self.assertEqual(summary["complete_source_groups"], 0)
            self.assertEqual(summary["source_groups_with_payload_count_mismatch"], 1)
            self.assertEqual(summary["missing_payload_rows_from_selected_complete_groups"], 1)
            self.assertEqual(summary["unique_integration_ready_job_payloads"], 0)
            self.assertEqual(summary["status_counts_by_source_group"], {"payload_count_mismatch": 1})

    def test_valid_source_keeps_shared_job_when_other_source_has_missing_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = root / "tracker.csv"
            tracker.write_text(
                "career_page_status,career_page_url,evidence_url,employer_name,employer_key\n"
                "verified_official,https://a.example/careers,,A,company_id:1\n"
                "verified_official,https://b.example/careers,,B,company_id:2\n",
                encoding="utf-8",
            )
            result_path = root / "source_results.jsonl"
            jobs_path = root / "jobs.jsonl"
            results = [
                {"url": f"https://{host}.example/careers", "adapter_version": "v15",
                 "status": "scraped", "complete": True, "method": "fixture", "job_count": count}
                for host, count in (("a", 1), ("b", 2))
            ]
            result_path.write_text("".join(json.dumps(row) + "\n" for row in results), encoding="utf-8")
            jobs = []
            for host, title, repetition in (("a", "Valid source", 15), ("b", "Incomplete source", 25)):
                job = self._job(title, "Full description. " * repetition, version="v15")
                job["source_url"] = "https://shared.example/jobs/1"
                job["raw"]["career_source_url"] = f"https://{host}.example/careers"
                jobs.append(job)
            jobs_path.write_text("".join(json.dumps(job) + "\n" for job in jobs), encoding="utf-8")

            summary = reporter.build_report(tracker, result_path, jobs_path, root / "readiness", "v15")
            ready = [json.loads(line) for line in Path(summary["ready_jobs_path"]).read_text(encoding="utf-8").splitlines()]
            self.assertEqual(summary["complete_source_groups"], 1)
            self.assertEqual([job["title"] for job in ready], ["Valid source"])

    def test_writer_marks_duplicate_jobs_partial_and_counts_written_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = self._tracker(root)
            output = root / "crawl"

            def fake_scrape(source):
                job = self._job("One role", "Full description. " * 20, version=crawler.ADAPTER_VERSION)
                return {
                    **source, "adapter_version": crawler.ADAPTER_VERSION,
                    "status": "scraped", "method": "fixture", "complete": True,
                    "notes": [], "job_count": 2, "error": None, "jobs": [job, dict(job)],
                }

            argv = ["employer_career_ingest.py", "--input", str(tracker), "--output-dir", str(output), "--workers", "1"]
            with patch.object(crawler, "scrape_source", side_effect=fake_scrape), patch("sys.argv", argv):
                self.assertEqual(crawler.main(), 0)
            result = json.loads((output / "source_results.jsonl").read_text(encoding="utf-8").splitlines()[0])
            jobs = (output / "jobs.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(result["status"], "partial")
            self.assertFalse(result["complete"])
            self.assertEqual(result["job_count"], len(jobs))
            self.assertEqual(len(jobs), 1)


if __name__ == "__main__":
    unittest.main()
