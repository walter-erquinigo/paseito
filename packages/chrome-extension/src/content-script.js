(() => {
  const ROOT_ID = "paseito-mr-bridge-root";
  const NATIVE_RESPONSE_TIMEOUT_MS = 120_000;

  function parseMR(input) {
    let url;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const match = url.pathname.match(/^\/(.+)\/-\/merge_requests\/([1-9]\d*)\/?$/);
    if (!match?.[1] || !match[2]) return null;
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return { url: url.toString(), iid: Number.parseInt(match[2], 10) };
  }

  function removeRoot() {
    document.getElementById(ROOT_ID)?.remove();
  }

  function createRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.all = "initial";
    document.documentElement.append(root);
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .rail {
          position: fixed; right: 0; top: 50%; z-index: 2147483647;
          display: flex; flex-direction: column; min-width: 154px;
          border: 1px solid rgba(255,255,255,.16); border-right: 0;
          border-radius: 12px 0 0 12px; overflow: hidden;
          background: linear-gradient(145deg, #29263c, #171624);
          box-shadow: 0 10px 32px rgba(0,0,0,.34);
          color: #f7f5ff; font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          transform: translateY(-50%) translateX(4px);
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        .rail:hover, .rail:focus-within { transform: translateY(-50%); box-shadow: 0 12px 38px rgba(0,0,0,.42); }
        a, button {
          all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
          min-height: 38px; padding: 8px 11px; cursor: pointer; color: #f7f5ff;
        }
        a:hover, button:hover, a:focus-visible, button:focus-visible { background: rgba(255,255,255,.08); outline: none; }
        .open { min-height: 48px; }
        .action { border-top: 1px solid rgba(255,255,255,.10); }
        .action svg { margin-left: auto; }
        svg { flex: 0 0 auto; color: #a98cff; }
        span { display: flex; flex-direction: column; gap: 2px; white-space: nowrap; }
        small { color: #aaa5bd; font: 500 10px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .status { max-width: 180px; padding: 7px 11px; border-top: 1px solid rgba(255,255,255,.10); color: #c9c4d8; font: 500 10px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .error { color: #ff9c9c; }
        button:disabled { cursor: default; opacity: .62; }
        @media (prefers-reduced-motion: reduce) { .rail { transition: none; } }
      </style>
      <div class="rail" role="region" aria-label="Paseito merge request actions">
        <a class="open" aria-label="Open this merge request in Paseito">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 15V9a3 3 0 0 0-3-3H9"/>
          </svg>
          <span>Open in Paseito<small></small></span>
        </a>
        <div class="actions"></div>
      </div>`;
    return root;
  }

  function externalIcon() {
    const wrapper = document.createElement("span");
    wrapper.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;
    return wrapper.firstElementChild;
  }

  function safeExternalLink(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function renderStatus(root, text, error = false) {
    root.shadowRoot.querySelector(".status")?.remove();
    if (!text) return;
    const status = document.createElement("div");
    status.className = `status${error ? " error" : ""}`;
    status.textContent = text;
    root.shadowRoot.querySelector(".rail").append(status);
  }

  function renderActions(root, mr, payload) {
    const container = root.shadowRoot.querySelector(".actions");
    container.replaceChildren();
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    for (const action of actions) {
      if (!action || typeof action.label !== "string") continue;
      if (
        action.kind === "link" &&
        typeof action.href === "string" &&
        safeExternalLink(action.href)
      ) {
        const link = document.createElement("a");
        link.className = "action";
        link.href = action.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = action.label;
        link.append(externalIcon());
        container.append(link);
        continue;
      }
      if (action.kind !== "button") continue;
      const button = document.createElement("button");
      button.className = "action";
      button.textContent = action.label;
      button.addEventListener("click", async () => {
        if (action.requireConfirmation && !confirm(`Run “${action.label}” on this merge request?`))
          return;
        button.disabled = true;
        const previous = button.textContent;
        button.textContent = "Running…";
        const response = await sendRuntimeMessage({
          type: "execute-automation",
          url: mr.url,
          mergeRequestId: payload.mergeRequestId,
          ruleId: action.ruleId,
          outcomeId: action.outcomeId,
        });
        if (response?.ok) {
          renderStatus(root, "");
          renderActions(root, mr, response.result);
        } else {
          button.disabled = false;
          button.textContent = previous;
          renderStatus(root, response?.error || "Unable to run this action.", true);
        }
      });
      container.append(button);
    }
  }

  async function sendRuntimeMessage(message, timeoutMs = NATIVE_RESPONSE_TIMEOUT_MS) {
    return await Promise.race([
      chrome.runtime.sendMessage(message).catch((error) => ({
        ok: false,
        unavailable: true,
        error: String(error),
      })),
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: false, unavailable: true, error: "Paseito is unavailable." }),
          timeoutMs,
        ),
      ),
    ]);
  }

  async function render() {
    const mr = parseMR(location.href);
    if (!mr) {
      removeRoot();
      return;
    }
    const root = createRoot();
    const link = root.shadowRoot.querySelector(".open");
    link.href = `paseito://mrs/open?url=${encodeURIComponent(mr.url)}`;
    link.querySelector("small").textContent = `MR !${mr.iid}`;
    renderStatus(root, "Loading actions…");
    const response = await sendRuntimeMessage({ type: "evaluate-automation", url: mr.url });
    if (location.href.split(/[?#]/, 1)[0]?.replace(/\/$/, "") !== mr.url) return;
    if (response?.ok) {
      renderStatus(root, "");
      renderActions(root, mr, response.result);
    } else {
      renderActions(root, mr, null);
      const error =
        typeof response?.error === "string" && response.error.trim()
          ? response.error.trim()
          : "Paseito is unavailable.";
      renderStatus(root, error, true);
    }
  }

  let lastUrl = "";
  const update = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void render();
  };
  update();
  addEventListener("popstate", update);
  addEventListener("hashchange", update);
  new MutationObserver(update).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
