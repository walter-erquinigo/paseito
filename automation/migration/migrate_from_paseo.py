#!/usr/bin/env python3
"""Dry-run-first, allowlisted migration from Paseo to independent Paseito state."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import base64
import secrets
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ELECTRON_ALLOWLIST = (
    "Local Storage",
    "IndexedDB",
    "Session Storage",
    "shared_proto_db",
    "WebStorage",
    "Preferences",
    "Network Persistent State",
    "Partitions",
    "desktop-settings.json",
    "window-state.json",
)
DAEMON_ALLOWLIST = ("agents", "projects", "chat", "schedules", "loops", "config.json")
EXCLUDED_PARTS = {
    "cache",
    "code cache",
    "gpucache",
    "dawncache",
    "logs",
    "crashpad",
    "paseo.pid",
    "paseito.pid",
    "singletonlock",
    "singletoncookie",
    "singletonsocket",
    "server-id",
    "daemon-keypair.json",
    "push-tokens.json",
    "shipit",
}
EXCLUDED_SUFFIXES = (".log", ".pid", ".sock", ".socket")


class MigrationError(RuntimeError):
    pass


def live_pid_file(path: Path) -> bool:
    try:
        pid = int(path.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
        return True
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return False


def require_stopped(source_daemon: Path, target_daemon: Path) -> None:
    for process in ("Paseo", "Paseito", "Paseo Daemon", "Paseito Daemon"):
        result = subprocess.run(
            ["/usr/bin/pgrep", "-x", process], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        if result.returncode == 0:
            raise MigrationError(f"{process} must be stopped before migration")
    for pid_file in (
        source_daemon / "paseo.pid",
        target_daemon / "paseo.pid",
        target_daemon / "paseito.pid",
    ):
        if live_pid_file(pid_file):
            raise MigrationError("a Paseo or Paseito daemon is still running")


def is_excluded(relative: Path) -> bool:
    lowered = [part.casefold() for part in relative.parts]
    return any(part in EXCLUDED_PARTS for part in lowered) or any(
        relative.name.casefold().endswith(suffix) for suffix in EXCLUDED_SUFFIXES
    )


def existing_allowlist(source: Path, allowlist: Iterable[str]) -> list[str]:
    values: list[str] = []
    for name in allowlist:
        path = source / name
        if path.exists() and not is_excluded(Path(name)):
            values.append(name)
    return values


def plan_receipt(electron_items: list[str], daemon_items: list[str]) -> str:
    payload = json.dumps(
        {"electron": sorted(electron_items), "daemon": sorted(daemon_items), "schema": 1},
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def ignore_excluded(root: str, names: list[str]) -> set[str]:
    root_path = Path(root)
    ignored: set[str] = set()
    for name in names:
        candidate = root_path / name
        if candidate.is_symlink() or is_excluded(Path(*candidate.parts[-2:])):
            ignored.add(name)
    return ignored


def copy_allowlisted(source: Path, destination: Path, items: Iterable[str]) -> None:
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in items:
        source_path = source / name
        target_path = destination / name
        if source_path.is_symlink():
            continue
        if source_path.is_dir():
            shutil.copytree(
                source_path,
                target_path,
                dirs_exist_ok=True,
                symlinks=False,
                ignore=ignore_excluded,
            )
        elif source_path.is_file():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)


def rewrite_strings(value: Any, old_home: str, new_home: str) -> Any:
    if isinstance(value, str):
        return value.replace(old_home, new_home)
    if isinstance(value, list):
        return [rewrite_strings(item, old_home, new_home) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_strings(item, old_home, new_home) for key, item in value.items()}
    return value


def transform_daemon_config(path: Path, source_home: Path, target_home: Path) -> None:
    if not path.exists():
        return
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MigrationError("source daemon config is locked or invalid") from error
    value = rewrite_strings(value, str(source_home), str(target_home))
    if not isinstance(value, dict):
        raise MigrationError("source daemon config is not an object")
    daemon = value.setdefault("daemon", {})
    if not isinstance(daemon, dict):
        daemon = {}
        value["daemon"] = daemon
    daemon["listen"] = "127.0.0.1:6769"
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def create_fresh_server_id(target_daemon: Path) -> None:
    random_part = base64.urlsafe_b64encode(secrets.token_bytes(9)).decode("ascii").rstrip("=")
    path = target_daemon / "server-id"
    path.write_text(f"srv_{random_part}\n", encoding="utf-8")
    os.chmod(path, 0o600)


def backup_targets(target_electron: Path, target_daemon: Path, backup_root: Path) -> Path | None:
    existing = [("application", target_electron), ("daemon", target_daemon)]
    existing = [(label, path) for label, path in existing if path.exists()]
    if not existing:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_root / stamp
    suffix = 1
    while backup.exists():
        backup = backup_root / f"{stamp}-{suffix}"
        suffix += 1
    backup.mkdir(parents=True, mode=0o700)
    for label, path in existing:
        shutil.copytree(path, backup / label, symlinks=False)
    return backup


def replace_tree(target: Path, stage: Path) -> None:
    previous = target.with_name(target.name + ".migration-previous")
    if previous.exists():
        shutil.rmtree(previous)
    if target.exists():
        os.replace(target, previous)
    try:
        os.replace(stage, target)
    except Exception:
        if previous.exists():
            os.replace(previous, target)
        raise
    if previous.exists():
        shutil.rmtree(previous)


def restore_target(target: Path, backup: Path | None, label: str, existed: bool) -> None:
    if target.exists():
        shutil.rmtree(target)
    if existed:
        if backup is None:
            raise MigrationError(f"migration rollback is missing the {label} backup")
        shutil.copytree(backup / label, target, symlinks=False)


def apply_migration(
    source_electron: Path,
    target_electron: Path,
    source_daemon: Path,
    target_daemon: Path,
    electron_items: list[str],
    daemon_items: list[str],
    backup_root: Path,
) -> Path | None:
    electron_existed = target_electron.exists()
    daemon_existed = target_daemon.exists()
    backup = backup_targets(target_electron, target_daemon, backup_root)
    target_electron.parent.mkdir(parents=True, exist_ok=True)
    stage_parent = Path(tempfile.mkdtemp(prefix="paseito-migration-", dir=target_electron.parent))
    try:
        app_stage = stage_parent / "application"
        daemon_stage = stage_parent / "daemon"
        if target_electron.exists():
            shutil.copytree(target_electron, app_stage, symlinks=False)
        if target_daemon.exists():
            shutil.copytree(target_daemon, daemon_stage, symlinks=False)
        copy_allowlisted(source_electron, app_stage, electron_items)
        copy_allowlisted(source_daemon, daemon_stage, daemon_items)
        transform_daemon_config(daemon_stage / "config.json", source_daemon, target_daemon)
        for forbidden in (
            "server-id",
            "daemon-keypair.json",
            "push-tokens.json",
            "paseo.pid",
            "paseito.pid",
        ):
            forbidden_path = daemon_stage / forbidden
            if forbidden_path.is_dir():
                shutil.rmtree(forbidden_path)
            else:
                forbidden_path.unlink(missing_ok=True)
        create_fresh_server_id(daemon_stage)
        try:
            replace_tree(target_electron, app_stage)
            replace_tree(target_daemon, daemon_stage)
        except Exception as error:
            restore_target(target_electron, backup, "application", electron_existed)
            restore_target(target_daemon, backup, "daemon", daemon_existed)
            raise MigrationError("migration replacement failed and was rolled back") from error
    finally:
        shutil.rmtree(stage_parent, ignore_errors=True)
    return backup


def main() -> int:
    home = Path.home()
    parser = argparse.ArgumentParser(
        description="Migrate supported Paseo state. Run without --apply first and save its receipt."
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--receipt")
    parser.add_argument("--source-electron", type=Path, default=home / "Library/Application Support/Paseo")
    parser.add_argument("--target-electron", type=Path, default=home / "Library/Application Support/Paseito")
    parser.add_argument("--source-daemon", type=Path, default=home / ".paseo")
    parser.add_argument("--target-daemon", type=Path, default=home / ".paseito")
    parser.add_argument(
        "--backup-root", type=Path, default=home / "Library/Application Support/Paseito Migration Backups"
    )
    args = parser.parse_args()
    require_stopped(args.source_daemon, args.target_daemon)
    electron_items = existing_allowlist(args.source_electron, ELECTRON_ALLOWLIST)
    daemon_items = existing_allowlist(args.source_daemon, DAEMON_ALLOWLIST)
    receipt = plan_receipt(electron_items, daemon_items)
    summary = {
        "mode": "apply" if args.apply else "dry-run",
        "electronItems": electron_items,
        "daemonItems": daemon_items,
        "excludedIdentity": ["server-id", "daemon-keypair.json", "push-tokens.json"],
        "freshDaemonIdentity": "new-server-id; new-keypair-on-first-start",
        "externalCliCredentials": "reused-in-place-not-copied",
        "browserCookies": "best-effort; reauthentication may be required",
        "receipt": receipt,
    }
    if not args.apply:
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    if args.receipt != receipt:
        raise MigrationError("--apply requires the receipt from a current dry run")
    backup = apply_migration(
        args.source_electron,
        args.target_electron,
        args.source_daemon,
        args.target_daemon,
        electron_items,
        daemon_items,
        args.backup_root,
    )
    summary["backupCreated"] = backup is not None
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MigrationError as error:
        print(f"Migration stopped: {error}")
        raise SystemExit(1)
