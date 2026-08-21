export interface MRDeepLinkTarget {
  url: string;
}

const MAX_DEEP_LINK_LENGTH = 4_096;

export function normalizeGitLabMergeRequestUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !/^\/(.+)\/-\/merge_requests\/([1-9]\d*)\/?$/.test(url.pathname)
  ) {
    return null;
  }

  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

export function buildMRDeepLink(target: MRDeepLinkTarget): string {
  const url = normalizeGitLabMergeRequestUrl(target.url);
  if (!url) {
    throw new Error("MR deep links require a valid HTTPS GitLab merge request URL.");
  }
  return `paseito://mrs/open?url=${encodeURIComponent(url)}`;
}

export function parseMRDeepLink(input: string): MRDeepLinkTarget | null {
  if (input.length > MAX_DEEP_LINK_LENGTH) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (
    url.protocol !== "paseito:" ||
    url.hostname !== "mrs" ||
    url.pathname !== "/open" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "url") ||
    url.searchParams.getAll("url").length !== 1
  ) {
    return null;
  }

  const mergeRequestUrl = normalizeGitLabMergeRequestUrl(url.searchParams.get("url") ?? "");
  return mergeRequestUrl ? { url: mergeRequestUrl } : null;
}
