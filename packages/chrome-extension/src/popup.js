import { originPattern, parseGitLabMergeRequestUrl } from "./gitlab-url.js";

const STORAGE_KEY = "enabledOrigins";
const current = document.querySelector("#current");
const originsContainer = document.querySelector("#origins");
const status = document.querySelector("#status");

async function readOrigins() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function configure(origin, enabled, tabId) {
  if (enabled) {
    const granted = await chrome.permissions.request({ origins: [originPattern(origin)] });
    if (!granted) return false;
  }
  const response = await chrome.runtime.sendMessage({ type: "configure-origin", origin, enabled });
  if (!response?.ok) throw new Error(response?.error || "Unable to update this host.");
  if (!enabled) await chrome.permissions.remove({ origins: [originPattern(origin)] });
  if (enabled && typeof tabId === "number") {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
  }
  return true;
}

async function renderOrigins() {
  const origins = await readOrigins();
  originsContainer.replaceChildren();
  if (!origins.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No hosts enabled yet";
    originsContainer.append(empty);
    return origins;
  }
  for (const origin of origins) {
    const row = document.createElement("div");
    row.className = "origin";
    const label = document.createElement("span");
    label.textContent = origin;
    const remove = document.createElement("button");
    remove.className = "secondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await configure(origin, false);
        status.textContent = `Removed ${origin}`;
        await renderOrigins();
      } catch (error) {
        status.textContent = String(error);
        remove.disabled = false;
      }
    });
    row.append(label, remove);
    originsContainer.append(row);
  }
  return origins;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const mr = parseGitLabMergeRequestUrl(tab?.url ?? "");
  const origins = await renderOrigins();
  if (!mr) {
    current.innerHTML =
      "<strong>Open a GitLab merge request</strong><p>This control appears only on an HTTPS GitLab MR page.</p>";
    return;
  }

  const title = document.createElement("strong");
  title.textContent = `MR !${mr.iid} · ${mr.projectPath}`;
  const detail = document.createElement("p");
  detail.textContent = mr.origin;
  const button = document.createElement("button");
  const enabled = origins.includes(mr.origin);
  button.className = enabled ? "secondary" : "";
  button.textContent = enabled ? "Disable on this host" : "Enable on this host";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const changed = await configure(mr.origin, !enabled, tab?.id);
      if (!changed) {
        status.textContent = "Chrome did not grant access to this host";
        button.disabled = false;
        return;
      }
      status.textContent = enabled ? "Host disabled" : "Paseito tab added to this MR";
      await init();
    } catch (error) {
      status.textContent = String(error);
      button.disabled = false;
    }
  });
  current.replaceChildren(title, detail, button);
}

void init().catch((error) => {
  status.textContent = String(error);
});
