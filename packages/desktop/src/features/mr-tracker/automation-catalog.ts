import type {
  MRAutomationOperationDescriptor,
  MRAutomationPredicateDescriptor,
} from "./automation-types.js";

export const BUILTIN_MR_AUTOMATION_PREDICATES: MRAutomationPredicateDescriptor[] = [
  {
    id: "paseito.mr.new",
    title: "Newly discovered MR",
    description: "Matches only when Paseito first discovers the merge request.",
    fields: [],
  },
  {
    id: "gitlab.mr.state",
    title: "MR state",
    description: "Matches a GitLab merge request state.",
    fields: [
      {
        key: "value",
        type: "select",
        label: "State",
        required: true,
        options: [{ value: "opened", label: "Open" }],
      },
    ],
  },
  {
    id: "gitlab.mr.draft",
    title: "Draft",
    description: "Matches whether the merge request is a draft.",
    fields: [{ key: "value", type: "boolean", label: "Is a draft" }],
  },
  {
    id: "gitlab.mr.title_contains",
    title: "Title contains",
    description: "Matches text in the merge request title.",
    fields: [
      { key: "value", type: "text", label: "Text", required: true },
      { key: "caseSensitive", type: "boolean", label: "Case sensitive" },
    ],
  },
  {
    id: "gitlab.mr.approved",
    title: "Approvals satisfied",
    description: "Matches when GitLab reports no approvals left.",
    fields: [],
  },
  {
    id: "gitlab.discussion.user_activity_resolved",
    title: "Commenter activity resolved",
    description:
      "Matches when a user has commented and none of their resolvable notes remain open.",
    fields: [{ key: "username", type: "gitlab-user", label: "GitLab user", required: true }],
  },
  {
    id: "gitlab.pipeline.exists",
    title: "Named pipeline exists",
    description: "Matches an exact pipeline name on the current MR head SHA.",
    fields: [{ key: "name", type: "text", label: "Pipeline name", required: true }],
  },
  {
    id: "gitlab.pipeline.status",
    title: "Named pipeline status",
    description: "Matches the newest exact-name pipeline on the current MR head SHA.",
    fields: [
      { key: "name", type: "text", label: "Pipeline name", required: true },
      {
        key: "status",
        type: "select",
        label: "Status",
        required: true,
        options: [
          { value: "success", label: "Passed" },
          { value: "failed", label: "Failed" },
          { value: "running", label: "Running" },
          { value: "pending", label: "Pending" },
          { value: "canceled", label: "Canceled" },
        ],
      },
    ],
  },
];

export const BUILTIN_MR_AUTOMATION_OPERATIONS: MRAutomationOperationDescriptor[] = [
  {
    id: "gitlab.note.create",
    title: "Post comment",
    description: "Posts an exact comment to the merge request.",
    kind: "mutation",
    allowedPresentations: ["automatic", "button"],
    fields: [{ key: "body", type: "multiline", label: "Comment", required: true }],
  },
  {
    id: "gitlab.reviewers.add",
    title: "Add reviewers",
    description: "Adds users without removing existing reviewers.",
    kind: "mutation",
    allowedPresentations: ["automatic", "button"],
    fields: [{ key: "usernames", type: "gitlab-users", label: "Reviewers", required: true }],
  },
  {
    id: "gitlab.pipeline.open",
    title: "Open named pipeline",
    description: "Opens the newest exact-name pipeline for the current MR head SHA.",
    kind: "link",
    allowedPresentations: ["link"],
    fields: [{ key: "name", type: "text", label: "Pipeline name", required: true }],
  },
];
