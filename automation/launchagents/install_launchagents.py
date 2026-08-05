#!/usr/bin/env python3
"""Install the user-owned Paseito semantic-sync and reporting LaunchAgents."""

from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
from pathlib import Path


def agent(label: str, script: Path, interval: int, run_at_load: bool = True) -> dict[str, object]:
    log_root = Path.home() / "Library/Logs/PaseitoAutomation"
    return {
        "Label": label,
        "ProgramArguments": ["/usr/bin/python3", str(script)],
        "RunAtLoad": run_at_load,
        "StartInterval": interval,
        "ProcessType": "Background",
        "EnvironmentVariables": {
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        },
        "StandardOutPath": str(log_root / f"{label}.out.log"),
        "StandardErrorPath": str(log_root / f"{label}.err.log"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    launchagents = Path.home() / "Library/LaunchAgents"
    launchagents.mkdir(parents=True, exist_ok=True)
    (Path.home() / "Library/Logs/PaseitoAutomation").mkdir(parents=True, exist_ok=True)
    uid = os.getuid()
    legacy_labels = {
        "dev.werquinigo.paseito.installer",
        "dev.werquinigo.paseito.release-watchdog",
    }
    for label in legacy_labels:
        subprocess.run(["/bin/launchctl", "bootout", f"gui/{uid}/{label}"], check=False)
        (launchagents / f"{label}.plist").unlink(missing_ok=True)
    definitions = {
        "dev.werquinigo.paseito.semantic-sync": (
            repo / "automation/release/local_watchdog.py",
            True,
        ),
        "dev.werquinigo.paseito.daily-report": (
            repo / "automation/reporting/local_smtp_report.py",
            False,
        ),
    }
    for label, (script, run_at_load) in definitions.items():
        path = launchagents / f"{label}.plist"
        subprocess.run(["/bin/launchctl", "bootout", f"gui/{uid}/{label}"], check=False)
        if args.uninstall:
            path.unlink(missing_ok=True)
            continue
        with path.open("wb") as stream:
            plistlib.dump(agent(label, script, 3600, run_at_load), stream, sort_keys=True)
        os.chmod(path, 0o600)
        subprocess.run(["/bin/launchctl", "bootstrap", f"gui/{uid}", str(path)], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
