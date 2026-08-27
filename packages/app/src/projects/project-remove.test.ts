import { describe, expect, it } from "vitest";
import {
  getProjectRemoveReadiness,
  removeProjectFromHosts,
  type ProjectRemoveProject,
} from "./project-remove";

const project: ProjectRemoveProject = {
  hosts: [
    { serverId: "host-a", projectId: "prj_host_a" },
    { serverId: "host-b", projectId: "prj_host_b" },
  ],
};

function createProjectRemoveClient() {
  const removedProjectKeys: string[] = [];
  const removedWorktreeProjectKeys: string[] = [];
  return {
    removedProjectKeys,
    removedWorktreeProjectKeys,
    client: {
      async removeProject(projectKey: string): Promise<{ removedWorkspaceIds: string[] }> {
        removedProjectKeys.push(projectKey);
        return { removedWorkspaceIds: [] };
      },
      async removeProjectWorktree(projectKey: string): Promise<{ removedWorkspaceIds: string[] }> {
        removedWorktreeProjectKeys.push(projectKey);
        return { removedWorkspaceIds: [] };
      },
    },
  };
}

describe("project remove policy", () => {
  it("requires every host to support project removal", () => {
    const readiness = getProjectRemoveReadiness({
      project,
      supportsProjectRemove: (serverId) => serverId === "host-a",
    });

    expect(readiness).toEqual({
      kind: "needs_host_update",
      serverIds: ["host-b"],
    });
  });

  it("removes the project from every participating host", async () => {
    const hostA = createProjectRemoveClient();
    const hostB = createProjectRemoveClient();
    const readiness = getProjectRemoveReadiness({
      project,
      supportsProjectRemove: () => true,
    });

    expect(readiness).toEqual({
      kind: "ready",
      targets: [
        { serverId: "host-a", projectId: "prj_host_a", removeWorktree: false },
        { serverId: "host-b", projectId: "prj_host_b", removeWorktree: false },
      ],
    });

    const outcome = await removeProjectFromHosts({
      targets: readiness.kind === "ready" ? readiness.targets : [],
      getClient: (serverId) => {
        if (serverId === "host-a") return hostA.client;
        if (serverId === "host-b") return hostB.client;
        return null;
      },
    });

    expect(outcome).toEqual({ kind: "removed", serverIds: ["host-a", "host-b"] });
    expect(hostA.removedProjectKeys).toEqual(["prj_host_a"]);
    expect(hostB.removedProjectKeys).toEqual(["prj_host_b"]);
  });

  it("reports disconnected hosts before sending any remove request", async () => {
    const hostA = createProjectRemoveClient();

    const outcome = await removeProjectFromHosts({
      targets: [
        { serverId: "host-a", projectId: "prj_host_a", removeWorktree: false },
        { serverId: "host-b", projectId: "prj_host_b", removeWorktree: false },
      ],
      getClient: (serverId) => (serverId === "host-a" ? hostA.client : null),
    });

    expect(outcome).toEqual({ kind: "host_disconnected", serverIds: ["host-b"] });
    expect(hostA.removedProjectKeys).toEqual([]);
  });

  it("uses the destructive worktree RPC only when every grouped placement is managed", async () => {
    const managedProject: ProjectRemoveProject = {
      hosts: project.hosts.map((host) => ({
        serverId: host.serverId,
        projectId: host.projectId,
        managedWorktree: true,
      })),
    };
    const readiness = getProjectRemoveReadiness({
      project: managedProject,
      supportsProjectRemove: () => true,
      supportsProjectWorktreeManagement: () => true,
    });
    expect(readiness).toEqual({
      kind: "ready",
      targets: [
        { serverId: "host-a", projectId: "prj_host_a", removeWorktree: true },
        { serverId: "host-b", projectId: "prj_host_b", removeWorktree: true },
      ],
    });
    const hostA = createProjectRemoveClient();
    const hostB = createProjectRemoveClient();
    await removeProjectFromHosts({
      targets: readiness.kind === "ready" ? readiness.targets : [],
      getClient: (serverId) => (serverId === "host-a" ? hostA.client : hostB.client),
    });
    expect(hostA.removedWorktreeProjectKeys).toEqual(["prj_host_a"]);
    expect(hostB.removedWorktreeProjectKeys).toEqual(["prj_host_b"]);
    expect(hostA.removedProjectKeys).toEqual([]);
  });
});
