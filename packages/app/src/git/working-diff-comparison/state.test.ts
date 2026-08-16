import { describe, expect, it } from "vitest";
import {
  expireWorkingDiffComparisonsInState,
  resolveWorkingDiffComparisonFromState,
  selectWorkingDiffComparisonInState,
  type WorkingDiffComparisonState,
  workingDiffComparisonKey,
} from "./state";

const checkout = { serverId: "server-1", workspaceId: "workspace-1", cwd: "/repo" };
const noCommittedChanges = { hasCommittedChanges: false };

function emptyState(): WorkingDiffComparisonState {
  return { overrides: {} };
}

describe("working diff comparison", () => {
  it("scopes selection to the workspace checkout rather than a panel", () => {
    expect(workingDiffComparisonKey(checkout)).toBe(
      "working-diff:server=server-1:workspace=workspace-1",
    );
    expect(workingDiffComparisonKey({ ...checkout, workspaceId: "workspace-2" })).not.toBe(
      workingDiffComparisonKey(checkout),
    );
    expect(workingDiffComparisonKey({ ...checkout, workspaceId: null, cwd: "/repo/" })).toBe(
      "working-diff:server=server-1:cwd=%2Frepo",
    );
  });

  it("defaults from checkout dirtiness and honors a matching manual selection", () => {
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), {
        ...checkout,
        ...noCommittedChanges,
        isDirty: true,
      }),
    ).toBe("uncommitted");
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), {
        ...checkout,
        ...noCommittedChanges,
        isDirty: false,
      }),
    ).toBe("base");

    const selected = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "base",
      isDirty: true,
    });
    expect(
      resolveWorkingDiffComparisonFromState(selected, {
        ...checkout,
        ...noCommittedChanges,
        isDirty: true,
      }),
    ).toBe("base");
  });

  it("defaults ahead branches to their committed diff while keeping Uncommitted selectable", () => {
    const input = { ...checkout, isDirty: true, hasCommittedChanges: true };
    expect(resolveWorkingDiffComparisonFromState(emptyState(), input)).toBe("base");

    const selected = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "uncommitted",
      isDirty: true,
    });
    expect(resolveWorkingDiffComparisonFromState(selected, input)).toBe("uncommitted");
  });

  it("masks and expires stale selections for every workspace on the checkout", () => {
    let state = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "base",
      isDirty: true,
    });
    state = selectWorkingDiffComparisonInState(state, {
      ...checkout,
      workspaceId: "workspace-2",
      comparison: "uncommitted",
      isDirty: false,
    });
    state = selectWorkingDiffComparisonInState(state, {
      serverId: "server-2",
      workspaceId: "workspace-3",
      cwd: "/other",
      comparison: "base",
      isDirty: true,
    });

    expect(
      resolveWorkingDiffComparisonFromState(state, {
        ...checkout,
        ...noCommittedChanges,
        isDirty: false,
      }),
    ).toBe("base");
    const expired = expireWorkingDiffComparisonsInState(state, {
      serverId: checkout.serverId,
      cwd: checkout.cwd,
      isDirty: false,
    });
    expect(expired.overrides[workingDiffComparisonKey(checkout)]).toBeUndefined();
    expect(
      expired.overrides[workingDiffComparisonKey({ ...checkout, workspaceId: "workspace-2" })],
    ).toBeDefined();
    expect(
      expired.overrides[
        workingDiffComparisonKey({
          serverId: "server-2",
          workspaceId: "workspace-3",
          cwd: "/other",
        })
      ],
    ).toBeDefined();
  });

  it("keeps state identity when nothing expires", () => {
    const state = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "base",
      isDirty: true,
    });
    expect(
      expireWorkingDiffComparisonsInState(state, {
        serverId: checkout.serverId,
        cwd: checkout.cwd,
        isDirty: true,
      }),
    ).toBe(state);
  });
});
