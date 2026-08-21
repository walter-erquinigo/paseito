import { beforeEach, describe, expect, it, vi } from "vitest";

const listPlugins = vi.fn(async () => []);
const getPluginLogs = vi.fn(async () => [
  {
    sequence: 1,
    timestamp: "2026-08-16T12:00:00.000Z",
    stream: "stdout" as const,
    message: "ready",
  },
]);
const close = vi.fn(async () => undefined);
const features: { pluginManagement?: boolean; pluginLogs?: boolean } = {};
const { listDesktopPlugins } = vi.hoisted(() => ({
  listDesktopPlugins: vi.fn(async () => [
    {
      id: "desktop-example",
      path: "/tmp/desktop-example",
      enabled: true,
      status: "running" as const,
      error: null,
    },
  ]),
}));

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    getLastServerInfoMessage: () => ({ features }),
    listPlugins,
    getPluginLogs,
    close,
  })),
}));

vi.mock("./desktop.js", () => ({
  desktopPlugins: {
    list: listDesktopPlugins,
  },
}));

import { render } from "../../output/index.js";
import { runPluginListCommand, runPluginLogsCommand } from "./index.js";

describe("plugin management commands", () => {
  beforeEach(() => {
    features.pluginManagement = false;
    features.pluginLogs = false;
    vi.clearAllMocks();
  });

  it("requires host support before attempting a management RPC", async () => {
    await expect(runPluginListCommand({}, {} as never)).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to use plugin management.",
    });
    expect(listPlugins).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses the desktop-local bridge without checking daemon features", async () => {
    const result = await runPluginListCommand({ scope: "desktop" }, {} as never);
    expect(listDesktopPlugins).toHaveBeenCalledTimes(1);
    expect(listPlugins).not.toHaveBeenCalled();
    expect(render(result, { noColor: true })).toContain("desktop-example");
  });

  it("requires plugin log support before attempting the RPC", async () => {
    await expect(runPluginLogsCommand("example", {}, {} as never)).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to view plugin logs.",
    });
    expect(getPluginLogs).not.toHaveBeenCalled();
  });

  it("returns readable and JSON plugin log output", async () => {
    features.pluginLogs = true;
    const result = await runPluginLogsCommand("example", {}, {} as never);

    expect(getPluginLogs).toHaveBeenCalledWith("example");
    expect(render(result, { noColor: true })).toContain("ready");
    expect(JSON.parse(render(result, { format: "json" }))).toEqual([
      {
        sequence: 1,
        timestamp: "2026-08-16T12:00:00.000Z",
        stream: "stdout",
        message: "ready",
      },
    ]);
  });
});
