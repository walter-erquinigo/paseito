from __future__ import annotations

import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from write_provenance import main


class WriteProvenanceTests(unittest.TestCase):
    def test_provenance_binds_linux_manifest_and_runtime_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            desktop = root / "Paseito-1.0.0-paseito.1-arm64.zip"
            desktop.write_bytes(b"desktop")
            linux = root / "Paseito-daemon-1.0.0-paseito.1-linux-x64.tar.gz"
            inventory = b'{"entries":[],"schemaVersion":1}\n'
            inventory_digest = hashlib.sha256(inventory).hexdigest()
            manifest = json.dumps(
                {
                    "schemaVersion": 3,
                    "commit": "a" * 40,
                    "version": "1.0.0-paseito.1",
                    "source": {
                        "repository": "walter-erquinigo/paseito",
                        "commit": "a" * 40,
                        "releaseTag": "paseito-v1.0.0-paseito.1",
                    },
                    "runtimeIntegrity": {
                        "algorithm": "sha256",
                        "entryCount": 0,
                        "path": "runtime-integrity.json",
                        "sha256": inventory_digest,
                    },
                },
                sort_keys=True,
            ).encode()
            with tarfile.open(linux, "w:gz") as archive:
                member = tarfile.TarInfo("paseito-daemon/manifest.json")
                member.size = len(manifest)
                archive.addfile(member, io.BytesIO(manifest))
                member = tarfile.TarInfo("paseito-daemon/runtime-integrity.json")
                member.size = len(inventory)
                archive.addfile(member, io.BytesIO(inventory))
            decision = root / "decision.json"
            decision.write_text('{"decision":{"features":[]}}\n', encoding="utf-8")
            output = root / "provenance.json"
            arguments = [
                "write_provenance.py",
                "--artifact",
                str(desktop),
                "--linux-artifact",
                str(linux),
                "--upstream-tag",
                "v1.0.0",
                "--upstream-commit",
                "b" * 40,
                "--paseito-commit",
                "a" * 40,
                "--version",
                "1.0.0-paseito.1",
                "--release-tag",
                "paseito-v1.0.0-paseito.1",
                "--workflow-run",
                "https://github.example/run/1",
                "--decision",
                str(decision),
                "--output",
                str(output),
            ]

            with patch.object(sys, "argv", arguments):
                self.assertEqual(main(), 0)
            provenance = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(provenance["schemaVersion"], 3)
        self.assertEqual(
            provenance["daemonRuntime"]["runtimeIntegritySha256"], inventory_digest
        )
        daemon = next(item for item in provenance["artifacts"] if item["kind"] == "daemon")
        self.assertEqual(daemon["manifestSha256"], hashlib.sha256(manifest).hexdigest())
        self.assertEqual(daemon["runtimeIntegritySha256"], inventory_digest)


if __name__ == "__main__":
    unittest.main()
