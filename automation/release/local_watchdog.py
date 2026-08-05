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

REPOSITORY = "walter-erquinigo/paseito"
FORK_URL = "https://github.com/walter-erquinigo/paseito.git"
SCHEDULE_ZONE = ZoneInfo("America/New_York")
SCHEDULE_HOUR = 18


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
        control = prepare_control_repo(state_root)
        result = subprocess.run(
            [sys.executable, str(control / "automation/release/semantic_sync.py"), "--control-repo", str(control), "--state-root", str(state_root)],
            cwd=control,
            env={**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
            check=False,
        )
        if result.returncode == 0:
            write_success(state_path, date_key)
        return result.returncode
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Paseito watchdog failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
