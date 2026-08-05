#!/usr/bin/env python3
"""Delegated Microsoft Graph OAuth and encrypted token-cache support."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access https://graph.microsoft.com/Mail.Send"
ADDRESS = "werquinigo@outlook.com"


class MailError(RuntimeError):
    pass


def post_form(url: str, fields: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(fields).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            value = json.loads(error.read())
        except json.JSONDecodeError:
            value = {}
        code = value.get("error", f"http_{error.code}")
        description = value.get("error_description", "OAuth request failed")
        raise MailError(f"{code}: {description}") from error


def openssl_cache(data: bytes, key: str, decrypt: bool = False) -> bytes:
    executable = shutil.which("openssl")
    if not executable:
        raise MailError("openssl is required to encrypt the Graph token cache")
    env = {**os.environ, "PASEITO_CACHE_PASSWORD": key}
    args = [executable, "enc", "-aes-256-cbc", "-pbkdf2", "-pass", "env:PASEITO_CACHE_PASSWORD"]
    if decrypt:
        args.append("-d")
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise MailError("Graph token cache encryption failed")
    return result.stdout


def encrypt_cache(cache: dict[str, Any], path: Path, key: str) -> None:
    serialized = json.dumps(cache, separators=(",", ":"), sort_keys=True).encode()
    path.write_bytes(openssl_cache(serialized, key))
    os.chmod(path, 0o600)


def decrypt_cache(path: Path, key: str) -> dict[str, Any]:
    try:
        value = json.loads(openssl_cache(path.read_bytes(), key, decrypt=True))
    except (OSError, json.JSONDecodeError) as error:
        raise MailError("encrypted Graph token cache is unreadable") from error
    if not isinstance(value, dict) or not isinstance(value.get("refresh_token"), str):
        raise MailError("Graph token cache has no refresh token")
    return value


def normalize_token(value: dict[str, Any], previous_refresh: str | None = None) -> dict[str, Any]:
    if not isinstance(value.get("access_token"), str):
        raise MailError("Graph did not return an access token")
    refresh = value.get("refresh_token") or previous_refresh
    if not isinstance(refresh, str):
        raise MailError("Graph did not return a refresh token; offline_access is required")
    return {
        "access_token": value["access_token"],
        "refresh_token": refresh,
        "expires_at": int(time.time()) + int(value.get("expires_in", 3600)),
        "scope": value.get("scope", SCOPES),
        "token_type": value.get("token_type", "Bearer"),
    }


def device_code_login(client_id: str) -> dict[str, Any]:
    device = post_form(f"{AUTHORITY}/devicecode", {"client_id": client_id, "scope": SCOPES})
    print(device.get("message", "Open the Microsoft device login page and enter the shown code."), flush=True)
    interval = int(device.get("interval", 5))
    deadline = time.monotonic() + int(device.get("expires_in", 900))
    while time.monotonic() < deadline:
        time.sleep(interval)
        try:
            value = post_form(
                f"{AUTHORITY}/token",
                {
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": client_id,
                    "device_code": str(device["device_code"]),
                },
            )
            return normalize_token(value)
        except MailError as error:
            if str(error).startswith("authorization_pending:"):
                continue
            if str(error).startswith("slow_down:"):
                interval += 5
                continue
            raise
    raise MailError("device-code authorization expired")


def refresh(cache: dict[str, Any], client_id: str) -> dict[str, Any]:
    value = post_form(
        f"{AUTHORITY}/token",
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": str(cache["refresh_token"]),
            "scope": SCOPES,
        },
    )
    return normalize_token(value, str(cache["refresh_token"]))


def access_token(cache: dict[str, Any], client_id: str) -> tuple[str, dict[str, Any]]:
    if int(cache.get("expires_at", 0)) <= int(time.time()) + 300:
        cache = refresh(cache, client_id)
    return str(cache["access_token"]), cache


def send_mail(token: str, subject: str, html: str) -> None:
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html},
            "toRecipients": [{"emailAddress": {"address": ADDRESS}}],
            "from": {"emailAddress": {"address": ADDRESS}},
        },
        "saveToSentItems": True,
    }
    request = urllib.request.Request(
        f"{GRAPH}/me/sendMail",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status != 202:
                raise MailError(f"Graph sendMail returned HTTP {response.status}")
    except urllib.error.HTTPError as error:
        raise MailError(f"Graph sendMail returned HTTP {error.code}") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    bootstrap = subparsers.add_parser("bootstrap")
    bootstrap.add_argument("--output", type=Path, default=Path("graph-token-cache.enc"))
    args = parser.parse_args()
    client_id = os.environ.get("GRAPH_CLIENT_ID")
    key = os.environ.get("GRAPH_TOKEN_CACHE_KEY")
    if not client_id or not key:
        parser.error("GRAPH_CLIENT_ID and GRAPH_TOKEN_CACHE_KEY are required")
    if args.command == "bootstrap":
        encrypt_cache(device_code_login(client_id), args.output, key)
        print(f"Encrypted cache written to {args.output}. Do not commit it.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MailError as error:
        print(f"Graph authorization failed: {error}")
        raise SystemExit(1)
