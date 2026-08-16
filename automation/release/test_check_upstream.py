from __future__ import annotations

import os
import subprocess
import unittest
from unittest.mock import patch

from check_upstream import github_token


class CheckUpstreamTests(unittest.TestCase):
    def test_uses_existing_environment_token_without_invoking_gh(self) -> None:
        with (
            patch.dict(os.environ, {"GITHUB_TOKEN": "workflow-token"}, clear=True),
            patch("check_upstream.subprocess.run") as run,
        ):
            self.assertEqual(github_token(), "workflow-token")
        run.assert_not_called()

    def test_uses_authenticated_gh_session_for_local_discovery(self) -> None:
        authenticated = subprocess.CompletedProcess([], 0, stdout="keyring-token\n", stderr="")
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("check_upstream.subprocess.run", return_value=authenticated) as run,
        ):
            self.assertEqual(github_token(), "keyring-token")
        run.assert_called_once_with(
            ["gh", "auth", "token"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )

    def test_falls_back_to_anonymous_discovery_when_gh_is_not_authenticated(self) -> None:
        unavailable = subprocess.CompletedProcess([], 1, stdout="", stderr="")
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("check_upstream.subprocess.run", return_value=unavailable),
        ):
            self.assertIsNone(github_token())


if __name__ == "__main__":
    unittest.main()
