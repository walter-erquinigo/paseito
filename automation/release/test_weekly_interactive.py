from __future__ import annotations

import unittest

from weekly_interactive import (
    PROMPT,
    iterm_launch_arguments,
    terminal_command,
)


class WeeklyInteractiveTests(unittest.TestCase):
    def test_terminal_command_starts_interactive_runner(self) -> None:
        self.assertIn("weekly_interactive.py", terminal_command())
        self.assertIn("--run", terminal_command())

    def test_launcher_targets_visible_iterm2_window(self) -> None:
        arguments = iterm_launch_arguments()
        self.assertEqual(arguments[:2], ["/usr/bin/open", "-na"])
        self.assertEqual(arguments[2], "/Applications/iTerm.app")
        self.assertEqual(arguments[3], "--args")
        self.assertTrue(arguments[4].startswith("--command="))
        self.assertIn("weekly_interactive.py", arguments[4])
        self.assertNotIn("osascript", arguments)

    def test_prompt_requires_human_supervised_local_maintenance(self) -> None:
        self.assertIn("exactly one commit remains per registered feature", PROMPT)
        self.assertIn("recoverable backup ref", PROMPT)
        self.assertIn("history_normalization.py check-agents and check-history", PROMPT)
        self.assertIn("mandatory semantic rebase", PROMPT)
        self.assertIn("Whenever upstream independently implements all or part", PROMPT)
        self.assertIn("Flag the feature ID", PROMPT)
        self.assertIn("ask the human whether to carry it forward, adapt it, or retire it", PROMPT)
        self.assertIn("Do not infer the choice", PROMPT)
        self.assertIn("Build and smoke-test", PROMPT)
        self.assertIn("Install the verified local build", PROMPT)
        self.assertIn("force-push the final `paseito` branch with `--force-with-lease`", PROMPT)
        self.assertIn("Never dispatch or wait for GitHub Actions", PROMPT)
        self.assertIn("create a release tag", PROMPT)
        self.assertIn("deploy remote daemons", PROMPT)
        self.assertIn("GitHub is used only to fetch upstream", PROMPT)
        self.assertIn("explicit permission", PROMPT)
        self.assertIn("Never use launchctl submit", PROMPT)
        self.assertLess(PROMPT.index("exactly one commit remains"), PROMPT.index("Fetch getpaseo/paseo"))


if __name__ == "__main__":
    unittest.main()
