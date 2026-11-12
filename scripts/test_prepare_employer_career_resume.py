"""Offline checks for exact crawl checkpoint and retry tracker construction."""

import contextlib
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prepare_employer_career_resume as resume


VERSION = "employer-career-ingest-v22"
WORKSPACE = Path(__file__).resolve().parents[1]


def _result(url, status, count, attempt):
    return {
        "url": url, "normalized_url": url, "adapter_version": VERSION,
        "status": status, "complete": status in {"scraped", "no_jobs"},
        "job_count": count, "crawl_attempt_id": attempt,
    }


def _job(url, attempt):
    return {
        "title": "Example role", "source_url": url + "/role/1",
        "external_job_id": attempt,
        "description_text": "Specific duties and requirements. " * 10,
        "raw": {"career_source_url": url, "adapter_version": VERSION,
                "crawl_attempt_id": attempt},
    }


def _jsonl(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def _shard(root, name, urls, results, jobs, *, duplicate_alias=None):
    run = root / name
    run.mkdir()
    tracker = root / (name + ".csv")
    with tracker.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["career_page_status", "career_page_url", "evidence_url", "employer_name", "employer_key"])
        writer.writeheader()
        for i, url in enumerate(urls):
            writer.writerow({"career_page_status": "verified_official", "career_page_url": url,
                             "employer_name": "Example", "employer_key": f"company_id:{i}"})
        if duplicate_alias:
            writer.writerow({"career_page_status": "verified_official", "career_page_url": duplicate_alias,
                             "employer_name": "Alias", "employer_key": "company_id:alias"})
    (run / "run_manifest.json").write_text(json.dumps({
        "tracker_path": str(tracker), "adapter_version": VERSION,
        "normalized_unique_career_urls": len(urls), "workers": 1,
    }), encoding="utf-8")
    _jsonl(run / "source_results.jsonl", results)
    _jsonl(run / "jobs.jsonl", jobs)
    return run


class ResumeCheckpointTests(unittest.TestCase):
    def test_retains_valid_complete_and_partial_but_requeues_error(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            root = Path(tmp)
            a, b, c = (f"https://{host}.example/jobs" for host in "abc")
            run = _shard(root, "shard-01", [a, b, c], [
                _result(a, "scraped", 1, "attempt-a"),
                _result(b, "partial", 0, "attempt-b"),
                _result(c, "error", 0, "attempt-c"),
            ], [_job(a, "attempt-a")], duplicate_alias=a + "/")
            audit = resume.audit_shard(run, VERSION)
            self.assertEqual(audit["retained_groups"], {a, b})
            self.assertEqual(audit["retry_groups"], {c})
            self.assertEqual(audit["report"]["retryable_error_groups"], 1)
            self.assertEqual(len(audit["retry_rows"]), 1)

    def test_requeues_payload_mismatch_and_orphan_attempt(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            root = Path(tmp)
            a, b, c = (f"https://{host}.example/jobs" for host in "abc")
            run = _shard(root, "shard-01", [a, b, c], [
                _result(a, "scraped", 2, "attempt-a"),
                _result(b, "scraped", 1, "attempt-b"),
            ], [_job(a, "attempt-a"), _job(b, "attempt-b"), _job(b, "interrupted-b")])
            audit = resume.audit_shard(run, VERSION)
            self.assertEqual(audit["retained_groups"], set())
            self.assertEqual(audit["retry_groups"], {a, b, c})
            self.assertEqual(audit["report"]["payload_mismatch_groups"], 1)
            self.assertEqual(audit["report"]["orphan_job_rows"], 1)
            self.assertEqual(audit["report"]["orphan_source_groups"], 1)

    def test_writes_exact_disjoint_retry_trackers_and_manifest(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            root = Path(tmp)
            a, b, c, d = (f"https://{host}.example/jobs" for host in "abcd")
            one = _shard(root, "shard-01", [a, b], [_result(a, "scraped", 1, "a")], [_job(a, "a")])
            two = _shard(root, "shard-02", [c, d], [_result(c, "error", 0, "c"),
                                                     _result(d, "blocked", 0, "d")], [])
            out = root / "private-resume"
            argv = ["prepare_employer_career_resume.py", "--run-dir", str(one),
                    "--run-dir", str(two), "--output-dir", str(out),
                    "--expected-version", VERSION, "--write"]
            with patch("sys.argv", argv), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(resume.main(), 0)
            manifest = json.loads((out / "resume_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual((manifest["input_source_groups"], manifest["retained_source_groups"],
                              manifest["retry_source_groups"], manifest["coverage_union_source_groups"]),
                             (4, 2, 2, 4))
            self.assertEqual([row["retry_source_groups"] for row in manifest["shards"]], [1, 1])
            with (out / "career_page_tracker_shard_01.csv").open(newline="", encoding="utf-8") as stream:
                self.assertEqual([row["career_page_url"] for row in csv.DictReader(stream)], [b])
            with (out / "career_page_tracker_shard_02.csv").open(newline="", encoding="utf-8") as stream:
                self.assertEqual([row["career_page_url"] for row in csv.DictReader(stream)], [c])

    def test_unterminated_jsonl_aborts_before_checkpoint(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            root = Path(tmp)
            url = "https://a.example/jobs"
            run = _shard(root, "shard-01", [url], [_result(url, "scraped", 0, "a")], [])
            (run / "source_results.jsonl").write_text(json.dumps(_result(url, "scraped", 0, "a")), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unterminated final line"):
                resume.audit_shard(run, VERSION)


if __name__ == "__main__":
    unittest.main()
