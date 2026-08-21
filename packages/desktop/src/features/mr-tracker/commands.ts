import type { DesktopCommandHandler } from "../../settings/desktop-settings-commands.js";
import type { MRTrackerService } from "./service.js";
import { z } from "zod";
import type { MRAutomationCondition, MRAutomationRule } from "./automation-types.js";

const ConditionSchema: z.ZodType<MRAutomationCondition> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string().optional(),
      kind: z.enum(["all", "any"]),
      children: z.array(ConditionSchema),
    }),
    z.object({ id: z.string().optional(), kind: z.literal("not"), child: ConditionSchema }),
    z.object({
      id: z.string().optional(),
      kind: z.literal("predicate"),
      contributionId: z.string().min(1),
      config: z.record(z.string(), z.unknown()),
    }),
  ]),
);

const RuleSchema: z.ZodType<MRAutomationRule> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  name: z.string().min(1),
  enabled: z.boolean(),
  scope: z.literal("owned"),
  condition: ConditionSchema,
  outcomes: z.array(
    z.object({
      id: z.string().min(1),
      presentation: z.enum(["automatic", "button", "link"]),
      label: z.string().optional(),
      requireConfirmation: z.boolean().optional(),
      operationId: z.string().min(1),
      config: z.record(z.string(), z.unknown()),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function parseRule(value: unknown) {
  return RuleSchema.parse(value);
}

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
    replace_mr_automation_rules: (args) => {
      const rules = z.array(RuleSchema).parse(args?.rules);
      return service.replaceAutomationRules(rules);
    },
    preview_mr_automation_rule: (args) => service.previewAutomationRule(parseRule(args?.rule)),
    execute_mr_automation_action: (args) =>
      service.executeAutomationAction(
        requiredString(args, "mergeRequestId"),
        requiredString(args, "ruleId"),
        requiredString(args, "outcomeId"),
      ),
  };
}
