#!/usr/bin/env python3
"""Validate semantic decisions against the Paseito feature registry."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

COMMIT = re.compile(r"^[0-9a-f]{40}$")
CLASSIFICATIONS = {"carry_forward", "adapt", "upstream_complete", "blocked"}


class DecisionError(ValueError):
    pass


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise DecisionError(f"{path} must contain an object")
    return value


def validate_decision(value: dict[str, Any], registry: dict[str, Any]) -> None:
    if value.get("schemaVersion") != 1 or not COMMIT.fullmatch(str(value.get("candidateCommit", ""))):
        raise DecisionError("invalid decision schema or candidate commit")
    registered = {item["id"]: item for item in registry.get("features", [])}
    decisions = value.get("features")
    if not isinstance(decisions, list):
        raise DecisionError("features must be an array")
    by_id = {item.get("id"): item for item in decisions if isinstance(item, dict)}
    if set(by_id) != set(registered) or len(by_id) != len(decisions):
        raise DecisionError("decision must contain every registered feature exactly once")
    for feature_id, decision in by_id.items():
        classification = decision.get("classification")
        if classification not in CLASSIFICATIONS:
            raise DecisionError(f"invalid classification for {feature_id}")
        evidence = decision.get("evidence")
        checks = decision.get("contractChecks")
        if not isinstance(evidence, list) or not isinstance(checks, list):
            raise DecisionError(f"missing evidence or checks for {feature_id}")
        if classification != "blocked" and not evidence:
            raise DecisionError(f"non-blocked feature lacks evidence: {feature_id}")
        if classification != "blocked" and (
            not checks
            or any(item.get("result") != "passed" for item in checks)
        ):
            raise DecisionError(f"non-blocked feature lacks passing contract proof: {feature_id}")
        if classification == "adapt" and not decision.get("residualWork"):
            raise DecisionError(f"adapted feature does not describe residual work: {feature_id}")
        if classification == "upstream_complete":
            if registered[feature_id].get("permanent"):
                raise DecisionError(f"permanent feature cannot be retired: {feature_id}")
        if classification == "blocked" and not value.get("blocked"):
            raise DecisionError("feature is blocked but top-level blocked is false")
    blockers = value.get("blockers")
    if bool(blockers) != bool(value.get("blocked")):
        raise DecisionError("blocked flag and blockers must agree")


def validate_review(value: dict[str, Any], registry: dict[str, Any], commit: str) -> None:
    if value.get("schemaVersion") != 1 or value.get("reviewedCommit") != commit:
        raise DecisionError("review does not identify the candidate commit")
    findings = value.get("featureFindings")
    if not isinstance(findings, list):
        raise DecisionError("review findings must be an array")
    expected = {item["id"] for item in registry.get("features", [])}
    actual = {item.get("id") for item in findings if isinstance(item, dict)}
    if actual != expected or len(actual) != len(findings):
        raise DecisionError("review must cover every feature exactly once")
    if value.get("approved") and (value.get("blockers") or any(not item.get("agrees") for item in findings)):
        raise DecisionError("approved review contains disagreement or blockers")
    if value.get("approved") and any(not item.get("evidenceChecked") for item in findings):
        raise DecisionError("approved review contains an unevidenced finding")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--decision", type=Path, required=True)
    parser.add_argument("--review", type=Path)
    args = parser.parse_args()
    registry = load_object(args.registry)
    decision = load_object(args.decision)
    validate_decision(decision, registry)
    if args.review:
        validate_review(load_object(args.review), registry, str(decision["candidateCommit"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
