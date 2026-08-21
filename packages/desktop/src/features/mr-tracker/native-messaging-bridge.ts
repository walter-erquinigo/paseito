import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { MRTrackerService } from "./service.js";
import type { DesktopMRPluginManager } from "./desktop-plugins.js";

export const MR_NATIVE_HOST_NAME = "dev.werquinigo.paseito.mr";
export const MR_NATIVE_SOCKET_FILENAME = "mr-native-bridge.sock";
export const MR_NATIVE_PROTOCOL_VERSION = 1;

export type MRNativeBridgeRequest =
  | { id: string; type: "evaluate"; url: string }
  | {
      id: string;
      type: "execute";
      url: string;
      mergeRequestId: string;
      ruleId: string;
      outcomeId: string;
    }
  | { id: string; type: "plugin_list" }
  | { id: string; type: "plugin_install"; directory: string; pluginId?: string }
  | {
      id: string;
      type: "plugin_reload" | "plugin_enable" | "plugin_disable" | "plugin_remove" | "plugin_logs";
      pluginId: string;
    };

export type MRNativeBridgeResponse =
  | { protocolVersion: 1; id: string; ok: true; result: unknown }
  | { protocolVersion: 1; id: string; ok: false; error: string };

type PluginBridgeRequest = Exclude<
  MRNativeBridgeRequest,
  { type: "evaluate" } | { type: "execute" }
>;

function isPluginRequest(request: MRNativeBridgeRequest): request is PluginBridgeRequest {
  return request.type.startsWith("plugin_");
}

async function handlePluginRequest(
  request: PluginBridgeRequest,
  plugins: DesktopMRPluginManager | undefined,
): Promise<MRNativeBridgeResponse> {
  if (!plugins) throw new Error("Desktop plugin management is unavailable.");
  if (request.type === "plugin_list") {
    return { protocolVersion: 1, id: request.id, ok: true, result: await plugins.list() };
  }
  if (request.type === "plugin_install") {
    return {
      id: request.id,
      protocolVersion: 1,
      ok: true,
      result: await plugins.install(request.directory, request.pluginId),
    };
  }
  if (request.type === "plugin_logs") {
    return {
      protocolVersion: 1,
      id: request.id,
      ok: true,
      result: await plugins.logs(request.pluginId),
    };
  }
  if (request.type === "plugin_remove") {
    await plugins.remove(request.pluginId);
    return { protocolVersion: 1, id: request.id, ok: true, result: null };
  }
  const action = request.type.slice("plugin_".length) as "reload" | "enable" | "disable";
  return {
    protocolVersion: 1,
    id: request.id,
    ok: true,
    result: await plugins[action](request.pluginId),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRequest(value: unknown): MRNativeBridgeRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid native bridge request.");
  }
  const input = value as Record<string, unknown>;
  if (input.protocolVersion !== undefined && input.protocolVersion !== MR_NATIVE_PROTOCOL_VERSION) {
    throw new Error("Unsupported native bridge protocol version.");
  }
  if (typeof input.id !== "string") {
    throw new Error("Invalid native bridge request.");
  }
  if (input.type === "evaluate" && typeof input.url === "string") {
    return { id: input.id, type: "evaluate", url: input.url };
  }
  if (
    input.type === "execute" &&
    typeof input.url === "string" &&
    typeof input.mergeRequestId === "string" &&
    typeof input.ruleId === "string" &&
    typeof input.outcomeId === "string"
  ) {
    return {
      id: input.id,
      type: "execute",
      url: input.url,
      mergeRequestId: input.mergeRequestId,
      ruleId: input.ruleId,
      outcomeId: input.outcomeId,
    };
  }
  if (input.type === "plugin_list") return { id: input.id, type: "plugin_list" };
  if (input.type === "plugin_install" && typeof input.directory === "string") {
    return {
      id: input.id,
      type: "plugin_install",
      directory: input.directory,
      pluginId: typeof input.pluginId === "string" ? input.pluginId : undefined,
    };
  }
  if (
    ["plugin_reload", "plugin_enable", "plugin_disable", "plugin_remove", "plugin_logs"].includes(
      String(input.type),
    ) &&
    typeof input.pluginId === "string"
  ) {
    return {
      id: input.id,
      type: input.type as
        | "plugin_reload"
        | "plugin_enable"
        | "plugin_disable"
        | "plugin_remove"
        | "plugin_logs",
      pluginId: input.pluginId,
    };
  }
  throw new Error("Unsupported native bridge request.");
}

export async function handleMRNativeBridgeRequest(
  service: MRTrackerService,
  value: unknown,
  plugins?: DesktopMRPluginManager,
): Promise<MRNativeBridgeResponse> {
  let request: MRNativeBridgeRequest;
  try {
    request = parseRequest(value);
  } catch (error) {
    return { protocolVersion: 1, id: "", ok: false, error: message(error) };
  }
  try {
    if (isPluginRequest(request)) return await handlePluginRequest(request, plugins);
    if (request.type === "evaluate") {
      const result = await service.resolveAutomationForUrl(request.url);
      return {
        protocolVersion: 1,
        id: request.id,
        ok: true,
        result,
      };
    }
    const resolved = await service.resolveAutomationForUrl(request.url, { refresh: true });
    if (resolved.mergeRequestId !== request.mergeRequestId) {
      throw new Error("The merge request changed before the action ran.");
    }
    const action = resolved.actions.find(
      (candidate) =>
        candidate.ruleId === request.ruleId && candidate.outcomeId === request.outcomeId,
    );
    if (!action || action.kind !== "button") {
      throw new Error("This automation action is no longer available.");
    }
    const state = await service.executeAutomationAction(
      request.mergeRequestId,
      request.ruleId,
      request.outcomeId,
    );
    return {
      id: request.id,
      protocolVersion: 1,
      ok: true,
      result: {
        mergeRequestId: request.mergeRequestId,
        actions: state.automation.actionsByMergeRequestId[request.mergeRequestId] ?? [],
      },
    };
  } catch (error) {
    return { protocolVersion: 1, id: request.id, ok: false, error: message(error) };
  }
}

export async function startMRNativeBridge(input: {
  userDataPath: string;
  service: MRTrackerService;
  plugins?: DesktopMRPluginManager;
}): Promise<() => Promise<void>> {
  const socketPath = path.join(input.userDataPath, MR_NATIVE_SOCKET_FILENAME);
  await mkdir(input.userDataPath, { recursive: true });
  await rm(socketPath, { force: true });
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        void Promise.resolve()
          .then(() => handleMRNativeBridgeRequest(input.service, JSON.parse(line), input.plugins))
          .then((response) => socket.write(`${JSON.stringify(response)}\n`))
          .catch((error) =>
            socket.write(
              `${JSON.stringify({ protocolVersion: 1, id: "", ok: false, error: message(error) })}\n`,
            ),
          );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600);
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(socketPath, { force: true });
  };
}

export async function registerChromeNativeHost(input: {
  homeDirectory: string;
  hostExecutablePath: string;
  extensionId: string;
}): Promise<string> {
  const directory = path.join(
    input.homeDirectory,
    "Library/Application Support/Google/Chrome/NativeMessagingHosts",
  );
  const manifestPath = path.join(directory, `${MR_NATIVE_HOST_NAME}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: MR_NATIVE_HOST_NAME,
        description: "Paseito GitLab MR automation bridge",
        path: input.hostExecutablePath,
        type: "stdio",
        allowed_origins: [`chrome-extension://${input.extensionId}/`],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await chmod(manifestPath, 0o600);
  return manifestPath;
}
