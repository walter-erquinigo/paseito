import { originPattern, registrationId } from "./gitlab-url.js";

const STORAGE_KEY = "enabledOrigins";

async function readOrigins() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY])
    ? stored[STORAGE_KEY].filter((value) => typeof value === "string")
    : [];
}

async function writeOrigins(origins) {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...new Set(origins)].sort() });
}

async function removeRegistration(origin) {
  const id = registrationId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
}

async function registerOrigin(origin) {
  const id = registrationId(origin);
  await removeRegistration(origin);
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: [originPattern(origin)],
      js: ["content-script.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

async function reconcile() {
  const origins = await readOrigins();
  const retained = [];
  for (const origin of origins) {
    if (await chrome.permissions.contains({ origins: [originPattern(origin)] })) {
      await registerOrigin(origin);
      retained.push(origin);
    } else {
      await removeRegistration(origin);
    }
  }
  await writeOrigins(retained);
}

chrome.runtime.onInstalled.addListener(() => void reconcile());
chrome.runtime.onStartup.addListener(() => void reconcile());
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "configure-origin" || typeof message.origin !== "string") return;
  void (async () => {
    const origins = await readOrigins();
    if (message.enabled) {
      await registerOrigin(message.origin);
      await writeOrigins([...origins, message.origin]);
    } else {
      await removeRegistration(message.origin);
      await writeOrigins(origins.filter((origin) => origin !== message.origin));
    }
    sendResponse({ ok: true });
  })().catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
