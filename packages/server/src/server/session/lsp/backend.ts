import * as path from "node:path";
import { acquireClangdClient, isClangdDocument } from "./clangd-client.js";
import { LensBrokerClient, LensBrokerError } from "./lens-broker-client.js";

export interface WorkspaceLspClient {
  request<T>(input: {
    method: string;
    params: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<T>;
  close(): void;
}

export interface WorkspaceLspBackendFactory {
  connect(workspace: string, file: string): Promise<WorkspaceLspClient>;
}

export const workspaceLspBackendFactory: WorkspaceLspBackendFactory = {
  async connect(workspace, file) {
    const resolvedWorkspace = path.resolve(workspace);
    const lens = new LensBrokerClient(resolvedWorkspace);
    try {
      await lens.request({ method: "broker.ping", params: {}, timeoutMs: 800 });
      return lens;
    } catch {
      lens.close();
    }

    if (!isClangdDocument(file)) {
      throw new LensBrokerError(
        "language-server-unavailable",
        "Lens is not publishing an LSP server and no standalone server is available for this file",
      );
    }
    return acquireClangdClient(resolvedWorkspace);
  },
};
