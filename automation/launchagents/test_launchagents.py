from __future__ import annotations

import unittest
from pathlib import Path

from install_launchagents import agent


class LaunchAgentTests(unittest.TestCase):
    def test_agent_can_find_homebrew_gh_without_embedding_credentials(self) -> None:
        value = agent("dev.werquinigo.paseito.test", Path("/tmp/test.py"), 3600)
        environment = value["EnvironmentVariables"]
        self.assertIn("/opt/homebrew/bin", environment["PATH"])
        self.assertNotIn("TOKEN", str(value).upper())
        self.assertEqual(value["StartInterval"], 3600)


if __name__ == "__main__":
    unittest.main()
