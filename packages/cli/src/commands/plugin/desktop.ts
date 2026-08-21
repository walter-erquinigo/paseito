import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { PluginListItem, PluginLogEntry } from "@getpaseo/protocol/messages";

const SOCKET_FILENAME = "mr-native-bridge.sock";

type DesktopPluginRequest =
  | { type: "plugin_list" }
  | { type: "plugin_install"; directory: string; pluginId?: string }
  | {
      type: "plugin_reload" | "plugin_enable" | "plugin_disable" | "plugin_remove" | "plugin_logs";
      pluginId: string;
    };

function socketPath(): string {
  return (
    process.env.PASEITO_MR_NATIVE_SOCKET ??
    path.join(os.homedir(), "Library/Application Support/Paseito", SOCKET_FILENAME)
  );
}

async function request<T>(input: DesktopPluginRequest): Promise<T> {
  const id = randomUUID();
  return await new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(socketPath());
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => socket.destroy(new Error("Desktop plugin request timed out.")));
    socket.once("error", (error) => {
      reject(
        error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("Paseito desktop is not running.")
          : error,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      const response = JSON.parse(buffer.slice(0, newline)) as {
        protocolVersion?: number;
        id: string;
        ok: boolean;
        result?: T;
        error?: string;
      };
      if (response.protocolVersion !== 1) {
        reject(new Error("Paseito desktop returned an unsupported protocol version."));
      } else if (response.id !== id) {
        reject(new Error("Paseito desktop returned a mismatched response."));
      } else if (!response.ok)
        reject(new Error(response.error || "Desktop plugin request failed."));
      else resolve(response.result as T);
    });
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ protocolVersion: 1, id, ...input })}\n`),
    );
  });
}

export const desktopPlugins = {
  list: () => request<PluginListItem[]>({ type: "plugin_list" }),
  logs: (pluginId: string) => request<PluginLogEntry[]>({ type: "plugin_logs", pluginId }),
  install: (directory: string, pluginId?: string) =>
    request<PluginListItem>({ type: "plugin_install", directory, pluginId }),
  reload: (pluginId: string) => request<PluginListItem>({ type: "plugin_reload", pluginId }),
  enable: (pluginId: string) => request<PluginListItem>({ type: "plugin_enable", pluginId }),
  disable: (pluginId: string) => request<PluginListItem>({ type: "plugin_disable", pluginId }),
  remove: (pluginId: string) => request<null>({ type: "plugin_remove", pluginId }),
};
