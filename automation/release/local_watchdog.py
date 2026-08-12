#!/usr/bin/env python3
"""Maintain a private control checkout and run local semantic synchronization."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from local_finalize import BRANCH, FinalizationError, finalize_local_changes

REPOSITORY = "walter-erquinigo/paseito"
FORK_URL = "https://github.com/walter-erquinigo/paseito.git"
SCHEDULE_ZONE = ZoneInfo("America/New_York")
SCHEDULE_HOUR = 7
LOCAL_FAILURE_TITLE = "Paseito local publication preparation is blocked"


def scheduled_date(now: datetime, force: bool = False) -> str | None:
    local = now.astimezone(SCHEDULE_ZONE)
    if not force and local.hour < SCHEDULE_HOUR:
        return None
    return local.date().isoformat()


def read_last_success(path: Path) -> str | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value.get("lastSuccessfulNewYorkDate") if isinstance(value, dict) else None


def write_success(path: Path, date_key: str) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            {
                "lastSuccessfulNewYorkDate": date_key,
                "completedAt": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def run(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
    )


def prepare_control_repo(state_root: Path) -> Path:
    control = state_root / "control"
    marker = control / ".paseito-automation-control"
    if not control.exists():
        run(["git", "clone", "--branch", "paseito", "--single-branch", FORK_URL, str(control)], state_root)
        marker.write_text("controller-owned\n", encoding="utf-8")
    if not marker.is_file() or not (control / ".git").is_dir():
        raise RuntimeError("refusing to modify an unmarked control checkout")
    run(["git", "fetch", "origin", "paseito", "--prune"], control)
    run(["git", "checkout", "--detach", "origin/paseito"], control)
    if run(["git", "status", "--porcelain", "--untracked-files=no"], control).stdout.strip():
        raise RuntimeError("control checkout contains unexpected tracked changes")
    return control


def report_local_failure(control: Path, blocked: bool) -> None:
    listed = run(
        [
            "gh",
            "issue",
            "list",
            "--repo",
            REPOSITORY,
            "--state",
            "open",
            "--search",
            f"{LOCAL_FAILURE_TITLE} in:title",
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
        ],
        control,
        check=False,
    ).stdout.strip()
    if blocked:
        body = "Fail-closed local preparation or post-publication source synchronization stopped. Inspect the private automation log on the enrolled Mac; no further automated publication will proceed until the condition is resolved."
        args = (
            ["gh", "issue", "comment", listed, "--repo", REPOSITORY, "--body", body]
            if listed
            else [
                "gh",
                "issue",
                "create",
                "--repo",
                REPOSITORY,
                "--title",
                LOCAL_FAILURE_TITLE,
                "--body",
                body,
            ]
        )
        run(args, control, check=False)
    elif listed:
        run(
            [
                "gh",
                "issue",
                "close",
                listed,
                "--repo",
                REPOSITORY,
                "--comment",
                "Local preparation completed successfully.",
            ],
            control,
            check=False,
        )


def source_sync_path(state_root: Path) -> Path:
    return state_root / "source-sync-pending.json"


def write_source_sync(path: Path, source_head: str) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"sourceHead": source_head}) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def sync_source_checkout(repo: Path, state_root: Path) -> None:
    path = source_sync_path(state_root)
    if not path.is_file():
        return
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError("invalid pending source-sync state") from error
    source_head = value.get("sourceHead") if isinstance(value, dict) else None
    if not isinstance(source_head, str) or not all(
        character in "0123456789abcdef" for character in source_head
    ) or len(source_head) != 40:
        raise RuntimeError("invalid pending source-sync state")
    run(["git", "fetch", "fork", BRANCH, "--prune"], repo)
    published = run(["git", "rev-parse", f"fork/{BRANCH}"], repo).stdout.strip()
    if published == source_head:
        path.unlink()
        return
    if run(["git", "rev-parse", "HEAD"], repo).stdout.strip() != source_head:
        raise RuntimeError("source checkout gained commits while publication was running")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run(
        ["git", "update-ref", f"refs/paseito-automation/backups/{stamp}", source_head],
        repo,
    )
    run(["git", "reset", "--keep", published], repo)
    path.unlink()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    state_root = Path.home() / "Library/Application Support/PaseitoAutomation"
    state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_path = state_root / "semantic-watch-state.json"
    date_key = scheduled_date(datetime.now(timezone.utc), args.force)
    if not date_key:
        return 0
    if not args.force and read_last_success(state_path) == date_key:
        return 0
    visibility = subprocess.run(
        ["gh", "repo", "view", REPOSITORY, "--json", "visibility", "--jq", ".visibility"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if visibility.returncode or visibility.stdout.strip().upper() != "PUBLIC":
        print("Paseito watchdog stopped: repository is unavailable or not public", file=sys.stderr)
        return 1
    try:
        source_repo = Path(__file__).resolve().parents[2]
        control = prepare_control_repo(state_root)
        sync_source_checkout(source_repo, state_root)
        source_head = finalize_local_changes(source_repo, state_root)
        report_local_failure(control, False)
        write_source_sync(source_sync_path(state_root), source_head)
        control = prepare_control_repo(state_root)
        result = subprocess.run(
            [sys.executable, str(control / "automation/release/semantic_sync.py"), "--control-repo", str(control), "--state-root", str(state_root)],
            cwd=control,
            env={**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
            check=False,
        )
        sync_source_checkout(source_repo, state_root)
        if result.returncode == 0:
            write_success(state_path, date_key)
        return result.returncode
    except (OSError, RuntimeError, FinalizationError, subprocess.CalledProcessError) as error:
        if "control" in locals():
            report_local_failure(control, True)
        print(f"Paseito watchdog failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
