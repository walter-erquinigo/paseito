#!/usr/bin/env python3
"""Build the idempotent daily Paseito status report."""

from __future__ import annotations

import html
import json
import os
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

API = "https://api.github.com"
REPOSITORY = "walter-erquinigo/paseito"
FAILURE_TITLES = {
    "Paseito local semantic sync is blocked",
    "Paseito automated release is blocked",
    "Paseito daily email delivery is blocked",
}


def report_date(now: datetime, force: bool = False) -> str | None:
    local = now.astimezone(ZoneInfo("America/New_York"))
    if not force and local.hour < 7:
        return None
    return local.date().isoformat()


def read_json(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else None


def github_json(path_or_url: str) -> Any:
    url = path_or_url if path_or_url.startswith("https://") else f"{API}{path_or_url}"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "paseito-report/1"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        return json.load(response)


def collect(local_status: dict[str, Any] | None) -> dict[str, Any]:
    releases = github_json(f"/repos/{REPOSITORY}/releases?per_page=20")
    release = next(
        (
            item
            for item in releases
            if not item.get("draft")
            and not item.get("prerelease")
            and str(item.get("tag_name", "")).startswith("paseito-v")
        ),
        None,
    )
    provenance: dict[str, Any] | None = None
    release_url: str | None = None
    if release:
        release_url = release.get("html_url")
        asset = next((item for item in release.get("assets", []) if item.get("name") == "provenance.json"), None)
        if asset:
            provenance = github_json(asset["browser_download_url"])
    runs = github_json(f"/repos/{REPOSITORY}/actions/workflows/paseito-release.yml/runs?per_page=1")
    run = (runs.get("workflow_runs") or [None])[0]
    issues = github_json(f"/repos/{REPOSITORY}/issues?state=open&per_page=100")
    failure_issues = [
        item.get("html_url") for item in issues if item.get("title") in FAILURE_TITLES and item.get("html_url")
    ]
    semantic_result = (
        provenance.get("tests", {}).get("semanticReconciliation", "passed")
        if provenance
        else (run.get("conclusion") if run else "not run")
    )
    classifications = provenance.get("semanticDecision", {}).get("featureClassifications", {}) if provenance else {}
    return {
        "upstreamVersion": provenance.get("upstreamTag") if provenance else "not published",
        "semanticResult": semantic_result,
        "reviewResult": provenance.get("tests", {}).get("independentReview", "not published") if provenance else "not published",
        "featureClassifications": classifications,
        "verificationBuild": "passed" if provenance else (run.get("conclusion") if run else "not run"),
        "publishedVersion": provenance.get("paseitoVersion") if provenance else "none",
        "localStatus": local_status or {
            "installedVersion": None,
            "result": "not reported",
            "pendingRestart": False,
            "timestamp": None,
        },
        "failureIssues": failure_issues,
        "runUrl": run.get("html_url") if run else None,
        "releaseUrl": release_url,
    }


def render_html(date_key: str, report: dict[str, Any]) -> str:
    local = report["localStatus"]
    failures = report.get("failureIssues") or [report.get("failureIssue")]
    rows = [
        ("Upstream version", report["upstreamVersion"]),
        ("Semantic reconciliation", report["semanticResult"]),
        ("Independent review", report["reviewResult"]),
        (
            "Feature decisions",
            ", ".join(f"{key}: {value}" for key, value in sorted(report["featureClassifications"].items()))
            or "not published",
        ),
        ("Verification/build", report["verificationBuild"]),
        ("Published Paseito version", report["publishedVersion"]),
        ("Installed version", local.get("installedVersion") or "not reported"),
        ("Local installation", local.get("result", "not reported")),
        ("Local status timestamp", local.get("timestamp") or "not reported"),
        ("Pending restart", "yes" if local.get("pendingRestart") else "no"),
        ("Unresolved automation failures", ", ".join(str(value) for value in failures if value) or "none"),
    ]
    rendered = "".join(
        f"<tr><th align='left'>{html.escape(str(label))}</th><td>{html.escape(str(value))}</td></tr>"
        for label, value in rows
    )
    links = []
    for label, url in (("Latest workflow run", report["runUrl"]), ("Latest release", report["releaseUrl"])):
        if url:
            links.append(f"<a href='{html.escape(str(url), quote=True)}'>{html.escape(label)}</a>")
    return (
        f"<h2>Paseito daily status — {html.escape(date_key)}</h2>"
        f"<table cellpadding='5' cellspacing='0' border='1'>{rendered}</table>"
        f"<p>{' · '.join(links) if links else 'No run or release links yet.'}</p>"
        "<p>This report is sent every day, including no-change days.</p>"
    )
