#!/usr/bin/env python3
"""Pure release selection and versioning rules for Paseito automation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable

STABLE_TAG = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
PASEITO_VERSION = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-paseito\.([1-9]\d*)$"
)


@dataclass(frozen=True)
class ReleaseDecision:
    needs_release: bool
    upstream_tag: str
    version: str


def stable_releases(releases: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only published, non-prerelease releases with exact stable semver tags."""
    return [
        release
        for release in releases
        if not release.get("draft")
        and not release.get("prerelease")
        and isinstance(release.get("tag_name"), str)
        and STABLE_TAG.fullmatch(release["tag_name"])
    ]


def choose_latest_stable(releases: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Use GitHub's release ordering after filtering unsupported releases."""
    candidates = stable_releases(releases)
    if not candidates:
        raise ValueError("upstream has no stable vMAJOR.MINOR.PATCH release")
    return candidates[0]


def decide_release(
    upstream_tag: str,
    recorded_tag: str,
    recorded_version: str,
    force: bool,
    candidate_version: str | None = None,
) -> ReleaseDecision:
    match = STABLE_TAG.fullmatch(upstream_tag)
    if not match:
        raise ValueError(f"unsafe or unstable upstream tag: {upstream_tag}")
    base_version = upstream_tag[1:]
    if upstream_tag != recorded_tag:
        return ReleaseDecision(True, upstream_tag, f"{base_version}-paseito.1")
    recorded_match = PASEITO_VERSION.fullmatch(recorded_version)
    if candidate_version is not None:
        candidate_match = PASEITO_VERSION.fullmatch(candidate_version)
        if not candidate_match or not candidate_version.startswith(f"{base_version}-paseito."):
            raise ValueError(f"unsafe candidate Paseito version: {candidate_version}")
        recorded_revision = (
            int(recorded_match.group(4))
            if recorded_match and recorded_version.startswith(f"{base_version}-paseito.")
            else 0
        )
        if int(candidate_match.group(4)) > recorded_revision:
            return ReleaseDecision(True, upstream_tag, candidate_version)
    if not force:
        return ReleaseDecision(False, upstream_tag, recorded_version)

    if recorded_match and recorded_version.startswith(f"{base_version}-paseito."):
        revision = int(recorded_match.group(4)) + 1
    else:
        revision = 1
    return ReleaseDecision(True, upstream_tag, f"{base_version}-paseito.{revision}")
