import type { DesktopCommandHandler } from "../../settings/desktop-settings-commands.js";
import type { DesktopMRPluginManager } from "./desktop-plugins.js";

function requiredString(args: Record<string, unknown> | undefined, name: string): string {
  const value = args?.[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function createDesktopMRPluginCommandHandlers({
  manager,
}: {
  manager: DesktopMRPluginManager;
}): Record<string, DesktopCommandHandler> {
  return {
    desktop_mr_plugin_list: () => manager.list(),
    desktop_mr_plugin_logs: (args) => manager.logs(requiredString(args, "id")),
    desktop_mr_plugin_install: (args) =>
      manager.install(
        requiredString(args, "directory"),
        typeof args?.id === "string" && args.id.trim() ? args.id.trim() : undefined,
      ),
    desktop_mr_plugin_reload: (args) => manager.reload(requiredString(args, "id")),
    desktop_mr_plugin_enable: (args) => manager.enable(requiredString(args, "id")),
    desktop_mr_plugin_disable: (args) => manager.disable(requiredString(args, "id")),
    desktop_mr_plugin_remove: async (args) => {
      await manager.remove(requiredString(args, "id"));
      return null;
    },
  };
}
