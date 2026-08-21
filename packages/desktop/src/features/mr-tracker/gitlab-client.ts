import type {
  GitLabUserSummary,
  MergeRequestApprovalSummary,
  MergeRequestDiscussionSummary,
  MergeRequestPipelineSummary,
  MRTrackerTokenType,
} from "./types.js";

interface GitLabClientOptions {
  baseUrl: string;
  token: string;
  tokenType: MRTrackerTokenType;
  fetchImpl?: typeof fetch;
}

export interface GitLabMergeRequest {
  id?: number;
  iid: number;
  project_id: number;
  title: string;
  description?: string | null;
  state: string;
  created_at?: string | null;
  updated_at?: string | null;
  source_branch?: string | null;
  target_branch: string;
  web_url: string;
  draft?: boolean | null;
  work_in_progress?: boolean | null;
  author: GitLabApiUser;
  assignee?: GitLabApiUser | null;
  assignees?: GitLabApiUser[] | null;
  reviewers?: GitLabApiUser[] | null;
  labels?: string[] | null;
  head_pipeline?: GitLabApiPipeline | null;
  pipeline?: GitLabApiPipeline | null;
  merge_status?: string | null;
  detailed_merge_status?: string | null;
  blocking_discussions_resolved?: boolean | null;
  sha?: string | null;
  diff_refs?: { head_sha?: string | null } | null;
}

interface GitLabApiUser {
  id: number;
  name?: string | null;
  username: string;
  web_url?: string | null;
  avatar_url?: string | null;
}

interface GitLabApiPipeline {
  id?: number | null;
  status?: string | null;
  web_url?: string | null;
  updated_at?: string | null;
}

interface GitLabApiApprovals {
  approvals_required?: number | null;
  approvals_left?: number | null;
  approved_by?: Array<{ user: GitLabApiUser }> | null;
  approval_rules_left?: Array<{ id?: number | null; name?: string | null }> | null;
}

interface GitLabApiDiscussion {
  notes?: Array<{ resolvable?: boolean | null; resolved?: boolean | null }> | null;
}

function normalizeBaseUrl(value: string): URL {
  const trimmed = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid GitLab base URL.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("GitLab must use HTTPS (HTTP is allowed only for localhost tests).");
  }
  if (url.username || url.password) {
    throw new Error("Do not include credentials in the GitLab URL.");
  }
  return url;
}

function toUser(value: GitLabApiUser): GitLabUserSummary {
  return {
    id: value.id,
    name: value.name ?? null,
    username: value.username,
    webUrl: value.web_url ?? null,
    avatarUrl: value.avatar_url ?? null,
  };
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return `GitLab returned HTTP ${status}.`;
}

export class GitLabReadOnlyClient {
  private readonly apiBaseUrl: URL;
  private readonly token: string;
  private readonly tokenType: MRTrackerTokenType;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitLabClientOptions) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiBaseUrl = new URL(`${baseUrl.toString().replace(/\/$/, "")}/api/v4/`);
    this.token = options.token;
    this.tokenType = options.tokenType;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async currentUser(): Promise<GitLabUserSummary> {
    return toUser(await this.get<GitLabApiUser>("user"));
  }

  async exactUser(username: string): Promise<GitLabUserSummary | null> {
    const values = await this.getAll<GitLabApiUser>("users", { username });
    const match = values.find(
      (value) => value.username.localeCompare(username, undefined, { sensitivity: "accent" }) === 0,
    );
    return match ? toUser(match) : null;
  }

  async openMergeRequestsByAuthor(authorId: number): Promise<GitLabMergeRequest[]> {
    return await this.getAll("merge_requests", {
      state: "opened",
      scope: "all",
      author_id: String(authorId),
      order_by: "updated_at",
      sort: "desc",
    });
  }

  async openMergeRequestsByReviewer(reviewerId: number): Promise<GitLabMergeRequest[]> {
    return await this.getAll("merge_requests", {
      state: "opened",
      scope: "all",
      reviewer_id: String(reviewerId),
      order_by: "updated_at",
      sort: "desc",
    });
  }

  async mergeRequest(projectRef: string | number, iid: number): Promise<GitLabMergeRequest> {
    return await this.get(
      `projects/${encodeURIComponent(String(projectRef))}/merge_requests/${encodeURIComponent(String(iid))}`,
    );
  }

  async latestPipeline(
    projectRef: string | number,
    iid: number,
  ): Promise<MergeRequestPipelineSummary | null> {
    const values = await this.get<GitLabApiPipeline[]>(
      `projects/${encodeURIComponent(String(projectRef))}/merge_requests/${iid}/pipelines`,
      { per_page: "1" },
    );
    const value = values[0];
    if (!value?.status) return null;
    return {
      id: value.id ?? null,
      status: value.status,
      webUrl: value.web_url ?? null,
      updatedAt: value.updated_at ?? null,
    };
  }

  async approvals(projectRef: string | number, iid: number): Promise<MergeRequestApprovalSummary> {
    const value = await this.get<GitLabApiApprovals>(
      `projects/${encodeURIComponent(String(projectRef))}/merge_requests/${iid}/approvals`,
    );
    return {
      approvedBy: (value.approved_by ?? []).map((entry) => toUser(entry.user)),
      approvalsRequired: value.approvals_required ?? null,
      approvalsLeft: value.approvals_left ?? null,
      rulesLeft: value.approval_rules_left?.length ?? null,
      error: null,
    };
  }

  async discussions(
    projectRef: string | number,
    iid: number,
  ): Promise<MergeRequestDiscussionSummary> {
    const values = await this.getAll<GitLabApiDiscussion>(
      `projects/${encodeURIComponent(String(projectRef))}/merge_requests/${iid}/discussions`,
    );
    const notes = values.flatMap((discussion) => discussion.notes ?? []);
    const resolvable = notes.filter((note) => note.resolvable === true);
    return {
      resolvableCount: resolvable.length,
      unresolvedCount: resolvable.filter((note) => note.resolved !== true).length,
      error: null,
    };
  }

  private async getAll<T>(endpoint: string, query: Record<string, string> = {}): Promise<T[]> {
    const values: T[] = [];
    let page = 1;
    while (true) {
      const response = await this.request<T[]>(endpoint, {
        ...query,
        per_page: "100",
        page: String(page),
      });
      values.push(...response.value);
      const nextPage = Number.parseInt(response.headers.get("x-next-page") ?? "", 10);
      if (!Number.isInteger(nextPage) || nextPage <= page) break;
      page = nextPage;
    }
    return values;
  }

  private async get<T>(endpoint: string, query: Record<string, string> = {}): Promise<T> {
    return (await this.request<T>(endpoint, query)).value;
  }

  private async request<T>(
    endpoint: string,
    query: Record<string, string>,
  ): Promise<{ value: T; headers: Headers }> {
    const url = new URL(endpoint, this.apiBaseUrl);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers:
          this.tokenType === "bearer"
            ? { Authorization: `Bearer ${this.token}` }
            : { "Private-Token": this.token },
        redirect: "error",
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("GitLab returned an unreadable response.");
      }
      if (!response.ok) throw new Error(errorMessage(body, response.status));
      return { value: body as T, headers: response.headers };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("GitLab request timed out.", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function projectPathFromMergeRequestUrl(value: string): string {
  try {
    const url = new URL(value);
    const marker = "/-/merge_requests/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex <= 0) return String(new URL(value).pathname).replace(/^\/+|\/+$/g, "");
    return decodeURIComponent(url.pathname.slice(0, markerIndex).replace(/^\/+|\/+$/g, ""));
  } catch {
    return "";
  }
}
