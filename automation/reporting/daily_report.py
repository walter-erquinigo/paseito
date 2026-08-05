#!/usr/bin/env python3
"""Build and send the idempotent 07:00 America/New_York Paseito report."""

from __future__ import annotations

import argparse
import html
import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from graph_mail import access_token, decrypt_cache, encrypt_cache, send_mail

API = "https://api.github.com"
REPOSITORY = "walter-erquinigo/paseito"
FAILURE_TITLES = {
    "Paseito local semantic sync is blocked",
    "Paseito automated release is blocked",
}


def report_date(now: datetime, force: bool = False) -> str | None:
    local = now.astimezone(ZoneInfo("America/New_York"))
    if not force and local.hour != 7:
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
    issue = next((item for item in issues if item.get("title") in FAILURE_TITLES), None)
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
        "failureIssue": issue.get("html_url") if issue else None,
        "runUrl": run.get("html_url") if run else None,
        "releaseUrl": release_url,
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
            or "not published",
        ),
        ("Verification/build", report["verificationBuild"]),
        ("Published Paseito version", report["publishedVersion"]),
        ("Installed version", local.get("installedVersion") or "not reported"),
        ("Local installation", local.get("result", "not reported")),
        ("Local status timestamp", local.get("timestamp") or "not reported"),
        ("Pending restart", "yes" if local.get("pendingRestart") else "no"),
        ("Unresolved release failure", report["failureIssue"] or "none"),
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--status", type=Path)
    parser.add_argument("--output-state", type=Path, default=Path("report-state.json"))
    args = parser.parse_args()
    date_key = report_date(datetime.now(timezone.utc), args.force)
    output = os.environ.get("GITHUB_OUTPUT")
    if args.gate_only:
        if output:
            with open(output, "a", encoding="utf-8") as stream:
                stream.write(f"should_send={'true' if date_key else 'false'}\n")
                stream.write(f"date_key={date_key or ''}\n")
        return 0
    if not date_key or not args.cache:
        return 0
    previous = read_json(args.state)
    if previous and previous.get("lastSentNewYorkDate") == date_key:
        args.output_state.write_text(json.dumps(previous, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"Daily report {date_key} was already sent")
        return 0
    client_id = os.environ["GRAPH_CLIENT_ID"]
    key = os.environ["GRAPH_TOKEN_CACHE_KEY"]
    cache = decrypt_cache(args.cache, key)
    token, cache = access_token(cache, client_id)
    # Persist a rotated refresh token even if transport fails afterward.
    encrypt_cache(cache, args.cache, key)
    report = collect(read_json(args.status))
    body = render_html(date_key, report)
    send_mail(token, f"Paseito daily status — {date_key}", body)
    args.output_state.write_text(
        json.dumps({"lastSentNewYorkDate": date_key}, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"Daily report {date_key} sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
