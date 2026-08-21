import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleMRNativeBridgeRequest,
  registerChromeNativeHost,
} from "./native-messaging-bridge.js";
import type { MRTrackerService } from "./service.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("MR native messaging bridge", () => {
  it("reevaluates an action before executing it", async () => {
    const resolveAutomationForUrl = vi.fn(async () => ({
      mergeRequestId: "10:7",
      actions: [
        {
          id: "rule:1:run",
          ruleId: "rule",
          outcomeId: "run",
          label: "Run CI",
          kind: "button" as const,
          requireConfirmation: true,
          href: null,
        },
      ],
    }));
    const executeAutomationAction = vi.fn(async () => ({
      automation: { actionsByMergeRequestId: { "10:7": [] } },
    }));
    const service = {
      resolveAutomationForUrl,
      executeAutomationAction,
    } as unknown as MRTrackerService;

    await expect(
      handleMRNativeBridgeRequest(service, {
        id: "request-1",
        type: "execute",
        url: "https://gitlab.example.com/g/p/-/merge_requests/7",
        mergeRequestId: "10:7",
        ruleId: "rule",
        outcomeId: "run",
      }),
    ).resolves.toEqual({
      protocolVersion: 1,
      id: "request-1",
      ok: true,
      result: { mergeRequestId: "10:7", actions: [] },
    });
    expect(resolveAutomationForUrl).toHaveBeenCalledWith(
      "https://gitlab.example.com/g/p/-/merge_requests/7",
      { refresh: true },
    );
    expect(executeAutomationAction).toHaveBeenCalledWith("10:7", "rule", "run");
  });

  it("returns Chrome actions without a desktop-visibility suppression flag", async () => {
    const service = {
      resolveAutomationForUrl: vi.fn(async () => ({
        mergeRequestId: "10:7",
        actions: [{ id: "action" }],
      })),
    } as unknown as MRTrackerService;

    await expect(
      handleMRNativeBridgeRequest(service, {
        protocolVersion: 1,
        id: "request-2",
        type: "evaluate",
        url: "https://gitlab.example.com/g/p/-/merge_requests/7",
      }),
    ).resolves.toEqual({
      protocolVersion: 1,
      id: "request-2",
      ok: true,
      result: { mergeRequestId: "10:7", actions: [{ id: "action" }] },
    });
  });

  it("writes an owner-only Chrome host manifest with one exact extension origin", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "paseito-native-host-"));
    temporaryDirectories.push(homeDirectory);
    const manifestPath = await registerChromeNativeHost({
      homeDirectory,
      hostExecutablePath: "/Applications/Paseito.app/Contents/Resources/bin/paseito-native-host",
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
    });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.allowed_origins).toEqual([
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
    ]);
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
  });
});
