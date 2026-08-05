from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from migrate_from_paseo import (
    MigrationError,
    apply_migration,
    existing_allowlist,
    plan_receipt,
    ELECTRON_ALLOWLIST,
    DAEMON_ALLOWLIST,
)


class MigrationTests(unittest.TestCase):
    def test_allowlist_and_apply_exclude_identity_and_transform_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_app = root / "Paseo"
            target_app = root / "Paseito"
            source_daemon = root / ".paseo"
            target_daemon = root / ".paseito"
            (source_app / "Local Storage").mkdir(parents=True)
            (source_app / "Local Storage/state").write_text("workspace", encoding="utf-8")
            (source_app / "Cache").mkdir()
            (source_app / "Cache/secret").write_text("no", encoding="utf-8")
            (source_daemon / "agents").mkdir(parents=True)
            (source_daemon / "agents/one.json").write_text("{}", encoding="utf-8")
            (source_daemon / "server-id").write_text("old", encoding="utf-8")
            (source_daemon / "daemon-keypair.json").write_text("secret", encoding="utf-8")
            (source_daemon / "push-tokens.json").write_text("secret", encoding="utf-8")
            (source_daemon / "config.json").write_text(
                json.dumps({"daemon": {"listen": "127.0.0.1:6768"}, "home": str(source_daemon)}),
                encoding="utf-8",
            )
            target_app.mkdir()
            (target_app / "existing").write_text("keep", encoding="utf-8")
            target_daemon.mkdir()

            electron = existing_allowlist(source_app, ELECTRON_ALLOWLIST)
            daemon = existing_allowlist(source_daemon, DAEMON_ALLOWLIST)
            receipt = plan_receipt(electron, daemon)
            self.assertEqual(receipt, plan_receipt(electron, daemon))
            backup = apply_migration(
                source_app,
                target_app,
                source_daemon,
                target_daemon,
                electron,
                daemon,
                root / "backups",
            )
            self.assertIsNotNone(backup)
            self.assertTrue((target_app / "existing").exists())
            self.assertTrue((target_app / "Local Storage/state").exists())
            self.assertFalse((target_app / "Cache").exists())
            self.assertTrue((target_daemon / "agents/one.json").exists())
            self.assertFalse((target_daemon / "daemon-keypair.json").exists())
            self.assertFalse((target_daemon / "push-tokens.json").exists())
            server_id = (target_daemon / "server-id").read_text(encoding="utf-8").strip()
            self.assertTrue(server_id.startswith("srv_"))
            self.assertNotEqual(server_id, "old")
            config = json.loads((target_daemon / "config.json").read_text(encoding="utf-8"))
            self.assertEqual(config["daemon"]["listen"], "127.0.0.1:6769")
            self.assertEqual(config["home"], str(target_daemon))

    def test_second_tree_failure_restores_both_existing_targets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_app = root / "Paseo"
            target_app = root / "Paseito"
            source_daemon = root / ".paseo"
            target_daemon = root / ".paseito"
            (source_app / "Local Storage").mkdir(parents=True)
            (source_app / "Local Storage/new").write_text("new", encoding="utf-8")
            (source_daemon / "agents").mkdir(parents=True)
            (source_daemon / "agents/new.json").write_text("{}", encoding="utf-8")
            target_app.mkdir()
            (target_app / "original").write_text("application", encoding="utf-8")
            target_daemon.mkdir()
            (target_daemon / "original").write_text("daemon", encoding="utf-8")

            from migrate_from_paseo import replace_tree as real_replace_tree

            calls = 0

            def fail_second(target: Path, stage: Path) -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("synthetic replacement failure")
                real_replace_tree(target, stage)

            with patch("migrate_from_paseo.replace_tree", side_effect=fail_second):
                with self.assertRaises(MigrationError):
                    apply_migration(
                        source_app,
                        target_app,
                        source_daemon,
                        target_daemon,
                        existing_allowlist(source_app, ELECTRON_ALLOWLIST),
                        existing_allowlist(source_daemon, DAEMON_ALLOWLIST),
                        root / "backups",
                    )

            self.assertEqual((target_app / "original").read_text(encoding="utf-8"), "application")
            self.assertEqual((target_daemon / "original").read_text(encoding="utf-8"), "daemon")
            self.assertFalse((target_app / "Local Storage").exists())
            self.assertFalse((target_daemon / "agents").exists())


if __name__ == "__main__":
    unittest.main()
