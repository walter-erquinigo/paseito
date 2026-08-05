from __future__ import annotations

import unittest
from pathlib import Path

from install_launchagents import agent


class LaunchAgentTests(unittest.TestCase):
    def test_agent_can_find_homebrew_gh_without_embedding_credentials(self) -> None:
        value = agent("dev.werquinigo.paseito.test", Path("/tmp/test.py"), interval=3600)
        environment = value["EnvironmentVariables"]
        self.assertIn("/opt/homebrew/bin", environment["PATH"])
        self.assertNotIn("TOKEN", str(value).upper())
        self.assertEqual(value["StartInterval"], 3600)

    def test_reporting_agent_does_not_run_during_installation(self) -> None:
        value = agent(
            "dev.werquinigo.paseito.daily-report",
            Path("/tmp/report.py"),
            interval=3600,
            run_at_load=False,
        )
        self.assertFalse(value["RunAtLoad"])

    def test_semantic_sync_launches_hourly_for_timezone_gate(self) -> None:
        value = agent(
            "dev.werquinigo.paseito.semantic-sync",
            Path("/tmp/sync.py"),
            interval=3600,
            run_at_load=False,
        )
        self.assertEqual(value["StartInterval"], 3600)
        self.assertNotIn("StartCalendarInterval", value)
        self.assertFalse(value["RunAtLoad"])

    def test_agent_rejects_ambiguous_schedules(self) -> None:
        with self.assertRaises(ValueError):
            agent("dev.werquinigo.paseito.test", Path("/tmp/test.py"))
        with self.assertRaises(ValueError):
            agent(
                "dev.werquinigo.paseito.test",
                Path("/tmp/test.py"),
                interval=3600,
                calendar_hour=12,
            )


if __name__ == "__main__":
    unittest.main()
