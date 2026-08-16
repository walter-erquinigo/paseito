#!/usr/bin/env python3
"""Validate Paseito's registry-managed feature history and AGENTS checklist."""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

CHECKLIST_START = "<!-- PASEITO-LOCAL-FEATURES:START -->"
CHECKLIST_END = "<!-- PASEITO-LOCAL-FEATURES:END -->"
TRAILER = "Paseito-Change"
METADATA_SUBJECT_PREFIXES = (
    "chore: preserve Paseito release metadata",
    "chore: prepare ",
)


class HistoryNormalizationError(RuntimeError):
    pass


@dataclass(frozen=True)
class FeatureHistory:
    id: str
    subject: str
    intent: str
    fixes: tuple[str, ...]


def command(args: Sequence[str], *, cwd: Path) -> str:
    result = subprocess.run(
        list(args),
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise HistoryNormalizationError(detail or f"command failed: {args[0]}")
    return result.stdout.strip()


def load_registry(path: Path) -> list[FeatureHistory]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise HistoryNormalizationError("feature registry is unreadable") from error
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise HistoryNormalizationError("feature registry has an unsupported schema")
    raw_features = value.get("features")
    if not isinstance(raw_features, list) or not raw_features:
        raise HistoryNormalizationError("feature registry has no features")
    features: list[FeatureHistory] = []
    seen_ids: set[str] = set()
    seen_subjects: set[str] = set()
    for raw in raw_features:
        if not isinstance(raw, dict):
            raise HistoryNormalizationError("feature registry contains an invalid feature")
        feature_id = raw.get("id")
        subject = raw.get("commitSubject")
        intent = raw.get("intent")
        fixes = raw.get("preservationFixes")
        if not all(isinstance(item, str) and item.strip() for item in (feature_id, subject, intent)):
            raise HistoryNormalizationError("every feature needs an id, commitSubject and intent")
        if not isinstance(fixes, list) or not fixes or not all(
            isinstance(fix, str) and fix.strip() for fix in fixes
        ):
            raise HistoryNormalizationError(f"{feature_id} needs preservationFixes")
        if feature_id in seen_ids or subject in seen_subjects:
            raise HistoryNormalizationError("feature ids and commit subjects must be unique")
        seen_ids.add(feature_id)
        seen_subjects.add(subject)
        features.append(FeatureHistory(feature_id, subject, intent, tuple(fixes)))
    return features


def render_checklist(features: Sequence[FeatureHistory]) -> str:
    lines = [
        CHECKLIST_START,
        "",
        "## Paseito local feature preservation",
        "",
        "`automation/feature-registry.json` is authoritative. Before and after every upstream rebase,",
        "verify each feature and its preservation fixes; update the registry and regenerate this block",
        "instead of editing the list by hand.",
        "",
    ]
    for feature in features:
        lines.append(f"- `{feature.id}` — {feature.intent}")
        for fix in feature.fixes:
            lines.append(f"  - Fix: {fix}")
    lines.extend(["", CHECKLIST_END, ""])
    return "\n".join(lines)


def replace_checklist(content: str, checklist: str) -> str:
    has_start = CHECKLIST_START in content
    has_end = CHECKLIST_END in content
    if has_start != has_end:
        raise HistoryNormalizationError("AGENTS.md contains an incomplete generated checklist")
    if not has_start:
        return content.rstrip() + "\n\n" + checklist
    before, remainder = content.split(CHECKLIST_START, 1)
    _, after = remainder.split(CHECKLIST_END, 1)
    return before.rstrip() + "\n\n" + checklist + after.lstrip("\n")


def sync_checklist(root: Path, *, check: bool) -> None:
    agents = root / "AGENTS.md"
    features = load_registry(root / "automation/feature-registry.json")
    current = agents.read_text(encoding="utf-8")
    expected = replace_checklist(current, render_checklist(features))
    if current == expected:
        return
    if check:
        raise HistoryNormalizationError(
            "AGENTS.md local feature checklist is stale; run history_normalization.py sync-agents"
        )
    agents.write_text(expected, encoding="utf-8")


def commit_trailer(root: Path, commit: str) -> str | None:
    value = command(
        ["git", "show", "-s", "--format=%(trailers:key=Paseito-Change,valueonly)", commit],
        cwd=root,
    )
    trailers = [line.strip() for line in value.splitlines() if line.strip()]
    if not trailers:
        return None
    if len(trailers) != 1:
        raise HistoryNormalizationError(f"{commit[:12]} has multiple {TRAILER} trailers")
    return trailers[0]


def validate_normalized_history(root: Path, upstream: str) -> None:
    features = load_registry(root / "automation/feature-registry.json")
    by_id = {feature.id: feature for feature in features}
    counts = {feature.id: 0 for feature in features}
    commits = command(["git", "rev-list", "--reverse", f"{upstream}..HEAD"], cwd=root).splitlines()
    if not commits:
        raise HistoryNormalizationError("candidate has no Paseito commits")
    for commit in commits:
        subject = command(["git", "show", "-s", "--format=%s", commit], cwd=root)
        change_id = commit_trailer(root, commit)
        if change_id is None:
            if subject.startswith(METADATA_SUBJECT_PREFIXES):
                continue
            raise HistoryNormalizationError(
                f"{commit[:12]} is not classified with a {TRAILER} trailer"
            )
        feature = by_id.get(change_id)
        if feature is None:
            raise HistoryNormalizationError(f"{commit[:12]} uses unknown feature id {change_id}")
        if subject != feature.subject:
            raise HistoryNormalizationError(
                f"{commit[:12]} subject must be {feature.subject!r}, got {subject!r}"
            )
        counts[change_id] += 1
    missing = [feature_id for feature_id, count in counts.items() if count == 0]
    duplicates = [feature_id for feature_id, count in counts.items() if count > 1]
    if missing or duplicates:
        details = []
        if missing:
            details.append(f"missing feature commits: {', '.join(missing)}")
        if duplicates:
            details.append(f"duplicate feature commits: {', '.join(duplicates)}")
        raise HistoryNormalizationError("; ".join(details))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("sync-agents", "check-agents", "check-history"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--upstream")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.action in {"sync-agents", "check-agents"}:
        sync_checklist(root, check=args.action == "check-agents")
    else:
        if not args.upstream:
            parser.error("check-history requires --upstream")
        validate_normalized_history(root, args.upstream)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
