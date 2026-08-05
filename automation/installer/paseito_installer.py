#!/usr/bin/env python3
"""Fail-closed macOS installer for provenance-linked Paseito releases."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

API = "https://api.github.com"
REPOSITORY = "walter-erquinigo/paseito"
BUNDLE_ID = "dev.werquinigo.paseito"
VERSION = re.compile(r"^\d+\.\d+\.\d+-paseito\.[1-9]\d*$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")


class InstallError(RuntimeError):
    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category = category


def request_bytes(url: str, token: str | None = None, accept: str = "application/vnd.github+json") -> bytes:
    headers = {"Accept": accept, "User-Agent": "paseito-fail-closed-installer/1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except (urllib.error.URLError, TimeoutError) as error:
        raise InstallError("download", "GitHub download failed") from error


def request_json(url: str, token: str | None = None) -> Any:
    try:
        return json.loads(request_bytes(url, token))
    except json.JSONDecodeError as error:
        raise InstallError("provenance", "GitHub returned invalid JSON") from error


def api(path: str, token: str | None = None) -> Any:
    return request_json(f"{API}{path}", token)


def peel_release_tag(tag: str, token: str | None) -> str:
    ref = api(f"/repos/{REPOSITORY}/git/ref/tags/{tag}", token)["object"]
    seen: set[str] = set()
    while ref.get("type") == "tag":
        sha = ref.get("sha")
        if not isinstance(sha, str) or sha in seen:
            raise InstallError("provenance", "release tag cannot be peeled safely")
        seen.add(sha)
        ref = api(f"/repos/{REPOSITORY}/git/tags/{sha}", token)["object"]
    if ref.get("type") != "commit" or not COMMIT.fullmatch(str(ref.get("sha", ""))):
        raise InstallError("provenance", "release tag does not identify a commit")
    return str(ref["sha"])


def select_release(releases: list[dict[str, Any]]) -> dict[str, Any]:
    for release in releases:
        if release.get("draft") or release.get("prerelease"):
            continue
        if str(release.get("tag_name", "")).startswith("paseito-v"):
            return release
    raise InstallError("release", "no stable Paseito release is available")


def asset_by_name(release: dict[str, Any], name: str) -> dict[str, Any]:
    asset = next((item for item in release.get("assets", []) if item.get("name") == name), None)
    if not asset or not isinstance(asset.get("browser_download_url"), str):
        raise InstallError("provenance", f"release asset is missing: {name}")
    return asset


def validate_provenance(value: Any, release_tag: str, peeled_commit: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") not in {1, 2}:
        raise InstallError("provenance", "unsupported provenance schema")
    version = value.get("paseitoVersion")
    artifact = value.get("artifact")
    required = {
        "paseitoRepository": REPOSITORY,
        "releaseTag": release_tag,
        "paseitoCommit": peeled_commit,
        "platform": "darwin",
        "architecture": "arm64",
    }
    if any(value.get(key) != expected for key, expected in required.items()):
        raise InstallError("provenance", "release/tag/commit/platform provenance mismatch")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise InstallError("provenance", "invalid Paseito version")
    if release_tag != f"paseito-v{version}":
        raise InstallError("provenance", "release tag and Paseito version differ")
    if not isinstance(artifact, dict):
        raise InstallError("provenance", "artifact provenance is missing")
    name = artifact.get("name")
    checksum = artifact.get("sha256")
    if not isinstance(name, str) or not re.fullmatch(r"Paseito-[A-Za-z0-9._-]+-arm64\.zip", name):
        raise InstallError("provenance", "unexpected artifact name")
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise InstallError("provenance", "invalid artifact SHA-256")
    if value.get("schemaVersion") == 2:
        entries = value.get("artifacts")
        if not isinstance(entries, list) or len(entries) != 2:
            raise InstallError("provenance", "multi-platform artifact provenance is incomplete")
        identities = {
            (entry.get("kind"), entry.get("platform"), entry.get("architecture"))
            for entry in entries
            if isinstance(entry, dict)
        }
        if identities != {("desktop", "darwin", "arm64"), ("daemon", "linux", "x64")}:
            raise InstallError("provenance", "multi-platform artifact provenance is invalid")
        desktop = next(
            entry
            for entry in entries
            if isinstance(entry, dict) and entry.get("kind") == "desktop"
        )
        if artifact != {"name": desktop.get("name"), "sha256": desktop.get("sha256")}:
            raise InstallError("provenance", "desktop artifact entries do not match")
    return value


def validate_zip_members(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if not names:
            raise InstallError("archive", "artifact ZIP is empty")
        for name in names:
            member = PurePosixPath(name)
            if member.is_absolute() or ".." in member.parts:
                raise InstallError("archive", "artifact ZIP contains an unsafe path")
            info = archive.getinfo(name)
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                target = archive.read(info).decode("utf-8", "surrogateescape")
                if PurePosixPath(target).is_absolute() or ".." in PurePosixPath(target).parts:
                    raise InstallError("archive", "artifact ZIP contains an unsafe symlink")


def validate_checksum(actual: str, declared: str, checksum_text: str, artifact_name: str) -> None:
    expected_line = f"{declared}  {artifact_name}\n"
    if actual != declared or checksum_text != expected_line:
        raise InstallError("checksum", "artifact checksum verification failed")


def run_checked(args: list[str], category: str) -> str:
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise InstallError(category, f"verification command failed: {Path(args[0]).name}")
    return result.stdout.strip()


def verify_app(app: Path, version: str) -> None:
    plist_path = app / "Contents/Info.plist"
    try:
        with plist_path.open("rb") as stream:
            info = plistlib.load(stream)
    except (OSError, plistlib.InvalidFileException) as error:
        raise InstallError("health", "Paseito Info.plist is unreadable") from error
    if info.get("CFBundleIdentifier") != BUNDLE_ID:
        raise InstallError("health", "unexpected bundle identifier")
    if str(info.get("CFBundleShortVersionString")) != version:
        raise InstallError("health", "installed version does not match provenance")
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
    return subprocess.run(
        ["/usr/bin/pgrep", "-x", "Paseito"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    ).returncode == 0


def sanitized_status(version: str | None, pending_restart: bool, result: str, category: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "installedVersion": version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pendingRestart": pending_restart,
        "result": result,
        "category": category,
    }


def resolve_token() -> str | None:
    if os.environ.get("PASEITO_GITHUB_TOKEN"):
        return os.environ["PASEITO_GITHUB_TOKEN"]
    result = subprocess.run(
        ["/usr/bin/env", "gh", "auth", "token"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def dispatch_status(status: dict[str, Any], token: str | None) -> None:
    if not token:
        return
    payload = json.dumps({"event_type": "paseito-local-status", "client_payload": status}).encode()
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "paseito-status/1",
    }
    request = urllib.request.Request(
        f"{API}/repos/{REPOSITORY}/dispatches", data=payload, method="POST", headers=headers
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            return
    except urllib.error.URLError as error:
        raise InstallError("report", "sanitized status dispatch failed") from error


def installed_version(destination: Path) -> str | None:
    try:
        with (destination / "Contents/Info.plist").open("rb") as stream:
            value = plistlib.load(stream).get("CFBundleShortVersionString")
        return str(value) if value else None
    except (OSError, plistlib.InvalidFileException):
        return None


def install() -> dict[str, Any]:
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise InstallError("architecture", "Paseito supports Apple Silicon macOS only")
    token = resolve_token()
    release = select_release(api(f"/repos/{REPOSITORY}/releases?per_page=20", token))
    release_tag = str(release["tag_name"])
    peeled = peel_release_tag(release_tag, token)
    provenance_asset = asset_by_name(release, "provenance.json")
    provenance = validate_provenance(
        request_json(provenance_asset["browser_download_url"], token), release_tag, peeled
    )
    version = str(provenance["paseitoVersion"])
    destination = Path("/Applications/Paseito.app")
    running = is_running()
    if installed_version(destination) == version:
        marker = Path.home() / "Library/Application Support/Paseito/Updater/pending-restart.json"
        status = sanitized_status(version, marker.exists(), "success", "no-change")
        dispatch_status(status, token)
        return status

    artifact_name = str(provenance["artifact"]["name"])
    artifact_asset = asset_by_name(release, artifact_name)
    checksum_asset = asset_by_name(release, artifact_name + ".sha256")
    applications = destination.parent
    temp_root = Path(tempfile.mkdtemp(prefix=".paseito-install-", dir=applications))
    os.chmod(temp_root, 0o700)
    swapped = False
    staged_app: Path | None = None
    try:
        archive = temp_root / artifact_name
        archive.write_bytes(request_bytes(artifact_asset["browser_download_url"], token))
        actual_checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
        declared_checksum = str(provenance["artifact"]["sha256"])
        checksum_text = request_bytes(checksum_asset["browser_download_url"], token).decode("ascii", "strict")
        validate_checksum(actual_checksum, declared_checksum, checksum_text, artifact_name)
        validate_zip_members(archive)
        extract_root = temp_root / "extracted"
        extract_root.mkdir(mode=0o700)
        run_checked(["/usr/bin/ditto", "-x", "-k", str(archive), str(extract_root)], "archive")
        staged_app = extract_root / "Paseito.app"
        if not staged_app.is_dir():
            raise InstallError("archive", "artifact does not contain Paseito.app")
        verify_app(staged_app, version)
        run_checked(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", str(staged_app)], "sign")
        run_checked(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(staged_app)], "sign")
        run_checked(["/usr/bin/xattr", "-dr", "com.apple.quarantine", str(staged_app)], "quarantine")

        if destination.exists():
            atomic_swap(staged_app, destination)
            swapped = True
            try:
                verify_app(destination, version)
                run_checked(
                    ["/usr/bin/codesign", "--verify", "--deep", "--strict", str(destination)], "health"
                )
            except Exception:
                atomic_swap(staged_app, destination)
                swapped = False
                raise
            try:
                backup = Path.home() / "Library/Application Support/Paseito/Updater/previous/Paseito.app"
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
            except Exception:
                if staged_app.exists():
                    atomic_swap(staged_app, destination)
                    swapped = False
                raise InstallError("backup", "new app passed checks but the previous app could not be backed up")
        else:
            os.replace(staged_app, destination)
            try:
                verify_app(destination, version)
            except Exception:
                shutil.rmtree(destination, ignore_errors=True)
                raise

        pending = running
        marker = Path.home() / "Library/Application Support/Paseito/Updater/pending-restart.json"
        marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if pending:
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
        elif marker.exists():
            marker.unlink()
        status = sanitized_status(version, pending, "success", "installed")
        dispatch_status(status, token)
        return status
    finally:
        if swapped and staged_app and staged_app.exists():
            # Preserve the previous app if rollback itself was interrupted or
            # failed. Deleting this private directory would destroy recovery.
            print("Paseito preserved rollback data after an interrupted swap", file=sys.stderr)
        else:
            shutil.rmtree(temp_root, ignore_errors=True)


def main() -> int:
    destination = Path("/Applications/Paseito.app")
    token = resolve_token()
    try:
        status = install()
        print(json.dumps(status, sort_keys=True))
        return 0
    except InstallError as error:
        status = sanitized_status(installed_version(destination), False, "failure", error.category)
        try:
            dispatch_status(status, token)
        except InstallError:
            status["category"] = "report"
        print(json.dumps(status, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
