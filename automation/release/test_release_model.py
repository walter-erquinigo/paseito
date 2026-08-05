from __future__ import annotations

import unittest

from release_model import choose_latest_stable, decide_release, stable_releases


class ReleaseModelTests(unittest.TestCase):
    def test_filters_drafts_prereleases_and_arbitrary_tags(self) -> None:
        releases = [
            {"tag_name": "release-next", "draft": False, "prerelease": False},
            {"tag_name": "v2.0.0", "draft": True, "prerelease": False},
            {"tag_name": "v1.2.4", "draft": False, "prerelease": True},
            {"tag_name": "v1.2.3", "draft": False, "prerelease": False},
        ]
        self.assertEqual([item["tag_name"] for item in stable_releases(releases)], ["v1.2.3"])
        self.assertEqual(choose_latest_stable(releases)["tag_name"], "v1.2.3")

    def test_new_upstream_resets_revision(self) -> None:
        decision = decide_release("v0.3.0", "v0.2.5", "0.2.5-paseito.7", False)
        self.assertTrue(decision.needs_release)
        self.assertEqual(decision.version, "0.3.0-paseito.1")

    def test_noop_and_explicit_additional_release(self) -> None:
        noop = decide_release("v0.2.5", "v0.2.5", "0.2.5-paseito.1", False)
        forced = decide_release("v0.2.5", "v0.2.5", "0.2.5-paseito.1", True)
        self.assertFalse(noop.needs_release)
        self.assertEqual(forced.version, "0.2.5-paseito.2")

    def test_rejects_nonstable_tag(self) -> None:
        with self.assertRaises(ValueError):
            decide_release("release/v1", "v0.2.5", "0.2.5-paseito.1", False)


if __name__ == "__main__":
    unittest.main()
