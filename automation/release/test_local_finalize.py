from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from local_finalize import (
    FinalizationError,
    changed_files,
    snapshot_digest,
    validate_no_sensitive_material,
    validate_result,
)


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, stdout=subprocess.PIPE, text=True)


class LocalFinalizeTests(unittest.TestCase):
    def make_repo(self, directory: str) -> Path:
        repo = Path(directory)
        git(repo, "init", "-q")
        git(repo, "config", "user.email", "automation@example.invalid")
        git(repo, "config", "user.name", "Automation Test")
        (repo / "tracked.txt").write_text("before\n", encoding="utf-8")
        git(repo, "add", "tracked.txt")
        git(repo, "commit", "-qm", "test: initial")
        return repo

    def test_changed_files_and_snapshot_include_tracked_and_untracked_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            initial = snapshot_digest(repo)
            (repo / "tracked.txt").write_text("after\n", encoding="utf-8")
            (repo / "new.txt").write_text("new\n", encoding="utf-8")
            self.assertEqual(changed_files(repo), ["new.txt", "tracked.txt"])
            changed = snapshot_digest(repo)
            self.assertNotEqual(initial, changed)
            (repo / "new.txt").write_text("newer\n", encoding="utf-8")
            self.assertNotEqual(changed, snapshot_digest(repo))

    def test_sensitive_paths_and_added_credentials_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            (repo / ".env").write_text("SAFE=value\n", encoding="utf-8")
            with self.assertRaisesRegex(FinalizationError, "sensitive-looking path"):
                validate_no_sensitive_material(repo, changed_files(repo))
            (repo / ".env").unlink()
            (repo / "tracked.txt").write_text(
                "github_pat_abcdefghijklmnopqrstuvwxyz123456\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(FinalizationError, "credential-like content"):
                validate_no_sensitive_material(repo, changed_files(repo))

    def test_sensitive_content_in_an_unpushed_commit_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            published = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repo,
                check=True,
                text=True,
                stdout=subprocess.PIPE,
            ).stdout.strip()
            (repo / "tracked.txt").write_text(
                "github_pat_abcdefghijklmnopqrstuvwxyz123456\n", encoding="utf-8"
            )
            git(repo, "commit", "-qam", "test: unpublished credential")
            with self.assertRaisesRegex(FinalizationError, "credential-like content"):
                validate_no_sensitive_material(repo, ["tracked.txt"], published)

    def test_result_must_cover_files_and_pass_every_check(self) -> None:
        result = {
            "schemaVersion": 1,
            "ready": True,
            "changeId": "feature-a",
            "commitMessage": "fix: publish safe local changes",
            "files": ["a.ts"],
            "checks": [
                {"command": "npm run format", "result": "passed"},
                {"command": "npm run typecheck", "result": "passed"},
                {"command": "npm run lint", "result": "passed"},
                {"command": "npm run format:check", "result": "passed"},
            ],
            "blockers": [],
        }
        self.assertEqual(
            validate_result(result, ["a.ts"], {"feature-a"}),
            (result["commitMessage"], "feature-a"),
        )
        result["files"] = []
        with self.assertRaisesRegex(FinalizationError, "complete changed-file set"):
                validate_result(result, ["a.ts"], {"feature-a"})
        result["files"] = ["a.ts"]
        result["checks"][0]["result"] = "failed"
        with self.assertRaisesRegex(FinalizationError, "incomplete or failed"):
                validate_result(result, ["a.ts"], {"feature-a"})
        result["checks"][0]["result"] = "passed"
        result["changeId"] = "unknown"
        with self.assertRaisesRegex(FinalizationError, "one registry feature ID"):
            validate_result(result, ["a.ts"], {"feature-a"})


if __name__ == "__main__":
    unittest.main()
