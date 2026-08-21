(() => {
  const ROOT_ID = "paseito-mr-bridge-root";

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

  function render() {
    const mr = parseMR(location.href);
    if (!mr) {
      removeRoot();
      return;
    }
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.style.all = "initial";
      document.documentElement.append(root);
      const shadow = root.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          a {
            position: fixed;
            right: 0;
            top: 50%;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 9px;
            min-height: 46px;
            padding: 8px 11px 8px 10px;
            border: 1px solid rgba(255,255,255,.16);
            border-right: 0;
            border-radius: 12px 0 0 12px;
            background: linear-gradient(145deg, #29263c, #171624);
            box-shadow: 0 10px 32px rgba(0,0,0,.34), inset 0 1px rgba(255,255,255,.08);
            color: #f7f5ff;
            font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            text-decoration: none;
            transform: translateY(-50%) translateX(4px);
            transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
          }
          a:hover, a:focus-visible {
            transform: translateY(-50%);
            border-color: rgba(152,126,255,.72);
            box-shadow: 0 12px 38px rgba(0,0,0,.42), 0 0 0 2px rgba(131,98,255,.18);
            outline: none;
          }
          svg { flex: 0 0 auto; color: #a98cff; }
          span { display: flex; flex-direction: column; gap: 2px; white-space: nowrap; }
          small { color: #aaa5bd; font: 500 10px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          a[data-opening="true"] { pointer-events: none; opacity: .78; }
          @media (prefers-reduced-motion: reduce) { a { transition: none; } }
        </style>
        <a aria-label="Open this merge request in Paseito">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 15V9a3 3 0 0 0-3-3H9"/>
          </svg>
          <span>Open in Paseito<small></small></span>
        </a>`;
      const link = shadow.querySelector("a");
      link.addEventListener("click", () => {
        link.dataset.opening = "true";
        const label = link.querySelector("span");
        label.firstChild.textContent = "Opening Paseito";
        setTimeout(() => {
          link.dataset.opening = "false";
          label.firstChild.textContent = "Open in Paseito";
        }, 1_500);
      });
    }
    const link = root.shadowRoot.querySelector("a");
    link.href = `paseito://mrs/open?url=${encodeURIComponent(mr.url)}`;
    link.querySelector("small").textContent = `MR !${mr.iid}`;
  }

  let lastUrl = "";
  const update = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    render();
  };
  update();
  addEventListener("popstate", update);
  addEventListener("hashchange", update);
  new MutationObserver(update).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
