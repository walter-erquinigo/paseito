from __future__ import annotations

import unittest
from pathlib import Path

from install_launchagents import agent


class LaunchAgentTests(unittest.TestCase):
    def test_agent_can_find_homebrew_gh_without_embedding_credentials(self) -> None:
        value = agent("dev.werquinigo.paseito.test", Path("/tmp/test.py"), interval=3600)
        environment = value["EnvironmentVariables"]
        self.assertIn(str(Path.home() / ".local/bin"), environment["PATH"])
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

    def test_interactive_release_launches_sunday_at_seven(self) -> None:
        value = agent(
            "dev.werquinigo.paseito.weekly-release",
            Path("/tmp/sync.py"),
            calendar_hour=7,
            calendar_minute=0,
            calendar_weekday=0,
            run_at_load=False,
        )
        self.assertEqual(
            value["StartCalendarInterval"], {"Weekday": 0, "Hour": 7, "Minute": 0}
        )
        self.assertNotIn("StartInterval", value)
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
