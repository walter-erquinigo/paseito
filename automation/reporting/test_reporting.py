from __future__ import annotations

import unittest
from unittest.mock import patch
from datetime import datetime, timezone

from daily_report import render_html, report_date
from graph_mail import access_token


class ReportingTests(unittest.TestCase):
    def test_new_york_dst_boundaries(self) -> None:
        self.assertEqual(
            report_date(datetime(2026, 3, 7, 12, 0, tzinfo=timezone.utc)), "2026-03-07"
        )
        self.assertEqual(
            report_date(datetime(2026, 3, 8, 11, 0, tzinfo=timezone.utc)), "2026-03-08"
        )
        self.assertIsNone(report_date(datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc)))
        self.assertEqual(
            report_date(datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)), "2026-11-01"
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
                "failureIssue": None,
                "runUrl": None,
                "releaseUrl": None,
            },
        )
        self.assertNotIn("<script>", body)
        self.assertIn("including no-change days", body)
        self.assertIn("Pending restart", body)
        self.assertIn("Semantic reconciliation", body)
        self.assertIn("changes-base-selector: carry_forward", body)

    def test_expired_token_is_refreshed_without_losing_rotated_refresh_token(self) -> None:
        cache = {"access_token": "old", "refresh_token": "refresh-old", "expires_at": 0}
        with patch(
            "graph_mail.post_form",
            return_value={
                "access_token": "new",
                "refresh_token": "refresh-new",
                "expires_in": 3600,
            },
        ):
            token, updated = access_token(cache, "client")
        self.assertEqual(token, "new")
        self.assertEqual(updated["refresh_token"], "refresh-new")


if __name__ == "__main__":
    unittest.main()
