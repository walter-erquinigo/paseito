export function parseGitLabMergeRequestUrl(input) {
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
  return {
    url: url.toString(),
    origin: url.origin,
    projectPath: decodeURIComponent(match[1]),
    iid: Number.parseInt(match[2], 10),
  };
}

export function buildPaseitoMRLink(input) {
  const mergeRequest = parseGitLabMergeRequestUrl(input);
  return mergeRequest ? `paseito://mrs/open?url=${encodeURIComponent(mergeRequest.url)}` : null;
}

export function originPattern(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) {
    throw new Error("Expected an HTTPS origin.");
  }
  return `${url.origin}/*`;
}

export function registrationId(origin) {
  let hash = 2_166_136_261;
  for (const character of origin) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `paseito-mr-${(hash >>> 0).toString(16)}`;
}
