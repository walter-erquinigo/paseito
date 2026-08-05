from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from local_watchdog import read_last_success, scheduled_date, write_success


class LocalWatchdogScheduleTests(unittest.TestCase):
    def test_new_york_six_pm_gate_tracks_dst(self) -> None:
        self.assertIsNone(scheduled_date(datetime(2026, 3, 8, 21, 59, tzinfo=timezone.utc)))
        self.assertEqual(
            scheduled_date(datetime(2026, 3, 8, 22, 0, tzinfo=timezone.utc)), "2026-03-08"
        )
        self.assertIsNone(scheduled_date(datetime(2026, 11, 1, 22, 59, tzinfo=timezone.utc)))
        self.assertEqual(
            scheduled_date(datetime(2026, 11, 1, 23, 0, tzinfo=timezone.utc)), "2026-11-01"
        )

    def test_success_state_is_private_and_readable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            write_success(path, "2026-08-05")
            mode = os.stat(path).st_mode & 0o777
            self.assertEqual(read_last_success(path), "2026-08-05")
        self.assertEqual(mode, 0o600)


if __name__ == "__main__":
    unittest.main()
