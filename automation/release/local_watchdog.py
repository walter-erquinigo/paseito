#!/usr/bin/env python3
"""Maintain a private control checkout and run local semantic synchronization."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPOSITORY = "walter-erquinigo/paseito"
FORK_URL = "https://github.com/walter-erquinigo/paseito.git"


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
    state_root = Path.home() / "Library/Application Support/PaseitoAutomation"
    state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        control = prepare_control_repo(state_root)
        result = subprocess.run(
            [sys.executable, str(control / "automation/release/semantic_sync.py"), "--control-repo", str(control), "--state-root", str(state_root)],
            cwd=control,
            env={**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
            check=False,
        )
        return result.returncode
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Paseito watchdog failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
