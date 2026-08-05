from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from semantic_sync import SyncError, codex_environment, rebase_candidate, review_prompt, validate_artifacts

ROOT = Path(__file__).parents[2]
VALIDATOR_PATH = ROOT / ".agents/skills/paseito-upstream-sync/scripts/validate_decisions.py"
SPEC = importlib.util.spec_from_file_location("paseito_decision_validator", VALIDATOR_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class SemanticSyncTests(unittest.TestCase):
    def test_controller_performs_clean_mechanical_rebase(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            repo.mkdir()

            def git(*args: str) -> str:
                return subprocess.run(
                    ["git", *args],
                    cwd=repo,
                    check=True,
                    text=True,
                    stdout=subprocess.PIPE,
                ).stdout.strip()

            git("init", "-b", "main")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            (repo / "upstream.txt").write_text("old\n", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "old upstream")
            old = git("rev-parse", "HEAD")
            git("switch", "-c", "candidate")
            (repo / "feature.txt").write_text("local\n", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "local feature")
            git("switch", "main")
            (repo / "upstream.txt").write_text("new\n", encoding="utf-8")
            git("commit", "-am", "new upstream")
            new = git("rev-parse", "HEAD")
            git("switch", "candidate")
            rebase_candidate(
                repo,
                {"old_upstream_commit": old, "upstream_commit": new},
                repo / "unused-skill",
                repo / "unused-run",
            )
            self.assertEqual(git("merge-base", "HEAD", "main"), new)
            self.assertEqual((repo / "feature.txt").read_text(encoding="utf-8"), "local\n")

    def test_review_prompt_explains_read_only_handoff_and_controller_verification(self) -> None:
        prompt = review_prompt(
            Path(".paseito-semantic-decision.json"),
            "b" * 40,
            {"old_upstream_commit": "a" * 40, "upstream_commit": "c" * 40},
        )
        self.assertIn("controller-owned handoff files", prompt)
        self.assertIn("controller independently reruns all contracts", prompt)

    def test_codex_environment_does_not_delegate_promotion_credentials(self) -> None:
        sensitive = {
            "GH_TOKEN": "gh",
            "GITHUB_TOKEN": "github",
            "CODEX_API_KEY": "codex",
            "OPENAI_API_KEY": "openai",
        }
        with patch.dict(os.environ, sensitive, clear=False):
            environment = codex_environment()
        self.assertTrue(set(sensitive).isdisjoint(environment))

    def test_permanent_feature_cannot_be_classified_upstream_complete(self) -> None:
        registry = json.loads((ROOT / "automation/feature-registry.json").read_text(encoding="utf-8"))
        features = []
        for item in registry["features"]:
            features.append(
                {
                    "id": item["id"],
                    "classification": "carry_forward",
                    "confidence": "certain",
                    "summary": "preserved",
                    "evidence": [{"kind": "file", "reference": "path", "explanation": "present"}],
                    "contractChecks": [{"command": "test", "result": "passed"}],
                    "residualWork": [],
                }
            )
        features[0]["classification"] = "upstream_complete"
        decision = {
            "schemaVersion": 1,
            "upstreamTag": "v1.0.0",
            "upstreamCommit": "a" * 40,
            "inputCommit": "b" * 40,
            "blocked": False,
            "blockers": [],
            "features": features,
            "verificationRecommendations": [],
        }
        with self.assertRaises(VALIDATOR.DecisionError):
            VALIDATOR.validate_decision(decision, registry)

    def test_artifacts_are_bound_to_decision_checksum_and_required_attestations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "Paseito-1.0.0-paseito.1-arm64.zip"
            artifact.write_bytes(b"candidate")
            digest = hashlib.sha256(b"candidate").hexdigest()
            checksum = artifact.with_name(artifact.name + ".sha256")
            checksum.write_text(f"{digest}  {artifact.name}\n", encoding="utf-8")
            decision = root / "decision.json"
            decision.write_text('{"decision": {}, "review": {}}\n', encoding="utf-8")
            commit = "c" * 40
            values = {
                "upstream_tag": "v1.0.0",
                "upstream_commit": "a" * 40,
                "paseito_version": "1.0.0-paseito.1",
                "release_tag": "paseito-v1.0.0-paseito.1",
            }
            tests = {
                name: "passed"
                for name in (
                    "semanticReconciliation",
                    "independentReview",
                    "format",
                    "lint",
                    "typecheck",
                    "feature",
                    "upstream",
                    "packagedDesktopSmoke",
                )
            }
            provenance = {
                "upstreamTag": values["upstream_tag"],
                "upstreamCommit": values["upstream_commit"],
                "paseitoCommit": commit,
                "paseitoVersion": values["paseito_version"],
                "releaseTag": values["release_tag"],
                "artifact": {"name": artifact.name, "sha256": digest},
                "tests": tests,
                "semanticDecision": {"sha256": hashlib.sha256(decision.read_bytes()).hexdigest()},
            }
            (root / "provenance.json").write_text(json.dumps(provenance), encoding="utf-8")
            self.assertEqual(validate_artifacts(root, values, commit, decision)[0], artifact)
            checksum.write_text(f"{'0' * 64}  {artifact.name}\n", encoding="utf-8")
            with self.assertRaises(SyncError):
                validate_artifacts(root, values, commit, decision)


if __name__ == "__main__":
    unittest.main()
