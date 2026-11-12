"""Focused partition and alias-preservation checks for career source shards."""

import csv
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlparse

from employer_career_ingest import ADAPTER_VERSION, normalize_source_url
from shard_employer_career_tracker import build_shards


FIELDS = ["employer_key", "employer_name", "career_page_status", "career_page_url"]


def write_tracker(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


class ShardTrackerTests(unittest.TestCase):
    def test_deterministic_balanced_host_exclusive_shards_preserve_alias_rows(self):
        urls = [
            "https://A.example/jobs/", "https://a.example/jobs#alias", "https://a.example/careers",
            "https://b.example/jobs", "https://c.example/jobs", "https://d.example/jobs", "https://e.example/jobs",
        ]
        rows = [{"employer_key": f"company:{index}", "employer_name": f"Employer {index}", "career_page_status": "verified_official", "career_page_url": url} for index, url in enumerate(urls)]
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            tracker = root / "cohort.csv"
            write_tracker(tracker, rows)
            first = build_shards(tracker, root / "one")
            second = build_shards(tracker, root / "two")

            self.assertEqual(first["input_rows"], 7)
            self.assertEqual(first["normalized_source_groups"], 6)
            self.assertEqual(first["unique_hostnames"], 5)
            self.assertEqual([x["sha256"] for x in first["shards"]], [x["sha256"] for x in second["shards"]])
            self.assertEqual(sum(x["rows"] for x in first["shards"]), 7)
            self.assertLessEqual(max(x["normalized_source_groups"] for x in first["shards"]) - min(x["normalized_source_groups"] for x in first["shards"]), 1)

            emitted = []
            host_shards: dict[str, set[int]] = {}
            for index, shard in enumerate(first["shards"]):
                with (root / "one" / shard["file"]).open(newline="", encoding="utf-8") as source:
                    selected = list(csv.DictReader(source))
                emitted.extend(selected)
                for row in selected:
                    host = urlparse(normalize_source_url(row["career_page_url"])).hostname
                    host_shards.setdefault(host, set()).add(index)
            self.assertEqual({row["employer_key"] for row in emitted}, {row["employer_key"] for row in rows})
            self.assertTrue(all(len(owners) == 1 for owners in host_shards.values()))
            self.assertEqual(sum(1 for row in emitted if normalize_source_url(row["career_page_url"]) == "https://a.example/jobs"), 2)
            with self.assertRaises(FileExistsError):
                build_shards(tracker, root / "one")

    def test_unverified_row_rejected_instead_of_silently_dropped(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            tracker = root / "cohort.csv"
            write_tracker(tracker, [{"employer_key": "x", "employer_name": "X", "career_page_status": "unresolved", "career_page_url": "https://x.example/jobs"}])
            with self.assertRaisesRegex(ValueError, "verified-only cohort"):
                build_shards(tracker, root / "shards")

    def test_current_checkpoint_excludes_group_and_all_aliases(self):
        rows = [
            {"employer_key": "a1", "employer_name": "A One", "career_page_status": "verified_official", "career_page_url": "https://a.example/jobs/"},
            {"employer_key": "a2", "employer_name": "A Two", "career_page_status": "verified_official", "career_page_url": "https://a.example/jobs#alias"},
            {"employer_key": "b", "employer_name": "B", "career_page_status": "verified_official", "career_page_url": "https://b.example/jobs"},
            {"employer_key": "c", "employer_name": "C", "career_page_status": "verified_official", "career_page_url": "https://c.example/jobs"},
        ]
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            tracker = root / "cohort.csv"
            checkpoint = root / "results.jsonl"
            write_tracker(tracker, rows)
            checkpoint.write_text("\n".join([
                json.dumps({"adapter_version": ADAPTER_VERSION, "status": "partial", "normalized_url": "https://a.example/jobs"}),
                json.dumps({"adapter_version": "employer-career-ingest-v13", "status": "scraped", "url": "https://b.example/jobs"}),
                "{unfinished",
            ]) + "\n", encoding="utf-8")
            manifest = build_shards(tracker, root / "shards", exclude_results=checkpoint)
            self.assertEqual(manifest["input_rows"], 4)
            self.assertEqual(manifest["emitted_rows"], 2)
            self.assertEqual(manifest["excluded_normalized_source_groups"], 1)
            self.assertEqual(
                manifest["excluded_normalized_source_groups_sha256"],
                hashlib.sha256(b"https://a.example/jobs\n").hexdigest(),
            )
            self.assertEqual(manifest["excluded_alias_rows"], 2)
            self.assertEqual(manifest["exclude_adapter_version"], ADAPTER_VERSION)
            self.assertEqual(manifest["exclude_results_sha256"], hashlib.sha256(checkpoint.read_bytes()).hexdigest())
            emitted = []
            for shard in manifest["shards"]:
                with (root / "shards" / shard["file"]).open(newline="", encoding="utf-8") as source:
                    emitted.extend(csv.DictReader(source))
            self.assertEqual({row["employer_key"] for row in emitted}, {"b", "c"})

    def test_explicit_older_version_reproduces_previous_cohort_exclusion(self):
        rows = [
            {"employer_key": "a", "employer_name": "A", "career_page_status": "verified_official", "career_page_url": "https://a.example/jobs"},
            {"employer_key": "b", "employer_name": "B", "career_page_status": "verified_official", "career_page_url": "https://b.example/jobs"},
        ]
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            tracker = root / "cohort.csv"
            checkpoint = root / "results.jsonl"
            write_tracker(tracker, rows)
            checkpoint.write_text(json.dumps({
                "adapter_version": "employer-career-ingest-v14",
                "status": "partial",
                "normalized_url": "https://a.example/jobs",
            }) + "\n", encoding="utf-8")
            manifest = build_shards(
                tracker, root / "shards", exclude_results=checkpoint,
                exclude_adapter_version="employer-career-ingest-v14",
            )
            self.assertEqual(manifest["exclude_adapter_version"], "employer-career-ingest-v14")
            self.assertEqual(manifest["excluded_normalized_source_groups"], 1)
            emitted = []
            for shard in manifest["shards"]:
                with (root / "shards" / shard["file"]).open(newline="", encoding="utf-8") as source:
                    emitted.extend(csv.DictReader(source))
            self.assertEqual([row["employer_key"] for row in emitted], ["b"])


if __name__ == "__main__":
    unittest.main()
