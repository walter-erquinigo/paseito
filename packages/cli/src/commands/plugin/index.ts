import { Command } from "commander";
import path from "node:path";
import type {
  PluginListItem,
  PluginLogEntry,
  PluginSourceStatusItem,
  PluginSourceUpdateItem,
} from "@getpaseo/protocol/messages";
import {
  formatPluginSourceReference,
  parsePluginSourceReference,
} from "@getpaseo/protocol/plugin-source-reference";
import type { CommandOptions, ListResult, OutputSchema, SingleResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";
import { scaffoldPluginDirectory, type PluginScaffold } from "./scaffold.js";
import {
  withPluginLogsClient,
  withPluginManagementClient,
  withPluginSourceClient,
} from "./shared.js";
import { desktopPlugins } from "./desktop.js";

interface PluginOptions extends CommandOptions {
  host?: string;
  id?: string;
  ref?: string;
  path?: string;
  all?: boolean;
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

function shortCommit(commit: string | undefined): string {
  return commit?.slice(0, 12) ?? "-";
}

const pluginStatusSchema: OutputSchema<PluginSourceStatusItem> = {
  idField: "id",
  columns: [
    { header: "PLUGIN", field: "id", width: 20 },
    { header: "SOURCE", field: "source", width: 10 },
    { header: "CURRENT", field: (plugin) => shortCommit(plugin.currentCommit), width: 14 },
    { header: "LATEST", field: (plugin) => shortCommit(plugin.latestCommit), width: 14 },
    { header: "COMMITS", field: (plugin) => String(plugin.commitsBehind ?? 0), width: 8 },
    { header: "REF", field: (plugin) => plugin.ref ?? "-", width: 24 },
  ],
};

const pluginUpdateSchema: OutputSchema<PluginSourceUpdateItem> = {
  idField: "id",
  columns: [
    { header: "PLUGIN", field: "id", width: 20 },
    { header: "PREVIOUS", field: (plugin) => shortCommit(plugin.previousCommit), width: 14 },
    { header: "CURRENT", field: (plugin) => shortCommit(plugin.currentCommit), width: 14 },
    { header: "COMMITS", field: (plugin) => String(plugin.commits), width: 8 },
    { header: "UPDATED", field: (plugin) => (plugin.updated ? "yes" : "no"), width: 8 },
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
  source: string,
  options: PluginOptions,
  _command: Command,
): Promise<SingleResult<PluginListItem>> {
  process.stderr.write(
    "Trusting plugin code: server code and Git build commands run unsandboxed on the daemon host; client code runs inside Paseo. Dependencies and future updates are part of the codebase you trust.\n",
  );
  const isExplicitPath =
    path.isAbsolute(source) ||
    source === "." ||
    source === ".." ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith(".\\") ||
    source.startsWith("..\\");
  const hasPluginPathSuffix = parsePluginSourceReference(source).pluginPath !== undefined;
  const canUseLegacyDirectoryInstall =
    isExplicitPath && !hasPluginPathSuffix && !options.ref && !options.path;
  const sourceReference = formatPluginSourceReference(source, options.path);
  let data: PluginListItem;
  if (desktopScope(options)) {
    data = await desktopPlugins.install(source, options.id);
  } else if (canUseLegacyDirectoryInstall) {
    data = await withPluginManagementClient(options.host, (client) =>
      client.installDirectoryPlugin(source, options.id),
    );
  } else {
    data = await withPluginSourceClient(options.host, (client) =>
      client.installPluginSource({
        source: sourceReference,
        ...(options.id ? { id: options.id } : {}),
        ...(options.ref ? { ref: options.ref } : {}),
      }),
    );
  }
  return { type: "single", data, schema: pluginSchema };
}

async function status(
  pluginId: string | undefined,
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginSourceStatusItem>> {
  const data = await withPluginSourceClient(options.host, (client) =>
    client.getPluginSourceStatus(pluginId),
  );
  return { type: "list", data, schema: pluginStatusSchema };
}

async function update(
  pluginId: string | undefined,
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginSourceUpdateItem>> {
  if ((pluginId === undefined) === (options.all !== true)) {
    throw new Error("Choose one plugin ID or pass --all");
  }
  const data = await withPluginSourceClient(options.host, (client) =>
    client.updatePluginSources(pluginId),
  );
  return { type: "list", data, schema: pluginUpdateSchema };
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
  const plugin = new Command("plugin").description("Manage trusted, unsandboxed plugins");
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
        .alias("add")
        .description("Trust and install a plugin from a directory or Git repository")
        .argument("<source>", "Host directory, Git source, or Git source:plugin/path")
        .option("--id <id>", "Runtime plugin ID (defaults to paseo-plugin.json id)")
        .option("--ref <ref>", "Git branch, tag, or commit")
        .option("--path <path>", "Legacy form of the :plugin/path source suffix"),
    ),
  ).action(withOutput(install));
  addJsonAndDaemonHostOptions(
    plugin.command("status").description("Check plugin source updates").argument("[id]"),
  ).action(withOutput(status));
  addJsonAndDaemonHostOptions(
    plugin
      .command("update")
      .description("Update a Git-managed plugin")
      .argument("[id]")
      .option("--all", "Update every Git-managed plugin"),
  ).action(withOutput(update));
  for (const action of ["reload", "enable", "disable"] as const) {
    addJsonAndDaemonHostOptions(
      addScopeOption(plugin.command(action).description(`${action} a plugin`).argument("<id>")),
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
