from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from deploy_remote_daemons import (
    REMOTE_INSTALL,
    create_github_deployment,
    resolve_artifact,
    validate_private_config,
    verify_published_release,
    write_state,
)


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
                                "toolPath": "/raid/npm/bin:/raid/node/bin:/usr/bin:/bin",
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
        self.assertEqual(hosts[0]["toolPath"].split(":")[0], "/raid/npm/bin")

    def test_provenance_selects_checksum_bound_linux_daemon(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "daemon.tar.gz"
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
                }
            ).encode()
            manifest_digest = hashlib.sha256(manifest).hexdigest()
            with tarfile.open(artifact, "w:gz") as archive:
                info = tarfile.TarInfo("paseito-daemon/manifest.json")
                info.size = len(manifest)
                archive.addfile(info, io.BytesIO(manifest))
                info = tarfile.TarInfo("paseito-daemon/runtime-integrity.json")
                info.size = len(inventory)
                archive.addfile(info, io.BytesIO(inventory))
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            provenance = root / "provenance.json"
            provenance.write_text(
                json.dumps(
                    {
                        "schemaVersion": 3,
                        "paseitoRepository": "walter-erquinigo/paseito",
                        "paseitoCommit": "a" * 40,
                        "paseitoVersion": "1.0.0-paseito.1",
                        "releaseTag": "paseito-v1.0.0-paseito.1",
                        "artifacts": [
                            {
                                "kind": "daemon",
                                "platform": "linux",
                                "architecture": "x64",
                                "name": artifact.name,
                                "sha256": digest,
                                "manifestSha256": manifest_digest,
                                "runtimeIntegritySha256": inventory_digest,
                            }
                        ],
                        "daemonRuntime": {
                            "manifestSha256": manifest_digest,
                            "runtimeIntegritySha256": inventory_digest,
                        },
                    }
                ),
                encoding="utf-8",
            )
            resolved, _ = resolve_artifact(provenance)
        self.assertEqual(resolved.name, "daemon.tar.gz")

    def test_publication_verification_requires_matching_tag_and_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "daemon.tar.gz"
            artifact.write_bytes(b"daemon")
            checksum = root / "daemon.tar.gz.sha256"
            checksum.write_text(
                f"{hashlib.sha256(b'daemon').hexdigest()}  daemon.tar.gz\n",
                encoding="utf-8",
            )
            provenance_path = root / "provenance.json"
            provenance_path.write_text("{}\n", encoding="utf-8")

            def command_side_effect(args: list[str], **_: object):
                if args[:3] == ["git", "ls-remote", "--tags"]:
                    return type("Result", (), {"returncode": 0, "stdout": f"{'a' * 40}\tref\n"})()
                name = args[args.index("--pattern") + 1]
                destination = Path(args[args.index("--dir") + 1]) / name
                destination.write_bytes((root / name).read_bytes())
                return type("Result", (), {"returncode": 0, "stdout": ""})()

            with patch("deploy_remote_daemons.command", side_effect=command_side_effect):
                verify_published_release(
                    provenance_path,
                    artifact,
                    {"releaseTag": "paseito-v1.0.0-paseito.1", "paseitoCommit": "a" * 40},
                )

    def test_github_deployment_binds_host_commit_and_artifact(self) -> None:
        provenance = {
            "paseitoCommit": "a" * 40,
            "paseitoVersion": "1.0.0-paseito.1",
            "releaseTag": "paseito-v1.0.0-paseito.1",
            "artifacts": [
                {
                    "kind": "daemon",
                    "sha256": "b" * 64,
                    "runtimeIntegritySha256": "c" * 64,
                }
            ],
        }
        with (
            patch("deploy_remote_daemons.github_request", return_value={"id": 42}) as request,
        ):
            deployment_id = create_github_deployment({"id": "viking-new"}, provenance)

        self.assertEqual(deployment_id, 42)
        payload = request.call_args.args[1]
        self.assertEqual(payload["environment"], "viking-new")
        self.assertEqual(payload["ref"], "a" * 40)
        self.assertEqual(payload["payload"]["artifactSha256"], "b" * 64)

    def test_remote_transaction_verifies_identity_and_rolls_back(self) -> None:
        self.assertIn('before_id="$(cat "$HOME/$paseo_home/server-id")"', REMOTE_INSTALL)
        self.assertIn('test "$(cat "$HOME/$paseo_home/server-id")" = "$before_id"', REMOTE_INSTALL)
        self.assertIn("remote-busy:", REMOTE_INSTALL)
        self.assertIn("rollback()", REMOTE_INSTALL)
        self.assertIn('systemctl --user restart "$service"', REMOTE_INSTALL)
        self.assertIn('Environment="PATH=$tool_path"', REMOTE_INSTALL)
        self.assertIn('for _ in $(seq 1 30); do\n  status=', REMOTE_INSTALL)
        self.assertIn('.connectedDaemon 2>/dev/null)', REMOTE_INSTALL)
        self.assertGreater(
            REMOTE_INSTALL.index('test -s "$HOME/$paseo_home/paseo.pid"'),
            REMOTE_INSTALL.index('.daemonVersion)" = "$daemon_version"'),
        )
        self.assertIn('select(.time >= $since and .msg == "relay_control_connected")', REMOTE_INSTALL)
        self.assertNotIn("journalctl --user-unit", REMOTE_INSTALL)
        self.assertIn("changesBaseSelector", REMOTE_INSTALL)
        self.assertIn("fileReviewV1", REMOTE_INSTALL)
        self.assertIn("workspaceLsp", REMOTE_INSTALL)
        self.assertIn("workspaceLspClangd", REMOTE_INSTALL)
        self.assertIn("workspaceFileSearch", REMOTE_INSTALL)
        self.assertIn("remote-drift:", REMOTE_INSTALL)
        self.assertIn("runtime-integrity.json", REMOTE_INSTALL)
        self.assertIn('chmod -R a-w "$release"', REMOTE_INSTALL)
        self.assertIn('cmp -s "$unit" "$unit_next"', REMOTE_INSTALL)
        self.assertGreaterEqual(REMOTE_INSTALL.count("ensure_idle"), 3)

    def test_remote_transaction_accepts_an_omitted_legacy_commit(self) -> None:
        argument_binding = REMOTE_INSTALL.split('unit="$HOME/.config/systemd/user/$service"', 1)[
            0
        ]
        result = subprocess.run(
            ["bash", "-s", "--", *[f"argument-{index}" for index in range(1, 13)]],
            input=argument_binding + '\nprintf "%s" "$legacy_current_commit"\n',
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_remote_restart_requires_explicit_approval(self) -> None:
        source = Path(__file__).with_name("deploy_remote_daemons.py").read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--restart-approved", action="store_true")', source)
        self.assertIn('"approval-required"', source)

    def test_vpn_upload_has_a_bounded_slow_link_allowance(self) -> None:
        source = Path(__file__).with_name("deploy_remote_daemons.py").read_text(encoding="utf-8")
        self.assertIn("timeout=3600", source)

    def test_state_is_atomic_and_private(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            write_state(path, {"schemaVersion": 1, "hosts": []})
            mode = path.stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)


if __name__ == "__main__":
    unittest.main()
