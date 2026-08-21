import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMRTrackerStore, createMRTrackerTokenStore } from "./store.js";
import { DEFAULT_MR_TRACKER_PERSISTED_STATE, DEFAULT_MR_TRACKER_SETTINGS } from "./types.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("MR tracker persistence", () => {
  it("collapses legacy Later and Ignore values into the binary ignored state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseito-mr-tracker-"));
    temporaryDirectories.push(directory);
    await writeFile(
      path.join(directory, "mr-tracker.json"),
      JSON.stringify({
        version: 1,
        settings: {},
        state: {
          importance: { later: "pending", ignored: "not_important" },
          snapshots: [
            {
              id: "later",
              projectId: 1,
              iid: 1,
              title: "Legacy Later",
              webUrl: "https://gitlab.example.com/group/project/-/merge_requests/1",
              importance: "pending",
            },
            {
              id: "ignored",
              projectId: 1,
              iid: 2,
              title: "Legacy Ignore",
              webUrl: "https://gitlab.example.com/group/project/-/merge_requests/2",
              importance: "not_important",
            },
          ],
        },
      }),
      "utf8",
    );

    const data = await createMRTrackerStore(directory).load();

    expect(data.state.importance).toEqual({ later: "ignored", ignored: "ignored" });
    expect(data.state.snapshots.map((snapshot) => snapshot.importance)).toEqual([
      "ignored",
      "ignored",
    ]);
    expect(data.settings.activityUsers).toEqual([]);
    expect(data.state.snapshots.map((snapshot) => snapshot.discussions.activity)).toEqual([[], []]);
  });

  it("persists selected activity accounts by stable GitLab identity", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseito-mr-tracker-"));
    temporaryDirectories.push(directory);
    const store = createMRTrackerStore(directory);
    const greptile = {
      id: 80,
      username: "group_bot",
      name: "Greptile",
      webUrl: "https://gitlab.example.com/group_bot",
      avatarUrl: null,
    };

    await store.save({
      settings: {
        ...DEFAULT_MR_TRACKER_SETTINGS,
        gitLabBaseUrl: "https://gitlab.example.com",
        activityUsers: [greptile],
      },
      state: { ...DEFAULT_MR_TRACKER_PERSISTED_STATE },
    });

    expect((await createMRTrackerStore(directory).load()).settings.activityUsers).toEqual([
      greptile,
    ]);
  });

  it("keeps the token out of JSON in an owner-only local file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseito-mr-tracker-"));
    temporaryDirectories.push(directory);
    const store = createMRTrackerStore(directory);
    await store.save({
      settings: { ...DEFAULT_MR_TRACKER_SETTINGS, gitLabBaseUrl: "https://gitlab.example.com" },
      state: { ...DEFAULT_MR_TRACKER_PERSISTED_STATE },
    });
    await createMRTrackerTokenStore(directory).set("glpat-secret-token");

    expect(await readFile(path.join(directory, "mr-tracker.json"), "utf8")).not.toContain(
      "glpat-secret-token",
    );
    const tokenPath = path.join(directory, "mr-tracker-token");
    expect(await readFile(tokenPath, "utf8")).toBe("glpat-secret-token");
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    expect(await createMRTrackerTokenStore(directory).get()).toBe("glpat-secret-token");
  });
});
