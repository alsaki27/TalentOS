from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from report_employer_career_family_matrix import build_family_matrix, write_family_matrix


class EmployerCareerFamilyMatrixTests(unittest.TestCase):
    def _write_dispositions(self, root: Path, rows: list[dict[str, str]]) -> Path:
        path = root / "source_dispositions.csv"
        fields = ("normalized_url", "url", "status", "complete", "employers")
        with path.open("w", encoding="utf-8", newline="") as output_file:
            writer = csv.DictWriter(output_file, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        return path

    def test_groups_counts_current_adapter_and_generic_outcomes_without_private_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self._write_dispositions(root, [
                {
                    "normalized_url": "https://boards.greenhouse.io/example",
                    "url": "https://boards.greenhouse.io/example",
                    "status": "scraped",
                    "complete": "true",
                    "employers": "Private Employer Name",
                },
                {
                    "normalized_url": "https://boards.greenhouse.io/empty",
                    "url": "https://boards.greenhouse.io/empty",
                    "status": "no_jobs",
                    "complete": "true",
                    "employers": "Private Employer Name",
                },
                {
                    "normalized_url": "https://jobs.example.invalid/careers",
                    "url": "https://jobs.example.invalid/careers",
                    "status": "partial",
                    "complete": "false",
                    "employers": "Private Employer Name",
                },
            ])

            matrix = build_family_matrix(source)
            by_family = {row["adapter_family"]: row for row in matrix}
            self.assertEqual(by_family["greenhouse"]["group_count"], 2)
            self.assertEqual(by_family["greenhouse"]["complete_count"], 2)
            self.assertEqual(by_family["generic"]["incomplete_count"], 1)
            self.assertEqual(by_family["generic"]["status_partial"], 1)

            output = root / "matrix.csv"
            write_family_matrix(matrix, output)
            rendered = output.read_text(encoding="utf-8-sig")
            self.assertNotIn("Private Employer Name", rendered)
            self.assertNotIn("boards.greenhouse.io", rendered)

    def test_rejects_duplicate_source_groups(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self._write_dispositions(root, [
                {
                    "normalized_url": "https://jobs.example.invalid/careers",
                    "url": "https://jobs.example.invalid/careers",
                    "status": "partial",
                    "complete": "false",
                    "employers": "",
                },
                {
                    "normalized_url": "https://jobs.example.invalid/careers",
                    "url": "https://jobs.example.invalid/careers",
                    "status": "partial",
                    "complete": "false",
                    "employers": "",
                },
            ])
            with self.assertRaisesRegex(ValueError, "duplicate normalized source group"):
                build_family_matrix(source)

    def test_rejects_mismatched_status_and_completeness(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self._write_dispositions(root, [
                {
                    "normalized_url": "https://jobs.example.invalid/careers",
                    "url": "https://jobs.example.invalid/careers",
                    "status": "partial",
                    "complete": "true",
                    "employers": "",
                },
            ])
            with self.assertRaisesRegex(ValueError, "status and complete flag disagree"):
                build_family_matrix(source)


if __name__ == "__main__":
    unittest.main()
