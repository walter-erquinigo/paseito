from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from history_normalization import (
    CHECKLIST_END,
    CHECKLIST_START,
    HistoryNormalizationError,
    load_registry,
    render_checklist,
    replace_checklist,
    validate_normalized_history,
)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    ).stdout.strip()


def commit(repo: Path, path: str, content: str, subject: str, change_id: str | None = None) -> str:
    (repo / path).write_text(content, encoding="utf-8")
    git(repo, "add", path)
    args = ["-c", "commit.gpgsign=false", "commit", "-m", subject]
    if change_id:
        args.extend(["-m", f"Paseito-Change: {change_id}"])
    git(repo, *args)
    return git(repo, "rev-parse", "HEAD")


class HistoryNormalizationTests(unittest.TestCase):
    def write_registry(self, root: Path) -> None:
        automation = root / "automation"
        automation.mkdir(exist_ok=True)
        (automation / "feature-registry.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "features": [
                        {
                            "id": "feature-a",
                            "commitSubject": "feat: add a",
                            "intent": "Keep feature A.",
                            "preservationFixes": ["Keep its fix."],
                        },
                        {
                            "id": "feature-b",
                            "commitSubject": "feat: add b",
                            "intent": "Keep feature B.",
                            "preservationFixes": ["Keep its fallback."],
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )

    def test_checklist_is_registry_managed_and_replaceable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_registry(root)
            checklist = render_checklist(load_registry(root / "automation/feature-registry.json"))
            self.assertIn("`feature-a` — Keep feature A.", checklist)
            self.assertIn("Fix: Keep its fallback.", checklist)
            initial = "# Rules\n"
            generated = replace_checklist(initial, checklist)
            self.assertIn(CHECKLIST_START, generated)
            self.assertIn(CHECKLIST_END, generated)
            self.assertEqual(replace_checklist(generated, checklist), generated)

    def test_history_requires_exactly_one_classified_commit_per_feature(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            git(root, "init", "-q", "-b", "main")
            git(root, "config", "user.email", "test@example.invalid")
            git(root, "config", "user.name", "Test User")
            self.write_registry(root)
            baseline = commit(root, "base.txt", "base\n", "upstream")
            commit(root, "a.txt", "a\n", "feat: add a", "feature-a")
            commit(root, "b.txt", "b\n", "feat: add b", "feature-b")
            commit(root, "metadata.txt", "metadata\n", "chore: preserve Paseito release metadata")
            validate_normalized_history(root, baseline)

    def test_history_rejects_unclassified_and_duplicate_feature_commits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            git(root, "init", "-q", "-b", "main")
            git(root, "config", "user.email", "test@example.invalid")
            git(root, "config", "user.name", "Test User")
            self.write_registry(root)
            baseline = commit(root, "base.txt", "base\n", "upstream")
            commit(root, "a.txt", "a\n", "feat: add a", "feature-a")
            commit(root, "extra.txt", "extra\n", "fix: unclassified")
            with self.assertRaisesRegex(HistoryNormalizationError, "not classified"):
                validate_normalized_history(root, baseline)
            git(root, "reset", "--hard", "HEAD^")
            commit(root, "a2.txt", "a2\n", "feat: add a", "feature-a")
            commit(root, "b.txt", "b\n", "feat: add b", "feature-b")
            with self.assertRaisesRegex(HistoryNormalizationError, "duplicate feature commits"):
                validate_normalized_history(root, baseline)


if __name__ == "__main__":
    unittest.main()
