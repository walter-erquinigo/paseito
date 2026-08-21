import { describe, expect, it } from "vitest";
import { MRNavigationInbox, parseMRDeepLinkFromArgv } from "./mr-navigation.js";

describe("MR navigation", () => {
  it("finds an MR deep link in Chromium argv", () => {
    expect(
      parseMRDeepLinkFromArgv([
        "/Applications/Paseito.app/Contents/MacOS/Paseito",
        "--flag",
        "paseito://mrs/open?url=https%3A%2F%2Fgitlab.example.com%2Fg%2Fp%2F-%2Fmerge_requests%2F12",
      ]),
    ).toEqual({ url: "https://gitlab.example.com/g/p/-/merge_requests/12" });
  });

  it("queues the latest focus until the renderer is ready", () => {
    const inbox = new MRNavigationInbox();
    expect(
      inbox.deliverOrQueue(3, { mergeRequestId: "1:1", tab: "my_mrs", revision: 1 }),
    ).toBeNull();
    expect(
      inbox.deliverOrQueue(3, { mergeRequestId: "1:2", tab: "others", revision: 2 }),
    ).toBeNull();
    expect(inbox.windowReady(3)).toEqual({ mergeRequestId: "1:2", tab: "others", revision: 2 });
    expect(inbox.deliverOrQueue(3, { mergeRequestId: "1:3", tab: "my_mrs", revision: 3 })).toEqual({
      mergeRequestId: "1:3",
      tab: "my_mrs",
      revision: 3,
    });
  });
});
