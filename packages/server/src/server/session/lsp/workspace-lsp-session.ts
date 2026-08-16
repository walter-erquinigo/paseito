import * as path from "node:path";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import type {
  SessionOutboundMessage,
  WorkspaceLspRequest,
  WorkspaceLspResult,
} from "@getpaseo/protocol/messages";
import { resolveExplorerFilePath } from "../../file-explorer/service.js";
import {
  type WorkspaceLspBackendFactory,
  type WorkspaceLspClient,
  workspaceLspBackendFactory,
} from "./backend.js";
import { isClangdDocument } from "./clangd-client.js";

const INTERACTIVE_REQUEST_TIMEOUT_MS = 15_000;

export interface WorkspaceLspSessionHost {
  emit(message: SessionOutboundMessage): void;
}

export interface WorkspaceLspSessionLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
}

export class WorkspaceLspSession {
  private readonly clients = new Map<string, WorkspaceLspClient>();

  constructor(
    private readonly host: WorkspaceLspSessionHost,
    private readonly backendFactory: WorkspaceLspBackendFactory = workspaceLspBackendFactory,
    private readonly logger?: WorkspaceLspSessionLogger,
  ) {}

  async handleRequest(request: WorkspaceLspRequest): Promise<void> {
    try {
      const workspace = path.resolve(request.cwd);
      const file = await resolveExplorerFilePath({
        root: workspace,
        relativePath: request.path,
      });
      const client = await this.clientForWorkspace(workspace, file);
      const result = await this.forward(client, file, request);
      this.host.emit({
        type: "workspace.lsp.response",
        payload: {
          documentVersion: request.documentVersion,
          result,
          error: null,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.logger?.warn(
        {
          err: error,
          workspace: path.resolve(request.cwd),
          path: request.path,
          operation: request.operation.kind,
        },
        "workspace_lsp_request_failed",
      );
      this.host.emit({
        type: "workspace.lsp.response",
        payload: {
          documentVersion: request.documentVersion,
          result: null,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  dispose(): void {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }

  private async clientForWorkspace(workspace: string, file: string): Promise<WorkspaceLspClient> {
    const languageFamily = isClangdDocument(file) ? "clangd" : "other";
    const clientKey = `${workspace}\0${languageFamily}`;
    let client = this.clients.get(clientKey);
    if (!client) {
      client = await this.backendFactory.connect(workspace, file);
      this.clients.set(clientKey, client);
      this.logger?.info(
        { workspace, provider: client.provider, ...client.diagnosticContext },
        "workspace_lsp_backend_selected",
      );
    }
    return client;
  }

  private async forward(
    client: WorkspaceLspClient,
    file: string,
    request: WorkspaceLspRequest,
  ): Promise<WorkspaceLspResult> {
    const common = { file, documentVersion: request.documentVersion };
    switch (request.operation.kind) {
      case "open":
        await client.request({
          method: "document.open",
          params: { ...common, content: request.operation.content },
          timeoutMs: 20_000,
        });
        return { kind: "ack", provider: client.provider };
      case "change":
        await client.request({
          method: "document.change",
          params: { ...common, content: request.operation.content },
          timeoutMs: 5_000,
        });
        return { kind: "ack" };
      case "close":
        await client.request({
          method: "document.close",
          params: common,
          timeoutMs: 2_000,
        });
        return { kind: "ack" };
      case "diagnostics": {
        const items = await client.request<
          Extract<WorkspaceLspResult, { kind: "diagnostics" }>["items"]
        >({
          method: "textDocument.diagnostics",
          params: common,
          timeoutMs: 2_000,
        });
        return { kind: "diagnostics", items };
      }
      case "completion": {
        const result = await client.request<{
          isIncomplete: boolean;
          items: Extract<WorkspaceLspResult, { kind: "completion" }>["items"];
        }>({
          method: "textDocument.completion",
          params: { ...common, ...request.operation.position },
          timeoutMs: 3_000,
        });
        return { kind: "completion", ...result };
      }
      case "hover": {
        const hover = await client.request<Extract<WorkspaceLspResult, { kind: "hover" }>["hover"]>(
          {
            method: "textDocument.hover",
            params: { ...common, ...request.operation.position },
            timeoutMs: INTERACTIVE_REQUEST_TIMEOUT_MS,
          },
        );
        return { kind: "hover", hover };
      }
      case "definition": {
        const locations = await client.request<
          Extract<WorkspaceLspResult, { kind: "definition" }>["locations"]
        >({
          method: "textDocument.definition",
          params: { ...common, ...request.operation.position },
          timeoutMs: INTERACTIVE_REQUEST_TIMEOUT_MS,
        });
        return { kind: "definition", locations };
      }
      case "formatting": {
        const edits = await client.request<
          Extract<WorkspaceLspResult, { kind: "formatting" }>["edits"]
        >({
          method: "textDocument.formatting",
          params: { ...common, options: request.operation.options },
          timeoutMs: 1_500,
        });
        return { kind: "formatting", edits };
      }
    }
  }
}
