import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(packageRoot, "dist");
const profile = await mkdtemp(path.join(os.tmpdir(), "paseito-chrome-extension-"));
const pageScreenshot = path.join(os.tmpdir(), "paseito-chrome-extension-mr.png");
const popupScreenshot = path.join(os.tmpdir(), "paseito-chrome-extension-popup.png");

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.route("https://gitlab.example.com/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8"><style>
        body { margin: 0; background: #f8f8fa; color: #282634; font-family: -apple-system, sans-serif; }
        header { height: 56px; background: #29243b; color: white; display: flex; align-items: center; padding: 0 28px; font-weight: 650; }
        main { max-width: 980px; margin: 46px auto; padding: 0 28px; }
        .eyebrow { color: #706b7b; font-size: 13px; } h1 { font-size: 26px; }
        .card { margin-top: 28px; padding: 24px; border: 1px solid #ddd9e5; border-radius: 10px; background: white; }
      </style></head><body><header>GitLab</header><main><p class="eyebrow">example / project · Merge request !42</p><h1>Refine constellation rendering</h1><div class="card">Merge request overview</div></main></body></html>`,
    });
  });
  await page.goto("https://gitlab.example.com/group/project/-/merge_requests/42");
  await page.evaluate(() => {
    globalThis.__paseitoVisualResponse = {
      ok: true,
      result: {
        suppressChrome: true,
        mergeRequestId: "example/project!42",
        actions: [
          {
            kind: "button",
            label: "Run verification",
            ruleId: "verify",
            outcomeId: "run",
            requireConfirmation: true,
          },
          {
            kind: "link",
            label: "Open pipeline",
            href: "https://gitlab.example.com/example/project/-/pipelines/99",
          },
        ],
      },
    };
    globalThis.__paseitoVisualDelayMs = 2_750;
    Object.defineProperty(globalThis.chrome, "runtime", {
      configurable: true,
      value: {
        sendMessage: async () => {
          await new Promise((resolve) => setTimeout(resolve, globalThis.__paseitoVisualDelayMs));
          return globalThis.__paseitoVisualResponse;
        },
      },
    });
  });
  await page.addScriptTag({ path: path.join(extensionPath, "content-script.js") });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 342, height: 440 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByText("Open a GitLab merge request").waitFor();
  await popup.screenshot({ path: popupScreenshot });

  await page.waitForFunction(() => document.querySelector("#paseito-mr-bridge-root")?.shadowRoot);
  const bridge = page.locator("#paseito-mr-bridge-root");
  await page.waitForFunction(() => {
    const text = document.querySelector("#paseito-mr-bridge-root")?.shadowRoot?.textContent ?? "";
    return text.includes("Run verification") && text.includes("Open pipeline");
  });
  const bridgeText = await bridge.evaluate((root) => root.shadowRoot?.textContent ?? "");
  if (
    !bridgeText.includes("Open in Paseito") ||
    !bridgeText.includes("MR !42") ||
    !bridgeText.includes("Run verification") ||
    !bridgeText.includes("Open pipeline")
  ) {
    throw new Error(`Unexpected injected control: ${bridgeText}`);
  }
  const href = await bridge.evaluate(
    (root) => root.shadowRoot?.querySelector("a")?.getAttribute("href") ?? "",
  );
  if (
    href !==
    "paseito://mrs/open?url=https%3A%2F%2Fgitlab.example.com%2Fgroup%2Fproject%2F-%2Fmerge_requests%2F42"
  ) {
    throw new Error(`Unexpected Paseito link: ${href}`);
  }
  await bridge.evaluate((root) => root.shadowRoot?.querySelector("a")?.focus());
  await page.screenshot({ path: pageScreenshot });

  await page.evaluate(() => {
    globalThis.__paseitoVisualDelayMs = 0;
    globalThis.__paseitoVisualResponse = {
      ok: false,
      unavailable: false,
      error: "Only open merge requests can be tracked.",
    };
  });
  await page.evaluate(() => {
    history.pushState({}, "", "/group/project/-/issues/42");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForFunction(() => !document.querySelector("#paseito-mr-bridge-root"));
  await page.evaluate(() => {
    history.pushState({}, "", "/group/project/-/merge_requests/77");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#paseito-mr-bridge-root")?.shadowRoot?.querySelector("small")
        ?.textContent === "MR !77",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#paseito-mr-bridge-root")?.shadowRoot?.querySelector(".status")
        ?.textContent === "Only open merge requests can be tracked.",
  );

  console.log(JSON.stringify({ extensionId, popupScreenshot, pageScreenshot }, null, 2));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
