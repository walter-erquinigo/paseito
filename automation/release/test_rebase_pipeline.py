from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


def git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check
    )


def write_commit(repo: Path, name: str, content: str, message: str) -> str:
    (repo / name).write_text(content, encoding="utf-8")
    git(repo, "add", name)
    git(repo, "-c", "commit.gpgsign=false", "commit", "-m", message)
    return git(repo, "rev-parse", "HEAD").stdout.strip()


class RebasePipelineTests(unittest.TestCase):
    def create_repo(self, root: Path) -> tuple[Path, str]:
        repo = root / "repo"
        repo.mkdir()
        git(repo, "init", "-b", "main")
        git(repo, "config", "user.email", "test@example.invalid")
        git(repo, "config", "user.name", "Paseito Test")
        baseline = write_commit(repo, "upstream.txt", "v1\n", "upstream v1")
        git(repo, "switch", "-c", "paseito")
        write_commit(repo, "fork.txt", "identity\n", "paseito identity")
        return repo, baseline

    def test_clean_candidate_rebase_replays_fork_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo, old_upstream = self.create_repo(Path(directory))
            fork_commit = git(repo, "rev-parse", "paseito").stdout.strip()
            git(repo, "switch", "main")
            new_upstream = write_commit(repo, "upstream.txt", "v2\n", "upstream v2")
            git(repo, "switch", "-c", "candidate", fork_commit)
            git(repo, "rebase", "--onto", new_upstream, old_upstream, "candidate")
            self.assertEqual((repo / "fork.txt").read_text(encoding="utf-8"), "identity\n")
            self.assertEqual(git(repo, "merge-base", "candidate", "main").stdout.strip(), new_upstream)

    def test_conflict_leaves_machine_branch_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo, old_upstream = self.create_repo(Path(directory))
            git(repo, "switch", "paseito")
            fork_commit = write_commit(repo, "upstream.txt", "fork edit\n", "fork edit")
            machine_branch_before = git(repo, "rev-parse", "paseito").stdout.strip()
            git(repo, "switch", "main")
            new_upstream = write_commit(repo, "upstream.txt", "upstream edit\n", "upstream edit")
            git(repo, "switch", "-c", "candidate", fork_commit)
            result = git(
                repo,
                "-c",
                "core.editor=true",
                "rebase",
                "--onto",
                new_upstream,
                old_upstream,
                "candidate",
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(git(repo, "rev-parse", "paseito").stdout.strip(), machine_branch_before)
            git(repo, "rebase", "--abort")

    def test_force_with_lease_rejects_concurrent_branch_advance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, _ = self.create_repo(root)
            remote = root / "remote.git"
            git(root, "clone", "--bare", str(repo), str(remote))
            first = root / "first"
            second = root / "second"
            git(root, "clone", str(remote), str(first))
            git(root, "clone", str(remote), str(second))
            for clone in (first, second):
                git(clone, "config", "user.email", "test@example.invalid")
                git(clone, "config", "user.name", "Paseito Test")
                git(clone, "switch", "paseito")
            expected = git(first, "rev-parse", "origin/paseito").stdout.strip()
            write_commit(second, "second.txt", "advance\n", "concurrent advance")
            git(second, "push", "origin", "paseito")
            candidate = write_commit(first, "first.txt", "candidate\n", "verified candidate")
            result = git(
                first,
                "push",
                f"--force-with-lease=refs/heads/paseito:{expected}",
                "origin",
                f"{candidate}:refs/heads/paseito",
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)

    def test_workflow_declares_non_cancelling_concurrency(self) -> None:
        workflow = (Path(__file__).parents[2] / ".github/workflows/paseito-release.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("group: paseito-upstream-release", workflow)
        self.assertIn("cancel-in-progress: false", workflow)

    def test_github_workflow_only_verifies_a_local_candidate(self) -> None:
        workflow = (Path(__file__).parents[2] / ".github/workflows/paseito-release.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("candidate_ref:", workflow)
        self.assertIn("expected_sha:", workflow)
        self.assertNotIn("git rebase", workflow)
        self.assertNotIn("git push", workflow)
        self.assertNotIn("gh release create", workflow)

    def test_watchdog_runs_local_semantic_controller(self) -> None:
        watchdog = (Path(__file__).parent / "local_watchdog.py").read_text(encoding="utf-8")
        self.assertIn("semantic_sync.py", watchdog)
        self.assertNotIn('"workflow", "run"', watchdog)


if __name__ == "__main__":
    unittest.main()
