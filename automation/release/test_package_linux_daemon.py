from __future__ import annotations

import gzip
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from package_linux_daemon import (
    manifest,
    pack_arguments,
    prepare_stage,
    runtime_integrity,
    write_bundle,
    write_runtime_integrity,
)


class PackageLinuxDaemonTests(unittest.TestCase):
    def test_workspace_pack_uses_prebuilt_files_without_lifecycle_output(self) -> None:
        arguments = pack_arguments(Path("packs"), "server")
        self.assertIn("--json", arguments)
        self.assertIn("--ignore-scripts", arguments)
        self.assertIn("--workspace=@getpaseo/server", arguments)

    def test_stage_contains_workspace_pack_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stage, packs = prepare_stage(Path(directory))
            self.assertEqual(packs, stage / ".packs")
            self.assertTrue(packs.is_dir())

    def test_manifest_binds_runtime_to_candidate(self) -> None:
        integrity = {
            "algorithm": "sha256",
            "entryCount": 10,
            "path": "runtime-integrity.json",
            "sha256": "d" * 64,
        }
        self.assertEqual(
            manifest(
                "0.2.5-paseito.4",
                "a" * 40,
                "0.2.5",
                "paseito-v0.2.5-paseito.4",
                integrity,
            ),
            {
                "schemaVersion": 3,
                "product": "Paseito daemon",
                "version": "0.2.5-paseito.4",
                "daemonVersion": "0.2.5",
                "commit": "a" * 40,
                "source": {
                    "repository": "walter-erquinigo/paseito",
                    "commit": "a" * 40,
                    "releaseTag": "paseito-v0.2.5-paseito.4",
                },
                "runtimeIntegrity": integrity,
                "platform": "linux",
                "architecture": "x64",
                "nodeMajor": 22,
                "entrypoint": "node_modules/@getpaseo/cli/bin/paseito",
                "feature": "changesBaseSelector",
                "features": [
                    "changesBaseSelector",
                    "changesContextExpansion",
                    "reviewSuggestionsV1",
                    "fileReviewV1",
                    "workspaceLsp",
                    "workspaceLspClangd",
                    "workspaceFileSearch",
                    "checkoutDiffSearch",
                    "checkoutCommitAmend",
                ],
            },
        )

    def test_runtime_integrity_covers_files_and_symlink_targets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            (stage / "bin").mkdir()
            (stage / "bin/daemon").write_text("runtime\n", encoding="utf-8")
            (stage / "current").symlink_to("bin/daemon")
            (stage / "manifest.json").write_text("excluded\n", encoding="utf-8")
            metadata = write_runtime_integrity(stage)
            value = json.loads((stage / "runtime-integrity.json").read_text(encoding="utf-8"))
            observed = runtime_integrity(stage)

        self.assertEqual(metadata["entryCount"], 2)
        self.assertEqual(
            value["entries"],
            [
                {
                    "path": "bin/daemon",
                    "sha256": "fae9d8f386d67956867dedef7c89476199a4a25ee9ffe13560a6bfae7ae6c407",
                    "type": "file",
                },
                {"path": "current", "target": "bin/daemon", "type": "symlink"},
            ],
        )
        self.assertEqual(observed, value)

    def test_bundle_has_stable_metadata_and_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage = root / "stage"
            stage.mkdir()
            (stage / "manifest.json").write_text(
                json.dumps(
                    manifest(
                        "1-paseito.1",
                        "b" * 40,
                        "1",
                        "paseito-v1-paseito.1",
                        {
                            "algorithm": "sha256",
                            "entryCount": 0,
                            "path": "runtime-integrity.json",
                            "sha256": "c" * 64,
                        },
                    )
                )
            )
            first = root / "first.tar.gz"
            second = root / "second.tar.gz"
            write_bundle(stage, first)
            write_bundle(stage, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with gzip.open(first, "rb") as zipped:
                with tarfile.open(fileobj=zipped, mode="r:") as archive:
                    member = archive.getmember("paseito-daemon/manifest.json")
                    self.assertEqual(member.mtime, 0)


if __name__ == "__main__":
    unittest.main()
