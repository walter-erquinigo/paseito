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
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Sequence

DEFAULT_STATE_ROOT = Path.home() / "Library/Application Support/PaseitoAutomation"
DEFAULT_CONFIG = DEFAULT_STATE_ROOT / "remote-hosts.json"
DEFAULT_STATE = DEFAULT_STATE_ROOT / "remote-deployment-state.json"
REPOSITORY = "walter-erquinigo/paseito"
FORK_URL = f"https://github.com/{REPOSITORY}.git"
SAFE_REMOTE_VALUE = re.compile(r"^[A-Za-z0-9_./@:+-]+$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
RELEASE_TAG = re.compile(r"^paseito-v\d+\.\d+\.\d+-paseito\.\d+$")


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


def read_bundle_metadata(path: Path) -> tuple[dict[str, Any], str]:
    with tarfile.open(path, "r:gz") as archive:
        try:
            manifest_member = archive.getmember("paseito-daemon/manifest.json")
        except KeyError as error:
            raise DeploymentError("artifact", "Linux daemon bundle has no manifest") from error
        stream = archive.extractfile(manifest_member)
        if stream is None:
            raise DeploymentError("artifact", "Linux daemon bundle manifest is unreadable")
        manifest_content = stream.read()
        try:
            manifest = json.loads(manifest_content)
        except json.JSONDecodeError as error:
            raise DeploymentError("artifact", "Linux daemon bundle manifest is invalid") from error
        if not isinstance(manifest, dict):
            raise DeploymentError("artifact", "Linux daemon bundle manifest must be an object")
        integrity = manifest.get("runtimeIntegrity")
        if not isinstance(integrity, dict) or integrity.get("path") != "runtime-integrity.json":
            raise DeploymentError("artifact", "Linux daemon bundle has no runtime inventory")
        try:
            inventory_member = archive.getmember("paseito-daemon/runtime-integrity.json")
        except KeyError as error:
            raise DeploymentError("artifact", "Linux daemon bundle runtime inventory is missing") from error
        inventory_stream = archive.extractfile(inventory_member)
        if inventory_stream is None:
            raise DeploymentError("artifact", "Linux daemon bundle runtime inventory is unreadable")
        inventory_content = inventory_stream.read()
        inventory_digest = hashlib.sha256(inventory_content).hexdigest()
        try:
            inventory = json.loads(inventory_content)
        except json.JSONDecodeError as error:
            raise DeploymentError("artifact", "Linux daemon runtime inventory is invalid") from error
        if (
            integrity.get("algorithm") != "sha256"
            or integrity.get("sha256") != inventory_digest
            or not isinstance(inventory, dict)
            or inventory.get("schemaVersion") != 1
            or not isinstance(inventory.get("entries"), list)
            or integrity.get("entryCount") != len(inventory["entries"])
        ):
            raise DeploymentError("artifact", "Linux daemon runtime inventory checksum is invalid")
    return manifest, hashlib.sha256(manifest_content).hexdigest()


def resolve_artifact(provenance_path: Path) -> tuple[Path, dict[str, Any]]:
    provenance = load_object(provenance_path)
    entries = provenance.get("artifacts")
    if provenance.get("schemaVersion") != 3 or not isinstance(entries, list):
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
    manifest, manifest_digest = read_bundle_metadata(artifact)
    runtime = provenance.get("daemonRuntime")
    source = manifest.get("source")
    commit = provenance.get("paseitoCommit")
    version = provenance.get("paseitoVersion")
    tag = provenance.get("releaseTag")
    integrity = manifest.get("runtimeIntegrity")
    if (
        provenance.get("paseitoRepository") != REPOSITORY
        or not isinstance(commit, str)
        or not COMMIT.fullmatch(commit)
        or not isinstance(tag, str)
        or not RELEASE_TAG.fullmatch(tag)
        or not isinstance(version, str)
        or manifest.get("schemaVersion") != 3
        or manifest.get("commit") != commit
        or manifest.get("version") != version
        or not isinstance(source, dict)
        or source.get("repository") != REPOSITORY
        or source.get("commit") != commit
        or source.get("releaseTag") != tag
        or not isinstance(integrity, dict)
        or not isinstance(runtime, dict)
        or entry.get("manifestSha256") != manifest_digest
        or runtime.get("manifestSha256") != manifest_digest
        or entry.get("runtimeIntegritySha256") != integrity.get("sha256")
        or runtime.get("runtimeIntegritySha256") != integrity.get("sha256")
        or not isinstance(integrity.get("sha256"), str)
        or not DIGEST.fullmatch(str(integrity.get("sha256")))
    ):
        raise DeploymentError("provenance", "Linux daemon source or runtime identity is invalid")
    return artifact, provenance


def verify_published_release(provenance_path: Path, artifact: Path, provenance: dict[str, Any]) -> None:
    tag = str(provenance["releaseTag"])
    commit = str(provenance["paseitoCommit"])
    tag_result = command(["git", "ls-remote", "--tags", FORK_URL, f"refs/tags/{tag}^{{}}"])
    remote_commit = tag_result.stdout.strip().split(maxsplit=1)[0] if tag_result.returncode == 0 else ""
    if remote_commit != commit:
        raise DeploymentError("publication", "release tag does not resolve to the provenance commit")
    checksum = artifact.with_name(artifact.name + ".sha256")
    if not checksum.is_file() or checksum.read_text(encoding="utf-8") != (
        f"{sha256(artifact)}  {artifact.name}\n"
    ):
        raise DeploymentError("checksum", "local Linux daemon checksum file is invalid")
    with tempfile.TemporaryDirectory(prefix="paseito-published-release-") as directory:
        downloaded = Path(directory)
        for name in (artifact.name, checksum.name, provenance_path.name):
            result = command(
                [
                    "gh",
                    "release",
                    "download",
                    tag,
                    "--repo",
                    REPOSITORY,
                    "--pattern",
                    name,
                    "--dir",
                    str(downloaded),
                ],
                timeout=300,
            )
            if result.returncode:
                raise DeploymentError("publication", f"published release is missing {name}")
        if sha256(downloaded / artifact.name) != sha256(artifact):
            raise DeploymentError("publication", "published Linux daemon differs from local artifact")
        if (downloaded / checksum.name).read_bytes() != checksum.read_bytes():
            raise DeploymentError("publication", "published Linux daemon checksum differs locally")
        if (downloaded / provenance_path.name).read_bytes() != provenance_path.read_bytes():
            raise DeploymentError("publication", "published provenance differs from local evidence")


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
expected_runtime_integrity="${11}"
release_tag="${12}"
legacy_current_commit="${13:-}"
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
verify_runtime() {
  runtime="$1"
  expected="$2"
  manifest="$runtime/manifest.json"
  test "$(jq -r .schemaVersion "$manifest")" = 3
  test "$(jq -r .runtimeIntegrity.algorithm "$manifest")" = sha256
  test "$(jq -r .runtimeIntegrity.path "$manifest")" = runtime-integrity.json
  test "$(jq -r .runtimeIntegrity.sha256 "$manifest")" = "$expected"
  test "$(jq -r .runtimeIntegrity.entryCount "$manifest")" = "$(jq -r '.entries | length' "$runtime/runtime-integrity.json")"
  actual="$(sha256sum "$runtime/runtime-integrity.json" | awk '{print $1}')"
  if test "$actual" != "$expected"; then
    echo "remote-drift: runtime-integrity.json" >&2
    exit 43
  fi
  "$node" - "$runtime" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const inventory = JSON.parse(fs.readFileSync(path.join(root, "runtime-integrity.json"), "utf8"));
if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.entries)) {
  console.error("remote-drift: invalid runtime inventory");
  process.exit(43);
}
const actual = [];
function walk(directory, prefix = "") {
  for (const name of fs.readdirSync(directory).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (relative === "manifest.json" || relative === "runtime-integrity.json") continue;
    const absolute = path.join(directory, name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      actual.push({ path: relative, target: fs.readlinkSync(absolute), type: "symlink" });
    } else if (stat.isDirectory()) {
      walk(absolute, relative);
    } else if (stat.isFile()) {
      actual.push({
        path: relative,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"),
        type: "file",
      });
    } else {
      actual.push({ path: relative, type: "unsupported" });
    }
  }
}
walk(root);
const expected = new Map(inventory.entries.map((entry) => [entry.path, JSON.stringify(entry)]));
const observed = new Map(actual.map((entry) => [entry.path, JSON.stringify(entry)]));
const changed = [...new Set([...expected.keys(), ...observed.keys()])]
  .sort()
  .filter((entry) => expected.get(entry) !== observed.get(entry));
if (changed.length) {
  for (const entry of changed.slice(0, 20)) console.error(`remote-drift: ${entry}`);
  if (changed.length > 20) console.error(`remote-drift: ${changed.length - 20} more path(s)`);
  process.exit(43);
}
NODE
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
test "$(jq -r .source.repository "$extract/paseito-daemon/manifest.json")" = walter-erquinigo/paseito
test "$(jq -r .source.commit "$extract/paseito-daemon/manifest.json")" = "$commit"
test "$(jq -r .source.releaseTag "$extract/paseito-daemon/manifest.json")" = "$release_tag"
daemon_version="$(jq -r .daemonVersion "$extract/paseito-daemon/manifest.json")"
test -n "$daemon_version"
test "$(jq -r .feature "$extract/paseito-daemon/manifest.json")" = changesBaseSelector
test "$(jq -r '.features // [.feature] | contains(["changesContextExpansion", "reviewSuggestionsV1", "fileReviewV1", "workspaceLsp", "workspaceLspClangd", "workspaceFileSearch", "checkoutDiffSearch", "checkoutCommitAmend"])' "$extract/paseito-daemon/manifest.json")" = true
test -x "$extract/paseito-daemon/$entry"
verify_runtime "$extract/paseito-daemon" "$expected_runtime_integrity"
if test -e "$release"; then
  test "$(jq -r .commit "$release/manifest.json")" = "$commit"
  test "$(jq -r .version "$release/manifest.json")" = "$version"
  test "$(jq -r .daemonVersion "$release/manifest.json")" = "$daemon_version"
  test "$(jq -r .feature "$release/manifest.json")" = changesBaseSelector
  test "$(jq -r '.features // [.feature] | contains(["changesContextExpansion", "reviewSuggestionsV1", "fileReviewV1", "workspaceLsp", "workspaceLspClangd", "workspaceFileSearch", "checkoutDiffSearch", "checkoutCommitAmend"])' "$release/manifest.json")" = true
  test -x "$release/$entry"
  verify_runtime "$release" "$expected_runtime_integrity"
else
  mv "$extract/paseito-daemon" "$release"
fi
chmod -R a-w "$release"
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
if test -L "$current"; then
  current_schema="$(jq -r .schemaVersion "$current/manifest.json" 2>/dev/null || true)"
  current_commit="$(jq -r .commit "$current/manifest.json" 2>/dev/null || true)"
  if test "$current_schema" = 3; then
    current_integrity="$(jq -r .runtimeIntegrity.sha256 "$current/manifest.json")"
    verify_runtime "$current" "$current_integrity"
  elif test -z "$legacy_current_commit" || test "$current_commit" != "$legacy_current_commit"; then
    echo "remote-drift: active runtime has no verifiable inventory ($current_commit)" >&2
    exit 43
  fi
  if test ! -f "$unit" || ! cmp -s "$unit" "$unit_next"; then
    echo "remote-drift: $service unit differs from the registered definition" >&2
    exit 43
  fi
  drop_ins="$(systemctl --user show "$service" -p DropInPaths --value 2>/dev/null || true)"
  if test -n "$drop_ins"; then
    echo "remote-drift: $service has systemd drop-ins" >&2
    exit 43
  fi
fi
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


def github_request(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = command(
        ["gh", "api", "--method", "POST", path, "--input", "-"],
        input_text=json.dumps(payload),
    )
    if result.returncode:
        raise DeploymentError("publication", "GitHub deployment record could not be created")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise DeploymentError("publication", "GitHub deployment response was invalid") from error
    if not isinstance(value, dict):
        raise DeploymentError("publication", "GitHub deployment response was invalid")
    return value


def create_github_deployment(host: dict[str, str], provenance: dict[str, Any]) -> int:
    daemon = next(
        entry
        for entry in provenance["artifacts"]
        if isinstance(entry, dict) and entry.get("kind") == "daemon"
    )
    value = github_request(
        f"repos/{REPOSITORY}/deployments",
        {
            "auto_merge": False,
            "description": f"Paseito {provenance['paseitoVersion']} deployment",
            "environment": host["id"],
            "payload": {
                "artifactSha256": daemon["sha256"],
                "releaseTag": provenance["releaseTag"],
                "runtimeIntegritySha256": daemon["runtimeIntegritySha256"],
                "version": provenance["paseitoVersion"],
            },
            "production_environment": True,
            "ref": provenance["paseitoCommit"],
            "required_contexts": [],
            "task": "deploy:paseito-daemon",
            "transient_environment": False,
        },
    )
    deployment_id = value.get("id")
    if not isinstance(deployment_id, int):
        raise DeploymentError("publication", "GitHub deployment response had no numeric id")
    return deployment_id


def update_github_deployment(
    deployment_id: int, environment: str, state: str, description: str
) -> bool:
    result = command(
        [
            "gh",
            "api",
            "--method",
            "POST",
            f"repos/{REPOSITORY}/deployments/{deployment_id}/statuses",
            "--input",
            "-",
        ],
        input_text=json.dumps(
            {
                "auto_inactive": False,
                "description": description[:140],
                "environment": environment,
                "state": state,
            }
        ),
    )
    return result.returncode == 0


def deploy_host(
    host: dict[str, str],
    artifact: Path,
    provenance: dict[str, Any],
    legacy_current_commit: str,
) -> dict[str, Any]:
    target = host["sshTarget"]
    commit = str(provenance["paseitoCommit"])
    version = str(provenance["paseitoVersion"])
    release_tag = str(provenance["releaseTag"])
    runtime_integrity = str(provenance["daemonRuntime"]["runtimeIntegritySha256"])
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
            runtime_integrity,
            release_tag,
            legacy_current_commit,
        ],
        input_text=REMOTE_INSTALL,
        timeout=300,
    )
    if installed.returncode:
        detail = next(
            (line.strip() for line in reversed(installed.stderr.splitlines()) if line.strip()),
            "remote verification failed and rollback was attempted",
        )
        if "remote-busy:" in installed.stderr:
            category = "remote-busy"
        elif "remote-drift:" in installed.stderr:
            category = "remote-drift"
        else:
            category = "remote-verification"
        raise DeploymentError(category, detail[-300:])
    return {
        "host": host["id"],
        "sshTarget": target,
        "version": version,
        "commit": commit,
        "releaseTag": release_tag,
        "artifactSha256": checksum,
        "runtimeIntegritySha256": runtime_integrity,
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
    parser.add_argument("--restart-approved", action="store_true")
    parser.add_argument("--allow-legacy-current-commit", default="")
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
        if args.allow_legacy_current_commit and not COMMIT.fullmatch(
            args.allow_legacy_current_commit
        ):
            raise DeploymentError("configuration", "legacy current commit must be a full commit id")
        artifact, provenance = resolve_artifact(args.provenance.resolve())
        if not args.restart_approved:
            write_state(
                args.state,
                {
                    "schemaVersion": 2,
                    "hosts": [
                        {
                            "attemptedAt": datetime.now(timezone.utc).isoformat(),
                            "category": "approval-required",
                            "commit": provenance.get("paseitoCommit"),
                            "host": host["id"],
                            "releaseTag": provenance.get("releaseTag"),
                            "result": "deferred",
                            "rollback": False,
                            "sshTarget": host["sshTarget"],
                            "version": provenance.get("paseitoVersion"),
                        }
                        for host in hosts
                    ],
                },
            )
            print(
                "Paseito remote deployment deferred [approval]: rerun with --restart-approved "
                "only after explicit human approval",
                file=sys.stderr,
            )
            return 2
        verify_published_release(args.provenance.resolve(), artifact, provenance)
    except DeploymentError as error:
        print(f"Paseito remote deployment failed [{error.category}]: {error}", file=sys.stderr)
        return 1

    results: list[dict[str, Any]] = []
    failed = False
    for host in hosts:
        deployment_id: int | None = None
        try:
            deployment_id = create_github_deployment(host, provenance)
            if not update_github_deployment(
                deployment_id, host["id"], "in_progress", "Remote preflight started"
            ):
                raise DeploymentError(
                    "publication", "GitHub deployment status could not be recorded"
                )
            result = deploy_host(
                host,
                artifact,
                provenance,
                args.allow_legacy_current_commit,
            )
        except Exception as error:
            failed = True
            category = error.category if isinstance(error, DeploymentError) else "command"
            result = {
                "host": host["id"],
                "sshTarget": host["sshTarget"],
                "version": provenance.get("paseitoVersion"),
                "commit": provenance.get("paseitoCommit"),
                "releaseTag": provenance.get("releaseTag"),
                "result": "failure",
                "category": category,
                "rollback": category == "remote-verification",
                "attemptedAt": datetime.now(timezone.utc).isoformat(),
            }
            print(f"Paseito deployment to {host['id']} failed [{category}]: {error}", file=sys.stderr)
        result["githubDeploymentId"] = deployment_id
        github_state = "success" if result["result"] == "success" else "failure"
        description = (
            f"Paseito {result.get('version')} deployed and verified"
            if github_state == "success"
            else f"Paseito deployment failed: {result.get('category')}"
        )
        result["githubStatusRecorded"] = bool(
            deployment_id
            and update_github_deployment(deployment_id, host["id"], github_state, description)
        )
        results.append(result)
    write_state(args.state, {"schemaVersion": 2, "hosts": results})
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
