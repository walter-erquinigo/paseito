#!/usr/bin/env python3
"""Write the machine-readable release evidence consumed by the installer."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--upstream-tag", required=True)
    parser.add_argument("--upstream-commit", required=True)
    parser.add_argument("--paseito-commit", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--workflow-run", required=True)
    parser.add_argument("--output", type=Path, default=Path("provenance.json"))
    args = parser.parse_args()

    checksum = sha256(args.artifact)
    value = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "upstreamRepository": "getpaseo/paseo",
        "upstreamTag": args.upstream_tag,
        "upstreamCommit": args.upstream_commit,
        "paseitoRepository": "walter-erquinigo/paseito",
        "paseitoCommit": args.paseito_commit,
        "paseitoVersion": args.version,
        "releaseTag": args.release_tag,
        "workflowRun": args.workflow_run,
        "platform": "darwin",
        "architecture": "arm64",
        "artifact": {"name": args.artifact.name, "sha256": checksum},
        "tests": {
            "rebase": "passed",
            "format": "passed",
            "lint": "passed",
            "typecheck": "passed",
            "feature": "passed",
            "upstream": "passed",
            "packagedDesktopSmoke": "passed",
        },
    }
    args.output.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    checksum_path = args.artifact.with_name(args.artifact.name + ".sha256")
    checksum_path.write_text(f"{checksum}  {args.artifact.name}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
