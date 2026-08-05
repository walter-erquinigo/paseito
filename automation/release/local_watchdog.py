#!/usr/bin/env python3
"""No-fee local fallback for GitHub's inactivity-disabled schedules."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

REPOSITORY = "walter-erquinigo/paseito"
WORKFLOW = "paseito-release.yml"


def gh(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["gh", *args, "--repo", REPOSITORY],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


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
    enabled = gh("workflow", "enable", WORKFLOW)
    if enabled.returncode:
        print("Paseito watchdog could not enable the release workflow", file=sys.stderr)
        return 1
    runs = gh("run", "list", "--workflow", WORKFLOW, "--limit", "1", "--json", "createdAt")
    if runs.returncode:
        return 1
    values = json.loads(runs.stdout or "[]")
    if values:
        last = datetime.fromisoformat(values[0]["createdAt"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - last < timedelta(minutes=75):
            return 0
    dispatched = gh("workflow", "run", WORKFLOW, "--ref", "paseito")
    if dispatched.returncode:
        print("Paseito watchdog could not dispatch the release workflow", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
