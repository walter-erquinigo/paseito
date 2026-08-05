#!/usr/bin/env python3
"""Send the daily Paseito report through NVIDIA's authenticated SMTP relay."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import smtplib
import ssl
import subprocess
import sys
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from daily_report import REPOSITORY, collect, read_json, render_html, report_date

EMAIL = "werquinigo@nvidia.com"
SMTP_HOST = "mail.nvidia.com"
SMTP_PORT = 587
KEYCHAIN_SERVICE = "dev.werquinigo.paseito.smtp"
FAILURE_TITLE = "Paseito daily email delivery is blocked"
STATE_ROOT = Path.home() / "Library/Application Support/PaseitoAutomation"
STATE_PATH = STATE_ROOT / "local-report-state.json"
APP_PLIST = Path("/Applications/Paseito.app/Contents/Info.plist")
PENDING_MARKER = Path.home() / "Library/Application Support/Paseito/Updater/pending-restart.json"
REMOTE_STATE = STATE_ROOT / "remote-deployment-state.json"


class CredentialUnavailable(RuntimeError):
    """The SMTP credential has not been configured in macOS Keychain."""


def keychain_password() -> str:
    result = subprocess.run(
        [
            "/usr/bin/security",
            "find-generic-password",
            "-a",
            EMAIL,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    password = result.stdout.rstrip("\n")
    if result.returncode or not password:
        raise CredentialUnavailable("NVIDIA SMTP password is not configured in macOS Keychain")
    return password


def local_status(
    app_plist: Path = APP_PLIST,
    pending_marker: Path = PENDING_MARKER,
    remote_state: Path = REMOTE_STATE,
) -> dict[str, Any]:
    version: str | None = None
    timestamp: str | None = None
    if app_plist.is_file():
        with app_plist.open("rb") as stream:
            value = plistlib.load(stream).get("CFBundleShortVersionString")
        version = str(value) if value else None
        timestamp = datetime.fromtimestamp(app_plist.stat().st_mtime, timezone.utc).isoformat()
    remote = read_json(remote_state)
    remote_hosts = remote.get("hosts", []) if remote else []
    if not isinstance(remote_hosts, list):
        remote_hosts = []
    return {
        "schemaVersion": 2,
        "installedVersion": version,
        "timestamp": timestamp,
        "pendingRestart": pending_marker.is_file(),
        "result": "success" if version else "failure",
        "category": "installed" if version else "not-installed",
        "remoteHosts": [item for item in remote_hosts if isinstance(item, dict)],
    }


def send_smtp(password: str, subject: str, html_body: str) -> None:
    message = EmailMessage()
    message["From"] = EMAIL
    message["To"] = EMAIL
    message["Subject"] = subject
    message.set_content("Paseito daily status is available in the HTML part of this message.")
    message.add_alternative(html_body, subtype="html")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(EMAIL, password)
        smtp.send_message(message)


def write_state(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def open_failure_issue(category: str) -> None:
    body = (
        f"Local NVIDIA SMTP reporting failed ({category}). "
        "Inspect ~/Library/Logs/PaseitoAutomation/dev.werquinigo.paseito.daily-report.err.log "
        "on the enrolled Mac. No credential or SMTP response is included here."
    )
    result = subprocess.run(
        [
            "gh",
            "issue",
            "list",
            "--repo",
            REPOSITORY,
            "--state",
            "open",
            "--search",
            f"{FAILURE_TITLE} in:title",
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    number = result.stdout.strip() if result.returncode == 0 else ""
    if not number:
        subprocess.run(
            ["gh", "issue", "create", "--repo", REPOSITORY, "--title", FAILURE_TITLE, "--body", body],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def close_failure_issue() -> None:
    result = subprocess.run(
        [
            "gh",
            "issue",
            "list",
            "--repo",
            REPOSITORY,
            "--state",
            "open",
            "--search",
            f"{FAILURE_TITLE} in:title",
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    number = result.stdout.strip() if result.returncode == 0 else ""
    if number:
        subprocess.run(
            [
                "gh",
                "issue",
                "close",
                number,
                "--repo",
                REPOSITORY,
                "--comment",
                "Local NVIDIA SMTP delivery recovered.",
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="send now, ignoring the daily time and date gates")
    parser.add_argument("--state", type=Path, default=STATE_PATH)
    args = parser.parse_args()
    date_key = report_date(datetime.now(timezone.utc), args.force)
    if not date_key:
        return 0
    previous = read_json(args.state)
    if not args.force and previous and previous.get("lastSentNewYorkDate") == date_key:
        return 0
    try:
        password = keychain_password()
        report = collect(local_status())
        send_smtp(password, f"Paseito daily status — {date_key}", render_html(date_key, report))
        write_state(
            args.state,
            {"lastSentNewYorkDate": date_key, "sentAt": datetime.now(timezone.utc).isoformat()},
        )
    except CredentialUnavailable as error:
        print(str(error), file=sys.stderr)
        open_failure_issue("credential-unavailable")
        return 1
    except Exception as error:
        print(f"Daily report failed in {type(error).__name__}; details were withheld from logs", file=sys.stderr)
        open_failure_issue(type(error).__name__)
        return 1
    close_failure_issue()
    print(f"Daily report {date_key} sent from and to {EMAIL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
