"""Offline process-level check for the optional shared per-host crawl delay."""
import multiprocessing
import hashlib
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import employer_career_ingest as scraper


def _request_from_process(rate_dir: str, start, times) -> None:
    scraper._shared_host_rate_dir = Path(rate_dir)
    if not start.wait(timeout=10):
        raise RuntimeError("start signal timed out")

    def send():
        times.put(time.time())
        return object()

    scraper._shared_host_request("shared.example", None, send)


def _hold_request_from_process(rate_dir: str, entered) -> None:
    scraper._shared_host_rate_dir = Path(rate_dir)

    def send():
        entered.set()
        time.sleep(30)
        return object()

    scraper._shared_host_request("held.example", None, send)


class SharedHostRateTests(unittest.TestCase):
    def test_two_processes_space_requests_to_same_host(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            ctx = multiprocessing.get_context("spawn")
            start = ctx.Event()
            times = ctx.Queue()
            processes = [
                ctx.Process(target=_request_from_process, args=(temp_dir, start, times))
                for _ in range(2)
            ]
            try:
                for process in processes:
                    process.start()
                start.set()
                for process in processes:
                    process.join(timeout=15)
                self.assertTrue(all(process.exitcode == 0 for process in processes))
                request_times = sorted(times.get(timeout=2) for _ in processes)
                self.assertGreaterEqual(request_times[1] - request_times[0], 0.9)
            finally:
                for process in processes:
                    if process.is_alive():
                        process.terminate()
                        process.join(timeout=2)
                times.close()

    def test_killed_sender_keeps_timestamp_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            ctx = multiprocessing.get_context("spawn")
            entered = ctx.Event()
            process = ctx.Process(target=_hold_request_from_process, args=(temp_dir, entered))
            old_rate_dir = scraper._shared_host_rate_dir
            try:
                process.start()
                self.assertTrue(entered.wait(timeout=10))
                process.terminate()
                process.join(timeout=5)
                self.assertFalse(process.is_alive())
                rate_path = Path(temp_dir) / (hashlib.sha256(b"held.example").hexdigest() + ".rate")
                records = [line for line in rate_path.read_bytes().split(b"\n") if line]
                self.assertTrue(records)
                pre_send_stamp = float(records[-1])
                self.assertLess(time.time() - pre_send_stamp, 5)
                scraper._shared_host_rate_dir = Path(temp_dir)
                started: list[float] = []
                scraper._shared_host_request("held.example", None, lambda: started.append(time.time()) or object())
                self.assertGreaterEqual(started[0] - pre_send_stamp, 0.9)
            finally:
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=2)
                scraper._shared_host_rate_dir = old_rate_dir

    def test_waiting_for_held_host_lock_times_out(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            ctx = multiprocessing.get_context("spawn")
            entered = ctx.Event()
            process = ctx.Process(target=_hold_request_from_process, args=(temp_dir, entered))
            old_rate_dir = scraper._shared_host_rate_dir
            try:
                process.start()
                self.assertTrue(entered.wait(timeout=10))
                scraper._shared_host_rate_dir = Path(temp_dir)
                with patch.object(scraper, "SHARED_HOST_LOCK_TIMEOUT_SECONDS", 0.2):
                    with self.assertRaisesRegex(scraper.ScrapeFailure, "shared host rate lock timed out"):
                        scraper._shared_host_request("held.example", None, lambda: object())
            finally:
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=2)
                scraper._shared_host_rate_dir = old_rate_dir


if __name__ == "__main__":
    unittest.main()
