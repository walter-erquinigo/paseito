import { Command } from "commander";
import type { PluginListItem, PluginLogEntry } from "@getpaseo/protocol/messages";
import type { CommandOptions, ListResult, OutputSchema, SingleResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";
import { scaffoldPluginDirectory, type PluginScaffold } from "./scaffold.js";
import { withPluginLogsClient, withPluginManagementClient } from "./shared.js";
import { desktopPlugins } from "./desktop.js";

interface PluginOptions extends CommandOptions {
  host?: string;
  id?: string;
  scope?: "daemon" | "desktop";
}

function desktopScope(options: PluginOptions): boolean {
  if (!options.scope || options.scope === "daemon") return false;
  if (options.scope === "desktop") return true;
  throw new Error(`Unsupported plugin scope: ${String(options.scope)}`);
}

function addScopeOption(command: Command): Command {
  return command.option("--scope <scope>", "Plugin host scope: daemon or desktop", "daemon");
}

const pluginSchema: OutputSchema<PluginListItem> = {
  idField: "id",
  columns: [
    { header: "PLUGIN", field: "id", width: 20 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "ENABLED", field: (plugin) => (plugin.enabled ? "yes" : "no"), width: 8 },
    { header: "DIRECTORY", field: "path", width: 40 },
    { header: "ERROR", field: (plugin) => plugin.error ?? "", width: 40 },
  ],
};

const scaffoldSchema: OutputSchema<PluginScaffold> = {
  idField: "id",
  columns: [
    { header: "PLUGIN", field: "id", width: 20 },
    { header: "DIRECTORY", field: "directory", width: 60 },
  ],
};

const pluginLogsSchema: OutputSchema<PluginLogEntry> = {
  idField: (entry) => String(entry.sequence),
  columns: [
    { header: "TIME", field: "timestamp", width: 24 },
    { header: "STREAM", field: "stream", width: 8 },
    { header: "MESSAGE", field: "message", width: 80 },
  ],
};

export async function runPluginInitCommand(
  directory: string,
  options: PluginOptions,
  _command: Command,
): Promise<SingleResult<PluginScaffold>> {
  return {
    type: "single",
    data: await scaffoldPluginDirectory(directory, options.id),
    schema: scaffoldSchema,
  };
}

export async function runPluginListCommand(
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginListItem>> {
  const data = desktopScope(options)
    ? await desktopPlugins.list()
    : await withPluginManagementClient(options.host, (client) => client.listPlugins());
  return { type: "list", data, schema: pluginSchema };
}

export async function runPluginLogsCommand(
  pluginId: string,
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginLogEntry>> {
  const data = desktopScope(options)
    ? await desktopPlugins.logs(pluginId)
    : await withPluginLogsClient(options.host, (client) => client.getPluginLogs(pluginId));
  return { type: "list", data, schema: pluginLogsSchema };
}

async function install(
  directory: string,
  options: PluginOptions,
  _command: Command,
): Promise<SingleResult<PluginListItem>> {
  const data = desktopScope(options)
    ? await desktopPlugins.install(directory, options.id)
    : await withPluginManagementClient(options.host, (client) =>
        client.installDirectoryPlugin(directory, options.id),
      );
  return { type: "single", data, schema: pluginSchema };
}

async function act(
  action: "reload" | "enable" | "disable",
  pluginId: string,
  options: PluginOptions,
): Promise<SingleResult<PluginListItem>> {
  const data = desktopScope(options)
    ? await desktopPlugins[action](pluginId)
    : await withPluginManagementClient(options.host, (client) =>
        client[`${action}Plugin`](pluginId),
      );
  return { type: "single", data, schema: pluginSchema };
}

async function remove(
  pluginId: string,
  options: PluginOptions,
  _command: Command,
): Promise<SingleResult<PluginListItem>> {
  if (desktopScope(options)) {
    const current = (await desktopPlugins.list()).find((plugin) => plugin.id === pluginId);
    if (!current) throw new Error(`Plugin is not configured: ${pluginId}`);
    await desktopPlugins.remove(pluginId);
    return {
      type: "single",
      data: { ...current, enabled: false, status: "disabled" as const },
      schema: pluginSchema,
    };
  }
  const data = await withPluginManagementClient(options.host, async (client) => {
    const current = (await client.listPlugins()).find((plugin) => plugin.id === pluginId);
    if (!current) throw new Error(`Plugin is not configured: ${pluginId}`);
    await client.removePlugin(pluginId);
    return { ...current, enabled: false, status: "disabled" as const };
  });
  return { type: "single", data, schema: pluginSchema };
}

export function createPluginCommand(): Command {
  const plugin = new Command("plugin").description("Manage trusted local plugins");
  addJsonOption(
    plugin
      .command("init")
      .description("Create a typecheckable local plugin")
      .argument("<directory>")
      .option("--id <id>", "Manifest plugin ID (defaults to the directory name)"),
  ).action(withOutput(runPluginInitCommand));
  addJsonAndDaemonHostOptions(
    addScopeOption(plugin.command("ls").description("List configured plugins")),
  ).action(withOutput(runPluginListCommand));
  addJsonAndDaemonHostOptions(
    addScopeOption(
      plugin.command("logs").description("Show recent plugin output").argument("<id>"),
    ),
  ).action(withOutput(runPluginLogsCommand));
  addJsonAndDaemonHostOptions(
    addScopeOption(
      plugin
        .command("install")
        .description("Install a local plugin directory")
        .argument("<directory>", "Host filesystem directory")
        .option("--id <id>", "Runtime plugin ID (defaults to paseo-plugin.json id)"),
    ),
  ).action(withOutput(install));
  for (const action of ["reload", "enable", "disable"] as const) {
    addJsonAndDaemonHostOptions(
      addScopeOption(
        plugin.command(action).description(`${action} a local plugin`).argument("<id>"),
      ),
    ).action(
      withOutput((id: string, options: PluginOptions, _command: Command) =>
        act(action, id, options),
      ),
    );
  }
  addJsonAndDaemonHostOptions(
    addScopeOption(
      plugin.command("remove").description("Remove plugin configuration").argument("<id>"),
    ),
  ).action(withOutput(remove));
  return plugin;
}
