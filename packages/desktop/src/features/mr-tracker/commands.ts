import type { DesktopCommandHandler } from "../../settings/desktop-settings-commands.js";
import type { MRTrackerService } from "./service.js";

function requiredString(args: Record<string, unknown> | undefined, name: string): string {
  const value = args?.[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function createMRTrackerCommandHandlers({
  service,
}: {
  service: MRTrackerService;
}): Record<string, DesktopCommandHandler> {
  return {
    get_mr_tracker_state: () => service.getState(),
    refresh_mr_tracker: () => service.refresh(),
    search_mr_tracker_users: (args) => service.searchUsers(args ?? {}),
    save_mr_tracker_settings: (args) => service.saveSettings(args ?? {}),
    clear_mr_tracker_token: () => service.clearToken(),
    add_tracked_mr: (args) => service.addTracked(requiredString(args, "prompt")),
    remove_tracked_mr: (args) => service.removeTracked(requiredString(args, "id")),
    set_mr_importance: (args) => {
      const id = requiredString(args, "id");
      const value = requiredString(args, "importance");
      if (value !== "important" && value !== "ignored") {
        throw new Error("Unsupported importance value.");
      }
      return service.setImportance(id, value);
    },
  };
}
