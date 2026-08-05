#!/usr/bin/env python3
"""Local Codex-driven semantic upstream reconciliation and promotion controller."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
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
Return the decision object required by the skill schema. Set blocked=true rather than guessing.
"""


def conflict_prompt(values: dict[str, str], files: list[str]) -> str:
    rendered = "\n".join(f"- {path}" for path in files)
    return f"""Use $paseito-upstream-sync to resolve the current mechanical rebase conflict.

Exact new upstream commit: {values['upstream_commit']}
Unmerged paths:
{rendered}

Inspect the old upstream, new upstream, feature registry, conflict stages, and surrounding code.
Edit the worktree to resolve every listed path semantically while preserving permanent behavior.
Do not run git add, git commit, git rebase, or any command that modifies Git metadata. Do not access
the network. Return the conflict-resolution schema object. Set resolved=false rather than guessing.
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
transcript; use it to substantiate recorded contract results.
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
            prompt=conflict_prompt(values, files),
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
    for suite in ("release", "installer", "launchagents", "migration", "reporting"):
        command(
            [sys.executable, "-m", "unittest", "discover", "-s", f"automation/{suite}", "-p", "test_*.py"],
            cwd=candidate,
            timeout=600,
        )
    if git(candidate, "status", "--porcelain"):
        raise SyncError("verification", "verification changed the candidate worktree")


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
) -> tuple[Path, Path, Path]:
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
    artifact = directory / str(provenance.get("artifact", {}).get("name", ""))
    checksum = artifact.with_name(artifact.name + ".sha256")
    if not artifact.is_file() or not checksum.is_file():
        raise SyncError("artifact", "candidate artifact set is incomplete")
    digest = sha256(artifact)
    if digest != provenance["artifact"]["sha256"]:
        raise SyncError("checksum", "candidate artifact checksum does not match provenance")
    if checksum.read_text(encoding="utf-8") != f"{digest}  {artifact.name}\n":
        raise SyncError("checksum", "candidate checksum file is malformed")
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
    }
    tests = provenance.get("tests", {})
    if not isinstance(tests, dict) or any(tests.get(name) != "passed" for name in required_tests):
        raise SyncError("provenance", "candidate provenance does not attest every required check")
    return artifact, checksum, provenance_path


def promote(
    candidate: Path,
    control_repo: Path,
    branch: str,
    original_commit: str,
    commit: str,
    values: dict[str, str],
    artifacts: tuple[Path, Path, Path],
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


def pending_path(state_root: Path) -> Path:
    return state_root / "pending-promotion.json"


def save_pending(
    state_root: Path,
    candidate: Path,
    branch: str,
    original_commit: str,
    commit: str,
    values: dict[str, str],
    artifacts: tuple[Path, Path, Path],
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
    if not isinstance(raw_artifacts, list) or len(raw_artifacts) != 3:
        raise SyncError("promotion", "pending promotion artifact list is invalid")
    artifacts = (Path(str(raw_artifacts[0])), Path(str(raw_artifacts[1])), Path(str(raw_artifacts[2])))
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

    skill = candidate / ".agents/skills/paseito-upstream-sync"
    git(candidate, "config", "user.name", "Paseito Local Automation")
    git(candidate, "config", "user.email", "werquinigo@users.noreply.github.com")
    rebase_candidate(candidate, values, skill, run_root)
    command(["npm", "ci"], cwd=candidate, timeout=1800)
    if git(candidate, "status", "--porcelain", "--untracked-files=no"):
        raise SyncError("verification", "dependency installation changed tracked candidate files")
    input_commit = git(candidate, "rev-parse", "HEAD")
    decision_path = candidate / ".paseito-semantic-decision.json"
    review_path = candidate / ".paseito-semantic-review.json"
    evidence_path = candidate / ".paseito-reconcile-evidence.jsonl"
    reconcile_log = run_root / "codex-reconcile.jsonl"
    invoke_codex(
        candidate=candidate,
        prompt=reconciliation_prompt(values, input_commit),
        schema=skill / "references/decision-schema.json",
        output=decision_path,
        sandbox="workspace-write",
        log=reconcile_log,
    )
    evidence_path.write_bytes(reconcile_log.read_bytes())
    decision = load_object(decision_path)
    if (
        decision.get("inputCommit") != input_commit
        or decision.get("upstreamTag") != values["upstream_tag"]
        or decision.get("upstreamCommit") != values["upstream_commit"]
        or decision.get("blocked")
    ):
        raise SyncError("semantic-sync", "Codex blocked reconciliation or reported a different candidate")
    command(
        [sys.executable, str(skill / "scripts/validate_decisions.py"), "--registry", "automation/feature-registry.json", "--decision", str(decision_path)],
        cwd=candidate,
    )
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
    evidence_path.write_bytes(reconcile_log.read_bytes())

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
