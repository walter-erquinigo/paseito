#!/usr/bin/env python3
"""Local Codex-driven semantic upstream reconciliation controller."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from history_normalization import HistoryNormalizationError, validate_normalized_history

FORK_URL = "https://github.com/walter-erquinigo/paseito.git"
UPSTREAM_URL = "https://github.com/getpaseo/paseo.git"


class SyncError(RuntimeError):
    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category = category


def controller_skill_path() -> Path:
    """Return the controller-owned skill available before candidate commits replay."""
    return Path(__file__).resolve().parents[2] / ".agents/skills/paseito-upstream-sync"


def command(
    args: Sequence[str],
    *,
    cwd: Path,
    check: bool = True,
    timeout: int | None = None,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(args),
        cwd=cwd,
        text=True,
        input=input_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=timeout,
        env=env,
    )
    if check and result.returncode:
        detail = (result.stderr or result.stdout).strip().splitlines()
        summary = next((line.strip() for line in reversed(detail) if re.search(r"[A-Za-z]", line)), "")
        raise SyncError("command", summary[-500:] if summary else f"command failed: {args[0]}")
    return result


def git(cwd: Path, *args: str, check: bool = True) -> str:
    return command(["git", *args], cwd=cwd, check=check).stdout.strip()


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SyncError("state", f"expected JSON object: {path.name}")
    return value


def approved_classifications(
    approved_adaptations: Sequence[str], approved_carry_forwards: Sequence[str]
) -> list[tuple[str, str]]:
    return [
        *((feature_id, "adapt") for feature_id in approved_adaptations),
        *((feature_id, "carry_forward") for feature_id in approved_carry_forwards),
    ]


def render_approved_classifications(
    approved_adaptations: Sequence[str], approved_carry_forwards: Sequence[str]
) -> str:
    decisions = approved_classifications(approved_adaptations, approved_carry_forwards)
    if not decisions:
        return "- none"
    return "\n".join(
        f"- {feature_id}: {classification}"
        for feature_id, classification in decisions
    )


def reconciliation_prompt(
    values: dict[str, str],
    input_commit: str,
    approved_adaptations: Sequence[str] = (),
    approved_carry_forwards: Sequence[str] = (),
) -> str:
    return f"""Use $paseito-upstream-sync to reconcile this candidate checkout.

Exact inputs:
- rebased input commit: {input_commit}
- old upstream commit: {values['old_upstream_commit']}
- new stable upstream tag: {values['upstream_tag']}
- new upstream commit: {values['upstream_commit']}

Human-approved binding feature decisions:
{render_approved_classifications(approved_adaptations, approved_carry_forwards)}

Every listed feature must remain in the registry and use its exact listed classification. Preserve
and integrate residual Paseito behavior with upstream. Do not reinterpret a binding decision as a
different classification or a blocker merely because upstream has nearby code.

Do not access the network; the controller already completed the mechanical rebase onto the exact new
upstream commit. Evaluate every feature in automation/feature-registry.json and edit the worktree to
carry forward, adapt, or remove local behavior as the evidence requires. Retire an upstream-eligible
feature only with passing behavioral proof and concrete upstream evidence. Preserve permanent
features. Do not stage, commit, or modify Git metadata. Never push, tag, publish, install, dispatch
workflows, or open issues.
The rebased input commit identifies the tree before your semantic worktree edits. Never claim that
candidate HEAD or the final candidate matches that input commit when you changed the worktree. Cite
the input commit only for facts it actually proves; use file and test evidence for the resulting
worktree. The controller creates the reviewed commit only after your decision, so do not invent its
SHA or claim equality with it.
Run every registry contract as its own command. Do not combine contracts with shell loops, `&&`, or
command groups; the independent reviewer must see a complete exit status and transcript for each
individual contract. The workspace-write sandbox cannot bind loopback listeners. If and only if an
exact registry browser contract fails before test execution with a loopback-listener EPERM, keep
the feature's semantic classification, record that one check as not_run, and do not block solely for
that sandbox limitation. Vitest can print `No test files found` while aborting browser-project startup
after the same listener EPERM; when both appear in one exact-contract transcript, treat the listener
failure as authoritative and use the same not_run handoff. Never broaden or remove a focused file or
test-name filter to work around the sandbox. The controller will run that exact registry command
outside the sandbox, capture its transcript, and fail closed before review if it does not pass. Never
defer a unit test, typecheck, lint, formatting check, or a browser test that actually began executing.

Before returning, run npm run typecheck and repair every rebase integration error. In particular,
adapt fork-added E2E specs to any upstream E2E directory move, reconcile every locale against the
English resource shape, remove stale send-behavior values, and restore imports lost during conflict
resolution. For `branch-file-review-state`, port only Paseito's line/file review assertions into
upstream's `e2e/browser/changes-pane.spec.ts`, update that registry contract, and do not retain the
fork's superseded host-layout, kebab-menu, or shared-rail assertions in a separate
`diff-row-alignment.spec.ts`. A typecheck failure is a blocker, not a deferred check.
Return the decision object required by the skill schema. Set blocked=true rather than guessing.
"""


def reconciliation_retry_prompt(
    values: dict[str, str],
    input_commit: str,
    previous: dict[str, Any],
    attempt: int,
    approved_adaptations: Sequence[str] = (),
    approved_carry_forwards: Sequence[str] = (),
) -> str:
    blockers = previous.get("blockers")
    rendered = "\n".join(
        f"- {item}" for item in blockers if isinstance(item, str)
    ) if isinstance(blockers, list) else "- The previous result was blocked."
    return reconciliation_prompt(
        values,
        input_commit,
        approved_adaptations,
        approved_carry_forwards,
    ) + f"""

This is repair attempt {attempt} in the same candidate worktree. Preserve correct edits from the
previous pass and resolve these reported blockers before returning a fresh complete decision:
{rendered}

Do not repeat a sandbox-only browser listener failure as a blocker; use the narrowly allowed
not_run handoff described above. All source, unit, typecheck, lint, and formatting failures must be
fixed and rerun. Return the complete decision for every registry feature, not a partial update.
"""


def conflict_prompt(values: dict[str, str], files: list[str], skill: Path) -> str:
    rendered = "\n".join(f"- {path}" for path in files)
    return f"""Resolve the current mechanical rebase conflict using the controller-owned
Paseito upstream-sync instructions at {skill / 'SKILL.md'}.

Exact new upstream commit: {values['upstream_commit']}
Unmerged paths:
{rendered}

Inspect the old upstream, new upstream, feature registry, conflict stages, and surrounding code.
Edit the worktree to resolve every listed path semantically while preserving permanent behavior.
Do not run git add, git commit, git rebase, or any command that modifies Git metadata. Do not access
the network. Dependencies are intentionally not installed during this mechanical conflict phase;
do not run package scripts or report missing dependencies as blockers. The controller installs
dependencies and performs all required verification after the rebase completes. Validate conflict
markers, syntax, and metadata with dependency-free checks only. Return the conflict-resolution
schema object. Set resolved=false only for an unresolved semantic ambiguity, not for absent tools.
"""


def review_prompt(
    decision_path: Path,
    evidence_path: Path,
    candidate_commit: str,
    values: dict[str, str],
    feature_ids: list[str],
) -> str:
    rendered_feature_ids = "\n".join(f"- {feature_id}" for feature_id in feature_ids)
    return f"""Independently review the Paseito semantic reconciliation at commit {candidate_commit}.
Read automation/feature-registry.json, {decision_path.name}, {evidence_path.name}, the old upstream commit
{values['old_upstream_commit']}, and the new upstream commit {values['upstream_commit']}.
The decision's inputCommit is the mechanically rebased tree before Codex's semantic worktree edits;
the reviewed commit above is the resulting tree. They may be identical when every decision is
carry_forward and no semantic edit is needed. The evidence JSONL is the first pass's captured command
transcript plus controller-owned contract records; use it to substantiate recorded contract results.
The transcript may contain multiple repair attempts. For an exact registry browser command that was
`not_run` after a sandbox listener failure, a later `controller_contract` record with exitCode 0 is
the authoritative execution result and substantiates the decision's final `passed` result.
The controller already validated the decision against the registry and decision schema. Each
feature's disposition is stored in `classification`, with its confidence and `contractChecks` beside
it. There is no feature-level `decision` field: do not project or query one and mistake its resulting
null value for malformed input. If you suspect a structural defect, inspect the original fields,
`.agents/skills/paseito-upstream-sync/references/decision-schema.json`, and
`.agents/skills/paseito-upstream-sync/scripts/validate_decisions.py` before rejecting it.
Check every feature decision and its cited evidence. Pay special attention to features classified
upstream_complete: confirm executable equivalence and passing contract evidence, not changelog
similarity. Confirm permanent features remain and the new upstream commit is an ancestor.
The featureFindings array must contain exactly one finding for each registry feature ID below, with
no duplicates, omissions, synthetic summary findings, or additional IDs:
{rendered_feature_ids}
Record whole-candidate integrity evidence in the relevant feature explanations or blockers instead
of creating an extra featureFinding.
The controller already verified that tracked files are clean. The untracked decision, evidence, and
review files are controller-owned handoff files and are not candidate changes. This sandbox is intentionally
read-only, so audit the recorded commands and repository evidence but do not rerun tests that need a
writable temporary directory; the controller independently reruns all contracts after this review.
Do not modify files, push, tag, publish, install, dispatch workflows, or open issues. Return only the
object required by the review schema; disapprove when any evidence is uncertain.
"""


def review_feature_ids_match(review: dict[str, Any], expected_ids: list[str]) -> bool:
    findings = review.get("featureFindings")
    if not isinstance(findings, list):
        return False
    actual_ids = [finding.get("id") for finding in findings if isinstance(finding, dict)]
    return len(actual_ids) == len(expected_ids) and sorted(actual_ids) == sorted(expected_ids)


def validate_approved_classification_ids(
    approved_adaptations: Sequence[str],
    approved_carry_forwards: Sequence[str],
    feature_ids: Sequence[str],
) -> dict[str, str]:
    decisions = approved_classifications(approved_adaptations, approved_carry_forwards)
    decision_ids = [feature_id for feature_id, _ in decisions]
    duplicates = sorted(
        feature_id for feature_id in set(decision_ids) if decision_ids.count(feature_id) > 1
    )
    unknown = sorted(set(decision_ids) - set(feature_ids))
    if duplicates:
        raise SyncError(
            "semantic-sync",
            f"duplicate approved classification ids: {', '.join(duplicates)}",
        )
    if unknown:
        raise SyncError(
            "semantic-sync",
            f"unknown approved classification ids: {', '.join(unknown)}",
        )
    return dict(decisions)


def approved_classification_blockers(
    decision: dict[str, Any], expected_classifications: dict[str, str]
) -> list[str]:
    features = decision.get("features")
    if not isinstance(features, list):
        return ["The semantic decision has no feature classifications."]
    classifications: dict[str, list[Any]] = {}
    for feature in features:
        if not isinstance(feature, dict) or not isinstance(feature.get("id"), str):
            continue
        classifications.setdefault(feature["id"], []).append(feature.get("classification"))
    blockers: list[str] = []
    for feature_id, expected in expected_classifications.items():
        values = classifications.get(feature_id, [])
        if len(values) != 1:
            blockers.append(
                f"Human-approved classification {feature_id} must appear exactly once; found {len(values)}."
            )
        elif values[0] != expected:
            blockers.append(
                f"Human-approved classification {feature_id} must be {expected}, not {values[0]!r}."
            )
    return blockers


def codex_environment() -> dict[str, str]:
    env = os.environ.copy()
    for key in ("GH_TOKEN", "GITHUB_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY"):
        env.pop(key, None)
    return env


def invoke_codex(
    *,
    candidate: Path,
    prompt: str,
    schema: Path,
    output: Path,
    sandbox: str,
    log: Path,
) -> None:
    args = [
        "codex",
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        sandbox,
        "--output-schema",
        str(schema),
        "--output-last-message",
        str(output),
        "--json",
        prompt,
    ]
    result = command(args, cwd=candidate, check=False, timeout=3600, env=codex_environment())
    log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode or not output.exists():
        raise SyncError("codex", "Codex reconciliation did not produce a valid result")


def rebase_candidate(candidate: Path, values: dict[str, str], skill: Path, run_root: Path) -> None:
    if values["old_upstream_commit"] == values["upstream_commit"]:
        return
    environment = {**os.environ, "GIT_EDITOR": "true", "GIT_SEQUENCE_EDITOR": "true"}
    result = command(
        [
            "git",
            "rebase",
            "--onto",
            values["upstream_commit"],
            values["old_upstream_commit"],
        ],
        cwd=candidate,
        check=False,
        timeout=600,
        env=environment,
    )
    round_number = 0
    while result.returncode:
        files = git(candidate, "diff", "--name-only", "--diff-filter=U").splitlines()
        if not files:
            detail = (result.stderr or result.stdout).strip()
            raise SyncError("semantic-sync", detail[-500:] or "mechanical rebase failed")
        round_number += 1
        if round_number > 50:
            raise SyncError("semantic-sync", "rebase exceeded the conflict-resolution limit")
        output = candidate / ".paseito-conflict-resolution.json"
        invoke_codex(
            candidate=candidate,
            prompt=conflict_prompt(values, files, skill),
            schema=skill / "references/conflict-schema.json",
            output=output,
            sandbox="workspace-write",
            log=run_root / f"codex-conflict-{round_number}.jsonl",
        )
        resolution = load_object(output)
        output.unlink()
        if resolution.get("schemaVersion") != 1 or not resolution.get("resolved") or resolution.get("blockers"):
            raise SyncError("semantic-sync", "Codex blocked conflict resolution")
        for relative in files:
            path = candidate / relative
            if not path.exists() or not path.is_file():
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
            if re.search(r"^(<<<<<<< |=======|>>>>>>> )", content, re.MULTILINE):
                raise SyncError("semantic-sync", f"conflict markers remain in {relative}")
        git(candidate, "add", "-A")
        result = command(
            ["git", "rebase", "--continue"],
            cwd=candidate,
            check=False,
            timeout=600,
            env=environment,
        )
    if git(candidate, "status", "--porcelain", "--untracked-files=no"):
        raise SyncError("semantic-sync", "mechanical rebase left tracked worktree changes")


def prepare_candidate_history(
    candidate: Path,
    values: dict[str, str],
    skill: Path,
    run_root: Path,
) -> None:
    already_rebased = (
        command(
            [
                "git",
                "merge-base",
                "--is-ancestor",
                values["upstream_commit"],
                "HEAD",
            ],
            cwd=candidate,
            check=False,
        ).returncode
        == 0
    )
    validation_base = (
        values["upstream_commit"] if already_rebased else values["old_upstream_commit"]
    )
    validate_normalized_history(candidate, validation_base)
    if not already_rebased:
        rebase_candidate(candidate, values, skill, run_root)


def focused_verification(candidate: Path) -> None:
    commands = [
        ["npm", "ci"],
        ["npm", "run", "format:check"],
        ["npm", "run", "lint"],
        ["npm", "run", "build:server"],
        ["npm", "run", "build", "--workspace=@getpaseo/expo-two-way-audio"],
        ["npm", "run", "typecheck"],
        [
            "npx",
            "vitest",
            "run",
            "packages/protocol/src/messages.checkout-commits.test.ts",
            "packages/protocol/src/agent-deep-link.test.ts",
            "packages/server/src/utils/checkout-git.commits.test.ts",
            "packages/app/src/git/changes-base-selection.test.ts",
            "packages/desktop/src/agent-navigation.test.ts",
            "packages/cli/src/cli-surface.test.ts",
            "--bail=1",
        ],
    ]
    for args in commands:
        command(args, cwd=candidate, timeout=1800)
    for suite in ("release", "installer", "launchagents", "migration", "reporting"):
        command(
            [sys.executable, "-m", "unittest", "discover", "-s", f"automation/{suite}", "-p", "test_*.py"],
            cwd=candidate,
            timeout=600,
        )
    if git(candidate, "status", "--porcelain"):
        raise SyncError("verification", "verification changed the candidate worktree")


def complete_deferred_browser_contracts(
    candidate: Path,
    decision: dict[str, Any],
    registry_path: Path,
    evidence_log: Path,
) -> None:
    """Run each sandbox-blocked, exact registry browser command once outside Codex."""
    registry = load_object(registry_path)
    browser_contract_prefixes = (
        "npm run test:e2e --workspace=@getpaseo/app -- ",
        "npm run test:browser --workspace=@getpaseo/app -- ",
        "npm run test:e2e:renderer --workspace=@getpaseo/desktop -- ",
    )
    allowed = {
        command_text
        for feature in registry.get("features", [])
        if isinstance(feature, dict)
        for command_text in feature.get("contracts", [])
        if isinstance(command_text, str)
        and command_text.startswith(browser_contract_prefixes)
    }
    deferred: dict[str, list[dict[str, Any]]] = {}
    for feature in decision.get("features", []):
        if not isinstance(feature, dict):
            continue
        checks = feature.get("contractChecks")
        if not isinstance(checks, list):
            continue
        for check in checks:
            if not isinstance(check, dict) or check.get("result") != "not_run":
                continue
            command_text = check.get("command")
            if not isinstance(command_text, str) or command_text not in allowed:
                raise SyncError(
                    "semantic-sync", "Codex deferred a contract that requires sandboxed proof"
                )
            deferred.setdefault(command_text, []).append(check)
    for command_text, matching_checks in deferred.items():
        result = command(
            shlex.split(command_text),
            cwd=candidate,
            check=False,
            timeout=1800,
        )
        with evidence_log.open("a", encoding="utf-8") as stream:
            stream.write(
                json.dumps(
                    {
                        "type": "controller_contract",
                        "command": command_text,
                        "exitCode": result.returncode,
                        "stdout": result.stdout,
                        "stderr": result.stderr,
                    },
                    sort_keys=True,
                )
                + "\n"
            )
        if result.returncode:
            transcript = (result.stdout + result.stderr).strip()
            raise SyncError(
                "verification",
                f"deferred browser contract failed: {command_text}\n{transcript[-4000:]}",
            )
        for check in matching_checks:
            check["result"] = "passed"


def write_normalized_evidence(source: Path, destination: Path) -> None:
    """Write independently parseable JSONL while retaining non-JSON Codex diagnostics."""
    with destination.open("w", encoding="utf-8") as stream:
        for line_number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                record = {
                    "type": "codex_diagnostic",
                    "sourceLine": line_number,
                    "text": line,
                }
            stream.write(json.dumps(record, sort_keys=True) + "\n")


def discover(control_repo: Path, force: bool) -> dict[str, str]:
    args = [sys.executable, "automation/release/check_upstream.py"]
    if force:
        args.append("--force")
    result = command(args, cwd=control_repo, timeout=120)
    values = json.loads(result.stdout)
    if not isinstance(values, dict):
        raise SyncError("release", "release discovery returned invalid output")
    return {str(key): str(value) for key, value in values.items()}


def build_local_macos_app(candidate: Path, run_root: Path, version: str) -> Path:
    smoke_artifacts = run_root / "desktop-smoke"
    smoke_artifacts.mkdir(exist_ok=True)
    environment = os.environ.copy()
    environment.update(
        {
            "CSC_IDENTITY_AUTO_DISCOVERY": "false",
            "EP_GH_IGNORE_TIME": "true",
            "PASEO_DESKTOP_SMOKE": "1",
            "PASEO_DESKTOP_SMOKE_ARTIFACT_DIR": str(smoke_artifacts),
        }
    )
    command(
        ["npm", "run", "build:desktop", "--", "--publish", "never", "--mac", "--arm64"],
        cwd=candidate,
        timeout=3600,
        env=environment,
    )
    app = candidate / "packages/desktop/release/mac-arm64/Paseito.app"
    if not app.is_dir():
        raise SyncError("artifact", "local desktop build did not produce Paseito.app")
    command(
        [
            sys.executable,
            str(candidate / "automation/installer/paseito_installer.py"),
            "--app",
            str(app),
            "--version",
            version,
            "--verify-only",
        ],
        cwd=candidate,
        timeout=120,
    )
    return app


def push_and_install_local(
    candidate: Path,
    original_commit: str,
    commit: str,
    version: str,
    app: Path,
) -> None:
    branch_lines = git(candidate, "ls-remote", "fork", "refs/heads/paseito").splitlines()
    remote_head = branch_lines[0].split()[0] if branch_lines else ""
    if remote_head == original_commit:
        command(
            [
                "git",
                "push",
                f"--force-with-lease=refs/heads/paseito:{original_commit}",
                "fork",
                f"{commit}:refs/heads/paseito",
            ],
            cwd=candidate,
            timeout=180,
        )
    elif remote_head != commit:
        raise SyncError("promotion", "remote paseito branch differs from the verified candidate")
    command(
        [
            sys.executable,
            str(candidate / "automation/installer/paseito_installer.py"),
            "--app",
            str(app),
            "--version",
            version,
        ],
        cwd=candidate,
        timeout=600,
    )


def synchronize(
    control_repo: Path,
    state_root: Path,
    force: bool = False,
    approved_adaptations: Sequence[str] = (),
    approved_carry_forwards: Sequence[str] = (),
) -> int:
    values = discover(control_repo, force)
    if values.get("needs_release") != "true":
        return 0
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_tag = values["upstream_tag"].replace("/", "-")
    run_root = state_root / "runs" / f"{stamp}-{safe_tag}"
    candidate = run_root / "candidate"
    run_root.mkdir(parents=True, mode=0o700)
    command(["git", "clone", "--branch", "paseito", "--single-branch", FORK_URL, str(candidate)], cwd=run_root, timeout=300)
    git(candidate, "remote", "rename", "origin", "fork")
    git(candidate, "remote", "add", "upstream", UPSTREAM_URL)
    git(candidate, "fetch", "--tags", "upstream", values["upstream_tag"])
    if git(candidate, "rev-parse", f"{values['upstream_tag']}^{{}}") != values["upstream_commit"]:
        raise SyncError("upstream", "fetched upstream tag does not match its peeled commit")
    original_commit = git(candidate, "rev-parse", "HEAD")
    if original_commit != git(candidate, "rev-parse", "fork/paseito"):
        raise SyncError("repository", "candidate did not start at the remote Paseito branch")
    # Codex needs repository history, not transport authority. Remove both remotes during its
    # write and review passes; the sandbox independently denies network access.
    git(candidate, "remote", "remove", "fork")
    git(candidate, "remote", "remove", "upstream")
    git(candidate, "switch", "-c", f"automation/candidate/{safe_tag}-{stamp.lower()}")

    git(candidate, "config", "user.name", "Paseito Local Automation")
    git(candidate, "config", "user.email", "werquinigo@users.noreply.github.com")
    try:
        prepare_candidate_history(candidate, values, controller_skill_path(), run_root)
    except HistoryNormalizationError as error:
        raise SyncError("history-normalization", str(error)) from error
    skill = candidate / ".agents/skills/paseito-upstream-sync"
    command(["npm", "ci"], cwd=candidate, timeout=1800)
    if git(candidate, "status", "--porcelain", "--untracked-files=no"):
        raise SyncError("verification", "dependency installation changed tracked candidate files")
    input_commit = git(candidate, "rev-parse", "HEAD")
    decision_path = candidate / ".paseito-semantic-decision.json"
    review_path = candidate / ".paseito-semantic-review.json"
    evidence_path = candidate / ".paseito-reconcile-evidence.jsonl"
    reconcile_log = run_root / "codex-reconcile.jsonl"
    reconcile_log.unlink(missing_ok=True)
    registry = load_object(candidate / "automation/feature-registry.json")
    feature_ids = [str(feature["id"]) for feature in registry["features"]]
    expected_classifications = validate_approved_classification_ids(
        approved_adaptations,
        approved_carry_forwards,
        feature_ids,
    )
    decision: dict[str, Any] = {}
    for attempt in range(1, 4):
        decision_path.unlink(missing_ok=True)
        step_log = run_root / f"codex-reconcile-{attempt}.jsonl"
        prompt = (
            reconciliation_prompt(
                values,
                input_commit,
                approved_adaptations,
                approved_carry_forwards,
            )
            if attempt == 1
            else reconciliation_retry_prompt(
                values,
                input_commit,
                decision,
                attempt,
                approved_adaptations,
                approved_carry_forwards,
            )
        )
        invoke_codex(
            candidate=candidate,
            prompt=prompt,
            schema=skill / "references/decision-schema.json",
            output=decision_path,
            sandbox="workspace-write",
            log=step_log,
        )
        with reconcile_log.open("ab") as stream:
            stream.write(step_log.read_bytes())
        decision = load_object(decision_path)
        if (
            decision.get("inputCommit") != input_commit
            or decision.get("upstreamTag") != values["upstream_tag"]
            or decision.get("upstreamCommit") != values["upstream_commit"]
        ):
            raise SyncError("semantic-sync", "Codex reported a different candidate")
        if decision.get("blocked"):
            continue
        classification_blockers = approved_classification_blockers(
            decision, expected_classifications
        )
        if classification_blockers:
            decision["blocked"] = True
            decision["blockers"] = classification_blockers
            decision["verificationRecommendations"] = [
                "Honor every binding human-approved feature decision and rerun affected contracts."
            ]
            continue
        try:
            complete_deferred_browser_contracts(
                candidate,
                decision,
                candidate / "automation/feature-registry.json",
                reconcile_log,
            )
        except SyncError as error:
            if attempt == 3:
                raise
            decision["blocked"] = True
            decision["blockers"] = [str(error)]
            decision["verificationRecommendations"] = [
                "Repair the failing browser contract and rerun every affected focused contract."
            ]
            continue
        break
    write_normalized_evidence(reconcile_log, evidence_path)
    if decision.get("blocked"):
        raise SyncError("semantic-sync", "Codex blocked reconciliation after repair attempts")
    decision_path.write_text(json.dumps(decision, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_normalized_evidence(reconcile_log, evidence_path)
    command(
        [sys.executable, str(skill / "scripts/validate_decisions.py"), "--registry", "automation/feature-registry.json", "--decision", str(decision_path)],
        cwd=candidate,
    )
    # Codex may make semantically correct edits that are not byte-for-byte formatter output. Format
    # before committing so the independent reviewer examines the exact source tree that later gates
    # and packaging will consume.
    command(["npm", "run", "format"], cwd=candidate, timeout=600)
    if command(["git", "merge-base", "--is-ancestor", values["upstream_commit"], "HEAD"], cwd=candidate, check=False).returncode:
        raise SyncError("semantic-sync", "new upstream commit is not an ancestor of the candidate")
    decision_path.unlink()
    evidence_path.unlink()
    git(candidate, "add", "-A")
    if command(["git", "diff", "--cached", "--quiet"], cwd=candidate, check=False).returncode:
        git(
            candidate,
            "commit",
            "-m",
            f"chore: preserve Paseito release metadata for Paseo {values['upstream_tag']}",
        )
    candidate_commit = git(candidate, "rev-parse", "HEAD")
    if git(candidate, "status", "--porcelain"):
        raise SyncError("semantic-sync", "semantic reconciliation left uncommitted changes")
    try:
        validate_normalized_history(candidate, values["upstream_commit"])
    except HistoryNormalizationError as error:
        raise SyncError(
            "history-normalization",
            f"post-reconciliation history is not normalized: {error}",
        ) from error
    decision_path.write_text(json.dumps(decision, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_normalized_evidence(reconcile_log, evidence_path)

    review: dict[str, Any] = {}
    base_review_prompt = review_prompt(
        decision_path, evidence_path, candidate_commit, values, feature_ids
    )
    for attempt in range(1, 4):
        review_path.unlink(missing_ok=True)
        prompt = base_review_prompt
        if attempt > 1:
            previous_ids = [
                finding.get("id")
                for finding in review.get("featureFindings", [])
                if isinstance(finding, dict)
            ]
            prompt += (
                "\nYour previous response was rejected because its featureFinding IDs were "
                f"{previous_ids!r}. Return exactly the listed registry IDs and no others.\n"
            )
        invoke_codex(
            candidate=candidate,
            prompt=prompt,
            schema=skill / "references/review-schema.json",
            output=review_path,
            sandbox="read-only",
            log=run_root / f"codex-review-{attempt}.jsonl",
        )
        review = load_object(review_path)
        if review_feature_ids_match(review, feature_ids):
            break
    else:
        raise SyncError("review", "independent Codex review did not cover every feature exactly once")
    command(
        [
            sys.executable,
            str(skill / "scripts/validate_decisions.py"),
            "--registry",
            "automation/feature-registry.json",
            "--decision",
            str(decision_path),
            "--review",
            str(review_path),
            "--reviewed-commit",
            candidate_commit,
        ],
        cwd=candidate,
    )
    if not review.get("approved"):
        raise SyncError("review", "independent Codex review rejected the candidate")

    git(candidate, "remote", "add", "fork", FORK_URL)
    decision_path.unlink()
    review_path.unlink()
    evidence_path.unlink()
    command(
        [sys.executable, str(candidate / "automation/release/set_version.py"), values["paseito_version"], "--root", str(candidate), "--upstream-tag", values["upstream_tag"], "--upstream-commit", values["upstream_commit"]],
        cwd=candidate,
    )
    decisions_dir = candidate / "automation/decisions"
    decisions_dir.mkdir(parents=True, exist_ok=True)
    record_path = decisions_dir / f"{values['paseito_version']}.json"
    record_path.write_text(json.dumps({"decision": decision, "review": review}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    command(
        ["npm", "run", "format:files", "--", str(record_path.relative_to(candidate))],
        cwd=candidate,
        timeout=600,
    )
    git(candidate, "add", "package.json", "package-lock.json", "packages/desktop/package.json", "automation/upstream.json", str(record_path.relative_to(candidate)))
    git(candidate, "commit", "-m", f"chore: prepare {values['paseito_version']}")
    final_commit = git(candidate, "rev-parse", "HEAD")
    focused_verification(candidate)
    app = build_local_macos_app(candidate, run_root, values["paseito_version"])
    push_and_install_local(
        candidate,
        original_commit,
        final_commit,
        values["paseito_version"],
        app,
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--control-repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--state-root", type=Path, default=Path.home() / "Library/Application Support/PaseitoAutomation")
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--approved-adaptation",
        action="append",
        default=[],
        metavar="FEATURE_ID",
        help="bind a human-approved upstream-overlap decision to classification adapt",
    )
    parser.add_argument(
        "--approved-carry-forward",
        action="append",
        default=[],
        metavar="FEATURE_ID",
        help="bind a human-approved decision to classification carry_forward",
    )
    args = parser.parse_args()
    args.state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = args.state_root / "semantic-sync.lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        try:
            return synchronize(
                args.control_repo.resolve(),
                args.state_root.resolve(),
                args.force,
                args.approved_adaptation,
                args.approved_carry_forward,
            )
        except Exception as error:
            category = error.category if isinstance(error, SyncError) else "command"
            print(f"Paseito semantic sync failed [{category}]: {error}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
