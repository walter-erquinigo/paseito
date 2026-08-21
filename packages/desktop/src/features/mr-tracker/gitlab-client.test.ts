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
});
