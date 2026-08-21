import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileDesktopPlugin } from "@getpaseo/server";
import type {
  DesktopPluginProcessMessage,
  DesktopPluginProcessRequest,
} from "./desktop-plugin-process-protocol.js";
import type {
  MRAutomationEvaluationContext,
  MRAutomationMatchState,
  MRAutomationOperationDescriptor,
  MRAutomationPredicateDescriptor,
} from "./automation-types.js";

export interface DesktopMRPluginListItem {
  id: string;
  path: string;
  enabled: boolean;
  status: "disabled" | "loading" | "running" | "failed";
  error: string | null;
}

export interface DesktopMRPluginLogEntry {
  sequence: number;
  timestamp: string;
  stream: "stdout" | "stderr";
  message: string;
}

interface DesktopPluginConfig {
  version: 1;
  plugins: Record<string, { path: string; enabled: boolean }>;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface Runtime {
  process: ChildProcess;
  item: DesktopMRPluginListItem;
  predicates: MRAutomationPredicateDescriptor[];
  operations: MRAutomationOperationDescriptor[];
  pending: Map<string, PendingRequest>;
  logs: DesktopMRPluginLogEntry[];
}

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;

export class DesktopMRPluginManager {
  private config: DesktopPluginConfig = { version: 1, plugins: {} };
  private runtimes = new Map<string, Runtime>();
  private failures = new Map<string, string>();
  private startPromise: Promise<void> | null = null;

  constructor(private readonly userDataPath: string) {}

  async start(): Promise<void> {
    this.startPromise ??= (async () => {
      this.config = await this.loadConfig();
      await Promise.all(
        Object.entries(this.config.plugins).map(async ([id, config]) => {
          if (config.enabled) await this.startPlugin(id, config.path).catch(() => undefined);
        }),
      );
    })();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async list(): Promise<DesktopMRPluginListItem[]> {
    await this.start();
    return Object.entries(this.config.plugins).map(([id, config]) =>
      structuredClone(
        this.runtimes.get(id)?.item ?? {
          id,
          path: config.path,
          enabled: config.enabled,
          status: config.enabled ? "failed" : "disabled",
          error: config.enabled ? (this.failures.get(id) ?? "Plugin is not running.") : null,
        },
      ),
    );
  }

  async install(directory: string, overrideId?: string): Promise<DesktopMRPluginListItem> {
    await this.start();
    const absolutePath = path.resolve(directory);
    const manifest = JSON.parse(
      await readFile(path.join(absolutePath, "paseo-plugin.json"), "utf8"),
    );
    const manifestId = typeof manifest.id === "string" ? manifest.id : "";
    const id = (overrideId?.trim() || manifestId).trim();
    if (!PLUGIN_ID.test(id)) throw new Error(`Invalid desktop plugin ID: ${id}`);
    this.config.plugins[id] = { path: absolutePath, enabled: true };
    await this.saveConfig();
    await this.stopPlugin(id);
    return await this.startPlugin(id, absolutePath);
  }

  async reload(id: string): Promise<DesktopMRPluginListItem> {
    await this.start();
    const config = this.requireConfig(id);
    await this.stopPlugin(id);
    return await this.startPlugin(id, config.path);
  }

  async enable(id: string): Promise<DesktopMRPluginListItem> {
    await this.start();
    const config = this.requireConfig(id);
    config.enabled = true;
    await this.saveConfig();
    await this.stopPlugin(id);
    return await this.startPlugin(id, config.path);
  }

  async disable(id: string): Promise<DesktopMRPluginListItem> {
    await this.start();
    const config = this.requireConfig(id);
    config.enabled = false;
    await this.saveConfig();
    await this.stopPlugin(id);
    this.failures.delete(id);
    return { id, path: config.path, enabled: false, status: "disabled", error: null };
  }

  async remove(id: string): Promise<void> {
    await this.start();
    this.requireConfig(id);
    await this.stopPlugin(id);
    this.failures.delete(id);
    delete this.config.plugins[id];
    await this.saveConfig();
  }

  async logs(id: string): Promise<DesktopMRPluginLogEntry[]> {
    await this.start();
    this.requireConfig(id);
    return [...(this.runtimes.get(id)?.logs ?? [])];
  }

  predicates(): MRAutomationPredicateDescriptor[] {
    return [...this.runtimes.entries()].flatMap(([pluginId, runtime]) =>
      runtime.predicates.map((descriptor) => ({
        ...descriptor,
        id: `${pluginId}.${descriptor.id}`,
      })),
    );
  }

  operations(): MRAutomationOperationDescriptor[] {
    return [...this.runtimes.entries()].flatMap(([pluginId, runtime]) =>
      runtime.operations.map((descriptor) => ({
        ...descriptor,
        id: `${pluginId}.${descriptor.id}`,
      })),
    );
  }

  async evaluate(
    id: string,
    config: Record<string, unknown>,
    context: MRAutomationEvaluationContext,
  ): Promise<MRAutomationMatchState> {
    const { runtime, contributionId } = this.resolveContribution(id, "predicate");
    const output = await this.invoke(runtime, {
      type: "evaluate",
      requestId: randomUUID(),
      contributionId,
      config,
      context,
    });
    if (!["match", "no_match", "unknown"].includes(String(output))) return "unknown";
    return output as MRAutomationMatchState;
  }

  async run(
    id: string,
    config: Record<string, unknown>,
    context: MRAutomationEvaluationContext,
  ): Promise<void | string> {
    const { runtime, contributionId } = this.resolveContribution(id, "operation");
    const output = await this.invoke(runtime, {
      type: "run",
      requestId: randomUUID(),
      contributionId,
      config,
      context,
    });
    if (output !== undefined && typeof output !== "string") {
      throw new Error("Desktop plugin operation returned an unsupported value.");
    }
    return output;
  }

  private async startPlugin(id: string, directory: string): Promise<DesktopMRPluginListItem> {
    const item: DesktopMRPluginListItem = {
      id,
      path: directory,
      enabled: true,
      status: "loading",
      error: null,
    };
    try {
      const bundle = await compileDesktopPlugin(path.join(directory, "index.ts"));
      const child = fork(path.join(__dirname, "desktop-plugin-process.js"), [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        serialization: "advanced",
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const runtime: Runtime = {
        process: child,
        item,
        predicates: [],
        operations: [],
        pending: new Map(),
        logs: [],
      };
      this.runtimes.set(id, runtime);
      const capture = (stream: DesktopMRPluginLogEntry["stream"], chunk: unknown) => {
        runtime.logs.push({
          sequence: (runtime.logs.at(-1)?.sequence ?? 0) + 1,
          timestamp: new Date().toISOString(),
          stream,
          message: String(chunk).trimEnd(),
        });
        runtime.logs = runtime.logs.slice(-500);
      };
      child.stdout?.on("data", (chunk) => capture("stdout", chunk));
      child.stderr?.on("data", (chunk) => capture("stderr", chunk));
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Desktop plugin startup timed out.")),
          10_000,
        );
        child.on("message", (message: DesktopPluginProcessMessage) => {
          if (message.type === "ready") {
            clearTimeout(timeout);
            runtime.predicates = message.predicates as MRAutomationPredicateDescriptor[];
            runtime.operations = message.operations as MRAutomationOperationDescriptor[];
            runtime.item.status = "running";
            resolve();
            return;
          }
          if (message.type === "fatal" && runtime.item.status === "loading") {
            clearTimeout(timeout);
            reject(new Error(message.error));
          }
          this.handleMessage(runtime, message);
        });
        child.once("exit", () => {
          clearTimeout(timeout);
          if (runtime.item.status === "loading") reject(new Error("Desktop plugin exited."));
          runtime.item.status = "failed";
          for (const pending of runtime.pending.values()) {
            pending.reject(new Error("Desktop plugin exited."));
          }
          runtime.pending.clear();
        });
        child.send({
          type: "initialize",
          pluginId: id,
          bundle,
        } satisfies DesktopPluginProcessRequest);
      });
      this.failures.delete(id);
      return structuredClone(runtime.item);
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : String(error);
      this.failures.set(id, item.error);
      const runtime = this.runtimes.get(id);
      if (runtime) {
        this.runtimes.delete(id);
        runtime.process.kill();
      }
      return structuredClone(item);
    }
  }

  private handleMessage(runtime: Runtime, message: DesktopPluginProcessMessage): void {
    if (message.type === "result" || message.type === "error") {
      const pending = runtime.pending.get(message.requestId);
      if (!pending) return;
      runtime.pending.delete(message.requestId);
      if (message.type === "result") pending.resolve(message.output);
      else pending.reject(new Error(message.error));
    } else if (message.type === "fatal") {
      runtime.item.status = "failed";
      runtime.item.error = message.error;
    }
  }

  private async invoke(
    runtime: Runtime,
    request: Extract<DesktopPluginProcessRequest, { requestId: string }>,
  ): Promise<unknown> {
    if (runtime.item.status !== "running") throw new Error("Desktop plugin is unavailable.");
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        runtime.pending.delete(request.requestId);
        reject(new Error("Desktop plugin request timed out."));
      }, 10_000);
      runtime.pending.set(request.requestId, {
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeout);
          reject(error);
        },
      });
      runtime.process.send(request, (error) => {
        if (!error) return;
        const pending = runtime.pending.get(request.requestId);
        runtime.pending.delete(request.requestId);
        pending?.reject(error);
      });
    });
  }

  private resolveContribution(id: string, kind: "predicate" | "operation") {
    for (const [pluginId, runtime] of this.runtimes) {
      const prefix = `${pluginId}.`;
      if (!id.startsWith(prefix)) continue;
      const contributionId = id.slice(prefix.length);
      const values = kind === "predicate" ? runtime.predicates : runtime.operations;
      if (!values.some((value) => value.id === contributionId)) break;
      return { runtime, contributionId };
    }
    throw new Error(`Desktop plugin ${kind} is unavailable: ${id}`);
  }

  private async stopPlugin(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    this.runtimes.delete(id);
    runtime.process.send({ type: "shutdown" } satisfies DesktopPluginProcessRequest);
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeout = setTimeout(() => {
        runtime.process.kill();
        finish();
      }, 2_000);
      runtime.process.once("exit", () => {
        clearTimeout(timeout);
        finish();
      });
    });
  }

  private requireConfig(id: string) {
    const config = this.config.plugins[id];
    if (!config) throw new Error(`Desktop plugin is not configured: ${id}`);
    return config;
  }

  private async loadConfig(): Promise<DesktopPluginConfig> {
    try {
      const value = JSON.parse(await readFile(this.configPath(), "utf8"));
      if (value?.version === 1 && value.plugins && typeof value.plugins === "object") {
        return {
          version: 1,
          plugins: Object.fromEntries(
            Object.entries(value.plugins).filter(
              (entry): entry is [string, { path: string; enabled: boolean }] =>
                PLUGIN_ID.test(entry[0]) &&
                typeof entry[1] === "object" &&
                entry[1] !== null &&
                typeof (entry[1] as { path?: unknown }).path === "string" &&
                typeof (entry[1] as { enabled?: unknown }).enabled === "boolean",
            ),
          ),
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { version: 1, plugins: {} };
  }

  private async saveConfig(): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true });
    const temporaryPath = `${this.configPath()}.tmp.${process.pid}.${randomUUID()}`;
    await writeFile(temporaryPath, `${JSON.stringify(this.config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.configPath());
    await chmod(this.configPath(), 0o600);
  }

  private configPath(): string {
    return path.join(this.userDataPath, "desktop-plugins.json");
  }
}
