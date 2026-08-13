#!/usr/bin/env python3
"""Local Codex-driven semantic upstream reconciliation and promotion controller."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

REPOSITORY = "walter-erquinigo/paseito"
FORK_URL = "https://github.com/walter-erquinigo/paseito.git"
UPSTREAM_URL = "https://github.com/getpaseo/paseo.git"
WORKFLOW = "paseito-release.yml"
FAILURE_TITLE = "Paseito local semantic sync is blocked"
COMMIT = re.compile(r"^[0-9a-f]{40}$")


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


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reconciliation_prompt(values: dict[str, str], input_commit: str) -> str:
    return f"""Use $paseito-upstream-sync to reconcile this candidate checkout.

Exact inputs:
- rebased input commit: {input_commit}
- old upstream commit: {values['old_upstream_commit']}
- new stable upstream tag: {values['upstream_tag']}
- new upstream commit: {values['upstream_commit']}

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
exact registry Playwright contract fails before test execution with a loopback-listener EPERM, keep
the feature's semantic classification, record that one check as not_run, and do not block solely for
that sandbox limitation. The controller will run that exact registry command outside the sandbox,
capture its transcript, and fail closed before review if it does not pass. Never defer a unit test,
typecheck, lint, formatting check, or a browser test that actually began executing.

Before returning, run npm run typecheck and repair every rebase integration error. In particular,
adapt fork-added E2E specs to any upstream E2E directory move, reconcile every locale against the
English resource shape, remove stale send-behavior values, and restore imports lost during conflict
resolution. A typecheck failure is a blocker, not a deferred check.
Return the decision object required by the skill schema. Set blocked=true rather than guessing.
"""


def reconciliation_retry_prompt(
    values: dict[str, str], input_commit: str, previous: dict[str, Any], attempt: int
) -> str:
    blockers = previous.get("blockers")
    rendered = "\n".join(
        f"- {item}" for item in blockers if isinstance(item, str)
    ) if isinstance(blockers, list) else "- The previous result was blocked."
    return reconciliation_prompt(values, input_commit) + f"""

This is repair attempt {attempt} in the same candidate worktree. Preserve correct edits from the
previous pass and resolve these reported blockers before returning a fresh complete decision:
{rendered}

Do not repeat a sandbox-only Playwright listener failure as a blocker; use the narrowly allowed
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
    decision_path: Path, evidence_path: Path, candidate_commit: str, values: dict[str, str]
) -> str:
    return f"""Independently review the Paseito semantic reconciliation at commit {candidate_commit}.
Read automation/feature-registry.json, {decision_path.name}, {evidence_path.name}, the old upstream commit
{values['old_upstream_commit']}, and the new upstream commit {values['upstream_commit']}.
The decision's inputCommit is the mechanically rebased tree before Codex's semantic worktree edits;
the reviewed commit above is the resulting tree. They may be identical when every decision is
carry_forward and no semantic edit is needed. The evidence JSONL is the first pass's captured command
transcript plus controller-owned contract records; use it to substantiate recorded contract results.
The transcript may contain multiple repair attempts. For an exact Playwright command that was
`not_run` after a sandbox listener failure, a later `controller_contract` record with exitCode 0 is
the authoritative execution result and substantiates the decision's final `passed` result.
Check every feature decision and its cited evidence. Pay special attention to features classified
upstream_complete: confirm executable equivalence and passing contract evidence, not changelog
similarity. Confirm permanent features remain and the new upstream commit is an ancestor.
The controller already verified that tracked files are clean. The untracked decision, evidence, and
review files are controller-owned handoff files and are not candidate changes. This sandbox is intentionally
read-only, so audit the recorded commands and repository evidence but do not rerun tests that need a
writable temporary directory; the controller independently reruns all contracts after this review.
Do not modify files, push, tag, publish, install, dispatch workflows, or open issues. Return only the
object required by the review schema; disapprove when any evidence is uncertain.
"""


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
        ],
    ]
    for args in commands:
        command(args, cwd=candidate, timeout=1800)
    for suite in ("release", "installer", "launchagents", "migration", "reporting", "remote"):
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
    """Run only sandbox-blocked, exact registry Playwright commands outside Codex."""
    registry = load_object(registry_path)
    allowed = {
        command_text
        for feature in registry.get("features", [])
        if isinstance(feature, dict)
        for command_text in feature.get("contracts", [])
        if isinstance(command_text, str)
        and command_text.startswith("npm run test:e2e --workspace=@getpaseo/app -- ")
    }
    deferred: list[dict[str, Any]] = []
    for feature in decision.get("features", []):
        if not isinstance(feature, dict):
            continue
        checks = feature.get("contractChecks")
        if not isinstance(checks, list):
            continue
        for check in checks:
            if isinstance(check, dict) and check.get("result") == "not_run":
                deferred.append(check)
    for check in deferred:
        command_text = check.get("command")
        if not isinstance(command_text, str) or command_text not in allowed:
            raise SyncError("semantic-sync", "Codex deferred a contract that requires sandboxed proof")
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


def ensure_public(control_repo: Path) -> None:
    result = command(
        ["gh", "repo", "view", REPOSITORY, "--json", "visibility", "--jq", ".visibility"],
        cwd=control_repo,
        check=False,
    )
    if result.returncode or result.stdout.strip().upper() != "PUBLIC":
        raise SyncError("repository", "Paseito repository is unavailable or not public")


def dispatch_status(control_repo: Path, result: str, category: str, version: str | None) -> None:
    payload = {
        "event_type": "paseito-local-status",
        "client_payload": {
            "schemaVersion": 1,
            "installedVersion": version,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "pendingRestart": False,
            "result": result,
            "category": category,
        },
    }
    command(
        ["gh", "api", "--method", "POST", f"repos/{REPOSITORY}/dispatches", "--input", "-"],
        cwd=control_repo,
        check=False,
        input_text=json.dumps(payload),
    )


def report_failure(control_repo: Path, category: str) -> None:
    listed = command(
        [
            "gh",
            "issue",
            "list",
            "--repo",
            REPOSITORY,
            "--state",
            "open",
            "--search",
            f"{FAILURE_TITLE} in:title",
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
        ],
        cwd=control_repo,
        check=False,
    )
    body = f"Local fail-closed semantic synchronization stopped in category `{category}`. The published branch and installed app were not advanced."
    if listed.stdout.strip():
        args = ["gh", "issue", "comment", listed.stdout.strip(), "--repo", REPOSITORY, "--body", body]
    else:
        args = ["gh", "issue", "create", "--repo", REPOSITORY, "--title", FAILURE_TITLE, "--body", body]
    command(args, cwd=control_repo, check=False)


def wait_for_workflow(control_repo: Path, display_fragment: str, started: datetime) -> int:
    deadline = time.monotonic() + 7200
    while time.monotonic() < deadline:
        result = command(
            [
                "gh",
                "run",
                "list",
                "--repo",
                REPOSITORY,
                "--workflow",
                WORKFLOW,
                "--event",
                "workflow_dispatch",
                "--limit",
                "20",
                "--json",
                "databaseId,displayTitle,status,conclusion,createdAt",
            ],
            cwd=control_repo,
        )
        for item in json.loads(result.stdout or "[]"):
            created = datetime.fromisoformat(item["createdAt"].replace("Z", "+00:00"))
            if display_fragment not in item.get("displayTitle", "") or created < started - timedelta(minutes=2):
                continue
            if item["status"] == "completed":
                if item.get("conclusion") != "success":
                    raise SyncError("verification", "deterministic GitHub verification failed")
                return int(item["databaseId"])
        time.sleep(15)
    raise SyncError("verification", "timed out waiting for deterministic GitHub verification")


def validate_artifacts(
    directory: Path, values: dict[str, str], commit: str, decision_path: Path
) -> tuple[Path, ...]:
    provenance_path = directory / "provenance.json"
    provenance = load_object(provenance_path)
    expected = {
        "upstreamTag": values["upstream_tag"],
        "upstreamCommit": values["upstream_commit"],
        "paseitoCommit": commit,
        "paseitoVersion": values["paseito_version"],
        "releaseTag": values["release_tag"],
    }
    if any(provenance.get(key) != value for key, value in expected.items()):
        raise SyncError("provenance", "candidate artifact provenance does not match local decision")
    entries = provenance.get("artifacts")
    if provenance.get("schemaVersion") != 2 or not isinstance(entries, list):
        raise SyncError("provenance", "candidate provenance has no versioned artifact set")
    expected_artifacts = {
        ("desktop", "darwin", "arm64"),
        ("daemon", "linux", "x64"),
    }
    actual_artifacts: set[tuple[str, str, str]] = set()
    artifact_paths: list[Path] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise SyncError("provenance", "candidate provenance has an invalid artifact entry")
        identity = (
            str(entry.get("kind", "")),
            str(entry.get("platform", "")),
            str(entry.get("architecture", "")),
        )
        actual_artifacts.add(identity)
        artifact = directory / str(entry.get("name", ""))
        checksum = artifact.with_name(artifact.name + ".sha256")
        if not artifact.is_file() or not checksum.is_file():
            raise SyncError("artifact", "candidate artifact set is incomplete")
        digest = sha256(artifact)
        if digest != entry.get("sha256"):
            raise SyncError("checksum", "candidate artifact checksum does not match provenance")
        if checksum.read_text(encoding="utf-8") != f"{digest}  {artifact.name}\n":
            raise SyncError("checksum", "candidate checksum file is malformed")
        artifact_paths.extend((artifact, checksum))
    if actual_artifacts != expected_artifacts or len(entries) != len(expected_artifacts):
        raise SyncError("artifact", "candidate artifact platforms are incomplete")
    desktop = next(
        entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("kind") == "desktop"
    )
    if provenance.get("artifact") != {
        "name": desktop.get("name"),
        "sha256": desktop.get("sha256"),
    }:
        raise SyncError("provenance", "legacy desktop artifact does not match artifact set")
    if provenance.get("semanticDecision", {}).get("sha256") != sha256(decision_path):
        raise SyncError("provenance", "semantic decision record does not match provenance")
    required_tests = {
        "semanticReconciliation",
        "independentReview",
        "format",
        "lint",
        "typecheck",
        "feature",
        "upstream",
        "packagedDesktopSmoke",
        "packagedLinuxDaemonSmoke",
    }
    tests = provenance.get("tests", {})
    if not isinstance(tests, dict) or any(tests.get(name) != "passed" for name in required_tests):
        raise SyncError("provenance", "candidate provenance does not attest every required check")
    return (*artifact_paths, provenance_path)


def promote(
    candidate: Path,
    control_repo: Path,
    branch: str,
    original_commit: str,
    commit: str,
    values: dict[str, str],
    artifacts: tuple[Path, ...],
) -> None:
    tag = values["release_tag"]
    branch_lines = git(candidate, "ls-remote", "fork", "refs/heads/paseito").splitlines()
    remote_head = branch_lines[0].split()[0] if branch_lines else ""
    tag_lines = git(candidate, "ls-remote", "fork", f"refs/tags/{tag}^{{}}").splitlines()
    remote_tag = tag_lines[0].split()[0] if tag_lines else ""
    git(candidate, "config", "user.name", "Paseito Local Automation")
    git(candidate, "config", "user.email", "werquinigo@users.noreply.github.com")
    if remote_head == original_commit and not remote_tag:
        if git(candidate, "tag", "--list", tag):
            git(candidate, "tag", "-d", tag)
        git(candidate, "tag", "-a", tag, commit, "-m", f"Paseito {values['paseito_version']}")
        command(
            [
                "git",
                "push",
                "--atomic",
                f"--force-with-lease=refs/heads/paseito:{original_commit}",
                "fork",
                f"{commit}:refs/heads/paseito",
                f"refs/tags/{tag}:refs/tags/{tag}",
            ],
            cwd=candidate,
            timeout=180,
        )
    elif remote_head != commit or remote_tag != commit:
        raise SyncError("promotion", "published branch or tag differs from the verified candidate")

    release = command(
        ["gh", "release", "view", tag, "--repo", REPOSITORY, "--json", "tagName"],
        cwd=control_repo,
        check=False,
    )
    if release.returncode:
        command(
            [
                "gh",
                "release",
                "create",
                tag,
                *(str(path) for path in artifacts),
                "--repo",
                REPOSITORY,
                "--title",
                f"Paseito {values['paseito_version']}",
                "--notes",
                f"Unsigned Apple Silicon build semantically reconciled locally with getpaseo/paseo {values['upstream_tag']} and deterministically verified by GitHub.",
            ],
            cwd=control_repo,
            timeout=300,
        )
    else:
        command(
            [
                "gh",
                "release",
                "upload",
                tag,
                *(str(path) for path in artifacts),
                "--clobber",
                "--repo",
                REPOSITORY,
            ],
            cwd=control_repo,
            timeout=300,
        )
    command(["git", "push", "fork", "--delete", branch], cwd=candidate, check=False, timeout=120)
    command([sys.executable, str(candidate / "automation/installer/paseito_installer.py")], cwd=candidate, timeout=600)
    remote = command(
        [
            sys.executable,
            str(candidate / "automation/remote/deploy_remote_daemons.py"),
            "--provenance",
            str(artifacts[-1]),
        ],
        cwd=candidate,
        check=False,
        timeout=600,
    )
    if remote.returncode:
        print(
            "Paseito Mac promotion succeeded; at least one registered remote deployment failed "
            "and was recorded for the daily report.",
            file=sys.stderr,
        )


def pending_path(state_root: Path) -> Path:
    return state_root / "pending-promotion.json"


def save_pending(
    state_root: Path,
    candidate: Path,
    branch: str,
    original_commit: str,
    commit: str,
    values: dict[str, str],
    artifacts: tuple[Path, ...],
) -> None:
    value = {
        "candidate": str(candidate),
        "branch": branch,
        "originalCommit": original_commit,
        "commit": commit,
        "values": values,
        "artifacts": [str(path) for path in artifacts],
    }
    path = pending_path(state_root)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def resume_pending(control_repo: Path, state_root: Path) -> bool:
    path = pending_path(state_root)
    if not path.exists():
        return False
    value = load_object(path)
    candidate = Path(str(value["candidate"]))
    raw_artifacts = value.get("artifacts")
    if not isinstance(raw_artifacts, list) or len(raw_artifacts) != 5:
        raise SyncError("promotion", "pending promotion artifact list is invalid")
    artifacts = tuple(Path(str(item)) for item in raw_artifacts)
    if not all(item.is_file() for item in artifacts):
        raise SyncError("promotion", "pending promotion artifacts are missing")
    commit = str(value["commit"])
    if not COMMIT.fullmatch(commit) or git(candidate, "rev-parse", "HEAD") != commit:
        raise SyncError("promotion", "pending promotion candidate no longer matches its verified commit")
    raw_values = value.get("values")
    if not isinstance(raw_values, dict):
        raise SyncError("promotion", "pending promotion metadata is invalid")
    values = {str(key): str(item) for key, item in raw_values.items()}
    decision_path = candidate / "automation/decisions" / f"{values['paseito_version']}.json"
    validate_artifacts(artifacts[0].parent, values, commit, decision_path)
    promote(
        candidate,
        control_repo,
        str(value["branch"]),
        str(value["originalCommit"]),
        commit,
        values,
        artifacts,
    )
    path.unlink()
    close_failure_issue(control_repo)
    dispatch_status(control_repo, "success", "semantic-sync", values["paseito_version"])
    return True


def close_failure_issue(control_repo: Path) -> None:
    result = command(
        ["gh", "issue", "list", "--repo", REPOSITORY, "--state", "open", "--search", f"{FAILURE_TITLE} in:title", "--json", "number", "--jq", ".[0].number // empty"],
        cwd=control_repo,
        check=False,
    )
    if result.stdout.strip():
        command(["gh", "issue", "close", result.stdout.strip(), "--repo", REPOSITORY, "--comment", "Resolved by a verified local semantic sync."], cwd=control_repo, check=False)


def synchronize(control_repo: Path, state_root: Path, force: bool = False) -> int:
    ensure_public(control_repo)
    if resume_pending(control_repo, state_root):
        return 0
    values = discover(control_repo, force)
    if values.get("needs_release") != "true":
        dispatch_status(control_repo, "success", "no-change", values.get("paseito_version"))
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
        raise SyncError("repository", "candidate did not start at the published Paseito branch")
    # Codex needs repository history, not transport authority. Remove both remotes during its
    # write and review passes; the sandbox independently denies network access.
    git(candidate, "remote", "remove", "fork")
    git(candidate, "remote", "remove", "upstream")
    branch = f"automation/candidate/{safe_tag}-{stamp.lower()}"
    git(candidate, "switch", "-c", branch)

    git(candidate, "config", "user.name", "Paseito Local Automation")
    git(candidate, "config", "user.email", "werquinigo@users.noreply.github.com")
    rebase_candidate(candidate, values, controller_skill_path(), run_root)
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
    decision: dict[str, Any] = {}
    for attempt in range(1, 4):
        decision_path.unlink(missing_ok=True)
        step_log = run_root / f"codex-reconcile-{attempt}.jsonl"
        prompt = (
            reconciliation_prompt(values, input_commit)
            if attempt == 1
            else reconciliation_retry_prompt(values, input_commit, decision, attempt)
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
        git(candidate, "commit", "-m", f"chore: reconcile Paseo {values['upstream_tag']}")
    candidate_commit = git(candidate, "rev-parse", "HEAD")
    if git(candidate, "status", "--porcelain"):
        raise SyncError("semantic-sync", "semantic reconciliation left uncommitted changes")
    decision_path.write_text(json.dumps(decision, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_normalized_evidence(reconcile_log, evidence_path)

    invoke_codex(
        candidate=candidate,
        prompt=review_prompt(decision_path, evidence_path, candidate_commit, values),
        schema=skill / "references/review-schema.json",
        output=review_path,
        sandbox="read-only",
        log=run_root / "codex-review.jsonl",
    )
    review = load_object(review_path)
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
    git(candidate, "push", "fork", f"HEAD:refs/heads/{branch}")

    started = datetime.now(timezone.utc)
    fragment = final_commit[:12]
    command(
        [
            "gh",
            "workflow",
            "run",
            WORKFLOW,
            "--repo",
            REPOSITORY,
            "--ref",
            "paseito",
            "-f",
            f"candidate_ref={branch}",
            "-f",
            f"expected_sha={final_commit}",
            "-f",
            f"upstream_tag={values['upstream_tag']}",
            "-f",
            f"upstream_commit={values['upstream_commit']}",
            "-f",
            f"paseito_version={values['paseito_version']}",
            "-f",
            f"release_tag={values['release_tag']}",
        ],
        cwd=control_repo,
    )
    run_id = wait_for_workflow(control_repo, fragment, started)
    artifacts_dir = run_root / "artifacts"
    artifacts_dir.mkdir()
    command(["gh", "run", "download", str(run_id), "--repo", REPOSITORY, "--name", "paseito-candidate", "--dir", str(artifacts_dir)], cwd=control_repo, timeout=600)
    artifacts = validate_artifacts(artifacts_dir, values, final_commit, record_path)
    save_pending(state_root, candidate, branch, original_commit, final_commit, values, artifacts)
    promote(candidate, control_repo, branch, original_commit, final_commit, values, artifacts)
    pending_path(state_root).unlink()
    close_failure_issue(control_repo)
    dispatch_status(control_repo, "success", "semantic-sync", values["paseito_version"])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--control-repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--state-root", type=Path, default=Path.home() / "Library/Application Support/PaseitoAutomation")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    args.state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = args.state_root / "semantic-sync.lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        try:
            return synchronize(args.control_repo.resolve(), args.state_root.resolve(), args.force)
        except Exception as error:
            category = error.category if isinstance(error, SyncError) else "command"
            report_failure(args.control_repo.resolve(), category)
            try:
                current = load_object(args.control_repo / "automation/upstream.json").get("paseitoVersion")
            except Exception:
                current = None
            dispatch_status(args.control_repo.resolve(), "failure", category, str(current) if current else None)
            print(f"Paseito semantic sync failed [{category}]: {error}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
