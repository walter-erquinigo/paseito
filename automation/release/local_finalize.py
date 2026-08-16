#!/usr/bin/env python3
"""Fail-closed preparation and publication of changes in the source checkout."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Sequence

FORK_URL = "https://github.com/walter-erquinigo/paseito.git"
BRANCH = "paseito"
CONVENTIONAL_COMMIT = re.compile(
    r"^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._/-]+\))?!?: [^\r\n]+$"
)
SENSITIVE_PATH = re.compile(
    r"(^|/)(\.env($|\.)|id_(rsa|dsa|ecdsa|ed25519)($|\.)|credentials?($|\.)|secrets?($|\.)|[^/]+\.(pem|key|p12|pfx))",
    re.IGNORECASE,
)
SENSITIVE_CONTENT = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bgh[opsu]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
)


class FinalizationError(RuntimeError):
    pass


def command(
    args: Sequence[str],
    *,
    cwd: Path,
    check: bool = True,
    timeout: int | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            list(args),
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired as error:
        raise FinalizationError(f"command timed out: {args[0]}") from error
    if check and result.returncode:
        lines = (result.stderr or result.stdout).strip().splitlines()
        detail = next((line.strip() for line in reversed(lines) if line.strip()), "")
        raise FinalizationError(detail[-500:] or f"command failed: {args[0]}")
    return result


def git(repo: Path, *args: str, check: bool = True) -> str:
    return command(["git", *args], cwd=repo, check=check).stdout.strip()


def codex_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for key in ("GH_TOKEN", "GITHUB_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY"):
        environment.pop(key, None)
    return environment


def changed_files(repo: Path) -> list[str]:
    tracked = command(
        ["git", "diff", "--name-only", "-z", "HEAD", "--"], cwd=repo
    ).stdout.split("\0")
    untracked = command(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=repo
    ).stdout.split("\0")
    return sorted({path for path in tracked + untracked if path})


def snapshot_digest(repo: Path) -> str:
    digest = hashlib.sha256()
    files = changed_files(repo)
    raw = command(["git", "diff", "--raw", "HEAD", "--"], cwd=repo).stdout
    digest.update(raw.encode("utf-8"))
    for relative in files:
        digest.update(relative.encode("utf-8", errors="surrogateescape"))
        path = repo / relative
        if path.is_symlink():
            digest.update(os.readlink(path).encode("utf-8", errors="surrogateescape"))
        elif path.is_file():
            digest.update(path.read_bytes())
        else:
            digest.update(b"<missing>")
    return digest.hexdigest()


def validate_no_sensitive_material(repo: Path, files: list[str], base: str = "HEAD") -> None:
    for relative in files:
        if SENSITIVE_PATH.search(relative) and not re.search(
            r"(?:example|sample|template)", relative, re.IGNORECASE
        ):
            raise FinalizationError("a sensitive-looking path requires manual review")
    patch = command(["git", "diff", "--unified=0", base, "--"], cwd=repo).stdout
    added = "\n".join(
        line[1:]
        for line in patch.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    )
    for relative in command(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=repo
    ).stdout.split("\0"):
        path = repo / relative
        if not relative or not path.is_file():
            continue
        if path.stat().st_size > 2 * 1024 * 1024:
            raise FinalizationError("a large untracked file requires manual review")
        added += "\n" + path.read_text(encoding="utf-8", errors="ignore")
    if any(pattern.search(added) for pattern in SENSITIVE_CONTENT):
        raise FinalizationError("credential-like content requires manual review")


def validate_checkout(repo: Path) -> None:
    if not (repo / ".git").exists():
        raise FinalizationError("source checkout is not a Git worktree")
    if git(repo, "branch", "--show-current") != BRANCH:
        raise FinalizationError(f"source checkout must be on {BRANCH}")
    git_directory = Path(git(repo, "rev-parse", "--absolute-git-dir"))
    if any(
        (git_directory / name).exists()
        for name in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")
    ):
        raise FinalizationError("source checkout has an in-progress Git operation")
    remote_url = git(repo, "remote", "get-url", "fork")
    normalized = remote_url.removesuffix(".git")
    if normalized not in {
        FORK_URL.removesuffix(".git"),
        "git@github.com:walter-erquinigo/paseito",
    }:
        raise FinalizationError("fork remote does not target the public Paseito repository")


def reconcile_remote(repo: Path) -> None:
    git(repo, "fetch", "fork", BRANCH, "--prune")
    local = git(repo, "rev-parse", "HEAD")
    remote = git(repo, "rev-parse", f"fork/{BRANCH}")
    if local == remote:
        return
    if command(
        ["git", "merge-base", "--is-ancestor", local, remote], cwd=repo, check=False
    ).returncode == 0:
        if changed_files(repo):
            raise FinalizationError("remote advanced while the source checkout has local changes")
        git(repo, "merge", "--ff-only", f"fork/{BRANCH}")
        return
    if command(
        ["git", "merge-base", "--is-ancestor", remote, local], cwd=repo, check=False
    ).returncode != 0:
        raise FinalizationError("source and published branches diverged; manual reconciliation is required")


def local_prompt() -> str:
    return """Prepare all current Paseito source-checkout changes for unattended publication.

Read /Users/werquinigo/AGENTS.md, this repository's AGENTS.md, relevant docs, and
automation/feature-registry.json. Inspect every unpublished commit in fork/paseito..HEAD and every
tracked and untracked working-tree change. Complete unfinished work only when intent is unambiguous;
otherwise return ready=false with a concise blocker. Do not
access the network. Do not stage, commit, amend, rebase, push, tag, publish, install, restart, or
modify Git metadata. Never add credentials, private data, generated dependency trees, build output,
or machine-local state. Run each exact relevant test file separately, followed by npm run format,
npm run typecheck, npm run lint, and npm run format:check. Return a conventional one-line commit
message, exactly one matching registry feature ID as changeId, and the complete final changed-file
list. If the work spans more than one feature ID, return ready=false instead of combining it into a
mixed-feature commit. A failed or uncertain check is a blocker.
"""


def invoke_codex(repo: Path, state_root: Path) -> dict[str, Any]:
    output = state_root / "local-finalization-result.json"
    log = state_root / "local-finalization-codex.jsonl"
    output.unlink(missing_ok=True)
    schema = Path(__file__).with_name("local-finalization-schema.json")
    result = command(
        [
            "codex",
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--sandbox",
            "workspace-write",
            "--output-schema",
            str(schema),
            "--output-last-message",
            str(output),
            "--json",
            local_prompt(),
        ],
        cwd=repo,
        check=False,
        timeout=3600,
        env=codex_environment(),
    )
    log.write_text(result.stdout + result.stderr, encoding="utf-8")
    os.chmod(log, 0o600)
    if result.returncode or not output.is_file():
        raise FinalizationError("Codex did not produce a valid local-finalization result")
    os.chmod(output, 0o600)
    try:
        value = json.loads(output.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise FinalizationError("Codex local-finalization result is invalid JSON") from error
    if not isinstance(value, dict):
        raise FinalizationError("Codex local-finalization result is not an object")
    return value


def registry_feature_ids(repo: Path) -> set[str]:
    try:
        value = json.loads((repo / "automation/feature-registry.json").read_text(encoding="utf-8"))
        features = value["features"]
        feature_ids = {feature["id"] for feature in features}
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise FinalizationError("feature registry is invalid") from error
    if not feature_ids or not all(isinstance(feature_id, str) for feature_id in feature_ids):
        raise FinalizationError("feature registry has no valid feature IDs")
    return feature_ids


def validate_result(
    result: dict[str, Any], files: list[str], feature_ids: set[str]
) -> tuple[str, str]:
    if result.get("schemaVersion") != 1 or not result.get("ready") or result.get("blockers"):
        raise FinalizationError("Codex reported that local changes are not ready")
    reported = result.get("files")
    if not isinstance(reported, list) or sorted(reported) != files:
        raise FinalizationError("Codex result does not cover the complete changed-file set")
    checks = result.get("checks")
    if not isinstance(checks, list) or not checks or any(
        not isinstance(check, dict) or check.get("result") != "passed" for check in checks
    ):
        raise FinalizationError("Codex reported an incomplete or failed check")
    commands = {check["command"] for check in checks}
    required = {"npm run format", "npm run typecheck", "npm run lint", "npm run format:check"}
    if not required.issubset(commands):
        raise FinalizationError("Codex result omits a required repository check")
    message = result.get("commitMessage")
    if not isinstance(message, str) or not CONVENTIONAL_COMMIT.fullmatch(message):
        raise FinalizationError("Codex did not provide a valid conventional commit message")
    change_id = result.get("changeId")
    if not isinstance(change_id, str) or change_id not in feature_ids:
        raise FinalizationError("Codex did not classify the change with one registry feature ID")
    return message, change_id


def deterministic_checks(repo: Path) -> None:
    command(["npm", "run", "format"], cwd=repo, timeout=600)
    command(["npm", "run", "typecheck"], cwd=repo, timeout=1800)
    command(["npm", "run", "lint"], cwd=repo, timeout=1800)
    command(["npm", "run", "format:check"], cwd=repo, timeout=600)
    command(["git", "diff", "--check", "HEAD", "--"], cwd=repo)


def finalize_local_changes(repo: Path, state_root: Path) -> str:
    """Return the exact source commit that is present on fork/paseito."""
    validate_checkout(repo)
    reconcile_remote(repo)
    initial_files = changed_files(repo)
    initial_local = git(repo, "rev-parse", "HEAD")
    remote = git(repo, "rev-parse", f"fork/{BRANCH}")
    if not initial_files and initial_local == remote:
        return initial_local

    result = invoke_codex(repo, state_root)
    files = changed_files(repo)
    if initial_files and not files:
        raise FinalizationError("Codex removed all local changes instead of preparing them")
    message, change_id = validate_result(result, files, registry_feature_ids(repo))
    unpublished_files = sorted(
        (
            set(
                command(
                    ["git", "diff", "--name-only", "-z", remote, "--"], cwd=repo
                ).stdout.split("\0")
            )
            | set(
                command(
                    ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=repo
                ).stdout.split("\0")
            )
        )
        - {""}
    )
    validate_no_sensitive_material(repo, unpublished_files, remote)
    deterministic_checks(repo)
    if changed_files(repo) != files:
        raise FinalizationError("repository checks changed the approved file set")
    verified_snapshot = snapshot_digest(repo)
    validate_no_sensitive_material(repo, unpublished_files, remote)
    if snapshot_digest(repo) != verified_snapshot:
        raise FinalizationError("source checkout changed during verification")
    if files:
        git(repo, "add", "--all")
        if snapshot_digest(repo) != verified_snapshot:
            raise FinalizationError("staged snapshot differs from the verified source changes")
        verified_tree = git(repo, "write-tree")
        git(repo, "commit", "-m", message, "-m", f"Paseito-Change: {change_id}")
        if git(repo, "rev-parse", "HEAD^{tree}") != verified_tree:
            raise FinalizationError("commit hooks changed the verified source snapshot")
    local = git(repo, "rev-parse", "HEAD")
    remote = git(repo, "rev-parse", f"fork/{BRANCH}")
    if local != remote:
        if command(
            ["git", "merge-base", "--is-ancestor", remote, local], cwd=repo, check=False
        ).returncode:
            raise FinalizationError("local commits are not a fast-forward of fork/paseito")
        git(repo, "push", "fork", f"HEAD:{BRANCH}")
    return local
