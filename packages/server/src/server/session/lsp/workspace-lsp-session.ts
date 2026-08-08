import * as path from "node:path";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import type {
  SessionOutboundMessage,
  WorkspaceLspRequest,
  WorkspaceLspResult,
} from "@getpaseo/protocol/messages";
import { resolveExplorerFilePath } from "../../file-explorer/service.js";
import { ensureLensBroker, LensBrokerClient } from "./lens-broker-client.js";

export interface WorkspaceLspSessionHost {
  emit(message: SessionOutboundMessage): void;
}

export class WorkspaceLspSession {
  private readonly clients = new Map<string, LensBrokerClient>();

  constructor(private readonly host: WorkspaceLspSessionHost) {}

  async handleRequest(request: WorkspaceLspRequest): Promise<void> {
    try {
      const workspace = path.resolve(request.cwd);
      const file = await resolveExplorerFilePath({
        root: workspace,
        relativePath: request.path,
      });
      const client = await this.clientForWorkspace(workspace);
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

  private async clientForWorkspace(workspace: string): Promise<LensBrokerClient> {
    let client = this.clients.get(workspace);
    if (!client) {
      client = new LensBrokerClient(workspace);
      this.clients.set(workspace, client);
    }
    try {
      await client.request({
        method: "broker.ping",
        params: {},
        timeoutMs: 800,
      });
    } catch {
      client.close();
      await ensureLensBroker(workspace);
    }
    return client;
  }

  private async forward(
    client: LensBrokerClient,
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
        return { kind: "ack" };
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
            timeoutMs: 3_000,
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
          timeoutMs: 5_000,
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
