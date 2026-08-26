import { describe, expect, it, vi } from "vitest";
import { GitLabReadOnlyClient } from "./gitlab-client.js";

describe("GitLabReadOnlyClient", () => {
  it("uses only GET requests and sends the configured private-token header", async () => {
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 7, username: "octavia", name: "Octavia" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new GitLabReadOnlyClient({
      baseUrl: "https://gitlab.example.com",
      token: "secret",
      tokenType: "private-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(await client.currentUser()).toMatchObject({ id: 7, username: "octavia" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { "Private-Token": "secret" },
    });
  });

  it("follows GitLab pagination and requires an exact username match", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      return new Response(
        JSON.stringify(
          page === "1" ? [{ id: 1, username: "someone-else" }] : [{ id: 2, username: "octavia" }],
        ),
        {
          status: 200,
          headers: { "content-type": "application/json", "x-next-page": page === "1" ? "2" : "" },
        },
      );
    });
    const client = new GitLabReadOnlyClient({
      baseUrl: "https://gitlab.example.com",
      token: "secret",
      tokenType: "bearer",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(await client.exactUser("octavia")).toMatchObject({ id: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("searches every user page and keeps colliding display names distinct", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      expect(url.searchParams.get("search")).toBe("Greptile");
      expect(url.searchParams.get("active")).toBe("true");
      return new Response(
        JSON.stringify(
          page === "1"
            ? [{ id: 70, username: "project_bot", name: "Greptile" }]
            : [{ id: 80, username: "group_bot", name: "Greptile" }],
        ),
        {
          status: 200,
          headers: { "content-type": "application/json", "x-next-page": page === "1" ? "2" : "" },
        },
      );
    });
    const client = new GitLabReadOnlyClient({
      baseUrl: "https://gitlab.example.com",
      token: "secret",
      tokenType: "private-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(await client.searchUsers("Greptile")).toEqual([
      {
        id: 80,
        username: "group_bot",
        name: "Greptile",
        webUrl: null,
        avatarUrl: null,
      },
      {
        id: 70,
        username: "project_bot",
        name: "Greptile",
        webUrl: null,
        avatarUrl: null,
      },
    ]);
  });

  it("counts non-system activity and only unresolved resolvable notes", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              notes: [
                {
                  author: { id: 80, username: "group_bot", name: "Greptile" },
                  system: false,
                  resolvable: false,
                  resolved: null,
                },
              ],
            },
            {
              notes: [
                {
                  author: { id: 80, username: "group_bot", name: "Greptile" },
                  system: false,
                  resolvable: true,
                  resolved: false,
                },
                {
                  author: { id: 80, username: "group_bot", name: "Greptile" },
                  system: true,
                  resolvable: false,
                  resolved: null,
                },
              ],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const client = new GitLabReadOnlyClient({
      baseUrl: "https://gitlab.example.com",
      token: "secret",
      tokenType: "private-token",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const greptile = {
      id: 80,
      username: "group_bot",
      name: "Greptile",
      webUrl: null,
      avatarUrl: null,
    };

    expect(await client.discussions(10, 42, { alwaysShowUsers: [greptile] })).toEqual({
      resolvableCount: 1,
      unresolvedCount: 1,
      activity: [{ user: greptile, noteCount: 2, unresolvedCount: 1 }],
      error: null,
    });
  });

  it("keeps configured users visible and discovers other commenters except the MR author", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              notes: [
                {
                  author: { id: 91, username: "aman", name: "Aman" },
                  system: false,
                  resolvable: false,
                  resolved: null,
                },
                {
                  author: { id: 92, username: "zoe", name: "Zoe" },
                  system: false,
                  resolvable: true,
                  resolved: false,
                },
                {
                  author: { id: 7, username: "owner", name: "Owner" },
                  system: false,
                  resolvable: false,
                  resolved: null,
                },
                {
                  author: { id: 93, username: "system_bot", name: "System bot" },
                  system: true,
                  resolvable: false,
                  resolved: null,
                },
              ],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const client = new GitLabReadOnlyClient({
      baseUrl: "https://gitlab.example.com",
      token: "secret",
      tokenType: "private-token",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const greptile = {
      id: 80,
      username: "group_bot",
      name: "Greptile",
      webUrl: null,
      avatarUrl: null,
    };
    const silentBot = {
      id: 81,
      username: "silent_bot",
      name: "Silent bot",
      webUrl: null,
      avatarUrl: null,
    };

    const result = await client.discussions(10, 42, {
      alwaysShowUsers: [greptile, greptile, silentBot],
      discoverAuthors: true,
      excludedUserIds: [7],
    });

    expect(result.activity).toEqual([
      { user: greptile, noteCount: 0, unresolvedCount: 0 },
      { user: silentBot, noteCount: 0, unresolvedCount: 0 },
      {
        user: { id: 91, username: "aman", name: "Aman", webUrl: null, avatarUrl: null },
        noteCount: 1,
        unresolvedCount: 0,
      },
      {
        user: { id: 92, username: "zoe", name: "Zoe", webUrl: null, avatarUrl: null },
        noteCount: 1,
        unresolvedCount: 1,
      },
    ]);
  });
});
