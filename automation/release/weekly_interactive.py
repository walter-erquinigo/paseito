#!/usr/bin/env python3
"""Open the weekly Paseito maintenance run in a visible iTerm2 session."""

from __future__ import annotations

import argparse
import fcntl
import os
import shlex
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
STATE_ROOT = Path.home() / "Library/Application Support/PaseitoAutomation"
LOCK_PATH = STATE_ROOT / "weekly-release.lock"
CODEX = Path.home() / ".local/bin/codex"
ITERM = Path("/Applications/iTerm.app")

GITHUB_ACTIONS_UNAVAILABLE_NOTE = """

Current-run constraint:
The human has reported that the GitHub Actions quota is exhausted. Do not dispatch, retry, or wait
for any GitHub Actions workflow during this run. Use the local-only fallback in step 8.
"""

PROMPT = """Maintain and publish Paseito from this checkout. Work interactively and stop for the human whenever a blocker or consequential choice appears.

Required workflow:
1. Read both /Users/werquinigo/AGENTS.md and this repository's AGENTS.md. Preserve all Paseito feature-registry invariants and existing local work.
2. Inspect dirty changes and commits not present on fork/paseito. If there is nothing unpublished and no newer peeled stable upstream release, report that and stop.
3. Classify every local commit with one automation/feature-registry.json feature ID. Before fetching or inspecting a newer upstream release, create a recoverable backup ref, split any mixed-feature commit, and fold related fixes into their owning feature until exactly one commit remains per registered feature. Preserve release metadata separately. Verify the normalized tree matches the approved pre-normalization tree apart from intentional registry, AGENTS.md, workflow, and version updates, then run history_normalization.py check-agents and check-history. Stop on any unclassified, missing, duplicate, or mixed feature.
4. Run focused tests for changed behavior, then repository typecheck, lint, and formatting checks. Never run the full local test suite.
5. Fetch getpaseo/paseo and inspect every registered local feature and preservation fix against the latest peeled stable upstream tag. Whenever upstream independently implements all or part of a local feature, stop before changing or retiring the local behavior. Flag the feature ID, show the concrete upstream evidence and any remaining differences, and ask the human whether to carry it forward, adapt it, or retire it. Do not infer the choice from passing tests, similar names, or apparent equivalence.
6. After every upstream-overlap decision is answered, perform the mandatory semantic rebase onto that upstream tag. Resolve conflicts by preserving Paseito behavior; never discard a local feature merely because upstream changed nearby code. If any other intent is ambiguous, stop and ask the human in this terminal.
7. Re-run the registry history checks, focused tests, and required repository checks. Commit and push paseito only after they pass.
8. Before dispatching GitHub Actions, determine whether Actions are available. If the human reports that the monthly quota or spending limit is exhausted, or GitHub rejects a run for that reason, enter the local-only fallback for this run immediately: do not dispatch, retry, or wait for any GitHub Actions workflow; run the focused tests and all required format, typecheck, lint, and formatting checks locally; build and verify the Apple Silicon macOS app locally; commit the final version; force-push the final `paseito` branch with `--force-with-lease`; and install the verified local build. Do not create a release tag, publish provenance or release assets, or deploy remote daemons without the cross-platform GitHub verification artifacts. Report those items as deferred because Actions was unavailable, not as failures of the merge.
9. When GitHub Actions is available, build and publish the next Paseito version through the repository's release workflow. Verify the published artifacts and provenance and install the verified macOS application. Before invoking remote deployment, warn that every registered daemon restart can interrupt active agents and ask the human for explicit permission. Pass `--remote-restart-approved` to the semantic controller only after that permission; without it, leave remote deployment deferred.
10. Before quitting Paseito or restarting its desktop-managed daemon, warn that active agents will be interrupted and ask the human for separate explicit permission. Never use launchctl submit. Verify the installed bundle version, running GUI bundle path, and daemonNode path before claiming the release is active. Keep this iTerm2 window open on every failure so the human can intervene.
"""


def terminal_command(actions_unavailable: bool = False) -> str:
    arguments = [sys.executable, str(Path(__file__).resolve()), "--run"]
    if actions_unavailable:
        arguments.append("--actions-unavailable")
    return shlex.join(arguments)


def iterm_launch_arguments(actions_unavailable: bool = False) -> list[str]:
    return [
        "/usr/bin/open",
        "-na",
        str(ITERM),
        "--args",
        f"--command={terminal_command(actions_unavailable)}",
    ]


def launch_terminal(actions_unavailable: bool = False) -> int:
    if not ITERM.is_dir():
        print(f"iTerm2 was not found at {ITERM}", file=sys.stderr)
        return 1
    return subprocess.run(iterm_launch_arguments(actions_unavailable), check=False).returncode


def run_codex(actions_unavailable: bool = False) -> int:
    STATE_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with LOCK_PATH.open("a+", encoding="utf-8") as lock:
        os.chmod(LOCK_PATH, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("A Paseito weekly maintenance session is already running.")
            return 0
        if not CODEX.is_file():
            print(f"Codex was not found at {CODEX}", file=sys.stderr)
            input("Press Return to close this terminal…")
            return 1
        result = subprocess.run(
            [
                str(CODEX),
                "--no-alt-screen",
                "-C",
                str(REPO),
                PROMPT + (GITHUB_ACTIONS_UNAVAILABLE_NOTE if actions_unavailable else ""),
            ],
            check=False,
        )
        if result.returncode != 0:
            print(f"\nPaseito maintenance stopped with exit code {result.returncode}.")
            input("Press Return after reviewing the failure…")
        return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--actions-unavailable", action="store_true")
    args = parser.parse_args()
    return (
        run_codex(args.actions_unavailable)
        if args.run
        else launch_terminal(args.actions_unavailable)
    )


if __name__ == "__main__":
    raise SystemExit(main())
