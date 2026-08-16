#!/usr/bin/env python3
"""Discover the next fail-closed Paseito release candidate using GitHub's API."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from release_model import choose_latest_stable, decide_release

API = "https://api.github.com"
UPSTREAM_REPOSITORY = "getpaseo/paseo"
FORK_REPOSITORY = "walter-erquinigo/paseito"


def github_token() -> str | None:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token
    result = subprocess.run(
        ["gh", "auth", "token"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None


def api_json(path_or_url: str, token: str | None) -> Any:
    url = path_or_url if path_or_url.startswith("https://") else f"{API}{path_or_url}"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read(512).decode("utf-8", "replace")
        raise RuntimeError(f"GitHub API request failed ({error.code}): {body}") from error


def peel_tag(repository: str, tag: str, token: str | None) -> str:
    ref = api_json(f"/repos/{repository}/git/ref/tags/{tag}", token)
    target = ref["object"]
    seen: set[str] = set()
    while target["type"] == "tag":
        sha = target["sha"]
        if sha in seen:
            raise RuntimeError(f"tag cycle while peeling {tag}")
        seen.add(sha)
        target = api_json(f"/repos/{repository}/git/tags/{sha}", token)["object"]
    if target["type"] != "commit" or not isinstance(target.get("sha"), str):
        raise RuntimeError(f"tag {tag} did not peel to a commit")
    return target["sha"]


def latest_paseito_provenance(token: str | None) -> dict[str, Any] | None:
    releases = api_json(f"/repos/{FORK_REPOSITORY}/releases?per_page=50", token)
    for release in releases:
        if release.get("draft") or release.get("prerelease"):
            continue
        if not str(release.get("tag_name", "")).startswith("paseito-v"):
            continue
        asset = next((item for item in release.get("assets", []) if item.get("name") == "provenance.json"), None)
        if asset:
            return api_json(asset["browser_download_url"], token)
    return None


def write_outputs(path: Path, values: dict[str, str]) -> None:
    with path.open("a", encoding="utf-8") as output:
        for key, value in values.items():
            if "\n" in value:
                raise ValueError(f"newline is not valid in output {key}")
            output.write(f"{key}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", type=Path, default=Path("automation/upstream.json"))
    parser.add_argument("--force", action="store_true", help="create another Paseito revision for the same upstream")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    token = github_token()
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    provenance = latest_paseito_provenance(token)
    recorded = provenance or {
        "upstreamTag": metadata["upstreamTag"],
        "upstreamCommit": metadata["upstreamCommit"],
        "paseitoVersion": metadata["paseitoVersion"],
    }

    releases = api_json(f"/repos/{UPSTREAM_REPOSITORY}/releases?per_page=100", token)
    upstream_release = choose_latest_stable(releases)
    upstream_tag = upstream_release["tag_name"]
    upstream_commit = peel_tag(UPSTREAM_REPOSITORY, upstream_tag, token)
    if provenance is None:
        # The checked-in baseline is releasable exactly once. Subsequent runs
        # use the published provenance asset as the idempotency record.
        decision = decide_release(
            upstream_tag,
            str(recorded["upstreamTag"]),
            str(recorded["paseitoVersion"]),
            True,
        )
        decision = type(decision)(True, upstream_tag, str(recorded["paseitoVersion"]))
    else:
        candidate_version = (
            str(metadata["paseitoVersion"])
            if metadata.get("upstreamTag") == upstream_tag
            and metadata.get("upstreamCommit") == upstream_commit
            else None
        )
        decision = decide_release(
            upstream_tag,
            str(recorded["upstreamTag"]),
            str(recorded["paseitoVersion"]),
            args.force,
            candidate_version,
        )
    values = {
        "needs_release": str(decision.needs_release).lower(),
        "upstream_tag": upstream_tag,
        "upstream_commit": upstream_commit,
        "old_upstream_commit": str(recorded["upstreamCommit"]),
        "paseito_version": decision.version,
        "release_tag": f"paseito-v{decision.version}",
    }
    output = args.output or (Path(os.environ["GITHUB_OUTPUT"]) if os.environ.get("GITHUB_OUTPUT") else None)
    if output:
        write_outputs(output, values)
    print(json.dumps(values, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"release discovery failed: {error}", file=sys.stderr)
        raise SystemExit(1)
