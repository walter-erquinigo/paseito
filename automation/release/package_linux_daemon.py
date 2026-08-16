#!/usr/bin/env python3
"""Build a self-contained Linux x86_64 Paseito daemon runtime bundle."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Any

WORKSPACES = ("highlight", "relay", "protocol", "client", "server", "cli")
SOURCE_REPOSITORY = "walter-erquinigo/paseito"
INTEGRITY_PATH = "runtime-integrity.json"
INTEGRITY_EXCLUDES = {"manifest.json", INTEGRITY_PATH}


def command(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def pack_arguments(destination: Path, workspace: str) -> list[str]:
    return [
        "npm",
        "pack",
        "--json",
        "--ignore-scripts",
        f"--workspace=@getpaseo/{workspace}",
        "--pack-destination",
        str(destination),
    ]


def packed_workspace(root: Path, destination: Path, workspace: str) -> Path:
    result = command(pack_arguments(destination, workspace), root)
    value = json.loads(result.stdout)
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise RuntimeError(f"npm pack returned invalid metadata for {workspace}")
    filename = value[0].get("filename")
    if not isinstance(filename, str):
        raise RuntimeError(f"npm pack did not name the {workspace} artifact")
    path = destination / filename
    if not path.is_file():
        raise RuntimeError(f"npm pack did not create {path}")
    return path


def validate_local_workspace_resolution(stage: Path) -> None:
    lock = json.loads((stage / "package-lock.json").read_text(encoding="utf-8"))
    packages = lock.get("packages")
    if not isinstance(packages, dict):
        raise RuntimeError("staged runtime lockfile has no package map")
    for workspace in WORKSPACES:
        key = f"node_modules/@getpaseo/{workspace}"
        entry = packages.get(key)
        if not isinstance(entry, dict) or not str(entry.get("resolved", "")).startswith("file:"):
            raise RuntimeError(f"{key} did not resolve from the verified candidate")
    feature_source = stage / "node_modules/@getpaseo/server/dist/server/server/websocket-server.js"
    feature_text = feature_source.read_text(encoding="utf-8") if feature_source.is_file() else ""
    required_features = (
        "changesBaseSelector",
        "changesStackParentBase",
        "changesContextExpansion",
        "reviewSuggestionsV1",
        "fileReviewV1",
        "workspaceLsp",
        "workspaceLspClangd",
        "workspaceFileSearch",
        "checkoutDiffSearch",
        "checkoutCommitAmend",
    )
    missing_features = [feature for feature in required_features if feature not in feature_text]
    if missing_features:
        raise RuntimeError(f"staged daemon does not advertise {', '.join(missing_features)}")


def normalized_tar_info(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = 0
    return info


def write_bundle(stage: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with temporary.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as zipped:
            with tarfile.open(fileobj=zipped, mode="w") as archive:
                archive.add(stage, arcname="paseito-daemon", filter=normalized_tar_info)
    temporary.replace(output)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def runtime_integrity(stage: Path) -> dict[str, Any]:
    entries: list[dict[str, str]] = []
    for path in sorted(stage.rglob("*"), key=lambda item: item.relative_to(stage).as_posix()):
        relative = path.relative_to(stage).as_posix()
        if relative in INTEGRITY_EXCLUDES:
            continue
        if path.is_symlink():
            entries.append({"path": relative, "target": os.readlink(path), "type": "symlink"})
        elif path.is_file():
            entries.append(
                {
                    "path": relative,
                    "sha256": sha256_bytes(path.read_bytes()),
                    "type": "file",
                }
            )
    return {"schemaVersion": 1, "entries": entries}


def write_runtime_integrity(stage: Path) -> dict[str, Any]:
    value = runtime_integrity(stage)
    content = json.dumps(value, separators=(",", ":"), sort_keys=True).encode() + b"\n"
    (stage / INTEGRITY_PATH).write_bytes(content)
    return {
        "algorithm": "sha256",
        "entryCount": len(value["entries"]),
        "path": INTEGRITY_PATH,
        "sha256": sha256_bytes(content),
    }


def manifest(
    version: str,
    commit: str,
    daemon_version: str,
    release_tag: str,
    integrity: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": 3,
        "product": "Paseito daemon",
        "version": version,
        "daemonVersion": daemon_version,
        "commit": commit,
        "source": {
            "repository": SOURCE_REPOSITORY,
            "commit": commit,
            "releaseTag": release_tag,
        },
        "runtimeIntegrity": integrity,
        "platform": "linux",
        "architecture": "x64",
        "nodeMajor": 22,
        "entrypoint": "node_modules/@getpaseo/cli/bin/paseito",
        "feature": "changesBaseSelector",
        "features": [
            "changesBaseSelector",
            "changesStackParentBase",
            "changesContextExpansion",
            "reviewSuggestionsV1",
            "fileReviewV1",
            "workspaceLsp",
            "workspaceLspClangd",
            "workspaceFileSearch",
            "checkoutDiffSearch",
            "checkoutCommitAmend",
        ],
    }


def prepare_stage(work: Path) -> tuple[Path, Path]:
    stage = work / "stage"
    packs = stage / ".packs"
    stage.mkdir()
    packs.mkdir()
    return stage, packs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--release-tag", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise RuntimeError("Linux daemon bundles must be built on Linux x86_64")
    daemon_version = str(
        json.loads((root / "packages/server/package.json").read_text(encoding="utf-8"))["version"]
    )
    with tempfile.TemporaryDirectory(prefix="paseito-linux-bundle-") as directory:
        work = Path(directory)
        stage, packs = prepare_stage(work)
        tarballs = [packed_workspace(root, packs, workspace) for workspace in WORKSPACES]
        package = {
            "name": "paseito-daemon-runtime",
            "version": args.version,
            "private": True,
            "dependencies": {
                f"@getpaseo/{workspace}": f"file:.packs/{tarball.name}"
                for workspace, tarball in zip(WORKSPACES, tarballs, strict=True)
            },
        }
        (stage / "package.json").write_text(
            json.dumps(package, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        command(
            ["npm", "install", "--omit=dev", "--no-audit", "--no-fund"],
            stage,
        )
        validate_local_workspace_resolution(stage)
        shutil.rmtree(packs)
        integrity = write_runtime_integrity(stage)
        (stage / "manifest.json").write_text(
            json.dumps(
                manifest(
                    args.version,
                    args.commit,
                    daemon_version,
                    args.release_tag,
                    integrity,
                ),
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        os.chmod(stage / "node_modules/@getpaseo/cli/bin/paseito", 0o755)
        write_bundle(stage, args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
