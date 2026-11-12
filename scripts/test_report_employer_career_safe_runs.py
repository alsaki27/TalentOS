"""The combined report must never consume a marked invalid shard run."""

from pathlib import Path
import tempfile
import unittest

from report_employer_career_safe_runs import select_runs


class SafeRunSelectionTests(unittest.TestCase):
    def test_marked_run_excludes_results_and_jobs_together(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            valid = root / "valid"
            invalid = root / "invalid"
            valid.mkdir()
            invalid.mkdir()
            for run in (valid, invalid):
                (run / "source_results.jsonl").write_text("", encoding="utf-8")
                (run / "jobs.jsonl").write_text("", encoding="utf-8")
            (invalid / "INVALID_ROBOTS_RUN.json").write_text('{"exclude_from_combined_readiness":true}', encoding="utf-8")
            results, jobs, excluded, pending = select_runs([valid, invalid])
            self.assertEqual(results, [valid.resolve() / "source_results.jsonl"])
            self.assertEqual(jobs, [valid.resolve() / "jobs.jsonl"])
            self.assertEqual([entry["run_dir"] for entry in excluded], [str(invalid.resolve())])
            self.assertEqual(pending, [])

    def test_unmarked_missing_pair_fails_closed(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            (root / "source_results.jsonl").write_text("", encoding="utf-8")
            with self.assertRaises(FileNotFoundError):
                select_runs([root])

    def test_live_pending_run_is_recorded_until_both_files_exist(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            valid = root / "baseline"
            pending_run = root / "new_shard"
            valid.mkdir()
            pending_run.mkdir()
            (valid / "source_results.jsonl").write_text("", encoding="utf-8")
            (valid / "jobs.jsonl").write_text("", encoding="utf-8")
            (pending_run / "source_results.jsonl").write_text("", encoding="utf-8")
            results, jobs, excluded, pending = select_runs([valid, pending_run], allow_pending=True)
            self.assertEqual(len(results), 1)
            self.assertEqual(len(jobs), 1)
            self.assertEqual(excluded, [])
            self.assertEqual(pending, [str(pending_run.resolve())])


if __name__ == "__main__":
    unittest.main()
