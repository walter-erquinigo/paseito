#!/usr/bin/env python3
"""Install the user-owned, no-fee Paseito polling LaunchAgents."""

from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
from pathlib import Path


def agent(label: str, script: Path, interval: int) -> dict[str, object]:
    log_root = Path.home() / "Library/Logs/PaseitoAutomation"
    return {
        "Label": label,
        "ProgramArguments": ["/usr/bin/python3", str(script)],
        "RunAtLoad": True,
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
    definitions = {
        "dev.werquinigo.paseito.installer": repo / "automation/installer/paseito_installer.py",
        "dev.werquinigo.paseito.release-watchdog": repo / "automation/release/local_watchdog.py",
    }
    for label, script in definitions.items():
        path = launchagents / f"{label}.plist"
        subprocess.run(["/bin/launchctl", "bootout", f"gui/{uid}/{label}"], check=False)
        if args.uninstall:
            path.unlink(missing_ok=True)
            continue
        with path.open("wb") as stream:
            plistlib.dump(agent(label, script, 3600), stream, sort_keys=True)
        os.chmod(path, 0o600)
        subprocess.run(["/bin/launchctl", "bootstrap", f"gui/{uid}", str(path)], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
