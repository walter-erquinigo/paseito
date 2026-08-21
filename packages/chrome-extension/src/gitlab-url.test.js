import { describe, expect, it } from "vitest";
import {
  buildPaseitoMRLink,
  originPattern,
  parseGitLabMergeRequestUrl,
  registrationId,
} from "./gitlab-url.js";

describe("GitLab MR URLs", () => {
  it("canonicalizes an MR page and builds the Paseito link", () => {
    const input = "https://gitlab.example.com/org/project/-/merge_requests/31/?tab=notes#note_1";
    expect(parseGitLabMergeRequestUrl(input)).toEqual({
      url: "https://gitlab.example.com/org/project/-/merge_requests/31",
      origin: "https://gitlab.example.com",
      projectPath: "org/project",
      iid: 31,
    });
    expect(buildPaseitoMRLink(input)).toBe(
      "paseito://mrs/open?url=https%3A%2F%2Fgitlab.example.com%2Forg%2Fproject%2F-%2Fmerge_requests%2F31",
    );
  });

  it.each([
    "http://gitlab.example.com/org/project/-/merge_requests/31",
    "https://gitlab.example.com/org/project/-/issues/31",
    "https://gitlab.example.com/org/project/-/merge_requests/0",
  ])("rejects %s", (input) => expect(parseGitLabMergeRequestUrl(input)).toBeNull());

  it("builds stable, origin-scoped registration data", () => {
    expect(originPattern("https://gitlab-master.nvidia.com")).toBe(
      "https://gitlab-master.nvidia.com/*",
    );
    expect(registrationId("https://gitlab-master.nvidia.com")).toBe(
      registrationId("https://gitlab-master.nvidia.com"),
    );
  });
});
