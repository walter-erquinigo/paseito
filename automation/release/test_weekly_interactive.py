from __future__ import annotations

import unittest

from weekly_interactive import (
    GITHUB_ACTIONS_UNAVAILABLE_NOTE,
    PROMPT,
    iterm_script,
    terminal_command,
)


class WeeklyInteractiveTests(unittest.TestCase):
    def test_terminal_command_starts_interactive_runner(self) -> None:
        self.assertIn("weekly_interactive.py", terminal_command())
        self.assertIn("--run", terminal_command())

    def test_launcher_targets_visible_iterm2_window(self) -> None:
        script = iterm_script()
        self.assertIn('tell application "iTerm2"', script)
        self.assertIn("activate", script)
        self.assertIn("create window with default profile command", script)
        self.assertNotIn('application "Terminal"', script)

    def test_current_run_can_skip_exhausted_github_actions(self) -> None:
        command = terminal_command(actions_unavailable=True)
        self.assertIn("--actions-unavailable", command)
        self.assertIn("quota is exhausted", GITHUB_ACTIONS_UNAVAILABLE_NOTE)
        self.assertIn("Do not dispatch, retry, or wait", GITHUB_ACTIONS_UNAVAILABLE_NOTE)

    def test_prompt_requires_the_full_human_supervised_release(self) -> None:
        self.assertIn("exactly one commit remains per registered feature", PROMPT)
        self.assertIn("recoverable backup ref", PROMPT)
        self.assertIn("history_normalization.py check-agents and check-history", PROMPT)
        self.assertIn("mandatory semantic rebase", PROMPT)
        self.assertIn("Whenever upstream independently implements all or part", PROMPT)
        self.assertIn("Flag the feature ID", PROMPT)
        self.assertIn("ask the human whether to carry it forward, adapt it, or retire it", PROMPT)
        self.assertIn("Do not infer the choice", PROMPT)
        self.assertIn("Commit and push", PROMPT)
        self.assertIn("build and publish", PROMPT)
        self.assertIn("install", PROMPT)
        self.assertIn("local-only fallback", PROMPT)
        self.assertIn("force-push the final `paseito` branch with `--force-with-lease`", PROMPT)
        self.assertIn("Do not create a release tag", PROMPT)
        self.assertIn("explicit permission", PROMPT)
        self.assertIn("Never use launchctl submit", PROMPT)
        self.assertLess(PROMPT.index("exactly one commit remains"), PROMPT.index("Fetch getpaseo/paseo"))


if __name__ == "__main__":
    unittest.main()
