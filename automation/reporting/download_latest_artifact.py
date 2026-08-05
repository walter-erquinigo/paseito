#!/usr/bin/env python3
"""Download the newest non-expired artifact of a given name without third-party actions."""

from __future__ import annotations

import argparse
import io
import json
import os
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

API = "https://api.github.com/repos/walter-erquinigo/paseito"


def request(url: str, accept: str = "application/vnd.github+json") -> bytes:
    token = os.environ["GITHUB_TOKEN"]
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": accept, "User-Agent": "paseito-report/1"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("name")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = json.loads(request(f"{API}/actions/artifacts?name={args.name}&per_page=20"))
    artifact = next((item for item in payload.get("artifacts", []) if not item.get("expired")), None)
    if not artifact:
        return 2
    archive = zipfile.ZipFile(io.BytesIO(request(artifact["archive_download_url"], "application/octet-stream")))
    args.output.mkdir(parents=True, exist_ok=True)
    for info in archive.infolist():
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit("unsafe artifact archive")
        archive.extract(info, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
