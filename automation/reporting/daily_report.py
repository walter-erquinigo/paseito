#!/usr/bin/env python3
"""Build the idempotent daily Paseito status report."""

from __future__ import annotations

import html
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
REPORT_HOUR = 8


def report_date(now: datetime, force: bool = False) -> str | None:
    local = now.astimezone(ZoneInfo("America/New_York"))
    if not force and local.hour < REPORT_HOUR:
        return None
    return local.date().isoformat()


def read_json(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else None


def collect(local_status: dict[str, Any] | None, root: Path = ROOT) -> dict[str, Any]:
    metadata = read_json(root / "automation/upstream.json") or {}
    package = read_json(root / "package.json") or {}
    decision_paths = sorted(
        (root / "automation/decisions").glob("*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    record = read_json(decision_paths[0]) if decision_paths else None
    decision = record.get("decision", {}) if record else {}
    review = record.get("review", {}) if record else {}
    features = decision.get("features", []) if isinstance(decision, dict) else []
    classifications = {
        str(item["id"]): str(item["classification"])
        for item in features
        if isinstance(item, dict) and "id" in item and "classification" in item
    }
    return {
        "upstreamVersion": metadata.get("upstreamTag", "not recorded"),
        "semanticResult": "blocked" if decision.get("blocked") else ("passed" if record else "not run"),
        "reviewResult": "passed" if review.get("approved") else ("rejected" if record else "not run"),
        "featureClassifications": classifications,
        "verificationBuild": (local_status or {}).get("result", "not reported"),
        "sourceVersion": package.get("version", "not recorded"),
        "localStatus": local_status or {
            "installedVersion": None,
            "result": "not reported",
            "pendingRestart": False,
            "timestamp": None,
        },
    }


def render_html(date_key: str, report: dict[str, Any]) -> str:
    local = report["localStatus"]
    rows = [
        ("Upstream version", report["upstreamVersion"]),
        ("Semantic reconciliation", report["semanticResult"]),
        ("Independent review", report["reviewResult"]),
        (
            "Feature decisions",
            ", ".join(f"{key}: {value}" for key, value in sorted(report["featureClassifications"].items()))
            or "not recorded",
        ),
        ("Local verification/build", report["verificationBuild"]),
        ("Source Paseito version", report["sourceVersion"]),
        ("Installed version", local.get("installedVersion") or "not reported"),
        ("Local installation", local.get("result", "not reported")),
        ("Local status timestamp", local.get("timestamp") or "not reported"),
        ("Pending restart", "yes" if local.get("pendingRestart") else "no"),
        ("Remote deployment", "disabled by local-only policy"),
    ]
    rendered = "".join(
        f"<tr><th align='left'>{html.escape(str(label))}</th><td>{html.escape(str(value))}</td></tr>"
        for label, value in rows
    )
    return (
        f"<h2>Paseito daily status — {html.escape(date_key)}</h2>"
        f"<table cellpadding='5' cellspacing='0' border='1'>{rendered}</table>"
        "<p>This report is sent every day, including no-change days.</p>"
    )
