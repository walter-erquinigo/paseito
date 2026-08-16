#!/usr/bin/env python3
"""Synchronize Paseito versions without invoking upstream publishing hooks."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

VERSION = re.compile(r"^\d+\.\d+\.\d+-paseito\.[1-9]\d*$")


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("version")
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--upstream-tag")
    parser.add_argument("--upstream-commit")
    args = parser.parse_args()
    if not VERSION.fullmatch(args.version):
        parser.error("version must be MAJOR.MINOR.PATCH-paseito.N")

    root = args.root.resolve()
    # Only the root and packaged desktop app carry the Paseito release version.
    # Retaining upstream internal package versions keeps exact workspace
    # dependency constraints valid and materially reduces future rebase churn.
    manifests = [root / "package.json", root / "packages/desktop/package.json"]
    for manifest in manifests:
        value = load(manifest)
        value["version"] = args.version
        save(manifest, value)

    lock_path = root / "package-lock.json"
    lock = load(lock_path)
    lock["name"] = load(root / "package.json")["name"]
    lock["version"] = args.version
    lock["packages"][""]["name"] = lock["name"]
    lock["packages"][""]["version"] = args.version
    lock["packages"]["packages/desktop"]["version"] = args.version
    save(lock_path, lock)

    if args.upstream_tag and args.upstream_commit:
        metadata_path = root / "automation/upstream.json"
        metadata = load(metadata_path)
        metadata.update(
            upstreamTag=args.upstream_tag,
            upstreamCommit=args.upstream_commit,
            paseitoVersion=args.version,
        )
        save(metadata_path, metadata)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
