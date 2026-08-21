import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMRAutomationStore, DEFAULT_MR_AUTOMATION_STATE } from "./automation-store.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paseito-mr-automations-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("MR automation store", () => {
  it("writes owner-only JSON and serializes concurrent saves", async () => {
    const directory = await temporaryDirectory();
    const store = createMRAutomationStore(directory);
    const first = { ...structuredClone(DEFAULT_MR_AUTOMATION_STATE), transitions: { first: 1 } };
    const second = {
      ...structuredClone(DEFAULT_MR_AUTOMATION_STATE),
      transitions: { second: 2 },
      completedRuns: { "rule:outcome:10:7": true as const },
    };

    await Promise.all([store.save(first), store.save(second)]);

    const filePath = path.join(directory, "mr-automations.json");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      version: 1,
      transitions: { second: 2 },
      completedRuns: { "rule:outcome:10:7": true },
    });
    await expect(store.load()).resolves.toMatchObject({ transitions: { second: 2 } });
  });

  it("synthesizes stable condition IDs when loading an older version-one rule", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      path.join(directory, "mr-automations.json"),
      JSON.stringify({
        ...DEFAULT_MR_AUTOMATION_STATE,
        rules: [
          {
            schemaVersion: 1,
            id: "older-rule",
            revision: 1,
            name: "Older rule",
            enabled: true,
            scope: "owned",
            condition: {
              kind: "all",
              children: [
                {
                  kind: "predicate",
                  contributionId: "gitlab.mr.approved",
                  config: {},
                },
              ],
            },
            outcomes: [
              {
                id: "comment",
                presentation: "automatic",
                executionPolicy: "once_per_merge_request",
                operationId: "gitlab.note.create",
                config: { body: "RUN" },
              },
            ],
            createdAt: "2026-08-27T00:00:00.000Z",
            updatedAt: "2026-08-27T00:00:00.000Z",
          },
        ],
      }),
    );

    const state = await createMRAutomationStore(directory).load();

    expect(state.rules[0]?.condition.id).toBe("condition");
    const condition = state.rules[0]?.condition;
    expect(condition?.kind === "all" ? condition.children[0]?.id : null).toBe("condition.0");
    expect(state.rules[0]?.outcomes[0]?.executionPolicy).toBe("once_per_merge_request");
  });

  it("drops structurally invalid rules instead of loading executable partial data", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      path.join(directory, "mr-automations.json"),
      JSON.stringify({
        ...DEFAULT_MR_AUTOMATION_STATE,
        rules: [{ schemaVersion: 1, id: "partial", enabled: true }],
      }),
    );

    await expect(createMRAutomationStore(directory).load()).resolves.toMatchObject({ rules: [] });
  });
});
