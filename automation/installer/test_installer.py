from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from paseito_installer import (
    InstallError,
    atomic_swap,
    install_local_app,
    run_checked,
    sanitized_status,
    verify_app,
)


class InstallerTests(unittest.TestCase):
    def make_app(self, root: Path, version: str = "0.7.2-paseito.55") -> Path:
        app = root / "Paseito.app"
        executable = app / "Contents/MacOS/Paseito"
        executable.parent.mkdir(parents=True)
        executable.write_bytes(b"app")
        with (app / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(
                {
                    "CFBundleIdentifier": "dev.werquinigo.paseito",
                    "CFBundleShortVersionString": version,
                },
                stream,
            )
        return app

    def test_local_app_verification_binds_identity_version_and_arm64(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(Path(directory))
            with patch("paseito_installer.run_checked", return_value="arm64") as checked:
                verify_app(app, "0.7.2-paseito.55")
            checked.assert_called_once_with(
                ["/usr/bin/lipo", "-archs", str(app / "Contents/MacOS/Paseito")],
                "architecture",
            )
            with (
                patch("paseito_installer.run_checked", return_value="x86_64"),
                self.assertRaisesRegex(InstallError, "not arm64-only"),
            ):
                verify_app(app, "0.7.2-paseito.55")
            with self.assertRaisesRegex(InstallError, "requested version"):
                verify_app(app, "0.7.2-paseito.56")

    def test_same_verified_local_version_does_not_replace_installed_app(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.make_app(root / "source")
            destination = self.make_app(root / "installed")
            with (
                patch("paseito_installer.verify_host"),
                patch("paseito_installer.run_checked", return_value="arm64"),
                patch("paseito_installer.is_running", return_value=False),
                patch("paseito_installer.pending_restart_marker", return_value=root / "pending"),
            ):
                status = install_local_app(source, "0.7.2-paseito.55", destination)
            self.assertEqual(status["category"], "no-change")
            self.assertFalse(status["pendingRestart"])

    def test_status_has_only_local_sanitized_fields(self) -> None:
        value = sanitized_status("0.7.2-paseito.55", True, "success", "installed")
        self.assertEqual(
            set(value),
            {
                "schemaVersion",
                "installedVersion",
                "timestamp",
                "pendingRestart",
                "result",
                "category",
            },
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
