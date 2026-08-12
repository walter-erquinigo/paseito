from __future__ import annotations

import json
import os
import plistlib
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from daily_report import render_html, report_date
from local_smtp_report import keychain_password, local_status, send_smtp, write_state


class ReportingTests(unittest.TestCase):
    def test_new_york_dst_boundaries(self) -> None:
        self.assertIsNone(report_date(datetime(2026, 3, 8, 11, 59, tzinfo=timezone.utc)))
        self.assertEqual(
            report_date(datetime(2026, 3, 7, 13, 0, tzinfo=timezone.utc)), "2026-03-07"
        )
        self.assertEqual(
            report_date(datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc)), "2026-03-08"
        )
        self.assertEqual(
            report_date(datetime(2026, 3, 8, 13, 0, tzinfo=timezone.utc)), "2026-03-08"
        )
        self.assertEqual(
            report_date(datetime(2026, 11, 1, 13, 0, tzinfo=timezone.utc)), "2026-11-01"
        )
        self.assertEqual(
            report_date(datetime(2026, 11, 1, 18, 0, tzinfo=timezone.utc)), "2026-11-01"
        )

    def test_render_escapes_untrusted_values_and_includes_no_change_surface(self) -> None:
        body = render_html(
            "2026-01-01",
            {
                "upstreamVersion": "v1.0.0<script>",
                "semanticResult": "success",
                "reviewResult": "passed",
                "featureClassifications": {"changes-base-selector": "carry_forward"},
                "verificationBuild": "passed",
                "publishedVersion": "1.0.0-paseito.1",
                "localStatus": {"installedVersion": None, "result": "not reported", "pendingRestart": False},
                "failureIssues": [],
                "runUrl": None,
                "releaseUrl": None,
            },
        )
        self.assertNotIn("<script>", body)
        self.assertIn("including no-change days", body)
        self.assertIn("Pending restart", body)
        self.assertIn("Semantic reconciliation", body)
        self.assertIn("changes-base-selector: carry_forward", body)
        self.assertIn("none registered", body)

    def test_keychain_password_is_read_without_logging_it(self) -> None:
        result = subprocess.CompletedProcess([], 0, stdout="secret\n", stderr="")
        with patch("local_smtp_report.subprocess.run", return_value=result) as run:
            self.assertEqual(keychain_password(), "secret")
        self.assertNotIn("secret", run.call_args.args[0])

    def test_local_status_reads_installed_version_and_pending_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app_plist = root / "Info.plist"
            with app_plist.open("wb") as stream:
                plistlib.dump({"CFBundleShortVersionString": "0.2.5-paseito.2"}, stream)
            marker = root / "pending.json"
            marker.write_text("{}", encoding="utf-8")
            remote_state = root / "remote.json"
            remote_state.write_text(
                json.dumps(
                    {
                        "hosts": [
                            {
                                "host": "viking-new",
                                "result": "failure",
                                "version": "0.2.5-paseito.3",
                                "category": "remote-verification",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            status = local_status(app_plist, marker, remote_state)
        self.assertEqual(status["installedVersion"], "0.2.5-paseito.2")
        self.assertTrue(status["pendingRestart"])
        self.assertEqual(status["result"], "success")
        self.assertEqual(status["remoteHosts"][0]["host"], "viking-new")

    def test_smtp_uses_starttls_before_authentication_and_same_sender_recipient(self) -> None:
        connection = MagicMock()
        smtp_context = MagicMock()
        smtp_context.__enter__.return_value = connection
        with (
            patch("local_smtp_report.smtplib.SMTP", return_value=smtp_context) as smtp,
            patch("local_smtp_report.ssl.create_default_context", return_value="tls-context"),
        ):
            send_smtp("secret", "subject", "<p>status</p>")
        smtp.assert_called_once_with("mail.nvidia.com", 587, timeout=30)
        self.assertEqual(
            [call[0] for call in connection.method_calls],
            ["ehlo", "starttls", "ehlo", "login", "send_message"],
        )
        connection.starttls.assert_called_once_with(context="tls-context")
        connection.login.assert_called_once_with("werquinigo@nvidia.com", "secret")
        message = connection.send_message.call_args.args[0]
        self.assertEqual(message["From"], "werquinigo@nvidia.com")
        self.assertEqual(message["To"], "werquinigo@nvidia.com")

    def test_state_is_atomic_and_private(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            write_state(path, {"lastSentNewYorkDate": "2026-08-05"})
            value = json.loads(path.read_text(encoding="utf-8"))
            mode = os.stat(path).st_mode & 0o777
        self.assertEqual(value["lastSentNewYorkDate"], "2026-08-05")
        self.assertEqual(mode, 0o600)


if __name__ == "__main__":
    unittest.main()
