import { describe, expect, it } from "vitest";
import { openMRTrackerSettingsForm } from "./settings-form-model";
import type { MRTrackerSettings } from "./types";

const settings: MRTrackerSettings = {
  gitLabBaseUrl: "https://gitlab.example.com",
  gitLabUsername: "octavia",
  authors: ["lin"],
  activityUsers: [],
  includeReviewerMergeRequests: true,
  tokenType: "private-token",
  refreshIntervalSeconds: 120,
};

describe("MR tracker settings form", () => {
  it("keeps selected GitLab identities distinct by numeric user id", () => {
    const model = openMRTrackerSettingsForm(settings);
    const first = {
      id: 70,
      username: "project_bot",
      name: "Greptile",
      webUrl: null,
      avatarUrl: null,
    };
    const second = { ...first, id: 80, username: "group_bot" };

    model.addActivityUser(first);
    model.addActivityUser(first);
    model.addActivityUser(second);
    expect(model.getState().activityUsers).toEqual([first, second]);

    model.removeActivityUser(first.id);
    expect(model.getState().activityUsers).toEqual([second]);
  });
});
