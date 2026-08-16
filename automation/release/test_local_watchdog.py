from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from local_watchdog import (
    read_last_success,
    scheduled_date,
    source_sync_path,
    sync_source_checkout,
    write_source_sync,
    write_success,
)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    ).stdout.strip()


class LocalWatchdogScheduleTests(unittest.TestCase):
    def test_new_york_seven_am_gate_tracks_dst(self) -> None:
        self.assertIsNone(scheduled_date(datetime(2026, 3, 8, 10, 59, tzinfo=timezone.utc)))
        self.assertEqual(
            scheduled_date(datetime(2026, 3, 8, 11, 0, tzinfo=timezone.utc)), "2026-03-08"
        )
        self.assertIsNone(scheduled_date(datetime(2026, 11, 1, 11, 59, tzinfo=timezone.utc)))
        self.assertEqual(
            scheduled_date(datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)), "2026-11-01"
        )

    def test_success_state_is_private_and_readable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            write_success(path, "2026-08-05")
            mode = os.stat(path).st_mode & 0o777
            self.assertEqual(read_last_success(path), "2026-08-05")
        self.assertEqual(mode, 0o600)

    def test_source_sync_preserves_uncommitted_files_and_keeps_backup_ref(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote.git"
            seed = root / "seed"
            source = root / "source"
            state = root / "state"
            state.mkdir()
            git(root, "init", "--bare", "-q", str(remote))
            seed.mkdir()
            git(seed, "init", "-q")
            git(seed, "config", "user.email", "automation@example.invalid")
            git(seed, "config", "user.name", "Automation Test")
            git(seed, "checkout", "-qb", "paseito")
            (seed / "tracked.txt").write_text("old\n", encoding="utf-8")
            git(seed, "add", "tracked.txt")
            git(seed, "commit", "-qm", "test: old")
            git(seed, "remote", "add", "origin", str(remote))
            git(seed, "push", "-qu", "origin", "paseito")
            git(root, "clone", "-q", "--branch", "paseito", str(remote), str(source))
            git(source, "remote", "rename", "origin", "fork")
            source_head = git(source, "rev-parse", "HEAD")
            write_source_sync(source_sync_path(state), source_head)
            self.assertEqual(os.stat(source_sync_path(state)).st_mode & 0o777, 0o600)

            (seed / "tracked.txt").write_text("published\n", encoding="utf-8")
            git(seed, "commit", "-qam", "test: rewritten")
            git(seed, "push", "-q", "--force", "origin", "paseito")
            (source / "concurrent.txt").write_text("keep me\n", encoding="utf-8")

            sync_source_checkout(source, state)

            self.assertEqual(git(source, "rev-parse", "HEAD"), git(seed, "rev-parse", "HEAD"))
            self.assertEqual((source / "concurrent.txt").read_text(encoding="utf-8"), "keep me\n")
            self.assertFalse(source_sync_path(state).exists())
            backups = git(
                source,
                "for-each-ref",
                "--format=%(objectname)",
                "refs/paseito-automation/backups",
            ).splitlines()
            self.assertIn(source_head, backups)


if __name__ == "__main__":
    unittest.main()
