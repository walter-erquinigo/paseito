import { describe, expect, it } from "vitest";
import {
  buildMRDeepLink,
  normalizeGitLabMergeRequestUrl,
  parseMRDeepLink,
} from "./mr-deep-link.js";

describe("MR deep links", () => {
  it("builds and parses a canonical GitLab MR URL", () => {
    const deepLink = buildMRDeepLink({
      url: "https://gitlab.example.com/group/project/-/merge_requests/42/?tab=notes#note_1",
    });

    expect(deepLink).toBe(
      "paseito://mrs/open?url=https%3A%2F%2Fgitlab.example.com%2Fgroup%2Fproject%2F-%2Fmerge_requests%2F42",
    );
    expect(parseMRDeepLink(deepLink)).toEqual({
      url: "https://gitlab.example.com/group/project/-/merge_requests/42",
    });
  });

  it("supports nested namespaces and self-hosted HTTPS ports", () => {
    expect(
      normalizeGitLabMergeRequestUrl(
        "https://gitlab.example.com:8443/org/group/project/-/merge_requests/7",
      ),
    ).toBe("https://gitlab.example.com:8443/org/group/project/-/merge_requests/7");
  });

  it.each([
    "http://gitlab.example.com/group/project/-/merge_requests/42",
    "https://user:secret@gitlab.example.com/group/project/-/merge_requests/42",
    "https://gitlab.example.com/group/project/-/issues/42",
    "https://gitlab.example.com/group/project/-/merge_requests/0",
  ])("rejects unsafe or non-MR target %s", (url) => {
    expect(normalizeGitLabMergeRequestUrl(url)).toBeNull();
  });

  it.each([
    "paseito://mrs/open",
    "paseito://mrs/open?url=x&url=y",
    "paseito://mrs/open?url=https%3A%2F%2Fgitlab.example.com%2Fg%2Fp%2F-%2Fmerge_requests%2F1&extra=1",
    "paseito://mrs/other?url=https%3A%2F%2Fgitlab.example.com%2Fg%2Fp%2F-%2Fmerge_requests%2F1",
  ])("rejects malformed deep link %s", (deepLink) => {
    expect(parseMRDeepLink(deepLink)).toBeNull();
  });
});
