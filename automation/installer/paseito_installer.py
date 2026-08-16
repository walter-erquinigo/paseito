#!/usr/bin/env python3
"""Fail-closed installer for a locally built Apple Silicon Paseito app."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BUNDLE_ID = "dev.werquinigo.paseito"
VERSION = re.compile(r"^\d+\.\d+\.\d+-paseito\.[1-9]\d*$")


class InstallError(RuntimeError):
    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category = category


def run_checked(args: list[str], category: str) -> str:
    result = subprocess.run(
        args,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        raise InstallError(category, f"verification command failed: {Path(args[0]).name}")
    return result.stdout.strip()


def verify_host() -> None:
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise InstallError("architecture", "Paseito supports Apple Silicon macOS only")


def verify_app(app: Path, version: str) -> None:
    if not VERSION.fullmatch(version):
        raise InstallError("version", "invalid Paseito version")
    plist_path = app / "Contents/Info.plist"
    try:
        with plist_path.open("rb") as stream:
            info = plistlib.load(stream)
    except (OSError, plistlib.InvalidFileException) as error:
        raise InstallError("health", "Paseito Info.plist is unreadable") from error
    if info.get("CFBundleIdentifier") != BUNDLE_ID:
        raise InstallError("health", "unexpected bundle identifier")
    if str(info.get("CFBundleShortVersionString")) != version:
        raise InstallError("health", "installed version does not match the requested version")
    executable = app / "Contents/MacOS/Paseito"
    arches = run_checked(["/usr/bin/lipo", "-archs", str(executable)], "architecture").split()
    if arches != ["arm64"]:
        raise InstallError("architecture", "Paseito executable is not arm64-only")


def atomic_swap(first: Path, second: Path) -> None:
    libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    renamex_np = libc.renamex_np
    renamex_np.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    renamex_np.restype = ctypes.c_int
    if renamex_np(os.fsencode(first), os.fsencode(second), 0x00000002) != 0:
        errno = ctypes.get_errno()
        raise InstallError("install", f"atomic app swap failed with errno {errno}")


def is_running() -> bool:
    return (
        subprocess.run(
            ["/usr/bin/pgrep", "-x", "Paseito"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        == 0
    )


def installed_version(destination: Path) -> str | None:
    try:
        with (destination / "Contents/Info.plist").open("rb") as stream:
            value = plistlib.load(stream).get("CFBundleShortVersionString")
        return str(value) if value else None
    except (OSError, plistlib.InvalidFileException):
        return None


def sanitized_status(
    version: str | None, pending_restart: bool, result: str, category: str
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "installedVersion": version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pendingRestart": pending_restart,
        "result": result,
        "category": category,
    }


def pending_restart_marker() -> Path:
    return Path.home() / "Library/Application Support/Paseito/Updater/pending-restart.json"


def previous_app_path() -> Path:
    return Path.home() / "Library/Application Support/Paseito/Updater/previous/Paseito.app"


def install_local_app(source_app: Path, version: str, destination: Path) -> dict[str, Any]:
    verify_host()
    source_app = source_app.resolve()
    if not source_app.is_dir():
        raise InstallError("artifact", "local build does not contain Paseito.app")
    verify_app(source_app, version)

    running = is_running()
    marker = pending_restart_marker()
    if installed_version(destination) == version:
        return sanitized_status(version, marker.exists(), "success", "no-change")

    applications = destination.parent
    temp_root = Path(tempfile.mkdtemp(prefix=".paseito-install-", dir=applications))
    os.chmod(temp_root, 0o700)
    staged_app = temp_root / "Paseito.app"
    swapped = False
    try:
        run_checked(["/usr/bin/ditto", str(source_app), str(staged_app)], "stage")
        verify_app(staged_app, version)
        run_checked(
            ["/usr/bin/codesign", "--force", "--deep", "--sign", "-", str(staged_app)],
            "sign",
        )
        run_checked(
            ["/usr/bin/codesign", "--verify", "--deep", "--strict", str(staged_app)],
            "sign",
        )
        run_checked(
            ["/usr/bin/xattr", "-dr", "com.apple.quarantine", str(staged_app)],
            "quarantine",
        )

        if destination.exists():
            atomic_swap(staged_app, destination)
            swapped = True
            try:
                verify_app(destination, version)
                run_checked(
                    ["/usr/bin/codesign", "--verify", "--deep", "--strict", str(destination)],
                    "health",
                )
            except Exception:
                atomic_swap(staged_app, destination)
                swapped = False
                raise
            try:
                backup = previous_app_path()
                backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                stale = backup.with_name("Paseito.app.stale")
                if stale.exists():
                    shutil.rmtree(stale)
                if backup.exists():
                    os.replace(backup, stale)
                os.replace(staged_app, backup)
                swapped = False
                if stale.exists():
                    shutil.rmtree(stale, ignore_errors=True)
            except Exception as error:
                if staged_app.exists():
                    atomic_swap(staged_app, destination)
                    swapped = False
                raise InstallError(
                    "backup", "new app passed checks but the previous app could not be backed up"
                ) from error
        else:
            os.replace(staged_app, destination)
            try:
                verify_app(destination, version)
            except Exception:
                shutil.rmtree(destination, ignore_errors=True)
                raise

        marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if running:
            marker.write_text(json.dumps({"version": version}) + "\n", encoding="utf-8")
            subprocess.run(
                [
                    "/usr/bin/osascript",
                    "-e",
                    'display notification "Restart Paseito when convenient to use the update." with title "Paseito update ready"',
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            marker.unlink(missing_ok=True)
        return sanitized_status(version, running, "success", "installed")
    finally:
        if swapped and staged_app.exists():
            print(
                "Paseito preserved rollback data after an interrupted swap",
                file=sys.stderr,
            )
        else:
            shutil.rmtree(temp_root, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--destination", type=Path, default=Path("/Applications/Paseito.app"))
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    try:
        verify_host()
        verify_app(args.app.resolve(), args.version)
        status = (
            sanitized_status(args.version, False, "success", "verified")
            if args.verify_only
            else install_local_app(args.app, args.version, args.destination)
        )
        print(json.dumps(status, sort_keys=True))
        return 0
    except InstallError as error:
        status = sanitized_status(
            installed_version(args.destination), False, "failure", error.category
        )
        print(json.dumps(status, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
