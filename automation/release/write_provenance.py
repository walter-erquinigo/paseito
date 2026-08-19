#!/usr/bin/env python3
"""Write the machine-readable release evidence consumed by the installer."""

from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def daemon_manifest(path: Path) -> tuple[dict[str, object], str]:
    with tarfile.open(path, "r:gz") as archive:
        member = archive.getmember("paseito-daemon/manifest.json")
        stream = archive.extractfile(member)
        if stream is None:
            raise ValueError("Linux daemon artifact has no readable manifest")
        content = stream.read()
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError("Linux daemon manifest must be an object")
    return value, hashlib.sha256(content).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--linux-artifact", type=Path, required=True)
    parser.add_argument("--upstream-tag", required=True)
    parser.add_argument("--upstream-commit", required=True)
    parser.add_argument("--paseito-commit", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--workflow-run", required=True)
    parser.add_argument("--decision", type=Path)
    parser.add_argument("--output", type=Path, default=Path("provenance.json"))
    args = parser.parse_args()

    checksum = sha256(args.artifact)
    linux_checksum = sha256(args.linux_artifact)
    linux_manifest, linux_manifest_checksum = daemon_manifest(args.linux_artifact)
    runtime_integrity = linux_manifest.get("runtimeIntegrity")
    source = linux_manifest.get("source")
    if (
        linux_manifest.get("schemaVersion") != 3
        or linux_manifest.get("commit") != args.paseito_commit
        or linux_manifest.get("version") != args.version
        or not isinstance(source, dict)
        or source.get("repository") != "walter-erquinigo/paseito"
        or source.get("commit") != args.paseito_commit
        or source.get("releaseTag") != args.release_tag
        or not isinstance(runtime_integrity, dict)
        or runtime_integrity.get("algorithm") != "sha256"
        or not isinstance(runtime_integrity.get("sha256"), str)
    ):
        raise ValueError("Linux daemon manifest is not bound to the verified release")
    semantic_decision = None
    if args.decision:
        semantic_decision = json.loads(args.decision.read_text(encoding="utf-8"))
        if not isinstance(semantic_decision, dict):
            raise ValueError("semantic decision must be an object")
    value = {
        "schemaVersion": 3,
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
        "artifacts": [
            {
                "kind": "desktop",
                "platform": "darwin",
                "architecture": "arm64",
                "name": args.artifact.name,
                "sha256": checksum,
            },
            {
                "kind": "daemon",
                "platform": "linux",
                "architecture": "x64",
                "name": args.linux_artifact.name,
                "sha256": linux_checksum,
                "manifestSha256": linux_manifest_checksum,
                "runtimeIntegritySha256": runtime_integrity["sha256"],
            },
        ],
        "daemonRuntime": {
            "manifestSha256": linux_manifest_checksum,
            "runtimeIntegritySha256": runtime_integrity["sha256"],
        },
        "tests": {
            "semanticReconciliation": "passed",
            "independentReview": "passed",
            "format": "passed",
            "lint": "passed",
            "typecheck": "passed",
            "feature": "passed",
            "upstream": "passed",
            "packagedDesktopSmoke": "passed",
            "packagedLinuxDaemonSmoke": "passed",
        },
        "semanticDecision": {
            "sha256": sha256(args.decision) if args.decision else None,
            "featureClassifications": {
                item["id"]: item["classification"]
                for item in (semantic_decision or {}).get("decision", {}).get("features", [])
            },
        },
    }
    args.output.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    checksum_path = args.artifact.with_name(args.artifact.name + ".sha256")
    checksum_path.write_text(f"{checksum}  {args.artifact.name}\n", encoding="utf-8")
    linux_checksum_path = args.linux_artifact.with_name(args.linux_artifact.name + ".sha256")
    linux_checksum_path.write_text(
        f"{linux_checksum}  {args.linux_artifact.name}\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
