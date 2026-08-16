from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

from semantic_sync import (
    SyncError,
    approved_classification_blockers,
    codex_environment,
    complete_deferred_browser_contracts,
    conflict_prompt,
    controller_skill_path,
    prepare_candidate_history,
    rebase_candidate,
    reconciliation_prompt,
    reconciliation_retry_prompt,
    review_feature_ids_match,
    review_prompt,
    build_local_macos_app,
    push_and_install_local,
    validate_approved_classification_ids,
    write_normalized_evidence,
)

ROOT = Path(__file__).parents[2]
VALIDATOR_PATH = ROOT / ".agents/skills/paseito-upstream-sync/scripts/validate_decisions.py"
SPEC = importlib.util.spec_from_file_location("paseito_decision_validator", VALIDATOR_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class SemanticSyncTests(unittest.TestCase):
    def test_already_rebased_candidate_validates_against_exact_new_upstream(self) -> None:
        values = {
            "old_upstream_commit": "a" * 40,
            "upstream_commit": "b" * 40,
        }
        completed = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        with (
            patch("semantic_sync.command", return_value=completed),
            patch("semantic_sync.validate_normalized_history") as validate,
            patch("semantic_sync.rebase_candidate") as rebase,
        ):
            prepare_candidate_history(Path("candidate"), values, Path("skill"), Path("run"))
        validate.assert_called_once_with(Path("candidate"), "b" * 40)
        rebase.assert_not_called()

    def test_candidate_not_on_new_upstream_validates_old_history_then_rebases(self) -> None:
        values = {
            "old_upstream_commit": "a" * 40,
            "upstream_commit": "b" * 40,
        }
        completed = subprocess.CompletedProcess([], 1, stdout="", stderr="")
        with (
            patch("semantic_sync.command", return_value=completed),
            patch("semantic_sync.validate_normalized_history") as validate,
            patch("semantic_sync.rebase_candidate") as rebase,
        ):
            prepare_candidate_history(Path("candidate"), values, Path("skill"), Path("run"))
        validate.assert_called_once_with(Path("candidate"), "a" * 40)
        rebase.assert_called_once_with(
            Path("candidate"), values, Path("skill"), Path("run")
        )

    def test_controller_skill_is_independent_of_the_candidate_checkout(self) -> None:
        self.assertEqual(
            controller_skill_path(), ROOT / ".agents/skills/paseito-upstream-sync"
        )
        self.assertTrue(
            (controller_skill_path() / "references/conflict-schema.json").is_file()
        )

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

    def test_conflict_resolution_can_use_a_skill_outside_the_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
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
            (repo / "shared.txt").write_text("old\n", encoding="utf-8")
            git("add", ".")
            git("commit", "-m", "old upstream")
            old = git("rev-parse", "HEAD")
            git("switch", "-c", "candidate")
            (repo / "shared.txt").write_text("local\n", encoding="utf-8")
            git("commit", "-am", "local identity")
            git("switch", "main")
            (repo / "shared.txt").write_text("upstream\n", encoding="utf-8")
            git("commit", "-am", "new upstream")
            new = git("rev-parse", "HEAD")
            git("switch", "candidate")

            skill = root / "controller-skill"
            schema = skill / "references/conflict-schema.json"
            schema.parent.mkdir(parents=True)
            schema.write_text("{}\n", encoding="utf-8")
            run_root = root / "run"
            run_root.mkdir()

            def resolve_conflict(**kwargs: object) -> None:
                self.assertEqual(kwargs["schema"], schema)
                (repo / "shared.txt").write_text("resolved\n", encoding="utf-8")
                output = kwargs["output"]
                assert isinstance(output, Path)
                output.write_text(
                    json.dumps({"schemaVersion": 1, "resolved": True, "blockers": []}) + "\n",
                    encoding="utf-8",
                )

            with patch("semantic_sync.invoke_codex", side_effect=resolve_conflict):
                rebase_candidate(
                    repo,
                    {"old_upstream_commit": old, "upstream_commit": new},
                    skill,
                    run_root,
                )

            self.assertEqual((repo / "shared.txt").read_text(encoding="utf-8"), "resolved\n")
            self.assertEqual(git("merge-base", "HEAD", "main"), new)

    def test_conflict_prompt_uses_controller_skill_and_defers_dependency_checks(self) -> None:
        skill = Path("/controller/paseito-upstream-sync")
        prompt = conflict_prompt(
            {"upstream_commit": "a" * 40},
            ["package.json"],
            skill,
        )
        self.assertIn(str(skill / "SKILL.md"), prompt)
        self.assertIn("Dependencies are intentionally not installed", prompt)
        self.assertIn("do not run package scripts", prompt)
        self.assertIn("not for absent tools", prompt)

    def test_review_prompt_explains_read_only_handoff_and_controller_verification(self) -> None:
        prompt = review_prompt(
            Path(".paseito-semantic-decision.json"),
            Path(".paseito-reconcile-evidence.jsonl"),
            "b" * 40,
            {"old_upstream_commit": "a" * 40, "upstream_commit": "c" * 40},
            ["first-feature", "second-feature"],
        )
        self.assertIn("controller-owned handoff files", prompt)
        self.assertIn("controller independently reruns all contracts", prompt)
        self.assertIn("They may be identical", prompt)
        self.assertIn("controller_contract", prompt)
        self.assertIn("authoritative execution result", prompt)
        self.assertIn("already validated the decision", prompt)
        self.assertIn("stored in `classification`", prompt)
        self.assertIn("There is no feature-level `decision` field", prompt)
        self.assertIn("do not project or query one", prompt)
        self.assertIn("decision-schema.json", prompt)
        self.assertIn("validate_decisions.py", prompt)
        self.assertIn("exactly one finding", prompt)
        self.assertIn("- first-feature\n- second-feature", prompt)
        self.assertIn("no duplicates, omissions, synthetic summary findings, or additional IDs", prompt)

    def test_review_feature_ids_require_exact_registry_coverage(self) -> None:
        expected = ["first-feature", "second-feature"]
        self.assertTrue(
            review_feature_ids_match(
                {"featureFindings": [{"id": "second-feature"}, {"id": "first-feature"}]},
                expected,
            )
        )
        self.assertFalse(
            review_feature_ids_match(
                {
                    "featureFindings": [
                        {"id": "first-feature"},
                        {"id": "second-feature"},
                        {"id": "synthetic-summary"},
                    ]
                },
                expected,
            )
        )
        self.assertFalse(
            review_feature_ids_match(
                {"featureFindings": [{"id": "first-feature"}, {"id": "first-feature"}]},
                expected,
            )
        )

    def test_normalized_evidence_preserves_contracts_and_wraps_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.jsonl"
            destination = root / "evidence.jsonl"
            source.write_text(
                '{"type":"item.completed","exitCode":0}\n'
                "2026-08-13 ERROR failed patch context\n"
                '{"type":"controller_contract","command":"browser","exitCode":0}\n',
                encoding="utf-8",
            )

            write_normalized_evidence(source, destination)

            records = [json.loads(line) for line in destination.read_text().splitlines()]
            self.assertEqual(records[0], {"type": "item.completed", "exitCode": 0})
            self.assertEqual(
                records[1],
                {
                    "type": "codex_diagnostic",
                    "sourceLine": 2,
                    "text": "2026-08-13 ERROR failed patch context",
                },
            )
            self.assertEqual(
                records[2],
                {"type": "controller_contract", "command": "browser", "exitCode": 0},
            )

    def test_reconciliation_requires_separate_contract_evidence(self) -> None:
        prompt = reconciliation_prompt(
            {
                "old_upstream_commit": "a" * 40,
                "upstream_tag": "v1.0.0",
                "upstream_commit": "b" * 40,
            },
            "c" * 40,
        )
        self.assertIn("Run every registry contract as its own command", prompt)
        self.assertIn("Do not combine contracts", prompt)
        self.assertIn("loopback-listener EPERM", prompt)
        self.assertIn("`No test files found`", prompt)
        self.assertIn("treat the listener\nfailure as authoritative", prompt)
        self.assertIn("Never broaden or remove a focused file or\ntest-name filter", prompt)
        self.assertIn("run npm run typecheck", prompt)
        self.assertIn("port only Paseito's line/file review assertions", prompt)
        self.assertIn("e2e/browser/changes-pane.spec.ts", prompt)
        self.assertIn("do not retain the\nfork's superseded host-layout", prompt)

    def test_reconciliation_prompt_binds_human_approved_classifications(self) -> None:
        prompt = reconciliation_prompt(
            {
                "old_upstream_commit": "a" * 40,
                "upstream_tag": "v1.0.0",
                "upstream_commit": "b" * 40,
            },
            "c" * 40,
            ["agent-message-delivery-control", "review-suggestions-v1"],
            ["branch-file-review-state"],
        )
        self.assertIn("- agent-message-delivery-control: adapt", prompt)
        self.assertIn("- review-suggestions-v1: adapt", prompt)
        self.assertIn("- branch-file-review-state: carry_forward", prompt)
        self.assertIn("use its exact listed classification", prompt)

    def test_human_approved_classifications_are_validated_and_enforced(self) -> None:
        self.assertEqual(
            validate_approved_classification_ids(
                ["adapted-feature"],
                ["carried-feature"],
                ["adapted-feature", "carried-feature", "other-feature"],
            ),
            {
                "adapted-feature": "adapt",
                "carried-feature": "carry_forward",
            },
        )
        with self.assertRaisesRegex(SyncError, "duplicate approved classification ids"):
            validate_approved_classification_ids(
                ["adapted-feature"],
                ["adapted-feature"],
                ["adapted-feature"],
            )
        with self.assertRaisesRegex(SyncError, "unknown approved classification ids"):
            validate_approved_classification_ids(
                ["missing-feature"], [], ["adapted-feature"]
            )

        self.assertEqual(
            approved_classification_blockers(
                {
                    "features": [
                        {
                            "id": "adapted-feature",
                            "classification": "carry_forward",
                        }
                    ]
                },
                {
                    "adapted-feature": "adapt",
                    "missing-feature": "carry_forward",
                },
            ),
            [
                "Human-approved classification adapted-feature must be adapt, not 'carry_forward'.",
                "Human-approved classification missing-feature must appear exactly once; found 0.",
            ],
        )
        self.assertEqual(
            approved_classification_blockers(
                {
                    "features": [
                        {"id": "adapted-feature", "classification": "adapt"}
                    ]
                },
                {"adapted-feature": "adapt"},
            ),
            [],
        )

    def test_reconciliation_retry_keeps_identity_and_surfaces_previous_blockers(self) -> None:
        values = {
            "old_upstream_commit": "a" * 40,
            "upstream_tag": "v1.0.0",
            "upstream_commit": "b" * 40,
        }
        prompt = reconciliation_retry_prompt(
            values,
            "c" * 40,
            {"blockers": ["typecheck failed"]},
            2,
        )
        self.assertIn("repair attempt 2", prompt)
        self.assertIn("typecheck failed", prompt)
        self.assertIn("complete decision for every registry feature", prompt)

    def test_controller_completes_only_exact_deferred_browser_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry = root / "registry.json"
            playwright_command = (
                "npm run test:e2e --workspace=@getpaseo/app -- e2e/browser-proof.spec.ts"
            )
            vitest_browser_command = (
                "npm run test:browser --workspace=@getpaseo/app -- "
                "src/browser-proof.browser.test.ts --bail=1"
            )
            electron_renderer_command = (
                "npm run test:e2e:renderer --workspace=@getpaseo/desktop -- "
                "e2e/renderer-proof.spec.ts"
            )
            registry.write_text(
                json.dumps(
                    {
                        "features": [
                            {
                                "id": "browser-proof",
                                "contracts": [
                                    playwright_command,
                                    vitest_browser_command,
                                    electron_renderer_command,
                                    "npm run typecheck",
                                ],
                            },
                            {"id": "shared-browser-proof", "contracts": [playwright_command]},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            decision = {
                "features": [
                    {
                        "id": "browser-proof",
                        "contractChecks": [
                            {"command": playwright_command, "result": "not_run"},
                            {"command": vitest_browser_command, "result": "not_run"},
                            {"command": electron_renderer_command, "result": "not_run"},
                        ],
                    },
                    {
                        "id": "shared-browser-proof",
                        "contractChecks": [
                            {"command": playwright_command, "result": "not_run"}
                        ],
                    },
                ]
            }
            log = root / "evidence.jsonl"
            completed = subprocess.CompletedProcess([], 0, stdout="1 passed\n", stderr="")
            with patch("semantic_sync.command", return_value=completed) as invoked:
                complete_deferred_browser_contracts(root, decision, registry, log)
            self.assertEqual(
                invoked.call_args_list,
                [
                    call(
                        [
                            "npm",
                            "run",
                            "test:e2e",
                            "--workspace=@getpaseo/app",
                            "--",
                            "e2e/browser-proof.spec.ts",
                        ],
                        cwd=root,
                        check=False,
                        timeout=1800,
                    ),
                    call(
                        [
                            "npm",
                            "run",
                            "test:browser",
                            "--workspace=@getpaseo/app",
                            "--",
                            "src/browser-proof.browser.test.ts",
                            "--bail=1",
                        ],
                        cwd=root,
                        check=False,
                        timeout=1800,
                    ),
                    call(
                        [
                            "npm",
                            "run",
                            "test:e2e:renderer",
                            "--workspace=@getpaseo/desktop",
                            "--",
                            "e2e/renderer-proof.spec.ts",
                        ],
                        cwd=root,
                        check=False,
                        timeout=1800,
                    ),
                ],
            )
            self.assertTrue(
                all(
                    check["result"] == "passed"
                    for feature in decision["features"]
                    for check in feature["contractChecks"]
                )
            )
            evidence = [
                json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual([record["exitCode"] for record in evidence], [0, 0, 0])

            decision["features"][0]["contractChecks"][0] = {
                "command": "npm run typecheck",
                "result": "not_run",
            }
            with self.assertRaisesRegex(SyncError, "requires sandboxed proof"):
                complete_deferred_browser_contracts(root, decision, registry, log)

    def test_failed_deferred_browser_contract_surfaces_command_and_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command_text = (
                "npm run test:e2e --workspace=@getpaseo/app -- e2e/browser-proof.spec.ts"
            )
            registry = root / "registry.json"
            registry.write_text(
                json.dumps(
                    {"features": [{"id": "proof", "contracts": [command_text]}]}
                ),
                encoding="utf-8",
            )
            decision = {
                "features": [
                    {
                        "id": "proof",
                        "contractChecks": [{"command": command_text, "result": "not_run"}],
                    }
                ]
            }
            failed = subprocess.CompletedProcess(
                [], 1, stdout="Expected y=344, received y=204\n", stderr=""
            )
            with (
                patch("semantic_sync.command", return_value=failed),
                self.assertRaisesRegex(SyncError, "Expected y=344, received y=204"),
            ):
                complete_deferred_browser_contracts(
                    root, decision, registry, root / "evidence.jsonl"
                )

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

    def test_reconciliation_prompt_distinguishes_input_from_reviewed_tree(self) -> None:
        prompt = reconciliation_prompt(
            {
                "old_upstream_commit": "a" * 40,
                "upstream_tag": "v1.0.0",
                "upstream_commit": "b" * 40,
            },
            "c" * 40,
        )

        self.assertIn("tree before your semantic worktree edits", prompt)
        self.assertIn("Never claim that\ncandidate HEAD", prompt)
        self.assertIn("controller creates the reviewed commit only after your decision", prompt)

    def test_browser_handoff_prompt_covers_every_exact_registry_browser_runner(self) -> None:
        values = {
            "old_upstream_commit": "a" * 40,
            "upstream_tag": "v1.0.0",
            "upstream_commit": "b" * 40,
        }
        prompt = reconciliation_prompt(values, "c" * 40)
        retry = reconciliation_retry_prompt(values, "c" * 40, {"blockers": []}, 2)
        review = review_prompt(
            Path("decision.json"),
            Path("evidence.jsonl"),
            "d" * 40,
            values,
            ["browser-proof"],
        )

        self.assertIn("exact registry browser contract", prompt)
        self.assertIn("sandbox-only browser listener failure", retry)
        self.assertIn("exact registry browser command", review)
        self.assertNotIn("exact registry Playwright", prompt + retry + review)

    def test_semantic_source_is_formatted_and_history_normalized_before_independent_review(
        self,
    ) -> None:
        source = (ROOT / "automation/release/semantic_sync.py").read_text(encoding="utf-8")
        format_source = source.index('command(["npm", "run", "format"], cwd=candidate')
        commit_source = source.index(
            'f"chore: preserve Paseito release metadata for Paseo {values[\'upstream_tag\']}"'
        )
        history_source = source.index(
            'validate_normalized_history(candidate, values["upstream_commit"])'
        )
        review_source = source.index("base_review_prompt = review_prompt(")

        self.assertLess(format_source, commit_source)
        self.assertLess(commit_source, history_source)
        self.assertLess(history_source, review_source)

    def test_generated_decision_record_is_formatted_before_prepare_commit(self) -> None:
        source = (ROOT / "automation/release/semantic_sync.py").read_text(encoding="utf-8")
        write_record = source.index("record_path.write_text(")
        format_record = source.index('["npm", "run", "format:files", "--",')
        prepare_commit = source.index('git(candidate, "commit", "-m", f"chore: prepare')

        self.assertLess(write_record, format_record)
        self.assertLess(format_record, prepare_commit)

    def test_local_macos_build_runs_packaged_smoke_and_verifies_the_app(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            candidate = Path(directory) / "candidate"
            run_root = Path(directory) / "run"
            app = candidate / "packages/desktop/release/mac-arm64/Paseito.app"
            app.mkdir(parents=True)
            run_root.mkdir()
            with patch("semantic_sync.command") as invoked:
                self.assertEqual(
                    build_local_macos_app(candidate, run_root, "0.7.2-paseito.55"),
                    app,
                )
            build = invoked.call_args_list[0]
            self.assertEqual(
                build.args[0],
                [
                    "npm",
                    "run",
                    "build:desktop",
                    "--",
                    "--publish",
                    "never",
                    "--mac",
                    "--arm64",
                ],
            )
            self.assertEqual(build.kwargs["env"]["PASEO_DESKTOP_SMOKE"], "1")
            self.assertIn("--verify-only", invoked.call_args_list[1].args[0])

    def test_local_promotion_only_force_pushes_the_branch_then_installs(self) -> None:
        completed = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        with (
            patch("semantic_sync.git", return_value=f"{'a' * 40}\trefs/heads/paseito"),
            patch("semantic_sync.command", return_value=completed) as invoked,
        ):
            push_and_install_local(
                Path("candidate"),
                "a" * 40,
                "b" * 40,
                "0.7.2-paseito.55",
                Path("candidate/Paseito.app"),
            )
        push = invoked.call_args_list[0].args[0]
        self.assertEqual(push[:2], ["git", "push"])
        self.assertIn(
            f"--force-with-lease=refs/heads/paseito:{'a' * 40}", push
        )
        self.assertEqual(push[-1], f"{'b' * 40}:refs/heads/paseito")
        install = invoked.call_args_list[1].args[0]
        self.assertIn("automation/installer/paseito_installer.py", install[1])
        self.assertNotIn("gh", str(invoked.call_args_list))

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

    def test_completed_adaptation_does_not_require_invented_residual_work(self) -> None:
        registry = {
            "features": [
                {
                    "id": "adapted-feature",
                    "permanent": False,
                }
            ]
        }
        decision = {
            "schemaVersion": 1,
            "upstreamTag": "v1.0.0",
            "upstreamCommit": "a" * 40,
            "inputCommit": "b" * 40,
            "blocked": False,
            "blockers": [],
            "features": [
                {
                    "id": "adapted-feature",
                    "classification": "adapt",
                    "confidence": "certain",
                    "summary": "Retained the behavior that upstream does not provide.",
                    "evidence": [
                        {
                            "kind": "file",
                            "reference": "path",
                            "explanation": "Residual behavior remains implemented.",
                        }
                    ],
                    "contractChecks": [{"command": "test", "result": "passed"}],
                    "residualWork": [],
                }
            ],
            "verificationRecommendations": [],
        }

        VALIDATOR.validate_decision(decision, registry)



if __name__ == "__main__":
    unittest.main()
