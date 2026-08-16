#!/usr/bin/env python3
"""Deploy a provenance-bound Paseito daemon to explicitly registered SSH hosts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Sequence

DEFAULT_STATE_ROOT = Path.home() / "Library/Application Support/PaseitoAutomation"
DEFAULT_CONFIG = DEFAULT_STATE_ROOT / "remote-hosts.json"
DEFAULT_STATE = DEFAULT_STATE_ROOT / "remote-deployment-state.json"
SAFE_REMOTE_VALUE = re.compile(r"^[A-Za-z0-9_./@:+-]+$")


class DeploymentError(RuntimeError):
    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category = category


def command(
    args: Sequence[str], *, input_text: str | None = None, timeout: int = 120
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=timeout,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise DeploymentError("configuration", f"expected a JSON object in {path}")
    return value


def validate_private_config(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    if path.stat().st_mode & 0o077:
        raise DeploymentError("configuration", "remote host registry must have mode 0600")
    value = load_object(path)
    hosts = value.get("hosts")
    if value.get("schemaVersion") != 1 or not isinstance(hosts, list):
        raise DeploymentError("configuration", "remote host registry schema is invalid")
    required = {
        "id",
        "sshTarget",
        "architecture",
        "node",
        "runtimeRoot",
        "service",
        "paseoHome",
        "listen",
        "toolPath",
    }
    parsed: list[dict[str, str]] = []
    ids: set[str] = set()
    for raw in hosts:
        if not isinstance(raw, dict) or set(raw) != required:
            raise DeploymentError("configuration", "remote host entry has unexpected fields")
        host = {key: str(raw[key]) for key in required}
        if host["id"] in ids or not host["id"]:
            raise DeploymentError("configuration", "remote host ids must be unique and non-empty")
        if host["architecture"] != "linux-x64":
            raise DeploymentError("configuration", "only registered linux-x64 hosts are supported")
        if not host["node"].startswith("/") or not host["runtimeRoot"].startswith("/"):
            raise DeploymentError("configuration", "node and runtimeRoot must be absolute paths")
        if host["paseoHome"] != ".paseo" or host["listen"] != "127.0.0.1:6767":
            raise DeploymentError("configuration", "registered host identity settings are not allowed")
        if any(not entry.startswith("/") for entry in host["toolPath"].split(":")):
            raise DeploymentError("configuration", "toolPath entries must be absolute paths")
        if "/" in host["service"] or not host["service"].endswith(".service"):
            raise DeploymentError("configuration", "service must be a systemd user unit name")
        if any(not SAFE_REMOTE_VALUE.fullmatch(value) for value in host.values()):
            raise DeploymentError("configuration", "remote host values contain unsafe characters")
        ids.add(host["id"])
        parsed.append(host)
    return parsed


def validate_bundle(path: Path) -> None:
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        if not members:
            raise DeploymentError("artifact", "Linux daemon bundle is empty")
        for member in members:
            relative = PurePosixPath(member.name)
            if relative.is_absolute() or not relative.parts or relative.parts[0] != "paseito-daemon":
                raise DeploymentError("artifact", "Linux daemon bundle has an unsafe root")
            if ".." in relative.parts:
                raise DeploymentError("artifact", "Linux daemon bundle contains path traversal")
            if member.issym() or member.islnk():
                target = PurePosixPath(member.linkname)
                combined = target if member.islnk() else relative.parent / target
                normalized: list[str] = []
                for part in combined.parts:
                    if part in {"", "."}:
                        continue
                    if part == "..":
                        if not normalized:
                            raise DeploymentError("artifact", "Linux daemon bundle link escapes its root")
                        normalized.pop()
                    else:
                        normalized.append(part)
                if target.is_absolute() or not normalized or normalized[0] != "paseito-daemon":
                    raise DeploymentError("artifact", "Linux daemon bundle contains an unsafe link")


def resolve_artifact(provenance_path: Path) -> tuple[Path, dict[str, Any]]:
    provenance = load_object(provenance_path)
    entries = provenance.get("artifacts")
    if provenance.get("schemaVersion") != 2 or not isinstance(entries, list):
        raise DeploymentError("provenance", "release provenance has no versioned artifact set")
    matches = [
        item
        for item in entries
        if isinstance(item, dict)
        and (item.get("kind"), item.get("platform"), item.get("architecture"))
        == ("daemon", "linux", "x64")
    ]
    if len(matches) != 1:
        raise DeploymentError("provenance", "release has no unique Linux x64 daemon artifact")
    entry = matches[0]
    artifact = provenance_path.parent / str(entry.get("name", ""))
    if not artifact.is_file() or sha256(artifact) != entry.get("sha256"):
        raise DeploymentError("checksum", "Linux daemon artifact does not match provenance")
    validate_bundle(artifact)
    return artifact, provenance


REMOTE_INSTALL = r'''set -euo pipefail
node="$1"
runtime_root="$2"
commit="$3"
version="$4"
expected_checksum="$5"
service="$6"
paseo_home="$7"
listen="$8"
tool_path="$9"
bundle="${10}"
unit="$HOME/.config/systemd/user/$service"
release="$runtime_root/releases/$commit"
current="$runtime_root/current"
backup="$runtime_root/backups/$commit"
entry="node_modules/@getpaseo/cli/bin/paseito"
ensure_idle() {
  active_turns="$(tail -n 2000 "$HOME/$paseo_home/daemon.log" | jq -Rr 'fromjson? | select(.msg == "ws_runtime_metrics") | .agents.withActiveForegroundTurn' | tail -n 1)"
  if test "${active_turns:-0}" != 0; then
    echo "remote-busy: $active_turns active foreground agent turn(s)" >&2
    exit 42
  fi
}
before_id="$(cat "$HOME/$paseo_home/server-id")"
test -n "$before_id"
ensure_idle
test "$(uname -m)" = x86_64
test "$($node -p 'process.versions.node.split(".")[0]')" = 22
test "$(sha256sum "$bundle" | awk '{print $1}')" = "$expected_checksum"
mkdir -p "$runtime_root/releases" "$runtime_root/backups" "$HOME/.config/systemd/user"
extract="$(mktemp -d "$runtime_root/staging/extract.XXXXXX")"
tar -xzf "$bundle" -C "$extract"
test "$(jq -r .commit "$extract/paseito-daemon/manifest.json")" = "$commit"
test "$(jq -r .version "$extract/paseito-daemon/manifest.json")" = "$version"
daemon_version="$(jq -r .daemonVersion "$extract/paseito-daemon/manifest.json")"
test -n "$daemon_version"
test "$(jq -r .feature "$extract/paseito-daemon/manifest.json")" = changesBaseSelector
test "$(jq -r '.features // [.feature] | contains(["changesContextExpansion", "reviewSuggestionsV1", "fileReviewV1", "workspaceLsp"])' "$extract/paseito-daemon/manifest.json")" = true
test -x "$extract/paseito-daemon/$entry"
if test -e "$release"; then
  test "$(jq -r .commit "$release/manifest.json")" = "$commit"
  test "$(jq -r .version "$release/manifest.json")" = "$version"
  test "$(jq -r .daemonVersion "$release/manifest.json")" = "$daemon_version"
  test "$(jq -r .feature "$release/manifest.json")" = changesBaseSelector
  test "$(jq -r '.features // [.feature] | contains(["changesContextExpansion", "reviewSuggestionsV1", "fileReviewV1", "workspaceLsp"])' "$release/manifest.json")" = true
  test -x "$release/$entry"
else
  mv "$extract/paseito-daemon" "$release"
fi
previous="$(readlink "$current" 2>/dev/null || true)"
mkdir -p "$backup"
if test -f "$unit"; then cp "$unit" "$backup/previous.service"; fi
printf '%s\n' "$previous" > "$backup/previous-current"
cutover=0
rollback() {
  result=$?
  if test "$cutover" = 1; then
    if test -f "$backup/previous.service"; then cp "$backup/previous.service" "$unit"; fi
    if test -n "$previous"; then
      ln -sfn "$previous" "$current.rollback"
      mv -Tf "$current.rollback" "$current"
    elif test -L "$current"; then
      rm -f "$current"
    fi
    systemctl --user daemon-reload || true
    systemctl --user restart "$service" || true
  fi
  exit "$result"
}
trap rollback ERR
unit_next="$unit.next"
cat > "$unit_next" <<EOF
[Unit]
Description=Paseito coding-agent server
After=network-online.target

[Service]
Type=simple
Environment="PATH=$tool_path"
Environment="PASEO_HOME=%h/$paseo_home"
WorkingDirectory=%h
ExecStart=$node --disable-warning=DEP0040 $current/$entry daemon start --foreground --home %h/$paseo_home --listen $listen --relay-use-tls
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
ensure_idle
cutover=1
ln -sfn "$release" "$current.next"
mv -Tf "$current.next" "$current"
mv "$unit_next" "$unit"
systemctl --user daemon-reload
cutover_time="$(date +%s000)"
systemctl --user restart "$service"
for _ in $(seq 1 30); do
  systemctl --user is-active --quiet "$service" && break
  sleep 1
done
systemctl --user is-active --quiet "$service"
test "$(cat "$HOME/$paseo_home/server-id")" = "$before_id"
status=""
for _ in $(seq 1 30); do
  status="$($node "$current/$entry" daemon status --home "$HOME/$paseo_home" --json 2>/dev/null || true)"
  if test "$(printf '%s' "$status" | jq -r .connectedDaemon 2>/dev/null)" = reachable \
    && test "$(printf '%s' "$status" | jq -r .daemonVersion 2>/dev/null)" = "$daemon_version"; then
    break
  fi
  sleep 1
done
test "$(printf '%s' "$status" | jq -r .connectedDaemon)" = reachable
test "$(printf '%s' "$status" | jq -r .daemonVersion)" = "$daemon_version"
test -s "$HOME/$paseo_home/paseo.pid"
for _ in $(seq 1 30); do
  relay_connected="$(tail -n 2000 "$HOME/$paseo_home/daemon.log" | jq -Rr --argjson since "$cutover_time" 'fromjson? | select(.time >= $since and .msg == "relay_control_connected") | .msg' | tail -n 1)"
  test "$relay_connected" = relay_control_connected && break
  sleep 1
done
test "$relay_connected" = relay_control_connected
cutover=0
trap - ERR
printf '%s\n' "$before_id"
'''


def deploy_host(host: dict[str, str], artifact: Path, provenance: dict[str, Any]) -> dict[str, Any]:
    target = host["sshTarget"]
    commit = str(provenance["paseitoCommit"])
    version = str(provenance["paseitoVersion"])
    checksum = sha256(artifact)
    prepared = command(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            target,
            "mkdir",
            "-p",
            f"{host['runtimeRoot']}/staging",
        ]
    )
    if prepared.returncode:
        raise DeploymentError("ssh", "could not prepare the remote runtime root")
    stage_result = command(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            target,
            "mktemp",
            "-d",
            f"{host['runtimeRoot']}/staging/{commit}.XXXXXX",
        ]
    )
    if stage_result.returncode:
        raise DeploymentError("ssh", "could not create the remote staging directory")
    stage = stage_result.stdout.strip()
    expected_prefix = f"{host['runtimeRoot']}/staging/{commit}."
    if not stage.startswith(expected_prefix):
        raise DeploymentError("ssh", "remote staging directory was unexpected")
    remote_bundle = f"{stage}/{artifact.name}"
    copied = command(
        ["scp", "-q", "-o", "BatchMode=yes", str(artifact), f"{target}:{remote_bundle}"],
        timeout=900,
    )
    if copied.returncode:
        raise DeploymentError("upload", "Linux daemon upload failed")
    installed = command(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            target,
            "bash",
            "-s",
            "--",
            host["node"],
            host["runtimeRoot"],
            commit,
            version,
            checksum,
            host["service"],
            host["paseoHome"],
            host["listen"],
            host["toolPath"],
            remote_bundle,
        ],
        input_text=REMOTE_INSTALL,
        timeout=300,
    )
    if installed.returncode:
        detail = next(
            (line.strip() for line in reversed(installed.stderr.splitlines()) if line.strip()),
            "remote verification failed and rollback was attempted",
        )
        category = "remote-busy" if "remote-busy:" in installed.stderr else "remote-verification"
        raise DeploymentError(category, detail[-300:])
    return {
        "host": host["id"],
        "sshTarget": target,
        "version": version,
        "commit": commit,
        "result": "success",
        "category": "deployed",
        "rollback": False,
        "serverId": installed.stdout.strip().splitlines()[-1],
        "attemptedAt": datetime.now(timezone.utc).isoformat(),
    }


def write_state(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--host", action="append", default=[])
    args = parser.parse_args()
    try:
        hosts = validate_private_config(args.config)
        if args.host:
            requested = set(args.host)
            hosts = [host for host in hosts if host["id"] in requested]
            missing = requested - {host["id"] for host in hosts}
            if missing:
                raise DeploymentError("configuration", f"unknown registered hosts: {', '.join(sorted(missing))}")
        if not hosts:
            return 0
        artifact, provenance = resolve_artifact(args.provenance.resolve())
    except DeploymentError as error:
        print(f"Paseito remote deployment failed [{error.category}]: {error}", file=sys.stderr)
        return 1

    results: list[dict[str, Any]] = []
    failed = False
    for host in hosts:
        try:
            result = deploy_host(host, artifact, provenance)
        except Exception as error:
            failed = True
            category = error.category if isinstance(error, DeploymentError) else "command"
            result = {
                "host": host["id"],
                "sshTarget": host["sshTarget"],
                "version": provenance.get("paseitoVersion"),
                "commit": provenance.get("paseitoCommit"),
                "result": "failure",
                "category": category,
                "rollback": category == "remote-verification",
                "attemptedAt": datetime.now(timezone.utc).isoformat(),
            }
            print(f"Paseito deployment to {host['id']} failed [{category}]: {error}", file=sys.stderr)
        results.append(result)
    write_state(args.state, {"schemaVersion": 1, "hosts": results})
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
