from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from paseito_installer import (
    InstallError,
    atomic_swap,
    run_checked,
    sanitized_status,
    select_release,
    validate_checksum,
    validate_provenance,
    validate_zip_members,
)


class InstallerTests(unittest.TestCase):
    def test_release_selection_ignores_drafts_and_prereleases(self) -> None:
        release = select_release(
            [
                {"tag_name": "paseito-v2.0.0-paseito.1", "draft": True},
                {"tag_name": "paseito-v1.1.0-paseito.1", "prerelease": True},
                {"tag_name": "paseito-v1.0.0-paseito.1"},
            ]
        )
        self.assertEqual(release["tag_name"], "paseito-v1.0.0-paseito.1")

    def test_provenance_binds_release_and_commit(self) -> None:
        commit = "a" * 40
        value = {
            "schemaVersion": 1,
            "paseitoRepository": "walter-erquinigo/paseito",
            "releaseTag": "paseito-v0.2.5-paseito.1",
            "paseitoCommit": commit,
            "paseitoVersion": "0.2.5-paseito.1",
            "platform": "darwin",
            "architecture": "arm64",
            "artifact": {"name": "Paseito-0.2.5-paseito.1-arm64.zip", "sha256": "b" * 64},
        }
        self.assertIs(validate_provenance(value, value["releaseTag"], commit), value)
        with self.assertRaises(InstallError):
            validate_provenance(value, value["releaseTag"], "c" * 40)
        value["architecture"] = "x86_64"
        with self.assertRaises(InstallError):
            validate_provenance(value, value["releaseTag"], commit)

    def test_schema_two_binds_desktop_to_multi_platform_artifact_set(self) -> None:
        commit = "a" * 40
        desktop = {"name": "Paseito-0.2.5-paseito.3-arm64.zip", "sha256": "b" * 64}
        value = {
            "schemaVersion": 2,
            "paseitoRepository": "walter-erquinigo/paseito",
            "releaseTag": "paseito-v0.2.5-paseito.3",
            "paseitoCommit": commit,
            "paseitoVersion": "0.2.5-paseito.3",
            "platform": "darwin",
            "architecture": "arm64",
            "artifact": desktop,
            "artifacts": [
                {"kind": "desktop", "platform": "darwin", "architecture": "arm64", **desktop},
                {
                    "kind": "daemon",
                    "platform": "linux",
                    "architecture": "x64",
                    "name": "Paseito-daemon-0.2.5-paseito.3-linux-x64.tar.gz",
                    "sha256": "c" * 64,
                },
            ],
        }
        self.assertIs(validate_provenance(value, value["releaseTag"], commit), value)
        value["artifacts"][0]["sha256"] = "d" * 64
        with self.assertRaises(InstallError):
            validate_provenance(value, value["releaseTag"], commit)

    def test_schema_three_binds_daemon_runtime_inventory(self) -> None:
        commit = "a" * 40
        desktop = {"name": "Paseito-0.4.0-paseito.26-arm64.zip", "sha256": "b" * 64}
        daemon = {
            "kind": "daemon",
            "platform": "linux",
            "architecture": "x64",
            "name": "Paseito-daemon-0.4.0-paseito.26-linux-x64.tar.gz",
            "sha256": "c" * 64,
            "manifestSha256": "d" * 64,
            "runtimeIntegritySha256": "e" * 64,
        }
        value = {
            "schemaVersion": 3,
            "paseitoRepository": "walter-erquinigo/paseito",
            "releaseTag": "paseito-v0.4.0-paseito.26",
            "paseitoCommit": commit,
            "paseitoVersion": "0.4.0-paseito.26",
            "platform": "darwin",
            "architecture": "arm64",
            "artifact": desktop,
            "artifacts": [
                {"kind": "desktop", "platform": "darwin", "architecture": "arm64", **desktop},
                daemon,
            ],
            "daemonRuntime": {
                "manifestSha256": daemon["manifestSha256"],
                "runtimeIntegritySha256": daemon["runtimeIntegritySha256"],
            },
        }
        self.assertIs(validate_provenance(value, value["releaseTag"], commit), value)
        value["daemonRuntime"]["runtimeIntegritySha256"] = "f" * 64
        with self.assertRaises(InstallError):
            validate_provenance(value, value["releaseTag"], commit)

    def test_checksum_requires_bytes_and_checksum_asset_to_match_provenance(self) -> None:
        digest = "b" * 64
        name = "Paseito-0.2.5-paseito.1-arm64.zip"
        validate_checksum(digest, digest, f"{digest}  {name}\n", name)
        with self.assertRaises(InstallError):
            validate_checksum("a" * 64, digest, f"{digest}  {name}\n", name)
        with self.assertRaises(InstallError):
            validate_checksum(digest, digest, f"{digest}  other.zip\n", name)

    def test_zip_path_traversal_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("../Paseito.app/escape", "bad")
            with self.assertRaises(InstallError):
                validate_zip_members(path)

    def test_status_has_only_sanitized_fields(self) -> None:
        value = sanitized_status("0.2.5-paseito.1", True, "success", "installed")
        self.assertEqual(
            set(value),
            {"schemaVersion", "installedVersion", "timestamp", "pendingRestart", "result", "category"},
        )
        self.assertNotIn("hostname", str(value).lower())
        self.assertNotIn("/Users/", str(value))

    def test_failed_signing_command_is_fail_closed(self) -> None:
        with self.assertRaises(InstallError) as raised:
            run_checked(["/usr/bin/false"], "sign")
        self.assertEqual(raised.exception.category, "sign")

    def test_atomic_swap_preserves_both_apps(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staged = root / "staged"
            installed = root / "installed"
            staged.write_text("new", encoding="utf-8")
            installed.write_text("old", encoding="utf-8")
            atomic_swap(staged, installed)
            self.assertEqual(installed.read_text(encoding="utf-8"), "new")
            self.assertEqual(staged.read_text(encoding="utf-8"), "old")


if __name__ == "__main__":
    unittest.main()
