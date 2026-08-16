#!/usr/bin/env python3
"""Prompt macOS Keychain—not Python or the shell—for the NVIDIA SMTP password."""

from __future__ import annotations

import subprocess

from local_smtp_report import EMAIL, KEYCHAIN_SERVICE


def main() -> int:
    print("macOS Keychain will prompt for the NVIDIA password; input is not echoed or passed as an argument.")
    result = subprocess.run(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-U",
            "-a",
            EMAIL,
            "-s",
            KEYCHAIN_SERVICE,
            "-l",
            "Paseito NVIDIA SMTP",
            "-w",
        ],
        check=False,
    )
    if result.returncode == 0:
        print("Credential stored in the login Keychain.")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
