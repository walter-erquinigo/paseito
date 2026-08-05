from __future__ import annotations

import hashlib
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path

from deploy_remote_daemons import REMOTE_INSTALL, resolve_artifact, validate_private_config, write_state


class RemoteDeploymentTests(unittest.TestCase):
    def test_private_registry_preserves_exact_identity_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "hosts.json"
            path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "hosts": [
                            {
                                "id": "viking-new",
                                "sshTarget": "viking-new",
                                "architecture": "linux-x64",
                                "node": "/raid/node",
                                "runtimeRoot": "/raid/paseito-daemon",
                                "service": "paseo.service",
                                "paseoHome": ".paseo",
                                "listen": "127.0.0.1:6767",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            os.chmod(path, 0o600)
            hosts = validate_private_config(path)
        self.assertEqual(hosts[0]["paseoHome"], ".paseo")
        self.assertEqual(hosts[0]["listen"], "127.0.0.1:6767")

    def test_provenance_selects_checksum_bound_linux_daemon(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "daemon.tar.gz"
            with tarfile.open(artifact, "w:gz") as archive:
                payload = b"{}"
                info = tarfile.TarInfo("paseito-daemon/manifest.json")
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            provenance = root / "provenance.json"
            provenance.write_text(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "artifacts": [
                            {
                                "kind": "daemon",
                                "platform": "linux",
                                "architecture": "x64",
                                "name": artifact.name,
                                "sha256": digest,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            resolved, _ = resolve_artifact(provenance)
        self.assertEqual(resolved.name, "daemon.tar.gz")

    def test_remote_transaction_verifies_identity_and_rolls_back(self) -> None:
        self.assertIn('before_id="$(cat "$HOME/$paseo_home/server-id")"', REMOTE_INSTALL)
        self.assertIn('test "$(cat "$HOME/$paseo_home/server-id")" = "$before_id"', REMOTE_INSTALL)
        self.assertIn("remote-busy:", REMOTE_INSTALL)
        self.assertIn("rollback()", REMOTE_INSTALL)
        self.assertIn('systemctl --user restart "$service"', REMOTE_INSTALL)
        self.assertIn("changesBaseSelector", REMOTE_INSTALL)
        self.assertGreaterEqual(REMOTE_INSTALL.count("ensure_idle"), 3)

    def test_state_is_atomic_and_private(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            write_state(path, {"schemaVersion": 1, "hosts": []})
            mode = path.stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)


if __name__ == "__main__":
    unittest.main()
